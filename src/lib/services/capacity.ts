/**
 * Capacity service — DERIVED capacity (no materialized table).
 * Capacity of a person in a period = weekly_hours pro-rata (5-day
 * business week) − hours removed by overlapping leave_periods.
 * Commitment/availability come from live project_allocations.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  AllocationMatrixRow,
  LeavePeriod,
  LeaveStatus,
  LeaveType,
  Person,
  PersonCapacitySummary,
  PersonProjectAllocation,
} from '@/lib/types/people';
import { getCurrentOrgAndUser, rlsFriendlyMessage } from './people';
import { LIVE_ALLOCATION_STATUSES } from './allocations';

export const LEAVES_TABLE = 'leave_periods';

/** Leave statuses that reduce capacity. */
const LIVE_LEAVE_STATUSES: LeaveStatus[] = ['planned', 'approved', 'active'];

/* ─────────────────────────────────────────────────────────────
   Cost masking (people.cost_view gate) — single helper reused by
   every screen that renders individual cost.
   ───────────────────────────────────────────────────────────── */

export const MASKED_COST = '••••';

export function maskCost(formatted: string | null | undefined, canViewCost: boolean): string {
  if (!canViewCost) return MASKED_COST;
  return formatted ?? '—';
}

/* ─────────────────────────────────────────────────────────────
   Leave periods
   ───────────────────────────────────────────────────────────── */

type LeaveRow = {
  id: string;
  organization_id: string;
  person_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  hours_per_day: number | string | null;
  status: LeaveStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function mapLeaveRow(row: LeaveRow): LeavePeriod {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    hoursPerDay: row.hours_per_day == null ? null : Number(row.hours_per_day),
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listLeavesInPeriod(
  startDate: string,
  endDate: string,
  personId?: string,
): Promise<LeavePeriod[]> {
  const supabase = createClient();
  let query = supabase
    .from(LEAVES_TABLE)
    .select('*')
    .in('status', LIVE_LEAVE_STATUSES)
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .order('start_date');
  if (personId) query = query.eq('person_id', personId);

  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar afastamentos', error));
  return (data ?? []).map((row) => mapLeaveRow(row as LeaveRow));
}

export interface LeaveInput {
  personId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  hoursPerDay?: number | null;
  status?: LeaveStatus;
  notes?: string | null;
}

export async function createLeave(input: LeaveInput): Promise<LeavePeriod> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(LEAVES_TABLE)
    .insert({
      organization_id: orgId,
      person_id: input.personId,
      type: input.type,
      start_date: input.startDate,
      end_date: input.endDate,
      hours_per_day: input.hoursPerDay ?? null,
      status: input.status ?? 'approved',
      notes: input.notes ?? null,
      created_by: userId,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23P01') {
      throw new Error('Já existe afastamento desta pessoa em período sobreposto.');
    }
    throw new Error(rlsFriendlyMessage('Erro ao criar afastamento', error));
  }

  const leave = mapLeaveRow(data as LeaveRow);
  void logAuditEvent({
    organizationId: orgId,
    action: 'leave.created',
    entityType: 'leave_period',
    entityId: leave.id,
    metadata: { person_id: leave.personId, type: leave.type, period: `${leave.startDate}..${leave.endDate}` },
  });
  return leave;
}

export async function cancelLeave(id: string): Promise<void> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const { error } = await supabase
    .from(LEAVES_TABLE)
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao cancelar afastamento', error));
  void logAuditEvent({
    organizationId: orgId,
    action: 'leave.cancelled',
    entityType: 'leave_period',
    entityId: id,
  });
}

/* ─────────────────────────────────────────────────────────────
   Date helpers (business-day based, 5-day week)
   ───────────────────────────────────────────────────────────── */

function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

export function countBusinessDays(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (end < start) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

function clampPeriod(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): [string, string] | null {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return start <= end ? [start, end] : null;
}

/* ─────────────────────────────────────────────────────────────
   Derived capacity
   ───────────────────────────────────────────────────────────── */

function allocationOverlaps(a: PersonProjectAllocation, start: string, end: string): boolean {
  return a.startDate <= end && (a.endDate == null || a.endDate >= start);
}

/**
 * Capacity summary of one person in [periodStart, periodEnd].
 * `allocations` and `leaves` must already be scoped to the person
 * (any period — filtering happens here).
 */
export function computeCapacitySummary(
  person: Person,
  allocations: PersonProjectAllocation[],
  leaves: LeavePeriod[],
  periodStart: string,
  periodEnd: string,
): PersonCapacitySummary {
  const dailyHours = person.weeklyHours / 5;
  const businessDays = countBusinessDays(periodStart, periodEnd);
  const contractualHours = businessDays * dailyHours;

  let leaveHours = 0;
  for (const leave of leaves) {
    if (leave.personId !== person.id) continue;
    if (!LIVE_LEAVE_STATUSES.includes(leave.status)) continue;
    const overlap = clampPeriod(leave.startDate, leave.endDate, periodStart, periodEnd);
    if (!overlap) continue;
    const days = countBusinessDays(overlap[0], overlap[1]);
    leaveHours += days * (leave.hoursPerDay ?? dailyHours);
  }
  leaveHours = Math.min(leaveHours, contractualHours);

  const live = allocations.filter(
    (a) =>
      a.personId === person.id &&
      LIVE_ALLOCATION_STATUSES.includes(a.status) &&
      allocationOverlaps(a, periodStart, periodEnd),
  );
  const allocatedPct = live.reduce((sum, a) => sum + a.plannedPercentage, 0);

  return {
    personId: person.id,
    periodStart,
    periodEnd,
    contractualHours,
    leaveHours,
    capacityHours: Math.max(contractualHours - leaveHours, 0),
    allocatedPct,
    availablePct: 100 - allocatedPct,
    overloaded: allocatedPct > 100,
    allocations: live,
  };
}

/** First/last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthBounds(month: string): [string, string] {
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return [`${year}-${mm}-01`, `${year}-${mm}-${String(lastDay).padStart(2, '0')}`];
}

/**
 * Corporate allocation matrix for one month: one row per person with
 * % per project + free %. Inputs are org-wide datasets for the month.
 */
export function buildAllocationMatrix(
  people: Person[],
  allocations: PersonProjectAllocation[],
  leaves: LeavePeriod[],
  month: string,
): AllocationMatrixRow[] {
  const [start, end] = monthBounds(month);

  return people.map((person) => {
    const summary = computeCapacitySummary(person, allocations, leaves, start, end);
    const byProject: Record<string, number> = {};
    for (const a of summary.allocations) {
      byProject[a.projectId] = (byProject[a.projectId] ?? 0) + a.plannedPercentage;
    }
    return {
      person,
      byProject,
      totalPct: summary.allocatedPct,
      freePct: summary.availablePct,
      capacityHours: summary.capacityHours,
      onLeave: summary.leaveHours > 0,
    };
  });
}

/** FTE per project in a set of live allocations (Σ % ÷ 100). */
export function computeProjectFte(allocations: PersonProjectAllocation[]): number {
  return (
    allocations
      .filter((a) => LIVE_ALLOCATION_STATUSES.includes(a.status))
      .reduce((sum, a) => sum + a.plannedPercentage, 0) / 100
  );
}
