import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import { createTask } from '@/lib/services/agenda';
import type {
  DeliberationItem,
  DeliberationStatus,
  DeliberationStage,
  DeliberationMinutes,
  DeliberationActionItem,
  AuditTrailEntry,
  ReviewStatus,
  VoteRecord,
  VoteOption,
} from '@/lib/types';

const DELIBERATIONS_TABLE = 'deliberations';
const VOTES_TABLE = 'deliberation_votes';

type SupabaseLike = ReturnType<typeof createClient>;

/* ─────────────────────────────────────────────────────────────
   Row shapes (snake_case)
   ───────────────────────────────────────────────────────────── */
type DeliberationRow = {
  id: string;
  organization_id: string;
  code: string | null;
  title: string;
  description: string | null;
  status: DeliberationStatus;
  vote_result: DeliberationItem['voteResult'] | null;
  priority: DeliberationItem['priority'] | null;
  confidentiality: string | null;
  owner_committee_id: string | null;
  dependent_committee_ids: string[] | null;
  submitted_by: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  voting_window_start: string | null;
  voting_window_end: string | null;
  current_stage_id: string | null;
  stages: DeliberationStage[] | null;
  minutes: DeliberationMinutes | null;
  linked_entities: DeliberationItem['linkedEntities'] | null;
  execution_items: DeliberationActionItem[] | null;
  audit_trail: AuditTrailEntry[] | null;
  financial_impact: Record<string, unknown> | number | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type VoteRow = {
  id: string;
  organization_id: string;
  deliberation_id: string;
  stage_id: string | null;
  voter_id: string;
  voter_name: string | null;
  vote: VoteOption;
  justification: string | null;
  has_conflict_of_interest: boolean | null;
  voted_at: string;
};

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */
function isRlsError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42501' ||
    error.code === 'PGRST301' ||
    /row[- ]level security|permission denied|policy/i.test(error.message || '')
  );
}

