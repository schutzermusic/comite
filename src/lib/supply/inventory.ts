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
): StockAtLocation[] {
  const noSite = projectSiteIds.length === 0;
  return position
    .filter((p) => p.itemId === itemId && p.available > 0 && p.locationKind !== 'QUARANTINE')
    .map((p) => ({ locationId: p.locationId, locationName: p.locationName, available: p.available,
      isDestination: noSite || projectSiteIds.includes(p.locationId) }))
    .sort((a, b) => Number(b.isDestination) - Number(a.isDestination) || b.available - a.available);
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
  [/over-cover the requirement/, () => 'O requisito já está coberto por reservas, trânsito ou transferências pedidas.'],
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

export function inventoryErrorMessage(message: string): string | null {
  for (const [re, fmt] of INVENTORY_ERRORS) {
    const m = message.match(re);
    if (m) return fmt(m);
  }
  return null;
}
