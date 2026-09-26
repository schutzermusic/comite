/**
 * A COMPRA DIANTE DA COBERTURA PENDENTE (regra 246) — o que as telas do
 * Supply (Dashboard e Planejamento de Materiais) podem OFERECER, pelos
 * números do banco (`supply_requirement_coverage`):
 *
 *   comprável   = `purchasable_qty` — o que `purchase_requisition_from_shortage`
 *                 requisita por padrão (falta − requisitado − pendente, nunca < 0)
 *   pendente    = `pending_transfer_qty` — transferência pedida/aprovada sem
 *                 reserva na origem: NÃO é cobertura (a falta continua) e NÃO é
 *                 comprada de novo sem exceção governada
 *   com exceção = falta − requisitado — o que o banco requisita com
 *                 `coverage_override` (compra também a parte pendente, declarada
 *                 e registrada em `procurement_coverage_exceptions`)
 *   sobreposto  = a parte pendente que TAMBÉM está requisitada (`pendingOverlap`):
 *                 depois da exceção, ela JÁ foi comprada — se a transferência
 *                 também for despachada, o material chega em dobro
 *
 * A tela nunca refaz a conta do comprável: ela lê o número do banco e decide
 * só o que mostrar e qual caminho oferecer. Sem o número (leitura antiga ou
 * incompleta), nada é oferecido — o que não veio não vira número.
 */

import { pendingOverlap } from '@/lib/supply/coverage';

/** Mínimo da justificativa da exceção — o mesmo do banco (`Coverage exception requires a reason of at least 20 characters.`). */
export const COVERAGE_EXCEPTION_MIN_REASON = 20;
/** Máximo aceito pela rota (`requisitionSchema.coverageOverride.reason`). */
export const COVERAGE_EXCEPTION_MAX_REASON = 1000;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export interface GateFigures {
  shortage: number;
  requested: number;
  /** `pending_transfer_qty`; ausente = 0 (não há o que dizer). */
  pendingTransfer?: number | null;
  /** `purchasable_qty`; ausente = não veio (nada é oferecido). */
  purchasable?: number | null;
}

export interface GateCaps {
  /** `procurement.request` — requisitar a compra. */
  request: boolean;
  /** `procurement.coverage_override` — pedir a exceção de cobertura. */
  coverageOverride?: boolean;
}

export interface PurchaseGate {
  /** O comprável do banco; `null` = não veio nesta leitura. */
  purchasable: number | null;
  /** A cobertura pendente (transferência pedida, sem despacho). */
  pending: number;
  /** O que a exceção requisitaria (falta − requisitado, com a parte pendente); `null` sem pendente ou sem falta aberta. */
  exceptionQty: number | null;
  /** Quanto da parte pendente a exceção compra A MAIS que o comprável (nunca mais que o pendente). */
  exceptionExtra: number | null;
  /**
   * Quanto da parte pendente JÁ está requisitado (`pendingOverlap`) — só a
   * exceção de cobertura chega aqui (ou dado legado): se a transferência também
   * for despachada, chega em dobro. 0 sem sobreposição ou sem a falta na leitura.
   */
  overlap: number;
  /** Comprável zero e o que falta está pedido em transferência: a compra espera o despacho ou o cancelamento. */
  blocked: boolean;
  /** Pode requisitar o comprável agora (permissão + banco > 0). */
  canBuy: boolean;
  /** Pode pedir a exceção de cobertura (as duas permissões + parte pendente a comprar). */
  canException: boolean;
}

export function purchaseGate(f: GateFigures | null | undefined, caps: GateCaps): PurchaseGate {
  if (!f) return { purchasable: null, pending: 0, exceptionQty: null, exceptionExtra: null, overlap: 0, blocked: false, canBuy: false, canException: false };
  const purchasable = finite(f.purchasable) ? Math.max(0, f.purchasable) : null;
  const pending = finite(f.pendingTransfer) && f.pendingTransfer > 0 ? f.pendingTransfer : 0;
  const requested = finite(f.requested) ? Math.max(0, f.requested) : 0;
  // O que a exceção pede é o que o banco requisita com ela: a falta sem o que já está requisitado.
  const open = finite(f.shortage) ? Math.max(0, f.shortage - requested) : null;
  const exceptionQty = pending > 0 && open !== null && open > (purchasable ?? 0) ? open : null;
  return {
    purchasable,
    pending,
    exceptionQty,
    exceptionExtra: exceptionQty !== null ? Math.min(pending, exceptionQty - (purchasable ?? 0)) : null,
    // Sem a falta na leitura, nada é dito como sobreposto (o que não veio não vira número).
    overlap: open !== null && pending > 0 ? pendingOverlap({ shortage: f.shortage, requested, pendingTransfer: pending }) : 0,
    blocked: purchasable === 0 && exceptionQty !== null,
    canBuy: caps.request && purchasable !== null && purchasable > 0,
    // A rota exige `procurement.request` antes da exceção: sem as duas, o caminho não é oferecido.
    canException: caps.request && caps.coverageOverride === true && purchasable !== null && exceptionQty !== null,
  };
}

