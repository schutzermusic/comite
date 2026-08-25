/**
 * Feed de eventos do cronograma — READ-MODEL DERIVADO.
 *
 * Não existe (e não deve existir) tabela de eventos. Cada evento é composto em
 * tempo de leitura a partir de quem já é dono do dado:
 *
 *   project_work_sessions   → trabalho em curso / pausado
 *   time_entries            → horas lançadas / aprovadas
 *   project_delay_logs      → atraso reportado / previsão alterada
 *   project_timeline_comments → comentário
 *   project_timeline_items  → início e término reais, marco atingido
 *
 * Regra do módulo: "lê do dono, nunca copia". Isso evita write path novo no
 * Ponto e elimina a possibilidade de o feed divergir da fonte.
 *
 * Puro: sem Supabase, sem React.
 */

import type { HudSignalTone } from '@/components/hud/HudSignal';
import type { ProjectWorkSession, TimeEntry } from '@/lib/types/people';
import type { DelayLog, TimelineComment, TimelineItem } from '@/lib/types/project-timeline';
import { DELAY_REASON_LABELS } from '@/lib/types/project-timeline';

export type TimelineEventType =
  | 'work_in_progress'
  | 'work_paused'
  | 'hours_logged'
  | 'hours_approved'
  | 'item_started'
  | 'work_completed'
  | 'milestone_reached'
  | 'delay_reported'
  | 'forecast_changed'
  | 'comment_added';

export interface TimelineEvent {
  /** Sintético e ESTÁVEL — `${tipo}:${idDaFonte}`, para servir de key no React. */
  id: string;
  type: TimelineEventType;
  /** ISO. Precisão de dia é ancorada ao meio-dia (ver `precision`). */
  at: string;
  itemId: string;
  itemTitle: string;
  actorName: string | null;
  actorAvatarUrl: string | null;
  title: string;
  detail: string | null;
  tone: HudSignalTone;
  precision: 'day' | 'timestamp';
}

const TONE: Record<TimelineEventType, HudSignalTone> = {
  work_in_progress: 'live',
  work_paused: 'neutral',
  hours_logged: 'info',
  hours_approved: 'success',
  item_started: 'accent',
  work_completed: 'success',
  milestone_reached: 'accent',
  delay_reported: 'danger',
  forecast_changed: 'warning',
  comment_added: 'neutral',
};

/**
 * Desempate determinístico quando dois eventos caem no mesmo instante — o que
 * é COMUM, já que lançamentos de um mesmo dia são todos ancorados ao meio-dia.
 * Sem isso a lista trocaria de ordem entre renders.
 */
const PRIORITY: Record<TimelineEventType, number> = {
  work_in_progress: 0,
  delay_reported: 1,
  forecast_changed: 2,
  milestone_reached: 3,
  work_completed: 4,
  item_started: 5,
  hours_approved: 6,
  hours_logged: 7,
  work_paused: 8,
  comment_added: 9,
};