/** Valida se uma string é um uuid (colunas FK uuid não aceitam ids de política). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rlsFriendlyMessage(prefix: string, error: { code?: string; message?: string }): string {
  if (isRlsError(error)) return `${prefix}: Acesso negado pela política de segurança.`;
  return `${prefix}: ${error.message || 'erro desconhecido'}`;
}

async function getCurrentOrgAndUser(
  supabase: SupabaseLike,
): Promise<{ userId: string; orgId: string; userName: string }> {
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
  };
}

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function hydrateStages(raw: DeliberationStage[] | null | undefined): DeliberationStage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => ({
    ...s,
    openedAt: toDate(s.openedAt as unknown as string),
    dueAt: toDate(s.dueAt as unknown as string),
    closedAt: toDate(s.closedAt as unknown as string),
  }));
}

function hydrateExecutionItems(
  raw: DeliberationActionItem[] | null | undefined,
): DeliberationActionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    ...t,
    dueDate: toDate(t.dueDate as unknown as string) ?? new Date(),
  }));
}

function hydrateMinutes(raw: DeliberationMinutes | null | undefined): DeliberationMinutes | undefined {
  if (!raw) return undefined;
  return { ...raw, publishedAt: toDate(raw.publishedAt as unknown as string) };
}

function hydrateAudit(raw: AuditTrailEntry[] | null | undefined): AuditTrailEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => ({
    ...a,
    timestamp: toDate(a.timestamp as unknown as string) ?? new Date(),
  }));
}

function hydrateVote(row: VoteRow): VoteRecord {
  return {
    id: row.id,
    itemId: row.deliberation_id,
    voterId: row.voter_id,
    voterName: row.voter_name ?? 'Membro',
    vote: row.vote,
    justification: row.justification ?? undefined,
    hasConflictOfInterest: Boolean(row.has_conflict_of_interest),
    stageId: row.stage_id ?? undefined,
    votedAt: toDate(row.voted_at) ?? new Date(),
  };
}

export function mapRowToDeliberation(
  row: DeliberationRow,
  votes: VoteRecord[] = [],
): DeliberationItem {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const fi =
    typeof row.financial_impact === 'number'
      ? row.financial_impact
      : row.financial_impact && typeof row.financial_impact === 'object'
      ? (row.financial_impact as { amount?: number }).amount
      : undefined;

  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    status: (meta.status as DeliberationItem['status']) ?? 'under_review',
    type: (meta.type as string) ?? 'Operational',
    priority: row.priority ?? 'medium',
    createdBy: row.created_by ?? row.submitted_by ?? '',
    createdByName: (meta.createdByName as string) ?? undefined,
    ownerName: (meta.ownerName as string) ?? undefined,
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
    submittedAt: toDate(row.created_at),
    deliberationStatus: row.status,
    ownerCommitteeId: row.owner_committee_id ?? (meta.ownerCommitteeId as string) ?? undefined,
    ownerCommitteeName: (meta.ownerCommitteeName as string) ?? undefined,
    dependentCommitteeIds: row.dependent_committee_ids ?? undefined,
    dependentCommitteeNames: (meta.dependentCommitteeNames as string[]) ?? undefined,
    strategicFlag: (meta.strategicFlag as boolean) ?? undefined,
    outsideBudget: (meta.outsideBudget as boolean) ?? undefined,
    marginPercent: (meta.marginPercent as number) ?? undefined,
    stages: hydrateStages(row.stages),
    currentStageId: row.current_stage_id ?? undefined,
    votingStartedAt: toDate(row.voting_window_start),
    votingClosedAt: toDate(row.voting_window_end),
    votes,
    voteResult: row.vote_result ?? undefined,
    quorumRequired: (meta.quorumRequired as number) ?? undefined,
    quorumPresent: (meta.quorumPresent as number) ?? votes.length,
    financialImpact: typeof fi === 'number' ? fi : undefined,
    riskLevel: (meta.riskLevel as DeliberationItem['riskLevel']) ?? undefined,
    dueDate: toDate(row.due_date),
    evidenceComplete: (meta.evidenceComplete as boolean) ?? undefined,
    attachments: (meta.attachments as DeliberationItem['attachments']) ?? [],
    linkedEntities: row.linked_entities ?? [],
    reviews: (meta.reviews as DeliberationItem['reviews']) ?? [],
    recommendation: (meta.recommendation as DeliberationItem['recommendation']) ?? undefined,
    recommendationNotes: (meta.recommendationNotes as string[]) ?? undefined,
    auditTrail: hydrateAudit(row.audit_trail),
    minutesSummary: (meta.minutesSummary as string) ?? undefined,
    minutes: hydrateMinutes(row.minutes),
    executionItems: hydrateExecutionItems(row.execution_items),
    templateId: (meta.templateId as string) ?? undefined,
    templateName: (meta.templateName as string) ?? undefined,
    requestedDecision: (meta.requestedDecision as string) ?? undefined,
    resolvedAt: toDate((meta.resolvedAt as string) ?? null),
  };
}

type DeliberationRowInsert = Partial<Omit<DeliberationRow, 'id' | 'created_at' | 'updated_at'>>;

function buildMetadata(item: Partial<DeliberationItem>): Record<string, unknown> {
  return {
    status: item.status,
    type: item.type,
    createdByName: item.createdByName,
    ownerName: item.ownerName,
    ownerCommitteeId: item.ownerCommitteeId,
    ownerCommitteeName: item.ownerCommitteeName,
    dependentCommitteeNames: item.dependentCommitteeNames,
    strategicFlag: item.strategicFlag,
    outsideBudget: item.outsideBudget,
    marginPercent: item.marginPercent,
    quorumRequired: item.quorumRequired,
    quorumPresent: item.quorumPresent,
    riskLevel: item.riskLevel,
    evidenceComplete: item.evidenceComplete,
    attachments: item.attachments,
    reviews: item.reviews,
    recommendation: item.recommendation,
    recommendationNotes: item.recommendationNotes,
    minutesSummary: item.minutesSummary,
    templateId: item.templateId,
    templateName: item.templateName,
    requestedDecision: item.requestedDecision,
    resolvedAt: item.resolvedAt ? new Date(item.resolvedAt).toISOString() : undefined,
  };
}

export function mapDeliberationToRow(
  item: Partial<DeliberationItem>,
  ctx?: { orgId: string; userId: string },
): DeliberationRowInsert {
  const row: DeliberationRowInsert = {
    title: item.title,
    description: item.description ?? null,
    status: item.deliberationStatus,
    vote_result: item.voteResult ?? null,
    priority: item.priority,
    // `owner_committee_id` é uuid FK → committees(id). O módulo usa ids de
    // política (ex.: 'hr'), que não são uuids; grava só quando for uuid real,
    // caso contrário null. O id lógico é preservado em metadata.ownerCommitteeId.
    owner_committee_id:
      item.ownerCommitteeId && UUID_RE.test(item.ownerCommitteeId) ? item.ownerCommitteeId : null,
    dependent_committee_ids: item.dependentCommitteeIds ?? null,
    due_date: item.dueDate ? new Date(item.dueDate).toISOString() : null,
    voting_window_start: item.votingStartedAt ? new Date(item.votingStartedAt).toISOString() : null,
    voting_window_end: item.votingClosedAt ? new Date(item.votingClosedAt).toISOString() : null,
    current_stage_id: item.currentStageId ?? null,
    stages: (item.stages as DeliberationStage[]) ?? [],
    minutes: (item.minutes as DeliberationMinutes) ?? null,
    linked_entities: (item.linkedEntities ?? []) as DeliberationItem['linkedEntities'],
    execution_items: (item.executionItems ?? []) as DeliberationActionItem[],
    audit_trail: (item.auditTrail ?? []) as AuditTrailEntry[],
    financial_impact:
      typeof item.financialImpact === 'number' ? { amount: item.financialImpact } : null,
    metadata: buildMetadata(item),
    closed_at:
      item.deliberationStatus === 'closed' && item.resolvedAt
        ? new Date(item.resolvedAt).toISOString()
        : null,
  };

  if (ctx) {
    row.organization_id = ctx.orgId;
    row.created_by = ctx.userId;
    row.submitted_by = ctx.userId;
  }

  Object.keys(row).forEach((k) => {
    if ((row as Record<string, unknown>)[k] === undefined) {
      delete (row as Record<string, unknown>)[k];
    }
  });

  return row;
}

async function appendAuditEntry(
  supabase: SupabaseLike,
  deliberationId: string,
  entry: AuditTrailEntry,
): Promise<void> {
  try {
    const { data, error } = await supabase
      .from(DELIBERATIONS_TABLE)
      .select('audit_trail')
      .eq('id', deliberationId)
      .single();
    if (error) {
      console.warn('appendAuditEntry: select failed', error.message);
      return;
    }
    const existing = Array.isArray(data?.audit_trail) ? (data!.audit_trail as AuditTrailEntry[]) : [];
    const next = [entry, ...existing];
    const { error: updateError } = await supabase
      .from(DELIBERATIONS_TABLE)
      .update({ audit_trail: next })
      .eq('id', deliberationId);
    if (updateError) {
      console.warn('appendAuditEntry: update failed', updateError.message);
    }
  } catch (err) {
    console.warn('appendAuditEntry: unexpected', err);
  }
}

function makeAuditEntry(
  deliberationId: string,
  action: AuditTrailEntry['action'],
  description: string,
  userId: string,
  userName: string,
  previousValue?: string,
  newValue?: string,
): AuditTrailEntry {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemId: deliberationId,
    action,
    description,
    userId,
    userName,
    previousValue,
    newValue,
    timestamp: new Date(),
  };
}

/* ─────────────────────────────────────────────────────────────
   Public types
   ───────────────────────────────────────────────────────────── */
