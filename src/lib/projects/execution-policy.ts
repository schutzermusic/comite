/**
 * POLÍTICA DE AUTOMAÇÃO — a fronteira entre observar e agir.
 *
 * `execution-matching.ts` decide QUAL etapa a evidência indica. Este módulo
 * decide se o sistema pode AGIR sobre essa conclusão. São perguntas diferentes,
 * e mantê-las separadas é o que impede o motor de casamento de virar um motor
 * de escrita: nenhum componente escreve porque "a confiança pareceu boa" — todo
 * mundo passa por aqui.
 *
 *   AUTO_APPLY     grava sozinho (fato de execução de baixo risco)
 *   PROPOSE        registra como sugestão; humano confirma
 *   REQUIRE_HUMAN  vira exceção na fila do gestor
 *   REJECT         não gera nada
 *
 * ─── Falha fechada ─────────────────────────────────────────────────────────
 * Toda dúvida desce na escala, nunca sobe. Ausência de confiança, contradição
 * entre evidências ou dado autoritativo já existente rebaixam a decisão.
 *
 * Puro: sem Supabase, sem React.
 */

import type { EvidenceMatch, ReasonCode } from '@/lib/projects/execution-matching';

export type AutomationDecision = 'AUTO_APPLY' | 'PROPOSE' | 'REQUIRE_HUMAN' | 'REJECT';

/** Por que a política decidiu o que decidiu — auditável e testável. */
export type PolicyReason =
  | 'CONFIDENCE_ABOVE_AUTO'
  | 'CONFIDENCE_ABOVE_PROPOSE'
  | 'CONFIDENCE_BELOW_PROPOSE'
  | 'STATUS_AMBIGUOUS'
  | 'STATUS_UNMATCHED'
  | 'CONTRADICTORY_EVIDENCE'
  | 'NO_TIMELINE_ITEM'
  | 'MANUAL_DATA_PRESENT'
  | 'WRITE_KIND_NOT_AUTOMATABLE';

export const POLICY_REASON_LABELS: Record<PolicyReason, string> = {
  CONFIDENCE_ABOVE_AUTO: 'Confiança suficiente para aplicar automaticamente',
  CONFIDENCE_ABOVE_PROPOSE: 'Confiança suficiente para sugerir, não para aplicar',
  CONFIDENCE_BELOW_PROPOSE: 'Confiança insuficiente até para sugerir',
  STATUS_AMBIGUOUS: 'Mais de uma etapa possível',
  STATUS_UNMATCHED: 'Evidência sem etapa resolvida',
  CONTRADICTORY_EVIDENCE: 'Evidências em conflito',
  NO_TIMELINE_ITEM: 'Sem etapa de destino',
  MANUAL_DATA_PRESENT: 'Já existe dado informado por pessoa',
  WRITE_KIND_NOT_AUTOMATABLE: 'Este campo nunca é alterado automaticamente',
};

/**
 * O que a automação pode tocar.
 *
 * A lista de proibidos é a parte importante: são os campos que definem o PLANO
 * e o COMPROMISSO. Evidência mostra o que aconteceu, não redefine o que foi
 * combinado — e progresso percentual, em particular, é julgamento de engenharia,
 * não subproduto de presença.
 */
export type WriteKind =
  | 'work_session'        // sessão reconstruída a partir de evidência
  | 'evidence_link'       // associação evidência → etapa
  | 'observed_start'      // início real observado
  | 'last_activity';      // marca de última atividade

const AUTOMATABLE: ReadonlySet<WriteKind> = new Set<WriteKind>([
  'work_session',
  'evidence_link',
  'observed_start',
  'last_activity',
]);

/**
 * Campos que o Apex pode CALCULAR e SUGERIR, mas nunca gravar sozinho.
 * Existe como constante para que a proibição seja verificável em teste, e não
 * apenas uma promessa no comentário.
 */
export const NEVER_AUTOMATED = [
  'percentComplete',
  'status_completed',
  'baseline',
  'plannedStart',
  'plannedFinish',
  'responsibleUserId',
  'priority',
  'contractDates',
] as const;

/** Códigos que indicam conflito entre fontes — sempre rebaixam a decisão. */
const CONTRADICTION_CODES: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  'ASSIGNMENT_CONTRADICTS_LOCATION',
  'GEOFENCE_OUT_OF_RANGE',
]);

export interface AutomationPolicy {
  /** A partir daqui a automação grava sozinha. */
  autoApplyMin: number;
  /** A partir daqui vira sugestão para confirmação humana. */
  proposeMin: number;
  /** Abaixo daqui nada é registrado. */
  rejectBelow: number;
}

/**
 * ÚNICO lugar com limiares de automação no sistema.
 *
 * Alinhado por construção com `MATCHING_POLICY.autoApplyMin`: vínculo explícito
 * (1.0), atribuição nominal (0.92) e equipe (0.85) passam; janela do plano
 * (0.55) fica em PROPOSE. Subir a autonomia é mexer aqui, à vista de todos.
 */
export const AUTOMATION_POLICY: AutomationPolicy = {
  autoApplyMin: 0.8,
  proposeMin: 0.5,
  rejectBelow: 0.5,
};

export interface PolicyVerdict {
  decision: AutomationDecision;
  reasons: PolicyReason[];
  /** Confiança considerada na decisão. null quando não havia. */
  confidence: number | null;
}

export interface EvaluateInput {
  match: EvidenceMatch;
  writeKind: WriteKind;
  /**
   * Já existe dado autoritativo informado por pessoa neste destino?
   * Automação nunca sobrescreve em silêncio — no máximo propõe.
   */
  hasManualData?: boolean;
  policy?: AutomationPolicy;
}

