/**
 * Inteligência de CRONOGRAMA — plano × realidade das datas.
 *
 * Estes cálculos não dependem do apontamento de propósito: continuam válidos
 * para quem não tem permissão de ler o timesheet. Os testes fixam isso e a
 * fronteira entre "não sei" (null) e "sei que é zero".
 */

import { describe, it, expect } from 'vitest';
import {
  buildScheduleIntelligence,
  buildScheduleSignal,
  effectiveFinishOf,
  expectedProgressOf,
  formatDays,
  formatPct,
  MILESTONE_RISK_WINDOW_DAYS,
} from '@/lib/projects/timeline-intelligence';
import type { TimelineDependency } from '@/lib/types/project-timeline';
import { FIXED_NOW, makeItem } from './fixtures/timeline-fixtures';

// FIXED_NOW = quarta, 12/08/2026 12:00 local.
const dep = (predecessorId: string, successorId: string): TimelineDependency => ({
  id: `${predecessorId}->${successorId}`,
  organizationId: 'org-1',
  projectId: 'proj-1',
  predecessorId,
  successorId,
  type: 'FS',
  lagMinutes: 0,
  createdAt: FIXED_NOW,
});

describe('expectedProgressOf', () => {
  it('é null sem datas planejadas — nunca 0', () => {
    expect(expectedProgressOf(makeItem({ id: 'a' }), FIXED_NOW)).toBeNull();
    expect(expectedProgressOf(makeItem({ id: 'b', plannedStart: '2026-08-01' }), FIXED_NOW)).toBeNull();
  });

  it('concluída vale 100 mesmo sem datas', () => {
    expect(expectedProgressOf(makeItem({ id: 'a', status: 'completed' }), FIXED_NOW)).toBe(100);
  });

  it('antes do início planejado é 0 observado', () => {
    const item = makeItem({ id: 'a', plannedStart: '2026-09-01', plannedFinish: '2026-09-10' });
    expect(expectedProgressOf(item, FIXED_NOW)).toBe(0);
  });

  it('depois do término planejado é 100', () => {
    const item = makeItem({ id: 'a', plannedStart: '2026-07-01', plannedFinish: '2026-07-10' });
    expect(expectedProgressOf(item, FIXED_NOW)).toBe(100);
  });

  it('interpola linearmente no meio da janela', () => {
    // 11/08 a 14/08 = 4 dias inclusivos; em 12/08 já se passou 1 de 4 = 25%.
    const item = makeItem({ id: 'a', plannedStart: '2026-08-11', plannedFinish: '2026-08-14' });
    expect(expectedProgressOf(item, FIXED_NOW)).toBe(25);
  });

  it('o dia do término ainda não é 100 (término inclusivo)', () => {
    const item = makeItem({ id: 'a', plannedStart: '2026-08-11', plannedFinish: '2026-08-12' });
    expect(expectedProgressOf(item, FIXED_NOW)).toBe(50);
  });
});

describe('effectiveFinishOf', () => {
  it('term real vence tudo', () => {
    const item = makeItem({
      id: 'a', plannedFinish: '2026-08-30', forecastFinish: '2026-09-10', actualFinish: '2026-08-05',
    });
    expect(effectiveFinishOf(item, FIXED_NOW)).toBe('2026-08-05');
  });

  it('sem real, usa a previsão reportada', () => {
    const item = makeItem({ id: 'a', plannedFinish: '2026-08-30', forecastFinish: '2026-09-10' });
    expect(effectiveFinishOf(item, FIXED_NOW)).toBe('2026-09-10');
  });

  it('item vencido e aberto passa a valer HOJE, não a data planejada', () => {
    const item = makeItem({ id: 'a', status: 'in_progress', plannedFinish: '2026-08-01' });
    expect(effectiveFinishOf(item, FIXED_NOW)).toBe('2026-08-12');
  });

  it('sem desvio, vale o planejado', () => {
    const item = makeItem({ id: 'a', plannedFinish: '2026-08-30' });
    expect(effectiveFinishOf(item, FIXED_NOW)).toBe('2026-08-30');
  });

  it('sem término planejado, é null', () => {
    expect(effectiveFinishOf(makeItem({ id: 'a' }), FIXED_NOW)).toBeNull();
  });
});

