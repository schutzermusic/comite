'use client';

/**
 * Project timeline service — Supabase-backed enterprise schedule
 * (migration 032). Mirrors the idioms of src/lib/services/agenda.ts:
 * snake_case rows, RLS-friendly errors, org/user resolution, and
 * best-effort side effects (notify + email + audit never roll back
 * the primary write).
 *
 * Requires Supabase — there is no localStorage/demo fallback for the
 * relational timeline tables.
 */

import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import { createTask, listOrgMembers } from '@/lib/services/agenda';
import type { OrgMember } from '@/lib/types/agenda';
import { timelineAssignedEmail, timelineDelayEmail } from '@/lib/agenda/email-templates';
import {
  DELAY_REASON_LABELS,
  TIMELINE_STATUS_LABELS,
  type AssignmentRole,
  type DelayLog,
  type DelayReportInput,
  type DependencyType,
  type NewDependencyInput,
  type NewTimelineItemInput,
  type TimelineDependency,
  type ScheduleImport,
  type TimelineAssignment,
  type TimelineComment,
  type TimelineItem,
} from '@/lib/types/project-timeline';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type SupabaseLike = ReturnType<typeof createClient>;

const ITEMS = 'project_timeline_items';
const ASSIGNMENTS = 'project_timeline_assignments';
const COMMENTS = 'project_timeline_comments';
const DEPENDENCIES = 'project_timeline_dependencies';
const DELAY_LOGS = 'project_delay_logs';
const IMPORTS = 'project_schedule_imports';

