/**
 * Workforce advisor — LLM narrative + recommendations over the
 * deterministic intelligence summary (Fase 8, diferencial D2).
 * Server-only. Mirrors the structured-output pattern of the AI risk
 * scanners (src/lib/ai/risk-call.ts). The deterministic engine is
 * the source of truth; the model only interprets and recommends.
 */
if (typeof window !== 'undefined') {
  throw new Error('workforce-advisor.ts must not be imported in the browser');
}

import { getApexAIGateway } from '../gateway';
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

export async function generateWorkforceAdvice(
  summary: unknown,
  organizationId: string,
): Promise<WorkforceAdvice> {
  const response = await getApexAIGateway().generate<Partial<WorkforceAdvice>>({
    organizationId,
    task: 'WORKFORCE_ADVISOR',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `Resumo estruturado da força de trabalho (JSON):\n\n${JSON.stringify(summary, null, 2)}`,
    structuredOutput: { name: 'workforce_advice', schema: ADVICE_SCHEMA },
  });
  const parsed = response.output;

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
    ai_metadata: response.provenance,
  };
}
