/**
 * Projeto 360 (wave C):
 *  • saúde derivada com motivos — nunca uma bolinha sem explicação;
 *  • avanço físico só das folhas, ponderado por duração;
 *  • timeline: fatos conhecidos ganham título; desconhecidos não somem;
 *    supply/inventário/compras caem em "Supply"; mesmo fato por duas histórias
 *    aparece uma vez; ordem do mais recente.
 */
import { describe, expect, it } from 'vitest';
import { deriveProjectHealth, physicalProgress, HEALTH_LABEL, type HealthSignals } from '@/lib/operations/projects/health';
import {
  domainEventTitle, measurementTone, measurementTransitionTitle, mergeTimeline, type ProjectTimelineEvent,
} from '@/lib/operations/projects/timeline';
import { OPERATIONS_NAV } from '@/lib/operations/navigation';

const zero: HealthSignals = {
  openActivities: 10, criticalActivities: 0, overdueActivities: 0, blockedActivities: 0, serviceOrdersBlocked: 0,
  measurementsInCorrection: 0, measurementsOverdue: 0, criticalRisks: 0, highRisks: 0, risksWithoutOwner: 0,
};

describe('saúde do projeto', () => {
  it('sem sinal e com cronograma: em dia, sem motivo inventado', () => {
    expect(deriveProjectHealth(zero, true)).toEqual({ level: 'healthy', reasons: [] });
  });
  it('sem cronograma e sem sinal: desconhecida — não "em dia"', () => {
    expect(deriveProjectHealth(zero, false).level).toBe('unknown');
    expect(HEALTH_LABEL.unknown).toBe('Sem cronograma');
  });
  it('atraso leve é atenção; bloqueio, OS travada ou risco crítico é crítico', () => {
    expect(deriveProjectHealth({ ...zero, overdueActivities: 2 }, true).level).toBe('attention');
    expect(deriveProjectHealth({ ...zero, overdueActivities: 4 }, true).level).toBe('critical');
    expect(deriveProjectHealth({ ...zero, blockedActivities: 1 }, true).level).toBe('critical');
    expect(deriveProjectHealth({ ...zero, serviceOrdersBlocked: 1 }, true).level).toBe('critical');
    expect(deriveProjectHealth({ ...zero, criticalRisks: 1 }, false).level).toBe('critical');
  });
  it('motivos vêm com o perigo primeiro e no singular/plural certo', () => {
    const { reasons } = deriveProjectHealth({ ...zero, measurementsInCorrection: 1, criticalRisks: 2 }, true);
    expect(reasons[0]).toEqual({ tone: 'danger', text: '2 riscos críticos abertos' });
    expect(reasons[1].text).toBe('1 medição devolvida para correção');
  });
});

describe('avanço físico', () => {
  it('só folhas; resumo não duplica o avanço; cancelada fica fora', () => {
    const p = physicalProgress([
      { is_summary: true, status: 'in_progress', percent_complete: 90 },
      { is_summary: false, status: 'completed', percent_complete: 40 },
      { is_summary: false, status: 'in_progress', percent_complete: 0 },
      { is_summary: false, status: 'cancelled', percent_complete: 0 },
    ]);
    expect(p).toEqual({ percent: 50, done: 1, total: 2 });
  });
  it('pondera pela duração quando há duração', () => {
    const p = physicalProgress([
      { is_summary: false, status: 'in_progress', percent_complete: 100, duration_minutes: 300 },
      { is_summary: false, status: 'not_started', percent_complete: 0, duration_minutes: 100 },
    ]);
    expect(p.percent).toBe(75);
  });
  it('sem cronograma: nulo, não zero', () => {
    expect(physicalProgress([])).toEqual({ percent: null, done: 0, total: 0 });
  });
});

describe('timeline do projeto', () => {
  it('fatos de OS ganham título; desconhecido vira o próprio nome; supply cai em Supply', () => {
    expect(domainEventTitle('operations.service_order.issued')).toMatchObject({ title: 'OS interna emitida', tone: 'success' });
    expect(domainEventTitle('inventory.reservation.created')).toMatchObject({ kind: 'supply', title: 'reservation · created' });
    expect(domainEventTitle('procurement.purchase_order.issued').kind).toBe('supply');
    expect(domainEventTitle('projects.foo.bar').kind).toBe('project');
  });
  it('medição: aceite do cliente é sucesso; devolução é atenção', () => {
    expect(measurementTransitionTitle('ACCEPTED')).toBe('Aceite do cliente registrado');
    expect(measurementTransitionTitle('APPROVED_FOR_CUSTOMER')).toBe('Medição aprovada para envio');
    expect(measurementTone('ACCEPTED')).toBe('success');
    expect(measurementTone('RETURNED_FOR_CORRECTION')).toBe('warning');
    expect(measurementTransitionTitle(null)).toBe('Medição atualizada');
  });
  it('ordena do mais recente, sem duplicata, sem evento sem data, com teto', () => {
    const e = (id: string, at: string): ProjectTimelineEvent =>
      ({ id, at, kind: 'project', title: id, detail: null, actor: null, href: null, tone: 'neutral' });
    const merged = mergeTimeline([e('a', '2026-01-01'), e('b', '2026-03-01'), e('a', '2026-01-01'), e('c', '')], 10);
    expect(merged.map((x) => x.id)).toEqual(['b', 'a']);
    expect(mergeTimeline([e('a', '1'), e('b', '2'), e('c', '3')], 2)).toHaveLength(2);
  });
  it('Medições & Evidências é destino de Operações (mesma alçada da fila)', () => {
    expect(OPERATIONS_NAV.find((i) => i.id === 'measurements')).toMatchObject(
      { href: '/operacoes/medicoes', anyPermission: ['operations.view'] });
  });
});
