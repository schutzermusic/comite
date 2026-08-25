/**
 * CARACTERIZAÇÃO — selectors do cronograma (pré-redesign do Gantt).
 *
 * Este arquivo NÃO afirma que os valores abaixo são os "certos". Afirma que são
 * os que `timeline-analytics.ts` produz HOJE. Existe para que o redesign do
 * Gantt (que acrescenta filterTree/ancestorIdsOf/weekendPhase e reescreve os
 * componentes) não mova nenhuma derivação sem virar teste vermelho.
 *
 * Pontos deliberadamente fixados por serem heurísticas, não verdades:
 *   - `deriveDelayStatus` usa "≤ 2 dias" e "< 80%" para at_risk;
 *   - `timelineKpis` pondera com fallback `|| 60` minutos quando a duração é nula;
 *   - `ganttScale` aplica padding de −3/+5 dias.
 */

import { describe, it, expect } from 'vitest';
import {
  buildTree,
  flattenTree,
  isItemDelayed,
  deriveDelayStatus,
  timelineKpis,
  ganttScale,
  ganttX,
  ganttBar,
  GANTT_TICK_WIDTH,
} from '@/lib/projects/timeline-analytics';
import { FIXED_NOW, makeItem, makeTree } from './fixtures/timeline-fixtures';

describe('caracterização: buildTree / flattenTree', () => {
  it('monta a hierarquia por parentId e ordena por rowOrder', () => {
    const roots = buildTree(makeTree());
    expect(roots.map((r) => r.item.id)).toEqual(['f1', 'f2']);
    expect(roots[0].children.map((c) => c.item.id)).toEqual(['t1', 't2']);
    expect(roots[0].depth).toBe(0);
    expect(roots[0].children[0].depth).toBe(1);
  });

  it('ordena por rowOrder e NÃO pela ordem do array de entrada', () => {
    const items = makeTree().reverse();
    expect(buildTree(items).map((r) => r.item.id)).toEqual(['f1', 'f2']);
  });

  it('promove a raiz o item cujo parentId aponta para um id ausente', () => {
    // Caso real: import desativa o pai (is_active=false) e listTimelineItems o filtra.
    const orfao = makeItem({ id: 'x', parentId: 'nao-existe', rowOrder: 1 });
    expect(buildTree([orfao]).map((r) => r.item.id)).toEqual(['x']);
  });

  it('flattenTree respeita o conjunto de recolhidos', () => {
    const roots = buildTree(makeTree());
    expect(flattenTree(roots, new Set()).map((n) => n.item.id)).toEqual(['f1', 't1', 't2', 'f2', 'm1']);
    expect(flattenTree(roots, new Set(['f1'])).map((n) => n.item.id)).toEqual(['f1', 'f2', 'm1']);
  });
});

describe('caracterização: isItemDelayed / deriveDelayStatus', () => {
  it('status completed e cancelled nunca são atrasados', () => {
    for (const status of ['completed', 'cancelled'] as const) {
      const item = makeItem({ id: 'a', status, plannedFinish: '2020-01-01' });
      expect(isItemDelayed(item, FIXED_NOW)).toBe(false);
    }
  });

  it('status "delayed" é atrasado mesmo sem datas', () => {
    expect(isItemDelayed(makeItem({ id: 'a', status: 'delayed' }), FIXED_NOW)).toBe(true);
  });

  it('término planejado no passado + status aberto ⇒ atrasado', () => {
    const item = makeItem({ id: 'a', status: 'in_progress', plannedFinish: '2026-08-10' });
    expect(isItemDelayed(item, FIXED_NOW)).toBe(true);
  });

  it('o dia do término planejado ainda NÃO conta como atraso (janela inclusiva de +1 dia)', () => {
    const item = makeItem({ id: 'a', status: 'in_progress', plannedFinish: '2026-08-12' });
    expect(isItemDelayed(item, FIXED_NOW)).toBe(false);
  });

  it('previsão posterior ao planejado ⇒ atrasado, mesmo com o planejado no futuro', () => {
    const item = makeItem({
      id: 'a', status: 'in_progress', plannedFinish: '2026-09-01', forecastFinish: '2026-09-10',
    });
    expect(isItemDelayed(item, FIXED_NOW)).toBe(true);
  });

  it('status "blocked" vence tudo em deriveDelayStatus', () => {
    const item = makeItem({ id: 'a', status: 'blocked', plannedFinish: '2020-01-01' });
    expect(deriveDelayStatus(item, FIXED_NOW)).toBe('blocked');
  });

  it('fronteira de at_risk: exatamente 2 dias e 79% ⇒ at_risk', () => {
    const item = makeItem({ id: 'a', status: 'in_progress', plannedFinish: '2026-08-14', percentComplete: 79 });
    expect(deriveDelayStatus(item, FIXED_NOW)).toBe('at_risk');
  });

  it('fronteira de at_risk: exatamente 80% NÃO é at_risk', () => {
    const item = makeItem({ id: 'a', status: 'in_progress', plannedFinish: '2026-08-14', percentComplete: 80 });
    expect(deriveDelayStatus(item, FIXED_NOW)).toBe('on_track');
  });

  it('fronteira de at_risk: 3 dias de folga NÃO é at_risk', () => {
    const item = makeItem({ id: 'a', status: 'in_progress', plannedFinish: '2026-08-16', percentComplete: 10 });
    expect(deriveDelayStatus(item, FIXED_NOW)).toBe('on_track');
  });
});

