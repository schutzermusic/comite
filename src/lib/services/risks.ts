import { createClient } from '@/utils/supabase/client';
import type {
  ExtendedRisk,
  RiskAction,
  RiskHistoryEntry,
  RiskEvidence,
} from '@/components/risks/risk-types';
import type { Risk } from '@/lib/types';

const RISKS_TABLE = 'risks';

type Severity = Risk['severity'];

/* ─────────────────────────────────────────────────────────────
   Row shape (snake_case in DB)
   ───────────────────────────────────────────────────────────── */
type RiskRow = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  category: string;
  area: string | null;
  probability: number;
  impact: number;
  level: number | null;
  severity: Severity;
  origin: Risk['origin'];
  reference_id: string | null;
  reference_name: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  status: Risk['status'];
  mitigation_plan: string | null;
  next_action: string | null;
  due_date: string | null;
  actions: RiskAction[] | null;
  history: RiskHistoryEntry[] | null;
  evidences: RiskEvidence[] | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  // Cockpit fields (migration 028)
  financial_exposure?: number | null;
  ai_recommendation?: string | null;
  // AI engine fields (migration 011)
  source_module?: string | null;
  source_entity_id?: string | null;
  ai_confidence?: number | null;
  ai_rationale?: string | null;
  ai_model?: string | null;
  ai_analyzed_at?: string | null;
  // AI dismissal (migration 012)
  ai_dismissed?: boolean | null;
  ai_dismissed_at?: string | null;
  ai_dismissed_by?: string | null;
  ai_dismissal_reason?: string | null;
};

/* ─────────────────────────────────────────────────────────────
   Public input types
   ───────────────────────────────────────────────────────────── */
export type CreateRiskInput = Omit<
  ExtendedRisk,
  'id' | 'createdAt' | 'updatedAt' | 'level' | 'severity'
> & {
  level?: number;
  severity?: Severity;
  actions?: RiskAction[];
  history?: RiskHistoryEntry[];
  evidences?: RiskEvidence[];
};

export type UpdateRiskInput = Partial<
  Omit<ExtendedRisk, 'id' | 'createdAt' | 'updatedAt' | 'level' | 'severity'>
> & {
  severity?: Severity;
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

function rlsFriendlyMessage(prefix: string, error: { code?: string; message?: string }): string {
  if (isRlsError(error)) return `${prefix}: Acesso negado pela política de segurança.`;
  return `${prefix}: ${error.message || 'erro desconhecido'}`;
}

type SupabaseLike = ReturnType<typeof createClient>;

async function getCurrentOrgAndUser(
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

/**
 * Severity thresholds derived from existing MOCK_RISKS samples:
 *  level 6 → low, 8/9/10 → medium, 12/15 → high, 16/20 → critical.
 * Mapping: 1–6 low, 7–11 medium, 12–15 high, 16+ critical.
 */
export function computeSeverity(level: number): Severity {
  if (level >= 16) return 'critical';
  if (level >= 12) return 'high';
  if (level >= 7) return 'medium';
  return 'low';
}

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function hydrateActions(raw: RiskAction[] | null | undefined): RiskAction[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => ({
    ...a,
    dueDate: toDate(a.dueDate as unknown as string) ?? new Date(),
    createdAt: toDate(a.createdAt as unknown as string) ?? new Date(),
  }));
}

function hydrateHistory(raw: RiskHistoryEntry[] | null | undefined): RiskHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((h) => ({
    ...h,
    timestamp: toDate(h.timestamp as unknown as string) ?? new Date(),
  }));
}

function hydrateEvidences(raw: RiskEvidence[] | null | undefined): RiskEvidence[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => ({
    ...e,
    uploadedAt: toDate(e.uploadedAt as unknown as string) ?? new Date(),
  }));
}

export function mapRowToExtendedRisk(row: RiskRow): ExtendedRisk {
  const probability = row.probability ?? 0;
  const impact = row.impact ?? 0;
  const level = row.level ?? probability * impact;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    area: row.area ?? '',
    probability,
    impact,
    level,
    severity: row.severity ?? computeSeverity(level),
    origin: row.origin,
    referenceId: row.reference_id ?? undefined,
    referenceName: row.reference_name ?? undefined,
    responsibleId: row.responsible_id ?? undefined,
    responsibleName: row.responsible_name ?? undefined,
    status: row.status,
    mitigationPlan: row.mitigation_plan ?? undefined,
    nextAction: row.next_action ?? undefined,
    dueDate: toDate(row.due_date),
    financialExposure: row.financial_exposure ?? undefined,
    actions: hydrateActions(row.actions),
    history: hydrateHistory(row.history),
    evidences: hydrateEvidences(row.evidences),
    createdAt: toDate(row.created_at) ?? new Date(),
    updatedAt: toDate(row.updated_at) ?? new Date(),
    resolvedAt: toDate(row.resolved_at),
    sourceModule: row.source_module ?? undefined,
    sourceEntityId: row.source_entity_id ?? undefined,
    aiConfidence: row.ai_confidence ?? undefined,
    aiRationale: row.ai_rationale ?? undefined,
    aiRecommendation: row.ai_recommendation ?? undefined,
    aiModel: row.ai_model ?? undefined,
    aiAnalyzedAt: toDate(row.ai_analyzed_at),
    aiDismissed: row.ai_dismissed ?? false,
    aiDismissedAt: toDate(row.ai_dismissed_at),
    aiDismissedBy: row.ai_dismissed_by ?? undefined,
    aiDismissalReason: row.ai_dismissal_reason ?? undefined,
  };
}

