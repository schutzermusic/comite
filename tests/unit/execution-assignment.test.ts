/**
 * P3A — intenção de atribuição no motor de casamento.
 *
 * O que estes testes protegem:
 *   1. equipe é cidadã de primeira classe (sem duplicar membro por linha);
 *   2. intenção AUMENTA confiança mas NÃO apaga evidência contrária;
 *   3. "task claim": quem executa pode não ser quem foi planejado, e os dois
 *      lados sobrevivem separados.
 */

import { describe, it, expect } from 'vitest';
import {
  matchEvidence,
  matchAll,
  computeAutonomyMetrics,
  computeAssignmentCoverage,
  MATCHING_POLICY,
  type AllocationWindow,
  type GeofenceArea,
  type MatchContext,
} from '@/lib/projects/execution-matching';
import {
  buildObservedExecution,
  resolveExecutionContext,
} from '@/lib/projects/execution-derivation';
import { fromAttendancePunch, fromTimeEntry } from '@/lib/projects/execution-evidence';
import type { TimeEntry } from '@/lib/types/people';
import { FIXED_NOW, makeItem } from './fixtures/timeline-fixtures';

const PROJECT = 'proj-1';
const JOAO = 'person-joao';
const CARLOS = 'person-carlos';
const PEDRO = 'person-pedro';
const JOAO_USER = 'user-joao';

/** Etapa aberta cobrindo 10–20/08/2026 (FIXED_NOW = 12/08). */
const openItem = (id: string, over: Partial<Parameters<typeof makeItem>[0]> = {}) =>
  makeItem({ id, status: 'in_progress', plannedStart: '2026-08-10', plannedFinish: '2026-08-20', ...over });

const allocation = (over: Partial<AllocationWindow> = {}): AllocationWindow => ({
  personId: JOAO, projectId: PROJECT, startDate: '2026-08-01', endDate: '2026-12-31',
  status: 'active', ...over,
});

const geofence = (over: Partial<GeofenceArea> = {}): GeofenceArea => ({
  id: 'gf-1', projectId: PROJECT, centerLat: -19.9, centerLng: -43.9,
  radiusMeters: 300, accuracyToleranceMeters: 0, active: true, ...over,
});

function ctx(over: Partial<MatchContext> = {}): MatchContext {
  return {
    projectId: PROJECT,
    items: [],
    allocations: [allocation()],
    geofences: [],
    userIdByPerson: new Map([[JOAO, JOAO_USER]]),
    ...over,
  };
}

const punch = (over: Partial<Parameters<typeof fromAttendancePunch>[0]> = {}) =>
  fromAttendancePunch({
    id: 'p1', personId: JOAO, type: 'clock_in',
    occurredAt: '2026-08-12T09:00:00.000Z', status: 'accepted', location: null, ...over,
  });

function entry(over: Partial<TimeEntry> & { id: string; minutes: number }): TimeEntry {
  return {
    organizationId: 'o', personId: JOAO, projectId: PROJECT, allocationId: null,
    timelineItemId: null, workDate: '2026-08-12', description: null, sourceSessionId: null,
    status: 'approved', exceptionFlags: [], autoApproved: true, submittedAt: null,
    approvedBy: null, approvedAt: null, rejectionReason: null, hourlyCostCents: null,
    costCents: null, createdAt: '', updatedAt: '', ...over,
  };
}

/** Equipe A cobre as etapas dadas, com João, Carlos e Pedro dentro. */
const teamContext = (itemIds: string[], members = [JOAO, CARLOS, PEDRO]) => ({
  teamItemsByPerson: new Map(members.map((p) => [p, new Set(itemIds)])),
  teamNameByItem: new Map(itemIds.map((id) => [id, 'Equipe Elétrica A'])),
});

