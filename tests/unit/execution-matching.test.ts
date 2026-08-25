/**
 * Motor de casamento de evidência → projeto → etapa.
 *
 * O que estes testes protegem é a RECUSA: o motor precisa devolver AMBIGUOUS ou
 * UNMATCHED quando a evidência não basta, em vez de escolher um candidato
 * plausível. Um motor que sempre casa alguma coisa fabrica dado — e dado
 * fabricado em cronograma vira decisão errada de obra.
 */

import { describe, it, expect } from 'vitest';
import {
  matchEvidence,
  matchAll,
  computeAutonomyMetrics,
  haversineMeters,
  formatRate,
  MATCHING_POLICY,
  EMPTY_AUTONOMY,
  type AllocationWindow,
  type GeofenceArea,
  type MatchContext,
} from '@/lib/projects/execution-matching';
import {
  fromTimeEntry,
  fromAttendancePunch,
  fromDailyAllowance,
  fromProjectDocument,
  fromWorkSession,
  sortEvidence,
  type ExecutionEvidence,
} from '@/lib/projects/execution-evidence';
import type { TimeEntry, ProjectWorkSession } from '@/lib/types/people';
import { FIXED_NOW, makeItem } from './fixtures/timeline-fixtures';

const PROJECT = 'proj-1';
const PERSON = 'person-1';
const USER = 'user-1';

/** Etapa aberta cobrindo 10–20/08/2026. */
const openItem = (id: string, over: Partial<Parameters<typeof makeItem>[0]> = {}) =>
  makeItem({
    id, status: 'in_progress', plannedStart: '2026-08-10', plannedFinish: '2026-08-20', ...over,
  });

function ctx(over: Partial<MatchContext> = {}): MatchContext {
  return {
    projectId: PROJECT,
    items: [],
    allocations: [],
    geofences: [],
    userIdByPerson: new Map([[PERSON, USER]]),
    ...over,
  };
}

function entry(over: Partial<TimeEntry> & { id: string; minutes: number }): TimeEntry {
  return {
    organizationId: 'o', personId: PERSON, projectId: PROJECT, allocationId: null,
    timelineItemId: null, workDate: '2026-08-12', description: null, sourceSessionId: null,
    status: 'approved', exceptionFlags: [], autoApproved: true, submittedAt: null,
    approvedBy: null, approvedAt: null, rejectionReason: null, hourlyCostCents: null,
    costCents: null, createdAt: '', updatedAt: '', ...over,
  };
}

const punch = (over: Partial<Parameters<typeof fromAttendancePunch>[0]> = {}) =>
  fromAttendancePunch({
    id: 'punch-1', personId: PERSON, type: 'clock_in',
    occurredAt: '2026-08-12T09:00:00.000Z', status: 'accepted', location: null, ...over,
  });

const allocation = (over: Partial<AllocationWindow> = {}): AllocationWindow => ({
  personId: PERSON, projectId: PROJECT, startDate: '2026-08-01', endDate: '2026-12-31',
  status: 'active', ...over,
});

const geofence = (over: Partial<GeofenceArea> = {}): GeofenceArea => ({
  id: 'gf-1', projectId: PROJECT, centerLat: -19.9, centerLng: -43.9,
  radiusMeters: 300, accuracyToleranceMeters: 0, active: true, ...over,
});

