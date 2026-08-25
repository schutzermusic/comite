/**
 * Fixtures compartilhadas dos testes do cronograma (migration 032).
 *
 * `FIXED_NOW` é congelado para que qualquer derivação sensível a "hoje"
 * (deriveDelayStatus, ganttScale, workedToday) seja determinística.
 */

import type { TimelineItem, TimelineItemStatus } from '@/lib/types/project-timeline';

/** Quarta-feira, 12:00 local. */
export const FIXED_NOW = new Date(2026, 7, 12, 12, 0, 0);

let seq = 0;

/** Constrói um TimelineItem completo; só os campos relevantes ao teste são passados. */
export function makeItem(over: Partial<TimelineItem> & { id: string }): TimelineItem {
  seq += 1;
  return {
    organizationId: 'org-1',
    projectId: 'proj-1',
    parentId: null,
    importBatchId: null,
    originalMsProjectId: null,
    wbsCode: null,
    outlineLevel: 0,
    rowOrder: seq,
    type: 'task',
    title: `Atividade ${over.id}`,
    description: null,
    plannedStart: null,
    plannedFinish: null,
    actualStart: null,
    actualFinish: null,
    forecastStart: null,
    forecastFinish: null,
    durationMinutes: null,
    percentComplete: 0,
    status: 'not_started' as TimelineItemStatus,
    priority: 'medium',
    responsibleUserId: null,
    delayStatus: 'on_track',
    delayReasonCategory: null,
    delayReasonText: null,
    delayImpactText: null,
    recoveryPlanText: null,
    relatedAgendaTaskId: null,
    relatedMeetingId: null,
    relatedRiskId: null,
    relatedContractId: null,
    relatedDocumentId: null,
    isSummary: false,
    isMilestone: false,
    isActive: true,
    rawImport: null,
    createdBy: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    deletedAt: null,
    assignments: [],
    ...over,
  };
}

/**
 * Árvore de 2 níveis usada em vários testes:
 *
 *   f1  Fase 1                    (summary)
 *   ├── t1  Tarefa concluída
 *   └── t2  Tarefa atrasada
 *   f2  Fase 2                    (summary)
 *   └── m1  Marco
 */
export function makeTree(): TimelineItem[] {
  seq = 0;
  return [
    makeItem({ id: 'f1', rowOrder: 1, isSummary: true, wbsCode: '1', plannedStart: '2026-08-01', plannedFinish: '2026-08-20' }),
    makeItem({ id: 't1', rowOrder: 2, parentId: 'f1', wbsCode: '1.1', status: 'completed', percentComplete: 100, durationMinutes: 480, plannedStart: '2026-08-01', plannedFinish: '2026-08-05' }),
    makeItem({ id: 't2', rowOrder: 3, parentId: 'f1', wbsCode: '1.2', status: 'in_progress', percentComplete: 40, durationMinutes: 960, plannedStart: '2026-08-06', plannedFinish: '2026-08-10' }),
    makeItem({ id: 'f2', rowOrder: 4, isSummary: true, wbsCode: '2', plannedStart: '2026-08-21', plannedFinish: '2026-09-10' }),
    makeItem({ id: 'm1', rowOrder: 5, parentId: 'f2', wbsCode: '2.1', isMilestone: true, plannedStart: '2026-09-10', plannedFinish: '2026-09-10' }),
  ];
}
