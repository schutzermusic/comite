/**
 * CONFRONTO ASSISTIDO OS × PT × PC — a parte PURA (prompt, esquema, normalização).
 *
 * A regra do banco só afirma o que é verificável sem interpretar texto
 * (valor, vigência, ausência de escopo, pacote trocado). O resto — "a OS diz
 * 'montagem', a PT diz 'montagem e comissionamento'" — é leitura, e leitura
 * aqui volta como CANDIDATA: nada é decidido, tudo abre para quem responde
 * pela OS dizer qual fonte prevalece.
 *
 * A entrada são FATOS já lidos, com página e trecho — nunca o PDF de novo.
 * Cada candidata precisa apontar os dois lados; sem os dois, não é
 * divergência, é opinião, e é descartada.
 */
import type { DivergenceScope, DivergenceSeverity } from '@/lib/commercial/types';

export const DIVERGENCE_REVIEW_SCOPES: DivergenceScope[] = [
  'SCOPE', 'DELIVERABLE', 'TECHNICAL_REQUIREMENT', 'MATERIAL', 'CUSTOMER_DEPENDENCY',
  'EXCLUSION', 'DATES', 'MEASUREMENT_RULE', 'COMMERCIAL_REFERENCE', 'VALUE',
];

export interface ReviewFact {
  source: 'OS' | 'PT' | 'PC';
  domain: string;
  label: string;
  value: string | null;
  page: number | null;
}

export const DIVERGENCE_REVIEW_SYSTEM_PROMPT =
`You compare an INTERNAL service order (OS) against the customer-accepted technical proposal (PT)
and commercial proposal (PC) for Insight Apex. You receive short structured facts, each with its
source document and page. Return ONLY candidate divergences where the OS contradicts, omits or
exceeds what the PT/PC accepted.

Rules:
- Every candidate must cite BOTH sides: what the PT/PC says (left) and what the OS says or omits (right).
- Never invent facts that are not in the input. If a fact is simply phrased differently but means
  the same thing, it is NOT a divergence.
- Severity: BLOCKING only when executing the OS as written would perform work outside the accepted
  package, change value, or skip an accepted deliverable. WARNING for omissions that need a human
  look. INFO for harmless differences worth recording.
- Confidence between 0 and 1. Be conservative.`;

export function buildDivergenceReviewPrompt(facts: ReviewFact[]): string {
  const lines = facts.map((f) =>
    `[${f.source}] ${f.domain} · ${f.label}${f.value ? ` = ${f.value}` : ''}${f.page ? ` (p.${f.page})` : ''}`);
  return `Facts (source, domain, label, value, page):\n${lines.join('\n')}\n\n`
    + `Allowed scopes: ${DIVERGENCE_REVIEW_SCOPES.join(', ')}.`;
}

export const DIVERGENCE_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['divergences'],
  properties: {
    divergences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scope', 'severity', 'summary', 'left_value', 'right_value', 'confidence'],
        properties: {
          scope: { type: 'string', enum: DIVERGENCE_REVIEW_SCOPES },
          severity: { type: 'string', enum: ['INFO', 'WARNING', 'BLOCKING'] },
          summary: { type: 'string' },
          left_value: { type: 'string' },
          right_value: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

export interface DivergenceCandidate {
  scope: DivergenceScope;
  severity: DivergenceSeverity;
  summary: string;
  leftValue: string;
  rightValue: string | null;
  confidence: number;
}

/** Teto da fila: mais que isto é leitura desgovernada, não confronto. */
export const MAX_CANDIDATES = 25;

/** Abaixo disto a candidata é ruído: não entra na fila de decisão. */
export const MIN_CANDIDATE_CONFIDENCE = 0.5;

export function normalizeDivergenceCandidates(raw: unknown): { candidates: DivergenceCandidate[]; discarded: number } {
  const list = Array.isArray((raw as { divergences?: unknown })?.divergences)
    ? (raw as { divergences: Array<Record<string, unknown>> }).divergences : [];
  const out: DivergenceCandidate[] = [];
  let discarded = 0;
  const seen = new Set<string>();
  for (const item of list.slice(0, MAX_CANDIDATES)) {
    const scope = String(item?.scope ?? '').toUpperCase() as DivergenceScope;
    const severity = String(item?.severity ?? '').toUpperCase() as DivergenceSeverity;
    const summary = String(item?.summary ?? '').trim();
    const left = String(item?.left_value ?? '').trim();
    const right = String(item?.right_value ?? '').trim();
    const confidence = typeof item?.confidence === 'number' ? item.confidence : NaN;
    const valid = DIVERGENCE_REVIEW_SCOPES.includes(scope)
      && ['INFO', 'WARNING', 'BLOCKING'].includes(severity)
      && summary.length >= 8 && left.length > 0
      && Number.isFinite(confidence) && confidence >= MIN_CANDIDATE_CONFIDENCE && confidence <= 1;
    const key = `${scope}|${summary.toLowerCase()}`;
    if (!valid || seen.has(key)) { discarded += 1; continue; }
    seen.add(key);
    out.push({ scope, severity, summary: summary.slice(0, 500), leftValue: left.slice(0, 500),
      rightValue: right ? right.slice(0, 500) : null, confidence });
  }
  return { candidates: out, discarded };
}
