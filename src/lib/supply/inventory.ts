/**
 * ESTOQUE — regras de leitura em código puro (233).
 *
 * O banco decide (livro, travas, reservas); aqui só se DIZ o que o banco já
 * sabe: nomes dos estados, qual é o próximo ato de uma transferência, quais
 * situações pedem alguém, e onde há saldo que poderia cobrir uma falta.
 */
import type { StockAtLocation } from './coverage';

export type LocationKind = 'WAREHOUSE' | 'PROJECT_SITE' | 'VEHICLE' | 'QUARANTINE' | 'ZONE' | 'BIN';
export const LOCATION_KIND_LABEL: Record<LocationKind, string> = {
  WAREHOUSE: 'Almoxarifado', PROJECT_SITE: 'Canteiro de obra', VEHICLE: 'Veículo', QUARANTINE: 'Quarentena / inspeção',
  ZONE: 'Zona', BIN: 'Posição',
};

export type MovementType = 'RECEIPT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ISSUE_TO_PROJECT' | 'RETURN_FROM_PROJECT'
  | 'ADJUSTMENT' | 'COUNT_CORRECTION';
export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  RECEIPT: 'Recebimento', TRANSFER_OUT: 'Saída por transferência', TRANSFER_IN: 'Entrada por transferência',
  ISSUE_TO_PROJECT: 'Entrega à obra', RETURN_FROM_PROJECT: 'Devolução da obra', ADJUSTMENT: 'Ajuste',
  COUNT_CORRECTION: 'Correção de contagem',
};

export type ReservationStatus = 'ACTIVE' | 'RELEASED' | 'CONSUMED';
export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  ACTIVE: 'Ativa', RELEASED: 'Liberada', CONSUMED: 'Consumida',
};

export type TransferStatus = 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  REQUESTED: 'Solicitada', APPROVED: 'Aprovada', IN_TRANSIT: 'Em trânsito', PARTIALLY_RECEIVED: 'Recebida em parte',
  RECEIVED: 'Recebida', CLOSED: 'Encerrada', CANCELLED: 'Cancelada',
};
export const TRANSFER_STATUS_TONE: Record<TransferStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent'> = {
  REQUESTED: 'warning', APPROVED: 'info', IN_TRANSIT: 'accent', PARTIALLY_RECEIVED: 'warning', RECEIVED: 'success',
  CLOSED: 'neutral', CANCELLED: 'neutral',
};

export type TransferAction = 'approve' | 'dispatch' | 'receive' | 'close' | 'cancel';
export const TRANSFER_ACTION_LABEL: Record<TransferAction, string> = {
  approve: 'Aprovar', dispatch: 'Despachar', receive: 'Registrar recebimento', close: 'Encerrar', cancel: 'Cancelar',
};

/** Os atos possíveis a partir do estado — o banco recusa o resto; a tela nem oferece. */
export function transferActions(status: TransferStatus, caps: { manage: boolean; receive: boolean }): TransferAction[] {
  const out: TransferAction[] = [];
  if (status === 'REQUESTED' && caps.manage) out.push('approve', 'cancel');
  if (status === 'APPROVED' && caps.manage) out.push('dispatch', 'cancel');
  if ((status === 'IN_TRANSIT' || status === 'PARTIALLY_RECEIVED') && (caps.manage || caps.receive)) out.push('receive');
  if ((status === 'IN_TRANSIT' || status === 'PARTIALLY_RECEIVED' || status === 'RECEIVED') && caps.manage) out.push('close');
  return out;
}

export interface PositionRow {
  itemId: string; itemCode: string; itemDescription: string; unit: string; tracking: string;
  locationId: string; locationCode: string; locationName: string; locationKind: LocationKind;
  onHand: number; reserved: number; available: number; inspection: number; inboundTransit: number;
  lastMovementAt: string | null;
}

/**
 * Onde há saldo LIVRE do item para cobrir uma falta. Destino é o canteiro do
 * próprio projeto; se o projeto não tem canteiro cadastrado, reservar no
 * almoxarifado já é o caminho (não há para onde transferir) — então todo
 * local conta como destino.
 */
