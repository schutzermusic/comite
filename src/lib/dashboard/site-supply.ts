/**
 * SUPPLY CHAIN DO LOCAL — `GET /api/dashboard/site/[projectId]/supply` (server-only).
 *
 * O balanço de material do projeto (cobertura AO VIVO), o material em foco e,
 * para ele: onde o MESMO item está na rede (estoque), os pedidos abertos, os
 * achados da Apex e a decisão da caixa DESTA pessoa que se aprova aqui (pelo
 * mesmo ato de Decisões). Tudo pelo cliente AUTENTICADO da sessão
 * (`session.supabase`), com `.eq('organization_id')` em cada leitura e os
 * `.in()` em lotes. Nenhuma leitura nova pelo service role: a única que existe
 * é o enriquecimento da caixa (`enrichInbox`), a mesma do Dashboard.
 *
 * Portões = espelho da RLS (conferida no banco de QA):
 *  • o local inteiro: `projects.view` (o mesmo portão dos marcadores do globo);
 *  • estoque: `inventory_position` é `security_invoker` e o saldo em mão vem de
 *    `inventory_movements` — inventory.view OU supply.view OU receiving.view.
 *    Quem lê só reservas e transferências veria "disponível" negativo: Restrito;
 *  • pedidos: a RLS de `purchase_orders`/`purchase_order_lines`; o VALOR só com
 *    procurement.view OU supply.view — a mesma pergunta de Decisões
 *    (`decision_viewer_reads_subject`) e o portão da tela de Compras;
 *  • achados: as chaves da RLS de `supply_signals`.
 * Restrito nunca é 0; uma leitura que falhou volta `error`, nunca lista vazia.
 */
