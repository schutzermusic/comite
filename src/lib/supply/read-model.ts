/**
 * READ MODELS do Supply — Planejamento de Materiais e Visão Geral (torre de
 * controle). Tudo derivado da visão de cobertura e dos requisitos canônicos,
 * lidos pelo cliente autenticado (RLS). Nenhum total é guardado.
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/read-model.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAllPages, selectIn } from '@/lib/supabase/select-in';
import { projectIdentity } from '@/lib/operations/project-identity';
import { daysBetween } from '@/lib/operations/overview-rules';
import { fromViewRow, supplyRisk, type CoverageSummary, type CoverageViewRow, type StockAtLocation, type SupplyRisk } from './coverage';
import {
  PENDING_TRANSFER_STATUSES, pendingTransferRefsByRequirement, promisedByOrigin, stockForRequirement, type LocationKind, type PendingTransferHeadRow,
  type PendingTransferLineRow, type PendingTransferRef, type PositionRow,
} from './inventory';
import { needDate } from './intelligence';

type Session = { supabase: SupabaseClient; organizationId: string };

export interface MaterialDemandRow {
  requirementId: string;
  projectId: string; project: string; client: string | null;
  activityId: string | null; activity: string | null;
  itemId: string | null; itemCode: string | null; itemDescription: string | null;
  title: string; priority: string; unit: string | null; requirementType: string;
  requiredBy: string | null;
  /** Início planejado da atividade que consome o material. */
  activityStart: string | null;
  /**
   * A NECESSIDADE: a mais cedo entre o `required_by` do requisito e o início da
   * atividade — a mesma regra da Apex; risco e prazo contam a partir dela.
   */
  needBy: string | null;
  daysToNeed: number | null;
  /** A cobertura viva — com `pendingTransfer` e `purchasable` da regra 246 (lidos da visão). */
  coverage: CoverageSummary;
  risk: SupplyRisk;
  /**
   * 246: as transferências PEDIDAS/APROVADAS (sem reserva na origem) deste
   * requisito — o que `coverage.pendingTransfer` soma —, com o link para
   * resolvê-las no Estoque. Vazio sem nenhuma.
   */
  pendingTransfers: PendingTransferRef[];
  /**
   * Saldo LIVRE do item por local (disponível = em mão − reservado − o já
   * prometido a transferências pedidas, `promised`), destino primeiro.
   */
  stock: StockAtLocation[];
  /** O item no estoque, somado nos locais ativos (null sem item vinculado). */
  itemStock: ItemStockTotals | null;
  /** Canteiros cadastrados do projeto — destino natural de uma transferência. */
  sites: Array<{ id: string; name: string }>;
}

/** A posição do ITEM no estoque (todos os locais ativos): o outro lado da equação do requisito. */
export interface ItemStockTotals { onHand: number; reserved: number; available: number; quarantine: number }