export function stockForRequirement(
  position: PositionRow[], itemId: string, projectSiteIds: string[],
  /** 246: saldo já prometido a transferências pedidas/aprovadas, por `item:local` (`promisedByOrigin`). */
  promised?: ReadonlyMap<string, number>,
): StockAtLocation[] {
  const noSite = projectSiteIds.length === 0;
  return position
    .filter((p) => p.itemId === itemId && p.available > 0 && p.locationKind !== 'QUARANTINE')
    .map((p) => {
      const out = Math.max(0, promised?.get(`${p.itemId}:${p.locationId}`) ?? 0);
      return { locationId: p.locationId, locationName: p.locationName, available: Math.max(0, p.available - out),
        isDestination: noSite || projectSiteIds.includes(p.locationId), ...(out > 0 ? { promised: out } : {}) };
    })
    .filter((s) => s.available > 0)
    .sort((a, b) => Number(b.isDestination) - Number(a.isDestination) || b.available - a.available);
}

/* ── Transferência PEDIDA (regra 246) ────────────────────────────────────── */

/** Pedida ou aprovada e ainda não despachada: nada saiu da origem e o banco não segura o saldo. */
export const PENDING_TRANSFER_STATUSES: readonly TransferStatus[] = ['REQUESTED', 'APPROVED'];

export interface PendingTransferLineRow {
  transfer_id: string; item_id?: string | null; requirement_id?: string | null; quantity: unknown; source_reservation_id?: string | null;
}
export interface PendingTransferHeadRow { id: string; transfer_number: string | null; status: string; from_location_id?: string | null }

/** A transferência pendente de um requisito, pronta para "resolver a transferência" (link para ela no Estoque). */
export interface PendingTransferRef { transferId: string; number: string | null; status: string; statusLabel: string; qty: number; href: string }

const qtyOf = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/**
 * As linhas que a regra 246 conta como PENDENTE (`pending_transfer_qty`):
 * transferência pedida/aprovada, linha com quantidade e SEM reserva na origem
 * (a que move reserva já está em "reservado"). Junta cabeçalho e linha.
 */
export function pendingTransferLines<L extends PendingTransferLineRow, T extends PendingTransferHeadRow>(
  lines: readonly L[], transfers: readonly T[],
): Array<{ line: L; transfer: T; qty: number }> {
  const byId = new Map(transfers.map((t) => [t.id, t]));
  return lines.flatMap((l) => {
    const t = byId.get(l.transfer_id);
    const qty = qtyOf(l.quantity);
    return t && (PENDING_TRANSFER_STATUSES as readonly string[]).includes(t.status) && qty > 0 && !l.source_reservation_id
      ? [{ line: l, transfer: t, qty }] : [];
  });
}

/**
 * As transferências pendentes de CADA requisito, somadas por transferência
 * (número, estado e o link para ela no Estoque), na ordem do número.
 */
export function pendingTransferRefsByRequirement(
  lines: readonly PendingTransferLineRow[], transfers: readonly PendingTransferHeadRow[],
): Map<string, PendingTransferRef[]> {
  const byReq = new Map<string, Map<string, PendingTransferRef>>();
  for (const { line, transfer, qty } of pendingTransferLines(lines, transfers)) {
    if (!line.requirement_id) continue;
    const refs = byReq.get(line.requirement_id) ?? new Map<string, PendingTransferRef>();
    byReq.set(line.requirement_id, refs);
    const cur = refs.get(transfer.id);
    if (cur) { cur.qty += qty; continue; }
    refs.set(transfer.id, { transferId: transfer.id, number: transfer.transfer_number ?? null, status: transfer.status,
      statusLabel: TRANSFER_STATUS_LABEL[transfer.status as TransferStatus] ?? 'Transferência', qty,
      href: `/supply/estoque?view=transferencias&transfer=${encodeURIComponent(transfer.id)}` });
  }
  return new Map([...byReq].map(([id, refs]) => [id,
    [...refs.values()].sort((a, b) => String(a.number ?? '').localeCompare(String(b.number ?? '')))]));
}

/** As transferências pendentes de UM requisito (`pendingTransferRefsByRequirement`). */
export function pendingTransferRefs(
  lines: readonly PendingTransferLineRow[], transfers: readonly PendingTransferHeadRow[], requirementId: string,
): PendingTransferRef[] {
  return pendingTransferRefsByRequirement(lines, transfers).get(requirementId) ?? [];
}

/** O saldo que transferências pendentes vão tirar de cada origem, por `item:local` — não é oferecido de novo. */
export function promisedByOrigin(lines: readonly PendingTransferLineRow[], transfers: readonly PendingTransferHeadRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const { line, transfer, qty } of pendingTransferLines(lines, transfers)) {
    if (!line.item_id || !transfer.from_location_id) continue;
    const k = `${line.item_id}:${transfer.from_location_id}`;
    out.set(k, (out.get(k) ?? 0) + qty);
  }
  return out;
}

