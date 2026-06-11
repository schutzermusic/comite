'use client';

/**
 * Agenda & Tarefas service — Supabase-backed calendar (meetings + tasks),
 * in-app notifications and outbound e-mail. Mirrors the idioms of
 * src/lib/services/deliberations.ts (snake_case rows, RLS-friendly errors,
 * org/user resolution).
 *
 * Side-effects (notify + email + audit) are best-effort: a meeting/task is
 * considered created once its row(s) persist; notification/email failures
 * are logged but never roll back the create.
 */

import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import {
  meetingInviteEmail,
  taskAssignedEmail,
  taskStatusEmail,
} from '@/lib/agenda/email-templates';
import { buildIcs } from '@/lib/agenda/ics';
import type {
  AppNotification,
  CalendarEvent,
  CalendarEventAttendee,
  CalendarItem,
  CreateMeetingInput,
  CreateTaskInput,
  EmailDispatchStatus,
  MeetingReminderToken,
  OrgMember,
  RecurrenceFreq,
  Task,
  TaskChecklistItem,
  TaskComment,
  TaskReminderToken,
  TaskStatus,
  UpdateMeetingInput,
  UpdateTaskInput,
} from '@/lib/types/agenda';
import { addDays, addMonths, addWeeks } from 'date-fns';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type SupabaseLike = ReturnType<typeof createClient>;

const EVENTS = 'calendar_events';
const ATTENDEES = 'calendar_event_attendees';
const TASKS = 'tasks';
const CHECKLIST = 'task_checklist_items';
const COMMENTS = 'task_comments';

/* ───────────── Row shapes ───────────── */

type EventRow = {
  id: string;
  organization_id: string;
  owner_user_id: string;
  type: 'meeting' | 'task';
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  status: CalendarEvent['status'];
  visibility: CalendarEvent['visibility'];
  location: string | null;
  meeting_link: string | null;
  related_project_id: string | null;
  related_contract_id: string | null;
  related_committee_id: string | null;
  related_risk_id: string | null;
  related_deliberation_id: string | null;
  related_finance_item_id: string | null;
  related_payroll_batch_id: string | null;
  reminder_offsets: MeetingReminderToken[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type AttendeeRow = {
  id: string;
  event_id: string;
  organization_id: string;
  user_id: string | null;
  email: string;
  name: string | null;
  role: CalendarEventAttendee['role'];
  response_status: CalendarEventAttendee['responseStatus'];
  is_external: boolean;
  created_at: string;
};

type TaskRow = {
  id: string;
  organization_id: string;
  creator_user_id: string;
  assignee_user_id: string | null;
  title: string;
  description: string | null;
  due_at: string | null;
  due_all_day: boolean;
  priority: Task['priority'];
  status: Task['status'];
  related_event_id: string | null;
  related_project_id: string | null;
  related_contract_id: string | null;
  related_risk_id: string | null;
  related_deliberation_id: string | null;
  related_committee_id: string | null;
  related_finance_item_id: string | null;
  related_payroll_batch_id: string | null;
  blocked_by_task_id: string | null;
  recurrence_freq: RecurrenceFreq | null;
  recurrence_interval: number | null;
  recurrence_until: string | null;
  reminder_offsets: TaskReminderToken[] | null;
  notify_emails: string[] | null;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type CommentRow = {
  id: string;
  task_id: string;
  organization_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
};

type ChecklistRow = {
  id: string;
  task_id: string;
  organization_id: string;
  title: string;
  completed: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

type NotificationRow = {
  id: string;
  organization_id: string;
  recipient_user_id: string;
  type: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
};

/* ───────────── Helpers ───────────── */

function isRlsError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    /row[- ]level security|permission denied|policy/i.test(error.message || '')
  );
}

function friendlyError(prefix: string, error: { code?: string; message?: string }): string {
  if (isRlsError(error)) return `${prefix}: Acesso negado pela política de segurança.`;
  return `${prefix}: ${error.message || 'erro desconhecido'}`;
}

async function getCurrentOrgAndUser(
  supabase: SupabaseLike,
): Promise<{ userId: string; orgId: string; userName: string; userEmail: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Não autenticado');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id, full_name')
    .eq('user_id', user.id)
    .single();

  if (error || !profile?.organization_id) {
    throw new Error('Usuário sem organização ativa');
  }
  return {
    userId: user.id,
    orgId: profile.organization_id as string,
    userName: (profile.full_name as string | null) ?? user.email ?? 'Usuário',
    userEmail: user.email ?? '',
  };
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const appOrigin = () => (typeof window !== 'undefined' ? window.location.origin : '');

/* ───────────── Mappers ───────────── */

function mapEvent(row: EventRow, attendees?: AttendeeRow[]): CalendarEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    type: row.type,
    title: row.title,
    description: row.description,
    startsAt: toDate(row.starts_at) ?? new Date(),
    endsAt: toDate(row.ends_at),
    allDay: row.all_day,
    status: row.status,
    visibility: row.visibility,
    location: row.location,
    meetingLink: row.meeting_link,
    relatedProjectId: row.related_project_id,
    relatedContractId: row.related_contract_id,
    relatedCommitteeId: row.related_committee_id,
    relatedRiskId: row.related_risk_id,
    relatedDeliberationId: row.related_deliberation_id,
    relatedFinanceItemId: row.related_finance_item_id,
    relatedPayrollBatchId: row.related_payroll_batch_id,
    reminderOffsets: Array.isArray(row.reminder_offsets) ? row.reminder_offsets : null,
    metadata: row.metadata ?? {},
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
    deletedAt: toDate(row.deleted_at),
    attendees: attendees?.map(mapAttendee),
  };
}