export type CreateDeliberationInput = Omit<
  DeliberationItem,
  'id' | 'createdAt' | 'updatedAt' | 'submittedBy' | 'auditTrail' | 'votes' | 'voteResult'
> & {
  stages?: DeliberationStage[];
  linkedEntities?: DeliberationItem['linkedEntities'];
  executionItems?: DeliberationActionItem[];
};

export type UpdateDeliberationInput = Partial<
  Omit<DeliberationItem, 'id' | 'createdAt' | 'updatedAt' | 'votes'>
>;

export type CastVoteInput = {
  vote: VoteOption;
  justification?: string;
  hasConflictOfInterest?: boolean;
  stageId?: string;
};

export type CloseVotingOutcome = 'approved' | 'rejected' | 'no_quorum' | 'returned_for_revision';

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */
export async function listDeliberations(): Promise<DeliberationItem[]> {
  const supabase = createClient();
  const { data: rows, error } = await supabase
    .from(DELIBERATIONS_TABLE)
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar deliberações', error));

  const list = (rows ?? []) as DeliberationRow[];
  if (list.length === 0) return [];

  const ids = list.map((r) => r.id);
  const { data: voteRows, error: votesError } = await supabase
    .from(VOTES_TABLE)
    .select('*')
    .in('deliberation_id', ids);

  if (votesError) {
    console.warn('listDeliberations: vote fetch failed', votesError.message);
  }

  const votesByDeliberation = new Map<string, VoteRecord[]>();
  for (const v of (voteRows ?? []) as VoteRow[]) {
    const arr = votesByDeliberation.get(v.deliberation_id) ?? [];
    arr.push(hydrateVote(v));
    votesByDeliberation.set(v.deliberation_id, arr);
  }

  return list.map((row) => mapRowToDeliberation(row, votesByDeliberation.get(row.id) ?? []));
}