function formatHoursShort(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`;
}

function formatDateBr(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export interface ComposeTimelineEventsInput {
  items: TimelineItem[];
  entries?: TimeEntry[];
  sessions?: ProjectWorkSession[];
  delayLogs?: DelayLog[];
  comments?: TimelineComment[];
  /** Restringe a uma atividade (uso no drawer). */
  itemId?: string;
  limit?: number;
}

export function composeTimelineEvents(input: ComposeTimelineEventsInput): TimelineEvent[] {
  const { items, entries = [], sessions = [], delayLogs = [], comments = [], itemId, limit = 50 } = input;

  const itemById = new Map(items.map((i) => [i.id, i]));
  const events: TimelineEvent[] = [];

  const push = (
    type: TimelineEventType,
    sourceId: string,
    at: string | null,
    targetItemId: string,
    parts: { title: string; detail?: string | null; actorName?: string | null; actorAvatarUrl?: string | null; precision?: 'day' | 'timestamp' },
  ) => {
    if (!at) return;
    if (itemId && targetItemId !== itemId) return;
    const item = itemById.get(targetItemId);
    if (!item) return; // evento órfão: a etapa não existe mais
    events.push({
      id: `${type}:${sourceId}`,
      type,
      at,
      itemId: targetItemId,
      itemTitle: item.title,
      actorName: parts.actorName ?? null,
      actorAvatarUrl: parts.actorAvatarUrl ?? null,
      title: parts.title,
      detail: parts.detail ?? null,
      tone: TONE[type],
      precision: parts.precision ?? 'timestamp',
    });
  };

  /* ─── Sessões (timer) ─── */
  for (const session of sessions) {
    if (session.status === 'discarded' || !session.timelineItemId) continue;
    if (session.status === 'running') {
      push('work_in_progress', session.id, session.startedAt, session.timelineItemId, {
        title: 'Trabalho em andamento',
        detail: session.description,
      });
    } else if (session.endedAt) {
      const duration = session.durationMinutes ? ` · ${formatHoursShort(session.durationMinutes)}` : '';
      push('work_paused', session.id, session.endedAt, session.timelineItemId, {
        title: 'Trabalho pausado',
        detail: `${session.description ?? 'Sessão encerrada'}${duration}`,
      });
    }
  }

  /* ─── Lançamentos ─── */
  for (const entry of entries) {
    if (entry.status === 'rejected' || !entry.timelineItemId) continue;
    const actorName = entry.person?.fullName ?? null;

    push('hours_logged', entry.id, `${entry.workDate}T12:00:00`, entry.timelineItemId, {
      title: `${formatHoursShort(entry.minutes)} apontadas`,
      detail: entry.description,
      actorName,
      precision: 'day',
    });

    if (entry.approvedAt && (entry.status === 'approved' || entry.status === 'locked')) {
      push('hours_approved', entry.id, entry.approvedAt, entry.timelineItemId, {
        title: `${formatHoursShort(entry.minutes)} aprovadas`,
        detail: entry.autoApproved ? 'Aprovação automática (sem exceções)' : null,
        actorName,
      });
    }
  }

  /* ─── Atrasos ─── */
  for (const log of delayLogs) {
    const reason = log.reasonCategory ? DELAY_REASON_LABELS[log.reasonCategory] : null;
    push('delay_reported', log.id, log.createdAt.toISOString(), log.timelineItemId, {
      title: log.newStatus === 'blocked' ? 'Bloqueio reportado' : 'Atraso reportado',
      detail: reason ? `${reason}${log.reasonText ? ` — ${log.reasonText}` : ''}` : log.reasonText,
      actorName: log.reporterName ?? null,
    });

    if (log.newForecastFinish && log.newForecastFinish !== log.oldForecastFinish) {
      push('forecast_changed', log.id, log.createdAt.toISOString(), log.timelineItemId, {
        title: 'Previsão de término alterada',
        detail: `${formatDateBr(log.oldForecastFinish)} → ${formatDateBr(log.newForecastFinish)}`,
        actorName: log.reporterName ?? null,
      });
    }
  }

  /* ─── Comentários ─── */
  for (const comment of comments) {
    push('comment_added', comment.id, comment.createdAt.toISOString(), comment.timelineItemId, {
      title: 'Comentário',
      detail: comment.body,
      actorName: comment.authorName ?? null,
    });
  }

  /* ─── Datas reais do próprio item ─── */
  for (const item of items) {
    push('item_started', item.id, item.actualStart ? `${item.actualStart}T12:00:00` : null, item.id, {
      title: 'Execução iniciada',
      detail: `Início real: ${formatDateBr(item.actualStart)}`,
      precision: 'day',
    });

    if (item.actualFinish) {
      const isMilestone = item.isMilestone;
      push(isMilestone ? 'milestone_reached' : 'work_completed', item.id, `${item.actualFinish}T12:00:00`, item.id, {
        title: isMilestone ? 'Marco atingido' : 'Execução concluída',
        detail: `Término real: ${formatDateBr(item.actualFinish)}`,
        precision: 'day',
      });
    }
  }

  events.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? 1 : -1; // mais recente primeiro
    if (PRIORITY[a.type] !== PRIORITY[b.type]) return PRIORITY[a.type] - PRIORITY[b.type];
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return events.slice(0, limit);
}

/** Rótulo relativo curto em pt-BR ("agora", "há 3 h", "12/08"). */
export function formatEventTime(event: TimelineEvent, now: Date): string {
  const at = new Date(event.at);
  if (Number.isNaN(at.getTime())) return '—';

  if (event.precision === 'day') return formatDateBr(event.at);

  const diffMs = now.getTime() - at.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return formatDateBr(event.at);
}