describe('buildScheduleSignal', () => {
  it('variação de prazo é 0 quando o plano segue de pé', () => {
    const s = buildScheduleSignal(makeItem({ id: 'a', plannedFinish: '2026-08-30' }), FIXED_NOW);
    expect(s.scheduleVarianceDays).toBe(0);
    expect(s.isOverdue).toBe(false);
  });

  it('conta os dias de atraso de um item vencido', () => {
    const item = makeItem({ id: 'a', status: 'in_progress', plannedFinish: '2026-08-02' });
    const s = buildScheduleSignal(item, FIXED_NOW);
    expect(s.scheduleVarianceDays).toBe(10);
    expect(s.isOverdue).toBe(true);
  });

  it('previsão adiantada gera variação NEGATIVA', () => {
    const item = makeItem({ id: 'a', plannedFinish: '2026-08-30', forecastFinish: '2026-08-25' });
    expect(buildScheduleSignal(item, FIXED_NOW).scheduleVarianceDays).toBe(-5);
  });

  it('atrás do plano: progresso muito abaixo do esperado, ainda no prazo', () => {
    // 01/08→31/08: esperado ~35%; com 5% está 30 p.p. atrás.
    const item = makeItem({
      id: 'a', status: 'in_progress', percentComplete: 5,
      plannedStart: '2026-08-01', plannedFinish: '2026-08-31',
    });
    const s = buildScheduleSignal(item, FIXED_NOW);
    expect(s.behindSchedule).toBe(true);
    expect(s.isOverdue).toBe(false);
    expect(s.progressVariancePct).toBeLessThan(-15);
  });

  it('dentro da tolerância não é "atrás do plano"', () => {
    const item = makeItem({
      id: 'a', status: 'in_progress', percentComplete: 30,
      plannedStart: '2026-08-01', plannedFinish: '2026-08-31',
    });
    expect(buildScheduleSignal(item, FIXED_NOW).behindSchedule).toBe(false);
  });

  it('item vencido não é marcado como "atrás do plano" (já é atraso)', () => {
    const item = makeItem({
      id: 'a', status: 'in_progress', percentComplete: 0,
      plannedStart: '2026-07-01', plannedFinish: '2026-07-20',
    });
    const s = buildScheduleSignal(item, FIXED_NOW);
    expect(s.isOverdue).toBe(true);
    expect(s.behindSchedule).toBe(false);
  });

  it('sem datas, tudo que depende delas é null', () => {
    const s = buildScheduleSignal(makeItem({ id: 'a' }), FIXED_NOW);
    expect(s.expectedProgress).toBeNull();
    expect(s.progressVariancePct).toBeNull();
    expect(s.scheduleVarianceDays).toBeNull();
  });
});

describe('atraso previsto do projeto', () => {
  it('projeta o término pelo item mais atrasado', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, plannedFinish: '2026-08-20' }),
      makeItem({ id: 'b', rowOrder: 2, status: 'in_progress', plannedFinish: '2026-08-30', forecastFinish: '2026-09-15' }),
    ];
    const intel = buildScheduleIntelligence({ items, now: FIXED_NOW });
    expect(intel.plannedFinish).toBe('2026-08-30');
    expect(intel.projectedFinish).toBe('2026-09-15');
    expect(intel.forecastDelayDays).toBe(16);
  });

  it('sem desvio, o atraso previsto é 0', () => {
    const items = [makeItem({ id: 'a', plannedFinish: '2026-08-30' })];
    expect(buildScheduleIntelligence({ items, now: FIXED_NOW }).forecastDelayDays).toBe(0);
  });

  it('sem datas no cronograma, é null e não 0', () => {
    const intel = buildScheduleIntelligence({ items: [makeItem({ id: 'a' })], now: FIXED_NOW });
    expect(intel.forecastDelayDays).toBeNull();
    expect(intel.plannedFinish).toBeNull();
  });

  it('ignora itens inativos', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, plannedFinish: '2026-08-20' }),
      makeItem({ id: 'off', rowOrder: 2, plannedFinish: '2027-12-31', isActive: false }),
    ];
    expect(buildScheduleIntelligence({ items, now: FIXED_NOW }).plannedFinish).toBe('2026-08-20');
  });

  it('progresso esperado geral pondera por duração, como o % realizado', () => {
    const items = [
      // Passado: espera 100%. Futuro: espera 0%. Pesos iguais ⇒ 50%.
      makeItem({ id: 'a', rowOrder: 1, plannedStart: '2026-07-01', plannedFinish: '2026-07-10' }),
      makeItem({ id: 'b', rowOrder: 2, plannedStart: '2026-09-01', plannedFinish: '2026-09-10' }),
    ];
    expect(buildScheduleIntelligence({ items, now: FIXED_NOW }).expectedProgressOverall).toBe(50);
  });

  it('progresso esperado geral é null quando nenhuma folha tem datas', () => {
    const items = [makeItem({ id: 'a' })];
    expect(buildScheduleIntelligence({ items, now: FIXED_NOW }).expectedProgressOverall).toBeNull();
  });
});