export function isTimelineAvailable(): boolean {
  return Boolean(
    typeof window !== 'undefined' &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/* ───────────── Row shapes ───────────── */

type ItemRow = {
  id: string;
  organization_id: string;
  project_id: string;
  parent_id: string | null;
  import_batch_id: string | null;
  original_ms_project_id: string | null;
  wbs_code: string | null;
  outline_level: number;
  row_order: number;
  type: TimelineItem['type'];
  title: string;
  description: string | null;
  planned_start: string | null;
  planned_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  forecast_start: string | null;
  forecast_finish: string | null;
  duration_minutes: number | null;
  percent_complete: number | string;
  status: TimelineItem['status'];
  priority: TimelineItem['priority'];
  responsible_user_id: string | null;
  delay_status: TimelineItem['delayStatus'];
  delay_reason_category: TimelineItem['delayReasonCategory'];
  delay_reason_text: string | null;
  delay_impact_text: string | null;
  recovery_plan_text: string | null;
  related_agenda_task_id: string | null;
  related_meeting_id: string | null;
  related_risk_id: string | null;
  related_contract_id: string | null;
  related_document_id: string | null;
  is_summary: boolean;
  is_milestone: boolean;
  is_active: boolean;
  raw_import: TimelineItem['rawImport'];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type AssignmentRow = {
  id: string;
  organization_id: string;
  project_id: string;
  timeline_item_id: string;
  user_id: string;
  role: AssignmentRole;
  assigned_by: string | null;
  assigned_at: string;
  removed_at: string | null;
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

const itemUrl = (projectId: string, itemId: string) =>
  `${appOrigin()}/projetos/${projectId}?tab=timeline&item=${itemId}`;

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
    if (error) console.error('[timeline] notify failed:', error.message);
  } catch (e) {
    console.error('[timeline] notify threw:', e instanceof Error ? e.message : e);
  }
}

async function sendEmail(payload: {
  subject: string;
  html: string;
  recipients: string[];
  related_entity_type?: string;
  related_entity_id?: string;
}): Promise<void> {
  try {
    const res = await fetch('/api/agenda/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      console.error('[timeline] email send failed:', body?.error ?? res.status);
    }
  } catch (e) {
    console.error('[timeline] email send threw:', e instanceof Error ? e.message : e);
  }
}

/* ───────────── Mappers ───────────── */

function mapAssignment(row: AssignmentRow, members?: OrgMember[]): TimelineAssignment {
  const member = members?.find((m) => m.userId === row.user_id);
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    timelineItemId: row.timeline_item_id,
    userId: row.user_id,
    role: row.role,
    assignedBy: row.assigned_by,
    assignedAt: toDate(row.assigned_at) ?? new Date(),
    removedAt: toDate(row.removed_at),
    userName: member?.fullName ?? null,
    userEmail: member?.email ?? null,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

function mapItem(row: ItemRow, assignments?: TimelineAssignment[]): TimelineItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    parentId: row.parent_id,
    importBatchId: row.import_batch_id,
    originalMsProjectId: row.original_ms_project_id,
    wbsCode: row.wbs_code,
    outlineLevel: row.outline_level,
    rowOrder: row.row_order,
    type: row.type,
    title: row.title,
    description: row.description,
    plannedStart: row.planned_start,
    plannedFinish: row.planned_finish,
    actualStart: row.actual_start,
    actualFinish: row.actual_finish,
    forecastStart: row.forecast_start,
    forecastFinish: row.forecast_finish,
    durationMinutes: row.duration_minutes,
    percentComplete: typeof row.percent_complete === 'string' ? parseFloat(row.percent_complete) : row.percent_complete,
    status: row.status,
    priority: row.priority,
    responsibleUserId: row.responsible_user_id,
    delayStatus: row.delay_status,
    delayReasonCategory: row.delay_reason_category,
    delayReasonText: row.delay_reason_text,
    delayImpactText: row.delay_impact_text,
    recoveryPlanText: row.recovery_plan_text,
    relatedAgendaTaskId: row.related_agenda_task_id,
    relatedMeetingId: row.related_meeting_id,
    relatedRiskId: row.related_risk_id,
    relatedContractId: row.related_contract_id,
    relatedDocumentId: row.related_document_id,
    isSummary: row.is_summary,
    isMilestone: row.is_milestone,
    isActive: row.is_active,
    rawImport: row.raw_import,
    createdBy: row.created_by,
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
    deletedAt: toDate(row.deleted_at),
    assignments,
  };
}

/* ───────────── Items ───────────── */

export async function listTimelineItems(projectId: string): Promise<TimelineItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ITEMS)
    .select('*')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('row_order', { ascending: true });
  if (error) throw new Error(friendlyError('Falha ao carregar cronograma', error));
  const rows = (data ?? []) as ItemRow[];
  if (rows.length === 0) return [];

  // Active assignments for all items in one query (hydrated with member info).
  let assignmentRows: AssignmentRow[] = [];
  let members: OrgMember[] = [];
  try {
    const [{ data: aData }, m] = await Promise.all([
      supabase.from(ASSIGNMENTS).select('*').eq('project_id', projectId).is('removed_at', null),
      listOrgMembers().catch(() => [] as OrgMember[]),
    ]);
    assignmentRows = (aData ?? []) as AssignmentRow[];
    members = m;
  } catch {
    // assignments are decoration — the schedule must still render
  }
  const byItem = new Map<string, TimelineAssignment[]>();
  for (const a of assignmentRows) {
    const mapped = mapAssignment(a, members);
    const list = byItem.get(a.timeline_item_id) ?? [];
    list.push(mapped);
    byItem.set(a.timeline_item_id, list);
  }
  return rows.map((r) => mapItem(r, byItem.get(r.id) ?? []));
}

