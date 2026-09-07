/**
 * CONTRATO-A-CAIXA — o serviço canônico, e o único.
 *
 * ─── Por que existe um arquivo só ─────────────────────────────────────────
 *
 * A §61 e a §87 da Fase 7 pedem UM resolvedor por evento de faturamento, usado
 * pela carteira, pelo dossiê do contrato e por Finanças. A alternativa — cada
 * tela somando por conta própria — já produziu neste repositório um painel que
 * apresentava previsão como apuração. O cálculo mora no banco
 * (`contract_to_cash_read_model`); este módulo é a borda tipada dele, e não
 * recalcula nada.
 *
 * ─── Ausência não é zero ──────────────────────────────────────────────────
 *
 * Os campos de Finanças chegam `null` quando não há título. `null` significa
 * "não se sabe"; `0` significa "há título e nada entrou". Quem renderiza é
 * obrigado a passar por `financeLinkState` antes de escrever um número — é o
 * que a §62 exige, e é o que impede a tela de dizer "R$ 0 recebido" para um
 * contrato que Finanças nunca viu.
 */
import { createClient } from '@/utils/supabase/client';

/** Estado da elegibilidade contratual de faturar. */
export type BillingEligibilityState =
  | 'UNKNOWN' | 'ELIGIBLE' | 'BLOCKED' | 'INCOMPLETE' | 'NOT_APPLICABLE' | 'LEGACY';

/** Estado da liberação. Distinto da elegibilidade, sempre (§14). */
export type BillingReleaseState =
  | 'NOT_ELIGIBLE' | 'ELIGIBLE' | 'PENDING_RELEASE' | 'RELEASED'
  | 'RELEASE_REJECTED' | 'CANCELLED' | 'SUPERSEDED' | 'LEGACY';

/** De onde o número veio. Acompanha o valor, sempre (§11). */
export type BillingAmountSource =
  | 'ACCEPTED_MEASUREMENT' | 'LEGACY_MEASURED_AMOUNT' | 'FIXED_CONTRACT_ENTITLEMENT'
  | 'GOVERNED_ADJUSTMENT' | 'UNKNOWN' | 'LEGACY_UNKNOWN';

/** Estado do vínculo com Finanças. Consultado ANTES de exibir qualquer valor. */
export type FinanceLinkState =
  | 'LINKED' | 'CLOSED' | 'PENDING_CONFIGURATION' | 'NOT_LINKED' | 'UNKNOWN';

export type ReceivableStatus =
  | 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'REVERSED' | 'RENEGOTIATED';

/** Motivo legível por máquina. Nunca um booleano opaco (§16). */
export interface BillingBlocker {
  readonly code: string;
  /** Bloqueia o DIREITO de faturar; falso bloqueia o estágio seguinte. */
  readonly blocking: boolean;
  readonly detail?: string;
  readonly title?: string;
  readonly why?: string;
  readonly condition_type?: string;
  readonly obligation_instance_id?: string;
  readonly occurrence_key?: string;
  readonly due_date?: string;
  readonly required_document_type?: string;
}

export interface ContractToCashRow {
  readonly billingEventId: string;
  readonly organizationId: string;
  readonly contractId: string;
  readonly milestoneId: string | null;
  readonly title: string;
  /** Linha anterior à Fase 7: sem procedência, e a tela precisa dizer isso. */
  readonly legacyRow: boolean;

  readonly sourceMeasurementId: string | null;
  readonly entitlementKey: string | null;

  /** `null` quando a fonte é UNKNOWN. Nunca 0 por ausência. */
  readonly eligibleAmount: number | null;
  readonly currency: string | null;
  readonly amountSource: BillingAmountSource | null;
  readonly amountDerivationRule: string | null;
  readonly amountDerivedAt: string | null;

  readonly eligibilityState: BillingEligibilityState | null;
  readonly blockers: readonly BillingBlocker[];
  readonly eligibilityComputedAt: string | null;

  readonly releaseState: BillingReleaseState | null;
  readonly releasedAt: string | null;
  readonly releasedBy: string | null;
  readonly releaseApprovalRequestId: string | null;
  readonly supersededById: string | null;
  readonly cancelledAt: string | null;

