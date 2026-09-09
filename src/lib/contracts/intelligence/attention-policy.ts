/**
 * Governança por EXCEÇÃO das interpretações contratuais.
 *
 * ─── O que mudou de mentalidade ────────────────────────────────────────────
 *
 * O contrato foi escrito e assinado pela contraparte. O Apex não propôs
 * cláusula nenhuma: ele LEU o documento e estruturou o que está lá. Pedir que
 * uma pessoa valide, uma a uma, quarenta e três leituras de um contrato de 195
 * páginas não é governança — é conferência manual, e ninguém a faz. O efeito
 * prático de uma fila de 47 itens é que os 2 que importavam somem no meio.
 *
 * Então a fila deixa de ser a regra e passa a ser a EXCEÇÃO. Uma interpretação
 * bem evidenciada é estruturada e entra em operação; atenção humana é pedida
 * quando — e só quando — um destes motivos existe.
 *
 * ─── Por que isto existe em dois lugares ───────────────────────────────────
 *
 * A mesma política vive em `contract_interpretation_attention_reasons()`
 * (migration 154). O banco é a autoridade: é ele que decide o que entra na
 * fila, e política de autoridade que só existe na aplicação é política que o
 * próximo script contorna. Este módulo existe para que a interface possa
 * EXPLICAR a classificação sem uma ida ao servidor, e para que a regra seja
 * testável sem banco. Os dois são verificados um contra o outro em
 * `tests/unit/contract-interpretation-attention.test.ts`.
 */

/** Estado da INTERPRETAÇÃO — nunca da cláusula, que existe no papel assinado. */
export type InterpretationState =
  | 'structured'
  | 'requires_attention'
  | 'human_confirmed'
  | 'dismissed';

export type AttentionReason =
  | 'low_confidence'
  | 'legal_ambiguity'
  | 'conflicting_clauses'
  | 'amendment_precedence_conflict'
  | 'unclear_party_responsibility'
  | 'material_financial_exposure'
  | 'material_contractual_risk'
  | 'possible_legal_commitment'
  | 'possible_contract_amendment'
  | 'exceptional_billing_treatment'
  | 'risk_acceptance'
  | 'authority_required'
  | 'human_only_policy'
  | 'never_automated_action';

/** Espelha `contract_interpretation_policy_version()`. */
export const ATTENTION_POLICY_VERSION = 'contract-attention-policy/1.0.0';

/** Espelha `contract_interpretation_material_amount()`. */
export const MATERIAL_AMOUNT_BRL = 100_000;

/** Espelha o limiar de confiança da migration 154. */
export const MIN_STRUCTURING_CONFIDENCE = 0.75;

/**
 * O motivo, em linguagem de negócio. Sem jargão de IA: quem lê precisa saber o
 * que DECIDIR, não que modelo leu o quê.
 */
export const ATTENTION_REASON_LABEL: Record<AttentionReason, string> = {
  low_confidence: 'Leitura do documento não é conclusiva',
  legal_ambiguity: 'Texto contratual ambíguo',
  conflicting_clauses: 'Cláusulas conflitantes',
  amendment_precedence_conflict: 'Conflito de precedência com aditivo',
  unclear_party_responsibility: 'Responsabilidade da parte não está clara',
  material_financial_exposure: 'Exposição financeira material',
  material_contractual_risk: 'Risco contratual material',
  possible_legal_commitment: 'Possível compromisso jurídico',
  possible_contract_amendment: 'Possível necessidade de aditivo',
  exceptional_billing_treatment: 'Tratamento excepcional de faturamento',
  risk_acceptance: 'Aceitação de risco',
  authority_required: 'Exige alçada',
  human_only_policy: 'Política exige decisão humana',
  never_automated_action: 'Ação nunca automatizável',
};

/** O que a pessoa precisa fazer — a frase que substitui "validar proposta". */
export const ATTENTION_REASON_ASK: Record<AttentionReason, string> = {
  low_confidence: 'Confira o trecho no documento original e confirme a leitura.',
  legal_ambiguity: 'Defina qual interpretação vale para a operação.',
  conflicting_clauses: 'Decida qual cláusula prevalece.',
  amendment_precedence_conflict: 'Defina qual instrumento prevalece.',
  unclear_party_responsibility: 'Defina qual parte responde por esta exigência.',
  material_financial_exposure: 'Avalie a exposição antes de operar por esta regra.',
  material_contractual_risk: 'Decida o tratamento do risco.',
  possible_legal_commitment: 'Encaminhe ao jurídico ou confirme o entendimento.',
  possible_contract_amendment: 'Avalie se o caso exige aditivo.',
  exceptional_billing_treatment: 'Autorize ou recuse o tratamento excepcional.',
  risk_acceptance: 'Registre a aceitação de risco, se for o caso.',
  authority_required: 'Alçada humana necessária para seguir.',
  human_only_policy: 'Esta decisão é reservada a uma pessoa.',
  never_automated_action: 'O Apex não executa esta ação em nenhuma hipótese.',
};

