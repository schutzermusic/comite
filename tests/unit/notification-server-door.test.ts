/**
 * Aviso in-app produzido no SERVIDOR sai pela porta de servidor.
 *
 * `create_notification` (026) é a porta do NAVEGADOR: resolve a organização
 * por auth.uid(), que não existe no service role — do servidor ela sempre
 * falha ("Usuário sem organização ativa"). O alerta de marco de faturamento
 * caiu nisso: todo aviso in-app terminava FAILED. A porta de servidor é
 * `create_notification_for` (195/242), com a organização por parâmetro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

const ORG = '11111111-1111-4111-8111-111111111111';
const ALERT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

/** Um cliente de serviço mínimo: as leituras que a rotina faz, cada uma com o dado do cenário. */
function query(rows: unknown) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'order']) q[m] = () => q;
  q.maybeSingle = async () => ({ data: { channels: ['in_app'] }, error: null });
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null, count: 0 });
  return q;
}
vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => ({
    rpc,
    from: (table: string) => query(table === 'contract_billing_milestone_alerts' ? [{
      id: ALERT, organization_id: ORG, contract_id: 'c', milestone_id: 'm', project_id: null, planned_date: '2026-10-01',
      planned_date_basis: 'milestone_due_date', offset_days: 7, kind: 'UPCOMING', facts_snapshot: {}, amount: 1000,
      currency: 'BRL', policy_source: 'DEFAULT', generated_at: '2026-09-24T12:00:00Z', as_of_date: '2026-09-24',
    }] : []),
  }),
}));

import { dispatchBillingAlertsForOrganization } from '@/lib/contracts/billing/planning/alert-dispatch-server';

describe('alerta de marco de faturamento', () => {
  it('entrega in-app pela porta de SERVIDOR, com a organização do alerta, e registra o id no livro', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'contract_billing_alerts_materialize') return { data: 1, error: null };
      if (fn === 'contract_billing_alert_recipients') return { data: [{ recipient_user_id: USER, recipient_role: 'milestone_owner' }], error: null };
      if (fn === 'create_notification_for') return { data: 'n-1', error: null };
      if (fn === 'contract_billing_alert_record_dispatch') return { data: 'd-1', error: null };
      return { data: null, error: { message: `inesperado: ${fn}` } };
    });
    const summary = await dispatchBillingAlertsForOrganization(ORG, { asOf: '2026-09-24', test: true });

    const names = rpc.mock.calls.map((c) => c[0]);
    expect(names).not.toContain('create_notification');
    expect(rpc).toHaveBeenCalledWith('create_notification_for', expect.objectContaining({
      p_organization_id: ORG, p_recipient: USER, p_type: 'contracts.billing.milestone_due',
      p_link: expect.stringMatching(/^\/contratos\?/),
    }));
    expect(rpc).toHaveBeenCalledWith('contract_billing_alert_record_dispatch', expect.objectContaining({
      p_channel: 'in_app', p_state: 'DELIVERED', p_notification_id: 'n-1',
    }));
    expect(summary).toMatchObject({ inApp: 1, failures: 0 });
  });
});

describe('nenhum módulo de servidor chama a porta do navegador', () => {
  const SERVER_MARKERS = [/platformServiceClient/, /@\/utils\/supabase\/server/, /SUPABASE_SERVICE_ROLE_KEY/, /from 'server-only'/];
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });

  it("rpc('create_notification') só aparece em código de navegador", () => {
    const offenders = walk(path.resolve('src')).filter((file) => {
      const src = fs.readFileSync(file, 'utf8');
      if (!/rpc\(\s*['"]create_notification['"]/.test(src)) return false;
      const serverSide = file.includes(`${path.sep}app${path.sep}api${path.sep}`) || SERVER_MARKERS.some((m) => m.test(src));
      return serverSide;
    });
    expect(offenders.map((f) => path.relative(process.cwd(), f))).toEqual([]);
  });
});
