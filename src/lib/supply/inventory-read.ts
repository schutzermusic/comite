/**
 * READ MODEL do Estoque — posição, reservas, movimentos, transferências e
 * contagens, lidos pelo cliente autenticado (RLS). Em mão, reservado e
 * disponível vêm da visão `inventory_position` (derivada do livro); nada é
 * somado aqui além do que a tela mostra.
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/inventory-read.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { projectIdentity } from '@/lib/operations/project-identity';
import {
  inventoryExceptions, type LocationKind, type MovementType, type PositionRow, type ReservationStatus, type TransferStatus,
} from './inventory';

type Session = { supabase: SupabaseClient; organizationId: string };
const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

export interface InventoryLocation {
  id: string; code: string; name: string; kind: LocationKind; parentId: string | null; projectId: string | null;
  project: string | null; addressLabel: string | null; latitude: number | null; longitude: number | null; active: boolean;
}

type ItemRow = { id: string; code: string; description: string; unit: string; tracking: string };
type LocRow = { id: string; code: string; name: string; kind: LocationKind; parent_id: string | null; project_id: string | null;
  address_label: string | null; latitude: number | null; longitude: number | null; active: boolean };

async function projectNames(sb: SupabaseClient, org: string, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const { data } = await sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', ids);
  return new Map(((data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2).name]));
}

export async function listLocations(session: Session): Promise<InventoryLocation[]> {
  const { data, error } = await session.supabase.from('inventory_locations')
    .select('id,code,name,kind,parent_id,project_id,address_label,latitude,longitude,active')
    .eq('organization_id', session.organizationId).order('code').limit(2000);
  if (error) throw new Error('Não foi possível ler os locais de estoque.');
  const rows = (data ?? []) as LocRow[];
  const names = await projectNames(session.supabase, session.organizationId,
    Array.from(new Set(rows.map((r) => r.project_id).filter(Boolean))) as string[]);
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, parentId: r.parent_id, projectId: r.project_id,
    project: r.project_id ? names.get(r.project_id) ?? r.project_id : null, addressLabel: r.address_label,
    latitude: r.latitude, longitude: r.longitude, active: r.active }));
}

/** Posição por item × local (só linhas com algo: em mão, reservado ou entrando). */
export async function inventoryPosition(session: Session, locations?: InventoryLocation[]): Promise<PositionRow[]> {
  const sb = session.supabase; const org = session.organizationId;
  const { data, error } = await sb.from('inventory_position')
    .select('item_id,location_id,location_kind,on_hand_qty,reserved_qty,available_qty,inspection_qty,inbound_transit_qty,last_movement_at')
    .eq('organization_id', org).limit(10000);
  if (error) throw new Error('Não foi possível ler a posição de estoque.');
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const itemIds = Array.from(new Set(rows.map((r) => String(r.item_id))));
  const [items, locs] = await Promise.all([
    itemIds.length ? sb.from('supply_items').select('id,code,description,unit,tracking').eq('organization_id', org).in('id', itemIds)
      : Promise.resolve({ data: [] }),
    locations ? Promise.resolve(locations) : listLocations(session),
  ]);
  const itemMap = new Map(((items.data ?? []) as ItemRow[]).map((i) => [i.id, i]));
  const locMap = new Map(locs.map((l) => [l.id, l]));
  return rows
    .map((r) => {
      const item = itemMap.get(String(r.item_id)); const loc = locMap.get(String(r.location_id));
      return {
        itemId: String(r.item_id), itemCode: item?.code ?? '—', itemDescription: item?.description ?? 'Item', unit: item?.unit ?? '',
        tracking: item?.tracking ?? 'NONE', locationId: String(r.location_id), locationCode: loc?.code ?? '—',
        locationName: loc?.name ?? 'Local', locationKind: (r.location_kind as LocationKind) ?? 'WAREHOUSE',
        onHand: num(r.on_hand_qty), reserved: num(r.reserved_qty), available: num(r.available_qty),
        inspection: num(r.inspection_qty), inboundTransit: num(r.inbound_transit_qty),
        lastMovementAt: (r.last_movement_at as string | null) ?? null,
      };
    })
    .filter((p) => p.onHand !== 0 || p.reserved !== 0 || p.inboundTransit !== 0)
    .sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.locationCode.localeCompare(b.locationCode));
}