describe('caracterização: timelineKpis', () => {
  it('pondera o % geral pela duração, contando SÓ folhas', () => {
    // t1: 480min × 100% + t2: 960min × 40% = 480 + 384 = 864
    // marco m1 tem duração nula ⇒ entra com o peso-fallback de 60min × 0%
    // total = 480 + 960 + 60 = 1500 ⇒ 864/1500 = 57,6% ⇒ 58
    expect(timelineKpis(makeTree(), FIXED_NOW).overallPercent).toBe(58);
  });

  it('FIXA o peso-fallback de 60 minutos para itens sem duração', () => {
    // Duas folhas sem duração: pesos iguais ⇒ média simples dos percentuais.
    const items = [
      makeItem({ id: 'a', rowOrder: 1, percentComplete: 100, status: 'completed' }),
      makeItem({ id: 'b', rowOrder: 2, percentComplete: 0 }),
    ];
    expect(timelineKpis(items, FIXED_NOW).overallPercent).toBe(50);
  });

  it('% geral é 0 quando não há folha alguma', () => {
    const kpis = timelineKpis([makeItem({ id: 'f', isSummary: true })], FIXED_NOW);
    expect(kpis.overallPercent).toBe(0);
    expect(kpis.totalLeaf).toBe(0);
  });

  it('conta atrasadas/bloqueadas/concluídas e ignora itens inativos ou apagados', () => {
    const items = [
      ...makeTree(),
      makeItem({ id: 'del', rowOrder: 6, status: 'delayed' }),
      makeItem({ id: 'blq', rowOrder: 7, status: 'blocked' }),
      makeItem({ id: 'off', rowOrder: 8, status: 'delayed', isActive: false }),
      makeItem({ id: 'rm', rowOrder: 9, status: 'delayed', deletedAt: FIXED_NOW }),
    ];
    const kpis = timelineKpis(items, FIXED_NOW);
    expect(kpis.delayedCount).toBe(2); // t2 (término 10/08 no passado) + del
    expect(kpis.blockedCount).toBe(1);
    expect(kpis.completedCount).toBe(1);
  });

  it('"sem responsável" conta apenas itens em status aberto', () => {
    const items = [
      makeItem({ id: 'a', rowOrder: 1, status: 'in_progress' }),
      makeItem({ id: 'b', rowOrder: 2, status: 'completed' }),
      makeItem({ id: 'c', rowOrder: 3, status: 'cancelled' }),
    ];
    expect(timelineKpis(items, FIXED_NOW).missingResponsible).toBe(1);
  });

  it('próximo marco é o primeiro marco aberto a partir de ontem', () => {
    const kpis = timelineKpis(makeTree(), FIXED_NOW);
    expect(kpis.nextMilestone?.id).toBe('m1');
  });

  it('projectFinish é o MAIOR plannedFinish e daysRemaining o arredondamento pra cima', () => {
    const kpis = timelineKpis(makeTree(), FIXED_NOW);
    expect(kpis.projectFinish).toBe('2026-09-10');
    expect(kpis.daysRemaining).toBe(29);
  });
});

