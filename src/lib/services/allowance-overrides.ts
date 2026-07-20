import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  AllowanceEligibilityOverride,
  AllowanceOverrideAction,
  AllowanceOverrideStatus,
} from '@/lib/types/allowances';
import { getCurrentOrgAndUser, rlsFriendlyMessage } from './people';

type OverrideRow = {
  id: string; organization_id: string; person_id: string; allowance_date: string;
  project_id: string; geofence_id: string | null; action: AllowanceOverrideAction;
  reason: string; status: AllowanceOverrideStatus; requested_by: string;
  approved_by: string | null; approved_at: string | null; created_at: string; updated_at: string;
};

function mapOverride(row: OverrideRow): AllowanceEligibilityOverride {
  return {
    id: row.id, organizationId: row.organization_id, personId: row.person_id,
    allowanceDate: row.allowance_date, projectId: row.project_id, geofenceId: row.geofence_id,
    action: row.action, reason: row.reason, status: row.status, requestedBy: row.requested_by,
    approvedBy: row.approved_by, approvedAt: row.approved_at, createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAllowanceOverrides(weekStart: string, weekEnd: string): Promise<AllowanceEligibilityOverride[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('allowance_eligibility_overrides').select('*')
    .gte('allowance_date', weekStart).lte('allowance_date', weekEnd).order('created_at', { ascending: false });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar exceções municipais', error));
  return (data ?? []).map((row) => mapOverride(row as OverrideRow));
}

export async function requestAllowanceOverride(input: {
  personId: string; allowanceDate: string; projectId: string; geofenceId?: string | null;
  action: AllowanceOverrideAction; reason: string;
}): Promise<AllowanceEligibilityOverride> {
  const supabase = createClient();
  const { orgId, userId } = await getCurrentOrgAndUser(supabase);
  const { data, error } = await supabase.from('allowance_eligibility_overrides').insert({
    organization_id: orgId, person_id: input.personId, allowance_date: input.allowanceDate,
    project_id: input.projectId, geofence_id: input.geofenceId ?? null, action: input.action,
    reason: input.reason.trim(), requested_by: userId,
  }).select('*').single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao solicitar exceção', error));
  const value = mapOverride(data as OverrideRow);
  await logAuditEvent({ organizationId: orgId, action: 'allowance_override.requested',
    entityType: 'allowance_eligibility_override', entityId: value.id,
    metadata: { action: value.action, person_id: value.personId, allowance_date: value.allowanceDate } });
  return value;
}

export async function decideAllowanceOverride(id: string, decision: 'approved' | 'rejected') {
  const supabase = createClient();
  const { orgId, userId } = await getCurrentOrgAndUser(supabase);
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('allowance_eligibility_overrides').update({
    status: decision, approved_by: userId, approved_at: decision === 'approved' ? now : null,
  }).eq('id', id).select('*').single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao decidir exceção', error));
  const value = mapOverride(data as OverrideRow);
  await logAuditEvent({ organizationId: orgId, action: `allowance_override.${decision}`,
    entityType: 'allowance_eligibility_override', entityId: id });
  return value;
}
