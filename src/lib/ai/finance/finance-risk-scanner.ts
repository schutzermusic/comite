/**
 * Finance AI Risk Scanner — Phase 1 of the Finance AI Copilot plan.
 *
 * Scans a batch of `ledger_entry` rows (the canonical "finance entries" of
 * this codebase; `finance_entries` from the plan doc maps to this table)
 * and asks Claude Sonnet 4.6 to flag anomalies, duplicates, suppliers
 * without contract, atypical due dates, etc. Findings land in `public.risks`
 * with origin='ai', source_module='finance', and source_entity_id anchored
 * to a specific ledger_entry where possible.
 *
 * Phase-1 scope per docs/plan/FINANCE_AI_COPILOT_PLAN.md:
 *   - ledger_entry only (no payroll yet)
 *   - org_id of the AI-generated risk row = caller's current_user_organization_id
 *     (ledger_entry has no organization_id today; documented as future hardening).
 *   - on-demand trigger, gated by risks.ai_scan.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/finance/finance-risk-scanner.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { callAnthropicForRiskFindings } from '../anthropic-call';
import { persistAiRiskFindings, type PersistFindingsResult } from '../risk-persistence';
import { getServiceClient } from '../server-clients';
import type { AiRiskFinding } from '../types';

/* ─────────────────────────────────────────────────────────────
   System prompt — finance domain
   ───────────────────────────────────────────────────────────── */
const FINANCE_SYSTEM_PROMPT = `Você é um analista sênior de riscos financeiros corporativos para uma plataforma de governança.
Recebe um lote de lançamentos contábeis (ledger entries) recentes de uma organização brasileira e deve identificar
riscos materiais que mereçam atenção da diretoria financeira.

PADRÕES DE RISCO A INVESTIGAR (não exaustivo):
- Lançamentos com valor fora do padrão histórico para a mesma categoria/centro de custo.
- Fornecedor sem contrato vinculado (contract_id nulo) em valores relevantes.
- Datas de vencimento atípicas (muito próximas, muito distantes, finais de semana).
- Possíveis duplicidades (mesmo fornecedor + valor + data próxima).
- Despesas sem projeto ou centro de custo coerente.
- Concentração de pagamentos a um único fornecedor em curto período.
- Lançamentos em status 'draft' há muito tempo (estagnação no fluxo).
- Lançamentos sem evidência exigida (evidence_required=true e evidence_provided=false).

CATEGORIAS DE RISCO (use uma das opções):
- Financial: exposição financeira, fluxo de caixa, duplicidade, concentração.
- Operational: falha de processo, ausência de evidência, lançamento incompleto.
- Compliance: ausência de contrato suporte, anti-fraude, sanções.
- Contractual: divergência entre lançamento e contrato vinculado.
- Schedule: prazos atípicos, vencimentos suspeitos.
- Legal: enquadramento legal, tributário.

ESCALAS (todas inteiras de 1 a 5):
- probability: 1 (muito improvável) ... 5 (quase certo).
- impact: 1 (negligível) ... 5 (severo / material para a organização).

SEVERIDADE (derivada de probability × impact):
- low: 1–6  / medium: 7–11 / high: 12–15 / critical: 16–25

REGRAS DE QUALIDADE:
- Identifique entre 0 e 8 riscos. Qualidade > quantidade. Se o lote é normal, retorne lista vazia.
- Cada risco deve apontar um padrão concreto, ancorado em pelo menos um lançamento do lote.
- "sourceEntityId" deve conter o id (UUID) do ledger_entry âncora quando o risco for específico de um lançamento;
  para riscos transversais (ex: concentração) pode vir nulo.
- "rationale" cita a evidência específica (descrição, valor, fornecedor, datas).
- "mitigation" deve ser uma ação executável.
- Retorne exclusivamente o JSON solicitado.`;

/* ─────────────────────────────────────────────────────────────
   Batch loader
   ───────────────────────────────────────────────────────────── */
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_ENTRIES = 200;

interface LedgerRow {
  id: string;
  entry_date: string;
  description: string | null;
  amount_cents: number;
  currency: string | null;
  category_id: string | null;
  cost_center_id: string | null;
  project_id: string | null;
  contract_id: string | null;
  supplier_id: string | null;
  business_unit_id: string | null;
  period_key: string;
  entry_type: string;
  status: string;
  source_system: string | null;
  evidence_required: boolean | null;
  evidence_provided: boolean | null;
  created_at: string;
}

