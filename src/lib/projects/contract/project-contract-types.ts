/**
 * O CONTRATO VISTO DO PROJETO — a borda tipada das visões da migration 175.
 *
 * Tipos e normalização, sem JSX e sem banco, pelo mesmo motivo de
 * `milestone-workbench-types.ts`: o vitest deste repositório roda em `node`, e
 * a derivação precisa ser provável sem Supabase e sem DOM.
 *
 * ─── A regra que este arquivo protege ──────────────────────────────────────
 *
 * `contractValue` e `entitlementTotal` são DOIS números, e continuam dois.
 * O cabeçalho do instrumento assinado de JA10182283/2025 diz R$ 8.032.339,76;
 * a soma dos seis direitos do Anexo diz R$ 8.032.339,77. Um centavo separa os
 * dois, e o centavo está no PDF — não é erro de arredondamento desta camada.
 * Não existe getter que os funda, e `reconciliationDelta` existe exatamente
 * para que a diferença tenha um lugar em vez de virar bug de exibição.
 */

import { toAmount } from '@/lib/contracts/measurement/milestone-workbench-types';
import type { TimelineItemStatus } from '@/lib/contracts/measurement/milestone-workbench-types';
import type { ContractMilestoneStatus } from '@/lib/contracts/contract-service';
import type { MeasurementStatus, ReadinessState } from '@/lib/projects/measurements/types';

/** De onde veio o vínculo projeto↔contrato. Proveniência, não detalhe. */
export type ContractLinkSource = 'contract_project_links' | 'contracts.project_id';

/**
 * O gatilho contratual foi APURADO contra cronograma governado?
 *
 * `NOT_ASSESSED` não é "pendente". Pendente insinua que alguém olhou e o
 * gatilho ainda não ocorreu; `NOT_ASSESSED` diz que não existe ponte aceita
 * até uma etapa real, então não há contra o que apurar. Confundir os dois é o
 * que transformaria ausência de dado em afirmação de não-ocorrência.
 */
export type TriggerAssessment = 'NOT_ASSESSED' | 'NOT_OCCURRED' | 'OCCURRED';

/** Uma linha de `project_contract_financial_read_model`, normalizada. */
export interface ProjectContractFinancial {
  readonly organizationId: string;
  readonly projectId: string;
  readonly contractId: string;
  readonly linkSource: ContractLinkSource;
  readonly linkedAt: string | null;

  readonly contractNumber: string;
  readonly contractTitle: string | null;
  readonly contractStatus: string | null;
  readonly counterpartyName: string | null;
  readonly currency: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly signedDate: string | null;

  /** O CABEÇALHO do instrumento assinado. */
  readonly contractValue: number | null;
  /** A SOMA DOS DIREITOS por marco. Número distinto, nunca coalescido. */
  readonly entitlementTotal: number | null;
  readonly entitlementRuleCount: number;
  readonly milestoneCount: number;
  /**
   * `entitlementTotal - contractValue`, com sinal.
   *
   * `null` quando falta um dos lados — e `null` NUNCA significa conciliado.
   * Zero significa conciliado.
   */
  readonly reconciliationDelta: number | null;

  /** APURADO pela operação. `null` = ninguém apurou. */
  readonly measuredTotal: number | null;
  /** ACEITO por quem tem autoridade. `null` = ninguém aceitou. */
  readonly acceptedTotal: number | null;
  readonly billedEventCount: number;
  readonly governedMappedMilestoneCount: number;
}

/** Uma linha de `project_contract_milestone_read_model`, normalizada. */
export interface ProjectContractMilestone {
  readonly projectId: string;
  readonly organizationId: string;
  readonly contractId: string;
  readonly milestoneId: string;
  readonly title: string;
  readonly description: string | null;
  readonly milestoneType: string | null;
  readonly status: ContractMilestoneStatus;
  readonly dueDate: string | null;
  readonly completedAt: string | null;

  readonly entitlementAmount: number | null;
  readonly entitlementCurrency: string | null;
  readonly entitlementRuleCount: number;
  /** Participação do marco no direito total do contrato, em porcento. */
  readonly entitlementSharePercent: number | null;
  /** PREVISTO no contrato. Nunca somado como direito nem como apuração. */
  readonly plannedBillingAmount: number | null;

  readonly entitlementSourceDocumentId: string | null;
  readonly entitlementSourcePage: number | null;
  readonly entitlementSourceReference: string | null;

  readonly measurementRequired: boolean;
  readonly requiredDocumentType: string | null;
  readonly evidenceRequired: boolean | null;
  readonly reportRequired: boolean | null;
  readonly technicalReportRequired: boolean | null;
  /** O aceite da Contratante é condição contratual deste marco? */
  readonly customerAcceptanceRequired: boolean | null;