export async function createTimelineItem(input: NewTimelineItemInput): Promise<TimelineItem> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  // New manual rows go to the end of the schedule.
  const { data: maxRow } = await supabase
    .from(ITEMS)
    .select('row_order')
    .eq('project_id', input.projectId)
    .order('row_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const rowOrder = ((maxRow?.row_order as number | undefined) ?? 0) + 1;

  const { data, error } = await supabase
    .from(ITEMS)
    .insert({
      organization_id: orgId,
      project_id: input.projectId,
      parent_id: input.parentId ?? null,
      wbs_code: input.wbsCode ?? null,
      outline_level: 0,
      row_order: rowOrder,
      type: input.type ?? (input.isMilestone ? 'milestone' : 'task'),
      title: input.title,
      description: input.description ?? null,
      planned_start: input.plannedStart ?? null,
      planned_finish: input.plannedFinish ?? null,
      duration_minutes: input.durationMinutes ?? null,
      percent_complete: input.percentComplete ?? 0,
      status: input.status ?? 'not_started',
      priority: input.priority ?? 'medium',
      responsible_user_id: input.responsibleUserId ?? null,
      is_milestone: input.isMilestone ?? false,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(friendlyError('Falha ao criar atividade', error ?? { message: 'sem retorno' }));
  const item = mapItem(data as ItemRow, []);

  await logAuditEvent({
    organizationId: orgId,
    action: 'timeline_item.created',
    entityType: 'project_timeline_item',
    entityId: item.id,
    metadata: { projectId: input.projectId, title: item.title },
  });
  return item;
}

export type TimelineItemPatch = Partial<
  Pick<
    TimelineItem,
    | 'title'
    | 'description'
    | 'type'
    | 'plannedStart'
    | 'plannedFinish'
    | 'actualStart'
    | 'actualFinish'
    | 'forecastStart'
    | 'forecastFinish'
    | 'durationMinutes'
    | 'percentComplete'
    | 'status'
    | 'priority'
    | 'responsibleUserId'
    | 'delayStatus'
    | 'relatedAgendaTaskId'
    | 'relatedRiskId'
    | 'isActive'
  >
>;

const PATCH_COLUMN: Record<keyof TimelineItemPatch, string> = {
  title: 'title',
  description: 'description',
  type: 'type',
  plannedStart: 'planned_start',
  plannedFinish: 'planned_finish',
  actualStart: 'actual_start',
  actualFinish: 'actual_finish',
  forecastStart: 'forecast_start',
  forecastFinish: 'forecast_finish',
  durationMinutes: 'duration_minutes',
  percentComplete: 'percent_complete',
  status: 'status',
  priority: 'priority',
  responsibleUserId: 'responsible_user_id',
  delayStatus: 'delay_status',
  relatedAgendaTaskId: 'related_agenda_task_id',
  relatedRiskId: 'related_risk_id',
  isActive: 'is_active',
};

export async function updateTimelineItem(id: string, patch: TimelineItemPatch): Promise<TimelineItem> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const column = PATCH_COLUMN[key as keyof TimelineItemPatch];
    if (column) update[column] = value;
  }
  // Completing an item closes its actuals coherently.
  if (patch.status === 'completed') {
    update.percent_complete = 100;
    update.actual_finish = (patch.actualFinish as string | null) ?? format(new Date(), 'yyyy-MM-dd');
    update.delay_status = 'on_track';
  }

  const { data, error } = await supabase.from(ITEMS).update(update).eq('id', id).select('*').single();
  if (error || !data) throw new Error(friendlyError('Falha ao atualizar atividade', error ?? { message: 'sem retorno' }));
  const item = mapItem(data as ItemRow);

  await logAuditEvent({
    organizationId: orgId,
    action: 'timeline_item.updated',
    entityType: 'project_timeline_item',
    entityId: item.id,
    metadata: { projectId: item.projectId, fields: Object.keys(patch) },
  });
  return item;
}

/* ───────────── Assignment ───────────── */

export interface AssignResponsibleOptions {
  notify: boolean;
  createAgendaTask: boolean;
  projectName?: string;
}

