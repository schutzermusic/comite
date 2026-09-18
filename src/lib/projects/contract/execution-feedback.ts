/**
 * PROJETO → CONTRATO: o que a execução permite AFIRMAR sobre o direito.
 *
 * Lógica pura, sem JSX e sem banco.
 *
 * ─── A fronteira que este arquivo existe para não deixar ninguém cruzar ────
 *
 *   CONTRATO  define O QUÊ   — o marco, o direito, a exigência.
 *   PROJETO   define QUANDO  — a etapa, a data real, a evidência.
 *   FINANÇAS  define SE PAGOU — nota, recebível, liquidação.
 *
 * São três autoridades. A cadeia abaixo anda de uma para a outra em UMA
 * direção, e cada elo só acende com fato da SUA fonte:
 *
 *   marco contratual
 *     → mapeamento de cronograma ACEITO
 *       → execução real registrada (actual_finish / completed)
 *         → apuração do gatilho
 *           → medição
 *             → aceite da Contratante
 *               → elegibilidade de faturar
 *
 * ─── O que esta camada NUNCA faz ──────────────────────────────────────────
 *
 *   · Não trata mapeamento `system_proposed` como verdade. A visão governada
 *     já filtra `review_state = 'accepted'`, e `governedMappingCount` só conta
 *     aceitos — mas a checagem é refeita aqui porque a garantia não pode
 *     depender de ninguém lembrar de qual visão consultou.
 *
 *   · Não lê `percentComplete = 100` como conclusão. Cem por cento é a opinião
 *     de quem atualizou a linha do cronograma; `actualFinish` é o fato.
 *
 *   · Não cria evento de faturamento a partir de avanço de cronograma. Projeto
 *     que anda não emite nota. Nem um caminho desta função devolve uma
 *     elegibilidade que a fonte de faturamento não tenha afirmado.
 *
 *   · Não inventa data, evidência, aceite nem coordenada. Onde falta fato, o
 *     resultado é `NOT_ASSESSED` — que é uma afirmação honesta, não um erro.
 */

import type { ProjectContractMilestone, TriggerAssessment } from './project-contract-types';

/**
 * O que a execução do projeto permite dizer sobre o direito do marco.
 *
 * Ordenado do menos ao mais adiantado, e a ordem importa: cada estado exige
 * tudo o que os anteriores exigiam.
 */
export type ExecutionFeedback =
  /** Não há ponte aceita até uma etapa real. Ninguém apurou nada. */
  | 'NOT_ASSESSED'
  /** Ponte aceita, etapa aberta. O gatilho contratual não ocorreu. */
  | 'TRIGGER_NOT_OCCURRED'
  /** Etapa concluída de fato. O gatilho ocorreu; a medição ainda não. */
  | 'EXECUTION_COMPLETE'
  /** Medição em curso, sem aceite. */
  | 'MEASUREMENT_IN_PROGRESS'
  /** Medido, e o contrato exige aceite que ainda não veio. */
  | 'AWAITING_CUSTOMER_ACCEPTANCE'
  /** Aceite registrado. Elegível a FATURAR — não faturado, não recebido. */
  | 'ELIGIBLE_TO_BILL'
  /** Evento de faturamento existe. Não afirma nota emitida nem valor pago. */
  | 'BILLING_EVENT_EXISTS';

export interface ExecutionFeedbackDescriptor {
  readonly state: ExecutionFeedback;
  readonly label: string;
  /** Tracejado = NÃO APURADO — o vocabulário visual reservado da tela. */
  readonly dashed: boolean;
  /** O gatilho foi apurado contra dado REAL de cronograma governado? */
  readonly triggerAssessed: boolean;
  /**
   * Esta execução, sozinha, autoriza emitir nota ou registrar recebimento?
   *
   * `false` em TODOS os estados, inclusive `BILLING_EVENT_EXISTS`. Faturar é
   * ato de Contratos; emitir é ato do Fiscal; receber é ato de Finanças.
   * Nenhum deles se deduz daqui, e a propriedade existe para que o teste possa
   * afirmar isso sobre a matriz inteira em vez de caso a caso.
   */
  readonly impliesInvoiceOrPayment: false;
}

