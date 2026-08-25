/**
 * Derivação de execução observada e geração de exceções.
 *
 * A linha que estes testes defendem: evidência vira FATO OBSERVADO e, no
 * máximo, PROPOSTA. Nunca vira `% de progresso`. Presença não é avanço físico.
 */

import { describe, it, expect } from 'vitest';
import {
  buildObservedExecution,
  buildExecutionExceptions,
  SILENT_ITEM_DAYS,
  type ObservedExecution,
} from '@/lib/projects/execution-derivation';
import { matchAll, MATCHING_POLICY, type MatchContext } from '@/lib/projects/execution-matching';
import {
  fromTimeEntry,
  fromAttendancePunch,
  type ExecutionEvidence,
} from '@/lib/projects/execution-evidence';
import type { TimeEntry } from '@/lib/types/people';
import { FIXED_NOW, makeItem } from './fixtures/timeline-fixtures';

const PROJECT = 'proj-1';
const PERSON = 'person-1';
const USER = 'user-1';

const openItem = (id: string, over: Partial<Parameters<typeof makeItem>[0]> = {}) =>
  makeItem({ id, status: 'in_progress', plannedStart: '2026-08-10', plannedFinish: '2026-08-20', ...over });

const ctx = (items: ReturnType<typeof openItem>[]): MatchContext => ({
  projectId: PROJECT, items, allocations: [], geofences: [],
  userIdByPerson: new Map([[PERSON, USER]]),
});

function entry(over: Partial<TimeEntry> & { id: string; minutes: number }): TimeEntry {
  return {
    organizationId: 'o', personId: PERSON, projectId: PROJECT, allocationId: null,
    timelineItemId: 'a', workDate: '2026-08-12', description: null, sourceSessionId: null,
    status: 'approved', exceptionFlags: [], autoApproved: true, submittedAt: null,
    approvedBy: null, approvedAt: null, rejectionReason: null, hourlyCostCents: null,
    costCents: null, createdAt: '', updatedAt: '', ...over,
  };
}

const punch = (over: Partial<Parameters<typeof fromAttendancePunch>[0]> = {}) =>
  fromAttendancePunch({
    id: 'p1', personId: PERSON, type: 'clock_in',
    occurredAt: '2026-08-12T09:00:00.000Z', status: 'accepted', location: null, ...over,
  });

function observe(items: ReturnType<typeof openItem>[], evidence: ExecutionEvidence[]) {
  const matches = matchAll(evidence, ctx(items));
  const observed = buildObservedExecution({
    items, evidence, matches, now: FIXED_NOW, autoApplyMin: MATCHING_POLICY.autoApplyMin,
  });
  return { matches, observed };
}

describe('execução observada', () => {
  it('soma apenas evidência que MEDE tempo', () => {
    const items = [openItem('a')];
    const evidence = [
      fromTimeEntry(entry({ id: 'e1', minutes: 120 })),
      // Batida não tem duração: entra como evidência, não como hora.
      { ...punch(), timelineItemId: 'a' } as ExecutionEvidence,
    ];
    const { observed } = observe(items, evidence);
    const obs = observed.get('a')!;
    expect(obs.observedHours).toBe(2);
    expect(obs.evidenceCount).toBe(2);
    expect(obs.sources.sort()).toEqual(['attendance_punch', 'time_entry']);
  });

  it('etapa sem evidência que meça tempo tem observedHours null, não 0', () => {
    const items = [openItem('a')];
    const { observed } = observe(items, [{ ...punch(), timelineItemId: 'a' } as ExecutionEvidence]);
    expect(observed.get('a')!.observedHours).toBeNull();
  });

  it('registra primeira e última evidência e quem participou', () => {
    const items = [openItem('a')];
    const evidence = [
      fromTimeEntry(entry({ id: 'e1', minutes: 60, workDate: '2026-08-11' })),
      fromTimeEntry(entry({ id: 'e2', minutes: 60, workDate: '2026-08-14', personId: 'person-2' })),
    ];
    const obs = observe(items, evidence).observed.get('a')!;
    expect(obs.firstEvidenceAt).toBe('2026-08-11T12:00:00');
    expect(obs.lastEvidenceAt).toBe('2026-08-14T12:00:00');
    expect(obs.personIds.sort()).toEqual(['person-1', 'person-2']);
  });

  it('activeToday reflete evidência com a data de hoje', () => {
    const items = [openItem('a')];
    const hoje = observe(items, [fromTimeEntry(entry({ id: 'e1', minutes: 60, workDate: '2026-08-12' }))]);
    expect(hoje.observed.get('a')!.activeToday).toBe(true);
    const ontem = observe(items, [fromTimeEntry(entry({ id: 'e2', minutes: 60, workDate: '2026-08-11' }))]);
    expect(ontem.observed.get('a')!.activeToday).toBe(false);
  });

  it('evidência NÃO casada não entra em etapa nenhuma', () => {
    const items = [openItem('a')];
    // Sem projeto/pessoa resolvível: fica de fora.
    const { observed } = observe(items, [punch({ id: 'orfa' })]);
    expect(observed.size).toBe(0);
  });

  it('conta evidência casada abaixo do limiar como não resolvida', () => {
    const items = [openItem('a', { responsibleUserId: USER })];
    const evidence = [fromTimeEntry(entry({ id: 'e1', minutes: 60 }))];
    const obs = observe(items, evidence).observed.get('a')!;
    // Vínculo explícito ⇒ confiança 1 ⇒ nada pendente.
    expect(obs.matchConfidence).toBe(1);
    expect(obs.unresolvedEvidence).toBe(0);
  });
});

