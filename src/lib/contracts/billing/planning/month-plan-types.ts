/**
 * A LINHA DO PLANEJAMENTO MENSAL — borda tipada de `contract_billing_month_plan`.
 *
 * Tipos e normalização apenas. A derivação de estado mora em
 * `monthly-planning.ts` e, mais fundo, na máquina canônica de
 * `milestone-stage.ts` — este arquivo não decide nada.
 *
 * ─── As quatro quantias que NÃO se fundem ──────────────────────────────────
 *
 *   plannedAmount           — o que o CONTRATO promete para o marco
 *   billingEligibleAmount   — o que o EVENTO de faturamento apurou
 *   receivablePaidAmountCents — o que FINANÇAS afirma recebido
 *   acceptedValue           — o que alguém com autoridade ACEITOU
 *
 * Não existe getter que as some. Uma tela que quiser exibir "o valor" precisa
 * escolher qual das quatro, com o rótulo à vista — e é justamente essa escolha
 * que um campo único faria em silêncio.
 */

import type { ContractMilestoneStatus } from '../../contract-service';
import type { MeasurementStatus, ReadinessState } from '@/lib/projects/measurements/types';
import type {
  BillingEligibilityState, BillingReleaseState, BillingAmountSource,
  FinanceLinkState, ReceivableStatus,
} from '../contract-to-cash-service';
import type { TimelineItemStatus } from '../../measurement/milestone-workbench-types';
import { toAmount } from '../../measurement/milestone-workbench-types';

/**
 * QUAL fato sustentou a data prevista de faturamento.
 *
 * Existe porque as três primeiras opções têm graus de confiança muito
 * diferentes e, sem este campo, apareceriam na tela com a mesma cara:
 *
 *   timeline_forecast_finish — cronograma GOVERNADO, replanejado
 *   timeline_planned_finish  — cronograma GOVERNADO, linha de base
 *   measurement_expected_at  — medição que Projetos agendou
 *   milestone_due_date       — o prazo que o próprio marco carrega
 *   undetermined             — não há data, e o mês previsto é nulo
 */
export type PlannedBillingDateBasis =
  | 'timeline_forecast_finish'
  | 'timeline_planned_finish'
  | 'measurement_expected_at'
  | 'milestone_due_date'
  | 'undetermined';

/** A base do valor previsto — direito contratual ou previsto do marco. */
export type PlannedAmountBasis = 'contract_entitlement' | 'milestone_billing_amount';

export interface BillingMonthPlanRow {
  // ── Identidade ───────────────────────────────────────────────────────────
  readonly milestoneId: string;
  readonly organizationId: string;
  readonly contractId: string;
  readonly contractNumber: string | null;
  readonly counterpartyName: string | null;
  readonly projectId: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly status: ContractMilestoneStatus;
  readonly milestoneDueDate: string | null;
  readonly completedAt: string | null;

  // ── Responsáveis (uuid autoritativo, nunca nome resolvido por semelhança) ─
  readonly milestoneOwnerUserId: string | null;
  readonly contractOwnerUserId: string | null;
  readonly timelineResponsibleUserId: string | null;

  // ── Quantias, separadas ──────────────────────────────────────────────────
  readonly plannedAmount: number | null;
  readonly plannedAmountBasis: PlannedAmountBasis | null;
  readonly entitlementAmount: number | null;
  readonly billingAmount: number | null;
  readonly measuredAmount: number | null;
  readonly acceptedValue: number | null;
  readonly billingEligibleAmount: number | null;
  readonly currency: string | null;

  // ── A data prevista, e o que a sustenta ──────────────────────────────────
  readonly plannedBillingDate: string | null;
  readonly plannedBillingDateBasis: PlannedBillingDateBasis;
  /** `YYYY-MM`. Derivado no banco, da MESMA expressão da data. */
  readonly plannedBillingMonth: string | null;

  // ── Cronograma ───────────────────────────────────────────────────────────
  readonly governedMappingCount: number;
  readonly timelineItemId: string | null;
  readonly timelineTitle: string | null;
  readonly timelineWbsCode: string | null;
  readonly timelineStatus: TimelineItemStatus | null;
  readonly timelinePlannedFinish: string | null;
  readonly timelineForecastFinish: string | null;
  readonly timelineActualFinish: string | null;
  readonly timelineIsActive: boolean | null;
  /**
   * EXIBIÇÃO apenas. Não entra em derivação nenhuma — nem aqui, nem na visão,
   * nem em `milestone-stage.ts`. Cem por cento é opinião de quem atualizou a
   * linha; não é prova de que o gatilho contratual ocorreu.
   */
  readonly timelinePercentComplete: number | null;