export const EXECUTION_FEEDBACK: Record<ExecutionFeedback, ExecutionFeedbackDescriptor> = {
  NOT_ASSESSED: {
    state: 'NOT_ASSESSED', label: 'Não apurado',
    dashed: true, triggerAssessed: false, impliesInvoiceOrPayment: false,
  },
  TRIGGER_NOT_OCCURRED: {
    state: 'TRIGGER_NOT_OCCURRED', label: 'Gatilho não ocorrido',
    dashed: false, triggerAssessed: true, impliesInvoiceOrPayment: false,
  },
  EXECUTION_COMPLETE: {
    state: 'EXECUTION_COMPLETE', label: 'Execução concluída',
    dashed: false, triggerAssessed: true, impliesInvoiceOrPayment: false,
  },
  MEASUREMENT_IN_PROGRESS: {
    state: 'MEASUREMENT_IN_PROGRESS', label: 'Medição em curso',
    dashed: false, triggerAssessed: true, impliesInvoiceOrPayment: false,
  },
  AWAITING_CUSTOMER_ACCEPTANCE: {
    state: 'AWAITING_CUSTOMER_ACCEPTANCE', label: 'Em aceite da Contratante',
    dashed: false, triggerAssessed: true, impliesInvoiceOrPayment: false,
  },
  ELIGIBLE_TO_BILL: {
    state: 'ELIGIBLE_TO_BILL', label: 'Elegível para faturar',
    dashed: false, triggerAssessed: true, impliesInvoiceOrPayment: false,
  },
  BILLING_EVENT_EXISTS: {
    state: 'BILLING_EVENT_EXISTS', label: 'Faturamento gerado',
    dashed: false, triggerAssessed: true, impliesInvoiceOrPayment: false,
  },
};

/**
 * Há ponte GOVERNADA até uma etapa real de cronograma?
 *
 * Duas condições, e as duas são necessárias: contagem de mapeamentos ACEITOS
 * maior que zero E uma etapa de cronograma efetivamente identificada.
 */
function hasGovernedMapping(m: ProjectContractMilestone): boolean {
  return m.governedMappingCount > 0 && m.timelineItemId !== null;
}

/**
 * A etapa TERMINOU de fato?
 *
 * `actualFinish` registrado ou `status = 'completed'`. `percentComplete` fica
 * de fora deliberadamente — ver o cabeçalho deste arquivo.
 */
function executionFinished(m: ProjectContractMilestone): boolean {
  return m.timelineActualFinish !== null || m.timelineStatus === 'completed';
}

/** Alguém com autoridade de ACEITE disse sim? */
function acceptanceSatisfied(m: ProjectContractMilestone): boolean {
  return m.status === 'approved'
    || m.measurementStatus === 'ACCEPTED'
    || m.measurementAcceptedAt !== null;
}

/**
 * O veredito de apuração do gatilho, derivado dos MESMOS fatos que a visão 175
 * usa na coluna `trigger_assessment`.
 *
 * Existe em duas cópias de propósito: a visão serve quem consulta SQL direto, e
 * esta serve a tela — e `assertTriggerAgreement` abaixo prova que as duas não
 * divergiram.
 */
export function deriveTriggerAssessment(m: ProjectContractMilestone): TriggerAssessment {
  if (!hasGovernedMapping(m)) return 'NOT_ASSESSED';
  return executionFinished(m) ? 'OCCURRED' : 'NOT_OCCURRED';
}

/**
 * A visão e esta derivação concordam sobre este marco?
 *
 * Divergir significa que alguém mudou a regra de um lado só — e o lado que
 * ficou para trás é o que a tela mostra. Chamado nos testes, não em produção.
 */
export function triggerAgreesWithView(m: ProjectContractMilestone): boolean {
  return deriveTriggerAssessment(m) === m.triggerAssessment;
}

