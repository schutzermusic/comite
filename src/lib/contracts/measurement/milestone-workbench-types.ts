/**
 * A LINHA DA BANCADA — a borda tipada de `contract_milestone_workbench`.
 *
 * Tipos só, sem lógica e sem JSX: o vitest deste repositório roda em `node`, e
 * a derivação de estágio (`milestone-stage.ts`) precisa ser testável sem banco
 * e sem DOM.
 *
 * ─── A regra que este arquivo protege ──────────────────────────────────────
 *
 * TRÊS valores, TRÊS campos, nunca um só:
 *
 *   · `entitlementAmount` — o que o CONTRATO promete (direito fixo, migration 136)
 *   · `measuredAmount`    — o que a operação APUROU
 *   · `acceptedValue`     — o que alguém com autoridade ACEITOU
 *
 * Não existe getter que os funda. Um `valor` único obrigaria cada tela a
 * escolher em silêncio qual das três verdades está mostrando — e foi assim que
 * previsão contratual já apareceu como apuração neste produto.
 */

import type { ContractMilestoneStatus } from '../contract-service';
import type { MeasurementStatus, ReadinessState } from '@/lib/projects/measurements/types';
import type {
  BillingEligibilityState, BillingReleaseState, BillingAmountSource,
  FinanceLinkState, ReceivableStatus,
} from '../billing/contract-to-cash-service';

/** Estado de uma etapa de cronograma, conforme `project_timeline_items`. */
export type TimelineItemStatus =
  | 'not_started' | 'in_progress' | 'blocked' | 'delayed' | 'completed' | 'cancelled';

/**
 * Uma linha da bancada, já normalizada para camelCase.
 *
 * Numéricos chegam do PostgREST como `string` (numeric) ou `number`. O
 * normalizador converte para `number | null` — e `null` significa NÃO APURADO,
 * jamais zero.
 */
export interface MilestoneWorkbenchRow {
  // ── O marco ──────────────────────────────────────────────────────────────
  readonly id: string;
  readonly organizationId: string;
  readonly contractId: string;
  readonly projectId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly milestoneType: string | null;
  readonly status: ContractMilestoneStatus;
  readonly dueDate: string | null;
  readonly completedAt: string | null;
  /** PREVISTO no contrato. Nunca somado como medição. */
  readonly billingAmount: number | null;
  /** APURADO pela operação. `null` = não apurado. */
  readonly measuredAmount: number | null;
  readonly ownerUserId: string | null;
  readonly evidence: string | null;
  readonly evidenceDocumentId: string | null;

  // ── Direito contratual ───────────────────────────────────────────────────
  /** DIREITO FIXO do contrato. Distinto de `billingAmount` e de `acceptedValue`. */
  readonly entitlementAmount: number | null;
  readonly entitlementCurrency: string | null;
  readonly entitlementSourceDocumentId: string | null;
  readonly entitlementSourcePage: number | null;
  readonly entitlementSourceReference: string | null;
  readonly entitlementRuleCount: number;

  // ── Exigência de medição ─────────────────────────────────────────────────
  readonly requirementId: string | null;
  readonly requirementCount: number;
  readonly customerAcceptanceRequired: boolean | null;
  readonly evidenceRequired: boolean | null;
  readonly requiredDocumentType: string | null;
  readonly reportRequired: boolean | null;
  readonly technicalReportRequired: boolean | null;

  // ── Cronograma (autoridade: Projetos) ────────────────────────────────────
  /** Mapeamentos ACEITOS por revisor humano. Proposta nunca conta aqui. */
  readonly governedMappingCount: number;
  readonly timelineItemId: string | null;
  readonly timelineProjectId: string | null;
  readonly timelineTitle: string | null;
  readonly timelineWbsCode: string | null;
  readonly timelineStatus: TimelineItemStatus | null;
  readonly timelinePercentComplete: number | null;
  readonly timelinePlannedFinish: string | null;
  readonly timelineActualFinish: string | null;

  // ── Medição operacional (autoridade: Projetos) ───────────────────────────
  readonly measurementId: string | null;
  readonly measurementStatus: MeasurementStatus | null;
  readonly measurementReadiness: ReadinessState | null;
  readonly measurementReadinessReasons: readonly string[];
  readonly measurementExpectedAt: string | null;
  readonly measurementSubmittedAt: string | null;
  readonly measurementAcceptedAt: string | null;
  /** ACEITO por quem tem autoridade. Terceira verdade, separada das outras duas. */
  readonly acceptedValue: number | null;
  readonly acceptedCurrency: string | null;
  readonly measurementEvidenceCount: number | null;
  readonly measurementMissingRequirementCount: number | null;

  // ── Faturamento (autoridade: Contratos/Fiscal/Finanças, a jusante) ───────
  readonly billingEventId: string | null;
  readonly billingEligibilityState: BillingEligibilityState | null;
  readonly billingReleaseState: BillingReleaseState | null;
  readonly billingEligibleAmount: number | null;
  readonly billingCurrency: string | null;
  readonly billingAmountSource: BillingAmountSource | null;
  readonly billingFiscalDocumentStatus: string | null;
  readonly billingReceivableStatus: ReceivableStatus | null;
  readonly billingFinanceLinkState: FinanceLinkState | null;
}

