/**
 * PRÉ-ANÁLISE DO APEX — vocabulário e leitura, sem banco e sem JSX.
 *
 * ─── O que a pré-análise é ─────────────────────────────────────────────────
 *
 * Um PARECER sobre um documento, comparado com as exigências REAIS daquele
 * marco. Ela aponta o que falta; ela não decide nada.
 *
 * ─── Os cinco desfechos, e por que não são três ────────────────────────────
 *
 * Um sistema com sim/não/talvez colapsa `NOT_FOUND` em `NOT_MET` — e aí "o
 * laudo não menciona a data do ensaio" vira "o ensaio não foi feito". São
 * coisas diferentes, e a segunda é uma acusação.
 *
 * ─── O que este módulo recusa fazer ────────────────────────────────────────
 *
 *   · Não converte parecer em prontidão. A prontidão vem de
 *     `project_measurement_readiness`, que não lê daqui — de propósito.
 *   · Não converte `MET` em exigência satisfeita. Satisfazer exigência é do
 *     vínculo de evidência, e validar é ato de pessoa.
 *   · Não inventa denominador. "4/5" só sai quando os 5 são os VERIFICÁVEIS.
 */

import { REQUIREMENT_KIND_LABEL, type RequirementKind } from './types';

export type PreAnalysisVerdict =
  | 'MET'
  | 'NOT_MET'
  | 'NOT_FOUND'
  | 'INCONSISTENT'
  | 'NEEDS_HUMAN_REVIEW';

export const VERDICT_LABEL: Record<PreAnalysisVerdict, string> = {
  MET: 'Requisito atendido',
  NOT_MET: 'Requisito não atendido',
  NOT_FOUND: 'Informação não localizada',
  INCONSISTENT: 'Inconsistência',
  NEEDS_HUMAN_REVIEW: 'Revisão humana necessária',
};

/** Tom visual — os mesmos do sistema de tokens; nenhum vocabulário novo. */
export type VerdictTone = 'positive' | 'attention' | 'critical' | 'neutral';

export const VERDICT_TONE: Record<PreAnalysisVerdict, VerdictTone> = {
  MET: 'positive',
  NOT_MET: 'attention',
  // Ausência de informação é NEUTRA-tracejada no vocabulário do dossiê: não é
  // uma negativa, é um silêncio. Pintá-la de vermelho ensinaria a tratar
  // silêncio como falta.
  NOT_FOUND: 'neutral',
  INCONSISTENT: 'critical',
  NEEDS_HUMAN_REVIEW: 'attention',
};

/** Ordem de gravidade: o que pede decisão AGORA primeiro. */
export const VERDICT_PRECEDENCE: readonly PreAnalysisVerdict[] = [
  'INCONSISTENT',
  'NEEDS_HUMAN_REVIEW',
  'MET',
  'NOT_MET',
  'NOT_FOUND',
];

export interface PreAnalysisFinding {
  readonly requirementKind: RequirementKind;
  readonly verdict: PreAnalysisVerdict;
  readonly rationale: string | null;
  readonly quote: string | null;
  readonly page: number | null;
  readonly confidence: number | null;
}

export interface PreAnalysisSummary {
  readonly measurementId: string;
  /** `false` quando ninguém rodou — e isso NÃO é "nada a apontar". */
  readonly analyzed: boolean;
  readonly analyses: number;
  readonly lastAnalyzedAt: string | null;
  readonly verifiable: number;
  readonly met: number;
  readonly notMet: number;
  readonly notFound: number;
  readonly inconsistent: number;
  readonly needsHumanReview: number;
  readonly findings: readonly PreAnalysisFinding[];
}

const VERDICTS: readonly PreAnalysisVerdict[] = VERDICT_PRECEDENCE;

const asVerdict = (v: unknown): PreAnalysisVerdict =>
  // Veredito irreconhecível vira REVISÃO HUMANA, nunca `MET`: um parse que
  // falhou não pode declarar requisito atendido.
  (VERDICTS.includes(v as PreAnalysisVerdict) ? (v as PreAnalysisVerdict) : 'NEEDS_HUMAN_REVIEW');

const KINDS = Object.keys(REQUIREMENT_KIND_LABEL) as readonly RequirementKind[];

export function parsePreAnalysis(raw: unknown, measurementId: string): PreAnalysisSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawFindings = Array.isArray(r.findings) ? (r.findings as Record<string, unknown>[]) : [];
  return {
    measurementId: String(r.measurement_id ?? measurementId),
    analyzed: r.analyzed === true,
    analyses: Number(r.analyses ?? 0),
    lastAnalyzedAt: (r.last_analyzed_at as string | null) ?? null,
    verifiable: Number(r.verifiable ?? 0),
    met: Number(r.met ?? 0),
    notMet: Number(r.not_met ?? 0),
    notFound: Number(r.not_found ?? 0),
    inconsistent: Number(r.inconsistent ?? 0),
    needsHumanReview: Number(r.needs_human_review ?? 0),
    findings: rawFindings
      .filter((f) => KINDS.includes(f.requirement_kind as RequirementKind))
      .map((f) => ({
        requirementKind: f.requirement_kind as RequirementKind,
        verdict: asVerdict(f.verdict),
        rationale: (f.rationale as string | null) ?? null,
        quote: (f.quote as string | null) ?? null,
        page: f.page == null ? null : Number(f.page),
        confidence: f.confidence == null ? null : Number(f.confidence),
      })),
  };
}

/**
 * A frase do cabeçalho: "4/5 requisitos verificáveis atendidos".
 *
 * Devolve `null` quando não há denominador. Escrever "0/0 atendidos" seria
 * apresentar a ausência de análise como um resultado.
 */
export function preAnalysisHeadline(s: PreAnalysisSummary): string | null {
  if (!s.analyzed) return null;
  if (s.verifiable === 0) return 'Nenhum requisito verificável por documento neste marco';
  return `${s.met}/${s.verifiable} requisitos verificáveis atendidos`;
}

/** Os achados agrupados pelos cinco baldes do plano, na ordem de gravidade. */
export function groupFindings(
  s: PreAnalysisSummary,
): readonly { readonly verdict: PreAnalysisVerdict; readonly findings: readonly PreAnalysisFinding[] }[] {
  return VERDICT_PRECEDENCE
    .map((verdict) => ({ verdict, findings: s.findings.filter((f) => f.verdict === verdict) }))
    .filter((g) => g.findings.length > 0);
}

/**
 * O parecer exige decisão humana antes de o pacote seguir?
 *
 * Inconsistência e revisão humana, sim. `NOT_FOUND` e `NOT_MET`, não: os dois
 * são trabalho conhecido do projeto, e travá-los aqui duplicaria o portão que
 * a prontidão já opera.
 */
export function requiresHumanDecision(s: PreAnalysisSummary): boolean {
  return s.inconsistent > 0 || s.needsHumanReview > 0;
}

/** O esquema que o provedor devolve. Fechado: nada fora desta forma entra. */
export const PREANALYSIS_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['requirement_kind', 'verdict'],
        properties: {
          requirement_kind: { type: 'string', enum: KINDS as unknown as string[] },
          verdict: { type: 'string', enum: VERDICTS as unknown as string[] },
          rationale: { type: 'string' },
          quote: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;