/**
 * A transferência pedida DEPOIS da exceção de cobertura (`overlap` > 0): a
 * parte sobreposta JÁ foi comprada — "não é comprada de novo" seria falso. O
 * texto diz quanto, que chega em dobro se a transferência também for
 * despachada, e o caminho: cancelá-la no Estoque. `null` sem sobreposição
 * (vale o texto de sempre: não é cobertura, nem é comprada de novo).
 */
export function pendingOverlapText(gate: Pick<PurchaseGate, 'pending' | 'overlap'>, fmt: (n: number) => string | null): string | null {
  if (!(gate.overlap > 0)) return null;
  const q = fmt(gate.overlap) ?? '—';
  const all = gate.overlap >= gate.pending;
  return `Ainda não saiu da origem — e ${all ? `já foi comprada: os ${q} entraram` : `${q} dela já foram comprados: entraram`} numa solicitação de compra`
    + ` por exceção de cobertura. Se a transferência também for despachada, ${all ? 'o material chega' : `esses ${q} chegam`} em dobro;`
    + ' se ela não vai acontecer, cancele-a no Estoque em “Resolver a transferência”.';
}

/** A justificativa da exceção: conta sem os espaços das pontas (como o banco), com o contador. */
export function exceptionReasonState(reason: string): { ok: boolean; length: number; missing: number; counter: string; hint: string | null } {
  const length = reason.trim().length;
  const missing = Math.max(0, COVERAGE_EXCEPTION_MIN_REASON - length);
  return {
    ok: missing === 0,
    length,
    missing,
    counter: `${length}/${COVERAGE_EXCEPTION_MIN_REASON}`,
    hint: missing === 0 ? null
      : `Escreva por que comprar também o que já está pedido em transferência — faltam ${missing} ${missing === 1 ? 'caractere' : 'caracteres'}.`,
  };
}

/** O campo da exceção no corpo de POST /api/supply/procurement/requisitions. */
export function coverageOverrideBody(reason: string): { coverageOverride: { reason: string } } {
  return { coverageOverride: { reason: reason.trim() } };
}

/**
 * O que o banco devolveu ao requisitar (`purchase_requisition_from_shortage`):
 * número, quantidade requisitada, se foi com exceção e se era repetição.
 */
export function requisitionOutcome(result: Record<string, unknown> | null | undefined): {
  number: string | null; qty: number | null; override: boolean; replayed: boolean;
} {
  const r = result ?? {};
  const raw = r.requisitioned_qty;
  const qty = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return {
    number: typeof r.requisition_number === 'string' && r.requisition_number ? r.requisition_number : null,
    qty: Number.isFinite(qty) ? qty : null,
    override: r.override === true,
    replayed: r.replayed === true,
  };
}

/**
 * O aviso de uma requisição pedida COM a exceção de cobertura, pelo que o
 * BANCO devolveu (`requisitionOutcome`) — nunca pelo que foi pedido: sem
 * transferência pendente no instante da gravação, ele requisita só o
 * comprável e NÃO registra exceção, e o aviso diz isso (com a quantidade
 * requisitada de fato).
 */
export function exceptionOutcomeNotice(result: Record<string, unknown> | null | undefined, fmt: (n: number) => string | null): {
  title: string; detail: string; override: boolean;
} {
  const out = requisitionOutcome(result);
  const what = [out.number, out.qty !== null ? fmt(out.qty) : null].filter(Boolean).join(' · ');
  const title = out.override ? 'Compra requisitada com exceção de cobertura' : 'Compra requisitada sem exceção de cobertura';
  if (out.replayed) return { title, detail: `Já estava registrado${what ? ` (${what})` : ''} — nada foi duplicado.`, override: out.override };
  return {
    title,
    detail: out.override
      ? `${what ? `${what}: a` : 'A'} exceção ficou registrada; a requisição segue para cotação em Compras.`
      : `A transferência já não estava pendente (despachada ou cancelada nesse meio-tempo): o banco requisitou só o comprável${what ? ` (${what})` : ''}`
        + ' e nenhuma exceção foi registrada. A requisição segue para cotação em Compras.',
    override: out.override,
  };
}
