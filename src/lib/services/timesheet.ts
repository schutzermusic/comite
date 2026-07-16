/**
 * Timesheet service (migration 041) — web timer + manual entries,
 * consolidation per person/project/day, exception-based approval.
 * Clean submissions auto-approve; flagged ones join the approval
 * queue (/workforce-cost/aprovacoes). Exception flags are computed in
 * ONE place (computeExceptionFlags) so client and future revisions
 * never diverge.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  Person,
  ProjectWorkSession,
  TimeEntry,
  TimeEntryStatus,
  TimesheetExceptionFlag,
  TimesheetReconciliation,
  WorkSessionSource,
  WorkSessionStatus,
} from '@/lib/types/people';
import {
  getCurrentOrgAndUser,
  getCurrentPerson,
  mapPersonRow,
  rlsFriendlyMessage,
  type PersonRow,
} from './people';
import { listAllocationsByPerson, LIVE_ALLOCATION_STATUSES } from './allocations';
import { monthBounds } from './capacity';

export const SESSIONS_TABLE = 'project_work_sessions';
export const ENTRIES_TABLE = 'time_entries';

/* ─────────────────────────────────────────────────────────────
   Row shapes + mapping
   ───────────────────────────────────────────────────────────── */

type SessionRow = {
  id: string;
  organization_id: string;
  person_id: string;
  project_id: string;
  allocation_id: string | null;
  timeline_item_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  description: string | null;
  source: WorkSessionSource;
  status: WorkSessionStatus;
  time_entry_id: string | null;
  created_at: string;
  updated_at: string;
};

function mapSessionRow(row: SessionRow): ProjectWorkSession {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    projectId: row.project_id,
    allocationId: row.allocation_id,
    timelineItemId: row.timeline_item_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMinutes: row.duration_minutes,
    description: row.description,
    source: row.source,
    status: row.status,
    timeEntryId: row.time_entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type EntryRow = {
  id: string;
  organization_id: string;
  person_id: string;
  project_id: string;
  allocation_id: string | null;
  timeline_item_id: string | null;
  work_date: string;
  minutes: number;
  description: string | null;
  source_session_id: string | null;
  status: TimeEntryStatus;
  exception_flags: TimesheetExceptionFlag[] | null;
  auto_approved: boolean;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  hourly_cost_cents: number | null;
  cost_cents: number | null;
  created_at: string;
  updated_at: string;
  people?: PersonRow | null;
};

function mapEntryRow(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    projectId: row.project_id,
    allocationId: row.allocation_id,
    timelineItemId: row.timeline_item_id,
    workDate: row.work_date,
    minutes: row.minutes,
    description: row.description,
    sourceSessionId: row.source_session_id,
    status: row.status,
    exceptionFlags: Array.isArray(row.exception_flags) ? row.exception_flags : [],
    autoApproved: row.auto_approved,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason,
    hourlyCostCents: row.hourly_cost_cents,
    costCents: row.cost_cents,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    person: row.people ? mapPersonRow(row.people) : undefined,
  };
}

const ENTRY_SELECT_WITH_PERSON = '*, people(*)';

/* ─────────────────────────────────────────────────────────────
   Timer (work sessions)
   ───────────────────────────────────────────────────────────── */

async function requireCurrentPerson(): Promise<Person> {
  const person = await getCurrentPerson();
  if (!person) {
    throw new Error(
      'Seu usuário não está vinculado a um cadastro de pessoa. Peça ao RH para vincular em Pessoas & Custos → Pessoas.',
    );
  }
  return person;
}

export async function getRunningSession(): Promise<ProjectWorkSession | null> {
  const person = await getCurrentPerson();
  if (!person) return null;
  const supabase = createClient();
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .select('*')
    .eq('person_id', person.id)
    .eq('status', 'running')
    .maybeSingle();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar cronômetro', error));
  return data ? mapSessionRow(data as SessionRow) : null;
}

