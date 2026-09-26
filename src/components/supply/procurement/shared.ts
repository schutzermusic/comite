import type { ProcurementWorkspaceModel } from '@/lib/supply/procurement-read';
import type { ReleaseCause, RequisitionRelease } from '@/lib/supply/procurement';

export type ProcurementModel = ProcurementWorkspaceModel & {
  viewerId: string;
  capabilities: { request: boolean; source: boolean; approve: boolean; issue: boolean; authorities: boolean; suppliers: boolean };
};

export const brlOf = (v: number, currency = 'BRL') => v.toLocaleString('pt-BR', { style: 'currency', currency });

/**
 * Número digitado em pt-BR ou não: com vírgula, a vírgula é o decimal e o
 * ponto é milhar ("1.234,5"); sem vírgula, o ponto é o decimal ("19.50").
 */
export function parseDecimal(input: string): number {
  const v = input.trim();
  if (!v) return Number.NaN;
  return Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
}

/* ── Liberações da requisição (248) ─────────────────────────────────────── */

/**
 * Quantidade EXATA, com a unidade: as quantidades da 248 — o em aberto, o
 * liberado, o reaberto, o que a cotação pede e o que ficou fora do pedido —
 * nunca arredondam. O `qty` corta em 3 casas e diria "60 m" e "0 m" onde o
 * banco gravou "59,99997 m" e "0,00003 m". Só o ruído do ponto flutuante some
 * (10 casas, como na nota de liberação do Dashboard). Sem número: "—".
 */
export function exactQty(value: unknown, unit?: string | null): string {
  const n = value === null || value === undefined || value === '' ? Number.NaN : Number(value);
  if (!Number.isFinite(n)) return '—';
  const s = n.toLocaleString('pt-BR', { maximumFractionDigits: 10 });
  return unit ? `${s} ${unit}` : s;
}

/** Por que a parte liberada não voltou a ser requisitada — dito junto da quantidade (na emissão, a nota já diz: não pedida). */
export const RELEASE_CAUSE_TEXT: Record<ReleaseCause, string | null> = {
  NOT_ORDERED: null, COVERED: 'o requisito já está coberto', REQUIREMENT_INACTIVE: 'o requisito não está mais ativo',
};

/**
 * O que foi LIBERADO de uma linha, em português: "40 m — não pedida no OC-…"
 * (a emissão pediu menos que a linha) ou "60 m — liberada no cancelamento do
 * OC-… (o requisito já está coberto)". Uma nota por pedido, etapa e causa: as
 * alocações da mesma linha (o mesmo item, a mesma unidade) somam, e a soma é
 * dita exata (`exactQty`). O liberado nunca volta a contar como requisitado.
 */
export function releaseNotes(releases: readonly RequisitionRelease[] | null | undefined, unit: string | null): Array<{ key: string; text: string }> {
  const sum = new Map<string, RequisitionRelease>();
  for (const r of releases ?? []) {
    if (!(Number.isFinite(r.quantity) && r.quantity > 0)) continue;
    const key = `${r.stage}|${r.cause}|${r.orderNumber ?? ''}`;
    const prev = sum.get(key);
    sum.set(key, prev ? { ...prev, quantity: prev.quantity + r.quantity } : r);
  }
  return Array.from(sum, ([key, r]) => {
    const order = r.orderNumber ?? 'pedido de compra';
    const why = r.stage === 'PO_CANCELLED' ? RELEASE_CAUSE_TEXT[r.cause] : null;
    const what = r.stage === 'PO_ISSUED' ? `não pedida no ${order}` : `liberada no cancelamento do ${order}`;
    return { key, text: `${exactQty(r.quantity, unit)} — ${what}${why ? ` (${why})` : ''}` };
  });
}

/* ── Decidir a compra: o que ficou FORA do pedido (248) ─────────────────── */

/** Por que a linha cotada não virou pedido: o estado da requisição dela (em busca, só com nada em aberto). */
const NOT_ORDERED_STATE: Record<string, string> = {
  CANCELLED: 'cancelada', CLOSED: 'encerrada', ORDERED: 'já com pedido emitido',
  SUBMITTED: 'sem nada em aberto', SOURCING: 'sem nada em aberto',
};

const joinPt = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0] ?? '');

/**
 * As linhas cotadas que a decisão NÃO pôs no pedido (`not_ordered` do banco,
 * 248), uma frase por requisição: "RC-… cancelada: a linha CABO-35-XLPE
 * (50 m) não entrou no pedido". `lineOf` diz o item e a quantidade cotada
 * (exata) da linha, quando a tela os conhece; sem ele, a requisição e o
 * porquê bastam. Resposta sem a lista (réplica; banco anterior a 248):
 * nenhuma frase — nunca "tudo entrou" inventado a partir do nada.
 */
export function notOrderedNotes(rows: unknown, lineOf: (requisitionLineId: string) => string | null = () => null): string[] {
  const byReq = new Map<string, { number: string; state: string; count: number; named: string[] }>();
  for (const x of Array.isArray(rows) ? rows : []) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const number = typeof r.requisition_number === 'string' && r.requisition_number ? r.requisition_number : 'Requisição';
    const state = NOT_ORDERED_STATE[String(r.requisition_status ?? '')] ?? 'fora de cotação';
    const key = `${number}|${state}`;
    const cur = byReq.get(key) ?? { number, state, count: 0, named: [] };
    cur.count += 1;
    const named = typeof r.requisition_line_id === 'string' && r.requisition_line_id ? lineOf(r.requisition_line_id) : null;
    if (named) cur.named.push(named);
    byReq.set(key, cur);
  }
  return Array.from(byReq.values(), (g) => {
    const named = g.named.length === g.count ? ` ${joinPt(g.named)}` : '';
    const what = g.count === 1 ? `a linha${named} não entrou no pedido`
      : named ? `as linhas${named} não entraram no pedido` : `as ${g.count} linhas não entraram no pedido`;
    return `${g.number} ${g.state}: ${what}`;
  });
}