function mapAttendee(row: AttendeeRow): CalendarEventAttendee {
  return {
    id: row.id,
    eventId: row.event_id,
    organizationId: row.organization_id,
    userId: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    responseStatus: row.response_status,
    isExternal: row.is_external,
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

function mapTask(row: TaskRow, checklist?: ChecklistRow[]): Task {
  return {
    id: row.id,
    organizationId: row.organization_id,
    creatorUserId: row.creator_user_id,
    assigneeUserId: row.assignee_user_id,
    title: row.title,
    description: row.description,
    dueAt: toDate(row.due_at),
    dueAllDay: row.due_all_day,
    priority: row.priority,
    status: row.status,
    relatedEventId: row.related_event_id,
    relatedProjectId: row.related_project_id,
    relatedContractId: row.related_contract_id,
    relatedRiskId: row.related_risk_id,
    relatedDeliberationId: row.related_deliberation_id,
    relatedCommitteeId: row.related_committee_id,
    relatedFinanceItemId: row.related_finance_item_id,
    relatedPayrollBatchId: row.related_payroll_batch_id,
    blockedByTaskId: row.blocked_by_task_id,
    recurrenceFreq: row.recurrence_freq,
    recurrenceInterval: row.recurrence_interval ?? 1,
    recurrenceUntil: toDate(row.recurrence_until),
    reminderOffsets: Array.isArray(row.reminder_offsets) ? row.reminder_offsets : null,
    notifyEmails: Array.isArray(row.notify_emails) ? row.notify_emails : [],
    completedAt: toDate(row.completed_at),
    metadata: row.metadata ?? {},
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
    deletedAt: toDate(row.deleted_at),
    checklist: checklist?.map(mapChecklist),
  };
}

function mapChecklist(row: ChecklistRow): TaskChecklistItem {
  return {
    id: row.id,
    taskId: row.task_id,
    organizationId: row.organization_id,
    title: row.title,
    completed: row.completed,
    position: row.position,
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
  };
}

function mapComment(row: CommentRow): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    organizationId: row.organization_id,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    organizationId: row.organization_id,
    recipientUserId: row.recipient_user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    linkUrl: row.link_url,
    readAt: toDate(row.read_at),
    createdAt: toDate(row.created_at) ?? new Date(),
  };
}

/* ───────────── Org members ───────────── */

export async function listOrgMembers(): Promise<OrgMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('list_organization_members');
  if (error) throw new Error(friendlyError('Falha ao listar membros', error));
  return (data ?? []).map(
    (r: { user_id: string; full_name: string | null; job_title: string | null; avatar_url: string | null; email: string | null }) => ({
      userId: r.user_id,
      fullName: r.full_name,
      jobTitle: r.job_title,
      avatarUrl: r.avatar_url,
      email: r.email,
    }),
  );
}

/* ───────────── Reads ───────────── */

export async function listCalendarEvents(rangeStart?: Date, rangeEnd?: Date): Promise<CalendarEvent[]> {
  const supabase = createClient();
  let query = supabase.from(EVENTS).select('*').is('deleted_at', null);
  if (rangeStart) query = query.gte('starts_at', rangeStart.toISOString());
  if (rangeEnd) query = query.lte('starts_at', rangeEnd.toISOString());
  const { data, error } = await query.order('starts_at', { ascending: true });
  if (error) throw new Error(friendlyError('Falha ao carregar eventos', error));
  return (data as EventRow[]).map((r) => mapEvent(r));
}

export async function listTasks(): Promise<Task[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TASKS)
    .select('*')
    .is('deleted_at', null)
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error(friendlyError('Falha ao carregar tarefas', error));
  return (data as TaskRow[]).map((r) => mapTask(r));
}