/**
 * O estado da execução deste marco.
 *
 * Primeira correspondência vence, e a ordem desce a cadeia de trás para frente:
 * o fato mais A JUSANTE que já é verdade define o estado.
 */
export function deriveExecutionFeedback(
  m: ProjectContractMilestone,
): ExecutionFeedbackDescriptor {
  // Existência do evento de faturamento. Não afirma emitido nem pago.
  if (m.billingEventId !== null) return EXECUTION_FEEDBACK.BILLING_EVENT_EXISTS;

  // Aceite registrado pela autoridade de aceite.
  if (acceptanceSatisfied(m)) return EXECUTION_FEEDBACK.ELIGIBLE_TO_BILL;

  // Medido pela operação, e o contrato exige aceite que não veio.
  // Em JA10182283/2025 os seis eventos exigem aprovação de Boletim de Medição,
  // então nenhum deles pode pular deste estado para o próximo sozinho.
  if (m.status === 'measured') {
    return m.customerAcceptanceRequired === true
      ? EXECUTION_FEEDBACK.AWAITING_CUSTOMER_ACCEPTANCE
      : EXECUTION_FEEDBACK.ELIGIBLE_TO_BILL;
  }

  if (m.measurementStatus === 'SUBMITTED' || m.measurementStatus === 'UNDER_REVIEW') {
    return EXECUTION_FEEDBACK.AWAITING_CUSTOMER_ACCEPTANCE;
  }
  if (m.measurementId !== null) return EXECUTION_FEEDBACK.MEASUREMENT_IN_PROGRESS;

  // Sem medição: o que o cronograma GOVERNADO permite afirmar, e nada além.
  switch (deriveTriggerAssessment(m)) {
    case 'OCCURRED': return EXECUTION_FEEDBACK.EXECUTION_COMPLETE;
    case 'NOT_OCCURRED': return EXECUTION_FEEDBACK.TRIGGER_NOT_OCCURRED;
    default: return EXECUTION_FEEDBACK.NOT_ASSESSED;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// O RETRATO DO CONTRATO DENTRO DO PROJETO
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectContractRollup {
  readonly milestoneCount: number;
  /** Quantos marcos têm o gatilho APURADO contra cronograma governado. */
  readonly assessedCount: number;
  /** Quantos permanecem NÃO APURADOS — a lacuna de instrumentação. */
  readonly notAssessedCount: number;
  readonly eligibleToBillCount: number;
  readonly billedCount: number;
  /**
   * Direito dos marcos ainda NÃO APURADOS. `null` quando nenhum deles tem
   * direito registrado — somar o previsto no lugar apresentaria estimativa
   * como direito.
   */
  readonly unassessedEntitlement: number | null;
  /** Direito dos marcos com aceite registrado. `null` quando não há nenhum. */
  readonly eligibleEntitlement: number | null;
}

const sumOrNull = (values: readonly (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((s, v) => s + v, 0) : null;
};

export function rollupExecution(
  milestones: readonly ProjectContractMilestone[],
): ProjectContractRollup {
  const states = milestones.map((m) => ({ m, fb: deriveExecutionFeedback(m) }));
  const pick = (p: (s: typeof states[number]) => boolean) =>
    sumOrNull(states.filter(p).map((s) => s.m.entitlementAmount));

  return {
    milestoneCount: milestones.length,
    assessedCount: states.filter((s) => s.fb.triggerAssessed).length,
    notAssessedCount: states.filter((s) => !s.fb.triggerAssessed).length,
    eligibleToBillCount: states.filter((s) => s.fb.state === 'ELIGIBLE_TO_BILL').length,
    billedCount: states.filter((s) => s.fb.state === 'BILLING_EVENT_EXISTS').length,
    unassessedEntitlement: pick((s) => !s.fb.triggerAssessed),
    eligibleEntitlement: pick((s) => s.fb.state === 'ELIGIBLE_TO_BILL'),
  };
}
