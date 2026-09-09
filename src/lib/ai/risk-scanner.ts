/**
 * AI Risk Scanner — server-only.
 *
 * Uses the provider-agnostic Apex AI Gateway to analyze contract data
 * (clauses, penalties, milestones, billing events, metadata) and produce
 * a structured list of risk findings. Findings are inserted into the
 * `risks` table using a Supabase service-role client (bypasses RLS).
 *
 */

// NOTE: `server-only` is not installed in this repo, so we guard at runtime
// instead. Anything in this module must only execute on the Node.js server.
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/risk-scanner.ts must not be imported in the browser');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { callForRiskFindings } from './risk-call';
import { getServiceClient } from './server-clients';

/* ─────────────────────────────────────────────────────────────
   Public types
   ───────────────────────────────────────────────────────────── */
export type AiRiskCategory =
  | 'Operational'
  | 'Financial'
  | 'Legal'
  | 'Contractual'
  | 'Compliance'
  | 'Schedule';

export type AiRiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AiRiskFinding {
  id: string;
  title: string;
  description: string;
  category: AiRiskCategory;
  probability: number;
  impact: number;
  severity: AiRiskSeverity;
  rationale: string;
  confidence: number;
  mitigation: string;
}

/* ─────────────────────────────────────────────────────────────
   Lazy clients
   ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────
   Prompt building
   ───────────────────────────────────────────────────────────── */

/**
 * Stable system prompt; the gateway decides whether the selected provider can
 * cache it.
 */
const SYSTEM_PROMPT = `Você é um analista sênior de governança corporativa e gestão de riscos contratuais,
especializado em contratos brasileiros (privados e públicos). Sua função é examinar os dados estruturados
de um contrato e identificar riscos materiais que mereçam atenção do comitê de gestão.

CATEGORIAS DE RISCO:
- Operational: continuidade operacional, dependência de fornecedor, capacidade de execução.
- Financial: exposição financeira, fluxo de caixa, garantias, reajuste, inadimplência.
- Legal: enquadramento legal/regulatório, jurisdição, cláusulas abusivas.
- Contractual: redação ambígua, lacunas, mecanismos de resolução, escopo aberto.
- Compliance: LGPD, anticorrupção, conflito de interesse, sanções.
- Schedule: prazos, marcos críticos, dependências temporais, atrasos esperados.

ESCALAS (todas inteiras de 1 a 5):
- probability: 1 (muito improvável) ... 5 (quase certo).
- impact: 1 (negligível) ... 5 (severo / material para a organização).

SEVERIDADE (derivada do produto probability × impact):
- low: 1–6
- medium: 7–11
- high: 12–15
- critical: 16–25

REGRAS DE QUALIDADE:
- Identifique entre 0 e 8 riscos. Qualidade > quantidade. Se o contrato é trivial, retorne lista vazia.
- Cada risco deve ser concreto e ancorado em dados do contrato fornecido — nada genérico.
- "rationale" deve citar a evidência específica (cláusula, valor, prazo, ausência de marco etc.).
- "confidence" é um número entre 0 e 1 expressando sua segurança na avaliação.
- "mitigation" deve ser uma ação executável, não um conselho abstrato.

FORMATO DE SAÍDA:
Retorne exclusivamente o JSON solicitado, conforme o schema. Sem preâmbulos.`;

/* ─────────────────────────────────────────────────────────────
   JSON schema for structured output
   ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────
   Contract data fetcher
   ───────────────────────────────────────────────────────────── */
interface ContractContext {
  orgId: string;
  contractCode: string;
  contractName: string;
  promptText: string;
}

