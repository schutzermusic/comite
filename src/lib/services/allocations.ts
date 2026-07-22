/**
 * Project allocations service (migration 038).
 * Allocation is a temporal relation person × project with validity
 * period, percentage, type, status and approval trail. Overlap of the
 * same person/project is enforced by the DB EXCLUDE constraint AND
 * re-validated here for friendly errors; corporate overload (>100%
 * across projects) is a warning that requires justification, never a
 * constraint.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  AllocationSource,
  AllocationStatus,
  AllocationType,
  PersonProjectAllocation,
} from '@/lib/types/people';
import {
  getCurrentOrgAndUser,
  mapPersonRow,
  rlsFriendlyMessage,
  type PersonRow,
} from './people';

export const ALLOCATIONS_TABLE = 'project_allocations';

/** Statuses that count for overlap/commitment computations. */
export const LIVE_ALLOCATION_STATUSES: AllocationStatus[] = ['pending_approval', 'active'];

/* ─────────────────────────────────────────────────────────────
   Row shape + mapping
   ───────────────────────────────────────────────────────────── */

export type AllocationRow = {
  id: string;
  organization_id: string;
  person_id: string;
  project_id: string;
  role_title: string | null;
  allocation_type: AllocationType;
  start_date: string;
  end_date: string | null;
  planned_percentage: number | string;
  planned_hours_week: number | string | null;
  status: AllocationStatus;
  source: AllocationSource;
  cost_center_id: string | null;
  justification: string | null;
  requires_ponto: boolean | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  people?: PersonRow | null;
};

export function mapAllocationRow(row: AllocationRow): PersonProjectAllocation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    projectId: row.project_id,
    roleTitle: row.role_title,
    allocationType: row.allocation_type,
    startDate: row.start_date,
    endDate: row.end_date,
    plannedPercentage: Number(row.planned_percentage ?? 0),
    plannedHoursWeek: row.planned_hours_week == null ? null : Number(row.planned_hours_week),
    status: row.status,
    source: row.source,
    costCenterId: row.cost_center_id,
    justification: row.justification,
    requiresPonto: row.requires_ponto ?? false,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    person: row.people ? mapPersonRow(row.people) : undefined,
  };
}

const SELECT_WITH_PERSON = '*, people(*)';

/* ─────────────────────────────────────────────────────────────
   Queries
   ───────────────────────────────────────────────────────────── */

export async function listAllocationsByProject(
  projectId: string,
): Promise<PersonProjectAllocation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ALLOCATIONS_TABLE)
    .select(SELECT_WITH_PERSON)
    .eq('project_id', projectId)
    .order('start_date', { ascending: false });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar alocações do projeto', error));
  return (data ?? []).map((row) => mapAllocationRow(row as unknown as AllocationRow));
}

export async function listAllocationsByPerson(
  personId: string,
): Promise<PersonProjectAllocation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ALLOCATIONS_TABLE)
    .select('*')
    .eq('person_id', personId)
    .order('start_date', { ascending: false });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar alocações da pessoa', error));
  return (data ?? []).map((row) => mapAllocationRow(row as AllocationRow));
}

/** Live allocations overlapping [start, end] (org-wide, with person). */
export async function listLiveAllocationsInPeriod(
  startDate: string,
  endDate: string,
): Promise<PersonProjectAllocation[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(ALLOCATIONS_TABLE)
    .select(SELECT_WITH_PERSON)
    .in('status', LIVE_ALLOCATION_STATUSES)
    .lte('start_date', endDate)
    .or(`end_date.is.null,end_date.gte.${startDate}`)
    .order('start_date');
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar alocações do período', error));
  return (data ?? []).map((row) => mapAllocationRow(row as unknown as AllocationRow));
}

/* ─────────────────────────────────────────────────────────────
   Validation
   ───────────────────────────────────────────────────────────── */

export interface AllocationValidation {
  /** hard error: same person+project overlapping live allocation */
  overlapError: string | null;
  /** Σ % of live allocations of the person overlapping the period (excluding the edited one) */
  existingTotalPct: number;
  /** existing + proposed */
  projectedTotalPct: number;
  /** projectedTotalPct > 100 → requires justification */
  overloadWarning: boolean;
}

function periodsOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null,
): boolean {
  const aEndVal = aEnd ?? '9999-12-31';
  const bEndVal = bEnd ?? '9999-12-31';
  return aStart <= bEndVal && bStart <= aEndVal;
}

/**
 * Mirrors the DB EXCLUDE constraint (friendly message) and computes the
 * corporate commitment of the person in the proposed period.
 */
export async function validateAllocation(input: {
  personId: string;
  projectId: string;
  startDate: string;
  endDate: string | null;
  plannedPercentage: number;
  excludeAllocationId?: string;
}): Promise<AllocationValidation> {
  const existing = await listAllocationsByPerson(input.personId);

  const live = existing.filter(
    (a) =>
      a.id !== input.excludeAllocationId &&
      LIVE_ALLOCATION_STATUSES.includes(a.status) &&
      periodsOverlap(a.startDate, a.endDate, input.startDate, input.endDate),
  );

  const sameProject = live.find((a) => a.projectId === input.projectId);
  const existingTotalPct = live.reduce((sum, a) => sum + a.plannedPercentage, 0);
  const projectedTotalPct = existingTotalPct + input.plannedPercentage;

  return {
    overlapError: sameProject
      ? 'Já existe alocação ativa desta pessoa neste projeto em período sobreposto. Encerre ou edite a alocação existente.'
      : null,
    existingTotalPct,
    projectedTotalPct,
    overloadWarning: projectedTotalPct > 100,
  };
}

/* ─────────────────────────────────────────────────────────────
   Mutations
   ───────────────────────────────────────────────────────────── */

export interface AllocationInput {
  personId: string;
  projectId: string;
  roleTitle?: string | null;
  allocationType?: AllocationType;
  startDate: string;
  endDate?: string | null;
  plannedPercentage: number;
  plannedHoursWeek?: number | null;
  status?: AllocationStatus;
  costCenterId?: string | null;
  justification?: string | null;
  requiresPonto?: boolean;
}

function isOverlapDbError(error: { code?: string; message?: string }): boolean {
  return error.code === '23P01' || /project_allocations_no_overlap/i.test(error.message || '');
}

export async function createAllocation(input: AllocationInput): Promise<PersonProjectAllocation> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const validation = await validateAllocation({
    personId: input.personId,
    projectId: input.projectId,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    plannedPercentage: input.plannedPercentage,
  });
  if (validation.overlapError) throw new Error(validation.overlapError);
  if (validation.overloadWarning && !input.justification?.trim()) {
    throw new Error(
      `Comprometimento total projetado de ${validation.projectedTotalPct.toFixed(0)}% excede 100%. Informe uma justificativa para sobrecarga.`,
    );
  }

  const row = {
    organization_id: orgId,
    person_id: input.personId,
    project_id: input.projectId,
    role_title: input.roleTitle ?? null,
    allocation_type: input.allocationType ?? 'billable',
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    planned_percentage: input.plannedPercentage,
    planned_hours_week: input.plannedHoursWeek ?? null,
    status: input.status ?? 'active',
    source: 'manual',
    cost_center_id: input.costCenterId ?? null,
    justification: input.justification ?? null,
    requires_ponto: input.requiresPonto ?? false,
    requested_by: userId,
    created_by: userId,
  };

  const { data, error } = await supabase
    .from(ALLOCATIONS_TABLE)
    .insert(row)
    .select(SELECT_WITH_PERSON)
    .single();
  if (error) {
    if (isOverlapDbError(error)) {
      throw new Error(
        'Já existe alocação ativa desta pessoa neste projeto em período sobreposto.',
      );
    }
    throw new Error(rlsFriendlyMessage('Erro ao criar alocação', error));
  }

  const allocation = mapAllocationRow(data as unknown as AllocationRow);
  void logAuditEvent({
    organizationId: orgId,
    action: 'allocation.created',
    entityType: 'project_allocation',
    entityId: allocation.id,
    metadata: {
      person_id: allocation.personId,
      project_id: allocation.projectId,
      planned_percentage: allocation.plannedPercentage,
      period: `${allocation.startDate}..${allocation.endDate ?? 'aberto'}`,
      projected_total_pct: validation.projectedTotalPct,
    },
  });
  return allocation;
}

