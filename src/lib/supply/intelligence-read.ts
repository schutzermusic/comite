/**
 * Leitura da Apex para o Supply (236): junta os fatos do inquilino, roda o
 * motor determinístico e sincroniza o livro `supply_signals`.
 *
 * A LEITURA é do sistema (cliente de serviço, sempre filtrada pelo
 * inquilino): o risco de um projeto não pode depender de quem abriu a tela.
 * O que cada pessoa VÊ continua passando pela RLS (`listSupplySignals`).
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/intelligence-read.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { platformServiceClient } from '@/lib/platform/server-client';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { projectIdentity } from '@/lib/operations/project-identity';
import { fromViewRow, type CoverageViewRow } from './coverage';
import { ENGINE_VERSION, computeSignals, type IntelligenceFacts, type SupplySignal } from './intelligence';

type Row = Record<string, unknown>;
const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const LIVE_PO = ['ISSUED', 'PARTIALLY_RECEIVED'];

/*
  A leitura da Apex é TUDO-OU-NADA.

  `supply_signals_sync` resolve todo sinal aberto que a leitura não reencontrou
  ("a condição deixou de ser verdade"). Uma consulta que falhasse em silêncio,
  ou voltasse cortada pelo teto de linhas do PostgREST, faria a Apex gravar no
  livro append-only que uma falta real foi resolvida. Por isso: toda consulta
  é conferida, as grandes são paginadas com ordem estável, as listas de ids
  vão em lotes (URL curta), e qualquer falha ABORTA a leitura antes do sync.
*/
export class IncompleteIntelligenceRead extends Error {
  constructor(label: string, detail: string) {
    super(`Leitura da Apex incompleta (${label}): ${detail}`);
    this.name = 'IncompleteIntelligenceRead';
  }
}
type Page = PromiseLike<{ data: unknown; error: { message: string } | null }>;
const PAGE = 1000;
const MAX_ROWS = 50_000;
const ID_BATCH = 150;

async function paged(label: string, page: (from: number, to: number) => Page): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new IncompleteIntelligenceRead(label, error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  throw new IncompleteIntelligenceRead(label, `mais de ${MAX_ROWS} linhas`);
}

async function byIds(label: string, ids: string[], page: (chunk: string[], from: number, to: number) => Page): Promise<Row[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const out: Row[] = [];
  for (let i = 0; i < unique.length; i += ID_BATCH) {
    const chunk = unique.slice(i, i + ID_BATCH);
    out.push(...await paged(label, (from, to) => page(chunk, from, to)));
  }
  return out;
}

