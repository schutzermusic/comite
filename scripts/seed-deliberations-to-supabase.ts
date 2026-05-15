// SERVER-ONLY seed script. Requires SUPABASE_SERVICE_ROLE_KEY in env. Bypasses RLS.
//
// Required env vars (read from .env.local or process.env):
//   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY                  — service-role key (server-only)
//
// Optional env vars (if absent, the script resolves defaults via queries):
//   SUPABASE_SEED_ORG_ID   — organization_id assigned to each seeded deliberation.
//                            Default: first row from `organizations` (oldest by created_at).
//   SUPABASE_SEED_USER_ID  — user_id used for `submitted_by` / `created_by`.
//                            Default: first user_id from `user_roles` whose role.key is
//                            `owner_admin` (falls back to oldest profile).
//
// Flags:
//   --reset   Delete every existing deliberation for the target org before
//             inserting (deliberation_votes cascades via FK).
//
// Notes on data shape:
//   `initialItems` is NOT currently exported from
//   src/app/(main)/pautas/page.tsx (Agent J owns that file in this migration
//   step, so this script does NOT modify it). We use an inline snapshot of
//   2 representative items (extracted from pautas/page.tsx as of 2026-05-13)
//   covering an `in_review` deliberation with no votes and an `in_voting`
//   deliberation with 3 cached votes. Mock IDs are not UUIDs; fresh UUIDs are
//   generated with crypto.randomUUID() on insert. Date fields are serialized
//   to ISO strings. For each cached vote, voter_id must resolve to a real
//   auth.users id; the seed gracefully skips votes lacking a real voter and
//   logs a warning (does not fail the run).
//
// Usage:
//   npx tsx scripts/seed-deliberations-to-supabase.ts          # additive insert
//   npx tsx scripts/seed-deliberations-to-supabase.ts --reset  # wipe org's deliberations first

