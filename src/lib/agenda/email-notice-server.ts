/**
 * Resolve um aviso tipado da Agenda/Cronograma em e-mails prontos. Server-only.
 *
 * Tudo é lido pela sessão RLS de QUEM PEDIU (o cliente Supabase do servidor
 * com o cookie dela), filtrado pela organização ATIVA: se a pessoa não enxerga
 * o registro, o aviso não existe (404). Além de enxergar, ela precisa ser o
 * AUTOR do fato — quem gerencia a reunião, quem criou a tarefa, quem atribuiu,
 * quem reportou o atraso (403). Destinatários vêm do registro; conteúdo, dos
 * modelos do servidor.
 */
if (typeof window !== 'undefined') {
  throw new Error('agenda/email-notice-server.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPublicAppOrigin } from '@/lib/config/app-url';
import type { AppEmailAttachment } from '@/lib/notifications/email';
import type { TaskPriority, TaskStatus } from '@/lib/types/agenda';
import { DELAY_REASON_LABELS, TIMELINE_STATUS_LABELS } from '@/lib/types/project-timeline';
import type { DelayReasonCategory, TimelineItemStatus } from '@/lib/types/project-timeline';
import {
  meetingInviteEmail, taskAssignedEmail, taskStatusEmail, timelineAssignedEmail, timelineDelayEmail,
  type EmailContent,
} from './email-templates';
import { buildIcs } from './ics';
import {
  INVITE_RESEND_BUCKET_MS, MAX_NOTICE_RECIPIENTS, calendarDateLabel, dueDateTimeLabel, isFresh, meetingDateLabel,
  noticeIdempotencyKey, noticeRecipients, type AgendaEmailKind, type AgendaEmailRequest,
} from './email-notice';

export interface ResolvedNotice {
  kind: AgendaEmailKind;
  related: { type: 'calendar_event' | 'task' | 'timeline_item'; id: string };
  content: EmailContent;
  recipients: string[];
  attachments?: AppEmailAttachment[];
  idempotencyKey: (recipient: string) => string;
}

export type NoticeResolution = { ok: true; notice: ResolvedNotice } | { ok: false; status: 403 | 404 | 409 | 422; error: string };

interface Member { user_id: string; full_name: string | null; email: string | null }

const NOT_FOUND = { ok: false, status: 404, error: 'Registro não encontrado nesta organização.' } as const;
const NOT_AUTHOR = { ok: false, status: 403, error: 'Só quem registrou o fato pode enviar este aviso.' } as const;
const STALE = { ok: false, status: 409, error: 'Aviso fora da janela: ele acompanha o fato, não pode ser repetido depois.' } as const;

async function directory(sb: SupabaseClient): Promise<Map<string, Member>> {
  const { data } = await sb.rpc('list_organization_members');
  return new Map(((data ?? []) as Member[]).map((m) => [m.user_id, m]));
}

async function projectFacts(sb: SupabaseClient, org: string, projectId: string): Promise<{ name: string; managerId: string | null }> {
  const { data } = await sb.from('projects').select('project').eq('id', projectId).eq('organization_id', org).maybeSingle();
  const p = (data?.project ?? null) as { nome?: unknown; responsavel?: { id?: unknown } | null } | null;
  const name = typeof p?.nome === 'string' && p.nome.trim() ? p.nome : projectId;
  const managerId = typeof p?.responsavel?.id === 'string' ? p.responsavel.id : null;
  return { name, managerId };
}

function capped(notice: ResolvedNotice): NoticeResolution {
  if (notice.recipients.length > MAX_NOTICE_RECIPIENTS) {
    return { ok: false, status: 422, error: `Aviso com mais de ${MAX_NOTICE_RECIPIENTS} destinatários.` };
  }
  return { ok: true, notice };
}

export async function resolveAgendaNotice(
  sb: SupabaseClient, org: string, caller: { id: string; email: string | null }, req: AgendaEmailRequest, now = Date.now(),
): Promise<NoticeResolution> {
  const origin = getPublicAppOrigin();
  switch (req.kind) {
    case 'meeting_invite': {
      const { data: ev } = await sb.from('calendar_events')
        .select('id, owner_user_id, type, title, description, starts_at, ends_at, location, meeting_link, status, deleted_at')
        .eq('id', req.id).eq('organization_id', org).maybeSingle();
      if (!ev || ev.deleted_at || ev.type !== 'meeting') return NOT_FOUND;
      const { data: canManage } = await sb.rpc('user_can_manage_event', { p_event_id: ev.id });
      if (canManage !== true) return NOT_AUTHOR;
      if (ev.status === 'cancelled') return { ok: false, status: 409, error: 'Reunião cancelada: não há convite a enviar.' };
      const { data: attendees } = await sb.from('calendar_event_attendees')
        .select('email, role').eq('event_id', ev.id).eq('organization_id', org);
      const members = await directory(sb);
      const owner = members.get(ev.owner_user_id);
      const recipients = noticeRecipients(
        (attendees ?? []).filter((a) => a.role !== 'organizer').map((a) => a.email as string),
        [caller.email, owner?.email],
      );
      const detailUrl = `${origin}/reunioes?event=${ev.id}`;
      const organizerName = owner?.full_name ?? null;
      const content = meetingInviteEmail({
        title: ev.title, dateLabel: meetingDateLabel(ev.starts_at), organizerName, location: ev.location,
        meetingLink: ev.meeting_link, description: ev.description, detailUrl,
      });
      const ics = buildIcs({
        uid: `${ev.id}@insightapex.co`, title: ev.title, description: ev.description, start: new Date(ev.starts_at),
        end: ev.ends_at ? new Date(ev.ends_at) : null, location: ev.location ?? ev.meeting_link, url: detailUrl,
        organizerName, organizerEmail: owner?.email ?? undefined, attendees: recipients,
      });
      const bucket = Math.floor(now / INVITE_RESEND_BUCKET_MS);
      return capped({
        kind: req.kind, related: { type: 'calendar_event', id: ev.id }, content, recipients,
        attachments: [{ filename: 'reuniao.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=REQUEST' }],
        idempotencyKey: (r) => noticeIdempotencyKey(req.kind, `${ev.id}:${bucket}`, r),
      });
    }

    case 'task_assigned':
    case 'task_status': {
      const { data: task } = await sb.from('tasks')
        .select('id, creator_user_id, assignee_user_id, title, description, due_at, priority, status, notify_emails, created_at, updated_at, deleted_at')
        .eq('id', req.id).eq('organization_id', org).maybeSingle();
      if (!task || task.deleted_at) return NOT_FOUND;
      const members = await directory(sb);
      const detailUrl = `${origin}/reunioes?task=${task.id}`;
      const actorName = members.get(caller.id)?.full_name ?? null;

      if (req.kind === 'task_assigned') {
        if (task.creator_user_id !== caller.id) return NOT_AUTHOR;
        if (!isFresh(task.created_at, now)) return STALE;
        const assignee = task.assignee_user_id && task.assignee_user_id !== caller.id ? members.get(task.assignee_user_id)?.email : null;
        const watchers = Array.isArray(task.notify_emails) ? (task.notify_emails as unknown[]).map(String) : [];
        const recipients = noticeRecipients([assignee, ...watchers], [caller.email]);
        const content = taskAssignedEmail({
          title: task.title, assignerName: actorName, dueLabel: task.due_at ? dueDateTimeLabel(task.due_at) : null,
          priority: task.priority as TaskPriority, description: task.description, detailUrl,
        });
        return capped({
          kind: req.kind, related: { type: 'task', id: task.id }, content, recipients,
          idempotencyKey: (r) => noticeIdempotencyKey(req.kind, task.id, r),
        });
      }

      if (task.creator_user_id !== caller.id && task.assignee_user_id !== caller.id) return NOT_AUTHOR;
      if (task.status !== 'done' && task.status !== 'blocked') {
        return { ok: false, status: 409, error: 'Só conclusão e bloqueio geram e-mail de status.' };
      }
      if (!isFresh(task.updated_at, now)) return STALE;
      const others = [task.creator_user_id, task.assignee_user_id].filter((u): u is string => Boolean(u) && u !== caller.id);
      const recipients = noticeRecipients(others.map((u) => members.get(u)?.email), [caller.email]);
      const content = taskStatusEmail({
        title: task.title, newStatus: task.status as TaskStatus, changedByName: actorName, detailUrl,
      });
      return capped({
        kind: req.kind, related: { type: 'task', id: task.id }, content, recipients,
        idempotencyKey: (r) => noticeIdempotencyKey(req.kind, `${task.id}:${task.status}:${task.updated_at}`, r),
      });
    }

    case 'timeline_assigned': {
      const { data: a } = await sb.from('project_timeline_assignments')
        .select('id, project_id, timeline_item_id, user_id, role, assigned_by, assigned_at, removed_at')
        .eq('id', req.id).eq('organization_id', org).maybeSingle();
      if (!a) return NOT_FOUND;
      if (a.assigned_by !== caller.id) return NOT_AUTHOR;
      if (a.removed_at) return { ok: false, status: 409, error: 'Atribuição já encerrada.' };
      if (!isFresh(a.assigned_at, now)) return STALE;
      const { data: item } = await sb.from('project_timeline_items')
        .select('id, title, wbs_code, planned_finish, status, deleted_at')
        .eq('id', a.timeline_item_id).eq('organization_id', org).maybeSingle();
      if (!item || item.deleted_at) return NOT_FOUND;
      const [members, project] = await Promise.all([directory(sb), projectFacts(sb, org, a.project_id)]);
      const recipients = a.user_id === caller.id ? [] : noticeRecipients([members.get(a.user_id)?.email], [caller.email]);
      const content = timelineAssignedEmail({
        projectName: project.name, taskTitle: item.title, wbsCode: item.wbs_code,
        roleLabel: a.role === 'responsible' ? 'Responsável' : 'Equipe de execução',
        assignerName: members.get(caller.id)?.full_name ?? null,
        dueLabel: item.planned_finish ? calendarDateLabel(item.planned_finish) : null,
        statusLabel: TIMELINE_STATUS_LABELS[item.status as TimelineItemStatus] ?? null,
        detailUrl: `${origin}/projetos/${encodeURIComponent(a.project_id)}?tab=timeline&item=${item.id}`,
      });
      return capped({
        kind: req.kind, related: { type: 'timeline_item', id: item.id }, content, recipients,
        idempotencyKey: (r) => noticeIdempotencyKey(req.kind, a.id, r),
      });
    }

    case 'timeline_delay': {
      const { data: log } = await sb.from('project_delay_logs')
        .select('id, project_id, timeline_item_id, reported_by, new_status, reason_category, new_forecast_finish, created_at')
        .eq('id', req.id).eq('organization_id', org).maybeSingle();
      if (!log) return NOT_FOUND;
      if (log.reported_by !== caller.id) return NOT_AUTHOR;
      if (!isFresh(log.created_at, now)) return STALE;
      const { data: item } = await sb.from('project_timeline_items')
        .select('id, title, wbs_code, responsible_user_id, deleted_at')
        .eq('id', log.timeline_item_id).eq('organization_id', org).maybeSingle();
      if (!item || item.deleted_at) return NOT_FOUND;
      const [members, project] = await Promise.all([directory(sb), projectFacts(sb, org, log.project_id)]);
      const people = [item.responsible_user_id, project.managerId].filter((u): u is string => Boolean(u) && u !== caller.id);
      const recipients = noticeRecipients(people.map((u) => members.get(u)?.email), [caller.email]);
      const content = timelineDelayEmail({
        projectName: project.name, taskTitle: item.title, wbsCode: item.wbs_code,
        statusLabel: TIMELINE_STATUS_LABELS[log.new_status as TimelineItemStatus] ?? String(log.new_status),
        reasonLabel: DELAY_REASON_LABELS[log.reason_category as DelayReasonCategory] ?? null,
        newForecastLabel: log.new_forecast_finish ? calendarDateLabel(log.new_forecast_finish) : null,
        reportedByName: members.get(caller.id)?.full_name ?? null, actionRequired: false,
        detailUrl: `${origin}/projetos/${encodeURIComponent(log.project_id)}?tab=timeline&item=${item.id}`,
      });
      return capped({
        kind: req.kind, related: { type: 'timeline_item', id: item.id }, content, recipients,
        idempotencyKey: (r) => noticeIdempotencyKey(req.kind, log.id, r),
      });
    }
  }
}