describe('marcos em risco', () => {
  const milestone = (over: Parameters<typeof makeItem>[0]) =>
    makeItem({ isMilestone: true, ...over });

  it('marco vencido entra como risco "overdue"', () => {
    const items = [milestone({ id: 'm', plannedFinish: '2026-08-01' })];
    const risks = buildScheduleIntelligence({ items, now: FIXED_NOW }).milestonesAtRisk;
    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({ itemId: 'm', reason: 'overdue' });
  });

  it('marco concluído nunca entra, mesmo vencido', () => {
    const items = [milestone({ id: 'm', status: 'completed', plannedFinish: '2026-08-01' })];
    expect(buildScheduleIntelligence({ items, now: FIXED_NOW }).milestonesAtRisk).toHaveLength(0);
  });

  it('predecessora atrasada coloca o marco futuro em risco', () => {
    const items = [
      makeItem({ id: 't', rowOrder: 1, status: 'in_progress', plannedFinish: '2026-08-01' }),
      milestone({ id: 'm', rowOrder: 2, plannedFinish: '2026-12-01' }),
    ];
    const risks = buildScheduleIntelligence({ items, dependencies: [dep('t', 'm')], now: FIXED_NOW }).milestonesAtRisk;
    expect(risks[0]).toMatchObject({ itemId: 'm', reason: 'predecessor_late' });
  });

  it('predecessora bloqueada também conta como atraso', () => {
    const items = [
      makeItem({ id: 't', rowOrder: 1, status: 'blocked', plannedFinish: '2026-12-01' }),
      milestone({ id: 'm', rowOrder: 2, plannedFinish: '2026-12-15' }),
    ];
    const risks = buildScheduleIntelligence({ items, dependencies: [dep('t', 'm')], now: FIXED_NOW }).milestonesAtRisk;
    expect(risks[0].reason).toBe('predecessor_late');
  });

  it('marco próximo com predecessora ainda aberta entra como "predecessor_open"', () => {
    const items = [
      makeItem({ id: 't', rowOrder: 1, status: 'in_progress', plannedFinish: '2026-08-25' }),
      milestone({ id: 'm', rowOrder: 2, plannedFinish: '2026-08-20' }),
    ];
    const risks = buildScheduleIntelligence({ items, dependencies: [dep('t', 'm')], now: FIXED_NOW }).milestonesAtRisk;
    expect(risks[0].reason).toBe('predecessor_open');
    expect(risks[0].daysUntil).toBe(8);
  });

  it('predecessora concluída e marco no prazo ⇒ sem risco', () => {
    const items = [
      makeItem({ id: 't', rowOrder: 1, status: 'completed', plannedFinish: '2026-08-01' }),
      milestone({ id: 'm', rowOrder: 2, plannedFinish: '2026-08-20' }),
    ];
    expect(
      buildScheduleIntelligence({ items, dependencies: [dep('t', 'm')], now: FIXED_NOW }).milestonesAtRisk,
    ).toHaveLength(0);
  });

  it('marco distante sem predecessora atrasada não é risco', () => {
    const far = new Date(FIXED_NOW.getTime() + (MILESTONE_RISK_WINDOW_DAYS + 20) * 86400000)
      .toISOString().slice(0, 10);
    const items = [
      makeItem({ id: 't', rowOrder: 1, status: 'in_progress', plannedFinish: '2027-01-01' }),
      milestone({ id: 'm', rowOrder: 2, plannedFinish: far }),
    ];
    expect(
      buildScheduleIntelligence({ items, dependencies: [dep('t', 'm')], now: FIXED_NOW }).milestonesAtRisk,
    ).toHaveLength(0);
  });

  it('ordena os riscos do mais próximo para o mais distante', () => {
    const items = [
      milestone({ id: 'far', rowOrder: 1, plannedFinish: '2026-08-01' }),
      milestone({ id: 'near', rowOrder: 2, plannedFinish: '2026-08-10' }),
    ];
    const risks = buildScheduleIntelligence({ items, now: FIXED_NOW }).milestonesAtRisk;
    expect(risks.map((r) => r.itemId)).toEqual(['far', 'near']);
    expect(risks[0].daysUntil).toBeLessThan(risks[1].daysUntil!);
  });
});

describe('formatação', () => {
  it('null vira travessão', () => {
    expect(formatDays(null)).toBe('—');
    expect(formatPct(null)).toBe('—');
  });

  it('zero dias é "no prazo", não "0 d"', () => {
    expect(formatDays(0)).toBe('no prazo');
  });

  it('atraso e adiantamento ganham sinal', () => {
    expect(formatDays(5)).toBe('+5 d');
    expect(formatDays(-3)).toBe('-3 d');
    expect(formatPct(12)).toBe('+12 p.p.');
  });
});
