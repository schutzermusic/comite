/**
 * AI Risk Scanner — server-only.
 *
 * Uses the Anthropic SDK to analyze a contract's textual data
 * (clauses, penalties, milestones, billing events, metadata) and produce
 * a structured list of risk findings. Findings are inserted into the
 * `risks` table using a Supabase service-role client (bypasses RLS).
 *
 * Model: claude-sonnet-4-6
 *
 * SDK shape chosen: `output_config: { format: { type: 'json_schema', schema } }`.
 * Verified present in @anthropic-ai/sdk@0.96.0 (see messages.d.ts — `OutputConfig`
 * and `JSONOutputFormat`). The tool-use fallback (a single `record_risks` tool)
 * is therefore not needed in this version.
 */

// NOTE: `server-only` is not installed in this repo, so we guard at runtime
// instead. Anything in this module must only execute on the Node.js server.
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/risk-scanner.ts must not be imported in the browser');
}

import Anthropic from '@anthropic-ai/sdk';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';

const AI_MODEL = 'claude-sonnet-4-6' as const;

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
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY não está configurado. Adicione-o em .env / .env.local antes de disparar a análise IA.',
    );
  }
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL não está configurado');
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY não está configurado. A análise IA precisa do service-role para bypass de RLS.',
    );
  }
  return createServiceClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ─────────────────────────────────────────────────────────────
   Prompt building
   ───────────────────────────────────────────────────────────── */

/**
 * System prompt — kept stable to maximize prompt-cache reuse across calls.
 * Marked with `cache_control: ephemeral` on the request. Note: Sonnet 4.6
 * requires ≥ 2048 tokens for an effective cache hit; this prompt is short
 * for v1, so the cache may not activate. That's intentional and acceptable.
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
const RISK_FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          category: {
            type: 'string',
            enum: ['Operational', 'Financial', 'Legal', 'Contractual', 'Compliance', 'Schedule'],
          },
          probability: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          impact: { type: 'integer', enum: [1, 2, 3, 4, 5] },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          rationale: { type: 'string' },
          confidence: { type: 'number' },
          mitigation: { type: 'string' },
        },
        required: [
          'title',
          'description',
          'category',
          'probability',
          'impact',
          'severity',
          'rationale',
          'confidence',
          'mitigation',
        ],
      },
    },
  },
  required: ['findings'],
} as const;

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
   Anthropic call + JSON parse
   ───────────────────────────────────────────────────────────── */
async function callAnthropic(promptText: string): Promise<AiRiskFinding[]> {
  const anthropic = getAnthropic();

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: RISK_FINDING_SCHEMA,
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Analise o contrato abaixo e identifique riscos materiais conforme as regras do sistema.\n\n' +
              promptText,
          },
        ],
      },
    ],
  });

  // Extract text payload (structured output is delivered as text content)
  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }
  if (!raw.trim()) {
    throw new Error('Resposta da IA veio vazia');
  }

  let parsed: { findings?: Array<Omit<AiRiskFinding, 'id'>> };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Não foi possível decodificar a resposta da IA como JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return findings.map((f, i) => ({
    id: `${Date.now()}-${i}`,
    title: String(f.title ?? '').slice(0, 200) || 'Risco identificado',
    description: String(f.description ?? ''),
    category: (f.category ?? 'Operational') as AiRiskCategory,
    probability: clampInt(f.probability, 1, 5, 3),
    impact: clampInt(f.impact, 1, 5, 3),
    severity: (f.severity ?? 'medium') as AiRiskSeverity,
    rationale: String(f.rationale ?? ''),
    confidence: clampFloat(f.confidence, 0, 1, 0.5),
    mitigation: String(f.mitigation ?? ''),
  }));
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function clampFloat(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ─────────────────────────────────────────────────────────────
   Public entrypoint
   ───────────────────────────────────────────────────────────── */
export async function scanContractForRisks(
  contractId: string,
  userId: string,
): Promise<{ findings: AiRiskFinding[]; rows: Array<Record<string, unknown>> }> {
  if (!contractId) throw new Error('contractId é obrigatório');
  if (!userId) throw new Error('userId é obrigatório');

  const service = getServiceClient();
  const ctx = await loadContractContext(service, contractId);
  const findings = await callAnthropic(ctx.promptText);

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
      ai_model: AI_MODEL,
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