export type InventoryExceptionKind =
  | 'RESERVED_ABOVE_ON_HAND' | 'RESERVATION_WITHOUT_DEMAND' | 'RESERVATION_ABOVE_NEED' | 'TRANSFER_OVERDUE' | 'COUNT_OPEN_LONG';
export const INVENTORY_EXCEPTION_LABEL: Record<InventoryExceptionKind, string> = {
  RESERVED_ABOVE_ON_HAND: 'Reservado acima do físico',
  RESERVATION_WITHOUT_DEMAND: 'Reserva sem demanda viva',
  RESERVATION_ABOVE_NEED: 'Reserva acima da necessidade',
  TRANSFER_OVERDUE: 'Transferência atrasada',
  COUNT_OPEN_LONG: 'Contagem aberta há mais de 7 dias',
};

export interface InventoryException { kind: InventoryExceptionKind; ref: string; title: string; detail: string }

/**
 * Situações que o livro permite (porque são fatos) mas que pedem uma pessoa:
 *  - contagem mostrou menos do que estava reservado;
 *  - o requisito foi cancelado/substituído e a reserva continua segurando saldo;
 *  - o requisito diminuiu e a reserva ficou maior que a necessidade;
 *  - transferência passou da chegada prevista;
 *  - contagem esquecida aberta.
 * Nada é liberado sozinho: liberar é ato com motivo.
 */