export async function getEventById(id: string): Promise<CalendarEvent | null> {
  const supabase = createClient();
  const { data: eventRow, error } = await supabase.from(EVENTS).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(friendlyError('Falha ao carregar reunião', error));
  if (!eventRow) return null;
  const { data: attendeeRows } = await supabase.from(ATTENDEES).select('*').eq('event_id', id);
  return mapEvent(eventRow as EventRow, (attendeeRows as AttendeeRow[]) ?? []);
}

export async function getTaskById(id: string): Promise<Task | null> {
  const supabase = createClient();
  const { data: taskRow, error } = await supabase.from(TASKS).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(friendlyError('Falha ao carregar tarefa', error));
  if (!taskRow) return null;
  const { data: checklistRows } = await supabase
    .from(CHECKLIST)
    .select('*')
    .eq('task_id', id)
    .order('position', { ascending: true });
  return mapTask(taskRow as TaskRow, (checklistRows as ChecklistRow[]) ?? []);
}

/** Tasks assigned to (or created by) the current user that are still open. */
export async function listMyPendings(): Promise<Task[]> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from(TASKS)
    .select('*')
    .is('deleted_at', null)
    .in('status', ['todo', 'in_progress', 'waiting', 'blocked'])
    .or(`assignee_user_id.eq.${uid},creator_user_id.eq.${uid}`)
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error(friendlyError('Falha ao carregar pendências', error));
  return (data as TaskRow[]).map((r) => mapTask(r));
}

/* ───────────── Merge for the calendar grid ───────────── */

export function mergeIntoCalendarItems(events: CalendarEvent[], tasks: Task[]): CalendarItem[] {
  const meetingItems: CalendarItem[] = events.map((e) => ({
    id: e.id,
    kind: 'meeting',
    title: e.title,
    start: e.startsAt,
    end: e.endsAt,
    allDay: e.allDay,
    status: e.status,
    ownerUserId: e.ownerUserId,
    location: e.location,
    meetingLink: e.meetingLink,
    visibility: e.visibility,
    source: e,
  }));

  const taskItems: CalendarItem[] = tasks
    .filter((t) => t.dueAt != null)
    .map((t) => ({
      id: t.id,
      kind: 'task',
      title: t.title,
      start: t.dueAt as Date,
      end: null,
      allDay: t.dueAllDay,
      status: t.status,
      ownerUserId: t.creatorUserId,
      priority: t.priority,
      assigneeUserId: t.assigneeUserId,
      source: t,
    }));

  return [...meetingItems, ...taskItems].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/* ───────────── Notifications + email (best-effort) ───────────── */

async function notifyUser(
  supabase: SupabaseLike,
  recipientUserId: string,
  type: string,
  title: string,
  body: string,
  link: string,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('create_notification', {
      p_recipient: recipientUserId,
      p_type: type,
      p_title: title,
      p_body: body,
      p_link: link,
    });
    if (error) console.error('[agenda] notify failed:', error.message);
  } catch (e) {
    console.error('[agenda] notify threw:', e instanceof Error ? e.message : e);
  }
}

