/**
 * PRECEDÊNCIA DO VALOR MEDIDO — o invariante permanente da Fase 6.
 *
 * ─── A regra, e ela não tem exceção ────────────────────────────────────────
 *
 *   1. medição canônica ACEITA  (project_measurements.accepted_value)
 *   2. contract_milestones.measured_amount  (legado, compatibilidade de leitura)
 *   3. UNKNOWN
 *
 * E NUNCA:
 *
 *   → billing_amount
 *
 * ─── Por que isto é um arquivo, e não uma linha ────────────────────────────
 *
 * Porque a regra já foi quebrada uma vez. Antes da Fase 6, o painel
 * Contract-to-Cash somava `m.measured_amount ?? m.billing_amount` e chamava o
 * resultado de "medido". `billing_amount` é o valor PREVISTO no contrato: um
 * marco que ninguém mediu contribuía com o previsto dele, e o painel
 * apresentava previsão como apuração. A diferença aparece na hora errada — na
 * conversa com o cliente sobre quanto já foi medido.
 *
 * Ter a regra num módulo com nome próprio dá ao teste de regressão um lugar
 * para apontar, e dá a quem lê o painel um lugar para conferir.
 *
 * ─── UNKNOWN não é zero ────────────────────────────────────────────────────
 *
 * Quando não há medição aceita nem valor legado, a resposta é UNKNOWN, e não
 * R$ 0. Zero afirma que a medição ocorreu e deu zero; UNKNOWN afirma que não
 * se sabe. Só a segunda é verdade.
 *
 * Puro: sem Supabase, sem React.
 */

/** De onde o número veio. A procedência acompanha o valor, sempre. */
export type MeasuredAmountSource =
  | 'canonical_accepted'
  | 'legacy_measured_amount'
  | 'UNKNOWN';

export type MeasuredAmountReason =
  | 'NO_MEASUREMENT'
  | 'AGGREGATION_SEMANTICS_UNKNOWN'
  | 'MILESTONE_NOT_FOUND';

export interface MeasuredAmount {
  /** `null` sempre que a fonte é UNKNOWN. Nunca 0 por ausência. */
  readonly amount: number | null;
  readonly currency: string | null;
  readonly source: MeasuredAmountSource;
  readonly reason: MeasuredAmountReason | null;
  /** Quantas medições canônicas aceitas sustentam o número. */
  readonly acceptedCount: number;
  /**
   * Diagnóstico, não valor: registra que o marco TEM `billing_amount` e que
   * ele foi ignorado. Serve para a tela poder dizer "há previsto, não há
   * medido" em vez de esconder a distinção.
   */
  readonly billingAmountPresentAndIgnored: boolean;
}

/**
 * Como várias medições aceitas somam num marco (§71 do plano).
 *
 * `UNKNOWN` e `MIXED` não somam. Não é cautela decorativa: somar parcelas
 * cumulativas como se fossem incrementais conta a mesma medição várias vezes,
 * e o erro cresce a cada mês em vez de aparecer de uma vez.
 */
export type AggregationMode =
  | 'SUM_INCREMENTAL'
  | 'LATEST_CUMULATIVE'
  | 'FIXED_MILESTONE'
  | 'PERCENTAGE'
  | 'UNKNOWN';

/**
 * `number | string` porque `numeric` do Postgres chega como string pelo driver
 * — e converter na borda de cada chamador seria convidar um `Number(null)` a
 * virar 0 em algum deles.
 */
export type NumericLike = number | string | null | undefined;

export interface AcceptedMeasurementInput {
  readonly acceptedValue: NumericLike;
  readonly acceptedCurrency: string | null;
  readonly acceptedAt: string | null;
  readonly aggregationMode: AggregationMode;
}

export interface MeasuredAmountInput {
  /** Medições canônicas ACEITAS do marco. Vazio é o caso normal hoje. */
  readonly accepted: readonly AcceptedMeasurementInput[];
  /** `contract_milestones.measured_amount`. */
  readonly legacyMeasuredAmount: NumericLike;
  /**
   * `contract_milestones.billing_amount`. Entra APENAS para que o resultado
   * possa registrar que existe e não foi usado. Nenhum caminho abaixo o lê
   * como valor — e o teste de regressão prova isso passando um número
   * absurdo aqui e exigindo que ele nunca apareça na saída.
   */
  readonly billingAmount: NumericLike;
}

const num = (v: NumericLike): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

export function resolveMeasuredAmount(input: MeasuredAmountInput): MeasuredAmount {
  const billingPresent = num(input.billingAmount) !== null;
  const accepted = input.accepted;

  // ---------- 1) medição canônica aceita ----------
  if (accepted.length > 0) {
    const modes = new Set(accepted.map((a) => a.aggregationMode));
    const mode: AggregationMode | 'MIXED' = modes.size === 1 ? [...modes][0] : 'MIXED';
    const currency = accepted.find((a) => a.acceptedCurrency)?.acceptedCurrency ?? null;

    if (mode === 'SUM_INCREMENTAL') {
      const total = accepted.reduce((sum, a) => sum + (num(a.acceptedValue) ?? 0), 0);
      return {
        amount: total, currency, source: 'canonical_accepted', reason: null,
        acceptedCount: accepted.length, billingAmountPresentAndIgnored: billingPresent,
      };
    }

    if (mode === 'LATEST_CUMULATIVE' || mode === 'FIXED_MILESTONE') {
      // Cumulativo NÃO soma: o último aceite já traz o total acumulado.
      const latest = [...accepted].sort((a, b) =>
        String(b.acceptedAt ?? '').localeCompare(String(a.acceptedAt ?? '')))[0];
      return {
        amount: num(latest.acceptedValue), currency: latest.acceptedCurrency ?? currency,
        source: 'canonical_accepted', reason: null,
        acceptedCount: accepted.length, billingAmountPresentAndIgnored: billingPresent,
      };
    }

    /*
      PERCENTAGE, UNKNOWN ou MIXED. Existe medição aceita, mas o VALOR agregado
      não é afirmável — e dizer isso é mais útil que somar às cegas. A tela
      mostra que há medição e que o total depende de semântica que o contrato
      ainda não declarou.
    */
    return {
      amount: null, currency, source: 'UNKNOWN', reason: 'AGGREGATION_SEMANTICS_UNKNOWN',
      acceptedCount: accepted.length, billingAmountPresentAndIgnored: billingPresent,
    };
  }

  // ---------- 2) legado ----------
  const legacy = num(input.legacyMeasuredAmount);
  if (legacy !== null) {
    return {
      amount: legacy, currency: null, source: 'legacy_measured_amount', reason: null,
      acceptedCount: 0, billingAmountPresentAndIgnored: billingPresent,
    };
  }

  // ---------- 3) UNKNOWN ----------
  // Fim da linha. `billingAmount` continua sendo o previsto, e previsto não é
  // apurado — a variável está em escopo e permanece não lida como valor.
  return {
    amount: null, currency: null, source: 'UNKNOWN', reason: 'NO_MEASUREMENT',
    acceptedCount: 0, billingAmountPresentAndIgnored: billingPresent,
  };
}

/** Rótulo curto da procedência, para a tela poder exibi-la junto do número. */
export const MEASURED_AMOUNT_SOURCE_LABEL: Record<MeasuredAmountSource, string> = {
  canonical_accepted: 'medição aceita',
  legacy_measured_amount: 'valor apurado no marco (legado)',
  UNKNOWN: 'não apurado',
};