type Paged = (f: number, t: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
/**
 * Lista INTEIRA em páginas de 1 000, com ordem total: o PostgREST corta cada resposta em 1 000 linhas, seja qual for
 * o `.limit()` — a demanda (982 requisitos no QA), os locais (1 139) e o cadastro (1 015 itens) já passavam disso e
 * voltavam cortados, sem aviso. Erro sobe com a mensagem da leitura.
 */
function whole<T = Record<string, unknown>>(what: string, page: Paged): Promise<T[]> {
  return selectAllPages<T>(page as (f: number, t: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>)
    .catch((cause) => { throw new Error(what, { cause }); });
}

/** Posição por item e local para os itens da demanda (vazio sem leitura de estoque — RLS). */
async function availableStock(sb: SupabaseClient, org: string, itemIds: string[]) {
  if (!itemIds.length) return { position: [] as PositionRow[], totals: new Map<string, ItemStockTotals>(),
    locations: [] as Array<{ id: string; name: string; kind: LocationKind; project_id: string | null; active: boolean }> };
  // Em lotes: com a lista inteira na URL o PostgREST devolvia 414 e a falha
  // virava "sem estoque" — a tela mandava comprar o que havia no almoxarifado.
  // Cada lote de itens também em páginas: 100 itens em muitos locais passam de 1 000 linhas.
  const [pos, locations] = await Promise.all([
    selectIn<Record<string, unknown>>(itemIds, (chunk) => whole('Não foi possível ler a posição de estoque.', (f, t) => sb.from('inventory_position')
      .select('item_id,location_id,location_kind,on_hand_qty,reserved_qty,available_qty')
      .eq('organization_id', org).in('item_id', chunk).order('item_id').order('location_id').range(f, t)).then((data) => ({ data, error: null }))),
    whole<{ id: string; name: string; kind: LocationKind; project_id: string | null; active: boolean }>('Não foi possível ler os locais de estoque.',
      (f, t) => sb.from('inventory_locations').select('id,name,kind,project_id,active').eq('organization_id', org).order('id').range(f, t)),
  ]);
  const locMap = new Map(locations.map((l) => [l.id, l]));
  const position: PositionRow[] = pos
    .filter((r) => locMap.get(String(r.location_id))?.active)
    .map((r) => ({
      itemId: String(r.item_id), itemCode: '', itemDescription: '', unit: '', tracking: 'NONE',
      locationId: String(r.location_id), locationCode: '', locationName: locMap.get(String(r.location_id))?.name ?? 'Local',
      locationKind: r.location_kind as LocationKind, onHand: Number(r.on_hand_qty), reserved: Number(r.reserved_qty),
      available: Number(r.available_qty), inspection: 0, inboundTransit: 0, lastMovementAt: null,
    }));
  // Quarentena não é disponibilidade: fica à parte (entra na cobertura como "em inspeção").
  const totals = new Map<string, ItemStockTotals>();
  for (const p of position) {
    const t = totals.get(p.itemId) ?? { onHand: 0, reserved: 0, available: 0, quarantine: 0 };
    if (p.locationKind === 'QUARANTINE') t.quarantine += p.onHand;
    else { t.onHand += p.onHand; t.reserved += p.reserved; t.available += Math.max(0, p.available); }
    totals.set(p.itemId, t);
  }
  return { position, locations, totals };
}

/**
 * 246: as transferências PEDIDAS/APROVADAS e as suas linhas (sem reserva na
 * origem) — o saldo que vão tirar de cada origem (`promisedByOrigin`, não
 * oferecido de novo, com ou sem requisito) e a lista de cada requisito
 * (`pendingTransferRefsByRequirement`). Uma falha SOBE: sem ela, a tela
 * sugeriria transferir o que já está prometido.
 */
async function pendingTransfers(sb: SupabaseClient, org: string) {
  const transfers = await whole<PendingTransferHeadRow>('Não foi possível ler as transferências pedidas.', (f, t) => sb.from('inventory_transfers')
    .select('id,transfer_number,status,from_location_id').eq('organization_id', org).in('status', [...PENDING_TRANSFER_STATUSES])
    .order('id').range(f, t));
  const lines = await selectIn<PendingTransferLineRow>(transfers.map((t) => t.id), (c) => sb.from('inventory_transfer_lines')
    .select('transfer_id,item_id,requirement_id,quantity,source_reservation_id').eq('organization_id', org).in('transfer_id', c))
    .catch(() => { throw new Error('Não foi possível ler as linhas das transferências pedidas.'); });
  return { byRequirement: pendingTransferRefsByRequirement(lines, transfers), promised: promisedByOrigin(lines, transfers) };
}

export async function materialDemand(session: Session, today: string, projectId?: string): Promise<MaterialDemandRow[]> {
  const org = session.organizationId;
  const sb = session.supabase;
  const rows = await whole<CoverageViewRow>('Não foi possível ler a demanda de material.', (f, t) => {
    let query = sb.from('supply_requirement_coverage').select('*').eq('organization_id', org);
    if (projectId) query = query.eq('project_id', projectId);
    return query.order('required_by', { ascending: true, nullsFirst: false }).order('requirement_id').range(f, t);
  });
  if (!rows.length) return [];
  const ids = rows.map((r) => r.requirement_id);
  const projectIds = Array.from(new Set(rows.map((r) => r.project_id)));
  const itemIds = Array.from(new Set(rows.map((r) => r.item_id).filter(Boolean))) as string[];
  const activityIds = Array.from(new Set(rows.map((r) => r.activity_id).filter(Boolean))) as string[];
  const [reqs, projects, items, acts] = await Promise.all([
    selectIn<{ id: string; title: string; priority: string }>(ids, (c) => sb.from('project_requirements')
      .select('id,title,priority').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>(projectIds, (c) => sb.from('projects')
      .select('id,project,project_v2').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; code: string; description: string }>(itemIds, (c) => sb.from('supply_items')
      .select('id,code,description').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; title: string; planned_start: string | null }>(activityIds, (c) => sb.from('project_timeline_items')
      .select('id,title,planned_start').eq('organization_id', org).in('id', c)),
  ]);
  const reqMap = new Map(reqs.map((r) => [r.id, r]));
  const projMap = new Map(projects.map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2)]));
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const actMap = new Map(acts.map((a) => [a.id, a]));
  const [stock, pending] = await Promise.all([availableStock(sb, org, itemIds), pendingTransfers(sb, org)]);
  const sitesOf = (projectId: string) => stock.locations
    .filter((l) => l.kind === 'PROJECT_SITE' && l.project_id === projectId && l.active).map((l) => ({ id: l.id, name: l.name }));

  return rows.map((r) => {
    const coverage = fromViewRow(r);
    const activity = r.activity_id ? actMap.get(r.activity_id) : undefined;
    const activityStart = activity?.planned_start ?? null;
    const needBy = needDate({ requiredBy: r.required_by, activityStart });
    const daysToNeed = needBy ? daysBetween(today, needBy) : null;
    const item = r.item_id ? itemMap.get(r.item_id) : undefined;
    const req = reqMap.get(r.requirement_id);
    return {
      requirementId: r.requirement_id, projectId: r.project_id, project: projMap.get(r.project_id)?.name ?? r.project_id,
      client: projMap.get(r.project_id)?.client ?? null,
      activityId: r.activity_id, activity: activity?.title ?? null,
      itemId: r.item_id, itemCode: item?.code ?? null, itemDescription: item?.description ?? null,
      title: req?.title ?? item?.description ?? 'Material', requirementType: r.requirement_type, priority: req?.priority ?? 'medium', unit: r.unit,
      requiredBy: r.required_by, activityStart, needBy, daysToNeed, coverage, risk: supplyRisk(coverage, daysToNeed),
      pendingTransfers: pending.byRequirement.get(r.requirement_id) ?? [],
      stock: r.item_id ? stockForRequirement(stock.position, r.item_id, sitesOf(r.project_id).map((x) => x.id), pending.promised) : [],
      itemStock: r.item_id ? stock.totals.get(r.item_id) ?? { onHand: 0, reserved: 0, available: 0, quarantine: 0 } : null,
      sites: sitesOf(r.project_id),
    };
  });
}

