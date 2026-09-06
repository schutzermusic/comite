/**
 * Vocabulário do motor de obrigações — Fase 3.
 *
 * Espelha o que as migrations 114–116 gravam. Um tipo por conceito, e nenhum
 * deles com um valor que signifique "não sei" disfarçado de valor comum:
 * quando algo é desconhecido, o tipo diz `unknown`, e quem lê é obrigado pelo
 * compilador a decidir o que fazer com isso.
 */

export type ObligationResponsibleSide =
  | 'contracting_organization' | 'counterparty' | 'supplier' | 'third_party' | 'shared' | 'unknown';

export type ObligationPartyRole =
  | 'obligor' | 'beneficiary' | 'recipient' | 'verifier' | 'guarantor' | 'insurer' | 'other';

export type ObligationActivationKind =
  | 'contract_start' | 'days_after_contract_start' | 'days_before_contract_end'
  | 'fixed_date' | 'manual' | 'external_event' | 'unspecified';

export type ObligationDueKind =
  | 'fixed_date' | 'days_after_activation' | 'days_before_contract_end'
  | 'same_day_as_activation' | 'recurring' | 'unspecified';

export type ObligationCalendarBasis = 'calendar_days' | 'business_days' | 'unspecified';

export type ObligationRecurrenceKind =
  | 'one_time' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'fixed_interval' | 'custom';

/** Estado registrado da ocorrência. É cache do histórico, não substituto dele. */
export type ObligationInstanceState =
  | 'NOT_ACTIVATED' | 'OPEN' | 'SATISFIED' | 'WAIVED' | 'CANCELLED' | 'EXCEPTION';

export type ObligationActivationState = 'not_activated' | 'activated' | 'unknown';

/**
 * Urgência DERIVADA do estado + prazo + data de referência. Nunca gravada:
 * gravá-la exigiria alguém rodando um job para mantê-la certa, e uma coluna
 * "atrasada" desatualizada é pior que nenhuma.
 */
export type ObligationUrgency = 'UPCOMING' | 'DUE' | 'OVERDUE' | 'UNKNOWN' | 'NOT_APPLICABLE';

/** Resposta de três valores. `UNKNOWN` nunca degrada para `false`. */
export type Tristate = 'TRUE' | 'FALSE' | 'UNKNOWN';

export interface ObligationProvenance {
  readonly clauseId: string | null;
  readonly amendmentId: string | null;
  readonly documentId: string | null;
  readonly page: number | null;
  readonly excerpt: string | null;
}

export interface ObligationPartyLink {
  readonly id: string;
  readonly role: ObligationPartyRole;
  /** `null` quando a identidade canônica não pôde ser provada. */
  readonly partyId: string | null;
  /** Texto do contrato, preservado sempre — inclusive quando há Party. */
  readonly partyText: string | null;
  readonly partyLegalName: string | null;
}

export interface ObligationDefinition {
  readonly id: string;
  readonly organizationId: string;
  readonly contractId: string;
  readonly title: string;
  readonly requirementText: string | null;
  readonly category: string | null;
  readonly responsibleSide: ObligationResponsibleSide;
  readonly provenance: ObligationProvenance;
  /** `null` = data de vigência DESCONHECIDA, não "desde sempre". */
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly predecessorId: string | null;
  readonly changeEffect: 'added' | 'altered' | 'removed' | null;
  readonly activationKind: ObligationActivationKind;
  readonly activationOffsetDays: number | null;
  readonly activationFixedDate: string | null;
  readonly activationEventText: string | null;
  readonly dueKind: ObligationDueKind;
  readonly dueOffsetDays: number | null;
  readonly dueFixedDate: string | null;
  readonly calendarBasis: ObligationCalendarBasis;
  readonly recurrenceKind: ObligationRecurrenceKind;
  readonly recurrenceInterval: number | null;
  readonly recurrenceUntil: string | null;
  /** `null` = ninguém apurou. Vira `UNKNOWN`, jamais `FALSE`. */
  readonly blocksBilling: boolean | null;
  readonly status: 'active' | 'superseded' | 'removed';
  readonly parties: readonly ObligationPartyLink[];
}