describe('propostas — sugestão, nunca escrita', () => {
  it('propõe início real quando a etapa ainda não tem um', () => {
    const items = [openItem('a', { actualStart: null })];
    const obs = observe(items, [fromTimeEntry(entry({ id: 'e1', minutes: 60, workDate: '2026-08-11' }))])
      .observed.get('a')!;
    expect(obs.proposedActualStart).toBe('2026-08-11');
  });

  it('NÃO propõe início quando a etapa já tem data real registrada', () => {
    const items = [openItem('a', { actualStart: '2026-08-01' })];
    const obs = observe(items, [fromTimeEntry(entry({ id: 'e1', minutes: 60 }))]).observed.get('a')!;
    expect(obs.proposedActualStart).toBeNull();
  });

  it('só propõe término quando a etapa já foi dada como concluída', () => {
    const aberta = observe([openItem('a')], [fromTimeEntry(entry({ id: 'e1', minutes: 60 }))]);
    expect(aberta.observed.get('a')!.proposedActualFinish).toBeNull();

    const concluida = observe(
      [openItem('a', { status: 'completed' })],
      [fromTimeEntry(entry({ id: 'e1', minutes: 60 }))],
    );
    expect(concluida.observed.get('a')!.proposedActualFinish).toBe('2026-08-12');
  });

  it('a derivação nunca produz percentual de progresso', () => {
    const items = [openItem('a', { percentComplete: 0 })];
    const obs: ObservedExecution = observe(items, [fromTimeEntry(entry({ id: 'e1', minutes: 600 }))])
      .observed.get('a')!;
    // Nenhum campo de progresso existe no modelo observado — por desenho.
    expect(Object.keys(obs)).not.toContain('percentComplete');
    expect(Object.keys(obs)).not.toContain('progress');
  });
});

