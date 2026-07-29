/**
 * People service — canonical org person (migration 038).
 * Live-first: talks to Supabase via RLS from the browser client,
 * same pattern as src/lib/services/risks.ts. Also exports the shared
 * helpers used by allocations/capacity/timesheet services.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type { Person, PersonContractType, PersonSource, PersonStatus } from '@/lib/types/people';

export const PEOPLE_TABLE = 'people';

/* ─────────────────────────────────────────────────────────────
   Shared helpers (used across the people/allocation services)
   ───────────────────────────────────────────────────────────── */

export function isRlsError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    /row[- ]level security|permission denied|policy/i.test(error.message || '')
  );
}

export function rlsFriendlyMessage(prefix: string, error: { code?: string; message?: string }): string {
  if (isRlsError(error)) return `${prefix}: Acesso negado pela política de segurança.`;
  return `${prefix}: ${error.message || 'erro desconhecido'}`;
}

type SupabaseLike = ReturnType<typeof createClient>;

export async function getCurrentOrgAndUser(
  supabase: SupabaseLike,
): Promise<{ userId: string; orgId: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Não autenticado');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();

  if (error || !profile?.organization_id) {
    throw new Error('Usuário sem organização ativa');
  }
  return { userId: user.id, orgId: profile.organization_id as string };
}

/** Mirrors normalize_person_name() from migration 038. */
export function normalizePersonName(name: string | null | undefined): string | null {
  if (!name) return null;
  const normalized = name
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    // strip combining diacritics (U+0300–U+036F)
    .replace(/[\u0300-\u036f]/g, '');
  return normalized || null;
}

/* ─────────────────────────────────────────────────────────────
   Row shape + mapping
   ───────────────────────────────────────────────────────────── */

export type PersonRow = {
  id: string;
  organization_id: string;
  profile_id: string | null;
  full_name: string;
  payroll_name_key: string | null;
  cpf: string | null;
  email: string | null;
  job_title: string | null;
  department: string | null;
  contract_type: PersonContractType | null;
  weekly_hours: number | string;
  cost_center_id: string | null;
  manager_person_id: string | null;
  status: PersonStatus;
  source: PersonSource;
  hired_at: string | null;
  terminated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export function mapPersonRow(row: PersonRow): Person {
  return {
    id: row.id,
    organizationId: row.organization_id,
    profileId: row.profile_id,
    fullName: row.full_name,
    payrollNameKey: row.payroll_name_key,
    cpf: row.cpf ?? null,
    email: row.email,
    jobTitle: row.job_title,
    department: row.department,
    contractType: row.contract_type,
    weeklyHours: Number(row.weekly_hours ?? 40),
    costCenterId: row.cost_center_id,
    managerPersonId: row.manager_person_id,
    status: row.status,
    source: row.source,
    hiredAt: row.hired_at,
    terminatedAt: row.terminated_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */

export interface ListPeopleOptions {
  status?: PersonStatus | 'all';
  search?: string;
}

export async function listPeople(options: ListPeopleOptions = {}): Promise<Person[]> {
  const supabase = createClient();
  let query = supabase.from(PEOPLE_TABLE).select('*').order('full_name');

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status);
  }
  if (options.search?.trim()) {
    query = query.ilike('full_name', `%${options.search.trim()}%`);
  }

  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar pessoas', error));
  return (data ?? []).map((row) => mapPersonRow(row as PersonRow));
}

export async function getPerson(id: string): Promise<Person | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(PEOPLE_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar pessoa', error));
  return data ? mapPersonRow(data as PersonRow) : null;
}

/** Person linked to the currently authenticated user (or null). */
export async function getCurrentPerson(): Promise<Person | null> {
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.id) return null;

  const { data, error } = await supabase
    .from(PEOPLE_TABLE)
    .select('*')
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao localizar seu cadastro de pessoa', error));
  return data ? mapPersonRow(data as PersonRow) : null;
}