  /** Sempre `NOT_APPLICABLE` hoje: não há esquema real para as três (§114). */
  readonly retentionState: 'NOT_APPLICABLE';
  readonly glosaState: 'NOT_APPLICABLE';
  readonly disputeState: 'NOT_APPLICABLE';

  readonly fiscalRequestState: string | null;
  readonly fiscalBlockers: readonly { code: string; detail?: string }[];
  readonly fiscalDocumentId: string | null;
  readonly fiscalDocumentStatus: string | null;
  readonly fiscalDocumentNumber: string | null;
  readonly fiscalEnvironment: string | null;
  readonly fiscalAuthorizedAt: string | null;
  readonly fiscalFinanceStatus: string | null;

  readonly receivableId: string | null;
  readonly receivableAmountBasis: string | null;
  readonly receivableAmountCents: number | null;
  readonly receivableLifecycleState: string | null;
  readonly ledgerPostingState: string | null;
  readonly ledgerBlockers: readonly { code: string; detail?: string }[];
  readonly dueDate: string | null;
  readonly paidAmountCents: number | null;
  readonly openAmountCents: number | null;
  readonly receivableStatus: ReceivableStatus | null;

  readonly financeLinkState: FinanceLinkState;
  readonly reconciledSettlementCount: number | null;
  readonly unreconciledSettlementCount: number | null;
}