export async function assignResponsible(
  item: TimelineItem,
  userId: string | null,
  opts: AssignResponsibleOptions,
): Promise<TimelineItem> {
  const supabase = createClient();
  const { userId: actorId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  let member: OrgMember | undefined;
  if (userId) {
    const members = await listOrgMembers();
    member = members.find((m) => m.userId === userId);
    if (!member) throw new Error('O responsável deve ser um usuário interno do grupo.');
  }

  const { data, error } = await supabase
    .from(ITEMS)
    .update({ responsible_user_id: userId })
    .eq('id', item.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(friendlyError('Falha ao atribuir responsável', error ?? { message: 'sem retorno' }));
  let updated = mapItem(data as ItemRow, item.assignments);

  // Assignment history row (soft-close the previous responsible).
  try {
    await supabase
      .from(ASSIGNMENTS)
      .update({ removed_at: new Date().toISOString() })
      .eq('timeline_item_id', item.id)
      .eq('role', 'responsible')
      .is('removed_at', null);
    if (userId) {
      await supabase.from(ASSIGNMENTS).insert({
        organization_id: orgId,
        project_id: item.projectId,
        timeline_item_id: item.id,
        user_id: userId,
        role: 'responsible',
        assigned_by: actorId,
      });
    }
  } catch (e) {
    console.error('[timeline] assignment history failed:', e instanceof Error ? e.message : e);
  }

  const projectName = opts.projectName ?? item.projectId;
  const dueLabel = updated.plannedFinish
    ? format(new Date(`${updated.plannedFinish}T00:00:00`), "dd 'de' MMM 'de' yyyy", { locale: ptBR })
    : null;
  const detailUrl = itemUrl(item.projectId, item.id);

  if (userId && userId !== actorId && opts.notify) {
    await notifyUser(
      supabase,
      userId,
      'timeline_assignment',
      `Atividade atribuída: ${updated.title}`,
      `${userName} definiu você como responsável pela atividade "${updated.title}"${updated.wbsCode ? ` (EDT ${updated.wbsCode})` : ''} do projeto ${projectName}.`,
      detailUrl,
    );
    if (member?.email) {
      const mail = timelineAssignedEmail({
        projectName,
        taskTitle: updated.title,
        wbsCode: updated.wbsCode,
        roleLabel: 'Responsável',
        assignerName: userName,
        dueLabel,
        statusLabel: TIMELINE_STATUS_LABELS[updated.status],
        detailUrl,
      });
      await sendEmail({
        subject: mail.subject,
        html: mail.html,
        recipients: [member.email],
        related_entity_type: 'timeline_item',
        related_entity_id: item.id,
      });
    }
  }

  // Optional linked Agenda task for the responsible.
  if (userId && opts.createAgendaTask && !updated.relatedAgendaTaskId) {
    try {
      const task = await createTask({
        title: `[Cronograma] ${updated.title}`,
        description: `Atividade do cronograma do projeto ${projectName}${updated.wbsCode ? ` — EDT ${updated.wbsCode}` : ''}.`,
        dueAt: updated.plannedFinish ? `${updated.plannedFinish}T17:00` : undefined,
        priority: updated.priority === 'critical' ? 'critical' : updated.priority === 'high' ? 'high' : 'medium',
        assigneeUserId: userId,
        relatedProjectId: item.projectId,
        metadata: { related_timeline_item_id: item.id },
      });
      updated = await updateTimelineItem(item.id, { relatedAgendaTaskId: task.id });
    } catch (e) {
      console.error('[timeline] linked agenda task failed:', e instanceof Error ? e.message : e);
    }
  }

  await logAuditEvent({
    organizationId: orgId,
    action: 'timeline_item.responsible_assigned',
    entityType: 'project_timeline_item',
    entityId: item.id,
    metadata: { projectId: item.projectId, responsible: userId },
  });
  return updated;
}

export async function setExecutionTeam(
  item: TimelineItem,
  userIds: string[],
  opts: { notify: boolean; projectName?: string },
): Promise<void> {
  const supabase = createClient();
  const { userId: actorId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  const members = await listOrgMembers();
  const valid = userIds.filter((id) => members.some((m) => m.userId === id));
  if (valid.length !== userIds.length) {
    throw new Error('A equipe de execução só pode conter usuários internos do grupo.');
  }

  const current = (item.assignments ?? []).filter((a) => a.role === 'executor' && !a.removedAt);
  const currentIds = new Set(current.map((a) => a.userId));
  const nextIds = new Set(valid);

  const toRemove = current.filter((a) => !nextIds.has(a.userId));
  const toAdd = valid.filter((id) => !currentIds.has(id));

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from(ASSIGNMENTS)
      .update({ removed_at: new Date().toISOString() })
      .in('id', toRemove.map((a) => a.id));
    if (error) throw new Error(friendlyError('Falha ao remover membro da equipe', error));
  }
  if (toAdd.length > 0) {
    const { error } = await supabase.from(ASSIGNMENTS).insert(
      toAdd.map((uid) => ({
        organization_id: orgId,
        project_id: item.projectId,
        timeline_item_id: item.id,
        user_id: uid,
        role: 'executor',
        assigned_by: actorId,
      })),
    );
    if (error) throw new Error(friendlyError('Falha ao adicionar membro à equipe', error));
  }

  if (opts.notify && toAdd.length > 0) {
    const projectName = opts.projectName ?? item.projectId;
    const detailUrl = itemUrl(item.projectId, item.id);
    const dueLabel = item.plannedFinish
      ? format(new Date(`${item.plannedFinish}T00:00:00`), "dd 'de' MMM 'de' yyyy", { locale: ptBR })
      : null;
    for (const uid of toAdd) {
      if (uid === actorId) continue;
      await notifyUser(
        supabase,
        uid,
        'timeline_team',
        `Você entrou na equipe: ${item.title}`,
        `${userName} adicionou você à equipe de execução da atividade "${item.title}" do projeto ${projectName}.`,
        detailUrl,
      );
      const member = members.find((m) => m.userId === uid);
      if (member?.email) {
        const mail = timelineAssignedEmail({
          projectName,
          taskTitle: item.title,
          wbsCode: item.wbsCode,
          roleLabel: 'Equipe de execução',
          assignerName: userName,
          dueLabel,
          statusLabel: TIMELINE_STATUS_LABELS[item.status],
          detailUrl,
        });
        await sendEmail({
          subject: mail.subject,
          html: mail.html,
          recipients: [member.email],
          related_entity_type: 'timeline_item',
          related_entity_id: item.id,
        });
      }
    }
  }

  await logAuditEvent({
    organizationId: orgId,
    action: 'timeline_item.team_updated',
    entityType: 'project_timeline_item',
    entityId: item.id,
    metadata: { projectId: item.projectId, added: toAdd.length, removed: toRemove.length },
  });
}

/* ───────────── Delay workflow ───────────── */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitDelayReport(
  item: TimelineItem,
  report: DelayReportInput,
  opts: { projectName?: string; projectManagerUserId?: string | null },
): Promise<TimelineItem> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  const oldStatus = item.status;
  const oldForecast = item.forecastFinish;

  // 1) Item update (delay fields + status + forecast).
  const { data, error } = await supabase
    .from(ITEMS)
    .update({
      status: report.newStatus,
      delay_status: report.newStatus === 'blocked' ? 'blocked' : 'delayed',
      delay_reason_category: report.reasonCategory,
      delay_reason_text: report.reasonText,
      delay_impact_text: report.impactText,
      recovery_plan_text: report.recoveryPlanText,
      forecast_finish: report.newForecastFinish,
    })
    .eq('id', item.id)
    .select('*')
    .single();
  if (error || !data) throw new Error(friendlyError('Falha ao registrar atraso', error ?? { message: 'sem retorno' }));
  const updated = mapItem(data as ItemRow, item.assignments);

  // 2) Immutable delay log.
  const { error: logErr } = await supabase.from(DELAY_LOGS).insert({
    organization_id: orgId,
    project_id: item.projectId,
    timeline_item_id: item.id,
    reported_by: userId,
    old_status: oldStatus,
    new_status: report.newStatus,
    reason_category: report.reasonCategory,
    reason_text: report.reasonText,
    impact_text: report.impactText,
    recovery_plan_text: report.recoveryPlanText,
    support_needed_text: report.supportNeededText ?? null,
    contract_impact: report.contractImpact ?? false,
    old_forecast_finish: oldForecast,
    new_forecast_finish: report.newForecastFinish,
  });
  if (logErr) console.error('[timeline] delay log insert failed:', logErr.message);

  // 3) Notify responsible + project manager (best-effort).
  const projectName = opts.projectName ?? item.projectId;
  const detailUrl = itemUrl(item.projectId, item.id);
  const statusLabel = TIMELINE_STATUS_LABELS[report.newStatus];
  const reasonLabel = DELAY_REASON_LABELS[report.reasonCategory];
  const forecastLabel = format(new Date(`${report.newForecastFinish}T00:00:00`), "dd 'de' MMM 'de' yyyy", {
    locale: ptBR,
  });

  const recipients = new Set<string>();
  if (updated.responsibleUserId && updated.responsibleUserId !== userId) recipients.add(updated.responsibleUserId);
  const pmId = opts.projectManagerUserId;
  if (pmId && UUID_RE.test(pmId) && pmId !== userId) recipients.add(pmId);
  if (!pmId) console.warn('[timeline] projeto sem gestor identificável — notificação de atraso só para o responsável.');

  let members: OrgMember[] = [];
  try {
    members = await listOrgMembers();
  } catch {
    /* e-mail hydration only */
  }
  for (const uid of recipients) {
    await notifyUser(
      supabase,
      uid,
      'timeline_delay',
      `Atraso reportado: ${updated.title}`,
      `${userName} reportou ${statusLabel.toLowerCase()} na atividade "${updated.title}" (${reasonLabel}). Novo término previsto: ${forecastLabel}.`,
      detailUrl,
    );
    const member = members.find((m) => m.userId === uid);
    if (member?.email) {
      const mail = timelineDelayEmail({
        projectName,
        taskTitle: updated.title,
        wbsCode: updated.wbsCode,
        statusLabel,
        reasonLabel,
        newForecastLabel: forecastLabel,
        reportedByName: userName,
        actionRequired: false,
        detailUrl,
      });
      await sendEmail({
        subject: mail.subject,
        html: mail.html,
        recipients: [member.email],
        related_entity_type: 'timeline_item',
        related_entity_id: item.id,
      });
    }
  }

  await logAuditEvent({
    organizationId: orgId,
    action: 'timeline_item.delay_reported',
    entityType: 'project_timeline_item',
    entityId: item.id,
    metadata: {
      projectId: item.projectId,
      reason: report.reasonCategory,
      newStatus: report.newStatus,
      newForecastFinish: report.newForecastFinish,
    },
  });
  return updated;
}

export async function listDelayLogs(timelineItemId: string): Promise<DelayLog[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(DELAY_LOGS)
    .select('*')
    .eq('timeline_item_id', timelineItemId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(friendlyError('Falha ao carregar histórico de atrasos', error));

  let members: OrgMember[] = [];
  try {
    members = await listOrgMembers();
  } catch {
    /* names only */
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    timelineItemId: row.timeline_item_id as string,
    reportedBy: (row.reported_by as string | null) ?? null,
    oldStatus: (row.old_status as string | null) ?? null,
    newStatus: (row.new_status as string | null) ?? null,
    reasonCategory: (row.reason_category as DelayLog['reasonCategory']) ?? null,
    reasonText: (row.reason_text as string | null) ?? null,
    impactText: (row.impact_text as string | null) ?? null,
    recoveryPlanText: (row.recovery_plan_text as string | null) ?? null,
    supportNeededText: (row.support_needed_text as string | null) ?? null,
    contractImpact: Boolean(row.contract_impact),
    oldForecastFinish: (row.old_forecast_finish as string | null) ?? null,
    newForecastFinish: (row.new_forecast_finish as string | null) ?? null,
    createdAt: toDate(row.created_at as string) ?? new Date(),
    reporterName: members.find((m) => m.userId === row.reported_by)?.fullName ?? null,
  }));
}

