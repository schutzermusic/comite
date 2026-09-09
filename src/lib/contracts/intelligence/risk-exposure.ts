/**
 * Risco contratual como EXPOSIÇÃO OPERACIONAL.
 *
 * ─── O que o risco deixa de ser ────────────────────────────────────────────
 *
 * Uma linha com título, categoria e um número de 1 a 25 num selo colorido. Esse
 * desenho responde "qual a nota deste risco?" — pergunta que ninguém faz — e
 * não responde nenhuma das que importam: em que cláusula isso está escrito, o
 * que está acontecendo de errado, quanto custa se der errado, e o que dá para
 * fazer a respeito agora.
 *
 * ─── O que ele passa a ser ─────────────────────────────────────────────────
 *
 * Cinco campos, e todos podem estar ausentes sem que o item vire mentira:
 *
 *   · base contratual  — a cláusula que origina, com página. Ausente quando o
 *     risco foi registrado à mão sem apontar cláusula, e isso é dito.
 *   · o que se observa — a descrição do que está errado.
 *   · impacto potencial— o que acontece se não for tratado.
 *   · exposição        — SOMENTE quando existe quantia canônica. Nunca uma
 *     estimativa derivada de "score × valor do contrato", que é o tipo de
 *     número que parece rigoroso e não é.
 *   · recomendação     — o que o Apex sugere. Sugestão, não decisão.
 *
 * ─── Ações governadas ──────────────────────────────────────────────────────
 *
 * As ações disponíveis dependem do ESTADO do risco, não de permissão apenas.
 * Aceitar risco é ato de autoridade e vai para Governança; abrir acompanhamento
 * entrega o item ao Apex; alterar o contrato não é uma delas — o Apex pode
 * RECOMENDAR um aditivo, e nunca alterar verdade assinada.
 */

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

/**
 * Ações que o produto oferece sobre um risco.
 *
 * `amend` é deliberadamente uma RECOMENDAÇÃO de aditivo, e não uma edição: o
 * contrato assinado não é reescrito pelo sistema em nenhuma hipótese.
 */
export type RiskActionKey =
  | 'viewSourceClause'
  | 'assignResponsible'
  | 'createFollowup'
  | 'requestLegalReview'
  | 'createCommercialAction'
  | 'acceptRisk'
  | 'recommendAmendment';

export const RISK_ACTION_LABEL: Record<RiskActionKey, string> = {
  viewSourceClause: 'Ver cláusula de origem',
  assignResponsible: 'Designar responsável',
  createFollowup: 'Abrir acompanhamento',
  requestLegalReview: 'Enviar ao jurídico',
  createCommercialAction: 'Ação comercial',
  acceptRisk: 'Aceitar risco',
  recommendAmendment: 'Recomendar aditivo',
};

export interface RiskExposureInput {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  riskScore: number | null;
  status: string | null;
  mitigationPlan: string | null;
  ownerUserId: string | null;
  /** Cláusula que origina o risco, quando o vínculo existe. */
  sourceClauseId: string | null;
  sourceClauseTitle: string | null;
  sourceClausePage: number | null;
  /** Quantia CANÔNICA associada — nunca estimada. */
  canonicalExposure: number | null;
  /** Já existe acompanhamento aberto para este risco? */
  hasOpenFollowup: boolean;
}

export interface RiskExposure {
  readonly id: string;
  readonly title: string;
  readonly severity: RiskSeverity;
  /** A cláusula que sustenta o risco, ou por que não há uma. */
  readonly contractualBasis: string;
  readonly hasSourceClause: boolean;
  readonly observedIssue: string;
  readonly potentialImpact: string;
  /** `null` quando não existe quantia canônica. Nunca estimada. */
  readonly exposure: number | null;
  readonly exposureNote: string;
  readonly recommendation: string;
  readonly actions: readonly RiskActionKey[];
}

/**
 * Severidade a partir do score persistido.
 *
 * Score ausente é `unknown`, não `low`. A diferença importa: um risco que
 * ninguém avaliou aparecendo como "baixo" é a forma mais eficiente de nunca
 * ser avaliado.
 */
