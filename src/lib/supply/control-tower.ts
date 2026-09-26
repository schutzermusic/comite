/**
 * TORRE DE CONTROLE do Supply — "o que precisa de atenção agora?".
 *
 * Cada entrada em risco vem com a CADEIA CAUSAL que a explica:
 *   fornecedor → pedido → material → requisito → atividade → projeto.
 * Tudo derivado da cobertura, dos pedidos, embarques, recebimentos e do
 * desempenho medido do fornecedor, lidos pelo cliente autenticado (RLS).
 * Nada é digitado, estimado ou guardado à parte.
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/control-tower.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { daysBetween } from '@/lib/operations/overview-rules';
import { strategyOptions } from './coverage';
import { listSuppliers } from './procurement-read';
import { materialDemand, supplyOverview, type MaterialDemandRow } from './read-model';
import { daysLate, inboundRisk, type InboundRisk } from './receiving';

type Session = { supabase: SupabaseClient; organizationId: string };
type Row = Record<string, unknown>;
const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** `.in()` em lotes: listas longas de ids estouram o tamanho da URL do PostgREST. */
async function inBatches(ids: string[], read: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await read(ids.slice(i, i + 150));
    if (error) throw new Error('Não foi possível ler a torre de controle do supply.');
    out.push(...((data ?? []) as Row[]));
  }
  return out;
}

export interface InboundChain {
  risk: InboundRisk; late: boolean; daysLate: number; slackDays: number | null;
  poId: string; poNumber: string; supplierId: string; supplier: string; supplierOnTime: number | null;
  itemCode: string; itemDescription: string; unit: string; openQty: number;
  eta: string | null; etaSource: 'embarque' | 'linha' | 'pedido' | null;
  requirementId: string | null; requirement: string | null;
  /** A necessidade (regra da Apex: `required_by` ou início da atividade, o que vier antes). */
  needBy: string | null;
  activityId: string | null; activity: string | null; projectId: string | null; project: string | null;
}

const RISK_RANK: Record<InboundRisk, number> = { critical: 0, high: 1, medium: 2 };