describe('A — atribuição nominal do trabalhador', () => {
  it('responsável nominal em uma única etapa aberta ⇒ MATCHED de alta confiança', () => {
    const item = openItem('a', { responsibleUserId: JOAO_USER });
    const m = matchEvidence(punch(), ctx({ items: [item] }));
    expect(m.status).toBe('MATCHED');
    expect(m.reasonCodes).toContain('SINGLE_ASSIGNED_OPEN_ITEM');
    expect(m.confidence).toBeGreaterThanOrEqual(MATCHING_POLICY.autoApplyMin);
    expect(m.autoApplied).toBe(true);
  });

  it('atribuição nominal vence a atribuição por equipe', () => {
    const items = [
      openItem('a', { responsibleUserId: JOAO_USER }),
      openItem('b', { rowOrder: 2 }),
    ];
    const m = matchEvidence(punch(), ctx({ items, ...teamContext(['b']) }));
    expect(m.timelineItemId).toBe('a');
    expect(m.reasonCodes).toContain('SINGLE_ASSIGNED_OPEN_ITEM');
  });

  it('uma pessoa elegível para várias etapas nominais ⇒ AMBIGUOUS', () => {
    const items = [
      openItem('a', { responsibleUserId: JOAO_USER }),
      openItem('b', { rowOrder: 2, responsibleUserId: JOAO_USER }),
    ];
    const m = matchEvidence(punch(), ctx({ items }));
    expect(m.status).toBe('AMBIGUOUS');
    expect(m.candidates).toHaveLength(2);
  });
});

describe('B — atribuição por equipe', () => {
  it('equipe atribuída a uma etapa resolve para QUALQUER membro, sem duplicar linha', () => {
    const items = [openItem('a')];
    const base = ctx({ items, ...teamContext(['a']) });

    for (const person of [JOAO, CARLOS, PEDRO]) {
      const m = matchEvidence(punch({ id: `p-${person}`, personId: person }), {
        ...base,
        allocations: [allocation({ personId: person })],
      });
      expect(m.status).toBe('MATCHED');
      expect(m.timelineItemId).toBe('a');
      expect(m.reasonCodes).toContain('SINGLE_TEAM_OPEN_ITEM');
      expect(m.matchedTeamName).toBe('Equipe Elétrica A');
    }
  });

  it('equipe casa acima do limiar automático', () => {
    const m = matchEvidence(punch(), ctx({ items: [openItem('a')], ...teamContext(['a']) }));
    expect(m.confidence).toBeGreaterThanOrEqual(MATCHING_POLICY.autoApplyMin);
    expect(m.autoApplied).toBe(true);
  });

  it('equipe em VÁRIAS etapas abertas ⇒ AMBIGUOUS com candidatas, sem eleger', () => {
    const items = [openItem('a'), openItem('b', { rowOrder: 2 }), openItem('c', { rowOrder: 3 })];
    const m = matchEvidence(punch(), ctx({ items, ...teamContext(['a', 'b', 'c']) }));
    expect(m.status).toBe('AMBIGUOUS');
    expect(m.timelineItemId).toBeNull();
    expect(m.candidates.map((c) => c.timelineItemId).sort()).toEqual(['a', 'b', 'c']);
    expect(m.reasonCodes).toContain('MULTIPLE_TEAM_OPEN_ITEMS');
  });

  it('quem NÃO é da equipe não herda a atribuição dela', () => {
    const items = [openItem('a'), openItem('b', { rowOrder: 2 })];
    const forasteiro = 'person-externo';
    const m = matchEvidence(
      punch({ personId: forasteiro }),
      ctx({
        items,
        allocations: [allocation({ personId: forasteiro })],
        ...teamContext(['a'], [JOAO]),
      }),
    );
    // Cai para a janela do plano e, com duas etapas, fica ambíguo.
    expect(m.reasonCodes).not.toContain('SINGLE_TEAM_OPEN_ITEM');
    expect(m.status).toBe('AMBIGUOUS');
  });

  it('etapa da equipe fora da janela da data não conta', () => {
    const items = [openItem('a', { plannedStart: '2026-01-01', plannedFinish: '2026-01-10' })];
    const m = matchEvidence(punch(), ctx({ items, ...teamContext(['a']) }));
    expect(m.reasonCodes).not.toContain('SINGLE_TEAM_OPEN_ITEM');
  });

  it('etapa concluída da equipe não compete', () => {
    const items = [openItem('a', { status: 'completed' }), openItem('b', { rowOrder: 2 })];
    const m = matchEvidence(punch(), ctx({ items, ...teamContext(['a', 'b']) }));
    expect(m.status).toBe('MATCHED');
    expect(m.timelineItemId).toBe('b');
  });
});

