/**
 * Workforce advisor — LLM narrative + recommendations over the
 * deterministic intelligence summary (Fase 8, diferencial D2).
 * Server-only. Mirrors the structured-output pattern of the AI risk
 * scanners (src/lib/ai/anthropic-call.ts). The deterministic engine is
 * the source of truth; the model only interprets and recommends.
 */
if (typeof window !== 'undefined') {
  throw new Error('workforce-advisor.ts must not be imported in the browser');
}

import { AI_MODEL, getAnthropic } from '../server-clients';
import type { WorkforceAdvice, WorkforceInsight, GovernanceSeverity } from '@/lib/types/people';

const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string' },
    insights: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
        },
        required: ['title', 'detail', 'severity'],
      },
    },
    recommendations: { type: 'array', maxItems: 6, items: { type: 'string' } },
  },
  required: ['headline', 'insights', 'recommendations'],
} as const;

const SYSTEM_PROMPT = `Você é um analista sênior de capacidade e custo de mão de obra de uma
plataforma enterprise de governança corporativa. Recebe um RESUMO ESTRUTURADO
(determinístico, já calculado pelo sistema) sobre alocação, ociosidade,
sobrecarga e forecast de capacidade de uma organização.

Sua tarefa: interpretar os números e produzir uma leitura executiva acionável em
português do Brasil. Regras:
- Não invente dados nem números que não estejam no resumo.
- Não faça acusações; classifique situações para análise (ex.: "requer revisão").
- Seja específico e conciso; priorize o que é acionável por um gestor.
- 'headline': uma frase-síntese do estado da força de trabalho.
- 'insights': observações relevantes com severidade proporcional ao impacto.
- 'recommendations': ações concretas (realocar, contratar, rever alocação, etc.).`;

const SEVERITIES: GovernanceSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

export async function generateWorkforceAdvice(summary: unknown): Promise<WorkforceAdvice> {
  const anthropic = getAnthropic();

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: ADVICE_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Resumo estruturado da força de trabalho (JSON):\n\n${JSON.stringify(summary, null, 2)}`,
          },
        ],
      },
    ],
  });

  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }
  if (!raw.trim()) throw new Error('Resposta da IA veio vazia');

  let parsed: Partial<WorkforceAdvice>;
  try {
    parsed = JSON.parse(raw) as Partial<WorkforceAdvice>;
  } catch (err) {
    throw new Error(
      `Não foi possível decodificar a resposta da IA: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const insights: WorkforceInsight[] = Array.isArray(parsed.insights)
    ? parsed.insights.map((i) => ({
        title: String(i?.title ?? '').slice(0, 160) || 'Observação',
        detail: String(i?.detail ?? ''),
        severity: SEVERITIES.includes(i?.severity as GovernanceSeverity)
          ? (i!.severity as GovernanceSeverity)
          : 'medium',
      }))
    : [];

  return {
    headline: String(parsed.headline ?? '').slice(0, 240) || 'Análise de capacidade concluída',
    insights,
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map((r) => String(r)).filter(Boolean).slice(0, 6)
      : [],
  };
}