/** Forma crua da visão, em snake_case, como o PostgREST devolve. */
export interface MilestoneWorkbenchRawRow {
  id: string;
  organization_id: string;
  contract_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  milestone_type: string | null;
  status: ContractMilestoneStatus;
  due_date: string | null;
  completed_at: string | null;
  billing_amount: number | string | null;
  measured_amount: number | string | null;
  owner_user_id: string | null;
  evidence: string | null;
  evidence_document_id: string | null;
  entitlement_amount: number | string | null;
  entitlement_currency: string | null;
  entitlement_source_document_id: string | null;
  entitlement_source_page: number | null;
  entitlement_source_reference: string | null;
  entitlement_rule_count: number | null;
  requirement_id: string | null;
  requirement_count: number | null;
  customer_acceptance_required: boolean | null;
  evidence_required: boolean | null;
  required_document_type: string | null;
  report_required: boolean | null;
  technical_report_required: boolean | null;
  governed_mapping_count: number | null;
  timeline_item_id: string | null;
  timeline_project_id: string | null;
  timeline_title: string | null;
  timeline_wbs_code: string | null;
  timeline_status: TimelineItemStatus | null;
  timeline_percent_complete: number | string | null;
  timeline_planned_finish: string | null;
  timeline_actual_finish: string | null;
  measurement_id: string | null;
  measurement_status: MeasurementStatus | null;
  measurement_readiness: ReadinessState | null;
  measurement_readiness_reasons: unknown;
  measurement_expected_at: string | null;
  measurement_submitted_at: string | null;
  measurement_accepted_at: string | null;
  measurement_accepted_value: number | string | null;
  measurement_accepted_currency: string | null;
  measurement_evidence_count: number | null;
  measurement_missing_requirement_count: number | null;
  billing_event_id: string | null;
  billing_eligibility_state: BillingEligibilityState | null;
  billing_release_state: BillingReleaseState | null;
  billing_eligible_amount: number | string | null;
  billing_currency: string | null;
  billing_amount_source: BillingAmountSource | null;
  billing_fiscal_document_status: string | null;
  billing_receivable_status: ReceivableStatus | null;
  billing_finance_link_state: FinanceLinkState | null;
}

/**
 * `numeric` do Postgres chega como string. Ausência permanece ausência: a
 * coerção devolve `null`, nunca 0 — porque "não apurado" e "apurado e deu
 * zero" são fatos diferentes, e esta é a fronteira onde a diferença se perde
 * se alguém escrever `Number(v) || 0`.
 */
export const toAmount = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

const toReasons = (v: unknown): readonly string[] =>
  (Array.isArray(v) ? v.filter((r): r is string => typeof r === 'string') : []);

/** Normaliza a linha crua. Contagens ausentes viram 0 — aqui zero É a verdade. */
export function toWorkbenchRow(raw: MilestoneWorkbenchRawRow): MilestoneWorkbenchRow {
  return {
    id: raw.id,
    organizationId: raw.organization_id,
    contractId: raw.contract_id,
    projectId: raw.project_id,
    title: raw.title,
    description: raw.description,
    milestoneType: raw.milestone_type,
    status: raw.status,
    dueDate: raw.due_date,
    completedAt: raw.completed_at,
    billingAmount: toAmount(raw.billing_amount),
    measuredAmount: toAmount(raw.measured_amount),
    ownerUserId: raw.owner_user_id,
    evidence: raw.evidence,
    evidenceDocumentId: raw.evidence_document_id,

    entitlementAmount: toAmount(raw.entitlement_amount),
    entitlementCurrency: raw.entitlement_currency,
    entitlementSourceDocumentId: raw.entitlement_source_document_id,
    entitlementSourcePage: raw.entitlement_source_page,
    entitlementSourceReference: raw.entitlement_source_reference,
    entitlementRuleCount: raw.entitlement_rule_count ?? 0,

    requirementId: raw.requirement_id,
    requirementCount: raw.requirement_count ?? 0,
    customerAcceptanceRequired: raw.customer_acceptance_required,
    evidenceRequired: raw.evidence_required,
    requiredDocumentType: raw.required_document_type,
    reportRequired: raw.report_required,
    technicalReportRequired: raw.technical_report_required,

    governedMappingCount: raw.governed_mapping_count ?? 0,
    timelineItemId: raw.timeline_item_id,
    timelineProjectId: raw.timeline_project_id,
    timelineTitle: raw.timeline_title,
    timelineWbsCode: raw.timeline_wbs_code,
    timelineStatus: raw.timeline_status,
    timelinePercentComplete: toAmount(raw.timeline_percent_complete),
    timelinePlannedFinish: raw.timeline_planned_finish,
    timelineActualFinish: raw.timeline_actual_finish,

    measurementId: raw.measurement_id,
    measurementStatus: raw.measurement_status,
    measurementReadiness: raw.measurement_readiness,
    measurementReadinessReasons: toReasons(raw.measurement_readiness_reasons),
    measurementExpectedAt: raw.measurement_expected_at,
    measurementSubmittedAt: raw.measurement_submitted_at,
    measurementAcceptedAt: raw.measurement_accepted_at,
    acceptedValue: toAmount(raw.measurement_accepted_value),
    acceptedCurrency: raw.measurement_accepted_currency,
    measurementEvidenceCount: raw.measurement_evidence_count,
    measurementMissingRequirementCount: raw.measurement_missing_requirement_count,

    billingEventId: raw.billing_event_id,
    billingEligibilityState: raw.billing_eligibility_state,
    billingReleaseState: raw.billing_release_state,
    billingEligibleAmount: toAmount(raw.billing_eligible_amount),
    billingCurrency: raw.billing_currency,
    billingAmountSource: raw.billing_amount_source,
    billingFiscalDocumentStatus: raw.billing_fiscal_document_status,
    billingReceivableStatus: raw.billing_receivable_status,
    billingFinanceLinkState: raw.billing_finance_link_state,
  };
}
