import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { buildJourneyDaySummary, eachDateBetween, resolveJourneySchedule } from '@/lib/services/journey-engine';
import type {
  JourneyBalanceApproval,
  JourneyClosingPeriod,
  JourneyScheduleException,
  JourneyShiftAssignment,
  JourneyShiftTemplate,
} from '@/lib/types/journey-management';
import type { AttendancePunch } from '@/lib/types/people';
import { createClient } from '@/utils/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

function monthBounds(month: string): [string, string] {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Competência inválida');
  const [year, value] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

function time(value: unknown): string {
  return String(value ?? '').slice(0, 5);
}

function template(row: Row): JourneyShiftTemplate {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    weekdays: (row.weekdays as number[]) ?? [],
    startTime: time(row.start_time),
    endTime: time(row.end_time),
    breakMinutes: Number(row.break_minutes),
    toleranceBeforeMinutes: Number(row.tolerance_before_minutes),
    toleranceAfterMinutes: Number(row.tolerance_after_minutes),
    timezone: String(row.timezone),
    active: Boolean(row.active),
  };
}

function assignment(row: Row): JourneyShiftAssignment {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    personId: String(row.person_id),
    shiftTemplateId: String(row.shift_template_id),
    projectId: row.project_id ? String(row.project_id) : null,
    validFrom: String(row.valid_from),
    validUntil: row.valid_until ? String(row.valid_until) : null,
    active: Boolean(row.active),
  };
}

function scheduleException(row: Row): JourneyScheduleException {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    personId: String(row.person_id),
    workDate: String(row.work_date),
    type: row.type as JourneyScheduleException['type'],
    startTime: row.start_time ? time(row.start_time) : null,
    endTime: row.end_time ? time(row.end_time) : null,
    breakMinutes: row.break_minutes == null ? null : Number(row.break_minutes),
    toleranceBeforeMinutes: row.tolerance_before_minutes == null ? null : Number(row.tolerance_before_minutes),
    toleranceAfterMinutes: row.tolerance_after_minutes == null ? null : Number(row.tolerance_after_minutes),
    reason: String(row.reason),
  };
}

function approval(row: Row): JourneyBalanceApproval {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    personId: String(row.person_id),
    workDate: String(row.work_date),
    provisionalMinutes: Number(row.provisional_minutes),
    status: row.status as JourneyBalanceApproval['status'],
    reason: row.reason ? String(row.reason) : null,
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
  };
}

function closing(row: Row): JourneyClosingPeriod {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    status: row.status as JourneyClosingPeriod['status'],
    managerReviewAt: row.manager_review_at ? String(row.manager_review_at) : null,
    rhReviewAt: row.rh_review_at ? String(row.rh_review_at) : null,
    closedAt: row.closed_at ? String(row.closed_at) : null,
    reopenedAt: row.reopened_at ? String(row.reopened_at) : null,
    reopenReason: row.reopen_reason ? String(row.reopen_reason) : null,
  };
}

function punch(row: Row): AttendancePunch {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    personId: String(row.person_id),
    type: row.type as AttendancePunch['type'],
    occurredAt: String(row.occurred_at),
    receivedAt: String(row.received_at),
    timezone: String(row.timezone),
    source: row.source as AttendancePunch['source'],
    status: row.status as AttendancePunch['status'],
    originalPunchId: row.original_punch_id ? String(row.original_punch_id) : null,
    correctionReason: row.correction_reason ? String(row.correction_reason) : null,
    correctedBy: row.corrected_by ? String(row.corrected_by) : null,
    clientEventId: row.client_event_id ? String(row.client_event_id) : null,
    notes: row.notes ? String(row.notes) : null,
    nsr: row.nsr == null ? null : Number(row.nsr),
    integrityHash: row.integrity_hash ? String(row.integrity_hash) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

async function permission(supabase: Awaited<ReturnType<typeof createClient>>, key: string) {
  const { data } = await supabase.rpc('current_user_has_permission', { permission_key: key });
  if (data) return true;
  const { data: admin } = await supabase.rpc('current_user_is_admin');
  return Boolean(admin);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [value.message, value.details, value.hint]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    if (parts.length) return [...new Set(parts)].join(' — ');
    if (typeof value.code === 'string') return `Erro do banco (${value.code})`;
  }
  return 'Erro inesperado ao processar a Jornada';
}