export async function createDeliberation(input: CreateDeliberationInput): Promise<DeliberationItem> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  const auditEntry = makeAuditEntry(
    'pending',
    'status_changed',
    'Decisão submetida.',
    userId,
    userName,
    undefined,
    'submitted',
  );

  const itemForRow: Partial<DeliberationItem> = {
    ...input,
    deliberationStatus: input.deliberationStatus ?? 'submitted',
    auditTrail: [auditEntry],
  };

  const row = mapDeliberationToRow(itemForRow, { orgId, userId });

  const { data, error } = await supabase
    .from(DELIBERATIONS_TABLE)
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error(rlsFriendlyMessage('Erro ao criar deliberação', error));
  return mapRowToDeliberation(data as DeliberationRow, []);
}

export async function updateDeliberation(
  id: string,
  patch: UpdateDeliberationInput,
): Promise<DeliberationItem> {
  const supabase = createClient();
  await getCurrentOrgAndUser(supabase);

  const row = mapDeliberationToRow(patch);
  delete (row as Record<string, unknown>).organization_id;
  delete (row as Record<string, unknown>).submitted_by;
  delete (row as Record<string, unknown>).created_by;

  const { data, error } = await supabase
    .from(DELIBERATIONS_TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar deliberação', error));

  // Re-fetch votes for the returned row.
  const { data: voteRows } = await supabase
    .from(VOTES_TABLE)
    .select('*')
    .eq('deliberation_id', id);

  const votes = ((voteRows ?? []) as VoteRow[]).map(hydrateVote);
  return mapRowToDeliberation(data as DeliberationRow, votes);
}

export async function castVote(
  deliberationId: string,
  input: CastVoteInput,
): Promise<VoteRecord> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);

  const insertRow = {
    organization_id: orgId,
    deliberation_id: deliberationId,
    stage_id: input.stageId ?? null,
    voter_id: userId,
    voter_name: userName,
    vote: input.vote,
    justification: input.justification ?? null,
    has_conflict_of_interest: Boolean(input.hasConflictOfInterest),
  };

  const { data, error } = await supabase
    .from(VOTES_TABLE)
    .insert(insertRow)
    .select('*')
    .single();

  if (error) throw new Error(rlsFriendlyMessage('Erro ao registrar voto', error));

  const record = hydrateVote(data as VoteRow);

  await appendAuditEntry(
    supabase,
    deliberationId,
    makeAuditEntry(
      deliberationId,
      'vote_cast',
      `Voto registrado: ${input.vote.toUpperCase()}`,
      userId,
      userName,
    ),
  );

  return record;
}

async function patchStatus(
  id: string,
  patch: Record<string, unknown>,
  audit: { action: AuditTrailEntry['action']; description: string; previousValue?: string; newValue?: string },
): Promise<DeliberationItem> {
  const supabase = createClient();
  const { userId, userName } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(DELIBERATIONS_TABLE)
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar deliberação', error));

  await appendAuditEntry(
    supabase,
    id,
    makeAuditEntry(
      id,
      audit.action,
      audit.description,
      userId,
      userName,
      audit.previousValue,
      audit.newValue,
    ),
  );

  const { data: voteRows } = await supabase
    .from(VOTES_TABLE)
    .select('*')
    .eq('deliberation_id', id);
  const votes = ((voteRows ?? []) as VoteRow[]).map(hydrateVote);

  return mapRowToDeliberation(data as DeliberationRow, votes);
}

export async function startVoting(id: string): Promise<DeliberationItem> {
  return patchStatus(
    id,
    {
      status: 'in_voting' as DeliberationStatus,
      voting_window_start: new Date().toISOString(),
    },
    {
      action: 'voting_started',
      description: 'Janela de votação aberta.',
      newValue: 'in_voting',
    },
  );
}