  // ── Reprogramação ────────────────────────────────────────────────────────
  readonly reprogrammingCount: number;
  readonly lastPreviousPlannedFinish: string | null;
  readonly lastNewPlannedFinish: string | null;
  readonly lastReprogrammedAt: string | null;

  // ── Exigência, medição e aceite ──────────────────────────────────────────
  readonly requirementId: string | null;
  readonly customerAcceptanceRequired: boolean | null;
  readonly evidenceRequired: boolean | null;
  readonly measurementId: string | null;
  readonly measurementStatus: MeasurementStatus | null;
  readonly measurementReadiness: ReadinessState | null;
  readonly measurementExpectedAt: string | null;
  readonly measurementAcceptedAt: string | null;
  readonly measurementEvidenceCount: number | null;
  readonly evidenceDocumentId: string | null;
  readonly evidence: string | null;

  // ── Faturamento e caixa, a jusante ───────────────────────────────────────
  readonly billingEventId: string | null;
  readonly billingEligibilityState: BillingEligibilityState | null;
  readonly billingReleaseState: BillingReleaseState | null;
  readonly billingAmountSource: BillingAmountSource | null;
  readonly billingFiscalDocumentStatus: string | null;
  readonly billingReceivableStatus: ReceivableStatus | null;
  readonly billingFinanceLinkState: FinanceLinkState | null;
  readonly fiscalDocumentNumber: string | null;
  readonly fiscalAuthorizedAt: string | null;
  readonly receivableFirstDueDate: string | null;
  readonly receivablePaidAmountCents: number | null;
  readonly receivableOpenAmountCents: number | null;
  readonly receivableLastPaymentDate: string | null;
  readonly reconciledSettlementCount: number | null;
  /**
   * TEXTO do instrumento, exibido como texto.
   *
   * Nunca convertido em data de vencimento. `payment_terms` é campo livre
   * ("30 dias após o aceite", "faturamento mensal"), e derivar vencimento dele
   * produziria uma data de recebimento que ninguém pactuou. O vencimento
   * autoritativo é `receivableFirstDueDate`, que só existe quando Finanças
   * criou o recebível.
   */
  readonly paymentTermText: string | null;
}

export interface BillingMonthPlanRawRow {
  milestone_id: string;
  organization_id: string;
  contract_id: string;
  contract_number: string | null;
  counterparty_name: string | null;
  project_id: string | null;
  title: string;
  description: string | null;
  status: ContractMilestoneStatus;
  milestone_due_date: string | null;
  completed_at: string | null;
  milestone_owner_user_id: string | null;
  contract_owner_user_id: string | null;
  timeline_responsible_user_id: string | null;
  planned_amount: number | string | null;
  planned_amount_basis: PlannedAmountBasis | null;
  entitlement_amount: number | string | null;
  billing_amount: number | string | null;
  measured_amount: number | string | null;
  accepted_value: number | string | null;
  billing_eligible_amount: number | string | null;
  currency: string | null;
  planned_billing_date: string | null;
  planned_billing_date_basis: PlannedBillingDateBasis | null;
  planned_billing_month: string | null;
  governed_mapping_count: number | null;
  timeline_item_id: string | null;
  timeline_title: string | null;
  timeline_wbs_code: string | null;
  timeline_status: TimelineItemStatus | null;
  timeline_planned_finish: string | null;
  timeline_forecast_finish: string | null;
  timeline_actual_finish: string | null;
  timeline_is_active: boolean | null;
  timeline_percent_complete: number | string | null;
  reprogramming_count: number | null;
  last_previous_planned_finish: string | null;
  last_new_planned_finish: string | null;
  last_reprogrammed_at: string | null;
  requirement_id: string | null;
  customer_acceptance_required: boolean | null;
  evidence_required: boolean | null;
  measurement_id: string | null;
  measurement_status: MeasurementStatus | null;
  measurement_readiness: ReadinessState | null;
  measurement_expected_at: string | null;
  measurement_accepted_at: string | null;
  measurement_evidence_count: number | null;
  evidence_document_id: string | null;
  evidence: string | null;
  billing_event_id: string | null;
  billing_eligibility_state: BillingEligibilityState | null;
  billing_release_state: BillingReleaseState | null;
  billing_amount_source: BillingAmountSource | null;
  billing_fiscal_document_status: string | null;
  billing_receivable_status: ReceivableStatus | null;
  billing_finance_link_state: FinanceLinkState | null;
  fiscal_document_number: string | null;
  fiscal_authorized_at: string | null;
  receivable_first_due_date: string | null;
  receivable_paid_amount_cents: number | string | null;
  receivable_open_amount_cents: number | string | null;
  receivable_last_payment_date: string | null;
  reconciled_settlement_count: number | null;
  payment_term_text: string | null;
}

