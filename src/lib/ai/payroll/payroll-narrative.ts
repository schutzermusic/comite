/**
 * Server-only payroll narrative generator. Receives the deterministic
 * `PayrollParseResult` (numbers already closed) and returns a `PayrollNarrative`
 * of text only. Reuses the shared Anthropic structured-output pattern.
 *
 * Hard rule enforced by the system prompt AND by the fallback: the model must
 * use exclusively the numbers provided, never invent values, and phrase any
 * cause not present in the structured data as a VALIDATION POINT.
 *
 * If `ANTHROPIC_API_KEY` is missing or the call fails, a deterministic template
 * fallback runs so the workflow keeps working offline (dry-run friendly).
 */

if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/payroll/payroll-narrative.ts must not be imported in the browser');
}

import { AI_MODEL, getAnthropic } from '../server-clients';
import { PAYROLL_NARRATIVE_SCHEMA } from '../schemas';
import type {
  PayrollComparisonRow,
  PayrollNarrative,
  PayrollParseResult,
} from '@/lib/types/payroll-closing';

function brl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
function pct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2).replace('.', ',')}%`;
}

const SYSTEM_PROMPT = `Você é um analista sênior de folha de pagamento e custos de pessoal de uma empresa de governança corporativa.
Sua tarefa é gerar a NARRATIVA do fechamento mensal da folha em português do Brasil, em tom executivo, claro e objetivo.

REGRAS INEGOCIÁVEIS:
1. Os números são a FONTE DA VERDADE e já vêm calculados no JSON de entrada. NUNCA invente, recalcule ou altere valores monetários, percentuais, headcount ou quaisquer números.
2. Você só pode citar valores que aparecem no JSON. Se um número não está no JSON, não o mencione.
3. Você NÃO sabe a CAUSA das variações. Se a causa não estiver explícita nos dados estruturados, NÃO a afirme como fato — escreva como PONTO DE VALIDAÇÃO.
   Exemplo correto: "Validar se a variação está relacionada a reajuste coletivo, retroativos, abonos ou horas extras."
4. Diferencie os públicos: diretoria (estratégico, sucinto), financeiro (foco em pagamento e prazo), RH (foco em validação e conferência).
5. Não use markdown nem emojis. Texto corrido, profissional.`;

function buildUserPrompt(parse: PayrollParseResult): string {
  return `Dados estruturados do fechamento (FONTE DA VERDADE — use apenas estes números):

${JSON.stringify(
  {
    competencia: parse.competence_month,
    total: brl(parse.total_amount_cents),
    mes_anterior: brl(parse.previous_month_amount_cents),
    variacao_valor: brl(parse.variation_amount_cents),
    variacao_percentual: pct(parse.variation_percentage),
    headcount: parse.headcount ?? null,
    clt: parse.clt_count ?? null,
    pj: parse.pj_count ?? null,
    centros_de_custo: parse.cost_centers.map((c) => ({
      nome: c.cost_center_label,
      valor: brl(c.amount_cents),
      variacao_pct: c.variation_percentage != null ? pct(c.variation_percentage) : null,
    })),
    maiores_aumentos: parse.comparison.top_increases.map((r) => ({ centro: r.label, variacao: brl(r.variation_cents), pct: pct(r.variation_percentage) })),
    maiores_quedas: parse.comparison.top_decreases.map((r) => ({ centro: r.label, variacao: brl(r.variation_cents), pct: pct(r.variation_percentage) })),
    inconsistencias_detectadas: parse.flags.map((f) => `${f.severity}: ${f.message}`),
    reconciliado: parse.reconciled,
  },
  null,
  2,
)}