export async function inventoryWorkspace(session: Session, today: string) {
  const sb = session.supabase; const org = session.organizationId;
  const since = new Date(`${today}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 60);
  const locations = await listLocations(session);
  const [position, resRows, movRows, trRows, cntRows] = await Promise.all([
    inventoryPosition(session, locations),
    sb.from('inventory_reservations')
      .select('id,item_id,location_id,project_id,requirement_id,quantity,consumed_quantity,released_quantity,status,required_by,source,note,created_by,created_at,closed_at,close_reason')
      .eq('organization_id', org).or(`status.eq.ACTIVE,closed_at.gte.${since.toISOString()}`)
      .order('created_at', { ascending: false }).limit(1000),
    sb.from('inventory_movements')
      .select('id,seq,item_id,location_id,lot_code,movement_type,quantity,project_id,reservation_id,transfer_line_id,count_line_id,reason,actor_user_id,occurred_at')
      .eq('organization_id', org).order('seq', { ascending: false }).limit(400),
    sb.from('inventory_transfers')
      .select('id,transfer_number,from_location_id,to_location_id,project_id,status,expected_arrival,carrier,tracking_ref,note,requested_by,requested_at,approved_at,dispatched_at,received_at,closed_at,close_reason')
      .eq('organization_id', org).or(`status.in.(REQUESTED,APPROVED,IN_TRANSIT,PARTIALLY_RECEIVED,RECEIVED),requested_at.gte.${since.toISOString()}`)
      .order('requested_at', { ascending: false }).limit(300),
    sb.from('inventory_counts').select('id,location_id,status,note,opened_by,opened_at,posted_at,close_reason')
      .eq('organization_id', org).or(`status.eq.OPEN,opened_at.gte.${since.toISOString()}`)
      .order('opened_at', { ascending: false }).limit(100),
  ]);
  for (const r of [resRows, movRows, trRows, cntRows]) if (r.error) throw new Error('Não foi possível ler o estoque.');

  const reservationsRaw = (resRows.data ?? []) as Array<Record<string, unknown>>;
  const movementsRaw = (movRows.data ?? []) as Array<Record<string, unknown>>;
  const transfersRaw = (trRows.data ?? []) as Array<Record<string, unknown>>;
  const countsRaw = (cntRows.data ?? []) as Array<Record<string, unknown>>;
  const transferIds = transfersRaw.map((t) => String(t.id));
  const countIds = countsRaw.map((c) => String(c.id));
  const [lines, countLines] = await Promise.all([
    transferIds.length ? sb.from('inventory_transfer_lines')
      .select('id,transfer_id,item_id,lot_code,quantity,dispatched_quantity,received_quantity,requirement_id,source_reservation_id')
      .eq('organization_id', org).in('transfer_id', transferIds) : Promise.resolve({ data: [] }),
    countIds.length ? sb.from('inventory_count_lines')
      .select('id,count_id,item_id,lot_code,expected_quantity,counted_quantity,counted_at')
      .eq('organization_id', org).in('count_id', countIds) : Promise.resolve({ data: [] }),
  ]);
  const lineRows = (lines.data ?? []) as Array<Record<string, unknown>>;
  const countLineRows = (countLines.data ?? []) as Array<Record<string, unknown>>;

  const itemIds = new Set<string>();
  const projectIds = new Set<string>();
  const requirementIds = new Set<string>();
  for (const r of reservationsRaw) { itemIds.add(String(r.item_id)); projectIds.add(String(r.project_id)); requirementIds.add(String(r.requirement_id)); }
  for (const m of movementsRaw) { itemIds.add(String(m.item_id)); if (m.project_id) projectIds.add(String(m.project_id)); }
  for (const t of transfersRaw) if (t.project_id) projectIds.add(String(t.project_id));
  for (const l of lineRows) { itemIds.add(String(l.item_id)); if (l.requirement_id) requirementIds.add(String(l.requirement_id)); }
  for (const l of countLineRows) itemIds.add(String(l.item_id));

  const [items, names, reqs, coverage, people] = await Promise.all([
    itemIds.size ? sb.from('supply_items').select('id,code,description,unit,tracking').eq('organization_id', org).in('id', Array.from(itemIds))
      : Promise.resolve({ data: [] }),
    projectNames(sb, org, Array.from(projectIds)),
    requirementIds.size ? sb.from('project_requirements').select('id,title,status,quantity')
      .eq('organization_id', org).in('id', Array.from(requirementIds)) : Promise.resolve({ data: [] }),
    requirementIds.size ? sb.from('supply_requirement_coverage').select('requirement_id,reserved_qty,consumed_qty,in_transit_qty')
      .eq('organization_id', org).in('requirement_id', Array.from(requirementIds)) : Promise.resolve({ data: [] }),
    resolveOwnerNames(org, [
      ...movementsRaw.map((m) => m.actor_user_id as string | null),
      ...reservationsRaw.map((r) => r.created_by as string | null),
      ...transfersRaw.map((t) => t.requested_by as string | null),
    ]),
  ]);
  const itemMap = new Map(((items.data ?? []) as ItemRow[]).map((i) => [i.id, i]));
  const reqMap = new Map(((reqs.data ?? []) as Array<{ id: string; title: string; status: string; quantity: number | null }>)
    .map((r) => [r.id, r]));
  const committed = new Map(((coverage.data ?? []) as Array<Record<string, unknown>>)
    .map((c) => [String(c.requirement_id), num(c.reserved_qty) + num(c.consumed_qty) + num(c.in_transit_qty)]));
  const locMap = new Map(locations.map((l) => [l.id, l]));
  const itemView = (id: unknown) => {
    const i = itemMap.get(String(id));
    return { itemId: String(id), itemCode: i?.code ?? '—', itemDescription: i?.description ?? 'Item', unit: i?.unit ?? '', tracking: i?.tracking ?? 'NONE' };
  };
  const locName = (id: unknown) => locMap.get(String(id))?.name ?? 'Local';
  const who = (id: unknown) => (id ? people[String(id)] ?? null : null);

  const reservations = reservationsRaw.map((r) => {
    const req = reqMap.get(String(r.requirement_id));
    const open = num(r.quantity) - num(r.consumed_quantity) - num(r.released_quantity);
    return {
      id: String(r.id), ...itemView(r.item_id), locationId: String(r.location_id), locationName: locName(r.location_id),
      projectId: String(r.project_id), project: names.get(String(r.project_id)) ?? String(r.project_id),
      requirementId: String(r.requirement_id), requirementTitle: req?.title ?? 'Requisito', requirementStatus: req?.status ?? null,
      requirementQuantity: req?.quantity === null || req?.quantity === undefined ? null : num(req.quantity),
      committedToRequirement: committed.get(String(r.requirement_id)) ?? 0,
      quantity: num(r.quantity), consumed: num(r.consumed_quantity), released: num(r.released_quantity), open,
      status: r.status as ReservationStatus, requiredBy: (r.required_by as string | null) ?? null, source: String(r.source),
      note: (r.note as string | null) ?? null, createdBy: who(r.created_by), createdAt: String(r.created_at),
      closedAt: (r.closed_at as string | null) ?? null, closeReason: (r.close_reason as string | null) ?? null,
    };
  });

  const transferNumberByLine = new Map<string, string>();
  const transfers = transfersRaw.map((t) => {
    const tl = lineRows.filter((l) => l.transfer_id === t.id).map((l) => {
      transferNumberByLine.set(String(l.id), String(t.transfer_number));
      return {
        id: String(l.id), ...itemView(l.item_id), lotCode: (l.lot_code as string | null) ?? null, quantity: num(l.quantity),
        dispatched: num(l.dispatched_quantity), received: num(l.received_quantity),
        requirementId: (l.requirement_id as string | null) ?? null,
        requirementTitle: l.requirement_id ? reqMap.get(String(l.requirement_id))?.title ?? null : null,
        fromReservation: Boolean(l.source_reservation_id),
      };
    });
    return {
      id: String(t.id), number: String(t.transfer_number), status: t.status as TransferStatus,
      fromLocationId: String(t.from_location_id), fromLocation: locName(t.from_location_id),
      toLocationId: String(t.to_location_id), toLocation: locName(t.to_location_id),
      projectId: (t.project_id as string | null) ?? null, project: t.project_id ? names.get(String(t.project_id)) ?? String(t.project_id) : null,
      expectedArrival: (t.expected_arrival as string | null) ?? null, carrier: (t.carrier as string | null) ?? null,
      trackingRef: (t.tracking_ref as string | null) ?? null, note: (t.note as string | null) ?? null,
      requestedBy: who(t.requested_by), requestedAt: String(t.requested_at), dispatchedAt: (t.dispatched_at as string | null) ?? null,
      receivedAt: (t.received_at as string | null) ?? null, closedAt: (t.closed_at as string | null) ?? null,
      closeReason: (t.close_reason as string | null) ?? null, lines: tl,
    };
  });

  const movements = movementsRaw.map((m) => ({
    id: String(m.id), seq: num(m.seq), ...itemView(m.item_id), locationId: String(m.location_id), locationName: locName(m.location_id),
    lotCode: (m.lot_code as string | null) ?? null, type: m.movement_type as MovementType, quantity: num(m.quantity),
    projectId: (m.project_id as string | null) ?? null, project: m.project_id ? names.get(String(m.project_id)) ?? String(m.project_id) : null,
    reference: m.transfer_line_id ? transferNumberByLine.get(String(m.transfer_line_id)) ?? 'Transferência'
      : m.count_line_id ? 'Contagem' : m.reservation_id ? 'Reserva' : null,
    reason: (m.reason as string | null) ?? null, actor: who(m.actor_user_id), occurredAt: String(m.occurred_at),
  }));

  const counts = countsRaw.map((c) => ({
    id: String(c.id), locationId: String(c.location_id), locationName: locName(c.location_id), status: String(c.status),
    note: (c.note as string | null) ?? null, openedAt: String(c.opened_at), postedAt: (c.posted_at as string | null) ?? null,
    closeReason: (c.close_reason as string | null) ?? null,
    lines: countLineRows.filter((l) => l.count_id === c.id).map((l) => ({
      id: String(l.id), ...itemView(l.item_id), lotCode: (l.lot_code as string | null) ?? null,
      expected: num(l.expected_quantity), counted: l.counted_quantity === null ? null : num(l.counted_quantity),
    })).sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
  }));

  const exceptions = inventoryExceptions({ today, position, reservations, transfers, counts });
  const [catalog, projectRows] = await Promise.all([
    sb.from('supply_items').select('id,code,description,unit,tracking').eq('organization_id', org).eq('active', true).order('code').limit(5000),
    sb.from('projects').select('id,project,project_v2').eq('organization_id', org).limit(1000),
  ]);
  const catalogItems = (catalog.data ?? []) as ItemRow[];
  const projects = ((projectRows.data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => ({ id: p.id, name: projectIdentity(p.id, p.project, p.project_v2).name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { today, locations, position, reservations, movements, transfers, counts, exceptions, items: catalogItems, projects };
}

export type InventoryWorkspaceModel = Awaited<ReturnType<typeof inventoryWorkspace>>;
