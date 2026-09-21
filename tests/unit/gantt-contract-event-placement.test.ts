/**
 * ONDE a linha EVENTO DE MEDIÇÃO aparece.
 *
 * A regra é uma só: imediatamente abaixo da etapa apontada por
 * `timeline_item_id` do mapeamento ACEITO — onde quer que ela esteja na EDT.
 *
 * O erro que estes testes impedem é o agrupamento: juntar os eventos
 * contratuais numa seção, sob "Marcos gerais", ou na ordem das parcelas do
 * contrato. Agrupar destrói exatamente a informação que a tela existe para
 * dar — que ESTA atividade, no meio da montagem, destrava uma parcela.
 */
import { describe, it, expect } from 'vitest';
import { buildTree, flattenTree } from '@/lib/projects/timeline-analytics';
import { buildGanttRenderRows } from '@/lib/projects/gantt-render-rows';
import { governedEventsByTimelineItem, type ProjectContractEvent }
  from '@/lib/projects/contract-events';
import type { TimelineItem } from '@/lib/types/project-timeline';

// ── Um cronograma com a forma do real: marcos no 1.1, obra espalhada ──────
const SCHEDULE: [string, string, number, string | null][] = [
  ['0',     'Projeto',                              0, null],
  ['1',     'Marcos',                               1, '0'],
  ['1.1',   'Marcos gerais',                        2, '1'],
  ['1.1.1', 'Assinatura do contrato',               3, '1.1'],
  ['1.1.2', 'Transporte do equipamento',            3, '1.1'],
  ['5',     'Serviços em campo (MONTAGEM)',         1, '0'],
  ['5.2',   'Bobinagem do estator',                 2, '5'],
  ['5.2.2', 'Cunhagem e Amarrações',                3, '5.2'],
  ['5.5',   'Databook',                             2, '5'],
];

const item = (wbs: string, title: string, level: number, parent: string | null): TimelineItem => ({
  id: `t-${wbs}`,
  projectId: 'proj-1',
  parentId: parent ? `t-${parent}` : null,
  importBatchId: 'imp-1',
  originalMsProjectId: wbs,
  wbsCode: wbs,
  outlineLevel: level,
  rowOrder: SCHEDULE.findIndex((r) => r[0] === wbs),
  type: 'task',
  title,
  plannedStart: '2025-11-01',
  plannedFinish: '2025-11-30',
  durationMinutes: 480,
  percentComplete: 0,
  status: 'not_started',
  isSummary: false,
  isMilestone: false,
  isActive: true,
  deletedAt: null,
} as unknown as TimelineItem);

const ITEMS = SCHEDULE.map(([w, t, l, p]) => item(w, t, l, p));

const event = (milestoneId: string, timelineItemId: string): ProjectContractEvent => ({
  linkState: 'ACCEPTED',
  ruleId: `r-${milestoneId}`,
  mappingId: `m-${milestoneId}`,
  mappingSource: 'explicit',
  reviewState: 'accepted',
  confidence: null, note: null, mappedAt: null, reviewedAt: null,
  proposedTimelineItemId: null, proposedTimelineTitle: null,
  proposedTimelineWbsCode: null, proposedTimelineFinish: null,
  ambiguousAlternatives: [],
  mappedTimelineItemId: timelineItemId, mappedTimelineTitle: 'etapa',
  mappedTimelineWbsCode: null, mappedTimelineIsActive: true,
  canViewValues: true, generatesBilling: true,
  contractTotalValue: null, contractPercent: null,
  plan: {
    milestoneId, timelineItemId, governedMappingCount: 1,
    title: `Evento ${milestoneId}`,
  } as ProjectContractEvent['plan'],
});

const render = (events: readonly ProjectContractEvent[]) =>
  buildGanttRenderRows(
    flattenTree(buildTree(ITEMS), new Set()),
    governedEventsByTimelineItem(events),
  );

const label = (rows: ReturnType<typeof render>) =>
  rows.map((r) => (r.kind === 'activity' ? r.node.item.wbsCode : `↳ ${r.event.plan.milestoneId}`));

