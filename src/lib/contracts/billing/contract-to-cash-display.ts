/**
 * A CADEIA, EM TEXTO — derivação pura, sem React e sem Supabase.
 *
 * Existe separada do componente por dois motivos concretos. O primeiro é que o
 * vitest deste repositório roda em `node`, e a regra que importa — "ausência
 * nunca vira zero" — precisa de teste de regressão permanente, não de uma
 * inspeção visual. O segundo é que a mesma derivação serve à carteira, ao
 * dossiê e a Finanças; duplicá-la em três componentes seria recriar, na
 * camada de cima, a divergência que a visão canônica eliminou embaixo.
 */
import type {
  BillingAmountSource, BillingBlocker, BillingEligibilityState, BillingReleaseState,
  ContractToCashRow, FinanceLinkState, ReceivableStatus,
} from './contract-to-cash-service';

/**
 * Valor exibível.
 *
 * `known: false` não carrega número — o compilador cobra quem tentar somar um
 * desconhecido. É a mesma disciplina do `Official<T>` da carteira, aplicada
 * aqui porque a Fase 7 tem cinco valores que podem faltar por motivos
 * DIFERENTES, e a tela precisa dizer qual.
 */
export type Displayable =
  | { readonly known: true; readonly cents: number; readonly currency: string }
  | { readonly known: false; readonly reason: MissingReason };

export type MissingReason =
  /** Não há título de Finanças para este faturamento. */
  | 'NOT_LINKED'
  /** Há vínculo, mas falta configuração para seguir. */
  | 'PENDING_CONFIGURATION'
  /** Nunca foi apurado: sem medição aceita e sem direito contratual. */
  | 'AMOUNT_UNKNOWN'
  /** Linha anterior à Fase 7: a procedência não foi registrada. */
  | 'LEGACY_NO_PROVENANCE';

export const known = (cents: number, currency: string): Displayable =>
  ({ known: true, cents, currency });
export const unknown = (reason: MissingReason): Displayable => ({ known: false, reason });

export const AMOUNT_SOURCE_LABEL: Record<BillingAmountSource, string> = {
  ACCEPTED_MEASUREMENT: 'Medição aceita',
  LEGACY_MEASURED_AMOUNT: 'Valor apurado legado',
  FIXED_CONTRACT_ENTITLEMENT: 'Direito contratual fixo',
  GOVERNED_ADJUSTMENT: 'Ajuste governado',
  UNKNOWN: 'Sem fonte apurada',
  LEGACY_UNKNOWN: 'Anterior à Fase 7 — origem não registrada',
};

export const ELIGIBILITY_LABEL: Record<BillingEligibilityState, string> = {
  ELIGIBLE: 'Elegível',
  BLOCKED: 'Bloqueado',
  INCOMPLETE: 'Incompleto',
  NOT_APPLICABLE: 'Não se aplica',
  UNKNOWN: 'Desconhecido',
  LEGACY: 'Legado',
};

export const RELEASE_LABEL: Record<BillingReleaseState, string> = {
  NOT_ELIGIBLE: 'Não liberável',
  ELIGIBLE: 'Aguardando liberação',
  PENDING_RELEASE: 'Em aprovação',
  RELEASED: 'Liberado',
  RELEASE_REJECTED: 'Liberação rejeitada',
  CANCELLED: 'Cancelado',
  SUPERSEDED: 'Superado',
  LEGACY: 'Legado',
};

export const RECEIVABLE_STATUS_LABEL: Record<ReceivableStatus, string> = {
  OPEN: 'Em aberto',
  PARTIAL: 'Parcialmente recebido',
  PAID: 'Recebido',
  OVERDUE: 'Vencido',
  CANCELLED: 'Cancelado',
  REVERSED: 'Estornado',
  RENEGOTIATED: 'Renegociado',
};

export const FINANCE_LINK_LABEL: Record<FinanceLinkState, string> = {
  LINKED: 'Título em Finanças',
  CLOSED: 'Título encerrado',
  PENDING_CONFIGURATION: 'Pendente de configuração',
  NOT_LINKED: 'Sem título em Finanças',
  UNKNOWN: 'Desconhecido',
};