/** Categorias que comprometem juridicamente — espelha a 154. */
const LEGAL_COMMITMENT_CATEGORIES = new Set(['penalidade', 'rescisao', 'responsabilidade']);
const AUTHORITY_CATEGORIES = new Set(['garantia']);

export interface InterpretationInput {
  /** A leitura veio de análise documental (e não de registro manual). */
  aiFlagged: boolean;
  /** Confiança da LEITURA — não da importância da cláusula. */
  confidence: number | null;
  riskLevel: 'low' | 'medium' | 'high';
  amount: number | null;
  clauseType: string | null;
  sourceExcerpt: string | null;
  sourcePage: number | null;
}

/**
 * Os motivos pelos quais esta interpretação exige atenção humana.
 *
 * Lista vazia = o Apex estrutura sozinho, e nada entra em fila nenhuma. É a
 * resposta esperada para a maioria das leituras de um contrato bem escrito.
 */
export function attentionReasons(input: InterpretationInput): AttentionReason[] {
  const reasons: AttentionReason[] = [];

  // Leitura de máquina sem evidência conferível é afirmação, não interpretação.
  if (input.aiFlagged && (input.sourcePage === null || !input.sourceExcerpt?.trim())) {
    reasons.push('legal_ambiguity');
  }
  // Confiança ausente numa leitura de máquina é DESCONHECIDA, nunca alta.
  if (input.aiFlagged && (input.confidence === null || input.confidence < MIN_STRUCTURING_CONFIDENCE)) {
    reasons.push('low_confidence');
  }
  if (input.riskLevel === 'high') {
    reasons.push('material_contractual_risk');
  }
  if (input.amount !== null && Math.abs(input.amount) >= MATERIAL_AMOUNT_BRL) {
    reasons.push('material_financial_exposure');
  }
  if (input.clauseType && LEGAL_COMMITMENT_CATEGORIES.has(input.clauseType)) {
    reasons.push('possible_legal_commitment');
  }
  if (input.clauseType && AUTHORITY_CATEGORIES.has(input.clauseType)) {
    reasons.push('authority_required');
  }

  return reasons;
}

/**
 * O estado derivado. Espelha `contracts_classify_interpretation()`.
 *
 * `attentionResolvedAt` presente devolve `structured`: uma atenção já decidida
 * por uma pessoa não volta sozinha à fila. Desfazer a decisão humana a cada
 * recálculo seria a forma mais silenciosa de o produto ignorar o usuário.
 */
export function interpretationState(
  input: InterpretationInput,
  options: { attentionResolvedAt?: string | null; humanState?: InterpretationState | null } = {},
): InterpretationState {
  if (options.humanState === 'human_confirmed' || options.humanState === 'dismissed') {
    return options.humanState;
  }
  if (options.attentionResolvedAt) return 'structured';
  return attentionReasons(input).length > 0 ? 'requires_attention' : 'structured';
}

export const INTERPRETATION_STATE_LABEL: Record<InterpretationState, string> = {
  structured: 'Interpretação estruturada',
  requires_attention: 'Requer atenção',
  human_confirmed: 'Confirmada',
  dismissed: 'Descartada',
};

/**
 * A frase que o produto usa no lugar de "Proposta não vale como cláusula até
 * ser validada".
 *
 * Ela existe porque a frase anterior dizia algo FALSO sobre a natureza do
 * objeto: a cláusula vale desde que o contrato foi assinado, independentemente
 * de qualquer leitura. O que é derivado — e o que precisa ser dito — é a
 * INTERPRETAÇÃO.
 */
export function interpretationDisclosure(state: InterpretationState): string {
  switch (state) {
    case 'requires_attention':
      return 'Esta interpretação requer análise humana antes de produzir uma decisão governada.';
    case 'human_confirmed':
      return 'Interpretação estruturada do Apex, confirmada por uma pessoa.';
    case 'dismissed':
      return 'Interpretação descartada por uma pessoa. O texto do contrato permanece inalterado.';
    case 'structured':
    default:
      return 'Esta é uma interpretação estruturada do Apex baseada no documento original.';
  }
}