export async function closeVoting(
  id: string,
  outcome: CloseVotingOutcome,
): Promise<DeliberationItem> {
  const nextStatus: DeliberationStatus =
    outcome === 'returned_for_revision'
      ? 'returned_for_revision'
      : outcome === 'no_quorum'
      ? 'in_review'
      : 'awaiting_minutes';

  return patchStatus(
    id,
    {
      status: nextStatus,
      vote_result: outcome,
      voting_window_end: new Date().toISOString(),
    },
    {
      action: 'voting_closed',
      description: `Janela de votação encerrada com resultado: ${outcome}.`,
      newValue: nextStatus,
    },
  );
}

export async function approveDeliberation(
  id: string,
  justification?: string,
): Promise<DeliberationItem> {
  return patchStatus(
    id,
    {
      status: 'resolved' as DeliberationStatus,
      vote_result: 'approved',
    },
    {
      action: 'decision_issued',
      description: justification
        ? `Decisão aprovada: ${justification}`
        : 'Decisão aprovada.',
      newValue: 'resolved',
    },
  );
}

export async function rejectDeliberation(
  id: string,
  justification?: string,
): Promise<DeliberationItem> {
  return patchStatus(
    id,
    {
      status: 'resolved' as DeliberationStatus,
      vote_result: 'rejected',
    },
    {
      action: 'decision_issued',
      description: justification
        ? `Decisão rejeitada: ${justification}`
        : 'Decisão rejeitada.',
      newValue: 'resolved',
    },
  );
}

export async function closeDeliberation(
  id: string,
  justification?: string,
): Promise<DeliberationItem> {
  return patchStatus(
    id,
    {
      status: 'closed' as DeliberationStatus,
      closed_at: new Date().toISOString(),
    },
    {
      action: 'status_changed',
      description: justification ? `Encerrada: ${justification}` : 'Decisão encerrada.',
      newValue: 'closed',
    },
  );
}

export async function withdrawDeliberation(
  id: string,
  justification?: string,
): Promise<DeliberationItem> {
  return patchStatus(
    id,
    {
      status: 'withdrawn' as DeliberationStatus,
    },
    {
      action: 'status_changed',
      description: justification ? `Retirada: ${justification}` : 'Decisão retirada.',
      newValue: 'withdrawn',
    },
  );
}

export async function deleteDeliberation(id: string): Promise<void> {
  const supabase = createClient();
  await getCurrentOrgAndUser(supabase);
  const { error } = await supabase.from(DELIBERATIONS_TABLE).delete().eq('id', id);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao remover deliberação', error));
}

/* ─────────────────────────────────────────────────────────────
   Operational mutations (opinion / evidence / execution / minutes / task)
   These persist through the existing deliberations row (JSONB detail model)
   + deliberation_votes, mirror the enterprise audit_logs table via
   logAuditEvent, and fan out in-app notifications through the shared
   SECURITY DEFINER create_notification RPC. Notifications are best-effort
   and never block the mutation.
   ───────────────────────────────────────────────────────────── */

const DELIBERATION_LINK = '/deliberacoes';

/** Best-effort in-app notification for another org member. Never throws. */
async function notifyRecipient(
  supabase: SupabaseLike,
  recipientUserId: string | null | undefined,
  type: string,
  title: string,
  body: string,
): Promise<void> {
  if (!recipientUserId) return;
  try {
    const { error } = await supabase.rpc('create_notification', {
      p_recipient: recipientUserId,
      p_type: type,
      p_title: title,
      p_body: body,
      p_link: DELIBERATION_LINK,
    });
    if (error) console.warn('[deliberations] notify failed:', error.message);
  } catch (e) {
    console.warn('[deliberations] notify threw:', e instanceof Error ? e.message : e);
  }
}