/**
 * Starts the timer on a project. If another session is running,
 * stops it first (project switch = stop + start).
 */
export async function startSession(input: {
  projectId: string;
  timelineItemId?: string | null;
  description?: string | null;
}): Promise<ProjectWorkSession> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const person = await requireCurrentPerson();

  const running = await getRunningSession();
  if (running) await stopSession(running.id);

  // attach the person's live allocation on this project, if any
  const allocations = await listAllocationsByPerson(person.id);
  const today = new Date().toISOString().slice(0, 10);
  const allocation = allocations.find(
    (a) =>
      a.projectId === input.projectId &&
      LIVE_ALLOCATION_STATUSES.includes(a.status) &&
      a.startDate <= today &&
      (a.endDate == null || a.endDate >= today),
  );

  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .insert({
      organization_id: orgId,
      person_id: person.id,
      project_id: input.projectId,
      allocation_id: allocation?.id ?? null,
      timeline_item_id: input.timelineItemId ?? null,
      description: input.description ?? null,
      source: 'web_timer',
      status: 'running',
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error('Já existe um cronômetro em andamento. Encerre-o antes de iniciar outro.');
    }
    throw new Error(rlsFriendlyMessage('Erro ao iniciar cronômetro', error));
  }
  return mapSessionRow(data as SessionRow);
}

export async function stopSession(sessionId: string): Promise<ProjectWorkSession> {
  const supabase = createClient();

  const { data: current, error: currentError } = await supabase
    .from(SESSIONS_TABLE)
    .select('*')
    .eq('id', sessionId)
    .single();
  if (currentError) throw new Error(rlsFriendlyMessage('Erro ao carregar sessão', currentError));

  const startedAt = new Date((current as SessionRow).started_at);
  const endedAt = new Date();
  const minutes = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));

  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .update({
      ended_at: endedAt.toISOString(),
      duration_minutes: minutes,
      status: 'draft',
    })
    .eq('id', sessionId)
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao encerrar cronômetro', error));
  return mapSessionRow(data as SessionRow);
}

export async function discardSession(sessionId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(SESSIONS_TABLE)
    .update({ status: 'discarded' })
    .eq('id', sessionId);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao descartar sessão', error));
}

export async function listMyDraftSessions(): Promise<ProjectWorkSession[]> {
  const person = await getCurrentPerson();
  if (!person) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from(SESSIONS_TABLE)
    .select('*')
    .eq('person_id', person.id)
    .eq('status', 'draft')
    .order('started_at', { ascending: false });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar sessões', error));
  return (data ?? []).map((row) => mapSessionRow(row as SessionRow));
}

/* ─────────────────────────────────────────────────────────────
   Consolidation — draft sessions -> one time_entry per
   person/project/local day. Sessions crossing midnight are
   attributed to the day they STARTED (local), documented behavior.
   ───────────────────────────────────────────────────────────── */