async function loadLedgerBatch(
  supabase: SupabaseClient,
  periodFrom?: string,
  periodTo?: string,
): Promise<{ rows: LedgerRow[]; periodLabel: string }> {
  let query = supabase
    .from('ledger_entry')
    .select(
      'id,entry_date,description,amount_cents,currency,category_id,cost_center_id,project_id,contract_id,supplier_id,business_unit_id,period_key,entry_type,status,source_system,evidence_required,evidence_provided,created_at',
    )
    .neq('status', 'void')
    .order('entry_date', { ascending: false })
    .limit(MAX_ENTRIES);

  if (periodFrom && periodTo) {
    query = query.gte('period_key', periodFrom).lte('period_key', periodTo);
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DEFAULT_LOOKBACK_DAYS);
    query = query.gte('entry_date', cutoff.toISOString().slice(0, 10));
  }

  const { data, error } = await query;
  if (error) throw new Error(`Erro ao carregar lançamentos: ${error.message}`);

  const rows = (data ?? []) as LedgerRow[];
  const label =
    periodFrom && periodTo
      ? `${periodFrom} → ${periodTo}`
      : `últimos ${DEFAULT_LOOKBACK_DAYS} dias`;
  return { rows, periodLabel: label };
}

function formatCurrency(cents: number, currency: string | null): string {
  const value = cents / 100;
  return `${currency ?? 'BRL'} ${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function buildPrompt(rows: LedgerRow[], periodLabel: string): string {
  const lines: string[] = [];
  lines.push(`=== LOTE DE LANÇAMENTOS — ${periodLabel} (${rows.length} entradas) ===`);
  for (const r of rows) {
    const tags: string[] = [];
    if (!r.contract_id) tags.push('SEM_CONTRATO');
    if (!r.project_id) tags.push('SEM_PROJETO');
    if (r.status === 'draft') tags.push('DRAFT');
    if (r.evidence_required && !r.evidence_provided) tags.push('SEM_EVIDENCIA');
    const tagStr = tags.length ? ` [${tags.join('|')}]` : '';
    lines.push(
      `- id=${r.id} | data=${r.entry_date} | ${formatCurrency(r.amount_cents, r.currency)} | ` +
        `cat=${r.category_id ?? '-'} cc=${r.cost_center_id ?? '-'} ` +
        `forn=${r.supplier_id ?? '-'} contr=${r.contract_id ?? '-'} proj=${r.project_id ?? '-'} ` +
        `tipo=${r.entry_type} status=${r.status} fonte=${r.source_system ?? '-'}${tagStr}`,
    );
    if (r.description) lines.push(`  desc: ${r.description.slice(0, 200)}`);
  }
  lines.push(
    '',
    'Analise o lote acima e identifique riscos financeiros materiais, conforme as regras do sistema.',
  );
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
   Caller's organization
   ───────────────────────────────────────────────────────────── */
async function resolveCallerOrg(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', userId)
    .single();
  if (error || !data?.organization_id) {
    throw new Error('Usuário sem organização ativa (profiles.organization_id).');
  }
  return data.organization_id as string;
}

/* ─────────────────────────────────────────────────────────────
   Public entrypoint
   ───────────────────────────────────────────────────────────── */
export interface FinanceScanOptions {
  /** YYYY-MM. If both periodFrom and periodTo are supplied, filters by period_key. */
  periodFrom?: string;
  periodTo?: string;
}

export interface FinanceScanResult {
  findings: AiRiskFinding[];
  persistence: PersistFindingsResult;
  scanned: number;
  periodLabel: string;
}

export async function scanFinanceForRisks(
  userId: string,
  opts: FinanceScanOptions = {},
): Promise<FinanceScanResult> {
  if (!userId) throw new Error('userId é obrigatório');
  const supabase = getServiceClient();
  const orgId = await resolveCallerOrg(supabase, userId);

  const { rows, periodLabel } = await loadLedgerBatch(supabase, opts.periodFrom, opts.periodTo);
  if (rows.length === 0) {
    return {
      findings: [],
      persistence: { inserted: [], skippedDuplicates: 0 },
      scanned: 0,
      periodLabel,
    };
  }

  const userPrompt = buildPrompt(rows, periodLabel);
  const findings = await callAnthropicForRiskFindings({
    systemPrompt: FINANCE_SYSTEM_PROMPT,
    userPrompt,
  });

  // The batch anchor is the most recent entry id, used only when a finding
  // does not pin a specific ledger row.
  const defaultEntityId = rows[0]?.id ?? `finance-batch-${Date.now()}`;

  const persistence = await persistAiRiskFindings(findings, {
    supabase,
    orgId,
    userId,
    sourceModule: 'finance',
    defaultEntityId,
    referenceName: `Lote financeiro · ${periodLabel}`,
    area: 'Financeiro',
  });

  console.info(
    `[ai/finance-risk-scanner] org=${orgId} scanned=${rows.length} findings=${findings.length} inserted=${persistence.inserted.length} dup=${persistence.skippedDuplicates}`,
  );

  return { findings, persistence, scanned: rows.length, periodLabel };
}