async function loadContractContext(
  supabase: SupabaseClient,
  contractId: string,
): Promise<ContractContext> {
  const { data: contract, error: contractErr } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .maybeSingle();
  if (contractErr) throw new Error(`Erro ao carregar contrato: ${contractErr.message}`);
  if (!contract) throw new Error(`Contrato ${contractId} não encontrado`);

  const orgId: string = contract.organization_id;
  if (!orgId) throw new Error('Contrato sem organization_id');

  const [{ data: clauses }, { data: penalties }, { data: milestones }, { data: billing }] =
    await Promise.all([
      supabase.from('contract_clauses').select('*').eq('contract_id', contractId),
      supabase.from('contract_penalties').select('*').eq('contract_id', contractId),
      supabase.from('contract_milestones').select('*').eq('contract_id', contractId),
      supabase.from('contract_billing_events').select('*').eq('contract_id', contractId),
    ]);

  const lines: string[] = [];
  lines.push('=== CONTRATO ===');
  for (const [k, v] of Object.entries(contract)) {
    if (v === null || v === undefined || v === '') continue;
    lines.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  }

  if (Array.isArray(clauses) && clauses.length > 0) {
    lines.push('', '=== CLÁUSULAS ===');
    for (const c of clauses) {
      lines.push(
        `- [${c.clause_type ?? 'sem tipo'} | risco=${c.risk_level ?? 'n/a'}] ${c.title ?? '(sem título)'}`,
      );
      if (c.content) lines.push(`  ${String(c.content).slice(0, 800)}`);
    }
  }

  if (Array.isArray(penalties) && penalties.length > 0) {
    lines.push('', '=== PENALIDADES ===');
    for (const p of penalties) {
      lines.push(
        `- ${p.description ?? p.penalty_type ?? '(sem descrição)'} — valor=${p.amount ?? 'n/a'} ${p.currency ?? ''}`,
      );
    }
  }

  if (Array.isArray(milestones) && milestones.length > 0) {
    lines.push('', '=== MARCOS ===');
    for (const m of milestones) {
      lines.push(
        `- ${m.title ?? '(sem título)'} | prazo=${m.due_date ?? 'n/a'} | status=${m.status ?? 'n/a'}`,
      );
      if (m.description) lines.push(`  ${String(m.description).slice(0, 400)}`);
    }
  }

  if (Array.isArray(billing) && billing.length > 0) {
    lines.push('', '=== EVENTOS DE BILLING ===');
    for (const b of billing) {
      lines.push(
        `- ${b.description ?? b.event_type ?? '(sem descrição)'} | valor=${b.amount ?? 'n/a'} ${b.currency ?? ''} | data=${b.event_date ?? b.due_date ?? 'n/a'}`,
      );
    }
  }

  return {
    orgId,
    contractCode: String(contract.code ?? contract.contract_code ?? contract.id),
    contractName: String(contract.name ?? contract.title ?? contract.code ?? 'Contrato'),
    promptText: lines.join('\n'),
  };
}

/* ─────────────────────────────────────────────────────────────
   Severity helper (mirrors src/lib/services/risks.ts computeSeverity)
   ───────────────────────────────────────────────────────────── */
function computeSeverity(level: number): AiRiskSeverity {
  if (level >= 16) return 'critical';
  if (level >= 12) return 'high';
  if (level >= 7) return 'medium';
  return 'low';
}

/* ─────────────────────────────────────────────────────────────
   Gateway call + JSON parse
   ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────
   Public entrypoint
   ───────────────────────────────────────────────────────────── */
export async function scanContractForRisks(
  contractId: string,
  userId: string,
  organizationId: string,
): Promise<{ findings: AiRiskFinding[]; rows: Array<Record<string, unknown>> }> {
  if (!contractId) throw new Error('contractId é obrigatório');
  if (!userId) throw new Error('userId é obrigatório');
  if (!organizationId) throw new Error('organizationId é obrigatório');

  const service = getServiceClient();
  const ctx = await loadContractContext(service, contractId);
  if (ctx.orgId !== organizationId) throw new Error('Contrato fora da organização ativa.');
  const result = await callForRiskFindings({
    organizationId,
    task: 'CONTRACT_RISK_ANALYSIS',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt:
      'Analise o contrato abaixo e identifique riscos materiais conforme as regras do sistema.\n\n' +
      ctx.promptText,
  });
  const findings: AiRiskFinding[] = result.findings.map((finding, index) => ({
    ...finding,
    id: `${Date.now()}-${index}`,
  }));

  if (findings.length === 0) {
    console.info(`[ai/risk-scanner] contract=${contractId} no findings`);
    return { findings: [], rows: [] };
  }

  const now = new Date().toISOString();
  const inserts = findings.map((f) => {
    const level = f.probability * f.impact;
    const severity = f.severity ?? computeSeverity(level);
    return {
      organization_id: ctx.orgId,
      title: f.title,
      description: f.description,
      category: f.category,
      area: 'Contratos',
      probability: f.probability,
      impact: f.impact,
      // `level` is GENERATED in the DB — do not send it.
      severity,
      origin: 'ai',
      reference_id: contractId,
      reference_name: ctx.contractName || ctx.contractCode,
      status: 'open' as const,
      mitigation_plan: f.mitigation || null,
      source_module: 'contracts',
      source_entity_id: contractId,
      ai_provider: result.provenance.provider,
      ai_model: result.provenance.model,
      ai_input_tokens: result.provenance.usage.inputTokens,
      ai_output_tokens: result.provenance.usage.outputTokens,
      ai_confidence: f.confidence,
      ai_rationale: f.rationale,
      ai_analyzed_at: now,
      created_by: userId,
    };
  });

  const { data, error } = await service.from('risks').insert(inserts).select('*');
  if (error) {
    throw new Error(`Erro ao inserir riscos (service-role): ${error.message}`);
  }

  console.info(
    `[ai/risk-scanner] contract=${contractId} inseriu ${data?.length ?? 0} risco(s) IA`,
  );

  return {
    findings,
    rows: (data ?? []) as Array<Record<string, unknown>>,
  };
}
