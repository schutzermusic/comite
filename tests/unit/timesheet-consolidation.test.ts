import { describe, expect, it } from 'vitest';
import { groupSessionsForConsolidation } from '@/lib/services/timesheet';
import type { ProjectWorkSession } from '@/lib/types/people';

/**
 * A etapa escolhida no app de Ponto é o que diz ao projeto ONDE as horas
 * foram aplicadas. Se a consolidação agrupasse só por projeto + dia, duas
 * etapas do mesmo dia virariam um apontamento só, atribuído à primeira.
 */

function session(overrides: Partial<ProjectWorkSession> = {}): ProjectWorkSession {
  return {
    id: 'sess-1',
    organizationId: 'org-1',
    personId: 'pessoa-1',
    projectId: 'PRJ-1',
    allocationId: 'aloc-1',
    timelineItemId: null,
    startedAt: '2026-07-29T08:00:00',
    endedAt: '2026-07-29T12:00:00',
    durationMinutes: 240,
    description: null,
    source: 'web_timer',
    status: 'draft',
    deviceId: null,
    timeEntryId: null,
    createdAt: '2026-07-29T08:00:00',
    updatedAt: '2026-07-29T12:00:00',
    ...overrides,
  } as ProjectWorkSession;
}

describe('agrupamento das sessões vindas do Ponto', () => {
  it('separa etapas diferentes do mesmo projeto no mesmo dia', () => {
    const groups = groupSessionsForConsolidation([
      session({ id: 's1', timelineItemId: 'etapa-fundacao', durationMinutes: 180 }),
      session({
        id: 's2',
        timelineItemId: 'etapa-montagem',
        startedAt: '2026-07-29T13:00:00',
        durationMinutes: 240,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.timelineItemId).sort()).toEqual(['etapa-fundacao', 'etapa-montagem']);
    // Cada grupo leva só as horas da própria etapa.
    for (const group of groups) {
      expect(group.sessions).toHaveLength(1);
    }
  });

  it('junta sessões da MESMA etapa no mesmo dia', () => {
    const groups = groupSessionsForConsolidation([
      session({ id: 's1', timelineItemId: 'etapa-fundacao', durationMinutes: 120 }),
      session({
        id: 's2',
        timelineItemId: 'etapa-fundacao',
        startedAt: '2026-07-29T14:00:00',
        durationMinutes: 120,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].sessions).toHaveLength(2);
    expect(groups[0].timelineItemId).toBe('etapa-fundacao');
  });

  it('mantém "sem etapa" como um grupo próprio, sem misturar com etapas', () => {
    const groups = groupSessionsForConsolidation([
      session({ id: 's1', timelineItemId: null }),
      session({ id: 's2', timelineItemId: 'etapa-fundacao', startedAt: '2026-07-29T13:00:00' }),
      session({ id: 's3', timelineItemId: null, startedAt: '2026-07-29T16:00:00' }),
    ]);

    expect(groups).toHaveLength(2);
    const semEtapa = groups.find((g) => g.timelineItemId === null);
    expect(semEtapa?.sessions.map((s) => s.id)).toEqual(['s1', 's3']);
  });

  it('separa dias diferentes mesmo com a mesma etapa', () => {
    const groups = groupSessionsForConsolidation([
      session({ id: 's1', timelineItemId: 'etapa-fundacao', startedAt: '2026-07-29T08:00:00' }),
      session({ id: 's2', timelineItemId: 'etapa-fundacao', startedAt: '2026-07-30T08:00:00' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.workDate).sort()).toEqual(['2026-07-29', '2026-07-30']);
  });

  it('separa projetos diferentes', () => {
    const groups = groupSessionsForConsolidation([
      session({ id: 's1', projectId: 'PRJ-1', timelineItemId: 'etapa-a' }),
      session({ id: 's2', projectId: 'PRJ-2', timelineItemId: 'etapa-a' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.projectId).sort()).toEqual(['PRJ-1', 'PRJ-2']);
  });

  it('atribui a sessão que vira o dia ao dia em que começou', () => {
    const groups = groupSessionsForConsolidation([
      session({ id: 's1', startedAt: '2026-07-29T22:00:00', endedAt: '2026-07-30T02:00:00' }),
    ]);
    expect(groups[0].workDate).toBe('2026-07-29');
  });

  it('devolve lista vazia sem sessões', () => {
    expect(groupSessionsForConsolidation([])).toEqual([]);
  });
});
