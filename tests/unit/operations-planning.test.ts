/**
 * Planejamento (231):
 *  • prontidão derivada: material lê cobertura do Supply; o resto lê o ato "atendido";
 *  • o pior requisito decide a atividade;
 *  • exceções de plano determinísticas;
 *  • entrada das rotas: campos ausentes não são tocados; leitura por QUALQUER chave,
 *    escrita pela chave exata.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import {
  criticalReasons, dimensionOf, isBlockingReadiness, needByOf, planningConstraints, requirementReadiness, worstReadiness,
  type RequirementLike,
} from '@/lib/operations/planning/readiness';
import { daysBetween } from '@/lib/operations/overview-rules';
import { requirementPayload, requirementSchema } from '@/lib/operations/planning/validation';

const TODAY = '2026-09-24';
const req = (over: Partial<RequirementLike> = {}): RequirementLike => ({
  requirement_type: 'MATERIAL', status: 'CONFIRMED', quantity: '1000', required_by: '2026-10-10', satisfied_at: null, ...over,
});

describe('prontidão por requisito', () => {
  it('material: sem cobertura é falta; parcial é parcial; coberto é pronto', () => {
    expect(requirementReadiness(req(), TODAY)).toBe('SHORTAGE');
    expect(requirementReadiness(req(), TODAY, { covered: 250, inbound: 300 })).toBe('PARTIAL');
    expect(requirementReadiness(req(), TODAY, { covered: 1000, inbound: 0 })).toBe('READY');
  });
  it('material não fica "pronto" por ato manual', () => {
    expect(requirementReadiness(req({ satisfied_at: '2026-09-01' }), TODAY)).toBe('SHORTAGE');
  });
  it('dependência do cliente: atendida, pendente ou vencida', () => {
    const dep = req({ requirement_type: 'CUSTOMER_DEPENDENCY', quantity: null });
    expect(requirementReadiness(dep, TODAY)).toBe('PENDING');
    expect(requirementReadiness({ ...dep, required_by: '2026-09-20' }, TODAY)).toBe('OVERDUE');
    expect(requirementReadiness({ ...dep, satisfied_at: '2026-09-21' }, TODAY)).toBe('READY');
  });
  it('planejado ainda não prometeu nada; cancelado e substituído saem da conta', () => {
    expect(requirementReadiness(req({ status: 'PLANNED' }), TODAY)).toBe('UNCONFIRMED');
    expect(requirementReadiness(req({ status: 'CANCELLED' }), TODAY)).toBeNull();
    expect(requirementReadiness(req({ status: 'SUPERSEDED' }), TODAY)).toBeNull();
  });
  it('o pior vence; bloqueio = vencido ou em falta', () => {
    expect(worstReadiness(['READY', 'PENDING', 'SHORTAGE'])).toBe('SHORTAGE');
    expect(worstReadiness(['READY', 'OVERDUE', 'SHORTAGE'])).toBe('OVERDUE');
    expect(worstReadiness([null, null])).toBeNull();
    expect(isBlockingReadiness('SHORTAGE')).toBe(true);
    expect(isBlockingReadiness('PARTIAL')).toBe(false);
  });
  it('cada tipo cai numa coluna da matriz', () => {
    expect(dimensionOf('WORKFORCE')).toBe('team');
    expect(dimensionOf('EXTERNAL_SERVICE')).toBe('material');
    expect(dimensionOf('VEHICLE')).toBe('equipment');
    expect(dimensionOf('CUSTOMER_DEPENDENCY')).toBe('customer');
  });
});

describe('exceções de plano', () => {
  const r = { ...req(), title: 'Cabo 35 mm', activity_id: 'a1' };
  it('necessidade depois do início da atividade', () => {
    const c = planningConstraints(r, { planned_start: '2026-10-05', title: 'Lançamento' }, TODAY, 'SHORTAGE', daysBetween);
    expect(c.map((x) => x.code)).toContain('NEED_AFTER_ACTIVITY_START');
  });
  it('material em falta a 14 dias da necessidade; vencido é perigo', () => {
    expect(planningConstraints({ ...r, required_by: '2026-10-01' }, null, TODAY, 'SHORTAGE', daysBetween)
      .find((x) => x.code === 'MATERIAL_SHORT_NEAR_NEED')?.severity).toBe('warning');
    expect(planningConstraints({ ...r, required_by: '2026-09-20' }, null, TODAY, 'SHORTAGE', daysBetween)
      .find((x) => x.code === 'MATERIAL_SHORT_NEAR_NEED')?.severity).toBe('danger');
  });
  it('não confirmado com a frente começando; dependência vencida; sem atividade', () => {
    const planned = { ...r, status: 'PLANNED' as const };
    expect(planningConstraints(planned, { planned_start: '2026-10-01', title: 'X' }, TODAY, 'UNCONFIRMED', daysBetween)
      .map((x) => x.code)).toContain('UNCONFIRMED_NEAR_START');
    const dep = { ...r, requirement_type: 'CUSTOMER_DEPENDENCY' as const, required_by: '2026-09-01' };
    expect(planningConstraints(dep, null, TODAY, 'OVERDUE', daysBetween)[0].code).toBe('CUSTOMER_DEPENDENCY_OVERDUE');
    expect(planningConstraints({ ...r, activity_id: null }, null, TODAY, 'READY', daysBetween).map((x) => x.code))
      .toEqual(['REQUIREMENT_WITHOUT_ACTIVITY']);
  });
  it('requisito pronto não gera exceção de cobertura', () => {
    expect(planningConstraints(r, { planned_start: '2026-10-20', title: 'X' }, TODAY, 'READY', daysBetween)).toEqual([]);
  });
});

describe('entrada das rotas de requisito', () => {
  it('só os campos enviados viram payload (edição parcial não apaga)', () => {
    const parsed = requirementSchema.parse({ requiredBy: '2026-11-18', quantity: 800 });
    expect(requirementPayload(parsed)).toEqual({ required_by: '2026-11-18', quantity: 800 });
  });
  it('tipo fora do vocabulário e data malformada são recusados', () => {
    expect(requirementSchema.safeParse({ requirementType: 'CONCRETE' }).success).toBe(false);
    expect(requirementSchema.safeParse({ requiredBy: '18/11/2026' }).success).toBe(false);
    expect(requirementSchema.safeParse({ quantity: -1 }).success).toBe(false);
  });
  it('quantidade não finita é recusada (1e999 no JSON vira Infinity no parse e sumiria como null)', () => {
    expect(requirementSchema.safeParse(JSON.parse('{"quantity": 1e999}')).success).toBe(false);
    expect(requirementSchema.safeParse({ quantity: Number.NaN }).success).toBe(false);
  });
});

const { perms } = vi.hoisted(() => ({ perms: new Set<string>() }));
vi.mock('@/lib/commercial/server-session', () => ({
  requireCommercialSession: async (required: string[]) => {
    const missing = required.filter((k) => !perms.has(k));
    if (missing.length) return { error: NextResponse.json({ ok: false }, { status: 403 }) };
    return { organizationId: 'org-1', user: { id: 'u1' }, permissions: perms, supabase: {} };
  },
  isSessionError: (r: object) => 'error' in r,
  hasOptionalPermission: async (_s: unknown, k: string) => perms.has(k),
  safeGovernedError: (m: string) => m,
}));

describe('leitura por QUALQUER chave, escrita pela chave exata', () => {
  beforeEach(() => perms.clear());
  it('projects.view OU operations.planning.view leem; nenhuma das duas não', async () => {
    const { requireAnyOperationsPermission } = await import('@/lib/operations/session');
    expect('error' in (await requireAnyOperationsPermission(['operations.planning.view', 'projects.view']))).toBe(true);
    perms.add('projects.view');
    expect('error' in (await requireAnyOperationsPermission(['operations.planning.view', 'projects.view']))).toBe(false);
  });
  it('escrever requisito exige operations.planning.manage', async () => {
    perms.add('projects.view').add('operations.planning.view');
    const { POST } = await import('@/app/api/operations/requirements/route');
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify(
      { projectId: 'p', requirementType: 'MATERIAL', title: 'Cabo' }) }));
    expect(res.status).toBe(403);
  });
});

describe('frentes do planejamento', () => {
  it('data que vale: a menor entre a declarada e o início da frente', () => {
    expect(needByOf('2026-10-14', '2026-10-12')).toBe('2026-10-12');
    expect(needByOf('2026-10-01', '2026-10-12')).toBe('2026-10-01');
    expect(needByOf(null, '2026-10-12')).toBe('2026-10-12');
    expect(needByOf('2026-10-01', null)).toBe('2026-10-01');
    expect(needByOf(null, null)).toBeNull();
  });
  it('por que é crítica — a mesma definição da Visão Geral, em palavras', () => {
    const base = { status: 'not_started', priority: 'medium', delay_status: 'on_track', is_milestone: false, is_summary: false,
      planned_start: '2026-09-20', planned_finish: '2026-10-20', actual_finish: null };
    expect(criticalReasons(base, TODAY)).toEqual([]);
    expect(criticalReasons({ ...base, priority: 'critical' }, TODAY)).toEqual(['prioridade crítica']);
    expect(criticalReasons({ ...base, delay_status: 'delayed', planned_finish: '2026-09-01' }, TODAY)).toEqual(['atrasada', 'término vencido']);
    expect(criticalReasons({ ...base, priority: 'critical', status: 'completed' }, TODAY)).toEqual([]);
    expect(criticalReasons({ ...base, priority: 'critical', is_summary: true }, TODAY)).toEqual([]);
  });
});