describe('caracterização: ganttScale', () => {
  it('larguras de tick por zoom', () => {
    expect(GANTT_TICK_WIDTH).toEqual({ day: 34, week: 64, month: 110 });
  });

  it('aplica padding de −3 / +5 dias em torno do intervalo do cronograma', () => {
    const item = makeItem({ id: 'a', plannedStart: '2026-08-10', plannedFinish: '2026-08-20' });
    const scale = ganttScale([item], 'day', FIXED_NOW);
    // 07/08 (−3) até 25/08 (+5) = 19 ticks diários.
    expect(scale.ticks).toHaveLength(19);
    expect(scale.ticks[0].label).toBe('07');
    expect(scale.ticks[18].label).toBe('25');
    expect(scale.totalWidth).toBe(19 * 34);
  });

  it('zoom de semana alinha os ticks à segunda-feira', () => {
    const item = makeItem({ id: 'a', plannedStart: '2026-08-10', plannedFinish: '2026-08-20' });
    const scale = ganttScale([item], 'week', FIXED_NOW);
    expect(scale.ticks.every((t) => t.date.getDay() === 1)).toBe(true);
    expect(scale.ticks[0].label).toBe('03/08');
  });

  it('zoom de mês rotula em pt-BR e agrupa por ano', () => {
    const item = makeItem({ id: 'a', plannedStart: '2026-11-01', plannedFinish: '2027-02-01' });
    const scale = ganttScale([item], 'month', FIXED_NOW);
    expect(scale.ticks.map((t) => t.label)).toEqual(['out', 'nov', 'dez', 'jan', 'fev']);
    expect(scale.ticks[3].groupLabel).toBe('2027');
    expect(scale.ticks[3].groupStart).toBe(true);
  });

  it('sem datas, cai para "hoje" e respeita a largura mínima de 320px', () => {
    const scale = ganttScale([makeItem({ id: 'a' })], 'day', FIXED_NOW);
    expect(scale.totalWidth).toBeGreaterThanOrEqual(320);
  });

  it('considera actual/forecast, não só o planejado, ao calcular o intervalo', () => {
    const item = makeItem({ id: 'a', plannedStart: '2026-08-10', plannedFinish: '2026-08-12', forecastFinish: '2026-12-01' });
    const scale = ganttScale([item], 'month', FIXED_NOW);
    expect(scale.ticks[scale.ticks.length - 1].label).toBe('dez');
  });
});

describe('caracterização: ganttX / ganttBar', () => {
  const item = makeItem({ id: 'a', plannedStart: '2026-08-10', plannedFinish: '2026-08-20' });
  const scale = ganttScale([item], 'day', FIXED_NOW);

  it('ganttX devolve null para data nula', () => {
    expect(ganttX(scale, null)).toBeNull();
  });

  it('ganttX posiciona o início 3 dias (3 ticks) após a borda', () => {
    expect(ganttX(scale, '2026-08-10')).toBeCloseTo(3 * 34, 5);
  });

  it('ganttBar trata o término como INCLUSIVO (+1 dia de largura)', () => {
    const geom = ganttBar(scale, item)!;
    expect(geom.left).toBeCloseTo(3 * 34, 5);
    expect(geom.width).toBeCloseTo(11 * 34, 5); // 10→20 = 10 dias + 1 inclusivo
  });

  it('ganttBar impõe largura mínima de 6px (marco de um dia só)', () => {
    const marco = makeItem({ id: 'm', plannedStart: '2026-08-10', plannedFinish: '2026-08-10' });
    const mes = ganttScale([marco], 'month', FIXED_NOW);
    expect(ganttBar(mes, marco)!.width).toBeGreaterThanOrEqual(6);
  });

  it('ganttBar aceita item com apenas uma das duas datas', () => {
    const soFim = makeItem({ id: 's', plannedFinish: '2026-08-15' });
    expect(ganttBar(scale, soFim)).not.toBeNull();
  });

  it('ganttBar devolve null quando o item não tem data alguma', () => {
    expect(ganttBar(scale, makeItem({ id: 'n' }))).toBeNull();
  });
});