Gere a narrativa completa conforme o schema. Lembre: causas não comprovadas pelos dados devem ser pontos de validação.`;
}

export async function generatePayrollNarrative(parse: PayrollParseResult): Promise<PayrollNarrative> {
  try {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: PAYROLL_NARRATIVE_SCHEMA },
      },
      messages: [{ role: 'user', content: [{ type: 'text', text: buildUserPrompt(parse) }] }],
    });

    let raw = '';
    for (const block of response.content) {
      if (block.type === 'text') raw += block.text;
    }
    if (!raw.trim()) throw new Error('Resposta da IA veio vazia');
    const parsed = JSON.parse(raw) as Partial<PayrollNarrative>;
    return normalizeNarrative(parsed, true);
  } catch (err) {
    // Deterministic fallback — keeps the workflow usable without an API key.
    console.warn('[payroll-narrative] usando fallback determinístico:', err instanceof Error ? err.message : err);
    return buildFallbackNarrative(parse);
  }
}

function normalizeNarrative(p: Partial<PayrollNarrative>, byAi: boolean): PayrollNarrative {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    executive_summary: String(p.executive_summary ?? ''),
    closing_email: String(p.closing_email ?? ''),
    board_summary: String(p.board_summary ?? ''),
    finance_email: String(p.finance_email ?? ''),
    hr_validation: String(p.hr_validation ?? ''),
    top_increases: arr(p.top_increases),
    top_decreases: arr(p.top_decreases),
    cost_center_highlights: arr(p.cost_center_highlights),
    anomalies: arr(p.anomalies),
    attention_points: arr(p.attention_points),
    recommendations: arr(p.recommendations),
    conclusion: String(p.conclusion ?? ''),
    generated_by_ai: byAi,
  };
}

function rowLine(r: PayrollComparisonRow): string {
  return `${r.label}: ${brl(r.current_cents)} (${pct(r.variation_percentage)})`;
}

export function buildFallbackNarrative(parse: PayrollParseResult): PayrollNarrative {
  const direction = parse.variation_amount_cents >= 0 ? 'aumento' : 'redução';
  const summary = `Fechamento da folha da competência ${parse.competence_month}. Total de ${brl(parse.total_amount_cents)}, ante ${brl(parse.previous_month_amount_cents)} no mês anterior — ${direction} de ${brl(Math.abs(parse.variation_amount_cents))} (${pct(parse.variation_percentage)}).${parse.headcount ? ` Headcount de ${parse.headcount} colaboradores.` : ''}`;

  const validationPoints = [
    'Validar se a variação está relacionada a reajuste coletivo, retroativos, abonos ou horas extras.',
    'Conferir admissões e desligamentos do período frente ao headcount informado.',
  ];
  if (!parse.reconciled) {
    validationPoints.unshift('Reconciliar a soma dos centros de custo com o total da folha antes de aprovar.');
  }

  const anomalies = parse.flags
    .filter((f) => f.severity !== 'info')
    .map((f) => f.message);

  return {
    executive_summary: summary,
    closing_email: `${summary}\n\nSegue o detalhamento da folha por centro de custo em anexo. Pontos de validação foram destacados para conferência antes da aprovação.`,
    board_summary: `Folha de ${parse.competence_month}: ${brl(parse.total_amount_cents)} (${pct(parse.variation_percentage)} vs. mês anterior). ${direction.charAt(0).toUpperCase() + direction.slice(1)} a ser validado quanto à origem.`,
    finance_email: `Pagamento da folha — competência ${parse.competence_month}. Valor total: ${brl(parse.total_amount_cents)}.${parse.payment_deadline ? ` Prazo de pagamento: ${parse.payment_deadline}.` : ' Confirmar prazo de pagamento.'} Planilha bancária/remessa em anexo.`,
    hr_validation: `Conferência de RH — competência ${parse.competence_month}. Total ${brl(parse.total_amount_cents)}.\n${validationPoints.map((v) => `- ${v}`).join('\n')}`,
    top_increases: parse.comparison.top_increases.map(rowLine),
    top_decreases: parse.comparison.top_decreases.map(rowLine),
    cost_center_highlights: parse.cost_centers.slice(0, 6).map((c) => `${c.cost_center_label}: ${brl(c.amount_cents)}`),
    anomalies,
    attention_points: validationPoints,
    recommendations: [
      'Anexar evidências (planilha geral, remessa bancária e holerites) antes do envio.',
      'Obter aprovação formal antes de liberar o pagamento.',
    ],
    conclusion: `Rascunho automático gerado a partir dos números importados (sem IA). Revise os pontos de validação e ajuste o texto antes do envio.`,
    generated_by_ai: false,
  };
}