/** `numeric` do Postgres chega como string pelo driver; `null` sobrevive. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

const list = <T,>(v: unknown): readonly T[] => (Array.isArray(v) ? (v as T[]) : []);

export function toContractToCashRow(r: Record<string, unknown>): ContractToCashRow {
  return {
    billingEventId: String(r.billing_event_id),
    organizationId: String(r.organization_id),
    contractId: String(r.contract_id),
    milestoneId: (r.milestone_id as string | null) ?? null,
    title: String(r.title ?? ''),
    legacyRow: r.legacy_row === true,

    sourceMeasurementId: (r.source_measurement_id as string | null) ?? null,
    entitlementKey: (r.entitlement_key as string | null) ?? null,

    eligibleAmount: num(r.eligible_amount),
    currency: (r.currency as string | null) ?? null,
    amountSource: (r.amount_source as BillingAmountSource | null) ?? null,
    amountDerivationRule: (r.amount_derivation_rule as string | null) ?? null,
    amountDerivedAt: (r.amount_derived_at as string | null) ?? null,

    eligibilityState: (r.eligibility_state as BillingEligibilityState | null) ?? null,
    blockers: list<BillingBlocker>(r.eligibility_reasons),
    eligibilityComputedAt: (r.eligibility_computed_at as string | null) ?? null,

    releaseState: (r.release_state as BillingReleaseState | null) ?? null,
    releasedAt: (r.released_at as string | null) ?? null,
    releasedBy: (r.released_by as string | null) ?? null,
    releaseApprovalRequestId: (r.release_approval_request_id as string | null) ?? null,
    supersededById: (r.superseded_by_id as string | null) ?? null,
    cancelledAt: (r.cancelled_at as string | null) ?? null,

    retentionState: 'NOT_APPLICABLE',
    glosaState: 'NOT_APPLICABLE',
    disputeState: 'NOT_APPLICABLE',

    fiscalRequestState: (r.fiscal_request_state as string | null) ?? null,
    fiscalBlockers: list(r.fiscal_blockers),
    fiscalDocumentId: (r.fiscal_document_id as string | null) ?? null,
    fiscalDocumentStatus: (r.fiscal_document_status as string | null) ?? null,
    fiscalDocumentNumber: (r.fiscal_document_number as string | null) ?? null,
    fiscalEnvironment: (r.fiscal_environment as string | null) ?? null,
    fiscalAuthorizedAt: (r.fiscal_authorized_at as string | null) ?? null,
    fiscalFinanceStatus: (r.fiscal_finance_status as string | null) ?? null,

    receivableId: (r.receivable_id as string | null) ?? null,
    receivableAmountBasis: (r.receivable_amount_basis as string | null) ?? null,
    receivableAmountCents: num(r.receivable_amount_cents),
    receivableLifecycleState: (r.receivable_lifecycle_state as string | null) ?? null,
    ledgerPostingState: (r.ledger_posting_state as string | null) ?? null,
    ledgerBlockers: list(r.ledger_blockers),
    dueDate: (r.due_date as string | null) ?? null,
    paidAmountCents: num(r.paid_amount_cents),
    openAmountCents: num(r.open_amount_cents),
    receivableStatus: (r.receivable_status as ReceivableStatus | null) ?? null,

    financeLinkState: (r.finance_link_state as FinanceLinkState) ?? 'UNKNOWN',
    reconciledSettlementCount: num(r.reconciled_settlement_count),
    unreconciledSettlementCount: num(r.unreconciled_settlement_count),
  };
}

/** A cadeia de um contrato. Mesma fonte que a carteira usa (§87). */
export async function listContractToCash(contractId: string): Promise<ContractToCashRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('contract_to_cash_read_model')
    .select('*')
    .eq('contract_id', contractId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Erro ao carregar a cadeia de faturamento: ${error.message}`);
  return (data ?? []).map((r) => toContractToCashRow(r as Record<string, unknown>));
}

/** A cadeia de vários contratos, em uma consulta. */
export async function listContractToCashForContracts(
  contractIds: readonly string[],
): Promise<ContractToCashRow[]> {
  if (contractIds.length === 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from('contract_to_cash_read_model')
    .select('*')
    .in('contract_id', contractIds as string[]);
  if (error) throw new Error(`Erro ao carregar a cadeia de faturamento: ${error.message}`);
  return (data ?? []).map((r) => toContractToCashRow(r as Record<string, unknown>));
}

/**
 * Recomputa a elegibilidade de um faturamento.
 *
 * Não decide nada: recalcular é função pura das entradas atuais, e a segunda
 * execução grava o mesmo resultado por cima do mesmo resultado.
 */
export async function recomputeBillingEligibility(billingEventId: string): Promise<{
  state: BillingEligibilityState; reasons: readonly BillingBlocker[]; changed: boolean;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('contract_billing_recompute_eligibility', {
    p_billing_event_id: billingEventId,
  });
  if (error) throw new Error(`Erro ao recalcular elegibilidade: ${error.message}`);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    state: (r.state as BillingEligibilityState) ?? 'UNKNOWN',
    reasons: list<BillingBlocker>(r.reasons),
    changed: r.changed === true,
  };
}

/**
 * LIBERA o faturamento. O ato governado da fase.
 *
 * O ator NÃO é parâmetro — ele vem de `auth.uid()` dentro da função, e é por
 * isso que o navegador não consegue liberar em nome de outra pessoa (§70). A
 * permissão, a elegibilidade recomputada no ato e a política de aprovação
 * (quando houver) são conferidas do lado do banco.
 */
export async function releaseBillingEvent(
  billingEventId: string, note?: string,
): Promise<{
  releaseState: BillingReleaseState; idempotent: boolean;
  releaseFingerprint?: string; approvalRequestId?: string;
}> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('contract_billing_release', {
    p_billing_event_id: billingEventId,
    p_note: note ?? null,
  });
  if (error) throw new Error(`Erro ao liberar faturamento: ${error.message}`);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    releaseState: (r.release_state as BillingReleaseState) ?? 'NOT_ELIGIBLE',
    idempotent: r.idempotent === true,
    releaseFingerprint: (r.release_fingerprint as string | undefined) ?? undefined,
    approvalRequestId: ((r.approval as Record<string, unknown> | undefined)?.request_id as string)
      ?? undefined,
  };
}

/** Cancela o direito de faturar. Não apaga: cancela, com motivo (§57). */
export async function cancelBillingEvent(billingEventId: string, reason: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('contract_billing_cancel', {
    p_billing_event_id: billingEventId, p_reason: reason,
  });
  if (error) throw new Error(`Erro ao cancelar faturamento: ${error.message}`);
}

/** Supera o direito: o antigo permanece, um sucessor nasce apontando para ele (§95). */
export async function supersedeBillingEvent(
  billingEventId: string, reason: string,
): Promise<{ successorId: string | null }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('contract_billing_supersede', {
    p_billing_event_id: billingEventId, p_reason: reason,
  });
  if (error) throw new Error(`Erro ao superar faturamento: ${error.message}`);
  return { successorId: ((data ?? {}) as Record<string, unknown>).successor_id as string ?? null };
}