export function inventoryExceptions(input: {
  today: string;
  position: PositionRow[];
  reservations: Array<{ id: string; status: string; open: number; requirementId: string; requirementStatus: string | null;
    requirementQuantity: number | null; committedToRequirement: number; project: string; itemCode: string }>;
  transfers: Array<{ id: string; number: string; status: TransferStatus; expectedArrival: string | null }>;
  counts: Array<{ id: string; status: string; openedAt: string; locationName: string }>;
}): InventoryException[] {
  const out: InventoryException[] = [];
  for (const p of input.position) {
    if (p.locationKind !== 'QUARANTINE' && p.reserved > p.onHand) {
      out.push({ kind: 'RESERVED_ABOVE_ON_HAND', ref: `${p.itemId}:${p.locationId}`, title: `${p.itemCode} em ${p.locationName}`,
        detail: `${p.reserved} reservado(s), ${p.onHand} em mão — libere ou reponha.` });
    }
  }
  const seenReq = new Set<string>();
  for (const r of input.reservations) {
    if (r.status !== 'ACTIVE') continue;
    if (r.requirementStatus && r.requirementStatus !== 'CONFIRMED') {
      out.push({ kind: 'RESERVATION_WITHOUT_DEMAND', ref: r.id, title: `${r.itemCode} · ${r.project}`,
        detail: `O requisito está ${r.requirementStatus === 'CANCELLED' ? 'cancelado' : r.requirementStatus === 'SUPERSEDED' ? 'substituído' : 'não confirmado'} e a reserva ainda segura ${r.open}.` });
    } else if (r.requirementQuantity !== null && r.committedToRequirement > r.requirementQuantity && !seenReq.has(r.requirementId)) {
      seenReq.add(r.requirementId);
      out.push({ kind: 'RESERVATION_ABOVE_NEED', ref: r.requirementId, title: `${r.itemCode} · ${r.project}`,
        detail: `${r.committedToRequirement} comprometido(s) para ${r.requirementQuantity} requerido(s).` });
    }
  }
  for (const t of input.transfers) {
    if ((t.status === 'IN_TRANSIT' || t.status === 'PARTIALLY_RECEIVED') && t.expectedArrival && t.expectedArrival < input.today) {
      out.push({ kind: 'TRANSFER_OVERDUE', ref: t.id, title: t.number, detail: `Chegada prevista em ${t.expectedArrival}.` });
    }
  }
  const weekAgo = new Date(`${input.today}T12:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);
  for (const c of input.counts) {
    if (c.status === 'OPEN' && new Date(c.openedAt) < weekAgo) {
      out.push({ kind: 'COUNT_OPEN_LONG', ref: c.id, title: c.locationName, detail: 'Poste ou cancele a contagem: ela trava a leitura do local.' });
    }
  }
  return out;
}

/** Tradução das recusas do banco de estoque para quem opera. */
const INVENTORY_ERRORS: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/Not enough available stock at ([^:]+): ([\d.]+) available, ([\d.]+) requested/, (m) => `Disponível insuficiente em ${m[1]}: ${Number(m[2])} livre(s), ${Number(m[3])} pedido(s).`],
  [/reserved for other demand/, () => 'Esse saldo está reservado para outra demanda — não pode sair.'],
  [/Insufficient stock of (\S+) at (\S+)/, (m) => `Estoque insuficiente de ${m[1]} em ${m[2]}: o físico ficaria negativo.`],
  // 246: a trava conta também as solicitações de compra abertas (`supply_requirement_claimed`).
  [/over-cover the requirement/, () => 'O requisito já está coberto por estoque, transferências ou solicitações de compra — '
    + 'para trocar uma compra por estoque, cancele antes a solicitação em Compras.'],
  [/Only a confirmed MATERIAL requirement/, () => 'Só requisito de material confirmado, com item, recebe reserva.'],
  [/not reservable/, () => 'Material em quarentena/inspeção ou em local inativo não é reservável.'],
  [/lot\/serial is required/, () => 'Este item é rastreado: informe o lote ou número de série.'],
  [/one serial per line/, () => 'Item por série move uma unidade por linha.'],
  [/Serial (\S+) of (\S+) is already in stock/, (m) => `A série ${m[1]} de ${m[2]} já está em estoque.`],
  [/requires a reason/, () => 'Informe o motivo — este ato fica no histórico.'],
  [/within the open reservation \(([\d.]+) open\)/, (m) => `Entrega acima do reservado em aberto (${Number(m[1])}).`],
  [/within what was issued \(([\d.]+)\)/, (m) => `Devolução acima do que foi entregue (${Number(m[1])}).`],
  [/not exceed what was dispatched \(([\d.]+) pending\)/, (m) => `Recebimento acima do despachado (${Number(m[1])} pendente(s)).`],
  [/Stock moved after the count began for: (.+)\. Recount/, (m) => `O estoque de ${m[1]} se moveu durante a contagem — reconte.`],
  [/only an approved transfer is dispatched/, () => 'A transferência precisa estar aprovada para ser despachada.'],
  [/only a requested transfer is approved/, () => 'Só transferência solicitada é aprovada.'],
  [/not cancelled/, () => 'Depois do despacho a transferência é recebida ou encerrada, não cancelada.'],
  [/Source reservation/, () => 'A reserva de origem precisa estar ativa, no local de origem e cobrir a linha.'],
  [/All requirement lines of a transfer/, () => 'Todas as linhas de requisito devem ser do mesmo projeto da transferência.'],
  [/Transfer line must carry the item/, () => 'A linha precisa ser do item do requisito confirmado.'],
  [/Location hierarchy cannot loop/, () => 'A hierarquia de locais não pode formar ciclo.'],
  [/still holds stock/, () => 'O local ainda tem estoque: movimente antes de desativar.'],
  [/has stock history: its kind/, () => 'Local com histórico não muda de tipo.'],
  [/invloc_code_unique/, () => 'Já existe um local com este código.'],
  [/invloc_site_has_project/, () => 'Canteiro de obra precisa do projeto.'],
  [/invcnt_one_open_per_location/, () => 'Já existe uma contagem aberta neste local.'],
  [/Idempotency key reused/, () => 'Esta operação já foi registrada com outros dados.'],
  [/Actor lacks permission/, () => 'Sua alçada não permite este ato de estoque.'],
  [/is inactive: stock does not enter it|Destination .* is inactive/, () => 'Local inativo não recebe estoque.'],
];

/**
 * Recusas de COMPRAS que contêm palavras das regras de estoque acima (ex.:
 * "Coverage exception requires a reason…" casaria `/requires a reason/`). A
 * rota tenta estoque antes de compras (`inventoryFailure`): estas ficam para
 * `procurementErrorMessage`, que as traduz com o sentido certo. "Purchase
 * order has receipts: it is closed, not cancelled." casaria `/not cancelled/`
 * e viraria a frase da transferência despachada (248).
 */
const PROCUREMENT_OWNED = /Coverage exception|covered by pending internal transfer|Purchase order has receipts|Quote line quantity|Quoted quantity|can no longer be quoted|already decided on another quote|its requisition covers only/;

export function inventoryErrorMessage(message: string): string | null {
  if (PROCUREMENT_OWNED.test(message)) return null;
  for (const [re, fmt] of INVENTORY_ERRORS) {
    const m = message.match(re);
    if (m) return fmt(m);
  }
  return null;
}