export interface ObligationEvidenceRequirement {
  readonly id: string;
  readonly requirementText: string;
  readonly evidenceType: string | null;
  readonly requiredCount: number | null;
  readonly mandatory: boolean | null;
  readonly requiresFormalAcceptance: boolean;
}

export interface ObligationEvidence {
  readonly id: string;
  readonly requirementId: string | null;
  readonly documentId: string | null;
  readonly referenceText: string | null;
  readonly acceptanceState: 'not_required' | 'pending' | 'accepted' | 'rejected';
  readonly providedAt: string;
}

export interface ObligationException {
  readonly id: string;
  readonly kind: 'waiver' | 'exception';
  readonly reason: string;
  readonly scope: 'definition' | 'instance';
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly authorityReference: string | null;
  readonly sourceDocumentId: string | null;
  readonly sourceAmendmentId: string | null;
  readonly approvalState: 'not_required' | 'pending' | 'approved' | 'rejected';
  /** Calculado para o `asOf` pedido — uma dispensa vencida não suprime nada. */
  readonly effective: boolean;
}

export interface ObligationEscalation {
  readonly id: string;
  readonly triggerKind: 'days_before_due' | 'on_due_date' | 'days_after_due';
  readonly offsetDays: number | null;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly targetRole: string | null;
  readonly targetSide: ObligationResponsibleSide | null;
  /** Aplicável na data de referência? `false` quando o prazo é desconhecido. */
  readonly applicable: boolean;
}

export interface ObligationFinancialImpact {
  readonly id: string;
  readonly recordKind: 'rule' | 'occurrence';
  readonly impactType: 'penalty' | 'withholding' | 'billing_block' | 'liquidated_damages' | 'service_credit' | 'other';
  readonly fixedAmount: number | null;
  readonly percentage: number | null;
  readonly currency: string | null;
  readonly basisText: string | null;
}

/** Estado de uma dependência para uma ocorrência concreta. */
export interface ObligationDependencyState {
  readonly dependsOnDefinitionId: string;
  readonly dependsOnTitle: string;
  readonly mappingMode: 'same_occurrence_key' | 'explicit' | 'unresolved';
  /** `UNKNOWN` quando o par de ocorrência não é determinável. */
  readonly satisfied: Tristate;
}

export interface ObligationInstanceView {
  readonly id: string;
  readonly definitionId: string;
  readonly occurrenceKey: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly activationState: ObligationActivationState;
  readonly activatedAt: string | null;
  readonly dueDate: string | null;
  readonly dueConfidence: 'known' | 'unknown';
  readonly dueBasis: string | null;
  readonly state: ObligationInstanceState;
  readonly urgency: ObligationUrgency;
  readonly satisfiedAt: string | null;
  readonly satisfactionBasis: string | null;
  readonly evidence: readonly ObligationEvidence[];
  readonly evidenceComplete: Tristate;
  readonly dependencies: readonly ObligationDependencyState[];
  readonly exceptions: readonly ObligationException[];
  readonly escalations: readonly ObligationEscalation[];
  readonly financialImpacts: readonly ObligationFinancialImpact[];
  /** Esta ocorrência, sozinha, bloqueia faturamento na data de referência? */
  readonly blocksBilling: Tristate;
}

export interface ResolvedObligation {
  readonly definition: ObligationDefinition;
  readonly evidenceRequirements: readonly ObligationEvidenceRequirement[];
  readonly instances: readonly ObligationInstanceView[];
  /** Vigente na data de referência? `UNKNOWN` quando a vigência é desconhecida. */
  readonly effective: Tristate;
  readonly blocksBilling: Tristate;
}

export interface ContractObligationsAsOf {
  readonly contractId: string;
  readonly asOf: string;
  readonly obligations: readonly ResolvedObligation[];
  /** Bloqueio de faturamento do CONTRATO, agregado das ocorrências. */
  readonly billingBlock: {
    readonly state: Tristate;
    readonly blockingInstanceIds: readonly string[];
    readonly unknownDefinitionIds: readonly string[];
  };
  readonly counts: {
    readonly definitions: number;
    readonly instances: number;
    readonly overdue: number;
    readonly due: number;
    readonly upcoming: number;
    readonly unknown: number;
  };
}
