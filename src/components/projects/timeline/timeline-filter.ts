/**
 * Tradução dos filtros da UI para um predicado puro sobre TimelineItem.
 *
 * Fica junto do store porque é lógica de VIEW (o recorte que o usuário pediu),
 * não regra de domínio. O predicado é aplicado via `filterTree`, que preserva a
 * hierarquia — um item casa e seus ancestrais vêm junto para dar contexto.
 *
 * Nota sobre os flags de execução: quando o modelo de execução não está
 * disponível (sem permissão de timesheet), `no_apontamento`, `worked_today` e
 * `active_now` não têm como ser avaliados. Nesse caso eles NÃO filtram nada em
 * vez de esvaziarem a tela — mas a UI também não deve oferecê-los.
 */

import { deriveDelayStatus } from '@/lib/projects/timeline-analytics';
import type { ItemExecution, ProjectExecutionModel } from '@/lib/projects/timeline-execution';
import type { ScheduleSignal } from '@/lib/projects/timeline-intelligence';
import type { TimelineItem } from '@/lib/types/project-timeline';
import type { TimelineFilters } from './timeline-store';

function matchesSearch(item: TimelineItem, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return (
    item.title.toLowerCase().includes(needle) ||
    (item.wbsCode ?? '').toLowerCase().includes(needle) ||
    (item.description ?? '').toLowerCase().includes(needle)
  );
}

function matchesResponsible(item: TimelineItem, userId: string): boolean {
  if (item.responsibleUserId === userId) return true;
  return (item.assignments ?? []).some((a) => a.userId === userId && !a.removedAt);
}

export interface BuildTimelineFilterInput {
  filters: TimelineFilters;
  execution: ProjectExecutionModel;
  /** Sinais de prazo — sempre disponíveis, independem de permissão de horas. */
  scheduleByItem?: ReadonlyMap<string, ScheduleSignal>;
  now: Date;
}

export function buildTimelineFilter(input: BuildTimelineFilterInput): (item: TimelineItem) => boolean {
  const { filters, execution, scheduleByItem, now } = input;
  const { search, responsibleUserId, status, flags } = filters;
  const executionKnown = execution.availability === 'available';

  return (item: TimelineItem): boolean => {
    if (!matchesSearch(item, search)) return false;
    if (responsibleUserId && !matchesResponsible(item, responsibleUserId)) return false;
    if (status && item.status !== status) return false;
    if (flags.size === 0) return true;

    const delayStatus = item.status === 'completed' ? 'on_track' : deriveDelayStatus(item, now);
    const exec: ItemExecution | undefined = execution.byItem.get(item.id);

    // Flags são OR entre si: marcar "Atrasadas" + "Bloqueadas" mostra as duas.
    for (const flag of flags) {
      switch (flag) {
        case 'delayed':
          if (delayStatus === 'delayed') return true;
          break;
        case 'at_risk':
          if (delayStatus === 'at_risk') return true;
          break;
        case 'blocked':
          if (delayStatus === 'blocked') return true;
          break;
        case 'milestones':
          if (item.isMilestone) return true;
          break;
        case 'no_responsible':
          if (!item.responsibleUserId && item.status !== 'completed' && item.status !== 'cancelled') return true;
          break;
        case 'no_apontamento':
          if (executionKnown && exec?.hasNoApontamento && item.status !== 'completed' && item.status !== 'cancelled') {
            return true;
          }
          break;
        case 'worked_today':
          if (executionKnown && exec?.workedToday) return true;
          break;
        case 'active_now':
          if (executionKnown && exec?.isActiveNow) return true;
          break;
        case 'no_recent_activity':
          if (executionKnown && exec?.noRecentActivity) return true;
          break;
        case 'over_effort':
          if (executionKnown && exec?.overPlannedEffort) return true;
          break;
        case 'behind_schedule':
          // Prazo não depende do timesheet: avaliado sempre.
          if (scheduleByItem?.get(item.id)?.behindSchedule) return true;
          break;
      }
    }
    return false;
  };
}