if (typeof window !== 'undefined') {
  throw new Error('dashboard/site-supply.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { hasOptionalPermission, type CommercialSession } from '@/lib/commercial/server-session';
import { projectIdentity } from '@/lib/operations/project-identity';
import { selectIn } from '@/lib/supabase/select-in';
import { fromViewRow, supplyRisk, type CoverageViewRow } from '@/lib/supply/coverage';
import { LOCATION_KIND_LABEL, type LocationKind } from '@/lib/supply/inventory';
import { PO_STATUS_LABEL, type PurchaseOrderStatus } from '@/lib/supply/procurement';
import { listSupplySignals } from '@/lib/supply/intelligence-read';
import { enrichInbox, viewerInbox } from '@/lib/decisions/read';
import { decisionHref, effectiveDeadline, prioritize } from '@/lib/decisions/model';
import type { DecisionInboxRow, DecisionItem } from '@/lib/decisions/types';
import { amountText } from '@/components/decisions/view';
import { resolveGates, SECTION_TIMEOUT_MS } from './overview';
import {
  apexNote, daysFrom, isoDay, materialNeedDate, STALE_ON_COVERAGE, MATERIAL_WINDOW_DAYS, type SignalLike,
} from './rules';
import type {
  ApexNote, InboundOrder, MaterialBalance, SectionState, SiteSupplyData, SiteSupplyResponse, StockNode, SupplyDecision,
} from './types';

type Session = CommercialSession;
type Row = Record<string, unknown>;

/** Teto de linhas por leitura (o `max_rows` do PostgREST): chegar nele marca `truncated`. */
const READ_LIMIT = 1000;

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/* ══════════════════════════════════════════════════════════════════════════
   Comum às rotas do local (supply e faturamento)
   ══════════════════════════════════════════════════════════════════════════ */

/** Ids de projeto são texto (`qa-scn-tucurui`, `proj-<uuid>`): só isto entra num filtro. */
export const SITE_PROJECT_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function isSiteProjectId(value: unknown): value is string {
  return typeof value === 'string' && SITE_PROJECT_ID.test(value);
}

export type SiteFailureReason = 'invalid' | 'not_found' | 'restricted' | 'error';

/** As MESMAS frases da rota do local (`site-common.ts`): a tela não distingue a rota. */
export const SITE_FAILURE_MESSAGE: Record<SiteFailureReason, string> = {
  invalid: 'Identificador de projeto inválido.',
  not_found: 'Projeto não encontrado nesta organização.',
  restricted: 'Seu perfil não lê projetos.',
  error: 'Não foi possível ler este projeto agora. Tente de novo em instantes.',
};

/** A resposta de falha das rotas do local: 200 com o motivo no corpo (`error` repete a mensagem para o leitor genérico). */
export function siteFailure(reason: SiteFailureReason, message = SITE_FAILURE_MESSAGE[reason]) {
  return { ok: false as const, reason, message, error: message };
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado ao ler ${label}.`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

/** Uma parte isolada: portão fechado → `restricted`; falha ou prazo → `error` (nunca vazio calmo). */
export async function sitePart<T>(
  gate: boolean, label: string, run: () => Promise<T>, timings: Record<string, number> | undefined, key: string,
  timeoutMs = SECTION_TIMEOUT_MS,
): Promise<SectionState<T>> {
  if (!gate) return { state: 'restricted' };
  const started = Date.now();
  try {
    return { state: 'ok', data: await withTimeout(Promise.resolve().then(run), timeoutMs, label) };
  } catch (error) {
    console.error(`[dashboard/site] ${key} falhou`, error);
    return { state: 'error', message: `Não foi possível ler ${label}.` };
  } finally {
    if (timings) timings[key] = Date.now() - started;
  }
}

/** O projeto, lido sob a RLS de `projects` e SEMPRE na organização ativa. `null` = não existe (ou não é desta organização). */
export async function loadSiteProject(sb: SupabaseClient, org: string, id: string): Promise<{ id: string; name: string } | null> {
  const res = await sb.from('projects').select('id,project,project_v2').eq('organization_id', org).eq('id', id).maybeSingle();
  if (res.error) throw new Error('projeto');
  const row = res.data as { id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null } | null;
  return row ? { id: row.id, name: projectIdentity(row.id, row.project, row.project_v2).name } : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   Regras puras (testadas em tests/unit/dashboard-site-supply.test.ts)
   ══════════════════════════════════════════════════════════════════════════ */

/** Janela da "necessidade próxima": de 14 dias atrás até 30 dias à frente (a do calendário do Dashboard). */
export const NEAR_NEED_DAYS = 30;

export const MATERIALS_RULE = 'Requisito confirmado com falta, ou com necessidade entre 14 dias atrás e os próximos 30 dias';

export interface CoverageMeta {
  titles: ReadonlyMap<string, string | null>;
  activities: ReadonlyMap<string, { id: string; title: string | null; plannedStart: string | null }>;
  items: ReadonlyMap<string, { id: string; code: string | null; description: string | null; unit: string | null }>;
}

const RISK_RANK: Record<MaterialBalance['risk'], number> = { critical: 0, high: 1, medium: 2, ok: 3 };

/** Uma linha da cobertura VIVA → o balanço do protótipo (números na unidade do requisito). */
export function materialBalance(row: CoverageViewRow, meta: CoverageMeta, today: string): MaterialBalance {
  const c = fromViewRow(row);
  const act = row.activity_id ? meta.activities.get(row.activity_id) : undefined;
  const item = row.item_id ? meta.items.get(row.item_id) : undefined;
  const activity = act ? { id: act.id, title: act.title, plannedStart: act.plannedStart } : null;
  const needBy = materialNeedDate({ requiredBy: row.required_by, activity });
  const risk = supplyRisk(c, needBy ? daysFrom(today, needBy) : null);
  return {
    requirementId: row.requirement_id,
    title: meta.titles.get(row.requirement_id) ?? item?.description ?? 'Material do requisito',
    item: row.item_id
      ? { id: row.item_id, code: item?.code ?? null, description: item?.description ?? null, unit: item?.unit ?? row.unit ?? null }
      : null,
    activity: act ? { id: act.id, title: act.title ?? 'Atividade do cronograma', start: isoDay(act.plannedStart) } : null,
    needBy,
    required: c.required,
    reserved: c.reserved,
    consumed: c.consumed,
    inTransit: c.inTransit,
    onOrder: c.onOrder,
    requested: c.requested,
    covered: c.covered,
    inbound: c.inbound,
    inspection: c.inspection,
    shortage: c.shortage,
    risk: risk === 'low' ? 'ok' : risk,
    href: `/supply/planejamento-materiais?req=${encodeURIComponent(row.requirement_id)}`,
  };
}

/** Entra no balanço: tem falta, ou a necessidade está perto (de 14 dias atrás a 30 à frente). */
export function inMaterialScope(m: Pick<MaterialBalance, 'shortage' | 'needBy'>, today: string): boolean {
  if (m.shortage > 0) return true;
  if (!m.needBy) return false;
  const d = daysFrom(today, m.needBy);
  return d >= -MATERIAL_WINDOW_DAYS && d <= NEAR_NEED_DAYS;
}

/** risco → necessidade mais cedo (sem data por último) → título → id. */
export function compareMaterials(a: MaterialBalance, b: MaterialBalance): number {
  const r = RISK_RANK[a.risk] - RISK_RANK[b.risk];
  if (r) return r;
  if (a.needBy !== b.needBy) { if (!a.needBy) return 1; if (!b.needBy) return -1; return a.needBy < b.needBy ? -1 : 1; }
  return a.title.localeCompare(b.title, 'pt-BR') || a.requirementId.localeCompare(b.requirementId);
}

/**
 * O material em foco: o pedido explícito (`?req=`) quando está no balanço;
 * senão o primeiro da ordem — a falta mais grave (risco → necessidade mais
 * cedo). Sem nenhuma falta, o de necessidade mais próxima.
 */
export function pickFocus(materials: readonly MaterialBalance[], requested?: string | null): MaterialBalance | null {
  if (requested) {
    const hit = materials.find((m) => m.requirementId === requested);
    if (hit) return hit;
  }
  return materials[0] ?? null;
}

const validLat = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= -90 && n <= 90 ? n : null;
};
const validLng = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= -180 && n <= 180 ? n : null;
};

export interface PositionRow { location_id: string; on_hand_qty: unknown; reserved_qty: unknown; available_qty: unknown }
export interface LocationRow {
  id: string; code: string | null; name: string | null; kind: string; project_id: string | null;
  latitude: unknown; longitude: unknown; active?: boolean | null;
}

/**
 * Posições do item na rede → nós do mapa. Um local sem nada (em mão,
 * reservado e disponível zerados) não é "onde o item está" e sai — exceto o
 * canteiro deste projeto, que é o destino. Canteiro primeiro, depois o maior
 * disponível.
 */
export function stockNodes(positions: readonly PositionRow[], locations: ReadonlyMap<string, LocationRow>, projectId: string): StockNode[] {
  const out: StockNode[] = [];
  for (const p of positions) {
    const loc = locations.get(p.location_id);
    if (!loc) continue;
    const isSite = loc.kind === 'PROJECT_SITE' && loc.project_id === projectId;
    const onHand = num(p.on_hand_qty); const reserved = num(p.reserved_qty); const available = num(p.available_qty);
    if (!isSite && onHand === 0 && reserved === 0 && available === 0) continue;
    const lat = validLat(loc.latitude); const lng = validLng(loc.longitude);
    out.push({
      locationId: loc.id, code: loc.code ?? null, name: loc.name ?? loc.code ?? 'Local', kind: loc.kind,
      kindLabel: LOCATION_KIND_LABEL[loc.kind as LocationKind] ?? 'Local',
      lat: lat !== null && lng !== null ? lat : null, lng: lat !== null && lng !== null ? lng : null,
      onHand, reserved, available, isSite,
    });
  }
  return out.sort((a, b) => Number(b.isSite) - Number(a.isSite) || b.available - a.available || b.onHand - a.onHand
    || a.name.localeCompare(b.name, 'pt-BR'));
}

/** Pedido vivo: ainda não recebido por inteiro, nem encerrado/cancelado. */
export const OPEN_PO_STATUSES = ['DRAFT', 'APPROVAL_REQUIRED', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'] as const;

export interface PoRow {
  id: string; order_number: string | null; supplier_id: string | null; project_id: string | null; status: string;
  currency: string | null; freight_amount: unknown; tax_amount: unknown; expected_delivery: string | null;
}
export interface PoLineRow {
  id: string; purchase_order_id: string; item_id: string | null; quantity: unknown; unit_price: unknown;
  expected_date: string | null; received_quantity: unknown;
}
export interface PoAllocationRow { line_id: string; requirement_id: string; quantity: unknown; received_quantity: unknown }

export interface OrdersInput {
  pos: readonly PoRow[];
  lines: readonly PoLineRow[];
  allocations: readonly PoAllocationRow[];
  /** ETA do embarque vivo do pedido (a mesma precedência da Apex: embarque → linha → pedido). */
  shipEta: ReadonlyMap<string, string>;
  /** Nome do fornecedor; `null` = a pessoa não lê o cadastro de fornecedores ("Restrito"). */
  supplierName: (id: string) => string | null;
  focus: { requirementId: string; itemId: string | null; needBy: string | null };
  /** procurement.view OU supply.view — o valor do pedido só atravessa com isto. */
  amountVisible: boolean;
}

function poHref(po: Pick<PoRow, 'id' | 'status'>): string {
  const stage = po.status === 'APPROVAL_REQUIRED' ? 'aprovacao' : 'pedidos';
  return `/supply/compras?stage=${stage}&po=${encodeURIComponent(po.id)}`;
}

/**
 * Pedidos abertos do requisito/item em foco. Quantidade = o que ainda chega
 * PARA o requisito (alocação − recebido); sem alocação, o aberto das linhas do
 * item. Chegada = a mais cedo das linhas relevantes em aberto (embarque →
 * linha → pedido, a regra da Apex). Atrasado = chega DEPOIS da necessidade.
 */
export function inboundOrders(input: OrdersInput): InboundOrder[] {
  const { focus } = input;
  const out: InboundOrder[] = [];
  for (const po of input.pos) {
    const poLines = input.lines.filter((l) => l.purchase_order_id === po.id);
    const lineIds = new Set(poLines.map((l) => l.id));
    const allocs = input.allocations.filter((a) => lineIds.has(a.line_id) && a.requirement_id === focus.requirementId);
    const allocLineIds = new Set(allocs.map((a) => a.line_id));
    const relevant = poLines.filter((l) => allocLineIds.has(l.id) || (!!focus.itemId && l.item_id === focus.itemId));
    if (!relevant.length) continue;
    const qty = allocs.length
      ? allocs.reduce((s, a) => s + Math.max(0, num(a.quantity) - num(a.received_quantity)), 0)
      : relevant.reduce((s, l) => s + Math.max(0, num(l.quantity) - num(l.received_quantity)), 0);
    const eta = (line?: PoLineRow) => input.shipEta.get(po.id) ?? isoDay(line?.expected_date ?? null) ?? isoDay(po.expected_delivery);
    const openLines = relevant.filter((l) => num(l.quantity) > num(l.received_quantity));
    const expected = (openLines.length ? openLines.map((l) => eta(l)).filter((d): d is string => !!d).sort()[0] : eta()) ?? null;
    const late = !!(expected && focus.needBy && expected > focus.needBy);
    const total = poLines.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0) + num(po.freight_amount) + num(po.tax_amount);
    out.push({
      poId: po.id,
      number: po.order_number,
      supplier: po.supplier_id ? { id: po.supplier_id, name: input.supplierName(po.supplier_id) ?? 'Restrito' } : null,
      status: po.status,
      statusLabel: PO_STATUS_LABEL[po.status as PurchaseOrderStatus] ?? 'Pedido',
      expected,
      late,
      lateDays: late ? daysFrom(focus.needBy as string, expected as string) : null,
      qty,
      amountText: input.amountVisible && Number.isFinite(total) ? amountText(total, po.currency) : null,
      href: poHref(po),
    });
  }
  return out.sort((a, b) => Number(b.late) - Number(a.late)
    || (a.expected === b.expected ? 0 : !a.expected ? 1 : !b.expected ? -1 : a.expected < b.expected ? -1 : 1)
    || String(a.number ?? '').localeCompare(String(b.number ?? '')));
}

const NOTE_SEVERITY: Record<ApexNote['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Os achados ABERTOS da Apex sobre o material em foco (o requisito) ou os
 * seus pedidos. Um achado de FALTA (`STALE_ON_COVERAGE`) cujo requisito já
 * não tem falta ao vivo sai marcado `stale` — a mesma regra da fila e do
 * Entender. `liveShortage` devolve `null` quando a cobertura não foi lida
 * inteira (nunca "0" por suposição).
 */
export function focusApexNotes(
  signals: readonly SignalLike[], focusRequirementId: string, poIds: ReadonlySet<string>,
  liveShortage: (requirementId: string) => number | null,
): ApexNote[] {
  return signals
    .filter((s) => s.requirementId === focusRequirementId || (!!s.purchaseOrderId && poIds.has(s.purchaseOrderId)))
    .map((s) => apexNote(s, STALE_ON_COVERAGE.has(s.kind) && !!s.requirementId && liveShortage(s.requirementId) === 0))
    .sort((a, b) => Number(a.stale) - Number(b.stale) || NOTE_SEVERITY[a.severity] - NOTE_SEVERITY[b.severity]
      || a.signalId.localeCompare(b.signalId));
}

/**
 * As linhas da caixa que são DESTE local: pedido de compra do projeto, ou
 * pedido que cobre o material em foco (pedido de vários projetos). Só o que
 * aguarda a pessoa (PRIMARY/ESCALATED) — a mesma definição do selo.
 */
export function siteDecisionRows(rows: readonly DecisionInboxRow[], projectId: string, focusPoIds: ReadonlySet<string>): DecisionInboxRow[] {
  return rows.filter((r) => r.subject_type === 'purchase_order' && r.assignment !== 'ELIGIBLE'
    && (r.project_id === projectId || focusPoIds.has(r.subject_id)));
}

/** Item da caixa → a decisão do Supply do local (valor no formato da caixa; `null` quando a caixa não traz). */
export function supplyDecision(i: Pick<DecisionItem, 'key' | 'kindLabel' | 'title' | 'amount' | 'currency' | 'dueAt' | 'decideBy'
  | 'overdue' | 'subjectType' | 'subjectId'>): SupplyDecision {
  return {
    key: i.key,
    href: decisionHref(i.key),
    kindLabel: i.kindLabel,
    title: i.title,
    amountText: i.amount === null ? null : amountText(i.amount, i.currency),
    amountRestricted: false,
    due: effectiveDeadline(i),
    overdue: i.overdue,
    poId: i.subjectType === 'purchase_order' ? i.subjectId : null,
  };
}

/**
 * A posição do local no mapa — a regra do GLOBE.md §1: a oficial
 * (`project_globe_marker`); senão o ÚNICO canteiro ativo com coordenada
 * cadastrada no Supply. Mais de um canteiro com coordenada = ambíguo = sem ponto.
 */
export function siteCoordinate(
  markers: ReadonlyArray<{ latitude: unknown; longitude: unknown }>,
  sites: ReadonlyArray<{ latitude: unknown; longitude: unknown; active?: boolean | null; kind?: string | null }>,
): { lat: number; lng: number } | null {
  for (const m of markers) {
    const lat = validLat(m.latitude); const lng = validLng(m.longitude);
    if (lat !== null && lng !== null) return { lat, lng };
  }
  const located = sites.flatMap((s) => {
    if (s.active === false || (s.kind && s.kind !== 'PROJECT_SITE')) return [];
    const lat = validLat(s.latitude); const lng = validLng(s.longitude);
    return lat !== null && lng !== null ? [{ lat, lng }] : [];
  });
  return located.length === 1 ? located[0] : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   Leituras
   ══════════════════════════════════════════════════════════════════════════ */

const COVERAGE_COLUMNS = 'requirement_id,project_id,activity_id,item_id,requirement_type,required_by,unit,required_qty,'
  + 'reserved_qty,consumed_qty,in_transit_qty,on_order_qty,requested_qty,inspection_qty';

/** Até quantos requisitos a cobertura é lida requisito a requisito; acima disso, uma leitura por projeto. */
export const COVERAGE_FANOUT_MAX = 40;

/** `Promise.all` com no máximo `limit` em voo; a ordem da entrada é preservada e um erro SOBE. */
export async function mapLimit<T, U>(items: readonly T[], limit: number, run: (item: T) => Promise<U>): Promise<U[]> {
  const out = new Array<U>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await run(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

interface CoverageRead {
  materials: MaterialBalance[];
  /** Falta ao vivo de CADA requisito do projeto lido (para o `stale` da Apex). */
  shortageById: Map<string, number>;
  truncated: boolean;
}

/** A cobertura AO VIVO do projeto inteiro (com contagem exata) → o balanço, na ordem. */
async function readProjectCoverage(sb: SupabaseClient, org: string, projectId: string, today: string): Promise<CoverageRead> {
  // Os requisitos que a visão cobre (a MESMA base dela: confirmados, material ou serviço externo).
  const base = await sb.from('project_requirements').select('id,title', { count: 'exact' })
    .eq('organization_id', org).eq('project_id', projectId).eq('status', 'CONFIRMED')
    .in('requirement_type', ['MATERIAL', 'EXTERNAL_SERVICE']).order('id').limit(READ_LIMIT);
  if (base.error || base.count === null || base.count === undefined) throw new Error('requisitos do projeto');
  const reqs = (base.data ?? []) as Array<{ id: string; title: string | null }>;
  let rows: CoverageViewRow[];
  let truncated = base.count > reqs.length;
  if (reqs.length <= COVERAGE_FANOUT_MAX) {
    // Um requisito por leitura: o filtro por `requirement_id` desce até os agregados da visão
    // (~0,3 s cada no QA); por projeto ou por lista, a visão agrega a organização inteira (3–12 s).
    const each = await mapLimit(reqs, 6, async (r) => {
      const res = await sb.from('supply_requirement_coverage').select(COVERAGE_COLUMNS)
        .eq('organization_id', org).eq('requirement_id', r.id).limit(2);
      if (res.error) throw new Error('cobertura de material');
      return (res.data ?? []) as unknown as CoverageViewRow[];
    });
    rows = each.flat();
  } else {
    const res = await sb.from('supply_requirement_coverage').select(COVERAGE_COLUMNS, { count: 'exact' })
      .eq('organization_id', org).eq('project_id', projectId)
      .order('required_by', { ascending: true, nullsFirst: false }).order('requirement_id').limit(READ_LIMIT);
    if (res.error || res.count === null || res.count === undefined) throw new Error('cobertura de material');
    rows = (res.data ?? []) as unknown as CoverageViewRow[];
    truncated = truncated || res.count > rows.length;
  }
  const [acts, items] = await Promise.all([
    selectIn<{ id: string; title: string | null; planned_start: string | null }>(rows.map((r) => r.activity_id),
      (c) => sb.from('project_timeline_items').select('id,title,planned_start').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; code: string | null; description: string | null; unit: string | null }>(rows.map((r) => r.item_id),
      (c) => sb.from('supply_items').select('id,code,description,unit').eq('organization_id', org).in('id', c)),
  ]);
  const meta: CoverageMeta = {
    titles: new Map(reqs.map((r) => [r.id, r.title])),
    activities: new Map(acts.map((a) => [a.id, { id: a.id, title: a.title, plannedStart: a.planned_start }])),
    items: new Map(items.map((i) => [i.id, i])),
  };
  const all = rows.map((r) => materialBalance(r, meta, today));
  return {
    materials: all.filter((m) => inMaterialScope(m, today)).sort(compareMaterials),
    shortageById: new Map(all.map((m) => [m.requirementId, m.shortage])),
    truncated,
  };
}

/** Onde o item em foco está na rede (`inventory_position` + o cadastro dos locais). */
async function readStock(sb: SupabaseClient, org: string, projectId: string, itemId: string): Promise<{ nodes: StockNode[]; truncated: boolean }> {
  const res = await sb.from('inventory_position').select('location_id,on_hand_qty,reserved_qty,available_qty')
    .eq('organization_id', org).eq('item_id', itemId).order('location_id').limit(READ_LIMIT);
  if (res.error) throw new Error('posição de estoque');
  const positions = (res.data ?? []) as unknown as PositionRow[];
  const locations = await selectIn<LocationRow>(positions.map((p) => p.location_id),
    (c) => sb.from('inventory_locations').select('id,code,name,kind,project_id,latitude,longitude,active')
      .eq('organization_id', org).in('id', c));
  return { nodes: stockNodes(positions, new Map(locations.map((l) => [l.id, l])), projectId), truncated: positions.length >= READ_LIMIT };
}

interface OrdersRead { orders: InboundOrder[]; poIds: Set<string> }

/** Pedidos abertos do requisito em foco (pela alocação) e do item em foco nos pedidos DESTE projeto. */
async function readOrders(
  sb: SupabaseClient, org: string, projectId: string, focus: MaterialBalance,
  opts: { amountVisible: boolean; supplierNames: boolean },
): Promise<OrdersRead> {
  const [byReq, projectPos] = await Promise.all([
    sb.from('purchase_order_line_requirements').select('line_id').eq('organization_id', org)
      .eq('requirement_id', focus.requirementId).limit(READ_LIMIT),
    focus.item
      ? sb.from('purchase_orders').select('id').eq('organization_id', org).eq('project_id', projectId)
        .in('status', [...OPEN_PO_STATUSES]).limit(READ_LIMIT)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (byReq.error) throw new Error('alocações de pedido');
  if (projectPos.error) throw new Error('pedidos do projeto');
  const reqLines = await selectIn<{ id: string; purchase_order_id: string }>(((byReq.data ?? []) as Row[]).map((r) => str(r.line_id)),
    (c) => sb.from('purchase_order_lines').select('id,purchase_order_id').eq('organization_id', org).in('id', c));
  // Do projeto, só os pedidos com linha do item em foco.
  const itemLines = focus.item
    ? await selectIn<{ purchase_order_id: string }>(((projectPos.data ?? []) as Row[]).map((p) => str(p.id)),
      (c) => sb.from('purchase_order_lines').select('purchase_order_id').eq('organization_id', org)
        .eq('item_id', (focus.item as { id: string }).id).in('purchase_order_id', c))
    : [];
  const candidates = [...reqLines.map((l) => l.purchase_order_id), ...itemLines.map((l) => l.purchase_order_id)];
  const pos = await selectIn<PoRow>(candidates,
    (c) => sb.from('purchase_orders')
      .select('id,order_number,supplier_id,project_id,status,currency,freight_amount,tax_amount,expected_delivery')
      .eq('organization_id', org).in('status', [...OPEN_PO_STATUSES]).in('id', c));
  if (!pos.length) return { orders: [], poIds: new Set() };
  const poIds = pos.map((p) => p.id);
  const [lines, ships, suppliers] = await Promise.all([
    selectIn<PoLineRow>(poIds, (c) => sb.from('purchase_order_lines')
      .select('id,purchase_order_id,item_id,quantity,unit_price,expected_date,received_quantity')
      .eq('organization_id', org).in('purchase_order_id', c)),
    selectIn<{ purchase_order_id: string; eta: string | null }>(poIds, (c) => sb.from('inbound_shipments')
      .select('purchase_order_id,eta').eq('organization_id', org).in('status', ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'])
      .in('purchase_order_id', c)),
    opts.supplierNames
      ? selectIn<{ id: string; party_id: string | null }>(pos.map((p) => p.supplier_id),
        (c) => sb.from('supplier_profiles').select('id,party_id').eq('organization_id', org).in('id', c))
      : Promise.resolve([] as Array<{ id: string; party_id: string | null }>),
  ]);
  const allocations = await selectIn<PoAllocationRow>(lines.map((l) => l.id),
    (c) => sb.from('purchase_order_line_requirements').select('line_id,requirement_id,quantity,received_quantity')
      .eq('organization_id', org).in('line_id', c));
  const parties = opts.supplierNames
    ? await selectIn<{ id: string; legal_name: string | null; trade_name: string | null }>(suppliers.map((s) => s.party_id),
      (c) => sb.from('parties').select('id,legal_name,trade_name').eq('organization_id', org).in('id', c))
    : [];
  const partyName = new Map(parties.map((p) => [p.id, p.trade_name ?? p.legal_name ?? null]));
  const supplierName = new Map(suppliers.map((s) => [s.id, (s.party_id ? partyName.get(s.party_id) : null) ?? 'Fornecedor']));
  const shipEta = new Map<string, string>();
  for (const s of ships) {
    const d = isoDay(s.eta);
    const cur = shipEta.get(s.purchase_order_id);
    if (d && (!cur || d < cur)) shipEta.set(s.purchase_order_id, d);
  }
  const orders = inboundOrders({
    pos, lines, allocations, shipEta,
    supplierName: (id) => (opts.supplierNames ? supplierName.get(id) ?? 'Fornecedor' : null),
    focus: { requirementId: focus.requirementId, itemId: focus.item?.id ?? null, needBy: focus.needBy },
    amountVisible: opts.amountVisible,
  });
  return { orders, poIds: new Set(orders.map((o) => o.poId)) };
}

/** A posição do local: oficial, senão o único canteiro com coordenada. */
async function readSiteCoordinate(sb: SupabaseClient, org: string, projectId: string): Promise<{ lat: number; lng: number } | null> {
  const [markers, sites] = await Promise.all([
    sb.from('project_globe_marker').select('latitude,longitude').eq('organization_id', org).eq('project_id', projectId).limit(5),
    sb.from('inventory_locations').select('latitude,longitude,active,kind').eq('organization_id', org).eq('project_id', projectId)
      .eq('kind', 'PROJECT_SITE').eq('active', true).not('latitude', 'is', null).not('longitude', 'is', null).limit(20),
  ]);
  if (markers.error) throw new Error('localização oficial');
  if (sites.error) throw new Error('canteiro do projeto');
  return siteCoordinate((markers.data ?? []) as unknown as Array<{ latitude: unknown; longitude: unknown }>,
    (sites.data ?? []) as unknown as Array<{ latitude: unknown; longitude: unknown; active: boolean | null; kind: string | null }>);
}

/* ══════════════════════════════════════════════════════════════════════════
   Composição
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Prazo da caixa de Decisões nesta rota. A projeção (`decision_inbox_for_viewer`)
 * é a leitura mais lenta do Dashboard (5–13 s no QA com centenas de decisões
 * abertas) e a decisão é o ATO deste painel ("Aprovar compra"): ela ganha um
 * prazo próprio; passou dele, `decisions` volta `error` e o resto segue.
 */
export const INBOX_TIMEOUT_MS = 10_000;

const PERMISSION_KEYS = ['inventory.view', 'supply.view', 'receiving.view', 'procurement.view', 'suppliers.view', 'parties.view',
  'contracts.view', 'finance.view'] as const;

export interface SiteSupplyOptions {
  /** Material a focar (`?req=`); fora do balanço, vale o foco padrão. */
  focusRequirementId?: string | null;
}

/**
 * Monta o Supply Chain do local. Falha de validação, projeto inexistente ou
 * perfil sem `projects.view` → `ok: false` com o motivo (a rota responde 200).
 * Uma parte que cai vira `error` só nela; a cobertura que cai derruba a seção
 * `supply` inteira (sem balanço não há foco).
 */
export async function buildSiteSupply(
  session: Session, projectId: string, today: string, opts: SiteSupplyOptions = {}, timings?: Record<string, number>,
): Promise<SiteSupplyResponse> {
  if (!isSiteProjectId(projectId)) return siteFailure('invalid');
  const sb = session.supabase;
  const org = session.organizationId;
  const g = await resolveGates(session);
  if (!g.projects) return siteFailure('restricted');

  let project: { id: string; name: string } | null;
  try {
    project = await withTimeout(loadSiteProject(sb, org, projectId), SECTION_TIMEOUT_MS, 'o projeto');
  } catch (error) {
    console.error('[dashboard/site] supply: projeto', error);
    return siteFailure('error');
  }
  if (!project) return siteFailure('not_found');

  const flags = await Promise.all(PERMISSION_KEYS.map((k) => hasOptionalPermission(session, k)));
  const has = Object.fromEntries(PERMISSION_KEYS.map((k, i) => [k, flags[i] === true])) as Record<(typeof PERMISSION_KEYS)[number], boolean>;
  // `inventory_position` soma `inventory_movements` (em mão): sem estas, o disponível sairia negativo.
  const stockGate = has['inventory.view'] || has['supply.view'] || has['receiving.view'];
  // RLS de `purchase_orders` e `purchase_order_lines` (234) — o mesmo conjunto do fluxo de compras.
  const ordersGate = g.supplyFlow;
  const amountVisible = has['procurement.view'] || has['supply.view'];
  // `supplier_profiles_select` E (`parties_select_suppliers` OU `parties_select_scoped`).
  const supplierNames = (has['procurement.view'] || has['supply.view'] || has['suppliers.view'] || has['receiving.view'])
    && (has['suppliers.view'] || has['procurement.view'] || has['parties.view'] || has['contracts.view'] || has['finance.view']);

  const requested = opts.focusRequirementId && /^[0-9a-f-]{36}$/i.test(opts.focusRequirementId) ? opts.focusRequirementId : null;
  // O que não depende do foco começa já: a caixa (a leitura mais lenta) e os achados do projeto.
  const inboxP = sitePart(true, 'a sua caixa de decisões', () => viewerInbox(session), timings, 'inbox', INBOX_TIMEOUT_MS);
  const signalsP = sitePart(g.signals, 'os achados da Apex', () => listSupplySignals(session,
    { projectId, openOnly: true, limit: 500 }), timings, 'signals');
  const coverage = await sitePart(true, 'a cobertura de material', () => readProjectCoverage(sb, org, projectId, today), timings, 'coverage');
  // Sem o balanço não há foco: a seção inteira diz que não carregou (nunca "sem falta").
  if (coverage.state === 'error') return { ok: true, today, project, supply: coverage };
  if (coverage.state === 'restricted') return { ok: true, today, project, supply: { state: 'restricted' } };
  const { materials, shortageById, truncated } = coverage.data;
  const focus = pickFocus(materials, requested);
  const liveShortage = (id: string): number | null => (shortageById.has(id) ? shortageById.get(id) as number : truncated ? null : 0);

  const [stock, orders, site] = await Promise.all([
    sitePart(stockGate, 'o estoque do item', async () => (focus?.item
      ? readStock(sb, org, projectId, focus.item.id) : { nodes: [] as StockNode[], truncated: false }), timings, 'stock'),
    sitePart(ordersGate, 'os pedidos', async () => (focus
      ? readOrders(sb, org, projectId, focus, { amountVisible, supplierNames }) : { orders: [], poIds: new Set<string>() }), timings, 'orders'),
    sitePart(true, 'a posição do local', () => readSiteCoordinate(sb, org, projectId), timings, 'site'),
  ]);
  const focusPoIds = orders.state === 'ok' ? orders.data.poIds : new Set<string>();
  const [signals, inbox] = await Promise.all([signalsP, inboxP]);

  const apex: SectionState<ApexNote[]> = signals.state !== 'ok' ? signals : {
    state: 'ok',
    data: focus ? focusApexNotes(signals.data.signals as SignalLike[], focus.requirementId, focusPoIds, liveShortage) : [],
    // A lista de abertos veio cortada: o que não veio pode ser deste material.
    ...((signals.data.openCount ?? 0) > signals.data.signals.length ? { truncated: true } : {}),
    asOf: signals.data.lastRun?.ranAt ?? null,
  };

  let decisions: SectionState<SupplyDecision[]>;
  if (inbox.state !== 'ok') decisions = inbox;
  else {
    const mine = siteDecisionRows(inbox.data, projectId, focusPoIds);
    decisions = await sitePart(true, 'as decisões deste local', async () => {
      const items = await enrichInbox(session, mine, today);
      return prioritize(items).map(supplyDecision);
    }, timings, 'decisions');
  }

  if (site.state === 'error') {
    return { ok: true, today, project, supply: { state: 'error', message: site.message } };
  }
  const data: SiteSupplyData = {
    focus,
    materials,
    stock: stock.state === 'ok'
      ? { state: 'ok', data: stock.data.nodes, ...(stock.data.truncated ? { truncated: true } : {}) }
      : stock,
    orders: orders.state === 'ok' ? { state: 'ok', data: orders.data.orders } : orders,
    apex,
    decisions,
    site: site.state === 'ok' ? site.data : null,
    truncated,
  };
  return { ok: true, today, project, supply: { state: 'ok', data, ...(truncated ? { truncated: true } : {}) } };
}