/** Rótulos dos motivos da §16. Código sem tradução é mostrado como código. */
const BLOCKER_LABEL: Record<string, string> = {
  MEASUREMENT_NOT_ACCEPTED: 'Medição ainda não aceita',
  MEASUREMENT_UNKNOWN: 'Não há medição apurada para o marco',
  CONTRACT_RULE_UNRESOLVED: 'Condição contratual não avaliável',
  OBLIGATION_BLOCKING: 'Obrigação contratual em aberto bloqueia o faturamento',
  REQUIRED_DOCUMENT_MISSING: 'Documento exigido em contrato ausente',
  FORMAL_ACCEPTANCE_PENDING: 'Aceite formal do cliente pendente',
  RETENTION_APPLIES: 'Retenção contratual aplicável',
  DISPUTE_OPEN: 'Disputa em aberto',
  AMOUNT_UNKNOWN: 'Valor a faturar não apurado',
  CURRENCY_UNKNOWN: 'Moeda não declarada pela fonte',
  COUNTERPARTY_UNRESOLVED: 'Contrato sem parte canônica vinculada',
  FISCAL_PROFILE_INCOMPLETE: 'Cadastro fiscal incompleto — bloqueia a emissão, não o direito',
  ACCOUNTING_CONFIGURATION_MISSING: 'Configuração contábil ausente — bloqueia o lançamento',
  LEGACY_ROW_NO_PROVENANCE: 'Faturamento anterior à Fase 7: origem do valor desconhecida',
  BILLING_EVENT_CLOSED: 'Faturamento encerrado',
  AR_BASIS_UNCONFIGURED: 'Base do recebível (bruto ou líquido) não declarada',
  DUE_DATE_UNKNOWN: 'Vencimento não disponível em fonte autoritativa',
  FISCAL_ESTABLISHMENT_MISSING: 'Nenhum estabelecimento fiscal ativo',
  FISCAL_SERVICE_CATALOG_MISSING: 'Catálogo de serviço fiscal não cadastrado',
  FISCAL_PARTY_PROFILE_MISSING: 'Contraparte sem perfil fiscal',
  FISCAL_SERVICE_SELECTION_REQUIRED: 'Mais de um serviço fiscal ativo: a escolha é do Fiscal',
  FISCAL_SERVICE_LOCATION_MISSING: 'Município de prestação não cadastrado',
  CURRENCY_NOT_SUPPORTED_BY_FISCAL: 'Moeda fora do escopo da NFS-e',
  BILLING_NOT_RELEASED: 'Faturamento ainda não liberado',
  PERIOD_CLOSED: 'Período contábil fechado',
};

export function blockerLabel(code: string): string {
  return BLOCKER_LABEL[code] ?? code;
}

/** Só os que retiram o DIREITO de faturar. Os informativos vão à parte. */
export function blockingReasons(row: ContractToCashRow): readonly BillingBlocker[] {
  return row.blockers.filter((b) => b.blocking);
}

/** Os que não impedem o direito, mas travam o estágio seguinte. */
export function advisoryReasons(row: ContractToCashRow): readonly BillingBlocker[] {
  return row.blockers.filter((b) => !b.blocking);
}

/**
 * Valor elegível a faturar.
 *
 * Devolve DESCONHECIDO quando a procedência é UNKNOWN, mesmo que a coluna
 * `amount` traga um número — e ela traz, porque é NOT NULL e nasce em zero.
 * Exibir esse zero seria afirmar que não há nada a faturar, quando o que há é
 * ausência de apuração.
 */
export function eligibleAmount(row: ContractToCashRow): Displayable {
  if (row.legacyRow) return unknown('LEGACY_NO_PROVENANCE');
  if (row.amountSource === null || row.amountSource === 'UNKNOWN'
      || row.amountSource === 'LEGACY_UNKNOWN') {
    return unknown('AMOUNT_UNKNOWN');
  }
  if (row.eligibleAmount === null || row.currency === null) return unknown('AMOUNT_UNKNOWN');
  return known(Math.round(row.eligibleAmount * 100), row.currency);
}