describe('intenção NÃO apaga evidência contrária', () => {
  it('localização em outro projeto vence a atribuição planejada aqui', () => {
    const items = [openItem('a', { responsibleUserId: JOAO_USER })];
    const ev = punch({
      location: { latitude: -19.9, longitude: -43.9, accuracyMeters: 5, geofenceId: null },
    });
    const m = matchEvidence(
      ev,
      ctx({
        items,
        ...teamContext(['a']),
        // A cerca resolve para OUTRO projeto.
        geofences: [geofence({ projectId: 'proj-outro' })],
      }),
    );
    expect(m.status).toBe('UNMATCHED');
    expect(m.projectId).toBe('proj-outro');
    // O conflito é declarado, não silenciado a favor do plano.
    expect(m.reasonCodes).toContain('ASSIGNMENT_CONTRADICTS_LOCATION');
  });

  it('sem intenção local, projeto divergente não vira conflito de atribuição', () => {
    const ev = punch({
      location: { latitude: -19.9, longitude: -43.9, accuracyMeters: 5, geofenceId: null },
    });
    const m = matchEvidence(ev, ctx({ items: [openItem('a')], geofences: [geofence({ projectId: 'proj-outro' })] }));
    expect(m.reasonCodes).not.toContain('ASSIGNMENT_CONTRADICTS_LOCATION');
  });

  it('vínculo explícito continua acima de qualquer intenção de atribuição', () => {
    const items = [openItem('a'), openItem('b', { rowOrder: 2 })];
    const ev = fromTimeEntry(entry({ id: 'e1', minutes: 60, timelineItemId: 'b' }));
    const m = matchEvidence(ev, ctx({ items, ...teamContext(['a']) }));
    expect(m.timelineItemId).toBe('b');
    expect(m.reasonCodes).toEqual(['EXPLICIT_TIMELINE_LINK']);
  });
});

describe('task claim — planejado ≠ observado', () => {
  it('equipe em 3 etapas: quem executa a 2 é observado nela, sem atribuição individual prévia', () => {
    const items = [openItem('a1'), openItem('a2', { rowOrder: 2 }), openItem('a3', { rowOrder: 3 })];
    // João aponta explicitamente na a2 (vínculo forte); a equipe cobre as três.
    const evidence = [fromTimeEntry(entry({ id: 'e1', minutes: 180, timelineItemId: 'a2' }))];
    const c = ctx({ items, ...teamContext(['a1', 'a2', 'a3']) });
    const matches = matchAll(evidence, c);
    const observed = buildObservedExecution({
      items, evidence, matches, now: FIXED_NOW, autoApplyMin: MATCHING_POLICY.autoApplyMin,
    });

    const a2 = observed.get('a2')!;
    expect(a2.personIds).toEqual([JOAO]);
    expect(a2.observedHours).toBe(3);
    // Nenhuma atribuição individual foi criada — a2 não tem responsável nominal.
    expect(items[1].responsibleUserId).toBeNull();
    // E as outras etapas da equipe seguem sem execução observada.
    expect(observed.has('a1')).toBe(false);
    expect(observed.has('a3')).toBe(false);
  });

  it('executor observado diferente do responsável planejado: os dois sobrevivem', () => {
    const items = [openItem('a', { responsibleUserId: JOAO_USER })];
    // Quem realmente apontou foi o Carlos.
    const evidence = [fromTimeEntry(entry({ id: 'e1', minutes: 120, personId: CARLOS, timelineItemId: 'a' }))];
    const matches = matchAll(evidence, ctx({ items }));
    const observed = buildObservedExecution({
      items, evidence, matches, now: FIXED_NOW, autoApplyMin: MATCHING_POLICY.autoApplyMin,
    });
    // Observado: Carlos. Planejado: João. Um não apaga o outro.
    expect(observed.get('a')!.personIds).toEqual([CARLOS]);
    expect(items[0].responsibleUserId).toBe(JOAO_USER);
  });

  it('vários membros da equipe na mesma etapa aparecem todos como participantes', () => {
    const items = [openItem('a')];
    const evidence = [
      fromTimeEntry(entry({ id: 'e1', minutes: 60, personId: JOAO, timelineItemId: 'a' })),
      fromTimeEntry(entry({ id: 'e2', minutes: 60, personId: CARLOS, timelineItemId: 'a' })),
      fromTimeEntry(entry({ id: 'e3', minutes: 60, personId: PEDRO, timelineItemId: 'a' })),
    ];
    const matches = matchAll(evidence, ctx({ items, ...teamContext(['a']) }));
    const observed = buildObservedExecution({
      items, evidence, matches, now: FIXED_NOW, autoApplyMin: MATCHING_POLICY.autoApplyMin,
    });
    expect(observed.get('a')!.personIds.sort()).toEqual([CARLOS, JOAO, PEDRO].sort());
    expect(observed.get('a')!.observedHours).toBe(3);
  });
});