function fail(error: unknown, status = 500) {
  const message = errorMessage(error);
  console.error('[api/workforce/journey]', message);
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(req: Request) {
  const guard = await requireApiPermission('people.attendance_view', { allowAdmin: true });
  if (!guard.ok) {
    const manage = await requireApiPermission('people.attendance_manage', { allowAdmin: true });
    if (!manage.ok) return guard.response;
  }

  try {
    const supabase = await createClient();
    const params = new URL(req.url).searchParams;
    const month = params.get('month') ?? new Date().toISOString().slice(0, 7);
    const page = Math.max(1, Number(params.get('page') ?? 1));
    const pageSize = Math.min(200, Math.max(10, Number(params.get('pageSize') ?? 100)));
    const [start, end] = monthBounds(month);
    const startIso = `${start}T00:00:00.000Z`;
    const endIso = `${end}T23:59:59.999Z`;

    const peopleResult = await supabase.rpc('list_accessible_journey_people');
    if (peopleResult.error) throw peopleResult.error;
    const people = ((peopleResult.data ?? []) as Row[]).map((row) => ({
      id: String(row.id),
      fullName: String(row.full_name),
      department: row.department ? String(row.department) : null,
      jobTitle: row.job_title ? String(row.job_title) : null,
      weeklyHours: Number(row.weekly_hours ?? 44),
      managerPersonId: row.manager_person_id ? String(row.manager_person_id) : null,
      status: String(row.status),
    }));
    const personIds = people.map((person) => person.id);

    const empty = { data: [] as Row[], error: null };
    const [
      templatesResult,
      assignmentsResult,
      exceptionsResult,
      approvalsResult,
      closingResult,
      punchesResult,
      entriesResult,
      permissions,
    ] = await Promise.all([
      supabase.from('journey_shift_templates').select('*').eq('active', true).order('name'),
      personIds.length
        ? supabase.from('journey_shift_assignments').select('*').in('person_id', personIds).eq('active', true).lte('valid_from', end).or(`valid_until.is.null,valid_until.gte.${start}`)
        : Promise.resolve(empty),
      personIds.length
        ? supabase.from('journey_schedule_exceptions').select('*').in('person_id', personIds).gte('work_date', start).lte('work_date', end)
        : Promise.resolve(empty),
      personIds.length
        ? supabase.from('journey_balance_approvals').select('*').in('person_id', personIds).gte('work_date', start).lte('work_date', end)
        : Promise.resolve(empty),
      supabase.from('journey_closing_periods').select('*').eq('period_start', start).eq('period_end', end).maybeSingle(),
      personIds.length
        ? supabase.from('attendance_punches').select('*').in('person_id', personIds).gte('occurred_at', startIso).lte('occurred_at', endIso).order('occurred_at')
        : Promise.resolve(empty),
      personIds.length
        ? supabase.from('time_entries').select('person_id, work_date, minutes').in('person_id', personIds).gte('work_date', start).lte('work_date', end).neq('status', 'rejected')
        : Promise.resolve(empty),
      Promise.all([
        permission(supabase, 'people.attendance_manage'),
        permission(supabase, 'people.attendance_approve'),
        permission(supabase, 'people.attendance_schedule_manage'),
        permission(supabase, 'people.attendance_scope_admin'),
        permission(supabase, 'people.attendance_close'),
      ]),
    ]);

    for (const result of [templatesResult, assignmentsResult, exceptionsResult, approvalsResult, punchesResult]) {
      if (result.error) throw result.error;
    }

    const templates = ((templatesResult.data ?? []) as Row[]).map(template);
    const assignments = ((assignmentsResult.data ?? []) as Row[]).map(assignment);
    const scheduleExceptions = ((exceptionsResult.data ?? []) as Row[]).map(scheduleException);
    const approvals = ((approvalsResult.data ?? []) as Row[]).map(approval);
    const punches = ((punchesResult.data ?? []) as Row[]).map(punch);
    const allDates = eachDateBetween(start, end);
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const punchesByKey = new Map<string, AttendancePunch[]>();
    const openSequenceByPerson = new Map<string, string>();
    for (const item of punches.filter((value) => value.status === 'accepted' || value.status === 'under_review')) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: item.timezone }).format(new Date(item.occurredAt));
      const localKey = `${item.personId}:${date}`;
      const key = item.type === 'clock_in'
        ? localKey
        : (openSequenceByPerson.get(item.personId) ?? localKey);
      punchesByKey.set(key, [...(punchesByKey.get(key) ?? []), item]);
      if (item.type === 'clock_in') openSequenceByPerson.set(item.personId, key);
      if (item.type === 'clock_out') openSequenceByPerson.delete(item.personId);
    }
    const reportedByKey = new Map<string, number>();
    for (const row of (entriesResult.data ?? []) as Row[]) {
      const key = `${String(row.person_id)}:${String(row.work_date)}`;
      reportedByKey.set(key, (reportedByKey.get(key) ?? 0) + Number(row.minutes));
    }
    const approvalByKey = new Map(approvals.map((item) => [`${item.personId}:${item.workDate}`, item]));
    const exceptionByKey = new Map(scheduleExceptions.map((item) => [`${item.personId}:${item.workDate}`, item]));

    const days = people.flatMap((person) =>
      allDates.flatMap((date) => {
        const key = `${person.id}:${date}`;
        const resolved = resolveJourneySchedule(person.id, date, templates, assignments, scheduleExceptions);
        const dayPunches = punchesByKey.get(key) ?? [];
        const reportedMinutes = reportedByKey.get(key) ?? 0;
        const planned = exceptionByKey.get(key);
        if (!resolved && dayPunches.length === 0 && reportedMinutes === 0 && date !== today && !planned) return [];
        const summary = buildJourneyDaySummary({
          personId: person.id,
          personName: person.fullName,
          department: person.department,
          date,
          schedule: resolved,
          punches: dayPunches,
          approval: approvalByKey.get(key),
          reportedMinutes,
        });
        if (planned?.type === 'day_off' || planned?.type === 'planned_absence') {
          summary.status = 'excused';
          summary.exceptions = [];
        }
        return [summary];
      }),
    ).sort((a, b) => b.date.localeCompare(a.date) || a.personName.localeCompare(b.personName));

    const total = days.length;
    const pagedDays = days.slice((page - 1) * pageSize, page * pageSize);
    const closingPeriod = closingResult.data ? closing(closingResult.data as Row) : null;
    let managerReviews: Row[] = [];
    if (closingPeriod) {
      const result = await supabase
        .from('journey_manager_period_reviews')
        .select('id, manager_person_id, status, submitted_at')
        .eq('closing_period_id', closingPeriod.id);
      if (result.error) throw result.error;
      managerReviews = (result.data ?? []) as Row[];
    }
    let managerScopes: Array<{
      id: string;
      organizationId: string;
      managerPersonId: string;
      accessMode: 'direct_team' | 'projects' | 'both';
      active: boolean;
      projectIds: string[];
    }> = [];
    let projects: Array<{ id: string; name: string }> = [];
    if (permissions[3]) {
      const [scopeResult, projectResult] = await Promise.all([
        supabase
          .from('journey_manager_scopes')
          .select('id, organization_id, manager_person_id, access_mode, active, journey_manager_scope_projects(project_id)')
          .order('created_at'),
        supabase.from('projects').select('id, project').order('id'),
      ]);
      if (scopeResult.error) throw scopeResult.error;
      if (projectResult.error) throw projectResult.error;
      managerScopes = ((scopeResult.data ?? []) as unknown as Array<Row & {
        journey_manager_scope_projects?: Array<{ project_id: string }>;
      }>).map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        managerPersonId: String(row.manager_person_id),
        accessMode: String(row.access_mode) as 'direct_team' | 'projects' | 'both',
        active: Boolean(row.active),
        projectIds: (row.journey_manager_scope_projects ?? []).map((item) => item.project_id),
      }));
      projects = ((projectResult.data ?? []) as unknown as Array<{
        id: string;
        project: { nome?: string; codigo?: string } | null;
      }>).map((row) => ({
        id: row.id,
        name: row.project?.nome || row.project?.codigo || row.id,
      }));
    }

    return NextResponse.json({
      ok: true,
      data: {
        month,
        people,
        days: pagedDays,
        templates,
        assignments,
        scheduleExceptions,
        approvals,
        closingPeriod,
        managerReviews: managerReviews.map((row) => ({
          id: String(row.id),
          managerPersonId: String(row.manager_person_id),
          status: String(row.status),
          submittedAt: row.submitted_at ? String(row.submitted_at) : null,
        })),
        managerScopes,
        projects,
        reviewCount: punches.filter((item) => item.status === 'under_review').length,
        permissions: {
          canManage: permissions[0],
          canApprove: permissions[1],
          canManageSchedules: permissions[2],
          canAdminScopes: permissions[3],
          canClose: permissions[4],
        },
        pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: Request) {
  const guard = await requireApiPermission('people.attendance_manage', { allowAdmin: true });
  if (!guard.ok) {
    const view = await requireApiPermission('people.attendance_view', { allowAdmin: true });
    if (!view.ok) return guard.response;
  }
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) return fail(new Error('Não autenticado'), 401);
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const { data: profile } = await supabase.from('profiles').select('organization_id').eq('user_id', userId).maybeSingle();
    const organizationId = profile?.organization_id as string | undefined;
    if (!organizationId) return fail(new Error('Usuário sem organização'), 403);

    if (action === 'correct') {
      const { data, error } = await supabase.rpc('correct_attendance_punch', {
        p_original_punch_id: body.punchId,
        p_new_occurred_at: body.occurredAt,
        p_reason: body.reason,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data });
    }
    if (action === 'decide_balance') {
      const items = Array.isArray(body.items) ? body.items as Row[] : [];
      if (!items.length) return fail(new Error('Selecione ao menos um saldo'), 400);
      for (const item of items) {
        const { error } = await supabase.rpc('decide_journey_balance', {
          p_person_id: item.personId,
          p_work_date: item.workDate,
          p_minutes: item.minutes,
          p_decision: body.decision,
          p_reason: body.reason ?? null,
        });
        if (error) throw error;
      }
      return NextResponse.json({ ok: true, count: items.length });
    }
    if (action === 'transition_closing') {
      const [periodStart, periodEnd] = monthBounds(String(body.month));
      const { data, error } = await supabase.rpc('transition_journey_closing_period', {
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_action: body.transition,
        p_reason: body.reason ?? null,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true, period: data });
    }
    if (action === 'create_template') {
      const { data, error } = await supabase.from('journey_shift_templates').insert({
        organization_id: organizationId,
        name: body.name,
        weekdays: body.weekdays,
        start_time: body.startTime,
        end_time: body.endTime,
        break_minutes: body.breakMinutes,
        tolerance_before_minutes: body.toleranceBeforeMinutes,
        tolerance_after_minutes: body.toleranceAfterMinutes,
        timezone: body.timezone ?? 'America/Sao_Paulo',
        created_by: userId,
      }).select('id').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.id });
    }
    if (action === 'assign_shift') {
      const { data, error } = await supabase.from('journey_shift_assignments').insert({
        organization_id: organizationId,
        person_id: body.personId,
        shift_template_id: body.shiftTemplateId,
        project_id: body.projectId || null,
        valid_from: body.validFrom,
        valid_until: body.validUntil || null,
        created_by: userId,
      }).select('id').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.id });
    }
    if (action === 'create_exception') {
      const { data, error } = await supabase.from('journey_schedule_exceptions').upsert({
        organization_id: organizationId,
        person_id: body.personId,
        work_date: body.workDate,
        type: body.type,
        start_time: body.startTime || null,
        end_time: body.endTime || null,
        break_minutes: body.breakMinutes ?? null,
        reason: body.reason,
        created_by: userId,
      }, { onConflict: 'organization_id,person_id,work_date' }).select('id').single();
      if (error) throw error;
      return NextResponse.json({ ok: true, id: data.id });
    }
    if (action === 'save_scope') {
      const { data: scope, error } = await supabase.from('journey_manager_scopes').upsert({
        organization_id: organizationId,
        manager_person_id: body.managerPersonId,
        access_mode: body.accessMode,
        active: body.active !== false,
        created_by: userId,
      }, { onConflict: 'organization_id,manager_person_id' }).select('id').single();
      if (error) throw error;
      const { error: deleteError } = await supabase.from('journey_manager_scope_projects').delete().eq('scope_id', scope.id);
      if (deleteError) throw deleteError;
      const projectIds = Array.isArray(body.projectIds) ? body.projectIds.map(String) : [];
      if (projectIds.length) {
        const { error: projectError } = await supabase.from('journey_manager_scope_projects').insert(
          projectIds.map((projectId) => ({ scope_id: scope.id, project_id: projectId })),
        );
        if (projectError) throw projectError;
      }
      return NextResponse.json({ ok: true, id: scope.id });
    }
    return fail(new Error('Ação inválida'), 400);
  } catch (error) {
    return fail(error);
  }
}