async function sendEmail(payload: {
  subject: string;
  html: string;
  recipients: string[];
  ics?: string;
  icsFilename?: string;
  related_entity_type?: string;
  related_entity_id?: string;
}): Promise<void> {
  if (payload.recipients.length === 0) return;
  try {
    await fetch('/api/agenda/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('[agenda] email send threw:', e instanceof Error ? e.message : e);
  }
}

/* ───────────── Create meeting ───────────── */

export async function createMeeting(input: CreateMeetingInput): Promise<CalendarEvent> {
  const supabase = createClient();
  const { userId, orgId, userName, userEmail } = await getCurrentOrgAndUser(supabase);

  const { data: eventRow, error } = await supabase
    .from(EVENTS)
    .insert({
      organization_id: orgId,
      owner_user_id: userId,
      type: 'meeting',
      title: input.title,
      description: input.description ?? null,
      starts_at: new Date(input.startsAt).toISOString(),
      ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
      all_day: input.allDay ?? false,
      status: 'scheduled',
      visibility: input.visibility,
      location: input.location ?? null,
      meeting_link: input.meetingLink ?? null,
      related_project_id: input.relatedProjectId ?? null,
      related_contract_id: input.relatedContractId ?? null,
      related_committee_id: input.relatedCommitteeId ?? null,
      related_risk_id: input.relatedRiskId ?? null,
      related_deliberation_id: input.relatedDeliberationId ?? null,
      related_finance_item_id: input.relatedFinanceItemId ?? null,
      related_payroll_batch_id: input.relatedPayrollBatchId ?? null,
      reminder_offsets: input.reminderOffsets ?? null,
    })
    .select('*')
    .single();

  if (error || !eventRow) {
    throw new Error(friendlyError('Falha ao criar reunião', error ?? { message: 'sem retorno' }));
  }
  const event = mapEvent(eventRow as EventRow);

  // Attendees: organizer (creator) + guests. Dedup by lowercased email.
  const seen = new Set<string>();
  const attendeeRows: Omit<AttendeeRow, 'id' | 'created_at'>[] = [];
  if (userEmail) {
    seen.add(userEmail.toLowerCase());
    attendeeRows.push({
      event_id: event.id,
      organization_id: orgId,
      user_id: userId,
      email: userEmail,
      name: userName,
      role: 'organizer',
      response_status: 'accepted',
      is_external: false,
    });
  }
  for (const g of input.guests) {
    const key = g.email.toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    attendeeRows.push({
      event_id: event.id,
      organization_id: orgId,
      user_id: g.userId ?? null,
      email: g.email.trim(),
      name: g.name ?? null,
      role: g.role ?? 'attendee',
      response_status: 'pending',
      is_external: g.isExternal,
    });
  }

  if (attendeeRows.length > 0) {
    const { error: aErr } = await supabase.from(ATTENDEES).insert(attendeeRows);
    if (aErr) console.error('[agenda] attendee insert failed:', aErr.message);
  }

  // Side-effects.
  const dateLabel = format(event.startsAt, "EEE, dd 'de' MMM 'de' yyyy HH:mm", { locale: ptBR });
  const detailUrl = `${appOrigin()}/reunioes?event=${event.id}`;

  // In-app notifications for internal guests (not the organizer).
  for (const g of input.guests) {
    if (g.userId && g.userId !== userId) {
      await notifyUser(
        supabase,
        g.userId,
        'meeting_invite',
        `Convite: ${event.title}`,
        `${userName} convidou você para "${event.title}" em ${dateLabel}.`,
        detailUrl,
      );
    }
  }

  // E-mail every guest (internal + external); never the organizer.
  const recipients = input.guests
    .map((g) => g.email.trim())
    .filter((e) => e && e.toLowerCase() !== userEmail.toLowerCase());
  if (recipients.length > 0) {
    const mail = meetingInviteEmail({
      title: event.title,
      dateLabel,
      organizerName: userName,
      location: event.location,
      meetingLink: event.meetingLink,
      description: event.description,
      detailUrl,
    });
    const ics = buildIcs({
      uid: `${event.id}@insightapex.co`,
      title: event.title,
      description: event.description,
      start: event.startsAt,
      end: event.endsAt,
      location: event.location ?? event.meetingLink,
      url: detailUrl,
      organizerName: userName,
      organizerEmail: userEmail || undefined,
      attendees: recipients,
    });
    await sendEmail({
      subject: mail.subject,
      html: mail.html,
      recipients,
      ics,
      icsFilename: 'reuniao.ics',
      related_entity_type: 'calendar_event',
      related_entity_id: event.id,
    });
  }

  await logAuditEvent({
    organizationId: orgId,
    action: 'meeting.created',
    entityType: 'calendar_event',
    entityId: event.id,
    metadata: { title: event.title, guests: recipients.length, visibility: event.visibility },
  });

  return event;
}

export async function updateMeeting(id: string, patch: UpdateMeetingInput): Promise<void> {
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.startsAt !== undefined) update.starts_at = new Date(patch.startsAt).toISOString();
  if (patch.endsAt !== undefined) update.ends_at = patch.endsAt ? new Date(patch.endsAt).toISOString() : null;
  if (patch.allDay !== undefined) update.all_day = patch.allDay;
  if (patch.location !== undefined) update.location = patch.location;
  if (patch.meetingLink !== undefined) update.meeting_link = patch.meetingLink;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.visibility !== undefined) update.visibility = patch.visibility;
  if (patch.relatedProjectId !== undefined) update.related_project_id = patch.relatedProjectId;
  if (patch.relatedContractId !== undefined) update.related_contract_id = patch.relatedContractId;
  if (patch.relatedCommitteeId !== undefined) update.related_committee_id = patch.relatedCommitteeId;
  if (patch.relatedRiskId !== undefined) update.related_risk_id = patch.relatedRiskId;
  if (patch.relatedDeliberationId !== undefined) update.related_deliberation_id = patch.relatedDeliberationId;
  if (patch.relatedFinanceItemId !== undefined) update.related_finance_item_id = patch.relatedFinanceItemId;
  if (patch.relatedPayrollBatchId !== undefined) update.related_payroll_batch_id = patch.relatedPayrollBatchId;
  if (patch.reminderOffsets !== undefined) update.reminder_offsets = patch.reminderOffsets;

  const { error } = await supabase.from(EVENTS).update(update).eq('id', id);
  if (error) throw new Error(friendlyError('Falha ao atualizar reunião', error));
}

