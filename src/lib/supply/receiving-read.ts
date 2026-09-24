/**
 * READ MODEL de Recebimento & Logística — o que está entrando (pedidos
 * emitidos e transferências), embarques, recebimentos e inspeções, lido pelo
 * cliente autenticado (RLS). Em aberto e atraso são derivados.
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/receiving-read.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { projectIdentity } from '@/lib/operations/project-identity';
import { daysLate, inboundQueue, type InboundQueue, type InspectionStatus, type ShipmentStatus } from './receiving';

type Session = { supabase: SupabaseClient; organizationId: string };
type Row = Record<string, unknown>;
const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function receivingWorkspace(session: Session, today: string) {
  const sb = session.supabase; const org = session.organizationId;
  const since = new Date(`${today}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 60);
  const [pos, transfers, receipts, locations, suppliers, perf] = await Promise.all([
    sb.from('purchase_orders').select('id,order_number,supplier_id,project_id,status,expected_delivery,delivery_location_id,issued_at,closed_at')
      .eq('organization_id', org).or(`status.in.(ISSUED,PARTIALLY_RECEIVED),closed_at.gte.${since.toISOString()},issued_at.gte.${since.toISOString()}`)
      .in('status', ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED']).order('expected_delivery', { ascending: true, nullsFirst: false }).limit(500),
    sb.from('inventory_transfers').select('id,transfer_number,from_location_id,to_location_id,project_id,status,expected_arrival,carrier,tracking_ref,dispatched_at,received_at')
      .eq('organization_id', org).in('status', ['APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED']).limit(300),
    sb.from('goods_receipts').select('id,receipt_number,purchase_order_id,shipment_id,location_id,received_at,received_by,note,discrepancy_reason,inspection_status,inspected_at,inspection_note')
      .eq('organization_id', org).or(`inspection_status.eq.PENDING,received_at.gte.${since.toISOString()}`)
      .order('received_at', { ascending: false }).limit(300),
    sb.from('inventory_locations').select('id,name,kind,project_id,active').eq('organization_id', org).limit(2000),
    sb.from('supplier_profiles').select('id,party_id').eq('organization_id', org).limit(2000),
    sb.from('supplier_delivery_performance').select('supplier_id,promised_lines,on_time_lines,avg_delay_days,lines_with_rejection,received_lines')
      .eq('organization_id', org),
  ]);
  for (const r of [pos, transfers, receipts]) if (r.error) throw new Error('Não foi possível ler o recebimento.');
  const poRows = (pos.data ?? []) as Row[]; const trRows = (transfers.data ?? []) as Row[]; const rcRows = (receipts.data ?? []) as Row[];
  const poIds = Array.from(new Set([...poRows.map((p) => String(p.id)), ...rcRows.map((r) => String(r.purchase_order_id))]));
  const rcIds = rcRows.map((r) => String(r.id));
  const trIds = trRows.map((t) => String(t.id));
  const [poLines, shipments, rcLines, evidence, trLines, extraPos] = await Promise.all([
    poIds.length ? sb.from('purchase_order_lines').select('id,purchase_order_id,item_id,quantity,unit_price,expected_date,received_quantity')
      .eq('organization_id', org).in('purchase_order_id', poIds) : Promise.resolve({ data: [] }),
    poIds.length ? sb.from('inbound_shipments').select('id,shipment_number,purchase_order_id,destination_location_id,status,carrier,vehicle,tracking_ref,dispatched_at,eta,arrived_at,note')
      .eq('organization_id', org).in('purchase_order_id', poIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    rcIds.length ? sb.from('goods_receipt_lines').select('id,receipt_id,po_line_id,item_id,accepted_quantity,rejected_quantity,rejection_reason,lot_code,serials,inspection_approved_quantity,inspection_rejected_quantity')
      .eq('organization_id', org).in('receipt_id', rcIds) : Promise.resolve({ data: [] }),
    rcIds.length ? sb.from('goods_receipt_evidence').select('id,receipt_id,file_name,mime_type,size_bytes,created_at')
      .eq('organization_id', org).in('receipt_id', rcIds) : Promise.resolve({ data: [] }),
    trIds.length ? sb.from('inventory_transfer_lines').select('id,transfer_id,item_id,lot_code,quantity,dispatched_quantity,received_quantity')
      .eq('organization_id', org).in('transfer_id', trIds) : Promise.resolve({ data: [] }),
    // Pedidos citados por recebimentos antigos que saíram do recorte acima.
    poIds.length ? sb.from('purchase_orders').select('id,order_number,supplier_id,project_id,status,expected_delivery,delivery_location_id,issued_at,closed_at')
      .eq('organization_id', org).in('id', poIds) : Promise.resolve({ data: [] }),
  ]);
  const allPoRows = new Map<string, Row>([...((extraPos.data ?? []) as Row[]), ...poRows].map((p) => [String(p.id), p]));
  const poLineRows = (poLines.data ?? []) as Row[]; const shipRows = (shipments.data ?? []) as Row[];
  const rcLineRows = (rcLines.data ?? []) as Row[]; const evRows = (evidence.data ?? []) as Row[]; const trLineRows = (trLines.data ?? []) as Row[];

  const itemIds = new Set<string>([...poLineRows, ...rcLineRows, ...trLineRows].map((l) => String(l.item_id)));
  const projectIds = new Set<string>([...allPoRows.values(), ...trRows].map((r) => r.project_id).filter(Boolean) as string[]);
  const supRows = (suppliers.data ?? []) as Row[];
  const [items, projects, parties, people] = await Promise.all([
    itemIds.size ? sb.from('supply_items').select('id,code,description,unit,tracking').eq('organization_id', org).in('id', Array.from(itemIds))
      : Promise.resolve({ data: [] }),
    projectIds.size ? sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', Array.from(projectIds))
      : Promise.resolve({ data: [] }),
    supRows.length ? sb.from('parties').select('id,legal_name,trade_name').eq('organization_id', org).in('id', supRows.map((s) => String(s.party_id)))
      : Promise.resolve({ data: [] }),
    resolveOwnerNames(org, rcRows.map((r) => r.received_by as string | null)),
  ]);
  const itemMap = new Map(((items.data ?? []) as Row[]).map((i) => [String(i.id), i]));
  const projMap = new Map(((projects.data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2).name]));
  const partyMap = new Map(((parties.data ?? []) as Row[]).map((p) => [String(p.id), String(p.trade_name ?? p.legal_name)]));
  const supplierName = new Map(supRows.map((s) => [String(s.id), partyMap.get(String(s.party_id)) ?? 'Fornecedor']));
  const locRows = (locations.data ?? []) as Row[];
  const locMap = new Map(locRows.map((l) => [String(l.id), l]));
  const item = (id: unknown) => {
    const i = itemMap.get(String(id));
    return { itemId: String(id), itemCode: String(i?.code ?? '—'), itemDescription: String(i?.description ?? 'Item'),
      unit: String(i?.unit ?? ''), tracking: String(i?.tracking ?? 'NONE') };
  };
  const locName = (id: unknown) => (id ? String(locMap.get(String(id))?.name ?? 'Local') : null);

  const receiptsView = rcRows.map((r) => {
    const lines = rcLineRows.filter((l) => l.receipt_id === r.id).map((l) => ({ id: String(l.id), poLineId: String(l.po_line_id), ...item(l.item_id),
      accepted: num(l.accepted_quantity), rejected: num(l.rejected_quantity), rejectionReason: str(l.rejection_reason),
      lotCode: str(l.lot_code), serials: (l.serials as string[]) ?? [],
      inspectionApproved: l.inspection_approved_quantity === null ? null : num(l.inspection_approved_quantity),
      inspectionRejected: l.inspection_rejected_quantity === null ? null : num(l.inspection_rejected_quantity) }));
    const po = allPoRows.get(String(r.purchase_order_id));
    return {
      id: String(r.id), number: String(r.receipt_number), purchaseOrderId: String(r.purchase_order_id), orderNumber: String(po?.order_number ?? '—'),
      supplier: supplierName.get(String(po?.supplier_id)) ?? 'Fornecedor', locationId: String(r.location_id), location: locName(r.location_id),
      locationKind: String(locMap.get(String(r.location_id))?.kind ?? ''), receivedAt: String(r.received_at),
      receivedBy: r.received_by ? people[String(r.received_by)] ?? null : null, note: str(r.note), discrepancyReason: str(r.discrepancy_reason),
      inspectionStatus: r.inspection_status as InspectionStatus, inspectionNote: str(r.inspection_note),
      lines, evidence: evRows.filter((e) => e.receipt_id === r.id).map((e) => ({ id: String(e.id), fileName: String(e.file_name),
        mimeType: String(e.mime_type), sizeBytes: num(e.size_bytes) })),
      hasDiscrepancy: lines.some((l) => l.rejected > 0 || (l.inspectionRejected ?? 0) > 0),
    };
  });

  const inbound = Array.from(allPoRows.values()).filter((p) => poRows.some((x) => x.id === p.id)).map((p) => {
    const lines = poLineRows.filter((l) => l.purchase_order_id === p.id).map((l) => ({ id: String(l.id), ...item(l.item_id),
      quantity: num(l.quantity), received: num(l.received_quantity), open: Math.max(0, num(l.quantity) - num(l.received_quantity)),
      expectedDate: str(l.expected_date) }));
    const ships = shipRows.filter((s) => s.purchase_order_id === p.id).map((s) => ({ id: String(s.id), number: String(s.shipment_number),
      status: s.status as ShipmentStatus, carrier: str(s.carrier), vehicle: str(s.vehicle), trackingRef: str(s.tracking_ref), eta: str(s.eta),
      dispatchedAt: str(s.dispatched_at), arrivedAt: str(s.arrived_at), destination: locName(s.destination_location_id), note: str(s.note) }));
    const live = ships.filter((s) => ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'].includes(s.status));
    const expectedDate = live.map((s) => s.eta).filter(Boolean).sort()[0] ?? str(p.expected_delivery)
      ?? lines.map((l) => l.expectedDate).filter(Boolean).sort()[0] ?? null;
    const myReceipts = receiptsView.filter((r) => r.purchaseOrderId === p.id);
    const open = lines.reduce((a, l) => a + l.open, 0);
    const discrepancy = myReceipts.some((r) => r.inspectionStatus === 'PENDING' || r.hasDiscrepancy);
    const queue: InboundQueue = inboundQueue({ kind: 'PO', status: String(p.status), expectedDate, inTransit: live.some((s) => s.status === 'IN_TRANSIT'),
      hasReceipt: myReceipts.length > 0, openQuantity: open, discrepancy }, today);
    return {
      kind: 'PO' as const, id: String(p.id), number: String(p.order_number), status: String(p.status),
      counterpart: supplierName.get(String(p.supplier_id)) ?? 'Fornecedor', projectId: str(p.project_id),
      project: p.project_id ? projMap.get(String(p.project_id)) ?? String(p.project_id) : null,
      destinationId: str(p.delivery_location_id), destination: locName(p.delivery_location_id),
      expectedDate, daysLate: open > 0 ? daysLate(expectedDate, today) : 0, open, queue, lines, shipments: ships,
      receipts: myReceipts.map((r) => r.id),
    };
  });

  const inboundTransfers = trRows.map((t) => {
    const lines = trLineRows.filter((l) => l.transfer_id === t.id).map((l) => ({ id: String(l.id), ...item(l.item_id), lotCode: str(l.lot_code),
      quantity: num(l.quantity), dispatched: num(l.dispatched_quantity), received: num(l.received_quantity),
      open: Math.max(0, (t.status === 'APPROVED' ? num(l.quantity) : num(l.dispatched_quantity)) - num(l.received_quantity)), expectedDate: str(t.expected_arrival) }));
    const open = lines.reduce((a, l) => a + l.open, 0);
    const queue: InboundQueue = inboundQueue({ kind: 'TRANSFER', status: String(t.status), expectedDate: str(t.expected_arrival),
      inTransit: t.status === 'IN_TRANSIT' || t.status === 'PARTIALLY_RECEIVED', hasReceipt: lines.some((l) => l.received > 0),
      openQuantity: open, discrepancy: false }, today);
    return {
      kind: 'TRANSFER' as const, id: String(t.id), number: String(t.transfer_number), status: String(t.status),
      counterpart: `De ${locName(t.from_location_id) ?? 'origem'}`, projectId: str(t.project_id),
      project: t.project_id ? projMap.get(String(t.project_id)) ?? String(t.project_id) : null,
      destinationId: str(t.to_location_id), destination: locName(t.to_location_id), expectedDate: str(t.expected_arrival),
      daysLate: open > 0 ? daysLate(str(t.expected_arrival), today) : 0, open, queue,
      carrier: str(t.carrier), trackingRef: str(t.tracking_ref), lines,
    };
  });

  return {
    today, inbound, inboundTransfers, receipts: receiptsView,
    locations: locRows.filter((l) => l.active).map((l) => ({ id: String(l.id), name: String(l.name), kind: String(l.kind) })),
    performance: ((perf.data ?? []) as Row[]).map((p) => ({ supplierId: String(p.supplier_id), supplier: supplierName.get(String(p.supplier_id)) ?? 'Fornecedor',
      promisedLines: num(p.promised_lines), onTimeLines: num(p.on_time_lines), avgDelayDays: num(p.avg_delay_days),
      linesWithRejection: num(p.lines_with_rejection), receivedLines: num(p.received_lines) })),
  };
}

export type ReceivingWorkspaceModel = Awaited<ReturnType<typeof receivingWorkspace>>;