export function riskSeverity(score: number | null): RiskSeverity {
  if (score === null || !Number.isFinite(score)) return 'unknown';
  if (score >= 16) return 'critical';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

export const RISK_SEVERITY_LABEL: Record<RiskSeverity, string> = {
  critical: 'Exposição crítica',
  high: 'Exposição alta',
  medium: 'Exposição moderada',
  low: 'Exposição baixa',
  unknown: 'Exposição não avaliada',
};

/**
 * O que o Apex recomenda.
 *
 * Deriva do que está REGISTRADO, e diz explicitamente quando não há recomendação
 * a fazer. Uma recomendação genérica ("acompanhe de perto") é pior que
 * nenhuma: ela ocupa o espaço onde uma recomendação real caberia.
 */
function recommend(input: RiskExposureInput, severity: RiskSeverity): string {
  if (input.status === 'accepted') {
    return 'Risco aceito por decisão registrada. O Apex mantém o monitoramento sem cobrar tratativa.';
  }
  if (!input.mitigationPlan?.trim()) {
    return severity === 'critical' || severity === 'high'
      ? 'Sem plano de tratamento registrado para uma exposição desta ordem. Designe um responsável ou registre a aceitação do risco.'
      : 'Sem plano de tratamento registrado. Designar um responsável faz o Apex passar a acompanhar.';
  }
  if (!input.ownerUserId && !input.hasOpenFollowup) {
    return 'Há plano de tratamento, e ninguém responde por ele. O plano só vira execução quando tem dono.';
  }
  if (input.hasOpenFollowup) {
    return 'O Apex já acompanha o tratamento deste risco.';
  }
  return 'Plano registrado com responsável. Abrir acompanhamento faz o Apex verificar o desfecho.';
}

function actionsFor(input: RiskExposureInput, severity: RiskSeverity): RiskActionKey[] {
  const actions: RiskActionKey[] = [];
  if (input.sourceClauseId) actions.push('viewSourceClause');
  if (input.status === 'accepted') return actions;

  if (!input.ownerUserId) actions.push('assignResponsible');
  if (!input.hasOpenFollowup) actions.push('createFollowup');
  if (severity === 'critical' || severity === 'high') {
    actions.push('requestLegalReview');
    // Recomendar aditivo é sugestão ao humano — nunca alteração automática.
    actions.push('recommendAmendment');
  }
  actions.push('createCommercialAction');
  // Aceitar risco é ato de autoridade, e por isso fecha a lista.
  actions.push('acceptRisk');
  return actions;
}

export function buildRiskExposure(input: RiskExposureInput): RiskExposure {
  const severity = riskSeverity(input.riskScore);

  const contractualBasis = input.sourceClauseId
    ? `${input.sourceClauseTitle ?? 'Cláusula do contrato'}`
      + (input.sourceClausePage !== null ? ` · p. ${input.sourceClausePage}` : '')
    : 'Sem cláusula de origem vinculada — este risco foi registrado sem apontar o texto que o sustenta.';

  return {
    id: input.id,
    title: input.title,
    severity,
    contractualBasis,
    hasSourceClause: input.sourceClauseId !== null,
    observedIssue: input.description?.trim() || 'O registro não descreve o que foi observado.',
    potentialImpact: input.mitigationPlan?.trim()
      ? `Tratamento previsto: ${input.mitigationPlan.trim()}`
      : 'Impacto potencial não apurado.',
    // Sem quantia canônica, a exposição fica AUSENTE. Multiplicar score por
    // valor de contrato produziria um número com aparência de apuração.
    exposure: input.canonicalExposure,
    exposureNote: input.canonicalExposure === null
      ? 'Exposição financeira não apurada — nenhuma quantia canônica está associada a este risco.'
      : 'Quantia canônica associada ao risco.',
    recommendation: recommend(input, severity),
    actions: actionsFor(input, severity),
  };
}