describe('vínculo explícito — o caminho de maior confiança', () => {
  it('time_entry com timeline_item_id casa com confiança 1 e aplica sozinho', () => {
    const item = openItem('a');
    const ev = fromTimeEntry(entry({ id: 'e1', minutes: 60, timelineItemId: 'a' }));
    const m = matchEvidence(ev, ctx({ items: [item] }));
    expect(m.status).toBe('MATCHED');
    expect(m.confidence).toBe(1);
    expect(m.reasonCodes).toEqual(['EXPLICIT_TIMELINE_LINK']);
    expect(m.autoApplied).toBe(true);
    expect(m.timelineItemId).toBe('a');
  });

  it('documento com etapa explícita também casa, mesmo sem pessoa', () => {
    const item = openItem('a');
    const ev = fromProjectDocument({
      id: 'd1', projectId: PROJECT, timelineItemId: 'a', fileName: 'ART.pdf',
      createdAt: '2026-08-12T10:00:00.000Z',
    });
    const m = matchEvidence(ev, ctx({ items: [item] }));
    expect(m.status).toBe('MATCHED');
    expect(m.personId).toBeNull();
  });

  it('vínculo apontando para etapa desativada NÃO casa às cegas', () => {
    const item = openItem('a', { isActive: false });
    const ev = fromTimeEntry(entry({ id: 'e1', minutes: 60, timelineItemId: 'a' }));
    const m = matchEvidence(ev, ctx({ items: [item] }));
    expect(m.status).not.toBe('MATCHED');
  });

  it('registro cancelado na origem não é evidência', () => {
    const ev = punch({ status: 'cancelled' });
    const m = matchEvidence(ev, ctx({ items: [openItem('a')], allocations: [allocation()] }));
    expect(m.status).toBe('UNMATCHED');
    expect(m.reasonCodes).toEqual(['EVIDENCE_INVALID']);
  });

  it('sessão descartada não é evidência', () => {
    const session: ProjectWorkSession = {
      id: 's1', organizationId: 'o', personId: PERSON, projectId: PROJECT, allocationId: null,
      timelineItemId: 'a', startedAt: '2026-08-12T09:00:00.000Z', endedAt: null,
      durationMinutes: null, description: null, source: 'web_timer', status: 'discarded',
      timeEntryId: null, createdAt: '', updatedAt: '',
    };
    expect(matchEvidence(fromWorkSession(session), ctx({ items: [openItem('a')] })).status)
      .toBe('UNMATCHED');
  });
});

describe('resolução de projeto', () => {
  it('sem projeto explícito, sem cerca e sem alocação ⇒ UNMATCHED', () => {
    const m = matchEvidence(punch(), ctx({ items: [openItem('a')] }));
    expect(m.status).toBe('UNMATCHED');
    expect(m.reasonCodes).toContain('NO_PROJECT_CONTEXT');
    expect(m.projectId).toBeNull();
  });

  it('alocação única vigente resolve o projeto', () => {
    const m = matchEvidence(punch(), ctx({ items: [openItem('a')], allocations: [allocation()] }));
    expect(m.reasonCodes).toContain('SINGLE_ACTIVE_ALLOCATION');
    expect(m.projectId).toBe(PROJECT);
  });

  it('alocação que NÃO cobre a data não dá contexto', () => {
    const m = matchEvidence(
      punch(),
      ctx({ items: [openItem('a')], allocations: [allocation({ startDate: '2026-09-01' })] }),
    );
    expect(m.reasonCodes).toContain('NO_PROJECT_CONTEXT');
  });

  it('duas alocações na mesma data ⇒ não escolhe projeto', () => {
    const m = matchEvidence(
      punch(),
      ctx({
        items: [openItem('a')],
        allocations: [allocation(), allocation({ projectId: 'proj-2' })],
      }),
    );
    expect(m.status).toBe('UNMATCHED');
    expect(m.reasonCodes).toContain('MULTIPLE_ACTIVE_ALLOCATIONS');
  });

  it('coordenada DENTRO da cerca resolve o projeto geometricamente', () => {
    const ev = punch({
      location: { latitude: -19.9005, longitude: -43.9, accuracyMeters: 10, geofenceId: null },
    });
    const m = matchEvidence(ev, ctx({ items: [openItem('a')], geofences: [geofence()] }));
    expect(m.reasonCodes).toContain('GEOFENCE_CONTAINMENT');
    expect(m.projectId).toBe(PROJECT);
  });

  it('coordenada FORA da cerca não inventa projeto', () => {
    // ~11 km de distância — o caso real do banco hoje.
    const ev = punch({
      location: { latitude: -20.0, longitude: -43.9, accuracyMeters: 46, geofenceId: null },
    });
    const m = matchEvidence(ev, ctx({ items: [openItem('a')], geofences: [geofence()] }));
    expect(m.status).toBe('UNMATCHED');
    expect(m.reasonCodes).toContain('GEOFENCE_OUT_OF_RANGE');
    expect(m.reasonCodes).toContain('NO_PROJECT_CONTEXT');
  });

  it('cerca inativa é ignorada', () => {
    const ev = punch({
      location: { latitude: -19.9, longitude: -43.9, accuracyMeters: 5, geofenceId: null },
    });
    const m = matchEvidence(ev, ctx({ items: [openItem('a')], geofences: [geofence({ active: false })] }));
    expect(m.projectId).toBeNull();
  });

  it('evidência de OUTRO projeto não entra no cronograma em foco', () => {
    const ev = fromDailyAllowance({
      id: 'a1', personId: PERSON, projectId: 'proj-outro',
      allowanceDate: '2026-08-12', status: 'approved',
    });
    const m = matchEvidence(ev, ctx({ items: [openItem('a')] }));
    expect(m.status).toBe('UNMATCHED');
    expect(m.projectId).toBe('proj-outro');
  });
});