/** Re-send the invitation e-mail (with .ics) to all non-organizer attendees. */
export async function resendInvite(eventId: string): Promise<number> {
  const supabase = createClient();
  const { orgId, userName, userEmail } = await getCurrentOrgAndUser(supabase);

  const event = await getEventById(eventId);
  if (!event) throw new Error('Reunião não encontrada');

  const recipients = (event.attendees ?? [])
    .filter((a) => a.role !== 'organizer')
    .map((a) => a.email.trim())
    .filter((e) => e && e.toLowerCase() !== userEmail.toLowerCase());
  if (recipients.length === 0) return 0;

  const dateLabel = format(event.startsAt, "EEE, dd 'de' MMM 'de' yyyy HH:mm", { locale: ptBR });
  const detailUrl = `${appOrigin()}/reunioes?event=${event.id}`;
  const mail = meetingInviteEmail({
    title: event.title,
    dateLabel,
    organizerName: userName,
    location: event.location,
    meetingLink: event.meetingLink,
    description: event.description,
    detailUrl,
  });
  const ics = buildIcs({
    uid: `${event.id}@insightapex.co`,
    title: event.title,
    description: event.description,
    start: event.startsAt,
    end: event.endsAt,
    location: event.location ?? event.meetingLink,
    url: detailUrl,
    organizerName: userName,
    organizerEmail: userEmail || undefined,
    attendees: recipients,
  });
  await sendEmail({
    subject: mail.subject,
    html: mail.html,
    recipients,
    ics,
    icsFilename: 'reuniao.ics',
    related_entity_type: 'calendar_event',
    related_entity_id: event.id,
  });

  await logAuditEvent({
    organizationId: orgId,
    action: 'meeting.invite_resent',
    entityType: 'calendar_event',
    entityId: event.id,
    metadata: { recipients: recipients.length },
  });

  return recipients.length;
}