export async function updateAllocation(
  id: string,
  patch: Partial<AllocationInput>,
): Promise<PersonProjectAllocation> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);

  // fetch current row for validation baselines
  const { data: currentRow, error: currentError } = await supabase
    .from(ALLOCATIONS_TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (currentError) throw new Error(rlsFriendlyMessage('Erro ao carregar alocação', currentError));
  const current = mapAllocationRow(currentRow as AllocationRow);

  const next = {
    personId: patch.personId ?? current.personId,
    projectId: patch.projectId ?? current.projectId,
    startDate: patch.startDate ?? current.startDate,
    endDate: patch.endDate !== undefined ? patch.endDate : current.endDate,
    plannedPercentage: patch.plannedPercentage ?? current.plannedPercentage,
  };
  const nextStatus = patch.status ?? current.status;

  if (LIVE_ALLOCATION_STATUSES.includes(nextStatus)) {
    const validation = await validateAllocation({ ...next, excludeAllocationId: id });
    if (validation.overlapError) throw new Error(validation.overlapError);
    const justification = patch.justification ?? current.justification;
    if (validation.overloadWarning && !justification?.trim()) {
      throw new Error(
        `Comprometimento total projetado de ${validation.projectedTotalPct.toFixed(0)}% excede 100%. Informe uma justificativa para sobrecarga.`,
      );
    }
  }

  const row: Record<string, unknown> = {
    person_id: patch.personId,
    project_id: patch.projectId,
    role_title: patch.roleTitle,
    allocation_type: patch.allocationType,
    start_date: patch.startDate,
    end_date: patch.endDate,
    planned_percentage: patch.plannedPercentage,
    planned_hours_week: patch.plannedHoursWeek,
    status: patch.status,
    cost_center_id: patch.costCenterId,
    justification: patch.justification,
    requires_ponto: patch.requiresPonto,
  };
  Object.keys(row).forEach((k) => {
    if (row[k] === undefined) delete row[k];
  });

  const { data, error } = await supabase
    .from(ALLOCATIONS_TABLE)
    .update(row)
    .eq('id', id)
    .select(SELECT_WITH_PERSON)
    .single();
  if (error) {
    if (isOverlapDbError(error)) {
      throw new Error(
        'Já existe alocação ativa desta pessoa neste projeto em período sobreposto.',
      );
    }
    throw new Error(rlsFriendlyMessage('Erro ao atualizar alocação', error));
  }

  const allocation = mapAllocationRow(data as unknown as AllocationRow);
  void logAuditEvent({
    organizationId: orgId,
    action: 'allocation.updated',
    entityType: 'project_allocation',
    entityId: id,
    metadata: { fields: Object.keys(row) },
  });
  return allocation;
}

/** Status transitions with audit trail. */
async function transitionAllocation(
  id: string,
  patch: Record<string, unknown>,
  action: string,
): Promise<PersonProjectAllocation> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(ALLOCATIONS_TABLE)
    .update(patch)
    .eq('id', id)
    .select(SELECT_WITH_PERSON)
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao alterar status da alocação', error));

  const allocation = mapAllocationRow(data as unknown as AllocationRow);
  void logAuditEvent({
    organizationId: orgId,
    action,
    entityType: 'project_allocation',
    entityId: id,
    metadata: { status: allocation.status },
  });
  return allocation;
}

export async function approveAllocation(id: string): Promise<PersonProjectAllocation> {
  const supabase = createClient();
  const { userId } = await getCurrentOrgAndUser(supabase);
  return transitionAllocation(
    id,
    { status: 'active', approved_by: userId, approved_at: new Date().toISOString() },
    'allocation.approved',
  );
}

export async function rejectAllocation(
  id: string,
  reason: string,
): Promise<PersonProjectAllocation> {
  return transitionAllocation(
    id,
    { status: 'rejected', rejection_reason: reason },
    'allocation.rejected',
  );
}

/** End an allocation as of a given date (defaults to today). */
export async function endAllocation(
  id: string,
  endDate?: string,
): Promise<PersonProjectAllocation> {
  return transitionAllocation(
    id,
    { status: 'ended', end_date: endDate ?? new Date().toISOString().slice(0, 10) },
    'allocation.ended',
  );
}

export async function cancelAllocation(id: string): Promise<PersonProjectAllocation> {
  return transitionAllocation(id, { status: 'cancelled' }, 'allocation.cancelled');
}