const RISK_RANK: Record<SupplyRisk, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export async function supplyOverview(session: Session, today: string, preloaded?: MaterialDemandRow[]) {
  const demand = preloaded ?? await materialDemand(session, today);
  const short = demand.filter((d) => d.coverage.shortage > 0);
  const critical = short.filter((d) => d.risk === 'critical');
  const byProject = new Map<string, { projectId: string; project: string; client: string | null; shortages: number;
    critical: number; nextNeed: string | null; worst: SupplyRisk }>();
  for (const d of short) {
    const p = byProject.get(d.projectId) ?? { projectId: d.projectId, project: d.project, client: d.client, shortages: 0,
      critical: 0, nextNeed: null, worst: 'low' as SupplyRisk };
    p.shortages += 1;
    if (d.risk === 'critical') p.critical += 1;
    if (d.needBy && (!p.nextNeed || d.needBy < p.nextNeed)) p.nextNeed = d.needBy;
    if (RISK_RANK[d.risk] < RISK_RANK[p.worst]) p.worst = d.risk;
    byProject.set(d.projectId, p);
  }
  const flow = await supplyFlow(session, today);
  return {
    today,
    flow,
    kpis: {
      demandLines: demand.length,
      uncovered: short.length,
      criticalShortages: critical.length,
      projectsExposed: Array.from(byProject.values()).filter((p) => p.worst === 'critical' || p.worst === 'high').length,
      covered: demand.filter((d) => d.coverage.status === 'COVERED').length,
    },
    projectRisks: Array.from(byProject.values()).sort((a, b) => RISK_RANK[a.worst] - RISK_RANK[b.worst] || b.shortages - a.shortages),
    criticalShortages: short.sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || (a.needBy ?? '').localeCompare(b.needBy ?? ''))
      .slice(0, 25),
  };
}

export type SupplyOverviewModel = Awaited<ReturnType<typeof supplyOverview>>;

/**
 * O FLUXO de compras e recebimento para a torre de controle (234/235): valor
 * em pedido aberto, entradas atrasadas, divergências de recebimento e
 * decisões de compra paradas — cada número abre a tela que o explica.
 *
 * Toda leitura é conferida: uma consulta que falha SOBE (a tela diz "não
 * carregou"), nunca vira 0 entrada atrasada ou 0 decisão parada.
 */