export async function cancelMeeting(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(EVENTS)
    .update({ status: 'cancelled', deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(friendlyError('Falha ao cancelar reunião', error));
}

/* ───────────── Create task ───────────── */

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  // Internal-only assignee guard (defense-in-depth; RLS also enforces it).
  let assigneeMember: OrgMember | undefined;
  if (input.assigneeUserId) {
    const members = await listOrgMembers();
    assigneeMember = members.find((m) => m.userId === input.assigneeUserId);
    if (!assigneeMember) {
      throw new Error('Tarefas só podem ser atribuídas a usuários internos do grupo.');
    }
  }

  const { data: taskRow, error } = await supabase
    .from(TASKS)
    .insert({
      organization_id: orgId,
      creator_user_id: userId,
      assignee_user_id: input.assigneeUserId,
      title: input.title,
      description: input.description ?? null,
      due_at: input.dueAt ? new Date(input.dueAt).toISOString() : null,
      due_all_day: input.dueAllDay ?? false,
      priority: input.priority,
      status: input.status ?? 'todo',
      related_event_id: input.relatedEventId ?? null,
      related_project_id: input.relatedProjectId ?? null,
      related_contract_id: input.relatedContractId ?? null,
      related_risk_id: input.relatedRiskId ?? null,
      related_deliberation_id: input.relatedDeliberationId ?? null,
      related_committee_id: input.relatedCommitteeId ?? null,
      related_finance_item_id: input.relatedFinanceItemId ?? null,
      related_payroll_batch_id: input.relatedPayrollBatchId ?? null,
      blocked_by_task_id: input.blockedByTaskId ?? null,
      recurrence_freq: input.recurrenceFreq ?? null,
      recurrence_interval: input.recurrenceInterval ?? 1,
      recurrence_until: input.recurrenceUntil ? new Date(input.recurrenceUntil).toISOString() : null,
      reminder_offsets: input.reminderOffsets ?? null,
      notify_emails: input.notifyEmails ?? [],
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();

  if (error || !taskRow) {
    throw new Error(friendlyError('Falha ao criar tarefa', error ?? { message: 'sem retorno' }));
  }
  const task = mapTask(taskRow as TaskRow);

  // Checklist.
  if (input.checklist && input.checklist.length > 0) {
    const rows = input.checklist
      .map((t) => t.trim())
      .filter(Boolean)
      .map((title, i) => ({ task_id: task.id, organization_id: orgId, title, position: i }));
    if (rows.length > 0) {
      const { error: cErr } = await supabase.from(CHECKLIST).insert(rows);
      if (cErr) console.error('[agenda] checklist insert failed:', cErr.message);
    }
  }

  // Side-effects.
  const dueLabel = task.dueAt ? format(task.dueAt, "dd 'de' MMM 'de' yyyy HH:mm", { locale: ptBR }) : null;
  const detailUrl = `${appOrigin()}/reunioes?task=${task.id}`;

  // Notify assignee (if someone other than the creator) + email them.
  if (task.assigneeUserId && task.assigneeUserId !== userId) {
    await notifyUser(
      supabase,
      task.assigneeUserId,
      'task_assigned',
      `Nova tarefa: ${task.title}`,
      `${userName} atribuiu a você a tarefa "${task.title}"${dueLabel ? ` (prazo ${dueLabel})` : ''}.`,
      detailUrl,
    );
    if (assigneeMember?.email) {
      const mail = taskAssignedEmail({
        title: task.title,
        assignerName: userName,
        dueLabel,
        priority: task.priority,
        description: task.description,
        detailUrl,
      });
      await sendEmail({
        subject: mail.subject,
        html: mail.html,
        recipients: [assigneeMember.email],
        related_entity_type: 'task',
        related_entity_id: task.id,
      });
    }
  }

  // Optional "notificar também" emails (notify-only).
  if (input.notifyEmails && input.notifyEmails.length > 0) {
    const mail = taskAssignedEmail({
      title: task.title,
      assignerName: userName,
      dueLabel,
      priority: task.priority,
      description: task.description,
      detailUrl,
    });
    await sendEmail({
      subject: mail.subject,
      html: mail.html,
      recipients: input.notifyEmails,
      related_entity_type: 'task',
      related_entity_id: task.id,
    });
  }

  await logAuditEvent({
    organizationId: orgId,
    action: 'task.created',
    entityType: 'task',
    entityId: task.id,
    metadata: { title: task.title, assignee: task.assigneeUserId, priority: task.priority },
  });

  return task;
}

export async function updateTaskStatus(id: string, status: TaskStatus): Promise<void> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  const update: Record<string, unknown> = { status };
  if (status === 'done') update.completed_at = new Date().toISOString();
  if (status !== 'done') update.completed_at = null;

  const { data: row, error } = await supabase.from(TASKS).update(update).eq('id', id).select('*').single();
  if (error || !row) throw new Error(friendlyError('Falha ao atualizar tarefa', error ?? { message: 'sem retorno' }));
  const task = mapTask(row as TaskRow);

  const detailUrl = `${appOrigin()}/reunioes?task=${task.id}`;
  // Notify the "other party" (creator notifies assignee and vice-versa).
  const others = new Set<string>();
  if (task.creatorUserId !== userId) others.add(task.creatorUserId);
  if (task.assigneeUserId && task.assigneeUserId !== userId) others.add(task.assigneeUserId);
  for (const uid of others) {
    await notifyUser(
      supabase,
      uid,
      'task_status',
      `Tarefa atualizada: ${task.title}`,
      `${userName} alterou o status da tarefa "${task.title}".`,
      detailUrl,
    );
  }

  // E-mail only for status changes that matter (done | blocked).
  if (others.size > 0 && (status === 'done' || status === 'blocked')) {
    try {
      const members = await listOrgMembers();
      const emails = [...others]
        .map((uid) => members.find((m) => m.userId === uid)?.email)
        .filter((e): e is string => Boolean(e));
      if (emails.length > 0) {
        const mail = taskStatusEmail({
          title: task.title,
          newStatus: status,
          changedByName: userName,
          detailUrl,
        });
        await sendEmail({
          subject: mail.subject,
          html: mail.html,
          recipients: emails,
          related_entity_type: 'task',
          related_entity_id: task.id,
        });
      }
    } catch (e) {
      console.error('[agenda] status email failed:', e instanceof Error ? e.message : e);
    }
  }

  await logAuditEvent({
    organizationId: orgId,
    action: 'task.status_changed',
    entityType: 'task',
    entityId: task.id,
    metadata: { status },
  });
}

/** Full task edit (detail drawer). */
export async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);

  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.dueAt !== undefined) update.due_at = patch.dueAt ? new Date(patch.dueAt).toISOString() : null;
  if (patch.dueAllDay !== undefined) update.due_all_day = patch.dueAllDay;
  if (patch.priority !== undefined) update.priority = patch.priority;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.relatedEventId !== undefined) update.related_event_id = patch.relatedEventId;
  if (patch.relatedProjectId !== undefined) update.related_project_id = patch.relatedProjectId;
  if (patch.relatedContractId !== undefined) update.related_contract_id = patch.relatedContractId;
  if (patch.relatedRiskId !== undefined) update.related_risk_id = patch.relatedRiskId;
  if (patch.relatedDeliberationId !== undefined) update.related_deliberation_id = patch.relatedDeliberationId;
  if (patch.relatedCommitteeId !== undefined) update.related_committee_id = patch.relatedCommitteeId;
  if (patch.relatedFinanceItemId !== undefined) update.related_finance_item_id = patch.relatedFinanceItemId;
  if (patch.relatedPayrollBatchId !== undefined) update.related_payroll_batch_id = patch.relatedPayrollBatchId;
  if (patch.blockedByTaskId !== undefined) update.blocked_by_task_id = patch.blockedByTaskId;
  if (patch.recurrenceFreq !== undefined) update.recurrence_freq = patch.recurrenceFreq;
  if (patch.recurrenceInterval !== undefined) update.recurrence_interval = patch.recurrenceInterval;
  if (patch.recurrenceUntil !== undefined) {
    update.recurrence_until = patch.recurrenceUntil ? new Date(patch.recurrenceUntil).toISOString() : null;
  }
  if (patch.reminderOffsets !== undefined) update.reminder_offsets = patch.reminderOffsets;
  if (patch.notifyEmails !== undefined) update.notify_emails = patch.notifyEmails;
  // O prazo mudou → os lembretes por token devem poder disparar de novo.
  if (patch.dueAt !== undefined) {
    update.reminder_log = {};
    update.reminder_1d_sent_at = null;
    update.reminder_overdue_sent_at = null;
  }

  const { data: row, error } = await supabase.from(TASKS).update(update).eq('id', id).select('*').single();
  if (error || !row) throw new Error(friendlyError('Falha ao atualizar tarefa', error ?? { message: 'sem retorno' }));
  const task = mapTask(row as TaskRow);

  await logAuditEvent({
    organizationId: orgId,
    action: 'task.updated',
    entityType: 'task',
    entityId: task.id,
    metadata: { fields: Object.keys(update) },
  });

  return task;
}