/* ───────────── Comments ───────────── */

export async function listComments(timelineItemId: string): Promise<TimelineComment[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(COMMENTS)
    .select('*')
    .eq('timeline_item_id', timelineItemId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(friendlyError('Falha ao carregar comentários', error));

  let members: OrgMember[] = [];
  try {
    members = await listOrgMembers();
  } catch {
    /* names only */
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    timelineItemId: row.timeline_item_id as string,
    authorUserId: row.author_user_id as string,
    body: row.body as string,
    createdAt: toDate(row.created_at as string) ?? new Date(),
    authorName: members.find((m) => m.userId === row.author_user_id)?.fullName ?? null,
  }));
}

export async function addComment(item: TimelineItem, body: string): Promise<TimelineComment> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Comentário vazio.');

  const { data, error } = await supabase
    .from(COMMENTS)
    .insert({
      organization_id: orgId,
      project_id: item.projectId,
      timeline_item_id: item.id,
      author_user_id: userId,
      body: trimmed,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(friendlyError('Falha ao comentar', error ?? { message: 'sem retorno' }));

  return {
    id: data.id as string,
    organizationId: orgId,
    projectId: item.projectId,
    timelineItemId: item.id,
    authorUserId: userId,
    body: trimmed,
    createdAt: toDate(data.created_at as string) ?? new Date(),
    authorName: userName,
  };
}

/* ───────────── Imports ───────────── */

export async function listImports(projectId: string): Promise<ScheduleImport[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(IMPORTS)
    .select('*')
    .eq('project_id', projectId)
    .order('imported_at', { ascending: false });
  if (error) throw new Error(friendlyError('Falha ao carregar importações', error));
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    organizationId: row.organization_id as string,
    projectId: row.project_id as string,
    sourceFileName: (row.source_file_name as string | null) ?? null,
    sourceFilePath: (row.source_file_path as string | null) ?? null,
    sourceFileHash: row.source_file_hash as string,
    sourceType: row.source_type as ScheduleImport['sourceType'],
    scheduleVersion: row.schedule_version as number,
    importedBy: (row.imported_by as string | null) ?? null,
    importedAt: toDate(row.imported_at as string) ?? new Date(),
    parseStatus: row.parse_status as ScheduleImport['parseStatus'],
    parserUsed: (row.parser_used as ScheduleImport['parserUsed']) ?? 'deterministic',
    parseSummary: (row.parse_summary as Record<string, unknown>) ?? {},
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
  }));
}