  readonly governedMappingCount: number;
  readonly timelineItemId: string | null;
  readonly timelineProjectId: string | null;
  readonly timelineTitle: string | null;
  readonly timelineWbsCode: string | null;
  readonly timelineStatus: TimelineItemStatus | null;
  readonly timelinePercentComplete: number | null;
  readonly timelinePlannedFinish: string | null;
  readonly timelineActualFinish: string | null;
  readonly triggerAssessment: TriggerAssessment;

  readonly measurementId: string | null;
  readonly measurementStatus: MeasurementStatus | null;
  readonly measurementReadiness: ReadinessState | null;
  readonly measurementAcceptedAt: string | null;
  readonly acceptedValue: number | null;
  readonly measurementEvidenceCount: number | null;
  readonly measuredAmount: number | null;
  readonly evidenceDocumentId: string | null;

  readonly billingEventId: string | null;
  readonly billingEligibilityState: string | null;
  readonly billingReleaseState: string | null;
  readonly billingReceivableStatus: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

export function toProjectContractFinancial(raw: any): ProjectContractFinancial {
  return {
    organizationId: raw.organization_id,
    projectId: raw.project_id,
    contractId: raw.contract_id,
    linkSource: raw.link_source,
    linkedAt: raw.linked_at ?? null,
    contractNumber: raw.contract_number,
    contractTitle: raw.contract_title ?? null,
    contractStatus: raw.contract_status ?? null,
    counterpartyName: raw.counterparty_name ?? null,
    currency: raw.currency ?? null,
    startDate: raw.start_date ?? null,
    endDate: raw.end_date ?? null,
    signedDate: raw.signed_date ?? null,
    contractValue: toAmount(raw.contract_value),
    entitlementTotal: toAmount(raw.entitlement_total),
    entitlementRuleCount: raw.entitlement_rule_count ?? 0,
    milestoneCount: raw.milestone_count ?? 0,
    reconciliationDelta: toAmount(raw.reconciliation_delta),
    measuredTotal: toAmount(raw.measured_total),
    acceptedTotal: toAmount(raw.accepted_total),
    billedEventCount: raw.billed_event_count ?? 0,
    governedMappedMilestoneCount: raw.governed_mapped_milestone_count ?? 0,
  };
}

export function toProjectContractMilestone(raw: any): ProjectContractMilestone {
  return {
    projectId: raw.project_id,
    organizationId: raw.organization_id,
    contractId: raw.contract_id,
    milestoneId: raw.milestone_id,
    title: raw.title,
    description: raw.description ?? null,
    milestoneType: raw.milestone_type ?? null,
    status: raw.status,
    dueDate: raw.due_date ?? null,
    completedAt: raw.completed_at ?? null,
    entitlementAmount: toAmount(raw.entitlement_amount),
    entitlementCurrency: raw.entitlement_currency ?? null,
    entitlementRuleCount: raw.entitlement_rule_count ?? 0,
    entitlementSharePercent: toAmount(raw.entitlement_share_percent),
    plannedBillingAmount: toAmount(raw.planned_billing_amount),
    entitlementSourceDocumentId: raw.entitlement_source_document_id ?? null,
    entitlementSourcePage: raw.entitlement_source_page ?? null,
    entitlementSourceReference: raw.entitlement_source_reference ?? null,
    measurementRequired: raw.measurement_required === true,
    requiredDocumentType: raw.required_document_type ?? null,
    evidenceRequired: raw.evidence_required ?? null,
    reportRequired: raw.report_required ?? null,
    technicalReportRequired: raw.technical_report_required ?? null,
    customerAcceptanceRequired: raw.customer_acceptance_required ?? null,
    governedMappingCount: raw.governed_mapping_count ?? 0,
    timelineItemId: raw.timeline_item_id ?? null,
    timelineProjectId: raw.timeline_project_id ?? null,
    timelineTitle: raw.timeline_title ?? null,
    timelineWbsCode: raw.timeline_wbs_code ?? null,
    timelineStatus: raw.timeline_status ?? null,
    timelinePercentComplete: toAmount(raw.timeline_percent_complete),
    timelinePlannedFinish: raw.timeline_planned_finish ?? null,
    timelineActualFinish: raw.timeline_actual_finish ?? null,
    triggerAssessment: raw.trigger_assessment ?? 'NOT_ASSESSED',
    measurementId: raw.measurement_id ?? null,
    measurementStatus: raw.measurement_status ?? null,
    measurementReadiness: raw.measurement_readiness ?? null,
    measurementAcceptedAt: raw.measurement_accepted_at ?? null,
    acceptedValue: toAmount(raw.measurement_accepted_value),
    measurementEvidenceCount: raw.measurement_evidence_count ?? null,
    measuredAmount: toAmount(raw.measured_amount),
    evidenceDocumentId: raw.evidence_document_id ?? null,
    billingEventId: raw.billing_event_id ?? null,
    billingEligibilityState: raw.billing_eligibility_state ?? null,
    billingReleaseState: raw.billing_release_state ?? null,
    billingReceivableStatus: raw.billing_receivable_status ?? null,
  };
}