type RowInsert = Omit<RiskRow, 'id' | 'level' | 'created_at' | 'updated_at'> & {
  id?: string;
};

/**
 * Maps an ExtendedRisk-like input into a row shape. Never emits computed `level`
 * (DB generated) and only emits `organization_id`/`created_by` when ctx is provided
 * (i.e. on insert).
 */
export function mapExtendedRiskToRow(
  risk: CreateRiskInput | UpdateRiskInput,
  ctx?: { orgId: string; userId: string },
): Partial<RowInsert> {
  const probability = risk.probability ?? undefined;
  const impact = risk.impact ?? undefined;

  const row: Partial<RowInsert> = {
    title: risk.title,
    description: risk.description ?? null,
    category: risk.category,
    area: risk.area ?? null,
    probability,
    impact,
    severity: risk.severity,
    origin: risk.origin,
    reference_id: risk.referenceId ?? null,
    reference_name: risk.referenceName ?? null,
    responsible_id: risk.responsibleId ?? null,
    responsible_name: risk.responsibleName ?? null,
    status: risk.status,
    mitigation_plan: risk.mitigationPlan ?? null,
    next_action: risk.nextAction ?? null,
    due_date: risk.dueDate ? new Date(risk.dueDate).toISOString() : null,
    financial_exposure: risk.financialExposure ?? null,
    // Only emit JSONB arrays when the caller actually provides them, so a
    // partial update (e.g. status-only) never wipes existing actions/history/
    // evidences. `undefined` values are stripped below.
    actions: risk.actions as RiskAction[] | undefined,
    history: risk.history as RiskHistoryEntry[] | undefined,
    evidences: risk.evidences as RiskEvidence[] | undefined,
    resolved_at: risk.resolvedAt ? new Date(risk.resolvedAt).toISOString() : null,
  };

  if (ctx) {
    row.organization_id = ctx.orgId;
    row.created_by = ctx.userId;
  }

  // Strip undefined keys so partial updates don't blow away columns.
  Object.keys(row).forEach((k) => {
    if ((row as Record<string, unknown>)[k] === undefined) {
      delete (row as Record<string, unknown>)[k];
    }
  });

  return row;
}

/* ─────────────────────────────────────────────────────────────
   Public API
   ───────────────────────────────────────────────────────────── */

export async function listRisks(): Promise<ExtendedRisk[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(RISKS_TABLE)
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar riscos', error));
  return (data ?? []).map((row) => mapRowToExtendedRisk(row as RiskRow));
}

export interface RiskBadgeCounts {
  /** Open critical risks (status not resolved/closed). */
  critical: number;
  /** Active AI-detected alerts awaiting review (not dismissed, not resolved). */
  aiAlerts: number;
}

/**
 * Lightweight count-only query for the sidebar badge. Uses `head: true` so no
 * rows are transferred — only the count — keeping it cheap to run globally.
 */