describe('contexto de execução resolvido', () => {
  const resolve = (items: ReturnType<typeof openItem>[], c: MatchContext, evidence = [punch()]) => {
    const matches = matchAll(evidence, c);
    return resolveExecutionContext({ personId: JOAO, items, evidence, matches, now: FIXED_NOW });
  };

  it('resolve projeto, fase, etapa e equipe para o colaborador', () => {
    const items = [
      openItem('f', { isSummary: true, title: 'Montagem Eletromecânica' }),
      openItem('a', { rowOrder: 2, parentId: 'f', title: 'Instalação de Estrutura' }),
    ];
    const c = ctx({ items, ...teamContext(['a']) });
    const r = resolve(items, c);
    expect(r.status).toBe('MATCHED');
    expect(r.projectId).toBe(PROJECT);
    expect(r.phaseTitle).toBe('Montagem Eletromecânica');
    expect(r.timelineItemTitle).toBe('Instalação de Estrutura');
    expect(r.teamName).toBe('Equipe Elétrica A');
  });

  it('sem evidência recente, não afirma nada', () => {
    const items = [openItem('a')];
    const antiga = punch({ occurredAt: '2026-08-01T09:00:00.000Z' });
    const r = resolve(items, ctx({ items, ...teamContext(['a']) }), [antiga]);
    expect(r.status).toBe('NO_EVIDENCE');
    expect(r.timelineItemId).toBeNull();
    expect(r.confidence).toBeNull();
  });

  it('ambiguidade é exposta com candidatas, não resolvida por conta própria', () => {
    const items = [openItem('a'), openItem('b', { rowOrder: 2 })];
    const r = resolve(items, ctx({ items, ...teamContext(['a', 'b']) }));
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.timelineItemId).toBeNull();
    expect(r.candidates).toHaveLength(2);
  });

  it('evidência de outra pessoa não contamina o contexto', () => {
    const items = [openItem('a')];
    const c = ctx({ items, ...teamContext(['a']) });
    const evidence = [punch({ id: 'outro', personId: CARLOS })];
    const matches = matchAll(evidence, c);
    const r = resolveExecutionContext({ personId: JOAO, items, evidence, matches, now: FIXED_NOW });
    expect(r.status).toBe('NO_EVIDENCE');
  });
});

describe('métricas de atribuição', () => {
  it('separa autonomia por INTENÇÃO e por CONTEXTO', () => {
    const items = [openItem('a')];
    const evidence = [
      // Por intenção (equipe).
      punch({ id: 'p1' }),
      // Por vínculo explícito — também é intenção declarada.
      fromTimeEntry(entry({ id: 'e1', minutes: 60, timelineItemId: 'a' })),
    ];
    const m = computeAutonomyMetrics(matchAll(evidence, ctx({ items, ...teamContext(['a']) })));
    expect(m.assignmentMatchRate).toBe(1);
    expect(m.contextualMatchRate).toBe(0);
  });

  it('casamento por janela conta como contextual, não como intenção', () => {
    const items = [openItem('a')];
    const m = computeAutonomyMetrics(matchAll([punch()], ctx({ items })));
    expect(m.contextualMatchRate).toBe(1);
    expect(m.assignmentMatchRate).toBe(0);
  });

  it('cobertura distingue nominal, equipe e sem atribuição alguma', () => {
    const items = [
      openItem('a', { responsibleUserId: JOAO_USER }),
      openItem('b', { rowOrder: 2 }),
      openItem('c', { rowOrder: 3 }),
      openItem('f', { rowOrder: 4, isSummary: true }),
      openItem('done', { rowOrder: 5, status: 'completed' }),
    ];
    const cov = computeAssignmentCoverage({
      items,
      teamItemIds: new Set(['b']),
      allocations: [allocation()],
      now: FIXED_NOW,
    });
    // Fases e concluídas ficam fora do denominador.
    expect(cov.openLeaves).toBe(3);
    expect(cov.withExplicitWorker).toBe(1);
    expect(cov.withTeam).toBe(1);
    expect(cov.withoutAnyAssignment).toBe(1);
    expect(cov.workersWithProjectContext).toBe(1);
  });

  it('alocação vencida não conta como contexto de projeto', () => {
    const cov = computeAssignmentCoverage({
      items: [],
      teamItemIds: new Set(),
      allocations: [allocation({ endDate: '2026-07-01' })],
      now: FIXED_NOW,
    });
    expect(cov.workersWithProjectContext).toBe(0);
  });
});