function nextOccurrence(from: Date, freq: RecurrenceFreq, interval: number): Date {
  const n = Math.max(1, interval);
  switch (freq) {
    case 'daily':
      return addDays(from, n);
    case 'weekly':
      return addWeeks(from, n);
    case 'monthly':
      return addMonths(from, n);
  }
}

/**
 * Marks the task as done. For recurring tasks, materializes the next
 * occurrence (only the next one is ever visible on the calendar — no cron).
 * Returns the spawned task id when a new occurrence was created.
 */
export async function completeTask(id: string): Promise<string | null> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const task = await getTaskById(id);
  await updateTaskStatus(id, 'done');
  if (!task || !task.recurrenceFreq || !task.dueAt) return null;
  // Guard against double-spawn when "concluir" is clicked twice.
  if (task.metadata?.recurrence_spawned === true || task.status === 'done') return null;

  const nextDue = nextOccurrence(task.dueAt, task.recurrenceFreq, task.recurrenceInterval);
  if (task.recurrenceUntil && nextDue > task.recurrenceUntil) return null;

  const { error: flagErr } = await supabase
    .from(TASKS)
    .update({ metadata: { ...task.metadata, recurrence_spawned: true } })
    .eq('id', id);
  if (flagErr) console.error('[agenda] recurrence flag failed:', flagErr.message);

  const { data: spawnRow, error: spawnErr } = await supabase
    .from(TASKS)
    .insert({
      organization_id: orgId,
      // RLS exige creator = auth.uid(); quem conclui passa a ser o criador
      // da próxima ocorrência.
      creator_user_id: userId,
      assignee_user_id: task.assigneeUserId,
      title: task.title,
      description: task.description,
      due_at: nextDue.toISOString(),
      due_all_day: task.dueAllDay,
      priority: task.priority,
      status: 'todo',
      related_event_id: task.relatedEventId,
      related_project_id: task.relatedProjectId,
      related_contract_id: task.relatedContractId,
      related_risk_id: task.relatedRiskId,
      related_deliberation_id: task.relatedDeliberationId,
      related_committee_id: task.relatedCommitteeId,
      related_finance_item_id: task.relatedFinanceItemId,
      related_payroll_batch_id: task.relatedPayrollBatchId,
      recurrence_freq: task.recurrenceFreq,
      recurrence_interval: task.recurrenceInterval,
      recurrence_until: task.recurrenceUntil ? task.recurrenceUntil.toISOString() : null,
      reminder_offsets: task.reminderOffsets,
      notify_emails: task.notifyEmails,
      metadata: { recurrence_parent_id: task.id },
    })
    .select('id')
    .single();
  if (spawnErr || !spawnRow) {
    console.error('[agenda] recurrence spawn failed:', spawnErr?.message);
    return null;
  }

  // Copy checklist titles (unchecked) into the new occurrence.
  if (task.checklist && task.checklist.length > 0) {
    const rows = task.checklist.map((c, i) => ({
      task_id: spawnRow.id as string,
      organization_id: orgId,
      title: c.title,
      position: i,
    }));
    const { error: cErr } = await supabase.from(CHECKLIST).insert(rows);
    if (cErr) console.error('[agenda] recurrence checklist copy failed:', cErr.message);
  }

  return spawnRow.id as string;
}