describe('exceções', () => {
  const build = (
    items: ReturnType<typeof openItem>[],
    evidence: ExecutionEvidence[],
    predecessors?: Map<string, string[]>,
  ) => {
    const { matches, observed } = observe(items, evidence);
    return buildExecutionExceptions({
      items, evidence, matches, observed,
      predecessorsByItem: predecessors, now: FIXED_NOW,
    });
  };

  it('evidência ambígua vira exceção de alta severidade com candidatas', () => {
    const items = [
      openItem('a', { responsibleUserId: USER }),
      openItem('b', { rowOrder: 2, responsibleUserId: USER }),
    ];
    const c: MatchContext = { ...ctx(items), allocations: [
      { personId: PERSON, projectId: PROJECT, startDate: '2026-08-01', endDate: null, status: 'active' },
    ] };
    const evidence = [punch()];
    const matches = matchAll(evidence, c);
    const observed = buildObservedExecution({
      items, evidence, matches, now: FIXED_NOW, autoApplyMin: MATCHING_POLICY.autoApplyMin,
    });
    const ex = buildExecutionExceptions({ items, evidence, matches, observed, now: FIXED_NOW });
    const ambiguous = ex.find((e) => e.type === 'ambiguous_match')!;
    expect(ambiguous.severity).toBe('high');
    expect(ambiguous.candidates).toHaveLength(2);
  });

  it('horas sem etapa identificável viram exceção', () => {
    const items = [openItem('a')];
    // Lançamento sem etapa e sem contexto que resolva.
    const orfa = fromTimeEntry(entry({ id: 'e1', minutes: 180, timelineItemId: null, workDate: '2026-09-15' }));
    const ex = build(items, [orfa]);
    expect(ex.some((e) => e.type === 'hours_without_task')).toBe(true);
  });

  it('evidência SEM duração não vira exceção de "horas sem etapa"', () => {
    const items = [openItem('a')];
    const ex = build(items, [punch({ id: 'sem-hora' })]);
    expect(ex.some((e) => e.type === 'hours_without_task')).toBe(false);
  });

  it('execução fora da janela planejada é sinalizada', () => {
    const items = [openItem('a', { plannedStart: '2026-08-01', plannedFinish: '2026-08-05' })];
    const ex = build(items, [fromTimeEntry(entry({ id: 'e1', minutes: 60, workDate: '2026-08-12' }))]);
    const fora = ex.find((e) => e.type === 'evidence_outside_window')!;
    expect(fora.severity).toBe('medium');
    expect(fora.itemId).toBe('a');
  });

  it('trabalho registrado sem progresso vira exceção', () => {
    const items = [openItem('a', { percentComplete: 0 })];
    const ex = build(items, [fromTimeEntry(entry({ id: 'e1', minutes: 300 }))]);
    expect(ex.some((e) => e.type === 'evidence_without_progress')).toBe(true);
  });

  it('etapa com progresso não gera exceção de "sem progresso"', () => {
    const items = [openItem('a', { percentComplete: 20 })];
    const ex = build(items, [fromTimeEntry(entry({ id: 'e1', minutes: 300 }))]);
    expect(ex.some((e) => e.type === 'evidence_without_progress')).toBe(false);
  });

  it('execução antes da predecessora concluir é sinalizada', () => {
    const items = [openItem('a'), openItem('pred', { rowOrder: 2, status: 'in_progress' })];
    const ex = build(items, [fromTimeEntry(entry({ id: 'e1', minutes: 60 }))], new Map([['a', ['pred']]]));
    expect(ex.some((e) => e.type === 'work_before_predecessor')).toBe(true);
  });

  it('predecessora concluída não gera exceção', () => {
    const items = [openItem('a'), openItem('pred', { rowOrder: 2, status: 'completed' })];
    const ex = build(items, [fromTimeEntry(entry({ id: 'e1', minutes: 60 }))], new Map([['a', ['pred']]]));
    expect(ex.some((e) => e.type === 'work_before_predecessor')).toBe(false);
  });

  it('etapa em janela ativa e sem evidência alguma vira exceção de silêncio', () => {
    const items = [openItem('a')];
    const ex = build(items, []);
    const silent = ex.find((e) => e.type === 'expected_active_but_silent')!;
    expect(silent.severity).toBe('low');
    expect(silent.itemId).toBe('a');
  });

  it('etapa com evidência recente NÃO é cobrada de silêncio', () => {
    const items = [openItem('a')];
    const ex = build(items, [fromTimeEntry(entry({ id: 'e1', minutes: 60, workDate: '2026-08-12' }))]);
    expect(ex.some((e) => e.type === 'expected_active_but_silent')).toBe(false);
  });

  it('evidência antiga além do limite volta a ser silêncio', () => {
    const items = [openItem('a')];
    const antiga = new Date(FIXED_NOW.getTime() - (SILENT_ITEM_DAYS + 3) * 86400000)
      .toISOString().slice(0, 10);
    const ex = build(items, [fromTimeEntry(entry({ id: 'e1', minutes: 60, workDate: antiga }))]);
    expect(ex.some((e) => e.type === 'expected_active_but_silent')).toBe(true);
  });

  it('etapa com janela ainda no futuro não é cobrada', () => {
    const items = [openItem('a', { plannedStart: '2026-12-01', plannedFinish: '2026-12-20' })];
    expect(build(items, []).some((e) => e.type === 'expected_active_but_silent')).toBe(false);
  });

  it('fases e etapas concluídas não entram no silêncio', () => {
    const items = [
      openItem('f', { isSummary: true }),
      openItem('c', { rowOrder: 2, status: 'completed' }),
    ];
    expect(build(items, []).some((e) => e.type === 'expected_active_but_silent')).toBe(false);
  });

  it('ordena por severidade e é determinístico', () => {
    const items = [openItem('a', { percentComplete: 0, plannedStart: '2026-08-01', plannedFinish: '2026-08-05' })];
    const evidence = [
      fromTimeEntry(entry({ id: 'e1', minutes: 60, workDate: '2026-08-12' })),
      fromTimeEntry(entry({ id: 'e2', minutes: 60, timelineItemId: null, workDate: '2026-09-15' })),
    ];
    const run = () => build(items, evidence).map((e) => e.id);
    const first = run();
    expect(run()).toEqual(first);
    const sev = build(items, evidence).map((e) => e.severity);
    expect(sev).toEqual([...sev].sort((a, b) =>
      ({ high: 0, medium: 1, low: 2 })[a] - ({ high: 0, medium: 1, low: 2 })[b]));
  });
});
