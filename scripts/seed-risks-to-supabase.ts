// SERVER-ONLY seed script. Requires SUPABASE_SERVICE_ROLE_KEY in env. Bypasses RLS.
//
// Required env vars (read from .env.local or process.env):
//   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY                  — service-role key (server-only)
//
// Optional env vars (if absent, the script resolves defaults via queries):
//   SUPABASE_SEED_ORG_ID   — organization_id assigned to each seeded risk.
//                            Default: first row from `organizations` (oldest by created_at).
//   SUPABASE_SEED_USER_ID  — user_id used for `created_by` / responsible_id.
//                            Default: first user_id from `user_roles` whose role.key is
//                            `owner_admin` (falls back to oldest profile).
//
// Flags:
//   --reset   Delete every existing risk for the target org+origin='manual'
//             before inserting. We restrict to origin='manual' so that risks
//             previously derived from contracts/projects are not wiped.
//
// Notes on data shape:
//   We import the existing MOCK_RISKS from
//     src/components/risks/risk-mock-data.ts
//   directly via the `tsx` runner. The mock IDs (e.g. "RSK-001") are not
//   UUIDs so we generate fresh UUIDs with crypto.randomUUID() and rewrite the
//   nested `actions[].riskId`, `history[].riskId`, `evidences[].riskId`
//   pointers accordingly. Date fields are serialized to ISO strings.
//
// Usage:
//   npx tsx scripts/seed-risks-to-supabase.ts          # additive insert
//   npx tsx scripts/seed-risks-to-supabase.ts --reset  # wipe manual risks first

import 'dotenv/config';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { MOCK_RISKS } from '../src/components/risks/risk-mock-data';
import type {
  ExtendedRisk,
  RiskAction,
  RiskEvidence,
  RiskHistoryEntry,
} from '../src/components/risks/risk-types';

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

  // Try owner_admin first via user_roles -> roles.key.
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
    throw new Error(`Erro ao resolver created_by padrão: ${error.message}`);
  }
  if (!profile?.user_id) {
    throw new Error(
      'Nenhum perfil encontrado. Defina SUPABASE_SEED_USER_ID ou crie um usuário primeiro.',
    );
  }
  return profile.user_id as string;
}

function serializeAction(action: RiskAction, newRiskId: string) {
  return {
    id: action.id,
    riskId: newRiskId,
    title: action.title,
    description: action.description,
    assignee: action.assignee,
    dueDate: action.dueDate?.toISOString(),
    status: action.status,
    createdAt: action.createdAt?.toISOString(),
  };
}

function serializeHistory(entry: RiskHistoryEntry, newRiskId: string) {
  return {
    id: entry.id,
    riskId: newRiskId,
    action: entry.action,
    user: entry.user,
    timestamp: entry.timestamp?.toISOString(),
    detail: entry.detail,
  };
}

function serializeEvidence(ev: RiskEvidence, newRiskId: string) {
  return {
    id: ev.id,
    riskId: newRiskId,
    name: ev.name,
    type: ev.type,
    url: ev.url,
    uploadedAt: ev.uploadedAt?.toISOString(),
    uploadedBy: ev.uploadedBy,
  };
}

function toRow(risk: ExtendedRisk, orgId: string, userId: string) {
  const newId = randomUUID();
  return {
    id: newId,
    organization_id: orgId,
    title: risk.title,
    description: risk.description ?? null,
    category: risk.category,
    area: risk.area ?? null,
    probability: risk.probability,
    impact: risk.impact,
    // `level` is a GENERATED column — do not insert it.
    severity: risk.severity,
    origin: risk.origin,
    reference_id: risk.referenceId ?? null,
    reference_name: risk.referenceName ?? null,
    responsible_id: risk.responsibleId ?? null,
    responsible_name: risk.responsibleName ?? null,
    status: risk.status,
    mitigation_plan: risk.mitigationPlan ?? null,
    next_action: risk.nextAction ?? null,
    due_date: risk.dueDate ? risk.dueDate.toISOString() : null,
    actions: (risk.actions ?? []).map((a) => serializeAction(a, newId)),
    history: (risk.history ?? []).map((h) => serializeHistory(h, newId)),
    evidences: (risk.evidences ?? []).map((e) => serializeEvidence(e, newId)),
    created_by: userId,
    created_at: risk.createdAt ? risk.createdAt.toISOString() : new Date().toISOString(),
    updated_at: risk.updatedAt ? risk.updatedAt.toISOString() : new Date().toISOString(),
    resolved_at: risk.resolvedAt ? risk.resolvedAt.toISOString() : null,
  };
}

async function main() {
  const [orgId, userId] = await Promise.all([resolveOrgId(), resolveUserId()]);

  if (shouldReset) {
    const { error: delError, count } = await supabase
      .from('risks')
      .delete({ count: 'exact' })
      .eq('organization_id', orgId)
      .eq('origin', 'manual');
    if (delError) {
      throw new Error(`Erro ao limpar risks (--reset): ${delError.message}`);
    }
    console.log(`--reset: removidos ${count ?? 0} riscos manuais existentes do org ${orgId}.`);
  }

  const rows = MOCK_RISKS.map((risk) => toRow(risk, orgId, userId));

  const { error, count } = await supabase
    .from('risks')
    .insert(rows, { count: 'exact' });

  if (error) {
    if (error.code === 'PGRST205') {
      throw new Error(
        'A tabela public.risks ainda não existe. Aplique primeiro a migration 009 no SQL Editor do Supabase.',
      );
    }
    throw new Error(`Erro ao inserir riscos no Supabase: ${error.message}`);
  }

  console.log(
    `Inseridos ${count ?? rows.length} riscos no Supabase (organization_id=${orgId}, created_by=${userId}).`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