export interface PersonInput {
  fullName: string;
  cpf?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  contractType?: PersonContractType | null;
  weeklyHours?: number;
  costCenterId?: string | null;
  managerPersonId?: string | null;
  status?: PersonStatus;
  hiredAt?: string | null;
  terminatedAt?: string | null;
  notes?: string | null;
  profileId?: string | null;
}

function mapInputToRow(input: Partial<PersonInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    full_name: input.fullName?.trim(),
    payroll_name_key: input.fullName !== undefined ? normalizePersonName(input.fullName) : undefined,
    cpf: input.cpf !== undefined ? (input.cpf ? input.cpf.replace(/\D/g, '') : null) : undefined,
    email: input.email,
    job_title: input.jobTitle,
    department: input.department,
    contract_type: input.contractType,
    weekly_hours: input.weeklyHours,
    cost_center_id: input.costCenterId,
    manager_person_id: input.managerPersonId,
    status: input.status,
    hired_at: input.hiredAt,
    terminated_at: input.terminatedAt,
    notes: input.notes,
    profile_id: input.profileId,
  };
  Object.keys(row).forEach((k) => {
    if (row[k] === undefined) delete row[k];
  });
  return row;
}

export async function createPerson(input: PersonInput): Promise<Person> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const row = {
    ...mapInputToRow(input),
    organization_id: orgId,
    source: 'manual',
    created_by: userId,
  };

  const { data, error } = await supabase
    .from(PEOPLE_TABLE)
    .insert(row)
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao criar pessoa', error));

  const person = mapPersonRow(data as PersonRow);
  void logAuditEvent({
    organizationId: orgId,
    action: 'person.created',
    entityType: 'person',
    entityId: person.id,
    metadata: { full_name: person.fullName },
  });
  return person;
}

export async function updatePerson(id: string, patch: Partial<PersonInput>): Promise<Person> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(PEOPLE_TABLE)
    .update(mapInputToRow(patch))
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar pessoa', error));

  const person = mapPersonRow(data as PersonRow);
  void logAuditEvent({
    organizationId: orgId,
    action: 'person.updated',
    entityType: 'person',
    entityId: id,
    metadata: { fields: Object.keys(patch) },
  });
  return person;
}

export async function inactivatePerson(id: string): Promise<void> {
  const supabase = createClient();
  const { orgId } = await getCurrentOrgAndUser(supabase);
  const { error } = await supabase
    .from(PEOPLE_TABLE)
    .update({ status: 'inactive' })
    .eq('id', id);

  if (error) throw new Error(rlsFriendlyMessage('Erro ao inativar pessoa', error));

  void logAuditEvent({
    organizationId: orgId,
    action: 'person.inactivated',
    entityType: 'person',
    entityId: id,
    metadata: { reason: 'manual' },
  });
}

export async function deletePersonHistory(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('admin_delete_person_history', {
    p_person_id: id,
  });

  if (error) {
    const message = /owner\s*\/\s*admin|apenas.*admin/i.test(error.message || '')
      ? 'Somente o perfil Owner / Admin pode excluir todo o histórico.'
      : error.message;
    throw new Error(`Erro ao excluir pessoa e histórico: ${message || 'erro desconhecido'}`);
  }
}

/** Profiles of the org not yet linked to a person (for manual linking). */
export async function listUnlinkedProfiles(): Promise<
  Array<{ id: string; fullName: string | null }>
> {
  const supabase = createClient();

  const [{ data: profiles, error }, { data: linked, error: linkedError }] = await Promise.all([
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase.from(PEOPLE_TABLE).select('profile_id').not('profile_id', 'is', null),
  ]);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar perfis', error));
  if (linkedError) throw new Error(rlsFriendlyMessage('Erro ao carregar vínculos', linkedError));

  const linkedIds = new Set((linked ?? []).map((r) => r.profile_id as string));
  return (profiles ?? [])
    .filter((p) => !linkedIds.has(p.id as string))
    .map((p) => ({ id: p.id as string, fullName: (p.full_name as string | null) ?? null }));
}