describe('posição da linha derivada', () => {
  it('cai imediatamente abaixo da etapa vinculada', () => {
    const rows = render([event('A', 't-1.1.2')]);
    const i = rows.findIndex((r) => r.kind === 'activity' && r.node.item.id === 't-1.1.2');
    expect(rows[i + 1]).toMatchObject({ kind: 'event', parentItemId: 't-1.1.2' });
  });

  it('segue a etapa onde quer que ela esteja na EDT — sem agrupar', () => {
    // Três eventos, três ramos diferentes. Se houvesse agrupamento, os três
    // apareceriam juntos em algum ponto da lista.
    const rows = label(render([
      event('A', 't-1.1.2'), event('B', 't-5.2.2'), event('C', 't-5.5'),
    ]));
    expect(rows).toEqual([
      '0', '1', '1.1', '1.1.1',
      '1.1.2', '↳ A',
      '5', '5.2', '5.2.2', '↳ B',
      '5.5', '↳ C',
    ]);
  });

  it('não agrupa sob "Marcos gerais"', () => {
    const rows = render([event('B', 't-5.2.2')]);
    const marcosGerais = rows.findIndex((r) => r.kind === 'activity' && r.node.item.wbsCode === '1.1');
    expect(rows[marcosGerais + 1]).toMatchObject({ kind: 'activity' });
    const evt = rows.find((r) => r.kind === 'event')!;
    expect(evt).toMatchObject({ parentItemId: 't-5.2.2' });
  });

  it('não usa a ordem contratual: o marco 01 aparece depois do 06 se a obra mandar', () => {
    // Marco 01 vinculado a uma etapa TARDIA, marco 06 a uma etapa CEDO.
    const rows = label(render([event('01', 't-5.5'), event('06', 't-1.1.1')]));
    expect(rows.indexOf('↳ 06')).toBeLessThan(rows.indexOf('↳ 01'));
  });

  it('uma etapa que sustenta dois marcos recebe as duas linhas, em sequência', () => {
    const rows = label(render([event('A', 't-1.1.2'), event('B', 't-1.1.2')]));
    const i = rows.indexOf('1.1.2');
    expect(rows.slice(i, i + 3)).toEqual(['1.1.2', '↳ A', '↳ B']);
  });

  it('sem eventos, a lista é exatamente a das atividades', () => {
    expect(label(render([]))).toEqual(SCHEDULE.map(([w]) => w));
  });
});

describe('o que NÃO entra no corpo do cronograma', () => {
  const pending = (state: 'PROPOSED' | 'AMBIGUOUS' | 'UNMATCHED'): ProjectContractEvent => ({
    ...event('X', 't-1.1.2'),
    linkState: state,
    reviewState: state === 'UNMATCHED' ? null : 'proposed',
  });

  it.each(['PROPOSED', 'AMBIGUOUS', 'UNMATCHED'] as const)(
    '%s não vira linha derivada — palpite desenhado entre atividades vira fato',
    (state) => {
      expect(render([pending(state)]).every((r) => r.kind === 'activity')).toBe(true);
    },
  );
});

describe('a linha derivada não desloca as setas de dependência', () => {
  it('o índice de cada atividade conta as linhas derivadas acima dela', () => {
    /*
      O Gantt posiciona as setas por índice de linha. Se a sobreposição
      ocupasse altura sem existir na lista, toda seta abaixo dela apontaria
      para o lugar errado — por isso ela é uma linha, e não um bloco dentro
      da atividade.
    */
    const rows = render([event('A', 't-1.1.1')]);
    const idx = new Map<string, number>();
    rows.forEach((r, i) => { if (r.kind === 'activity') idx.set(r.node.item.id, i); });
    expect(idx.get('t-1.1.1')).toBe(3);
    // A etapa seguinte desce uma linha por causa da sobreposição acima dela.
    expect(idx.get('t-1.1.2')).toBe(5);
  });
});