export async function gatherIntelligenceFacts(org: string, today: string, sb: SupabaseClient = platformServiceClient()): Promise<IntelligenceFacts> {
  const since = new Date(`${today}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 180);
  const [covRows, poRows, rqRows, stockRows, locAll, transfersDoneRows, inspectionRows, perfRows, supplierRows] = await Promise.all([
    paged('cobertura', (f, t) => sb.from('supply_requirement_coverage').select('*').eq('organization_id', org)
      .eq('requirement_type', 'MATERIAL').not('item_id', 'is', null).order('requirement_id').range(f, t)),
    paged('pedidos', (f, t) => sb.from('purchase_orders').select('id,order_number,supplier_id,project_id,status,expected_delivery,submitted_at')
      .eq('organization_id', org).in('status', ['APPROVAL_REQUIRED', 'ISSUED', 'PARTIALLY_RECEIVED']).order('id').range(f, t)),
    paged('requisições', (f, t) => sb.from('purchase_requisitions').select('id,requisition_number,status,requested_at,project_id,required_by')
      .eq('organization_id', org).in('status', ['SUBMITTED', 'SOURCING']).order('id').range(f, t)),
    paged('estoque', (f, t) => sb.from('inventory_position').select('item_id,location_id,location_kind,available_qty')
      .eq('organization_id', org).gt('available_qty', 0).order('item_id').order('location_id').range(f, t)),
    paged('locais', (f, t) => sb.from('inventory_locations').select('id,name,kind,project_id,active').eq('organization_id', org).order('id').range(f, t)),
    paged('transferências', (f, t) => sb.from('inventory_transfers').select('id,from_location_id,to_location_id,dispatched_at,received_at')
      .eq('organization_id', org).in('status', ['RECEIVED', 'CLOSED']).not('received_at', 'is', null)
      .gte('dispatched_at', since.toISOString()).order('id').range(f, t)),
    paged('inspeções', (f, t) => sb.from('goods_receipts').select('id,receipt_number,received_at,purchase_order_id,location_id')
      .eq('organization_id', org).eq('inspection_status', 'PENDING').order('id').range(f, t)),
    paged('pontualidade', (f, t) => sb.from('supplier_delivery_performance').select('supplier_id,promised_lines,on_time_lines')
      .eq('organization_id', org).order('supplier_id').range(f, t)),
    paged('fornecedores', (f, t) => sb.from('supplier_profiles').select('id,party_id').eq('organization_id', org).order('id').range(f, t)),
  ]);

  const covTyped = covRows as unknown as Array<CoverageViewRow & { organization_id: string }>;
  const locRows = locAll.filter((l) => l.active);
  const locMap = new Map(locRows.map((l) => [String(l.id), l]));
  const reqIds = covTyped.map((r) => r.requirement_id);
  const poIds = poRows.map((p) => String(p.id));
  const rqIds = rqRows.map((r) => String(r.id));
  const itemIds = covTyped.map((r) => String(r.item_id));
  const projectIds = [...covTyped.map((r) => r.project_id), ...poRows.map((p) => p.project_id)].filter(Boolean) as string[];

  const [reqMetaRows, itemRows, projectRows, poLineRows, allocRows, shipRows, transitLineRows, rqLineRows] = await Promise.all([
    byIds('requisitos', reqIds, (c, f, t) => sb.from('project_requirements').select('id,title,activity_id').eq('organization_id', org)
      .in('id', c).order('id').range(f, t)),
    byIds('itens', itemIds, (c, f, t) => sb.from('supply_items').select('id,code,description,unit').eq('organization_id', org)
      .in('id', c).order('id').range(f, t)),
    byIds('projetos', projectIds, (c, f, t) => sb.from('projects').select('id,project,project_v2').eq('organization_id', org)
      .in('id', c).order('id').range(f, t)),
    byIds('linhas de pedido', poIds, (c, f, t) => sb.from('purchase_order_lines')
      .select('id,purchase_order_id,quantity,received_quantity,expected_date').eq('organization_id', org)
      .in('purchase_order_id', c).order('id').range(f, t)),
    byIds('alocações de pedido', reqIds, (c, f, t) => sb.from('purchase_order_line_requirements')
      .select('line_id,requirement_id,quantity,received_quantity').eq('organization_id', org)
      .in('requirement_id', c).order('line_id').order('requirement_id').range(f, t)),
    byIds('embarques', poIds, (c, f, t) => sb.from('inbound_shipments').select('id,purchase_order_id,status,eta').eq('organization_id', org)
      .in('purchase_order_id', c).in('status', ['EXPECTED', 'IN_TRANSIT', 'ARRIVED']).order('id').range(f, t)),
    byIds('linhas em trânsito', reqIds, (c, f, t) => sb.from('inventory_transfer_lines')
      .select('id,transfer_id,requirement_id,dispatched_quantity,received_quantity').eq('organization_id', org)
      .in('requirement_id', c).order('id').range(f, t)),
    byIds('linhas de requisição', rqIds, (c, f, t) => sb.from('purchase_requisition_lines').select('id,requisition_id')
      .eq('organization_id', org).in('requisition_id', c).order('id').range(f, t)),
  ]);

  const actIds = reqMetaRows.map((r) => r.activity_id).filter(Boolean) as string[];
  const rqLineIds = rqLineRows.map((l) => String(l.id));
  const [actRows, rqAllocRows, rfqLineRows, transferRows, partyRows] = await Promise.all([
    byIds('atividades', actIds, (c, f, t) => sb.from('project_timeline_items').select('id,title,planned_start').eq('organization_id', org)
      .in('id', c).order('id').range(f, t)),
    byIds('rastro da requisição', rqLineIds, (c, f, t) => sb.from('purchase_requisition_line_requirements')
      .select('line_id,requirement_id').eq('organization_id', org).in('line_id', c).order('line_id').order('requirement_id').range(f, t)),
    byIds('linhas de cotação', rqLineIds, (c, f, t) => sb.from('procurement_rfq_lines').select('id,requisition_line_id,rfq_id')
      .eq('organization_id', org).in('requisition_line_id', c).order('id').range(f, t)),
    byIds('transferências em trânsito', transitLineRows.map((l) => String(l.transfer_id)), (c, f, t) => sb.from('inventory_transfers')
      .select('id,transfer_number,status,expected_arrival').eq('organization_id', org).in('id', c).order('id').range(f, t)),
    byIds('partes fornecedoras', supplierRows.map((s) => String(s.party_id)), (c, f, t) => sb.from('parties')
      .select('id,legal_name,trade_name').eq('organization_id', org).in('id', c).order('id').range(f, t)),
  ]);

  // Formas que o restante da montagem já espera.
  const covRowsTyped = covTyped;
  const reqMeta = { data: reqMetaRows }; const items = { data: itemRows }; const projects = { data: projectRows };
  const poLines = { data: poLineRows }; const allocs = { data: allocRows }; const ships = { data: shipRows };
  const transitLines = { data: transitLineRows }; const rfqLines = { data: rfqLineRows }; const suppliers = { data: supplierRows };
  const acts = { data: actRows }; const rqAllocs = { data: rqAllocRows }; const transfers = { data: transferRows };
  const parties = { data: partyRows }; const stock = { data: stockRows }; const transfersDone = { data: transfersDoneRows };
  const inspections = { data: inspectionRows }; const perf = { data: perfRows };

  const itemMap = new Map(((items.data ?? []) as Row[]).map((i) => [String(i.id), i]));
  const projMap = new Map(((projects.data ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2).name]));
  const reqMap = new Map(((reqMeta.data ?? []) as Row[]).map((r) => [String(r.id), r]));
  const actMap = new Map(((acts.data ?? []) as Row[]).map((a) => [String(a.id), a]));
  const partyName = new Map(((parties.data ?? []) as Row[]).map((p) => [String(p.id), String(p.trade_name ?? p.legal_name)]));
  const supplierName = new Map(((suppliers.data ?? []) as Row[]).map((s) => [String(s.id), partyName.get(String(s.party_id)) ?? 'Fornecedor']));
  const poMap = new Map(poRows.map((p) => [String(p.id), p]));
  const lineMap = new Map(((poLines.data ?? []) as Row[]).map((l) => [String(l.id), l]));
  const shipEta = new Map<string, string>();
  for (const s of (ships.data ?? []) as Row[]) {
    const cur = shipEta.get(String(s.purchase_order_id));
    if (s.eta && (!cur || String(s.eta) < cur)) shipEta.set(String(s.purchase_order_id), String(s.eta));
  }
  const poEta = (po: Row, line?: Row) => shipEta.get(String(po.id)) ?? str(line?.expected_date) ?? str(po.expected_delivery);

  const requirements = covRowsTyped.map((c) => {
    const meta = reqMap.get(c.requirement_id); const act = meta?.activity_id ? actMap.get(String(meta.activity_id)) : undefined;
    const i = itemMap.get(String(c.item_id));
    return {
      id: c.requirement_id, projectId: c.project_id, project: projMap.get(c.project_id) ?? c.project_id, itemId: String(c.item_id),
      itemCode: String(i?.code ?? '—'), itemDescription: String(i?.description ?? 'Item'), unit: String(c.unit ?? i?.unit ?? ''),
      title: String(meta?.title ?? 'Requisito'), requiredBy: c.required_by, activityStart: str(act?.planned_start), activity: str(act?.title),
      coverage: fromViewRow(c),
    };
  });

  const inbound: IntelligenceFacts['inbound'] = [];
  for (const a of (allocs.data ?? []) as Row[]) {
    const line = lineMap.get(String(a.line_id)); if (!line) continue;
    const po = poMap.get(String(line.purchase_order_id)); if (!po || !LIVE_PO.includes(String(po.status))) continue;
    const open = num(a.quantity) - num(a.received_quantity); if (open <= 0) continue;
    inbound.push({ requirementId: String(a.requirement_id), kind: 'PO', refId: String(po.id), refNumber: String(po.order_number),
      supplierId: String(po.supplier_id), supplier: supplierName.get(String(po.supplier_id)) ?? null, quantity: open, eta: poEta(po, line) });
  }
  const trMap = new Map(((transfers.data ?? []) as Row[]).map((t) => [String(t.id), t]));
  for (const l of (transitLines.data ?? []) as Row[]) {
    const t = trMap.get(String(l.transfer_id)); if (!t || !['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(String(t.status))) continue;
    const open = num(l.dispatched_quantity) - num(l.received_quantity); if (open <= 0) continue;
    inbound.push({ requirementId: String(l.requirement_id), kind: 'TRANSFER', refId: String(t.id), refNumber: String(t.transfer_number),
      supplierId: null, supplier: null, quantity: open, eta: str(t.expected_arrival) });
  }

  const reqNeed = new Map(requirements.map((r) => [r.id, r.requiredBy]));
  const orders = poRows.map((po) => {
    const lines = ((poLines.data ?? []) as Row[]).filter((l) => l.purchase_order_id === po.id);
    const open = lines.reduce((a, l) => a + Math.max(0, num(l.quantity) - num(l.received_quantity)), 0);
    const etas = lines.filter((l) => num(l.quantity) > num(l.received_quantity)).map((l) => poEta(po, l)).filter(Boolean) as string[];
    const eta = etas.sort()[0] ?? poEta(po);
    const needs = ((allocs.data ?? []) as Row[]).filter((a) => lines.some((l) => l.id === a.line_id))
      .map((a) => reqNeed.get(String(a.requirement_id))).filter(Boolean) as string[];
    const lateDays = eta && eta < today ? Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${eta}T12:00:00Z`)) / 86_400_000) : 0;
    return { id: String(po.id), number: String(po.order_number), supplierId: String(po.supplier_id),
      supplier: supplierName.get(String(po.supplier_id)) ?? 'Fornecedor', status: String(po.status), eta: eta ?? null, open,
      needDate: needs.sort()[0] ?? null, projectId: str(po.project_id), submittedAt: str(po.submitted_at), lateDays };
  });

  const rfqByLine = new Set(((rfqLines.data ?? []) as Row[]).map((l) => String(l.requisition_line_id)));
  const requisitions = rqRows.map((q) => {
    const lines = rqLineRows.filter((l) => l.requisition_id === q.id);
    const reqIdsOf = ((rqAllocs.data ?? []) as Row[]).filter((a) => lines.some((l) => l.id === a.line_id)).map((a) => String(a.requirement_id));
    return { id: String(q.id), number: String(q.requisition_number), status: String(q.status), requestedAt: String(q.requested_at),
      requirementIds: Array.from(new Set(reqIdsOf)), needDate: str(q.required_by), projectId: str(q.project_id),
      inRfq: lines.some((l) => rfqByLine.has(String(l.id))) };
  });

  const projectSites: IntelligenceFacts['projectSites'] = {};
  for (const l of locRows.filter((x) => x.kind === 'PROJECT_SITE' && x.project_id)) {
    (projectSites[String(l.project_id)] ??= []).push({ id: String(l.id), name: String(l.name) });
  }
  const stockFacts = ((stock.data ?? []) as Row[]).filter((s) => locMap.has(String(s.location_id))).map((s) => ({
    itemId: String(s.item_id), locationId: String(s.location_id), locationName: String(locMap.get(String(s.location_id))?.name ?? 'Local'),
    locationKind: String(s.location_kind), available: num(s.available_qty) }));
  const transit = ((transfersDone.data ?? []) as Row[]).map((t) => ({ fromId: String(t.from_location_id), toId: String(t.to_location_id),
    days: Math.max(0, (Date.parse(String(t.received_at)) - Date.parse(String(t.dispatched_at))) / 86_400_000) }));
  const poNumber = new Map(poRows.map((p) => [String(p.id), String(p.order_number)]));
  const inspectionFacts = ((inspections.data ?? []) as Row[]).map((r) => ({ receiptId: String(r.id), number: String(r.receipt_number),
    receivedAt: String(r.received_at), purchaseOrderId: String(r.purchase_order_id), orderNumber: poNumber.get(String(r.purchase_order_id)) ?? 'pedido',
    location: String(locMap.get(String(r.location_id))?.name ?? 'quarentena') }));
  const supplierPerformance = Object.fromEntries(((perf.data ?? []) as Row[]).map((p) => [String(p.supplier_id),
    { promised: num(p.promised_lines), onTime: num(p.on_time_lines) }]));

  return { today, requirements, stock: stockFacts, projectSites, inbound, orders, requisitions, supplierPerformance, transit, inspections: inspectionFacts };
}