/** Inteiro em centavos: ausência continua sendo `null`, nunca 0. */
const toCents = (v: number | string | null | undefined): number | null => {
  const n = toAmount(v);
  return n === null ? null : Math.round(n);
};

export function toMonthPlanRow(raw: BillingMonthPlanRawRow): BillingMonthPlanRow {
  return {
    milestoneId: raw.milestone_id,
    organizationId: raw.organization_id,
    contractId: raw.contract_id,
    contractNumber: raw.contract_number,
    counterpartyName: raw.counterparty_name,
    projectId: raw.project_id,
    title: raw.title,
    description: raw.description,
    status: raw.status,
    milestoneDueDate: raw.milestone_due_date,
    completedAt: raw.completed_at,

    milestoneOwnerUserId: raw.milestone_owner_user_id,
    contractOwnerUserId: raw.contract_owner_user_id,
    timelineResponsibleUserId: raw.timeline_responsible_user_id,

    plannedAmount: toAmount(raw.planned_amount),
    plannedAmountBasis: raw.planned_amount_basis,
    entitlementAmount: toAmount(raw.entitlement_amount),
    billingAmount: toAmount(raw.billing_amount),
    measuredAmount: toAmount(raw.measured_amount),
    acceptedValue: toAmount(raw.accepted_value),
    billingEligibleAmount: toAmount(raw.billing_eligible_amount),
    currency: raw.currency,

    plannedBillingDate: raw.planned_billing_date,
    plannedBillingDateBasis: raw.planned_billing_date_basis ?? 'undetermined',
    plannedBillingMonth: raw.planned_billing_month,

    governedMappingCount: raw.governed_mapping_count ?? 0,
    timelineItemId: raw.timeline_item_id,
    timelineTitle: raw.timeline_title,
    timelineWbsCode: raw.timeline_wbs_code,
    timelineStatus: raw.timeline_status,
    timelinePlannedFinish: raw.timeline_planned_finish,
    timelineForecastFinish: raw.timeline_forecast_finish,
    timelineActualFinish: raw.timeline_actual_finish,
    timelineIsActive: raw.timeline_is_active,
    timelinePercentComplete: toAmount(raw.timeline_percent_complete),

    reprogrammingCount: raw.reprogramming_count ?? 0,
    lastPreviousPlannedFinish: raw.last_previous_planned_finish,
    lastNewPlannedFinish: raw.last_new_planned_finish,
    lastReprogrammedAt: raw.last_reprogrammed_at,

    requirementId: raw.requirement_id,
    customerAcceptanceRequired: raw.customer_acceptance_required,
    evidenceRequired: raw.evidence_required,
    measurementId: raw.measurement_id,
    measurementStatus: raw.measurement_status,
    measurementReadiness: raw.measurement_readiness,
    measurementExpectedAt: raw.measurement_expected_at,
    measurementAcceptedAt: raw.measurement_accepted_at,
    measurementEvidenceCount: raw.measurement_evidence_count,
    evidenceDocumentId: raw.evidence_document_id,
    evidence: raw.evidence,

    billingEventId: raw.billing_event_id,
    billingEligibilityState: raw.billing_eligibility_state,
    billingReleaseState: raw.billing_release_state,
    billingAmountSource: raw.billing_amount_source,
    billingFiscalDocumentStatus: raw.billing_fiscal_document_status,
    billingReceivableStatus: raw.billing_receivable_status,
    billingFinanceLinkState: raw.billing_finance_link_state,
    fiscalDocumentNumber: raw.fiscal_document_number,
    fiscalAuthorizedAt: raw.fiscal_authorized_at,
    receivableFirstDueDate: raw.receivable_first_due_date,
    receivablePaidAmountCents: toCents(raw.receivable_paid_amount_cents),
    receivableOpenAmountCents: toCents(raw.receivable_open_amount_cents),
    receivableLastPaymentDate: raw.receivable_last_payment_date,
    reconciledSettlementCount: raw.reconciled_settlement_count,
    paymentTermText: raw.payment_term_text,
  };
}