function localDateOf(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function consolidateMySessions(): Promise<TimeEntry[]> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const person = await requireCurrentPerson();
  const sessions = await listMyDraftSessions();
  if (sessions.length === 0) return [];

  // group by project + local start day
  const groups = new Map<string, ProjectWorkSession[]>();
  for (const s of sessions) {
    const key = `${s.projectId}|${localDateOf(s.startedAt)}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const entries: TimeEntry[] = [];
  for (const [key, group] of groups) {
    const [projectId, workDate] = key.split('|');
    const minutes = Math.min(
      1440,
      group.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
    );
    if (minutes <= 0) continue;

    const description = group
      .map((s) => s.description?.trim())
      .filter(Boolean)
      .join('; ');

    const { data, error } = await supabase
      .from(ENTRIES_TABLE)
      .insert({
        organization_id: orgId,
        person_id: person.id,
        project_id: projectId,
        allocation_id: group[0].allocationId,
        timeline_item_id: group[0].timelineItemId,
        work_date: workDate,
        minutes,
        description: description || null,
        source_session_id: group[0].id,
        status: 'draft',
        created_by: userId,
      })
      .select('*')
      .single();
    if (error) throw new Error(rlsFriendlyMessage('Erro ao consolidar apontamentos', error));
    const entry = mapEntryRow(data as EntryRow);
    entries.push(entry);

    const ids = group.map((s) => s.id);
    const { error: sessionsError } = await supabase
      .from(SESSIONS_TABLE)
      .update({ status: 'consolidated', time_entry_id: entry.id })
      .in('id', ids);
    if (sessionsError) {
      throw new Error(rlsFriendlyMessage('Erro ao marcar sessões consolidadas', sessionsError));
    }
  }
  return entries;
}

/** Manual entry directly as a draft time_entry (no timer). */
export async function createManualEntry(input: {
  projectId: string;
  workDate: string;
  minutes: number;
  description?: string | null;
  timelineItemId?: string | null;
}): Promise<TimeEntry> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const person = await requireCurrentPerson();

  const allocations = await listAllocationsByPerson(person.id);
  const allocation = allocations.find(
    (a) =>
      a.projectId === input.projectId &&
      LIVE_ALLOCATION_STATUSES.includes(a.status) &&
      a.startDate <= input.workDate &&
      (a.endDate == null || a.endDate >= input.workDate),
  );

  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .insert({
      organization_id: orgId,
      person_id: person.id,
      project_id: input.projectId,
      allocation_id: allocation?.id ?? null,
      timeline_item_id: input.timelineItemId ?? null,
      work_date: input.workDate,
      minutes: input.minutes,
      description: input.description ?? null,
      status: 'draft',
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao criar apontamento', error));
  return mapEntryRow(data as EntryRow);
}

/* ─────────────────────────────────────────────────────────────
   Exception flags + submission (auto-approval when clean)
   ───────────────────────────────────────────────────────────── */

/**
 * SINGLE source of truth for exception detection.
 * `sameDayEntries` = other entries of the person on the same date
 * (any project, any status except rejected).
 */
export function computeExceptionFlags(input: {
  entry: Pick<TimeEntry, 'workDate' | 'minutes' | 'allocationId' | 'projectId'>;
  person: Person;
  hasLiveAllocationOnDate: boolean;
  sameDayEntries: Array<Pick<TimeEntry, 'id' | 'minutes' | 'projectId'>>;
  plannedMonthMinutes: number | null;
  reportedMonthMinutes: number;
}): TimesheetExceptionFlag[] {
  const flags: TimesheetExceptionFlag[] = [];

  if (!input.hasLiveAllocationOnDate) flags.push('no_active_allocation');

  const dailyCapacityMinutes = (input.person.weeklyHours / 5) * 60;
  const dayTotal =
    input.entry.minutes + input.sameDayEntries.reduce((sum, e) => sum + e.minutes, 0);
  // tolerance of 25% over the contractual day before flagging
  if (dayTotal > dailyCapacityMinutes * 1.25) flags.push('over_capacity');

  // same project twice in the same day = overlapping records
  if (input.sameDayEntries.some((e) => e.projectId === input.entry.projectId)) {
    flags.push('time_overlap');
  }

  if (
    input.plannedMonthMinutes != null &&
    input.plannedMonthMinutes > 0 &&
    input.reportedMonthMinutes + input.entry.minutes > input.plannedMonthMinutes * 1.1
  ) {
    flags.push('over_planned');
  }

  return flags;
}

/**
 * Submits draft/rejected entries: computes flags; clean -> approved
 * (auto_approved=true); flagged -> submitted (approval queue).
 */
export async function submitEntries(entryIds: string[]): Promise<TimeEntry[]> {
  if (entryIds.length === 0) return [];
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const person = await requireCurrentPerson();

  const { data: entryRows, error } = await supabase
    .from(ENTRIES_TABLE)
    .select('*')
    .in('id', entryIds);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar apontamentos', error));
  const entries = (entryRows ?? []).map((r) => mapEntryRow(r as EntryRow));

  const allocations = await listAllocationsByPerson(person.id);

  const results: TimeEntry[] = [];
  for (const entry of entries) {
    if (entry.status !== 'draft' && entry.status !== 'rejected') {
      results.push(entry);
      continue;
    }

    const allocation = allocations.find(
      (a) =>
        a.projectId === entry.projectId &&
        LIVE_ALLOCATION_STATUSES.includes(a.status) &&
        a.startDate <= entry.workDate &&
        (a.endDate == null || a.endDate >= entry.workDate),
    );

    // other entries of the same person/date (excluding this one)
    const { data: sameDayRows, error: sameDayError } = await supabase
      .from(ENTRIES_TABLE)
      .select('id, minutes, project_id')
      .eq('person_id', entry.personId)
      .eq('work_date', entry.workDate)
      .neq('id', entry.id)
      .neq('status', 'rejected');
    if (sameDayError) {
      throw new Error(rlsFriendlyMessage('Erro ao validar apontamento', sameDayError));
    }

    // month totals for over_planned
    const month = entry.workDate.slice(0, 7);
    const [monthStart, monthEnd] = monthBounds(month);
    const { data: monthRows, error: monthError } = await supabase
      .from(ENTRIES_TABLE)
      .select('minutes')
      .eq('person_id', entry.personId)
      .eq('project_id', entry.projectId)
      .gte('work_date', monthStart)
      .lte('work_date', monthEnd)
      .neq('id', entry.id)
      .neq('status', 'rejected');
    if (monthError) throw new Error(rlsFriendlyMessage('Erro ao validar apontamento', monthError));
    const reportedMonthMinutes = (monthRows ?? []).reduce(
      (sum, r) => sum + ((r as { minutes: number }).minutes ?? 0),
      0,
    );

    // planned minutes of the allocation in the month (percentage of capacity)
    let plannedMonthMinutes: number | null = null;
    if (allocation) {
      const businessDayMinutes = (person.weeklyHours / 5) * 60;
      const businessDays = countBusinessDaysInMonth(monthStart, monthEnd);
      plannedMonthMinutes =
        businessDays * businessDayMinutes * (allocation.plannedPercentage / 100);
    }

    const flags = computeExceptionFlags({
      entry,
      person,
      hasLiveAllocationOnDate: Boolean(allocation),
      sameDayEntries: (sameDayRows ?? []).map((r) => ({
        id: (r as { id: string }).id,
        minutes: (r as { minutes: number }).minutes,
        projectId: (r as { project_id: string }).project_id,
      })),
      plannedMonthMinutes,
      reportedMonthMinutes,
    });

    const clean = flags.length === 0;
    const patch: Record<string, unknown> = {
      allocation_id: allocation?.id ?? entry.allocationId,
      exception_flags: flags,
      submitted_at: new Date().toISOString(),
      status: clean ? 'approved' : 'submitted',
      auto_approved: clean,
      rejection_reason: null,
    };
    if (clean) patch.approved_at = new Date().toISOString();

    const { data: updated, error: updateError } = await supabase
      .from(ENTRIES_TABLE)
      .update(patch)
      .eq('id', entry.id)
      .select('*')
      .single();
    if (updateError) {
      throw new Error(rlsFriendlyMessage('Erro ao enviar apontamento', updateError));
    }
    const result = mapEntryRow(updated as EntryRow);
    results.push(result);

    void logAuditEvent({
      organizationId: orgId,
      action: clean ? 'time_entry.auto_approved' : 'time_entry.submitted',
      entityType: 'time_entry',
      entityId: entry.id,
      metadata: { project_id: entry.projectId, work_date: entry.workDate, flags },
    });
  }
  return results;
}

function countBusinessDaysInMonth(monthStart: string, monthEnd: string): number {
  const start = new Date(`${monthStart}T00:00:00`);
  const end = new Date(`${monthEnd}T00:00:00`);
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/* ─────────────────────────────────────────────────────────────
   Approval queue
   ───────────────────────────────────────────────────────────── */

export async function getApprovalQueue(): Promise<TimeEntry[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .select(ENTRY_SELECT_WITH_PERSON)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: true });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar fila de aprovação', error));
  return (data ?? []).map((row) => mapEntryRow(row as unknown as EntryRow));
}

export async function approveEntry(id: string): Promise<TimeEntry> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .update({
      status: 'approved',
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(ENTRY_SELECT_WITH_PERSON)
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao aprovar apontamento', error));

  void logAuditEvent({
    organizationId: orgId,
    action: 'time_entry.approved',
    entityType: 'time_entry',
    entityId: id,
  });
  return mapEntryRow(data as unknown as EntryRow);
}

export async function rejectEntry(id: string, reason: string): Promise<TimeEntry> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(ENTRIES_TABLE)
    .update({
      status: 'rejected',
      approved_by: userId,
      rejection_reason: reason,
    })
    .eq('id', id)
    .select(ENTRY_SELECT_WITH_PERSON)
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao rejeitar apontamento', error));

  void logAuditEvent({
    organizationId: orgId,
    action: 'time_entry.rejected',
    entityType: 'time_entry',
    entityId: id,
    metadata: { reason },
  });
  return mapEntryRow(data as unknown as EntryRow);
}

/* ─────────────────────────────────────────────────────────────
   Project queries + reconciliation
   ───────────────────────────────────────────────────────────── */

export async function listEntriesByProject(
  projectId: string,
  month?: string,
): Promise<TimeEntry[]> {
  const supabase = createClient();
  let query = supabase
    .from(ENTRIES_TABLE)
    .select(ENTRY_SELECT_WITH_PERSON)
    .eq('project_id', projectId)
    .order('work_date', { ascending: false });
  if (month) {
    const [start, end] = monthBounds(month);
    query = query.gte('work_date', start).lte('work_date', end);
  }
  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar apontamentos do projeto', error));
  return (data ?? []).map((row) => mapEntryRow(row as unknown as EntryRow));
}

export async function listMyEntries(month?: string): Promise<TimeEntry[]> {
  const person = await getCurrentPerson();
  if (!person) return [];
  const supabase = createClient();
  let query = supabase
    .from(ENTRIES_TABLE)
    .select('*')
    .eq('person_id', person.id)
    .order('work_date', { ascending: false });
  if (month) {
    const [start, end] = monthBounds(month);
    query = query.gte('work_date', start).lte('work_date', end);
  }
  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar seus apontamentos', error));
  return (data ?? []).map((row) => mapEntryRow(row as EntryRow));
}

/**
 * Planned × reported × approved hours of a project in a month.
 * plannedHours = Σ over live allocations of (% × person month capacity).
 */
export function computeReconciliation(
  projectId: string,
  month: string,
  entries: TimeEntry[],
  plannedHours: number,
): TimesheetReconciliation {
  const monthEntries = entries.filter(
    (e) => e.projectId === projectId && e.workDate.startsWith(month) && e.status !== 'rejected',
  );
  const reportedHours = monthEntries.reduce((sum, e) => sum + e.minutes, 0) / 60;
  const approvedHours =
    monthEntries
      .filter((e) => e.status === 'approved' || e.status === 'locked')
      .reduce((sum, e) => sum + e.minutes, 0) / 60;
  const pendingHours =
    monthEntries
      .filter((e) => e.status === 'submitted')
      .reduce((sum, e) => sum + e.minutes, 0) / 60;

  return {
    projectId,
    month,
    plannedHours,
    reportedHours,
    approvedHours,
    pendingHours,
    executionRatio: plannedHours > 0 ? reportedHours / plannedHours : null,
  };
}
