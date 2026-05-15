/**
 * Anthropic structured-output call shared by every AI risk scanner.
 * Returns a normalized AiRiskFinding[] regardless of the model's exact output.
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/ai/anthropic-call.ts must not be imported in the browser');
}

import { AI_MODEL, getAnthropic } from './server-clients';
import { RISK_FINDING_SCHEMA } from './schemas';
import {
  type AiRiskCategory,
  type AiRiskFinding,
  type AiRiskSeverity,
  clampFloat,
  clampInt,
  computeSeverity,
} from './types';

export interface AnthropicCallOptions {
  systemPrompt: string;
  /** The fully composed user prompt with the entity data inlined. */
  userPrompt: string;
}

export async function callAnthropicForRiskFindings(
  opts: AnthropicCallOptions,
): Promise<AiRiskFinding[]> {
  const anthropic = getAnthropic();

  const response = await anthropic.messages.create({
    model: AI_MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system: [
      {
        type: 'text',
        text: opts.systemPrompt,
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
        content: [{ type: 'text', text: opts.userPrompt }],
      },
    ],
  });

  let raw = '';
  for (const block of response.content) {
    if (block.type === 'text') raw += block.text;
  }
  if (!raw.trim()) throw new Error('Resposta da IA veio vazia');

  let parsed: { findings?: Array<Partial<AiRiskFinding> & { sourceEntityId?: string | null }> };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Não foi possível decodificar a resposta da IA como JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
  return findings.map((f) => {
    const probability = clampInt(f.probability, 1, 5, 3);
    const impact = clampInt(f.impact, 1, 5, 3);
    const declared = f.severity as AiRiskSeverity | undefined;
    const severity: AiRiskSeverity = declared ?? computeSeverity(probability * impact);
    return {
      title: String(f.title ?? '').slice(0, 200) || 'Risco identificado',
      description: String(f.description ?? ''),
      category: (f.category ?? 'Operational') as AiRiskCategory,
      sourceEntityId: f.sourceEntityId ?? null,
      probability,
      impact,
      severity,
      rationale: String(f.rationale ?? ''),
      confidence: clampFloat(f.confidence, 0, 1, 0.5),
      mitigation: String(f.mitigation ?? ''),
    } satisfies AiRiskFinding;
  });
}