export async function supplyControlTower(session: Session, today: string) {
  const sb = session.supabase; const org = session.organizationId;
  const demand = await materialDemand(session, today);
  const [overview, suppliers, posRes, pendingRes] = await Promise.all([
    supplyOverview(session, today, demand),
    listSuppliers(session),
    sb.from('purchase_orders').select('id,order_number,supplier_id,status,expected_delivery,currency,freight_amount,tax_amount,created_at')
      .eq('organization_id', org).in('status', ['APPROVAL_REQUIRED', 'ISSUED', 'PARTIALLY_RECEIVED']).limit(2000),
    sb.from('goods_receipts').select('id,receipt_number,purchase_order_id,received_at,location_id')
      .eq('organization_id', org).eq('inspection_status', 'PENDING').order('received_at', { ascending: true }).limit(200),
  ]);
  if (posRes.error || pendingRes.error) throw new Error('Não foi possível ler a torre de controle do supply.');
  const pos = (posRes.data ?? []) as Row[];
  const pending = (pendingRes.data ?? []) as Row[];
  const poIds = pos.map((p) => String(p.id));
  const liveIds = pos.filter((p) => p.status !== 'APPROVAL_REQUIRED').map((p) => String(p.id));

  const [lines, ships] = await Promise.all([
    inBatches(poIds, (c) => sb.from('purchase_order_lines')
      .select('id,purchase_order_id,item_id,quantity,received_quantity,unit_price,expected_date').eq('organization_id', org).in('purchase_order_id', c)),
    inBatches(liveIds, (c) => sb.from('inbound_shipments').select('purchase_order_id,eta,status').eq('organization_id', org)
      .in('purchase_order_id', c).in('status', ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'])),
  ]);
  const lineIds = lines.map((l) => String(l.id));
  const itemIds = Array.from(new Set(lines.map((l) => String(l.item_id))));
  const pendingPoIds = Array.from(new Set(pending.map((r) => String(r.purchase_order_id)))).filter((id) => !poIds.includes(id));
  const [allocs, items, extraPos, pendingLines, locations] = await Promise.all([
    inBatches(lineIds, (c) => sb.from('purchase_order_line_requirements').select('line_id,requirement_id,quantity,received_quantity')
      .eq('organization_id', org).in('line_id', c)),
    inBatches(itemIds, (c) => sb.from('supply_items').select('id,code,description,unit').eq('organization_id', org).in('id', c)),
    inBatches(pendingPoIds, (c) => sb.from('purchase_orders').select('id,order_number,supplier_id').eq('organization_id', org).in('id', c)),
    inBatches(pending.map((r) => String(r.id)), (c) => sb.from('goods_receipt_lines').select('receipt_id,item_id,accepted_quantity')
      .eq('organization_id', org).in('receipt_id', c)),
    sb.from('inventory_locations').select('id,name').eq('organization_id', org).limit(2000),
  ]);

  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  const poMap = new Map([...extraPos, ...pos].map((p) => [String(p.id), p]));
  const itemMap = new Map(items.map((i) => [String(i.id), i]));
  const demandMap = new Map<string, MaterialDemandRow>(demand.map((d) => [d.requirementId, d]));
  const locName = new Map(((locations.data ?? []) as Row[]).map((l) => [String(l.id), String(l.name)]));
  const etaOf = (poId: string) => ships.filter((s) => s.purchase_order_id === poId && s.eta).map((s) => String(s.eta)).sort()[0] ?? null;

  // ── Entradas em risco, com a cadeia causal ─────────────────────────────
  const chains: InboundChain[] = [];
  const allocatedLines = new Set(allocs.map((a) => String(a.line_id)));
  const chainOf = (line: Row, po: Row, openQty: number, d: MaterialDemandRow | undefined): InboundChain | null => {
    const shipEta = etaOf(String(po.id));
    const eta = shipEta ?? str(line.expected_date) ?? str(po.expected_delivery);
    const { risk, slackDays, late } = inboundRisk(eta, d?.needBy ?? null, today);
    if (!risk) return null;
    const item = itemMap.get(String(line.item_id));
    const supplier = supplierMap.get(String(po.supplier_id));
    return {
      risk, late, daysLate: daysLate(eta, today), slackDays,
      poId: String(po.id), poNumber: String(po.order_number), supplierId: String(po.supplier_id),
      supplier: supplier?.name ?? 'Fornecedor', supplierOnTime: supplier?.onTimeRate ?? null,
      itemCode: String(item?.code ?? '—'), itemDescription: String(item?.description ?? 'Item'), unit: String(item?.unit ?? ''), openQty,
      eta, etaSource: shipEta ? 'embarque' : line.expected_date ? 'linha' : po.expected_delivery ? 'pedido' : null,
      requirementId: d?.requirementId ?? null, requirement: d?.title ?? null, needBy: d?.needBy ?? null,
      activityId: d?.activityId ?? null, activity: d?.activity ?? null, projectId: d?.projectId ?? null, project: d?.project ?? null,
    };
  };
  for (const a of allocs) {
    const line = lines.find((l) => l.id === a.line_id);
    const po = line ? poMap.get(String(line.purchase_order_id)) : undefined;
    if (!line || !po || po.status === 'APPROVAL_REQUIRED') continue;
    const open = Math.max(0, num(a.quantity) - num(a.received_quantity));
    if (open <= 0) continue;
    const chain = chainOf(line, po, open, demandMap.get(String(a.requirement_id)));
    if (chain) chains.push(chain);
  }
  // Reposição sem requisito: só o atraso importa (não há necessidade datada).
  for (const line of lines.filter((l) => !allocatedLines.has(String(l.id)))) {
    const po = poMap.get(String(line.purchase_order_id));
    if (!po || po.status === 'APPROVAL_REQUIRED') continue;
    const open = Math.max(0, num(line.quantity) - num(line.received_quantity));
    const chain = open > 0 ? chainOf(line, po, open, undefined) : null;
    if (chain && chain.late) chains.push(chain);
  }
  chains.sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999'));

  // ── Aprovações de compra pendentes, pela necessidade que seguram ─────────
  const approvals = pos.filter((p) => p.status === 'APPROVAL_REQUIRED').map((p) => {
    const mine = lines.filter((l) => l.purchase_order_id === p.id);
    const goods = mine.reduce((acc, l) => acc + num(l.quantity) * num(l.unit_price), 0);
    const needs = allocs.filter((a) => mine.some((l) => l.id === a.line_id)).map((a) => demandMap.get(String(a.requirement_id)))
      .filter(Boolean) as MaterialDemandRow[];
    const needBy = needs.map((d) => d.needBy).filter(Boolean).sort()[0] ?? null;
    return {
      id: String(p.id), number: String(p.order_number), supplier: supplierMap.get(String(p.supplier_id))?.name ?? 'Fornecedor',
      currency: String(p.currency), total: goods + num(p.freight_amount) + num(p.tax_amount), createdAt: String(p.created_at),
      waitingDays: Math.max(0, daysBetween(String(p.created_at).slice(0, 10), today)),
      needBy, daysToNeed: needBy ? daysBetween(today, needBy) : null,
      projects: Array.from(new Set(needs.map((d) => d.project))),
      items: Array.from(new Set(mine.map((l) => String(itemMap.get(String(l.item_id))?.description ?? 'Item')))),
    };
  }).sort((a, b) => (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999'));

  // ── O que cobre a falta SEM comprar (estoque livre aqui ou em outro local) ─
  // Regra 246: pela cobertura inteira — o já pedido em transferência não é sugerido de novo, e o
  // estoque só cabe no que o banco aceita (não reserva/transfere por cima de solicitação aberta).
  const stockCover = demand.filter((d) => d.coverage.shortage > 0 && d.itemId).flatMap((d) => {
    const option = strategyOptions(d.requirementType, d.coverage, d.stock)
      .find((o) => o.strategy === 'RESERVE_FROM_STOCK' || o.strategy === 'TRANSFER');
    if (!option) return [];
    return [{
      requirementId: d.requirementId, strategy: option.strategy as 'RESERVE_FROM_STOCK' | 'TRANSFER', quantity: option.quantity,
      fromLocationId: option.locationId ?? null,
      fromLocation: option.locationId ? d.stock.find((s) => s.locationId === option.locationId)?.locationName ?? null : null,
      toSite: d.sites[0]?.name ?? null, itemCode: d.itemCode, itemDescription: d.itemDescription ?? d.title, unit: d.unit,
      shortage: d.coverage.shortage, pendingTransfer: d.coverage.pendingTransfer, purchasable: d.coverage.purchasable,
      needBy: d.needBy, daysToNeed: d.daysToNeed, risk: d.risk,
      projectId: d.projectId, project: d.project,
    }];
  }).sort((a, b) => (a.needBy ?? '9999').localeCompare(b.needBy ?? '9999'));

  // ── Inspeção esperando (quarentena não é reservável) ──────────────────────
  const inspection = pending.map((r) => {
    const po = poMap.get(String(r.purchase_order_id));
    const mine = pendingLines.filter((l) => l.receipt_id === r.id);
    return {
      id: String(r.id), number: String(r.receipt_number), poId: str(r.purchase_order_id), poNumber: String(po?.order_number ?? '—'),
      supplier: supplierMap.get(String(po?.supplier_id))?.name ?? 'Fornecedor', location: locName.get(String(r.location_id)) ?? 'Local',
      receivedAt: String(r.received_at), ageDays: Math.max(0, daysBetween(String(r.received_at).slice(0, 10), today)),
      quantity: mine.reduce((acc, l) => acc + num(l.accepted_quantity), 0), lines: mine.length,
    };
  });

  // ── Fornecedores com entrega em risco: medido, nunca estimado ─────────────
  const lateBySupplier = new Map<string, number>();
  for (const c of chains.filter((x) => x.late)) lateBySupplier.set(c.supplierId, (lateBySupplier.get(c.supplierId) ?? 0) + 1);
  const supplierRisk = suppliers.filter((s) => s.openOrders > 0)
    .map((s) => ({ id: s.id, name: s.name, onTimeRate: s.onTimeRate, deliveryLines: s.deliveryLines, openOrders: s.openOrders, lateLines: lateBySupplier.get(s.id) ?? 0,
      chains: chains.filter((c) => c.supplierId === s.id).length }))
    .filter((s) => s.lateLines > 0 || s.chains > 0 || (s.onTimeRate !== null && s.onTimeRate < 0.85))
    .sort((a, b) => b.lateLines - a.lateLines || b.chains - a.chains || (a.onTimeRate ?? 1) - (b.onTimeRate ?? 1));

  return {
    ...overview,
    inbound: chains,
    approvals,
    stockCover,
    inspection,
    supplierRisk,
    signals: {
      inboundAtRisk: chains.length,
      inboundAfterNeed: chains.filter((c) => c.slackDays !== null && c.slackDays < 0).length,
      inboundLate: chains.filter((c) => c.late).length,
      approvalsPending: approvals.length,
      inspectionPending: inspection.length,
      oldestInspectionDays: inspection.reduce((m, r) => Math.max(m, r.ageDays), 0),
      coverableWithoutBuying: stockCover.length,
    },
  };
}

export type SupplyControlTowerModel = Awaited<ReturnType<typeof supplyControlTower>>;