/** Fetch the current row (for JSONB read-modify-write) + refresh helper. */
async function fetchRow(supabase: SupabaseLike, id: string): Promise<DeliberationRow> {
  const { data, error } = await supabase
    .from(DELIBERATIONS_TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar deliberação', error));
  return data as DeliberationRow;
}

async function refreshWithVotes(supabase: SupabaseLike, id: string): Promise<DeliberationItem> {
  const row = await fetchRow(supabase, id);
  const { data: voteRows } = await supabase.from(VOTES_TABLE).select('*').eq('deliberation_id', id);
  const votes = ((voteRows ?? []) as VoteRow[]).map(hydrateVote);
  return mapRowToDeliberation(row, votes);
}

export type RequestOpinionInput = {
  type: ReviewStatus['type'];
  reviewerUserId?: string;
  reviewerName?: string;
  notes?: string;
};

/** Register a pending opinion/parecer request (metadata.reviews) + notify. */
export async function requestOpinion(
  deliberationId: string,
  input: RequestOpinionInput,
): Promise<DeliberationItem> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);
  const row = await fetchRow(supabase, deliberationId);

  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const reviews = Array.isArray(meta.reviews) ? (meta.reviews as ReviewStatus[]) : [];
  const nextReviews: ReviewStatus[] = [
    ...reviews.filter((r) => r.type !== input.type),
    {
      type: input.type,
      status: 'pending',
      reviewerId: input.reviewerUserId,
      reviewerName: input.reviewerName,
      notes: input.notes,
    },
  ];

  const { error } = await supabase
    .from(DELIBERATIONS_TABLE)
    .update({ metadata: { ...meta, reviews: nextReviews } })
    .eq('id', deliberationId);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao solicitar parecer', error));

  await appendAuditEntry(
    supabase,
    deliberationId,
    makeAuditEntry(deliberationId, 'review_requested', `Parecer ${input.type} solicitado.`, userId, userName),
  );
  await logAuditEvent({
    organizationId: orgId,
    action: 'deliberation.opinion_requested',
    entityType: 'deliberation',
    entityId: deliberationId,
    metadata: { type: input.type, reviewerUserId: input.reviewerUserId ?? null },
  });
  await notifyRecipient(
    supabase,
    input.reviewerUserId,
    'deliberation_opinion_requested',
    'Parecer solicitado',
    `Foi solicitado seu parecer (${input.type}) na deliberação "${row.title}".`,
  );

  return refreshWithVotes(supabase, deliberationId);
}

export type AttachEvidenceInput = {
  name: string;
  url: string;
  type?: 'document' | 'link' | 'other';
};

/** Append an evidence attachment (metadata.attachments) + audit. */
export async function attachEvidence(
  deliberationId: string,
  input: AttachEvidenceInput,
): Promise<DeliberationItem> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);
  const row = await fetchRow(supabase, deliberationId);

  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const attachments = Array.isArray(meta.attachments)
    ? (meta.attachments as DeliberationItem['attachments'])
    : [];
  const nextAttachments = [
    ...(attachments ?? []),
    {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name,
      url: input.url,
      type: input.type ?? (input.url.startsWith('http') ? 'link' : 'document'),
    },
  ];

  const { error } = await supabase
    .from(DELIBERATIONS_TABLE)
    .update({ metadata: { ...meta, attachments: nextAttachments } })
    .eq('id', deliberationId);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao anexar evidência', error));

  await appendAuditEntry(
    supabase,
    deliberationId,
    makeAuditEntry(deliberationId, 'evidence_added', `Evidência anexada: ${input.name}.`, userId, userName),
  );
  await logAuditEvent({
    organizationId: orgId,
    action: 'deliberation.evidence_attached',
    entityType: 'deliberation',
    entityId: deliberationId,
    metadata: { name: input.name },
  });

  return refreshWithVotes(supabase, deliberationId);
}

export type ExecutionItemInput = {
  id?: string;
  title: string;
  ownerName: string;
  ownerUserId?: string;
  dueDate: string; // ISO
  status?: 'pending' | 'in_progress' | 'completed';
};