import 'dotenv/config';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local', override: true });

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error(
    'Defina NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL) em .env.local.',
  );
}
if (!serviceRoleKey) {
  throw new Error(
    'Defina SUPABASE_SERVICE_ROLE_KEY em .env.local. Esse script é SERVER-ONLY e bypassa RLS — nunca use a anon key.',
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const shouldReset = process.argv.includes('--reset');

// ------------------------------------------------------------------
// Inline snapshot of initialItems extracted from
//   src/app/(main)/pautas/page.tsx as of 2026-05-13.
// Two representative deliberations: one mid-review (no votes), one
// in-voting (3 cached votes). Shape mirrors DeliberationItem in
// src/lib/types.ts but flattened for seeding.
// ------------------------------------------------------------------

type SeedVote = {
  voterId: string;
  voterName: string;
  vote: 'yes' | 'no' | 'abstain';
  justification?: string;
  hasConflictOfInterest: boolean;
  stageId?: string;
  votedAt: string; // ISO
};

type SeedDeliberation = {
  code: string;
  title: string;
  description: string;
  status:
    | 'draft'
    | 'submitted'
    | 'in_review'
    | 'in_voting'
    | 'awaiting_minutes'
    | 'resolved'
    | 'in_execution'
    | 'closed'
    | 'returned_for_revision'
    | 'withdrawn';
  voteResult?:
    | 'approved'
    | 'rejected'
    | 'pending'
    | 'no_quorum'
    | 'returned_for_revision';
  priority: string;
  confidentiality?: string;
  ownerCommitteeKey?: string; // resolved to committees.id by key
  dependentCommitteeKeys: string[];
  dueDate?: string;
  votingWindowStart?: string;
  votingWindowEnd?: string;
  currentStageId?: string;
  stages: unknown[];
  linkedEntities: unknown[];
  executionItems: unknown[];
  auditTrail: unknown[];
  financialImpact?: unknown;
  metadata: Record<string, unknown>;
  votes: SeedVote[];
};

const SEED_ITEMS: SeedDeliberation[] = [
  {
    code: 'DEL-2026-001',
    title: 'Promoção executiva e ajuste de pacote C-Level',
    description:
      'RH solicita aprovação de promoção estratégica com ajuste de remuneração, retenção e expansão de escopo executivo.',
    status: 'in_review',
    priority: 'high',
    confidentiality: 'confidential',
    ownerCommitteeKey: 'hr',
    dependentCommitteeKeys: ['finance', 'legal'],
    dueDate: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(),
    currentStageId: 'stage-1-hr',
    stages: [],
    linkedEntities: [
      { id: 'PPL-2044', label: 'Pessoa: Diretora de Operações', type: 'person' },
      { id: 'CC-RH-EXEC', label: 'Centro de custo executivo', type: 'cost' },
      { id: 'RSK-118', label: 'Risco de retenção crítica', type: 'risk' },
    ],
    executionItems: [],
    auditTrail: [
      {
        action: 'status_changed',
        description: 'Solicitação criada por Diretoria de RH.',
        previousValue: 'draft',
        newValue: 'submitted',
        timestamp: new Date('2026-04-28T10:00:00').toISOString(),
      },
    ],
    financialImpact: { amount: 620000, currency: 'BRL' },
    metadata: {
      templateId: 'HR_HIRING_APPROVAL',
      templateName: 'Movimentação executiva',
      requestedDecision:
        'Aprovar promoção, pacote de retenção e liberação orçamentária vinculada ao plano de sucessão.',
      riskLevel: 'high',
      evidenceComplete: true,
      quorumRequired: 3,
      quorumPresent: 2,
    },
    votes: [],
  },
  {
    code: 'DEL-2026-002',
    title: 'CAPEX para infraestrutura de IA operacional',
    description:
      'Engenharia propõe investimento em infraestrutura de IA para otimização de rede, disponibilidade e automação operacional.',
    status: 'in_voting',
    priority: 'critical',
    ownerCommitteeKey: 'finance',
    dependentCommitteeKeys: ['risk', 'rnd'],
    dueDate: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
    votingWindowStart: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    votingWindowEnd: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(),
    currentStageId: 'stage-1-finance',
    stages: [],
    linkedEntities: [
      { id: 'PRJ-AI-014', label: 'Projeto IA Operacional', type: 'project' },
      { id: 'CAPEX-2026-08', label: 'Budget CAPEX 2026', type: 'cost' },
      { id: 'RSK-229', label: 'Risco tecnológico crítico', type: 'risk' },
    ],
    executionItems: [],
    auditTrail: [
      {
        action: 'status_changed',
        description: 'Solicitação submetida ao Comitê Financeiro.',
        previousValue: 'draft',
        newValue: 'submitted',
        timestamp: new Date('2026-04-30T08:30:00').toISOString(),
      },
      {
        action: 'voting_started',
        description: 'Janela de votação aberta no Comitê Financeiro.',
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      },
    ],
    financialImpact: { amount: 8200000, currency: 'BRL' },
    metadata: {
      templateId: 'FINANCE_CAPEX_APPROVAL',
      templateName: 'Aprovação de CAPEX',
      requestedDecision:
        'Aprovar alocação de CAPEX, fonte de financiamento e controles de execução do programa.',
      riskLevel: 'critical',
      evidenceComplete: true,
      quorumRequired: 4,
      quorumPresent: 4,
    },
    votes: [
      // voterId is the mock TS id — must be remapped to a real auth.users id
      // before insert. If unresolved, the vote is skipped with a warning.
      {
        voterId: 'user-1',
        voterName: 'CFO',
        vote: 'yes',
        justification: 'ROI e mitigadores estão aderentes.',
        hasConflictOfInterest: false,
        stageId: 'stage-1-finance',
        votedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      },
      {
        voterId: 'user-current',
        voterName: 'Usuário Atual',
        vote: 'abstain',
        hasConflictOfInterest: false,
        stageId: 'stage-1-finance',
        votedAt: new Date().toISOString(),
      },
      {
        voterId: 'user-3',
        voterName: 'Diretoria de Operações',
        vote: 'yes',
        hasConflictOfInterest: false,
        stageId: 'stage-1-finance',
        votedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
    ],
  },
];

// ------------------------------------------------------------------
// Resolvers
// ------------------------------------------------------------------

async function resolveOrgId(): Promise<string> {
  const explicit = process.env.SUPABASE_SEED_ORG_ID;
  if (explicit) return explicit;

  const { data, error } = await supabase
    .from('organizations')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Erro ao resolver organization_id padrão: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error(
      'Nenhuma organização encontrada. Defina SUPABASE_SEED_ORG_ID ou crie uma organização primeiro.',
    );
  }
  return data.id as string;
}

async function resolveUserId(): Promise<string> {
  const explicit = process.env.SUPABASE_SEED_USER_ID;
  if (explicit) return explicit;

  const { data: ownerData } = await supabase
    .from('user_roles')
    .select('user_id, roles!inner(key)')
    .eq('roles.key', 'owner_admin')
    .limit(1)
    .maybeSingle();
  const ownerId = (ownerData as { user_id?: string } | null)?.user_id;
  if (ownerId) return ownerId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('user_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Erro ao resolver submitted_by padrão: ${error.message}`);
  }
  if (!profile?.user_id) {
    throw new Error(
      'Nenhum perfil encontrado. Defina SUPABASE_SEED_USER_ID ou crie um usuário primeiro.',
    );
  }
  return profile.user_id as string;
}

async function loadCommitteesForOrg(orgId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('committees')
    .select('id, key')
    .eq('organization_id', orgId);
  if (error) {
    throw new Error(`Erro ao carregar comitês: ${error.message}`);
  }
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ id: string; key: string }>) {
    map.set(row.key, row.id);
  }
  return map;
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------

async function main() {
  const [orgId, userId] = await Promise.all([resolveOrgId(), resolveUserId()]);
  const committees = await loadCommitteesForOrg(orgId);

  if (shouldReset) {
    const { error: delError, count } = await supabase
      .from('deliberations')
      .delete({ count: 'exact' })
      .eq('organization_id', orgId);
    if (delError) {
      throw new Error(
        `Erro ao limpar deliberations (--reset): ${delError.message}`,
      );
    }
    console.log(
      `--reset: removidas ${count ?? 0} deliberações existentes do org ${orgId} (votos cascataram).`,
    );
  }

  let insertedDelibs = 0;
  let insertedVotes = 0;
  let skippedVotes = 0;

  for (const item of SEED_ITEMS) {
    const newId = randomUUID();
    const ownerCommitteeId = item.ownerCommitteeKey
      ? committees.get(item.ownerCommitteeKey) ?? null
      : null;
    const dependentIds = item.dependentCommitteeKeys
      .map((k) => committees.get(k))
      .filter((v): v is string => Boolean(v));

    const row = {
      id: newId,
      organization_id: orgId,
      code: item.code,
      title: item.title,
      description: item.description,
      status: item.status,
      vote_result: item.voteResult ?? null,
      priority: item.priority,
      confidentiality: item.confidentiality ?? 'normal',
      owner_committee_id: ownerCommitteeId,
      dependent_committee_ids: dependentIds,
      submitted_by: userId,
      assignee_user_id: null,
      due_date: item.dueDate ?? null,
      voting_window_start: item.votingWindowStart ?? null,
      voting_window_end: item.votingWindowEnd ?? null,
      current_stage_id: item.currentStageId ?? null,
      stages: item.stages,
      minutes: null,
      linked_entities: item.linkedEntities,
      execution_items: item.executionItems,
      audit_trail: item.auditTrail,
      financial_impact: item.financialImpact ?? null,
      metadata: item.metadata,
      created_by: userId,
    };

    const { error: insErr } = await supabase
      .from('deliberations')
      .insert(row);

    if (insErr) {
      if (insErr.code === 'PGRST205') {
        throw new Error(
          'A tabela public.deliberations ainda não existe. Aplique primeiro a migration 010 no SQL Editor do Supabase.',
        );
      }
      throw new Error(
        `Erro ao inserir deliberação "${item.title}": ${insErr.message}`,
      );
    }
    insertedDelibs += 1;

    // ---- votes ----
    for (const v of item.votes) {
      // mock voterId (e.g. 'user-1') must be remapped to a real auth.users id.
      // We do not have a stable mapping, so we skip with a warning unless the
      // mock id happens to already be a UUID (i.e. an admin pre-mapped it).
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          v.voterId,
        );
      const realVoterId = isUuid ? v.voterId : null;

      if (!realVoterId) {
        console.warn(
          `[skip] vote por "${v.voterName}" em "${item.title}": voterId "${v.voterId}" não é UUID e não foi remapeado. ` +
            `Defina um mapping ou pré-cadastre o auth.users.id correspondente.`,
        );
        skippedVotes += 1;
        continue;
      }

      const voteRow = {
        id: randomUUID(),
        organization_id: orgId,
        deliberation_id: newId,
        stage_id: v.stageId ?? null,
        voter_id: realVoterId,
        voter_name: v.voterName,
        vote: v.vote,
        justification: v.justification ?? null,
        has_conflict_of_interest: v.hasConflictOfInterest,
        voted_at: v.votedAt,
      };

      const { error: voteErr } = await supabase
        .from('deliberation_votes')
        .insert(voteRow);
      if (voteErr) {
        console.warn(
          `[skip] vote por "${v.voterName}" em "${item.title}": ${voteErr.message}`,
        );
        skippedVotes += 1;
        continue;
      }
      insertedVotes += 1;
    }
  }

  console.log(
    `Inseridas ${insertedDelibs} deliberações (organization_id=${orgId}, submitted_by=${userId}).`,
  );
  console.log(`Votos inseridos: ${insertedVotes} | pulados: ${skippedVotes}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