describe('resolução de etapa', () => {
  const withProject = (items: ReturnType<typeof openItem>[]) =>
    ctx({ items, allocations: [allocation()] });

  it('uma única etapa atribuída à pessoa ⇒ MATCHED de alta confiança', () => {
    const item = openItem('a', { responsibleUserId: USER });
    const m = matchEvidence(punch(), withProject([item]));
    expect(m.status).toBe('MATCHED');
    expect(m.reasonCodes).toContain('SINGLE_ASSIGNED_OPEN_ITEM');
    expect(m.timelineItemId).toBe('a');
  });

  it('duas etapas atribuídas à mesma pessoa ⇒ AMBIGUOUS com candidatas', () => {
    const items = [
      openItem('a', { responsibleUserId: USER }),
      openItem('b', { rowOrder: 2, responsibleUserId: USER }),
    ];
    const m = matchEvidence(punch(), withProject(items));
    expect(m.status).toBe('AMBIGUOUS');
    expect(m.timelineItemId).toBeNull();
    expect(m.confidence).toBe(0);
    expect(m.candidates.map((c) => c.timelineItemId).sort()).toEqual(['a', 'b']);
    expect(m.reasonCodes).toContain('MULTIPLE_ASSIGNED_OPEN_ITEMS');
  });

  it('sem atribuição, uma única etapa na janela casa com confiança BAIXA', () => {
    const m = matchEvidence(punch(), withProject([openItem('a')]));
    expect(m.status).toBe('MATCHED');
    expect(m.reasonCodes).toContain('SINGLE_ITEM_IN_WINDOW');
    // Fica ABAIXO do limiar automático: vira sugestão, não verdade.
    expect(m.confidence).toBeLessThan(MATCHING_POLICY.autoApplyMin);
    expect(m.autoApplied).toBe(false);
  });

  it('várias etapas na janela ⇒ AMBIGUOUS', () => {
    const items = [openItem('a'), openItem('b', { rowOrder: 2 })];
    const m = matchEvidence(punch(), withProject(items));
    expect(m.status).toBe('AMBIGUOUS');
    expect(m.reasonCodes).toContain('MULTIPLE_ITEMS_IN_WINDOW');
  });

  it('nenhuma etapa cobre a data ⇒ UNMATCHED e execução fora do plano', () => {
    // Dentro da alocação (ago–dez), fora da janela da etapa (10–20/08).
    const m = matchEvidence(
      punch({ occurredAt: '2026-09-15T09:00:00.000Z' }),
      withProject([openItem('a')]),
    );
    expect(m.status).toBe('UNMATCHED');
    expect(m.reasonCodes).toContain('NO_ITEM_IN_WINDOW');
    expect(m.reasonCodes).toContain('OUTSIDE_ANY_PLANNED_WINDOW');
  });

  it('etapas concluídas não competem pela evidência', () => {
    const items = [openItem('a'), openItem('b', { rowOrder: 2, status: 'completed' })];
    const m = matchEvidence(punch(), withProject(items));
    expect(m.status).toBe('MATCHED');
    expect(m.timelineItemId).toBe('a');
  });

  it('fases (resumo) nunca recebem evidência diretamente', () => {
    const items = [openItem('f', { isSummary: true }), openItem('a', { rowOrder: 2 })];
    const m = matchEvidence(punch(), withProject(items));
    expect(m.timelineItemId).toBe('a');
  });

  it('evidência sem pessoa e sem etapa explícita não casa etapa', () => {
    const ev = fromDailyAllowance({
      id: 'a1', personId: '', projectId: PROJECT, allowanceDate: '2026-08-12', status: 'approved',
    });
    const m = matchEvidence({ ...ev, personId: null }, withProject([openItem('a')]));
    expect(m.status).toBe('UNMATCHED');
    expect(m.reasonCodes).toContain('NO_PERSON_CONTEXT');
  });

  it('sem ponte pessoa→usuário, a regra de atribuição não se aplica', () => {
    const item = openItem('a', { responsibleUserId: USER });
    const m = matchEvidence(punch(), ctx({
      items: [item], allocations: [allocation()], userIdByPerson: new Map(),
    }));
    // Cai para a janela do plano, com confiança menor — não chuta a atribuição.
    expect(m.reasonCodes).toContain('SINGLE_ITEM_IN_WINDOW');
  });
});