/** Add or update an execution action item (execution_items JSONB) + audit. */
export async function upsertExecutionItem(
  deliberationId: string,
  input: ExecutionItemInput,
): Promise<DeliberationItem> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);
  const row = await fetchRow(supabase, deliberationId);

  const items = Array.isArray(row.execution_items)
    ? (row.execution_items as DeliberationActionItem[])
    : [];
  const itemId = input.id ?? `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const nextItem: DeliberationActionItem = {
    id: itemId,
    title: input.title,
    ownerName: input.ownerName,
    dueDate: new Date(input.dueDate),
    status: input.status ?? 'pending',
  };
  const exists = items.some((i) => i.id === itemId);
  const nextItems = exists ? items.map((i) => (i.id === itemId ? nextItem : i)) : [...items, nextItem];

  const patch: Record<string, unknown> = { execution_items: nextItems };
  // First execution item promotes the deliberation into the execution stage.
  if (!exists && row.status === 'resolved') patch.status = 'in_execution';

  const { error } = await supabase.from(DELIBERATIONS_TABLE).update(patch).eq('id', deliberationId);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar execução', error));

  const action = exists ? 'deliberation.execution_updated' : 'deliberation.execution_started';
  await appendAuditEntry(
    supabase,
    deliberationId,
    makeAuditEntry(
      deliberationId,
      'execution_task_created',
      exists ? `Ação de execução atualizada: ${input.title}.` : `Ação de execução criada: ${input.title}.`,
      userId,
      userName,
    ),
  );
  await logAuditEvent({
    organizationId: orgId,
    action,
    entityType: 'deliberation',
    entityId: deliberationId,
    metadata: { itemId, status: nextItem.status },
  });
  if (!exists) {
    await notifyRecipient(
      supabase,
      input.ownerUserId,
      'deliberation_execution_assigned',
      'Execução atribuída',
      `Você é responsável pela ação "${input.title}" da deliberação "${row.title}".`,
    );
  }

  return refreshWithVotes(supabase, deliberationId);
}

export type GenerateMinutesInput = {
  agendaSummary?: string;
  decisionText?: string;
  votingResult?: string;
  actionItems?: string[];
  publish?: boolean;
};

/** Generate/attach the ata (minutes JSONB) and advance out of awaiting_minutes. */
export async function generateMinutes(
  deliberationId: string,
  input: GenerateMinutesInput = {},
): Promise<DeliberationItem> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);
  const row = await fetchRow(supabase, deliberationId);

  const votes = row.vote_result ?? 'pending';
  const minutes: DeliberationMinutes = {
    status: input.publish ? 'published' : 'draft',
    agendaSummary: input.agendaSummary ?? row.title,
    evidenceList: [],
    votingResult: input.votingResult ?? String(votes),
    decisionText: input.decisionText ?? `Decisão registrada para "${row.title}".`,
    actionItems: input.actionItems ?? [],
    publishedAt: input.publish ? new Date() : undefined,
  };

  const patch: Record<string, unknown> = {
    minutes: { ...minutes, publishedAt: minutes.publishedAt?.toISOString() },
  };
  // Publishing the ata resolves the decision if it was awaiting minutes.
  if (input.publish && row.status === 'awaiting_minutes') patch.status = 'resolved';

  const { error } = await supabase.from(DELIBERATIONS_TABLE).update(patch).eq('id', deliberationId);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao gerar ata', error));

  await appendAuditEntry(
    supabase,
    deliberationId,
    makeAuditEntry(
      deliberationId,
      input.publish ? 'minutes_published' : 'minutes_generated',
      input.publish ? 'Ata publicada.' : 'Ata gerada (rascunho).',
      userId,
      userName,
    ),
  );
  await logAuditEvent({
    organizationId: orgId,
    action: 'deliberation.minutes_generated',
    entityType: 'deliberation',
    entityId: deliberationId,
    metadata: { published: Boolean(input.publish) },
  });

  return refreshWithVotes(supabase, deliberationId);
}

export type CreateDeliberationTaskInput = {
  title: string;
  assigneeUserId: string | null;
  dueDate?: string; // ISO
  priority?: 'low' | 'medium' | 'high' | 'critical';
};

/**
 * Create an Agenda task natively linked to the deliberation
 * (tasks.related_deliberation_id). The Agenda service notifies the assignee;
 * we mirror the event into the deliberation audit trail + audit_logs.
 */
export async function createDeliberationTask(
  deliberationId: string,
  input: CreateDeliberationTaskInput,
): Promise<DeliberationItem> {
  const supabase = createClient();
  const { userId, orgId, userName } = await getCurrentOrgAndUser(supabase);
  const row = await fetchRow(supabase, deliberationId);

  await createTask({
    title: input.title,
    priority: input.priority ?? 'medium',
    assigneeUserId: input.assigneeUserId,
    dueAt: input.dueDate,
    relatedDeliberationId: deliberationId,
    relatedCommitteeId: row.owner_committee_id ?? null,
  });

  await appendAuditEntry(
    supabase,
    deliberationId,
    makeAuditEntry(deliberationId, 'execution_task_created', `Tarefa criada: ${input.title}.`, userId, userName),
  );
  await logAuditEvent({
    organizationId: orgId,
    action: 'deliberation.task_created',
    entityType: 'deliberation',
    entityId: deliberationId,
    metadata: { title: input.title, assigneeUserId: input.assigneeUserId },
  });

  return refreshWithVotes(supabase, deliberationId);
}