/* ───────────── Dependencies (migration 032) ───────────── */

/**
 * Lê as dependências do projeto. NUNCA lança: uma falha de RLS aqui não pode
 * apagar o Gantt inteiro — as setas são um enriquecimento, não o dado
 * principal. Mesmo contrato da hidratação de assignments em listTimelineItems.
 */
export async function listTimelineDependencies(projectId: string): Promise<TimelineDependency[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(DEPENDENCIES)
      .select('*')
      .eq('project_id', projectId);
    if (error) return [];
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      organizationId: row.organization_id as string,
      projectId: row.project_id as string,
      predecessorId: row.predecessor_id as string,
      successorId: row.successor_id as string,
      type: (row.type as DependencyType) ?? 'FS',
      lagMinutes: (row.lag_minutes as number | null) ?? 0,
      createdAt: toDate(row.created_at as string) ?? new Date(),
    }));
  } catch {
    return [];
  }
}

export async function createDependency(input: NewDependencyInput): Promise<TimelineDependency> {
  if (input.predecessorId === input.successorId) {
    throw new Error('Uma atividade não pode depender de si mesma.');
  }
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(DEPENDENCIES)
    .insert({
      organization_id: orgId,
      project_id: input.projectId,
      predecessor_id: input.predecessorId,
      successor_id: input.successorId,
      type: input.type ?? 'FS',
      lag_minutes: input.lagMinutes ?? 0,
    })
    .select('*')
    .single();

  // 23505 = unique_violation: o par predecessora/sucessora já existe.
  if (error?.code === '23505') throw new Error('Essa dependência já existe.');
  if (error || !data) throw new Error(friendlyError('Falha ao criar dependência', error ?? {}));

  return {
    id: data.id as string,
    organizationId: data.organization_id as string,
    projectId: data.project_id as string,
    predecessorId: data.predecessor_id as string,
    successorId: data.successor_id as string,
    type: (data.type as DependencyType) ?? 'FS',
    lagMinutes: (data.lag_minutes as number | null) ?? 0,
    createdAt: toDate(data.created_at as string) ?? new Date(),
  };
}