export async function reassignTask(id: string, assigneeUserId: string | null): Promise<void> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  if (assigneeUserId) {
    const members = await listOrgMembers();
    if (!members.find((m) => m.userId === assigneeUserId)) {
      throw new Error('Tarefas só podem ser atribuídas a usuários internos do grupo.');
    }
  }

  const { data: row, error } = await supabase
    .from(TASKS)
    .update({ assignee_user_id: assigneeUserId })
    .eq('id', id)
    .select('*')
    .single();
  if (error || !row) throw new Error(friendlyError('Falha ao reatribuir tarefa', error ?? { message: 'sem retorno' }));
  const task = mapTask(row as TaskRow);

  const detailUrl = `${appOrigin()}/reunioes?task=${task.id}`;
  if (assigneeUserId && assigneeUserId !== userId) {
    await notifyUser(
      supabase,
      assigneeUserId,
      'task_assigned',
      `Nova tarefa: ${task.title}`,
      `${userName} atribuiu a você a tarefa "${task.title}".`,
      detailUrl,
    );
  }

  await logAuditEvent({
    organizationId: orgId,
    action: 'task.reassigned',
    entityType: 'task',
    entityId: task.id,
    metadata: { assignee: assigneeUserId },
  });
}

/* ───────────── Checklist ───────────── */

export async function addChecklistItem(taskId: string, title: string): Promise<TaskChecklistItem> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const { count } = await supabase
    .from(CHECKLIST)
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId);
  const { data, error } = await supabase
    .from(CHECKLIST)
    .insert({ task_id: taskId, organization_id: orgId, title, position: count ?? 0 })
    .select('*')
    .single();
  if (error || !data) throw new Error(friendlyError('Falha ao adicionar item', error ?? { message: 'sem retorno' }));
  return mapChecklist(data as ChecklistRow);
}

export async function toggleChecklistItem(id: string, completed: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(CHECKLIST).update({ completed }).eq('id', id);
  if (error) throw new Error(friendlyError('Falha ao atualizar item', error));
}

/* ───────────── Comments ───────────── */

export async function listTaskComments(taskId: string): Promise<TaskComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(COMMENTS)
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(friendlyError('Falha ao carregar comentários', error));
  return (data as CommentRow[]).map(mapComment);
}

export async function addTaskComment(taskId: string, body: string): Promise<TaskComment> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(COMMENTS)
    .insert({ task_id: taskId, organization_id: orgId, author_user_id: userId, body })
    .select('*')
    .single();
  if (error || !data) throw new Error(friendlyError('Falha ao comentar', error ?? { message: 'sem retorno' }));
  const comment = mapComment(data as CommentRow);

  // Notify the other party (creator ↔ assignee), in-app only.
  try {
    const task = await getTaskById(taskId);
    if (task) {
      const detailUrl = `${appOrigin()}/reunioes?task=${taskId}`;
      const others = new Set<string>();
      if (task.creatorUserId !== userId) others.add(task.creatorUserId);
      if (task.assigneeUserId && task.assigneeUserId !== userId) others.add(task.assigneeUserId);
      for (const uid of others) {
        await notifyUser(
          supabase,
          uid,
          'task_comment',
          `Comentário em: ${task.title}`,
          `${userName}: ${body.length > 120 ? `${body.slice(0, 120)}…` : body}`,
          detailUrl,
        );
      }
    }
  } catch (e) {
    console.error('[agenda] comment notify failed:', e instanceof Error ? e.message : e);
  }

  return comment;
}

/* ───────────── E-mail dispatch status (drawer) ───────────── */

export interface EntityEmailDispatch {
  targetEmail: string;
  subject: string;
  status: EmailDispatchStatus;
  errorMessage: string | null;
  createdAt: Date;
}

export async function listEntityEmailDispatches(
  entityType: 'calendar_event' | 'task',
  entityId: string,
): Promise<EntityEmailDispatch[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('list_entity_email_dispatches', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  });
  if (error) throw new Error(friendlyError('Falha ao carregar envios', error));
  return (data ?? []).map(
    (r: { target_email: string; subject: string; status: EmailDispatchStatus; error_message: string | null; created_at: string }) => ({
      targetEmail: r.target_email,
      subject: r.subject,
      status: r.status,
      errorMessage: r.error_message,
      createdAt: toDate(r.created_at) ?? new Date(),
    }),
  );
}

export { mapNotification };
