/**
 * A CURVA ACUMULADA de faturamento da carteira.
 *
 * ─── Uma série, e não cinco ────────────────────────────────────────────────
 *
 * A tentação é desenhar os cinco estágios da cadeia ao longo do tempo. Não dá
 * — e forçar produziria exatamente o tipo de número que este módulo existe
 * para não produzir:
 *
 *   · CONTRATADO não tem data de competência. Tem data de assinatura, que não
 *     é quando o valor "aconteceu". Ratear a assinatura pelos meses seria um
 *     critério inventado aqui, não uma verdade do contrato. Ele entra como
 *     LINHA DE REFERÊNCIA horizontal, que é o que de fato é: um teto.
 *   · MEDIDO e APROVADO vivem na bancada de marcos, e as datas que existem lá
 *     só existem para os marcos que chegaram até elas. Uma curva sobre um
 *     subconjunto que muda de tamanho a cada mês não é uma curva do portfólio.
 *   · RECEBIDO não é afirmável por este módulo. `contract-to-cash.ts` declara
 *     o estágio `not-integrated` de forma categórica: o razão financeiro não
 *     está conciliado com os eventos de faturamento.
 *
 * ─── Por que `paid_at` NÃO vira uma série de caixa ─────────────────────────
 *
 * A primeira versão deste arquivo derivava "recebido" de
 * `contract_billing_events.paid_at`, e a tela passou a mostrar duas afirmações
 * contraditórias lado a lado: a curva dizia "recebido R$ 143 mil" e a cadeia,
 * logo abaixo, dizia "não integrado". Uma das duas tinha de estar errada, e
 * era a curva.
 *
 * `paid_at` é um carimbo do próprio módulo de Contratos sobre o evento — é
 * evidência de que o evento foi FATURADO (é assim que `isBilled` o usa), não
 * de que o dinheiro entrou na conta da empresa. Afirmar caixa a partir dele
 * seria o módulo se autocertificando sobre um fato que pertence a Finanças.
 * Recebimento volta a esta curva quando houver conciliação com o razão — e não
 * antes.
 *
 * ─── Quando a curva não aparece ────────────────────────────────────────────
 *
 * Menos de dois meses com evento datado devolve `points: null`. Uma curva de um
 * ponto não é uma curva, e uma linha subindo do zero até o único mês com dado
 * afirmaria que antes dele o faturamento era zero — quando o que se sabe é que
 * não há registro.
 *
 * Lógica pura, sem JSX, sem I/O.
 */

import { hasOfficialValue, isError } from '../trust/trusted';
import { isBilled } from '../trust/contract-to-cash';
import type { TrustedContract } from '../trust/read-model';
import type { ContractBillingEventRow } from '../contract-service';

export type CashTimelinePoint = {
  /** `YYYY-MM`, a chave de ordenação. */
  readonly month: string;
  /** Rótulo curto pt-BR, ex.: "set/25". */
  readonly label: string;
  /** Σ acumulado dos eventos faturados até o fim do mês. */
  readonly billed: number;
  readonly billedCount: number;
};

export type CashTimeline = {
  /** `null` quando não há histórico suficiente para uma curva honesta. */
  readonly points: readonly CashTimelinePoint[] | null;
  /** Por que não há curva, quando não há. */
  readonly absentReason: 'no-dated-events' | 'single-month' | 'read-error' | null;
  /** Teto de referência: o valor contratado da carteira, quando apurado. */
  readonly contractedCeiling: number | null;
  /** Eventos faturados sem data utilizável — ficam fora da curva, e é dito. */
  readonly undatedBilledCount: number;
  readonly coverage: { readonly counted: number; readonly total: number };
};

const MONTH_FMT = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit' });

const monthKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const num = (v: number | string | null | undefined): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * A data em que o evento virou faturamento.
 *
 * `realized_at` é a afirmação explícita; `paid_at` serve de segunda opção
 * porque um evento carimbado como pago necessariamente foi faturado antes —
 * é a mesma leitura que `isBilled` faz, e só diz respeito ao FATURAMENTO.
 * `due_date` NÃO entra: vencimento é previsão, e usá-lo faria a curva de
 * realizado ser em parte um cronograma.
 */
function billedAt(event: ContractBillingEventRow): Date | null {
  return parseDate(event.realized_at) ?? parseDate(event.paid_at);
}

function realizedAmount(event: ContractBillingEventRow): number | null {
  return num(event.realized_amount) ?? num(event.amount);
}

export function buildCashTimeline(
  contracts: readonly TrustedContract[],
): CashTimeline {
  let readError = false;
  let counted = 0;
  const events: ContractBillingEventRow[] = [];

  for (const contract of contracts) {
    if (isError(contract.billingEvents)) { readError = true; continue; }
    if (!hasOfficialValue(contract.billingEvents)) continue;
    counted += 1;
    events.push(...contract.billingEvents.value);
  }

  const ceilingParts = contracts
    .map((c) => (hasOfficialValue(c.totalValue) ? c.totalValue.value : null))
    .filter((v): v is number => v !== null);
  const contractedCeiling = ceilingParts.length > 0
    ? ceilingParts.reduce((a, b) => a + b, 0)
    : null;

  const billedEvents = events.filter(isBilled);
  const dated = billedEvents
    .map((event) => ({ at: billedAt(event), amount: realizedAmount(event) }))
    .filter((e): e is { at: Date; amount: number } => e.at !== null && e.amount !== null);

  const base = {
    contractedCeiling,
    undatedBilledCount: billedEvents.length - dated.length,
    coverage: { counted, total: contracts.length },
  };

  if (readError && dated.length === 0) {
    return { ...base, points: null, absentReason: 'read-error' };
  }
  if (dated.length === 0) {
    return { ...base, points: null, absentReason: 'no-dated-events' };
  }

  // A janela vai do primeiro mês com evento ao mês corrente: buracos no meio
  // são meses sem movimento, e num acumulado isso é uma reta — o que é verdade.
  const first = dated.map((e) => monthKey(e.at)).sort()[0];
  const [fy, fm] = first.split('-').map(Number);
  const now = new Date();
  const months: { key: string; date: Date }[] = [];
  for (let d = new Date(fy, fm - 1, 1); d <= now; d.setMonth(d.getMonth() + 1)) {
    months.push({ key: monthKey(d), date: new Date(d) });
  }

  if (months.length < 2) {
    return { ...base, points: null, absentReason: 'single-month' };
  }

  let acc = 0;
  let count = 0;
  const points: CashTimelinePoint[] = months.map(({ key, date }) => {
    for (const e of dated) {
      if (monthKey(e.at) === key) { acc += e.amount; count += 1; }
    }
    return {
      month: key,
      label: MONTH_FMT.format(date).replace('.', ''),
      billed: acc,
      billedCount: count,
    };
  });

  return { ...base, points, absentReason: null };
}