export function evaluateAutomation(input: EvaluateInput): PolicyVerdict {
  const policy = input.policy ?? AUTOMATION_POLICY;
  const { match, writeKind } = input;
  const reasons: PolicyReason[] = [];

  // Campo fora do perímetro automatizável: nem com confiança máxima.
  if (!AUTOMATABLE.has(writeKind)) {
    return { decision: 'REJECT', reasons: ['WRITE_KIND_NOT_AUTOMATABLE'], confidence: match.confidence };
  }

  if (match.status === 'UNMATCHED') {
    return { decision: 'REJECT', reasons: ['STATUS_UNMATCHED'], confidence: null };
  }

  // Ambíguo é decisão humana por definição: o motor se recusou a escolher, e a
  // política não escolhe no lugar dele.
  if (match.status === 'AMBIGUOUS') {
    return { decision: 'REQUIRE_HUMAN', reasons: ['STATUS_AMBIGUOUS'], confidence: null };
  }

  if (!match.timelineItemId) {
    return { decision: 'REJECT', reasons: ['NO_TIMELINE_ITEM'], confidence: match.confidence };
  }

  const contradicted = match.reasonCodes.some((r) => CONTRADICTION_CODES.has(r));
  if (contradicted) reasons.push('CONTRADICTORY_EVIDENCE');

  const confidence = match.confidence;

  if (confidence < policy.rejectBelow) {
    return { decision: 'REJECT', reasons: [...reasons, 'CONFIDENCE_BELOW_PROPOSE'], confidence };
  }

  if (confidence < policy.autoApplyMin) {
    return { decision: 'PROPOSE', reasons: [...reasons, 'CONFIDENCE_ABOVE_PROPOSE'], confidence };
  }

  reasons.push('CONFIDENCE_ABOVE_AUTO');

  // Rebaixamentos: confiança alta não vence conflito nem dado humano.
  if (contradicted) {
    return { decision: 'REQUIRE_HUMAN', reasons, confidence };
  }
  if (input.hasManualData) {
    return { decision: 'PROPOSE', reasons: [...reasons, 'MANUAL_DATA_PRESENT'], confidence };
  }

  return { decision: 'AUTO_APPLY', reasons, confidence };
}

/** Legível para a UI e para o log de auditoria. */
export function describeVerdict(verdict: PolicyVerdict): string {
  return verdict.reasons.map((r) => POLICY_REASON_LABELS[r]).join(' · ');
}

/* ─────────────────── P3B-5 — métricas de autonomia ─────────────────── */

/** Sessão do Apex, como a UI e as métricas a enxergam. */
export interface ApexSessionSummary {
  id: string;
  verificationStatus: string | null;
  correctedAt: string | null;
  durationMinutes: number | null;
}

export interface ExecutionAutonomyMetrics {
  /** Contextos por decisão da política. */
  autoApplied: number;
  proposed: number;
  requireHuman: number;
  rejected: number;

  /** Sessões efetivamente reconstruídas e verificadas. */
  sessionsReconstructed: number;
  sessionsNeedingReview: number;
  sessionsCorrected: number;
  observedMinutes: number;

  /**
   * Contextos resolvidos com confiança SEM humano ÷ contextos resolvíveis.
   * Resolvíveis = tudo que não foi rejeitado por falta de evidência: rejeitar
   * o irresolvível não é falha de autonomia, é acerto.
   * null quando não há nada resolvível — taxa sobre zero é ficção.
   */
  executionAutonomyRate: number | null;
  /**
   * Fração das sessões automáticas que um humano precisou corrigir.
   * É o termômetro de confiabilidade da automação. null sem sessões.
   */
  correctionRate: number | null;
}

export const EMPTY_EXECUTION_AUTONOMY: ExecutionAutonomyMetrics = {
  autoApplied: 0,
  proposed: 0,
  requireHuman: 0,
  rejected: 0,
  sessionsReconstructed: 0,
  sessionsNeedingReview: 0,
  sessionsCorrected: 0,
  observedMinutes: 0,
  executionAutonomyRate: null,
  correctionRate: null,
};

export function computeExecutionAutonomy(input: {
  verdicts: PolicyVerdict[];
  sessions: ApexSessionSummary[];
}): ExecutionAutonomyMetrics {
  const { verdicts, sessions } = input;

  const autoApplied = verdicts.filter((v) => v.decision === 'AUTO_APPLY').length;
  const proposed = verdicts.filter((v) => v.decision === 'PROPOSE').length;
  const requireHuman = verdicts.filter((v) => v.decision === 'REQUIRE_HUMAN').length;
  const rejected = verdicts.filter((v) => v.decision === 'REJECT').length;

  // Denominador honesto: o que o sistema tinha chance de resolver.
  const resolvable = autoApplied + proposed + requireHuman;

  const verified = sessions.filter((s) => s.verificationStatus === 'verified' && !s.correctedAt);
  const needingReview = sessions.filter((s) => s.verificationStatus === 'failed');
  const corrected = sessions.filter((s) => s.correctedAt);

  return {
    autoApplied,
    proposed,
    requireHuman,
    rejected,
    sessionsReconstructed: verified.length,
    sessionsNeedingReview: needingReview.length,
    sessionsCorrected: corrected.length,
    observedMinutes: sessions
      .filter((s) => s.verificationStatus === 'verified')
      .reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
    executionAutonomyRate: resolvable === 0 ? null : Math.round((autoApplied / resolvable) * 1000) / 1000,
    correctionRate:
      sessions.length === 0 ? null : Math.round((corrected.length / sessions.length) * 1000) / 1000,
  };
}