export async function supplyFlow(session: Session, today: string) {
  const sb = session.supabase; const org = session.organizationId;
  const since = new Date(`${today}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 30);
  const [poRows, reqs, receiptRows] = await Promise.all([
    whole<{ id: string; status: string; expected_delivery: string | null }>('Não foi possível ler os pedidos de compra.', (f, t) => sb.from('purchase_orders')
      .select('id,status,expected_delivery,currency').eq('organization_id', org)
      .in('status', ['APPROVAL_REQUIRED', 'ISSUED', 'PARTIALLY_RECEIVED']).order('id').range(f, t)),
    sb.from('purchase_requisitions').select('id', { count: 'exact', head: true }).eq('organization_id', org).in('status', ['SUBMITTED', 'SOURCING']),
    whole<{ id: string; inspection_status: string }>('Não foi possível ler os recebimentos.', (f, t) => sb.from('goods_receipts')
      .select('id,inspection_status').eq('organization_id', org)
      .or(`inspection_status.eq.PENDING,received_at.gte.${since.toISOString()}`).order('id').range(f, t)),
  ]);
  if (reqs.error || reqs.count === null) throw new Error('Não foi possível contar as requisições de compra.');
  const live = poRows.filter((p) => p.status !== 'APPROVAL_REQUIRED');
  // `selectIn` já sobe o erro; aqui ele ganha a mensagem em português.
  const [lineRows, shipRows, receiptLines] = await Promise.all([
    selectIn<{ purchase_order_id: string; quantity: number; received_quantity: number; unit_price: number; expected_date: string | null }>(
      live.map((p) => p.id), (c) => sb.from('purchase_order_lines').select('purchase_order_id,quantity,received_quantity,unit_price,expected_date')
        .eq('organization_id', org).in('purchase_order_id', c)),
    selectIn<{ purchase_order_id: string; eta: string | null }>(live.map((p) => p.id), (c) => sb.from('inbound_shipments')
      .select('purchase_order_id,eta,status').eq('organization_id', org).in('purchase_order_id', c).in('status', ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'])),
    selectIn<{ receipt_id: string; rejected_quantity: number; inspection_rejected_quantity: number | null }>(receiptRows.map((r) => r.id), (c) => sb
      .from('goods_receipt_lines').select('receipt_id,rejected_quantity,inspection_rejected_quantity').eq('organization_id', org).in('receipt_id', c)),
  ]).catch((cause: unknown) => {
    throw new Error('Não foi possível ler as linhas de pedido, embarques e recebimentos.', { cause });
  });
  const openValue = lineRows.reduce((a, l) => a + Math.max(0, Number(l.quantity) - Number(l.received_quantity)) * Number(l.unit_price), 0);
  const lateInbound = live.filter((p) => {
    const open = lineRows.filter((l) => l.purchase_order_id === p.id && Number(l.quantity) > Number(l.received_quantity));
    if (!open.length) return false;
    const eta = shipRows.filter((x) => x.purchase_order_id === p.id && x.eta).map((x) => x.eta as string).sort()[0]
      ?? open.map((l) => l.expected_date).filter(Boolean).sort()[0] ?? p.expected_delivery;
    return Boolean(eta && eta < today);
  }).length;
  const rejectedReceipts = new Set(receiptLines
    .filter((l) => Number(l.rejected_quantity) > 0 || Number(l.inspection_rejected_quantity ?? 0) > 0).map((l) => l.receipt_id));
  return {
    openPoValue: openValue,
    lateInbound,
    receivingIssues: receiptRows.filter((r) => r.inspection_status === 'PENDING' || rejectedReceipts.has(r.id)).length,
    decisionsPending: reqs.count + poRows.filter((p) => p.status === 'APPROVAL_REQUIRED').length,
    /** Requisições SUBMITTED/SOURCING — a mesma contagem que entra em `decisionsPending`, separada dos pedidos. */
    requisitionsAwaitingSourcing: reqs.count,
  };
}

export async function listItems(session: Session, includeInactive: boolean) {
  return whole('Não foi possível consultar o cadastro de itens.', (f, t) => {
    let query = session.supabase.from('supply_items')
      .select('id,code,description,category,unit,manufacturer,brand,tracking,active,technical_attributes,updated_at')
      .eq('organization_id', session.organizationId);
    if (!includeInactive) query = query.eq('active', true);
    return query.order('code').order('id').range(f, t);
  });
}