/**
 * Recebido.
 *
 * A pergunta que este arquivo existe para responder direito. Sem título em
 * Finanças a resposta é DESCONHECIDO — nunca R$ 0. Escrever zero aqui é a
 * mentira que faz alguém cobrar um cliente que já pagou (§62).
 */
export function receivedAmount(row: ContractToCashRow): Displayable {
  if (row.receivableId === null) {
    return unknown(row.financeLinkState === 'PENDING_CONFIGURATION'
      ? 'PENDING_CONFIGURATION' : 'NOT_LINKED');
  }
  if (row.paidAmountCents === null) return unknown('NOT_LINKED');
  return known(row.paidAmountCents, row.currency ?? 'BRL');
}

/** Saldo em aberto. Mesma disciplina: ausência de título é desconhecido. */
export function openAmount(row: ContractToCashRow): Displayable {
  if (row.receivableId === null) {
    return unknown(row.financeLinkState === 'PENDING_CONFIGURATION'
      ? 'PENDING_CONFIGURATION' : 'NOT_LINKED');
  }
  if (row.openAmountCents === null) return unknown('NOT_LINKED');
  return known(row.openAmountCents, row.currency ?? 'BRL');
}

/**
 * O faturamento pode ser liberado agora?
 *
 * Elegível E ainda não liberado. Um `RELEASED` continua elegível, e oferecer o
 * botão de novo convidaria a uma segunda liberação que a RPC recusaria — o
 * usuário aprenderia a ignorar a recusa.
 */
export function canRelease(row: ContractToCashRow): boolean {
  return row.eligibilityState === 'ELIGIBLE' && row.releaseState === 'ELIGIBLE';
}

/**
 * A conciliação está em dia?
 *
 * `null` quando não há título: a pergunta não se aplica. Pagamento conciliado e
 * pagamento recebido são coisas diferentes (§49), e esta função é o lugar onde
 * a distinção fica explícita para a tela.
 */
export function reconciliationPending(row: ContractToCashRow): number | null {
  if (row.receivableId === null) return null;
  return row.unreconciledSettlementCount ?? null;
}

/** Um rótulo curto para o estágio em que a cadeia está parada. */
export function chainStage(row: ContractToCashRow): string {
  if (row.legacyRow) return 'Legado';
  if (row.releaseState === 'CANCELLED') return 'Cancelado';
  if (row.releaseState === 'SUPERSEDED') return 'Superado';
  if (row.receivableStatus === 'PAID') return 'Recebido';
  if (row.receivableId !== null && row.receivableLifecycleState !== 'ACTIVE') return 'Título encerrado';
  if (row.receivableId !== null) return 'Contas a receber';
  if (row.fiscalDocumentStatus === 'authorized') return 'Nota autorizada';
  if (row.fiscalDocumentId !== null) return 'Nota em preparo';
  if (row.fiscalRequestState === 'BLOCKED_BY_CONFIGURATION') return 'Fiscal bloqueado por configuração';
  if (row.releaseState === 'RELEASED') return 'Liberado';
  if (row.releaseState === 'PENDING_RELEASE') return 'Em aprovação';
  if (row.eligibilityState === 'ELIGIBLE') return 'Elegível';
  return 'Não faturável';
}

const FMT = new Map<string, Intl.NumberFormat>();
/** Formata centavos INTEIROS. Nunca ponto flutuante em dinheiro (§79). */
export function formatCents(cents: number, currency: string): string {
  let f = FMT.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { style: 'currency', currency });
    FMT.set(currency, f);
  }
  return f.format(cents / 100);
}

/** O que escrever quando não se sabe. Nunca um número. */
export const MISSING_LABEL: Record<MissingReason, string> = {
  NOT_LINKED: 'Sem vínculo com Finanças',
  PENDING_CONFIGURATION: 'Pendente de configuração',
  AMOUNT_UNKNOWN: 'Não apurado',
  LEGACY_NO_PROVENANCE: 'Origem não registrada',
};

export function displayText(value: Displayable): string {
  return value.known ? formatCents(value.cents, value.currency) : MISSING_LABEL[value.reason];
}