describe('haversine', () => {
  it('distância zero para o mesmo ponto', () => {
    expect(haversineMeters(-19.9, -43.9, -19.9, -43.9)).toBeCloseTo(0, 3);
  });

  it('~111 km por grau de latitude', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeGreaterThan(110_000);
    expect(haversineMeters(0, 0, 1, 0)).toBeLessThan(112_000);
  });
});

describe('métricas de autonomia', () => {
  it('sem evidência, TODAS as taxas são null — não 0%', () => {
    expect(computeAutonomyMetrics([])).toEqual(EMPTY_AUTONOMY);
    expect(computeAutonomyMetrics([]).autonomyRate).toBeNull();
    expect(formatRate(null)).toBe('—');
  });

  it('taxas refletem a mistura de estados', () => {
    const items = [openItem('a', { responsibleUserId: USER })];
    const evidences: ExecutionEvidence[] = [
      // MATCHED automático (vínculo explícito)
      fromTimeEntry(entry({ id: 'e1', minutes: 60, timelineItemId: 'a' })),
      // MATCHED de baixa confiança (janela) — exige humano
      punch({ id: 'p1' }),
      // UNMATCHED (sem contexto de projeto)
      punch({ id: 'p2', occurredAt: '2026-09-15T09:00:00.000Z' }),
    ];
    const c = ctx({ items: [openItem('a')], allocations: [allocation()] });
    const metrics = computeAutonomyMetrics(matchAll(evidences, c));

    expect(metrics.totalEvidence).toBe(3);
    expect(metrics.matchRate).toBeCloseTo(2 / 3, 2);
    expect(metrics.autoMatchRate).toBeCloseTo(1 / 3, 2);
    expect(metrics.unmatchedRate).toBeCloseTo(1 / 3, 2);
    // 1 casado abaixo do limiar ⇒ decisão humana.
    expect(metrics.needingHuman).toBe(1);
    expect(metrics.autonomyRate).toBeCloseTo(1 / 3, 2);
    expect(items).toHaveLength(1);
  });

  it('ambíguas contam como intervenção humana', () => {
    const c = ctx({
      items: [openItem('a', { responsibleUserId: USER }), openItem('b', { rowOrder: 2, responsibleUserId: USER })],
      allocations: [allocation()],
    });
    const metrics = computeAutonomyMetrics(matchAll([punch()], c));
    expect(metrics.ambiguousRate).toBe(1);
    expect(metrics.needingHuman).toBe(1);
    expect(metrics.autonomyRate).toBe(0);
  });

  it('formatRate arredonda para percentual inteiro', () => {
    expect(formatRate(0.666)).toBe('67%');
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(0)).toBe('0%');
  });
});

describe('ordenação de evidência', () => {
  it('mais recente primeiro, com desempate estável', () => {
    const a = punch({ id: 'p1', occurredAt: '2026-08-10T09:00:00.000Z' });
    const b = punch({ id: 'p2', occurredAt: '2026-08-12T09:00:00.000Z' });
    const c = punch({ id: 'p3', occurredAt: '2026-08-12T09:00:00.000Z' });
    const sorted = sortEvidence([a, b, c]).map((e) => e.id);
    expect(sorted[0]).toBe('attendance_punch:p2');
    expect(sorted[2]).toBe('attendance_punch:p1');
    expect(sortEvidence([a, b, c]).map((e) => e.id)).toEqual(sorted);
    expect(FIXED_NOW).toBeInstanceOf(Date);
  });
});