export async function getRiskBadgeCounts(): Promise<RiskBadgeCounts> {
  const supabase = createClient();
  const OPEN_STATUSES = ['open', 'mitigating'];

  const [criticalRes, aiRes] = await Promise.all([
    supabase
      .from(RISKS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('severity', 'critical')
      .in('status', OPEN_STATUSES)
      .or('ai_dismissed.is.null,ai_dismissed.eq.false'),
    supabase
      .from(RISKS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('origin', 'ai')
      .in('status', OPEN_STATUSES)
      .or('ai_dismissed.is.null,ai_dismissed.eq.false'),
  ]);

  if (criticalRes.error) throw new Error(rlsFriendlyMessage('Erro ao contar riscos', criticalRes.error));
  if (aiRes.error) throw new Error(rlsFriendlyMessage('Erro ao contar alertas de risco', aiRes.error));

  return {
    critical: criticalRes.count ?? 0,
    aiAlerts: aiRes.count ?? 0,
  };
}

export async function createRisk(input: CreateRiskInput): Promise<ExtendedRisk> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const probability = input.probability;
  const impact = input.impact;
  const level = probability * impact;
  const severity: Severity = input.severity ?? computeSeverity(level);

  const row = mapExtendedRiskToRow({ ...input, severity }, { orgId, userId });

  const { data, error } = await supabase
    .from(RISKS_TABLE)
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error(rlsFriendlyMessage('Erro ao criar risco', error));
  return mapRowToExtendedRisk(data as RiskRow);
}

export async function updateRisk(id: string, patch: UpdateRiskInput): Promise<ExtendedRisk> {
  const supabase = createClient();
  await getCurrentOrgAndUser(supabase);

  // If probability/impact present and severity not explicit, recompute severity.
  let nextPatch: UpdateRiskInput = { ...patch };
  if (
    nextPatch.severity === undefined &&
    typeof nextPatch.probability === 'number' &&
    typeof nextPatch.impact === 'number'
  ) {
    nextPatch.severity = computeSeverity(nextPatch.probability * nextPatch.impact);
  }

  const row = mapExtendedRiskToRow(nextPatch);
  // Defensive guard: never send organization_id or created_by in updates.
  delete (row as Record<string, unknown>).organization_id;
  delete (row as Record<string, unknown>).created_by;

  const { data, error } = await supabase
    .from(RISKS_TABLE)
    .update(row)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(rlsFriendlyMessage('Erro ao atualizar risco', error));
  return mapRowToExtendedRisk(data as RiskRow);
}

export async function deleteRisk(id: string): Promise<void> {
  const supabase = createClient();
  await getCurrentOrgAndUser(supabase);

  const { error } = await supabase.from(RISKS_TABLE).delete().eq('id', id);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao remover risco', error));
}

/* ─────────────────────────────────────────────────────────────
   AI Risk Engine — client trigger
   Calls the server Route Handler that runs the Anthropic SDK
   and inserts AI-origin risks via service-role.
   ───────────────────────────────────────────────────────────── */
export async function triggerContractAiScan(
  contractId: string,
): Promise<{ count: number; risks: ExtendedRisk[] }> {
  const res = await fetch(`/api/ai/risk-scan/contracts/${contractId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  let body: { ok?: boolean; inserted?: number; risks?: RiskRow[]; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    // ignore parse failure
  }

  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Falha na análise IA (HTTP ${res.status})`);
  }

  const rows = Array.isArray(body.risks) ? body.risks : [];
  return {
    count: typeof body.inserted === 'number' ? body.inserted : rows.length,
    risks: rows.map((r) => mapRowToExtendedRisk(r as RiskRow)),
  };
}

export interface FinanceScanResponse {
  count: number;
  scanned: number;
  period: string;
  skipped: number;
  risks: ExtendedRisk[];
}

export async function triggerFinanceAiScan(opts?: {
  periodFrom?: string;
  periodTo?: string;
}): Promise<FinanceScanResponse> {
  const res = await fetch('/api/ai/risk-scan/finance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts ?? {}),
  });
  let body: {
    ok?: boolean;
    inserted?: number;
    scanned?: number;
    period?: string;
    skipped_duplicates?: number;
    risks?: RiskRow[];
    error?: string;
  } = {};
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Falha na análise IA financeira (HTTP ${res.status})`);
  }
  const rows = Array.isArray(body.risks) ? body.risks : [];
  return {
    count: typeof body.inserted === 'number' ? body.inserted : rows.length,
    scanned: typeof body.scanned === 'number' ? body.scanned : 0,
    period: body.period ?? '',
    skipped: typeof body.skipped_duplicates === 'number' ? body.skipped_duplicates : 0,
    risks: rows.map((r) => mapRowToExtendedRisk(r as RiskRow)),
  };
}

export async function triggerProjectAiScan(
  projectId: string,
): Promise<{ count: number; skipped: number; risks: ExtendedRisk[] }> {
  const res = await fetch(`/api/ai/risk-scan/projects/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  let body: {
    ok?: boolean;
    inserted?: number;
    skipped_duplicates?: number;
    risks?: RiskRow[];
    error?: string;
  } = {};
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Falha na análise IA do projeto (HTTP ${res.status})`);
  }
  const rows = Array.isArray(body.risks) ? body.risks : [];
  return {
    count: typeof body.inserted === 'number' ? body.inserted : rows.length,
    skipped: typeof body.skipped_duplicates === 'number' ? body.skipped_duplicates : 0,
    risks: rows.map((r) => mapRowToExtendedRisk(r as RiskRow)),
  };
}

export async function dismissAiRisk(
  riskId: string,
  reason?: string,
): Promise<ExtendedRisk | null> {
  const res = await fetch(`/api/ai/risks/${riskId}/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  let body: { ok?: boolean; risk?: RiskRow; already?: boolean; error?: string } = {};
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Falha ao descartar (HTTP ${res.status})`);
  }
  return body.risk ? mapRowToExtendedRisk(body.risk as RiskRow) : null;
}