export async function updateDependency(
  id: string,
  patch: { type?: DependencyType; lagMinutes?: number },
): Promise<void> {
  const supabase = createClient();
  const payload: Record<string, unknown> = {};
  if (patch.type !== undefined) payload.type = patch.type;
  if (patch.lagMinutes !== undefined) payload.lag_minutes = patch.lagMinutes;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from(DEPENDENCIES).update(payload).eq('id', id);
  if (error) throw new Error(friendlyError('Falha ao atualizar dependência', error));
}

export async function deleteDependency(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(DEPENDENCIES).delete().eq('id', id);
  if (error) throw new Error(friendlyError('Falha ao remover dependência', error));
}

/**
 * Últimos atrasos do PROJETO inteiro, para o feed de eventos.
 * Uma query só — o feed nunca faz fan-out por item (seria N+1).
 */
export async function listDelayLogsByProject(projectId: string, limit = 30): Promise<DelayLog[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(DELAY_LOGS)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];

    let members: OrgMember[] = [];
    try {
      members = await listOrgMembers();
    } catch {
      /* names only */
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      organizationId: row.organization_id as string,
      projectId: row.project_id as string,
      timelineItemId: row.timeline_item_id as string,
      reportedBy: (row.reported_by as string | null) ?? null,
      oldStatus: (row.old_status as string | null) ?? null,
      newStatus: (row.new_status as string | null) ?? null,
      reasonCategory: (row.reason_category as DelayLog['reasonCategory']) ?? null,
      reasonText: (row.reason_text as string | null) ?? null,
      impactText: (row.impact_text as string | null) ?? null,
      recoveryPlanText: (row.recovery_plan_text as string | null) ?? null,
      supportNeededText: (row.support_needed_text as string | null) ?? null,
      contractImpact: Boolean(row.contract_impact),
      oldForecastFinish: (row.old_forecast_finish as string | null) ?? null,
      newForecastFinish: (row.new_forecast_finish as string | null) ?? null,
      createdAt: toDate(row.created_at as string) ?? new Date(),
      reporterName: members.find((m) => m.userId === row.reported_by)?.fullName ?? null,
    }));
  } catch {
    return [];
  }
}