/** Uma leitura completa: fatos → sinais → livro sincronizado (a Apex, não uma pessoa). */
export async function runSupplyIntelligence(org: string, today: string) {
  const facts = await gatherIntelligenceFacts(org, today);
  const signals: SupplySignal[] = computeSignals(facts);
  const { data, error } = await platformServiceClient().rpc('supply_signals_sync', {
    p_organization_id: org, p_signals: signals, p_engine_version: ENGINE_VERSION });
  if (error) throw new Error(`Não foi possível registrar a leitura da Apex: ${error.message}`);
  return { signals: signals.length, ...(data as { opened: number; updated: number; resolved: number }) };
}

/** O que a pessoa vê (RLS): abertas + decididas/resolvidas recentes, e quando a Apex leu por último. */
export async function listSupplySignals(session: { supabase: SupabaseClient; organizationId: string }, opts: { projectId?: string } = {}) {
  const sb = session.supabase; const org = session.organizationId;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let query = sb.from('supply_signals')
    .select('id,kind,severity,status,project_id,requirement_id,purchase_order_id,supplier_id,title,rationale,evidence,recommended_action,first_seen_at,last_seen_at,resolved_at,decided_by,decided_at,decision_note,execution_result,followup_id')
    .eq('organization_id', org).or(`status.eq.OPEN,decided_at.gte.${since},resolved_at.gte.${since}`)
    .order('last_seen_at', { ascending: false }).limit(500);
  if (opts.projectId) query = query.eq('project_id', opts.projectId);
  const [{ data, error }, run] = await Promise.all([
    query,
    sb.from('supply_intelligence_runs').select('ran_at,engine_version,opened,updated,resolved').eq('organization_id', org)
      .order('ran_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error) throw new Error('Não foi possível ler as recomendações da Apex.');
  const rows = (data ?? []) as Row[];
  const people = await resolveOwnerNames(org, rows.map((r) => r.decided_by as string | null));
  const projectIds = Array.from(new Set(rows.map((r) => r.project_id).filter(Boolean) as string[]));
  const { data: projects } = projectIds.length
    ? await sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', projectIds)
    : { data: [] as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }> };
  const projMap = new Map(((projects ?? []) as Array<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>)
    .map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2).name]));
  return {
    lastRun: run.data ? { ranAt: String((run.data as Row).ran_at), engineVersion: String((run.data as Row).engine_version) } : null,
    signals: rows.map((r) => ({
      id: String(r.id), kind: String(r.kind), severity: String(r.severity), status: String(r.status),
      projectId: str(r.project_id), project: r.project_id ? projMap.get(String(r.project_id)) ?? String(r.project_id) : null,
      requirementId: str(r.requirement_id), purchaseOrderId: str(r.purchase_order_id), supplierId: str(r.supplier_id),
      title: String(r.title), rationale: String(r.rationale),
      evidence: (r.evidence as Array<{ label: string; value: string; source?: string }>) ?? [],
      action: r.recommended_action as { kind: string; label: string; payload: Record<string, unknown> },
      firstSeenAt: String(r.first_seen_at), lastSeenAt: String(r.last_seen_at), resolvedAt: str(r.resolved_at),
      decidedBy: r.decided_by ? people[String(r.decided_by)] ?? null : null, decidedAt: str(r.decided_at), decisionNote: str(r.decision_note),
      followupId: str(r.followup_id),
    })),
  };
}

export type SupplySignalsModel = Awaited<ReturnType<typeof listSupplySignals>>;
