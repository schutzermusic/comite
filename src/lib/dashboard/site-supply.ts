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
 *  • achados: as chaves da RLS de `supply_signals`;
 *  • origem da necessidade: `project_requirements` (projects.view) e o número
 *    da OS / a proveniência do item da OS sob a RLS de OS (projects.view já a
 *    satisfaz);
 *  • o PLANO (reservar → transferir → comprar): a cobertura viva + as posições
 *    de estoque, com o portão do estoque; cada passo aponta a rota GOVERNADA
 *    que o executa e só traz a ação para quem tem a alçada dela;
 *  • solicitações, cotações, propostas, decisão e fornecedores candidatos: a
 *    RLS de cotação/proposta (procurement.view OU supply.view) — o mesmo
 *    portão do valor. "Enviada em" vem do livro de e-mails, lido pelo service
 *    role SÓ para os convites já lidos sob a RLS (`readRfqDispatches`); se o
 *    livro não responde, a parte de compras volta `error` (nunca "Não enviada").
 * Restrito nunca é 0; uma leitura que falhou volta `error`, nunca lista vazia.
 */
if (typeof window !== 'undefined') {
  throw new Error('dashboard/site-supply.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { hasOptionalPermission, type CommercialSession } from '@/lib/commercial/server-session';
import { projectIdentity } from '@/lib/operations/project-identity';
import { SELECT_IN_CHUNK, selectIn } from '@/lib/supabase/select-in';
import { fromViewRow, pendingOverlap, supplyRisk, withCoverage246Columns, type CoverageViewRow } from '@/lib/supply/coverage';
import {
  LOCATION_KIND_LABEL, PENDING_TRANSFER_STATUSES, pendingTransferLines, pendingTransferRefsByRequirement, promisedByOrigin, type LocationKind,
  type PendingTransferHeadRow, type PendingTransferLineRow, type PendingTransferRef,
} from '@/lib/supply/inventory';
import {
  evaluateOrderableQuotes, evaluateQuotes, lineInLiveRfq, lineOpenQuantity, lineReleases, readOpenAllocations, readRequisitionReleases,
  recommendQuote, releaseNote, rfqLineOrderable, rfqOrderedLines, PO_STATUS_LABEL, REQUISITION_RELEASE_COLUMNS, REQUISITION_RELEASES_TABLE,
  REQUISITION_STATUS_LABEL, RFQ_STATUS_LABEL, type ComparableQuote, type PurchaseOrderStatus, type QuoteEvaluation, type RequisitionStatus,
  type RfqStatus, type SupplierStatus,
} from '@/lib/supply/procurement';
import { simulateTransfer, type TransitSample } from '@/lib/supply/intelligence';
import { onTimeRate } from '@/lib/supply/receiving';
import { readRfqDispatches } from '@/lib/supply/rfq-send';
import { supplierDiscoveryAvailability } from '@/lib/supply/supplier-discovery';
import { listSupplySignals } from '@/lib/supply/intelligence-read';
import { enrichInbox, viewerInbox } from '@/lib/decisions/read';
import { decisionHref, effectiveDeadline, prioritize } from '@/lib/decisions/model';
import type { DecisionInboxRow, DecisionItem } from '@/lib/decisions/types';
import { amountText } from '@/components/decisions/view';
import { resolveGates, SECTION_TIMEOUT_MS } from './overview';
import {
  apexNote, daysFrom, ddmm, isoDay, materialNeedDate, plainPlurals, STALE_ON_COVERAGE, MATERIAL_WINDOW_DAYS, type SignalLike,
} from './rules';
import type {
  ApexNote, InboundOrder, MaterialBalance, NeedOrigin, QuoteOption, RequisitionView, RfqView, SectionState, SiteSupplyData,
  SiteSupplyResponse, StockNode, SupplierCandidate, SupplyCapabilities, SupplyDecision, SupplyPlan, SupplyPlanStep,
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
  /** Origem de cada requisito (`needOrigin`); ausente/`null` = não foi possível ler. */
  origins?: ReadonlyMap<string, NeedOrigin | null>;
}

/* ── De onde veio a necessidade ─────────────────────────────────────────── */

export interface OriginFacts {
  source: string | null;
  serviceOrderId: string | null;
  serviceOrderItemId: string | null;
  activityId: string | null;
}

export interface OsItemFacts { origin: string | null; aiModel: string | null; aiProvider: string | null }

export interface OriginLookups {
  activities: CoverageMeta['activities'];
  /** Número de cada OS; `null` = a leitura das OS falhou (a origem de OS vira `null`, nunca inventada). */
  serviceOrders: ReadonlyMap<string, string> | null;
  osItems: ReadonlyMap<string, OsItemFacts> | null;
}

/**
 * A origem da necessidade, dita como é: "Do cronograma: Lançamento de cabos
 * (início 30/09)" · "Da OS OS-QA-2026-0301" · "Registro manual, sem
 * atividade". `readByAi` só quando o item da OS veio da leitura do PDF pela
 * Apex (origem `document_extraction` com modelo de IA registrado) — regra
 * determinística nunca é "a IA analisou".
 */
export function needOrigin(f: OriginFacts, look: OriginLookups): NeedOrigin | null {
  const act = f.activityId ? look.activities.get(f.activityId) : undefined;
  const activity = act ? { id: act.id, title: act.title ?? 'Atividade do cronograma', start: isoDay(act.plannedStart) } : null;
  const actText = activity ? `${activity.title}${activity.start ? ` (início ${ddmm(activity.start)})` : ''}` : null;
  const source = f.source ?? (f.serviceOrderId ? 'SERVICE_ORDER' : f.activityId ? 'ACTIVITY' : 'MANUAL');
  const base = { serviceOrder: null, activity, readByAi: false };
  switch (source) {
    case 'SERVICE_ORDER': {
      if (f.serviceOrderId && look.serviceOrders === null) return null;
      const number = f.serviceOrderId ? look.serviceOrders?.get(f.serviceOrderId) ?? null : null;
      const item = f.serviceOrderItemId ? look.osItems?.get(f.serviceOrderItemId) : undefined;
      return {
        source: 'SERVICE_ORDER',
        label: number ? `Da OS ${number}` : 'Da OS vinculada',
        serviceOrder: number && f.serviceOrderId
          ? { id: f.serviceOrderId, number, href: `/operacoes/ordens-servico/${encodeURIComponent(f.serviceOrderId)}` } : null,
        activity,
        readByAi: !!item && item.origin === 'document_extraction' && !!item.aiModel?.trim() && item.aiProvider !== 'human',
      };
    }
    case 'ACTIVITY':
      return { ...base, source: 'ACTIVITY', label: actText ? `Do cronograma: ${actText}` : 'Do cronograma' };
    case 'AI_PROPOSAL':
      return { ...base, source: 'AI_PROPOSAL', label: `Sugerido pela Apex e confirmado no planejamento${actText ? ` — ${actText}` : ''}` };
    case 'MANUAL':
      return { ...base, source: 'MANUAL', label: actText ? `Registro manual — ${actText}` : 'Registro manual, sem atividade' };
    case 'IMPORTED_PLAN':
      return { ...base, source: 'OTHER', label: actText ? `Do plano importado: ${actText}` : 'Do plano importado' };
    default:
      return { ...base, source: 'OTHER', label: actText ? `Registrado no planejamento — ${actText}` : 'Registrado no planejamento' };
  }
}

const RISK_RANK: Record<MaterialBalance['risk'], number> = { critical: 0, high: 1, medium: 2, ok: 3 };

/**
 * Uma linha da cobertura VIVA → o balanço do protótipo (números na unidade do
 * requisito). `pendingTransfer` e `purchasable` são os da visão (regra 246;
 * sem as colunas, pendente 0 e comprável = falta − requisitado, a conta do
 * banco anterior). A LISTA das transferências pendentes (`pendingTransfers`)
 * vem vazia aqui: só o material em foco a lê (`readPlanFacts` → `withPendingTransfers`).
 */
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
    origin: meta.origins?.get(row.requirement_id) ?? null,
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
    pendingTransfer: c.pendingTransfer,
    pendingTransfers: [],
    purchasable: c.purchasable,
    risk: risk === 'low' ? 'ok' : risk,
    href: `/supply/planejamento-materiais?req=${encodeURIComponent(row.requirement_id)}`,
  };
}

/**
 * O material com a LISTA das suas transferências pendentes (número, estado e
 * o link para resolvê-la no Estoque). O número (`pendingTransfer`) segue o da
 * visão; a lista só nomeia o que ele soma.
 */
export function withPendingTransfers(m: MaterialBalance, refs: MaterialBalance['pendingTransfers']): MaterialBalance {
  return refs.length ? { ...m, pendingTransfers: refs.map((r) => ({ ...r })) } : m;
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

/* ── O plano da Apex: reservar → transferir → comprar ───────────────────── */

const fmtQty = (n: number, unit: string | null) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;

/** Distância em km (grande círculo); `null` sem coordenada dos dois lados. */
export function distanceKm(a: { lat: number | null; lng: number | null } | null, b: { lat: number | null; lng: number | null } | null): number | null {
  if (!a || !b || a.lat === null || a.lng === null || b.lat === null || b.lng === null) return null;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad; const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "do Canteiro LT Marabá" / "da Base Norte" — a preposição pelo substantivo do nome do local. */
function prep(kind: 'de' | 'em', name: string): string {
  const fem = /^(base|central|sede|unidade|filial|loja|obra|oficina|usina|subesta)/i.test(name.trim());
  return `${kind === 'de' ? (fem ? 'da' : 'do') : (fem ? 'na' : 'no')} ${name}`;
}

export interface PlanInput {
  focus: MaterialBalance;
  /** MATERIAL | EXTERNAL_SERVICE (a base da cobertura). */
  requirementType: string | null;
  /** Posições do item na rede (`stockNodes`, com o canteiro deste projeto marcado). */
  stock: readonly StockNode[];
  site: { lat: number; lng: number } | null;
  /** Canteiros ativos DESTE projeto (destino de transferência). */
  siteLocations: ReadonlyArray<{ id: string; name: string }>;
  transit: readonly TransitSample[];
  /** Transferências DESPACHADAS para o requisito (número e quanto ainda chega) — já contadas na cobertura como "em trânsito". */
  inTransit: ReadonlyArray<{ number: string; qty: number }>;
  /**
   * Transferências PEDIDAS (ou aprovadas) e ainda não despachadas, que NÃO
   * movem uma reserva (essas já estão em "reservado") — o PENDENTE da regra
   * 246: não é cobertura (a falta continua), não é comprado (sai do
   * `purchasable_qty`) e o saldo da origem já está prometido — o plano não
   * sugere pedir de novo.
   */
  pendingTransfers?: ReadonlyArray<{ number: string; qty: number; fromLocationId: string; status: string }>;
  /**
   * 246: o saldo que TODAS as transferências pedidas/aprovadas da organização (sem reserva na origem, de
   * qualquer requisito ou de nenhum) vão tirar de cada local, por `item:local` (`promisedByOrigin`, a mesma
   * conta do Planejamento). Sai do livre da origem E do canteiro. Ausente = só as do requisito (`pendingTransfers`).
   */
  promised?: ReadonlyMap<string, number>;
  /** Requisições abertas do requisito; `null` = a pessoa não lê compras (o motivo sai sem número). */
  requisitions: ReadonlyArray<{ number: string }> | null;
  /** Pedidos abertos do requisito/item; `null` = não lidos. */
  purchaseOrders: ReadonlyArray<{ number: string | null }> | null;
  caps: { reserve: boolean; transfer: boolean; manage: boolean; request: boolean };
  projectId: string;
  today: string;
}

/**
 * Como o plano mostra a transferência PEDIDA e ainda não despachada: `pending`
 * — "feito" diria que o material andou (nem foi aprovado) e "sugerido" pediria
 * para pedir de novo. O número e o motivo vão no `reason`.
 */
export const PENDING_TRANSFER_STEP_STATUS: SupplyPlanStep['status'] = 'pending';

/**
 * O PLANO — a regra de `strategyOptions` (coverage.ts: o que menos custa ao
 * projeto primeiro) sobre a cobertura VIVA e o disponível de cada local
 * (em mão − reservado, INV-09): reservar no canteiro deste projeto → transferir
 * de outros locais com saldo livre, O MAIS PERTO primeiro (chegada estimada
 * por `simulateTransfer`, o histórico real entre os locais) → comprar o resto.
 * O que já está coberto aparece como FEITO (reservado, a caminho, em pedido,
 * requisitado), com o número. Cada passo sugerido aponta a rota governada que
 * o executa; sem a alçada dela, `action: null`. Quarentena nunca é origem.
 *
 * A conta é a do BANCO, a regra 246 (COVERAGE-SEMANTICS.md):
 *  • a transferência pedida e ainda não despachada é PENDENTE: sai da conta
 *    ANTES de qualquer sugestão e não é comprada — o banco a tira do
 *    comprável (`purchasable_qty`);
 *  • o saldo que QUALQUER transferência pedida da organização vai tirar de um
 *    local (de outro requisito, ou de nenhum) já está prometido: sai do livre
 *    da origem e do canteiro antes de sugerir reservar ou transferir;
 *  • a rede (reservar/transferir) só cabe em `falta − pendente − requisitado`:
 *    a trava do banco (`supply_requirement_claimed` = comprometido +
 *    requisitado) recusa cobrir por cima de solicitação aberta ("over-cover").
 *    Estoque livre que sobra por causa da solicitação é dito no passo de
 *    compra, com o caminho: cancelar a solicitação antes;
 *  • o passo de compra diz o número do BANCO: a solicitação aberta agora pede
 *    `purchasable_qty` (sem o pendente); a que passa da falta BRUTA é sobra,
 *    dita com números — nunca "feito" por cima de sobra. A que só passa por
 *    cima da transferência pedida (`pendingOverlap`: a exceção de cobertura,
 *    ou dado anterior à trava simétrica) não é sobra — o pendente não é
 *    cobertura —, mas é dita: se a transferência também andar, chega em dobro.
 *
 * O corpo das ações NÃO traz chave de idempotência: a tela gera uma por
 * intenção (`newIntentKey`), e uma chave fixa por dia repetiria, depois de um
 * cancelamento, o ato morto ("registrado" sem nada registrado).
 */
export function supplyPlan(input: PlanInput): SupplyPlan {
  const { focus: f, caps } = input;
  const unit = f.item?.unit ?? null;
  const q = (n: number) => fmtQty(n, unit);
  const itemName = f.item?.description ?? f.title;
  const steps: SupplyPlanStep[] = [];

  // Pedidas e ainda não despachadas (PENDENTE, 246): fora da cobertura, fora da compra, e prometidas na origem.
  const pending = (input.pendingTransfers ?? []).filter((t) => t.qty > 0);
  const pendingList = Array.from(new Set(pending.map((t) => t.number)));
  const pendingNums = pendingList.join(', ');
  // O número é o da visão (`pending_transfer_qty`); as linhas (o mesmo predicado) dão os números TR-… e a origem —
  // e seguram a conta enquanto a visão ainda não tem a coluna.
  const pendingQty = Math.max(f.pendingTransfer, pending.reduce((s, t) => s + t.qty, 0));
  // O prometido de cada local é o de TODAS as transferências pedidas da organização (`promisedByOrigin`), de qualquer
  // requisito ou de nenhum; as linhas deste requisito (já contidas nela) o seguram quando essa leitura não veio.
  const ownPromised = new Map<string, number>();
  for (const t of pending) ownPromised.set(t.fromLocationId, (ownPromised.get(t.fromLocationId) ?? 0) + t.qty);
  const promisedAt = (locationId: string) => Math.max(ownPromised.get(locationId) ?? 0,
    f.item ? input.promised?.get(`${f.item.id}:${locationId}`) ?? 0 : 0);
  // Livre = disponível (em mão − reservado) − prometido: na origem E no canteiro (uma transferência pedida que sai
  // daqui para outra demanda também promete este saldo).
  const free = input.stock.filter((n) => n.kind !== 'QUARANTINE')
    .map((n) => { const promised = promisedAt(n.locationId); return { ...n, available: Math.max(0, n.available - promised), promised }; })
    .filter((n) => n.available > 0);
  /** " (fora 300 m já pedidos em transferência)" — o painel da rede mostra o disponível sem o prometido. */
  const promisedNote = (n: { promised: number }) => (n.promised > 0 ? ` (fora ${q(n.promised)} já pedidos em transferência)` : '');
  const basis = f.shortage <= 0 ? 'Cobertura viva: o requisito está coberto'
    : free.length ? `Cobertura viva + estoque livre em ${free.length} ${free.length === 1 ? 'local' : 'locais'}`
      : 'Cobertura viva — sem estoque livre do item na rede';
  const dest = input.siteLocations.length ? [...input.siteLocations].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))[0] : null;
  const numbers = (xs: ReadonlyArray<{ number: string | null }> | null) => (xs ?? []).map((x) => x.number).filter((x): x is string => !!x);
  const reqNums = numbers(input.requisitions);
  const service = input.requirementType === 'EXTERNAL_SERVICE';

  /** O que ainda falta comprometer — a falta menos o pendente. */
  const uncommitted = Math.max(0, f.shortage - pendingQty);
  let remaining = uncommitted;
  /** O que a rede pode cobrir: a trava do banco conta o requisitado (não cobre por cima de solicitação aberta). */
  let room = Math.max(0, uncommitted - f.requested);
  /** Estoque livre que ficou sem uso só porque a solicitação aberta já cobre (dito no passo de compra). */
  const idle: Array<{ name: string; qty: number }> = [];
  const network = !!f.item && !service;
  const siteFree = network ? free.filter((x) => x.isSite) : [];
  const originFree = network ? free.filter((x) => !x.isSite)
    .map((n) => ({ n, km: distanceKm(input.site, n) }))
    .sort((a, b) => (a.km === null ? 1 : 0) - (b.km === null ? 1 : 0) || (a.km ?? 0) - (b.km ?? 0)
      || b.n.available - a.n.available || a.n.name.localeCompare(b.n.name, 'pt-BR')) : [];

  // ── Reservar ──
  const reservedNow = f.reserved + f.consumed;
  if (reservedNow > 0) {
    steps.push({ kind: 'reserve', qty: reservedNow, unit, from: null, label: `Reservar ${q(reservedNow)}`, status: 'done',
      reason: f.consumed <= 0 ? `${q(f.reserved)} já reservados para este requisito`
        : f.reserved > 0 ? `${q(f.reserved)} reservados e ${q(f.consumed)} já consumidos para este requisito`
          : `${q(f.consumed)} já consumidos para este requisito`, action: null });
  }
  if (room > 0 && network) {
    let reservedHere = false;
    for (const n of siteFree) {
      if (room <= 0) { idle.push({ name: n.name, qty: n.available }); continue; }
      const qty = Math.min(room, n.available);
      room -= qty;
      remaining -= qty;
      reservedHere = true;
      if (n.available > qty) idle.push({ name: n.name, qty: n.available - qty });
      steps.push({
        kind: 'reserve', qty, unit, from: { locationId: n.locationId, name: n.name, lat: n.lat, lng: n.lng },
        label: `Reservar ${q(qty)} ${prep('em', n.name)}`, status: 'suggested',
        reason: `${q(n.available)} livres ${prep('em', n.name)}${promisedNote(n)} — reservar segura o saldo para este projeto sem comprar.`,
        action: caps.reserve ? {
          method: 'POST', href: '/api/supply/inventory/reservations', permission: 'inventory.reserve',
          body: { requirementId: f.requirementId, locationId: n.locationId, quantity: qty },
          confirm: `Reservar ${q(qty)} de ${itemName} ${prep('em', n.name)} para “${f.title}”? A reserva segura o saldo para este projeto.`,
        } : null,
      });
    }
    if (!reservedHere && reservedNow <= 0) {
      steps.push({ kind: 'reserve', qty: 0, unit, from: null, label: 'Reservar no canteiro', status: 'blocked',
        reason: input.siteLocations.length ? 'Sem saldo livre do item no canteiro deste projeto.' : 'O projeto não tem canteiro cadastrado no Supply.',
        action: null });
    }
  } else {
    for (const n of siteFree) idle.push({ name: n.name, qty: n.available });
  }

  // ── Transferir ──
  if (f.inTransit > 0) {
    const nums = input.inTransit.map((t) => t.number);
    steps.push({ kind: 'transfer', qty: f.inTransit, unit, from: null, label: `Transferir ${q(f.inTransit)}`, status: 'done',
      reason: `${q(f.inTransit)} a caminho do canteiro${nums.length ? ` — ${nums.join(', ')}` : ''}`, action: null });
  }
  // Pedidas e ainda não despachadas: nada andou ainda — não é "feito", e não se sugere pedir de novo.
  for (const t of pending) {
    const origin = input.stock.find((n) => n.locationId === t.fromLocationId);
    const name = origin?.name ?? 'outro local';
    steps.push({ kind: 'transfer', qty: t.qty, unit,
      from: { locationId: t.fromLocationId, name, lat: origin?.lat ?? null, lng: origin?.lng ?? null },
      label: `Transferir ${q(t.qty)} ${prep('de', name)}`, status: PENDING_TRANSFER_STEP_STATUS,
      reason: `já pedida — ${t.number}; aguarda ${t.status === 'APPROVED' ? 'o despacho' : 'a aprovação'} no Estoque (ainda não saiu da origem)`,
      action: null });
  }
  if (room > 0 && network && f.item) {
    for (const { n, km } of originFree) {
      if (room <= 0) { if (dest) idle.push({ name: n.name, qty: n.available }); continue; }
      const qty = Math.min(room, n.available);
      const from = { locationId: n.locationId, name: n.name, lat: n.lat, lng: n.lng };
      const label = `Transferir ${q(qty)} ${prep('de', n.name)}`;
      if (!dest) {
        // Sem destino a transferência não acontece: diz por quê uma vez, e a falta segue para a compra.
        steps.push({ kind: 'transfer', qty, unit, from, label, status: 'blocked',
          reason: 'O projeto não tem canteiro cadastrado no Supply para receber a transferência.', action: null });
        break;
      }
      room -= qty;
      remaining -= qty;
      if (n.available > qty) idle.push({ name: n.name, qty: n.available - qty });
      const sim = simulateTransfer({ fromId: n.locationId, toId: dest.id, today: input.today, need: f.needBy, transit: [...input.transit] });
      const when = sim.beforeNeed === false ? ' — DEPOIS da necessidade' : sim.beforeNeed ? ' — antes da necessidade' : '';
      steps.push({
        kind: 'transfer', qty, unit, from, label, status: 'suggested',
        reason: `${km !== null ? `${Math.round(km).toLocaleString('pt-BR')} km · ` : ''}chega em ~${sim.days} ${sim.days === 1 ? 'dia' : 'dias'} `
          + `(${ddmm(sim.eta)}; ${plainPlurals(sim.basis)})${when}.`
          + (n.promised > 0 ? ` ${q(n.available)} livres ${prep('em', n.name)}${promisedNote(n)}.` : ''),
        action: caps.transfer ? {
          method: 'POST', href: '/api/supply/inventory/transfers', permission: caps.manage ? 'inventory.manage' : 'inventory.reserve',
          body: { fromLocationId: n.locationId, toLocationId: dest.id, projectId: input.projectId, expectedArrival: sim.eta,
            lines: [{ itemId: f.item.id, quantity: qty, requirementId: f.requirementId }] },
          confirm: `Pedir a transferência de ${q(qty)} de ${itemName} ${prep('de', n.name)} para ${dest.name}? O pedido segue para aprovação no Estoque.`,
        } : null,
      });
    }
  } else if (dest) {
    for (const { n } of originFree) idle.push({ name: n.name, qty: n.available });
  }

  // ── Comprar ──
  if (f.onOrder > 0) {
    const nums = numbers(input.purchaseOrders);
    steps.push({ kind: 'buy', qty: f.onOrder, unit, from: null, label: `Comprar ${q(f.onOrder)}`, status: 'done',
      reason: `${q(f.onOrder)} em pedido de compra${nums.length ? ` — ${nums.join(', ')}` : ''}`, action: null });
  }
  const reqRef = reqNums.length ? reqNums.join(', ') : 'a solicitação aberta';
  const already = `já requisitado (${q(f.requested)})${reqNums.length ? ` — ${reqNums.join(', ')}` : ''}`;
  // O banco abre a solicitação pelo COMPRÁVEL do momento (`purchasable_qty` = falta − requisitado − pendente):
  // o número dito é o dele, e o pendente que fica de fora é nomeado.
  const askText = `hoje ${q(f.purchasable)}`
    + (f.pendingTransfer > 0 ? `, sem os ${q(f.pendingTransfer)} já pedidos em transferência${pendingNums ? ` — ${pendingNums}` : ''}` : '');
  /** POST /api/supply/procurement/requisitions pela falta (sem chave: a tela gera uma por intenção). */
  const requisitionAction = (): NonNullable<SupplyPlanStep['action']> => ({
    method: 'POST', href: '/api/supply/procurement/requisitions', permission: 'procurement.request',
    body: { source: 'SHORTAGE', requirementIds: [f.requirementId], priority: f.risk === 'critical' ? 'critical' : 'high',
      ...(input.siteLocations.length === 1 && dest ? { deliveryLocationId: dest.id } : {}) },
    confirm: `Abrir a solicitação de compra da falta sem cobertura de ${itemName} (${askText})? Ela segue para cotação em Compras.`,
  });
  if (service || !f.item) {
    if (remaining > 0) {
      steps.push(service
        ? { kind: 'buy', qty: remaining, unit, from: null, label: `Contratar ${q(remaining)}`, status: 'blocked',
          reason: 'Serviço externo é contratado, não estocado: siga pela solicitação em Compras.', action: null }
        : { kind: 'buy', qty: remaining, unit, from: null, label: `Comprar ${q(remaining)}`, status: 'blocked',
          reason: 'Requisito sem item do catálogo: vincule o item no Planejamento para requisitar.', action: null });
    }
  } else if (f.requested > 0) {
    // A solicitação conta com a quantidade REAL requisitada. SOBRA é só o que passa da falta BRUTA: o pendente não é
    // cobertura (246), então comprar por cima dele não é "a mais" — é a exceção de cobertura (ou dado anterior à trava
    // simétrica), e o que ela sobrepõe à transferência pedida é dito: se as duas andarem, o material chega em dobro.
    // (A rede só cobriu o que a solicitação não cobre: `remaining` nunca fica abaixo do requisitado.)
    const surplusNow = Math.max(0, f.requested - f.shortage);
    const overlap = pendingOverlap({ shortage: f.shortage, requested: f.requested, pendingTransfer: pendingQty });
    const many = pendingList.length > 1;
    const twice = overlap > 0
      ? `${many ? 'As transferências pedidas' : 'A transferência pedida'}${pendingNums ? ` ${pendingNums}` : ''} ${many ? 'trazem' : 'traz'} `
        + `${q(overlap)} que esta compra também cobre: se ${many ? 'elas também forem despachadas' : 'ela também for despachada'}, `
        + `o material chega em dobro — ${many ? 'cancele-as' : 'cancele-a'} no Estoque se não ${many ? 'vão' : 'vai'} acontecer.`
      : '';
    const buyLabel = `Comprar ${q(f.requested)}`;
    const before = steps.some((s) => s.status === 'suggested');
    if (surplusNow > 0) {
      steps.push({ kind: 'buy', qty: f.requested, unit, from: null, label: buyLabel, status: 'blocked',
        reason: `Acima do que falta: ${reqRef} pede ${q(f.requested)}, mas ${f.shortage > 0 ? `faltam ${q(f.shortage)}` : 'a falta já está coberta'}`
          + ` — ${q(surplusNow)} a mais. Revise a solicitação em Compras antes de decidir a cotação.${twice ? ` ${twice}` : ''}`,
        action: null });
    } else if (remaining > f.requested) {
      steps.push({
        kind: 'buy', qty: remaining, unit, from: null, label: `Comprar ${q(remaining)}`, status: 'suggested',
        reason: `${already}; falta requisitar ${q(remaining - f.requested)}.`
          + (before ? ` A solicitação pede o comprável no momento em que for aberta (${askText}): faça antes o que está acima.` : ''),
        action: caps.request ? requisitionAction() : null,
      });
    } else {
      // Estoque livre que a rede tem mas não entra: o banco não reserva nem transfere por cima de solicitação aberta.
      const idleQty = idle.reduce((s, x) => s + x.qty, 0);
      const swap = Math.min(f.requested, idleQty);
      const names = Array.from(new Set(idle.map((x) => x.name))).join(', ');
      steps.push({ kind: 'buy', qty: f.requested, unit, from: null, label: buyLabel, status: 'done',
        reason: `${already}${twice ? `. ${twice}` : ''}`
          + (swap > 0
            ? `${twice ? ' ' : '. '}A rede tem ${q(idleQty)} livres (${names}) que poderiam substituir ${swap >= f.requested ? 'a compra' : `${q(swap)} da compra`}: `
              + `o banco não reserva nem transfere por cima de solicitação aberta — para usar o estoque, cancele antes ${reqRef} em Compras.`
            : ''),
        action: null });
    }
  } else if (remaining > 0) {
    const before = steps.some((s) => s.status === 'suggested');
    steps.push({
      kind: 'buy', qty: remaining, unit, from: null, label: `Comprar ${q(remaining)}`, status: 'suggested',
      reason: before || f.pendingTransfer > 0
        ? `A solicitação compra a falta sem cobertura no momento em que for aberta (${askText})${before ? ': faça antes o que está acima' : ''}.`
        : null,
      action: caps.request ? requisitionAction() : null,
    });
  }
  return { steps, remainingShortage: remaining, basis };
}

/* ── Cotações: a comparação A × B pela régua de Compras ─────────────────── */

export interface SupplierInfo {
  id: string;
  /** Nome do fornecedor; "Restrito" quando a pessoa não lê o cadastro de partes. */
  name: string;
  status: SupplierStatus;
  categories: string[];
  contactName: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  defaultLeadDays: number | null;
  onTimeRate: number | null;
}

export interface RfqRow { id: string; rfq_number: string; status: string; response_due: string | null }
export interface RfqLineRow { id: string; rfq_id: string; requisition_line_id: string | null; item_id: string | null; quantity: unknown; required_by: string | null }
export interface QuoteRow {
  id: string; rfq_id: string; supplier_id: string; version: unknown; status: string; currency: string | null; freight_amount: unknown;
  tax_amount: unknown; payment_terms: string | null; validity_date: string | null; lead_time_days: unknown; deviations: string | null;
}
export interface QuoteLineRow { quote_id: string; rfq_line_id: string; unit_price: unknown; quantity: unknown; lead_time_days: unknown; compliant: unknown }
export interface DecisionRow { id: string; rfq_id: string; quote_id: string; follows_recommendation: unknown; decided_at: string | null }
export interface DecisionPoRow { id: string; order_number: string | null; status: string; sourcing_decision_id: string | null }

export interface RfqViewInput {
  rfq: RfqRow;
  /** TODAS as linhas da cotação (proposta completa = cota todas). */
  lines: readonly RfqLineRow[];
  /** As linhas da cotação ligadas ao requisito em foco: a necessidade delas é a do material. */
  focusLineIds: ReadonlySet<string>;
  needBy: string | null;
  invited: ReadonlyArray<{ id: string; supplier_id: string }>;
  quotes: readonly QuoteRow[];
  quoteLines: readonly QuoteLineRow[];
  decision: DecisionRow | null;
  po: DecisionPoRow | null;
  /**
   * 248: as linhas da cotação que ainda viram pedido (`rfqLineOrderable`: requisição em busca e saldo aberto).
   * Numa cotação ABERTA a comparação corre só sobre elas; ausente, todas contam.
   */
  orderableLineIds?: ReadonlySet<string>;
  suppliers: ReadonlyMap<string, SupplierInfo>;
  /** Convite (id de `procurement_rfq_suppliers`) → quando o pedido de cotação foi enviado. */
  sentAt: ReadonlyMap<string, string>;
  today: string;
  amountVisible: boolean;
}

const nullableNum = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** O veredito de uma proposta, em português, pela avaliação de Compras (`evaluateQuotes`). */
export function quoteVerdict(e: QuoteEvaluation): string {
  const head = e.lateDays ? `Chega ${e.lateDays} ${e.lateDays === 1 ? 'dia' : 'dias'} depois da necessidade`
    : e.eta === null ? 'Sem prazo informado'
      : e.lateDays === 0 ? `Chega a tempo (${ddmm(e.eta)})` : `Chega em ${ddmm(e.eta)}`;
  const rest = e.flags.filter((x) => !/^chega \d+ dia/.test(x) && x !== 'sem prazo informado');
  return plainPlurals([head, ...rest].join(' · '));
}

const dias = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

/**
 * A recomendação para quem NÃO lê valores: os FATOS da régua de Compras
 * (`recommendQuote`: elegíveis; a tempo antes de atrasada; conforme antes de
 * com desvio; menor custo) ditos sem número de dinheiro — nunca "menor custo"
 * quando a conformidade escolheu a mais cara, nem "a tempo" sem prazo.
 */
export function restrictedRecommendationText(best: QuoteEvaluation, evaluations: readonly QuoteEvaluation[]): string {
  const eligible = evaluations.filter((e) => e.eligible);
  const onTime = eligible.filter((e) => (e.lateDays ?? 0) === 0);
  const cheapest = [...eligible].sort((a, b) => a.landed - b.landed)[0] ?? best;
  const parts: string[] = [];
  if (!onTime.length) {
    parts.push(`nenhuma chega a tempo; é a de menor atraso${best.lateDays ? ` (${dias(best.lateDays)})` : ''}`);
  } else {
    const head = best.eta === null ? 'sem prazo informado' : 'chega a tempo';
    if (cheapest.quoteId === best.quoteId) parts.push(`${head}, com o menor custo total posto`);
    else parts.push(`${head}; a mais barata ${cheapest.lateDays ? `chega ${dias(cheapest.lateDays)} depois da necessidade` : 'tem desvio ou restrição'}`);
  }
  if (!best.compliant) parts.push('atenção: tem desvio — justifique ao decidir');
  return `${best.supplier}: ${parts.join('; ')}.`;
}

const CURRENCY_NAME: Record<string, string> = { BRL: 'real', USD: 'dólar', EUR: 'euro' };

/**
 * Uma cotação → a vista do Dashboard: convidados (com contato e envio), as
 * propostas VIGENTES avaliadas contra a necessidade do material
 * (`evaluateQuotes` — chegada = hoje + prazo; custo total posto) e a
 * recomendação explicável de Compras (`recommendQuote`). A recomendação é
 * sugestão: decidir é ato humano, pela rota de sempre.
 *
 *  • completude, elegibilidade e a recomendação: a cotação INTEIRA (a régua de
 *    Compras); a chegada e o atraso de cada proposta: contra a necessidade do
 *    MATERIAL EM FOCO (as linhas dele), a data do cabeçalho — nunca a de
 *    outro item da mesma cotação;
 *  • "a mais barata" só entre as ELEGÍVEIS (a incompleta não vira a B do A × B);
 *  • moedas diferentes entre as elegíveis não se comparam: sem "mais barata"
 *    e sem recomendação — a tela diz por quê;
 *  • o preço unitário é o da linha do material em foco; proposta que não a
 *    cota fica sem preço unitário (nunca o de outro item);
 *  • 248: numa cotação ABERTA, só as linhas que ainda viram pedido
 *    (`orderableLineIds`) contam na completude, no custo posto e na
 *    necessidade (`evaluateOrderableQuotes`) — a régua da decisão no banco.
 */
export function rfqView(input: RfqViewInput): RfqView {
  const { rfq, suppliers } = input;
  const minDay = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b);
  const lines = input.lines.map((l) => ({ id: l.id, quantity: num(l.quantity),
    requiredBy: input.focusLineIds.has(l.id) ? minDay(isoDay(l.required_by), input.needBy) : isoDay(l.required_by),
    orderable: input.orderableLineIds ? input.orderableLineIds.has(l.id) : true }));
  // As linhas que a comparação conta: na ABERTA, as que viram pedido; na decidida, o registro inteiro.
  const compared = rfq.status === 'OPEN' ? lines.filter((l) => l.orderable) : lines;
  const focusLines = compared.filter((l) => input.focusLineIds.has(l.id));
  const supplierOf = (id: string) => suppliers.get(id);
  const comparable: ComparableQuote[] = input.quotes.map((x) => ({
    id: x.id, supplierId: x.supplier_id, supplier: supplierOf(x.supplier_id)?.name ?? 'Fornecedor',
    supplierStatus: supplierOf(x.supplier_id)?.status ?? 'PROSPECT', version: num(x.version),
    status: (x.status as ComparableQuote['status']), currency: x.currency ?? 'BRL', freight: num(x.freight_amount), tax: num(x.tax_amount),
    leadTimeDays: nullableNum(x.lead_time_days), validityDate: isoDay(x.validity_date), deviations: x.deviations ?? null,
    paymentTerms: x.payment_terms ?? null,
    lines: input.quoteLines.filter((l) => l.quote_id === x.id).map((l) => ({ rfqLineId: l.rfq_line_id, unitPrice: num(l.unit_price),
      quantity: num(l.quantity), leadTimeDays: nullableNum(l.lead_time_days), compliant: Boolean(l.compliant) })),
  }));
  const reliability = Object.fromEntries(comparable.map((c) => [c.supplierId, supplierOf(c.supplierId)?.onTimeRate ?? null]));
  const evaluations = evaluateOrderableQuotes(rfq.status, lines, comparable, input.today, reliability);
  // A chegada do MATERIAL EM FOCO: a mesma régua, só com as linhas dele (prazo delas e a necessidade dele).
  const focusTiming = focusLines.length && focusLines.length < compared.length
    ? new Map(evaluateQuotes(focusLines, comparable.map((c) => ({ ...c, lines: c.lines.filter((l) => input.focusLineIds.has(l.rfqLineId)) })),
      input.today, reliability).map((e) => [e.quoteId, { eta: e.eta, lateDays: e.lateDays }]))
    : null;
  const eligible = evaluations.filter((e) => e.eligible);
  const currencies = Array.from(new Set(eligible.map((e) => e.currency))).sort();
  const mixedCurrency = currencies.length > 1;
  const rec = mixedCurrency ? null : recommendQuote(evaluations);
  const cheapest = mixedCurrency ? null : [...eligible].sort((a, b) => a.landed - b.landed)[0]?.quoteId ?? null;
  const byId = new Map(comparable.map((c) => [c.id, c]));
  const evalOf = new Map(evaluations.map((e) => [e.quoteId, e]));
  const quotes: QuoteOption[] = evaluations.map((full) => {
    const e: QuoteEvaluation = { ...full, ...(focusTiming?.get(full.quoteId) ?? {}) };
    const c = byId.get(e.quoteId) as ComparableQuote;
    const s = supplierOf(c.supplierId);
    const focusLine = c.lines.find((l) => input.focusLineIds.has(l.rfqLineId)) ?? null;
    const hasLead = c.leadTimeDays !== null || c.lines.some((l) => l.leadTimeDays !== null);
    return {
      quoteId: e.quoteId,
      supplier: { id: c.supplierId, name: c.supplier, homologated: s?.status === 'HOMOLOGATED', onTimeRate: s?.onTimeRate ?? null },
      totalText: input.amountVisible ? amountText(e.landed, e.currency) : null,
      unitPriceText: input.amountVisible && focusLine ? amountText(focusLine.unitPrice, e.currency) : null,
      leadDays: hasLead ? Math.max(c.leadTimeDays ?? 0, ...c.lines.map((l) => l.leadTimeDays ?? 0)) : null,
      eta: e.eta,
      onTime: e.lateDays === null ? null : e.lateDays === 0,
      lateDays: e.lateDays,
      paymentTerms: c.paymentTerms,
      validity: c.validityDate,
      recommended: rec?.quoteId === e.quoteId,
      cheapest: cheapest === e.quoteId,
      verdict: quoteVerdict(e),
    };
  }).sort((a, b) => {
    const x = evalOf.get(a.quoteId) as QuoteEvaluation; const y = evalOf.get(b.quoteId) as QuoteEvaluation;
    return Number(b.recommended) - Number(a.recommended) || Number(y.eligible) - Number(x.eligible)
      || x.currency.localeCompare(y.currency) || x.landed - y.landed;
  });

  let recommendation: RfqView['recommendation'] = null;
  if (mixedCurrency) {
    const names = currencies.map((c) => CURRENCY_NAME[c] ?? c).join(' e ');
    recommendation = { quoteId: null,
      text: `Propostas elegíveis em moedas diferentes (${names}): a Apex não compara custo entre moedas — compare em Compras com o câmbio do dia.` };
  } else if (rec) {
    const best = evalOf.get(rec.quoteId) as QuoteEvaluation;
    recommendation = { quoteId: rec.quoteId,
      text: input.amountVisible ? plainPlurals(rec.rationale) : restrictedRecommendationText(best, evaluations) };
  } else if (evaluations.length) {
    recommendation = { quoteId: null, text: 'Nenhuma proposta elegível (incompleta, vencida ou de fornecedor restrito) — veja o motivo em cada uma.' };
  }

  const d = input.decision;
  return {
    id: rfq.id,
    number: rfq.rfq_number,
    status: (['OPEN', 'DECIDED', 'CANCELLED'].includes(rfq.status) ? rfq.status : 'OPEN') as RfqView['status'],
    statusLabel: RFQ_STATUS_LABEL[rfq.status as RfqStatus] ?? 'Cotação',
    responseDue: isoDay(rfq.response_due),
    invited: input.invited.map((i) => {
      const s = supplierOf(i.supplier_id);
      return { supplierId: i.supplier_id, name: s?.name ?? 'Fornecedor', hasContact: !!s?.hasEmail, sentAt: input.sentAt.get(i.id) ?? null };
    }),
    quotes,
    recommendation,
    decision: d ? {
      quoteId: d.quote_id,
      followsRecommendation: d.follows_recommendation === true,
      poId: input.po?.id ?? null,
      poNumber: input.po?.order_number ?? null,
      poStatus: input.po?.status ?? null,
      poStatusLabel: input.po ? PO_STATUS_LABEL[input.po.status as PurchaseOrderStatus] ?? 'Pedido' : null,
      decisionKey: null,
    } : null,
    // A vista é da cotação; a regra por linha (DECIDIDA que pediu a linha em foco) entra por solicitação, em `readProcurement`.
    liveForLine: rfq.status === 'OPEN',
    href: `/supply/compras?stage=cotacoes&rfq=${encodeURIComponent(rfq.id)}`,
  };
}

/**
 * A chave em Decisões do pedido que aguarda aprovação — a MESMA linha da caixa
 * desta pessoa (PRIMARY/ESCALATED). Sem a caixa (falhou), fica `null`: a tela
 * não oferece "Aprovar" sem saber que é da pessoa.
 */
export function withDecisionKeys(reqs: readonly RequisitionView[], inbox: readonly DecisionInboxRow[] | null): RequisitionView[] {
  return reqs.map((r) => ({
    ...r,
    rfqs: r.rfqs.map((q) => {
      const d = q.decision;
      if (!d?.poId || d.poStatus !== 'APPROVAL_REQUIRED' || !inbox) return q;
      const row = inbox.find((x) => x.subject_type === 'purchase_order' && x.subject_id === d.poId && x.assignment !== 'ELIGIBLE');
      return row ? { ...q, decision: { ...d, decisionKey: row.decision_key } } : q;
    }),
  }));
}

/* ── Fornecedores candidatos do item ────────────────────────────────────── */

export interface SupplierProfileRow {
  id: string; party_id: string; status: string; categories: string[] | null; default_lead_time_days: unknown;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
}

const foldCategory = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Por que cada fornecedor é candidato para o item: a CATEGORIA do item no
 * cadastro dele, o HISTÓRICO com o item (proposta ou pedido), ou os dois. Só
 * homologado ou em avaliação — suspenso e bloqueado não são convidados.
 */
export function supplierBasis(input: {
  category: string | null;
  profiles: readonly SupplierProfileRow[];
  historySupplierIds: ReadonlySet<string>;
}): Map<string, SupplierCandidate['basis']> {
  const cat = input.category ? foldCategory(input.category) : null;
  const out = new Map<string, SupplierCandidate['basis']>();
  for (const p of input.profiles) {
    if (p.status !== 'HOMOLOGATED' && p.status !== 'PROSPECT') continue;
    const byCat = !!cat && (p.categories ?? []).some((c) => foldCategory(c) === cat);
    const byHistory = input.historySupplierIds.has(p.id);
    if (byCat || byHistory) out.set(p.id, byCat && byHistory ? 'both' : byCat ? 'category' : 'history');
  }
  return out;
}

const BASIS_RANK: Record<SupplierCandidate['basis'], number> = { both: 0, history: 1, category: 2 };

/** Candidatos → a lista: homologado primeiro, depois a base (os dois → histórico → categoria), pontualidade, nome. */
export function supplierCandidates(input: {
  basis: ReadonlyMap<string, SupplierCandidate['basis']>;
  info: ReadonlyMap<string, SupplierInfo>;
  /** Prazo da proposta mais recente do fornecedor PARA ESTE ITEM (dias). */
  quotedLead: ReadonlyMap<string, number>;
  limit?: number;
}): SupplierCandidate[] {
  const out: SupplierCandidate[] = [];
  for (const [id, basis] of input.basis) {
    const s = input.info.get(id);
    if (!s || (s.status !== 'HOMOLOGATED' && s.status !== 'PROSPECT')) continue;
    out.push({ supplierId: id, name: s.name, status: s.status, categories: s.categories, contactName: s.contactName, hasEmail: s.hasEmail,
      hasPhone: s.hasPhone, onTimeRate: s.onTimeRate, leadDays: input.quotedLead.get(id) ?? s.defaultLeadDays, basis });
  }
  return out.sort((a, b) => Number(b.status === 'HOMOLOGATED') - Number(a.status === 'HOMOLOGATED')
    || BASIS_RANK[a.basis] - BASIS_RANK[b.basis]
    || (b.onTimeRate ?? -1) - (a.onTimeRate ?? -1)
    || a.name.localeCompare(b.name, 'pt-BR')).slice(0, input.limit ?? 20);
}

/* ══════════════════════════════════════════════════════════════════════════
   Leituras
   ══════════════════════════════════════════════════════════════════════════ */

/*
  As colunas da cobertura são `COVERAGE_VIEW_COLUMNS` (coverage.ts): as de
  antes + as ANEXADAS pela 246 (`pending_transfer_qty`, `purchasable_qty`).
  Enquanto a visão não as tem, `withCoverage246Columns` repete a leitura sem
  elas — e `fromViewRow` usa a conta do banco anterior.
*/

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
  /** Tipo de cada requisito (MATERIAL | EXTERNAL_SERVICE) — o plano não estoca serviço. */
  typeById: Map<string, string>;
  /** A data do PRÓPRIO requisito (`project_requirements.required_by`, sem o início da atividade) — a necessidade da solicitação. */
  requiredById: Map<string, string | null>;
  truncated: boolean;
}

interface RequirementBaseRow {
  id: string; title: string | null; source?: string | null; service_order_id?: string | null; service_order_item_id?: string | null;
  activity_id?: string | null;
}

/**
 * A origem de cada requisito: o número da OS e a proveniência do item da OS,
 * sob a RLS de OS (`iso_select`/`isoi_select` aceitam projects.view — o portão
 * deste local). Se a leitura das OS cai, a origem de OS vira `null` (a tela diz
 * que não leu); as outras origens seguem.
 */
async function readNeedOrigins(
  sb: SupabaseClient, org: string, reqs: readonly RequirementBaseRow[], rows: readonly CoverageViewRow[],
  activities: CoverageMeta['activities'],
): Promise<Map<string, NeedOrigin | null>> {
  let serviceOrders: Map<string, string> | null;
  let osItems: Map<string, OsItemFacts> | null;
  try {
    const [os, items] = await Promise.all([
      selectIn<{ id: string; os_number: string }>(reqs.map((r) => r.service_order_id),
        (c) => sb.from('internal_service_orders').select('id,os_number').eq('organization_id', org).in('id', c)),
      selectIn<{ id: string; origin: string | null; ai_model: string | null; ai_provider: string | null }>(reqs.map((r) => r.service_order_item_id),
        (c) => sb.from('internal_service_order_items').select('id,origin,ai_model,ai_provider').eq('organization_id', org).in('id', c)),
    ]);
    serviceOrders = new Map(os.map((o) => [o.id, o.os_number]));
    osItems = new Map(items.map((i) => [i.id, { origin: i.origin, aiModel: i.ai_model, aiProvider: i.ai_provider }]));
  } catch (error) {
    console.error('[dashboard/site] supply: origem das necessidades (OS)', error);
    serviceOrders = null; osItems = null;
  }
  const activityOf = new Map(rows.map((r) => [r.requirement_id, r.activity_id]));
  return new Map(reqs.map((r) => [r.id, needOrigin({
    source: r.source ?? null, serviceOrderId: r.service_order_id ?? null, serviceOrderItemId: r.service_order_item_id ?? null,
    activityId: r.activity_id ?? activityOf.get(r.id) ?? null,
  }, { activities, serviceOrders, osItems })]));
}

/** A cobertura AO VIVO do projeto inteiro (com contagem exata) → o balanço, na ordem. */
async function readProjectCoverage(sb: SupabaseClient, org: string, projectId: string, today: string): Promise<CoverageRead> {
  // Os requisitos que a visão cobre (a MESMA base dela: confirmados, material ou serviço externo).
  const base = await sb.from('project_requirements').select('id,title,source,service_order_id,service_order_item_id,activity_id', { count: 'exact' })
    .eq('organization_id', org).eq('project_id', projectId).eq('status', 'CONFIRMED')
    .in('requirement_type', ['MATERIAL', 'EXTERNAL_SERVICE']).order('id').limit(READ_LIMIT);
  if (base.error || base.count === null || base.count === undefined) throw new Error('requisitos do projeto');
  const reqs = (base.data ?? []) as RequirementBaseRow[];
  let rows: CoverageViewRow[];
  let truncated = base.count > reqs.length;
  if (reqs.length <= COVERAGE_FANOUT_MAX) {
    // Um requisito por leitura: o filtro por `requirement_id` desce até os agregados da visão
    // (~0,3 s cada no QA); por projeto ou por lista, a visão agrega a organização inteira (3–12 s).
    const each = await mapLimit(reqs, 6, async (r) => {
      const res = await withCoverage246Columns((columns) => sb.from('supply_requirement_coverage').select(columns)
        .eq('organization_id', org).eq('requirement_id', r.id).limit(2));
      if (res.error) throw new Error('cobertura de material');
      return (res.data ?? []) as unknown as CoverageViewRow[];
    });
    rows = each.flat();
  } else {
    const res = await withCoverage246Columns((columns) => sb.from('supply_requirement_coverage').select(columns, { count: 'exact' })
      .eq('organization_id', org).eq('project_id', projectId)
      .order('required_by', { ascending: true, nullsFirst: false }).order('requirement_id').limit(READ_LIMIT));
    if (res.error || res.count === null || res.count === undefined) throw new Error('cobertura de material');
    rows = (res.data ?? []) as unknown as CoverageViewRow[];
    truncated = truncated || res.count > rows.length;
  }
  const [acts, items] = await Promise.all([
    selectIn<{ id: string; title: string | null; planned_start: string | null }>(
      [...rows.map((r) => r.activity_id), ...reqs.map((r) => r.activity_id ?? null)],
      (c) => sb.from('project_timeline_items').select('id,title,planned_start').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; code: string | null; description: string | null; unit: string | null }>(rows.map((r) => r.item_id),
      (c) => sb.from('supply_items').select('id,code,description,unit').eq('organization_id', org).in('id', c)),
  ]);
  const activities: CoverageMeta['activities'] = new Map(acts.map((a) => [a.id, { id: a.id, title: a.title, plannedStart: a.planned_start }]));
  const meta: CoverageMeta = {
    titles: new Map(reqs.map((r) => [r.id, r.title])),
    activities,
    items: new Map(items.map((i) => [i.id, i])),
    origins: await readNeedOrigins(sb, org, reqs, rows, activities),
  };
  const all = rows.map((r) => materialBalance(r, meta, today));
  return {
    materials: all.filter((m) => inMaterialScope(m, today)).sort(compareMaterials),
    shortageById: new Map(all.map((m) => [m.requirementId, m.shortage])),
    typeById: new Map(rows.map((r) => [r.requirement_id, r.requirement_type])),
    requiredById: new Map(rows.map((r) => [r.requirement_id, isoDay(r.required_by)])),
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

interface SiteRead {
  coordinate: { lat: number; lng: number } | null;
  /** Canteiros ativos DESTE projeto (o destino de uma transferência; a entrega da compra). */
  locations: Array<{ id: string; name: string }>;
}

/**
 * A posição do local (oficial, senão o único canteiro com coordenada) e os
 * canteiros ativos do projeto — `inventory_locations` é legível com projects.view.
 */
async function readSite(sb: SupabaseClient, org: string, projectId: string): Promise<SiteRead> {
  const [markers, sites] = await Promise.all([
    sb.from('project_globe_marker').select('latitude,longitude').eq('organization_id', org).eq('project_id', projectId).limit(5),
    sb.from('inventory_locations').select('id,code,name,latitude,longitude,active,kind').eq('organization_id', org).eq('project_id', projectId)
      .eq('kind', 'PROJECT_SITE').eq('active', true).order('id').limit(20),
  ]);
  if (markers.error) throw new Error('localização oficial');
  if (sites.error) throw new Error('canteiro do projeto');
  const rows = (sites.data ?? []) as unknown as Array<{ id: string; code: string | null; name: string | null; latitude: unknown;
    longitude: unknown; active: boolean | null; kind: string | null }>;
  return {
    coordinate: siteCoordinate((markers.data ?? []) as unknown as Array<{ latitude: unknown; longitude: unknown }>, rows),
    locations: rows.filter((r) => r.active !== false).map((r) => ({ id: r.id, name: r.name ?? r.code ?? 'Canteiro' })),
  };
}

interface PlanFacts {
  transit: TransitSample[];
  inTransit: Array<{ number: string; qty: number }>;
  pending: Array<{ number: string; qty: number; fromLocationId: string; status: string }>;
  /** As transferências pendentes do requisito, para "resolver a transferência" (`MaterialBalance.pendingTransfers`). */
  pendingRefs: PendingTransferRef[];
  /**
   * 246: o que TODAS as transferências pedidas/aprovadas da organização (sem reserva na origem, de qualquer
   * requisito ou de nenhum) vão tirar de cada local, por `item:local` — só o item em foco (`promisedByOrigin`).
   */
  promised: Map<string, number>;
}
/**
 * Despachada: a cobertura já conta como "em trânsito". Pedida/aprovada (sem
 * reserva na origem): PENDENTE (246, `pendingTransferLines`) — não é cobertura,
 * mas a origem já está prometida e o banco não a compra.
 */
const DISPATCHED_TRANSFER = ['IN_TRANSIT', 'PARTIALLY_RECEIVED'];
/** Teto de uma leitura paginada (`readAllPages`): além dele, `error` — nunca corte calado. */
const PAGED_MAX = 20_000;

/** Uma leitura em páginas de ordem estável, até o fim; uma falha (ou o teto) SOBE. */
async function readAllPages<T>(
  label: string, page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < PAGED_MAX; from += READ_LIMIT) {
    const res = await page(from, from + READ_LIMIT - 1);
    if (res.error) throw new Error(label);
    const rows = (res.data ?? []) as T[];
    out.push(...rows);
    if (rows.length < READ_LIMIT) return out;
  }
  throw new Error(`${label}: mais de ${PAGED_MAX} linhas`);
}

/**
 * 246: o saldo que as transferências PEDIDAS/APROVADAS da organização inteira
 * (sem reserva na origem, de qualquer requisito ou de nenhum) vão tirar de cada
 * local — só o item em foco, por `promisedByOrigin` (a conta do Planejamento).
 * Paginado (item por série move uma unidade por linha): cortada, a leitura
 * prometeria de menos e o plano sugeriria de novo o saldo já prometido.
 */
async function readPromised(sb: SupabaseClient, org: string, itemId: string): Promise<Map<string, number>> {
  const heads = await readAllPages<PendingTransferHeadRow>('transferências pedidas da organização', (from, to) => sb
    .from('inventory_transfers').select('id,transfer_number,status,from_location_id').eq('organization_id', org)
    .in('status', [...PENDING_TRANSFER_STATUSES]).order('id').range(from, to));
  const ids = heads.map((t) => t.id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += SELECT_IN_CHUNK) chunks.push(ids.slice(i, i + SELECT_IN_CHUNK));
  const lines = (await Promise.all(chunks.map((chunk) => readAllPages<PendingTransferLineRow>('linhas das transferências pedidas',
    (from, to) => sb.from('inventory_transfer_lines').select('id,transfer_id,item_id,requirement_id,quantity,source_reservation_id')
      .eq('organization_id', org).eq('item_id', itemId).is('source_reservation_id', null).in('transfer_id', chunk)
      .order('id').range(from, to))))).flat();
  return promisedByOrigin(lines, heads);
}

/**
 * O que o plano precisa além da cobertura: as transferências VIVAS do
 * requisito (o número do que já está a caminho e do que foi pedido), o saldo
 * que as pedidas da organização INTEIRA já prometeram tirar de cada local (o
 * item em foco, de qualquer requisito ou de nenhum — a conta do Planejamento)
 * e o histórico real de transferências RECEBIDAS nos canteiros deste projeto
 * (180 dias, de qualquer origem) — a amostra de `simulateTransfer` (par de
 * locais, senão o destino). RLS de transferências e locais = o portão do
 * estoque. Tudo-ou-nada: uma leitura que falha derruba o plano (`error`).
 */
async function readPlanFacts(
  sb: SupabaseClient, org: string, projectId: string, requirementId: string, itemId: string | null, today: string,
): Promise<PlanFacts> {
  const since = new Date(`${today}T00:00:00Z`); since.setUTCDate(since.getUTCDate() - 180);
  const [lines, sites, promised] = await Promise.all([
    sb.from('inventory_transfer_lines').select('transfer_id,quantity,received_quantity,source_reservation_id').eq('organization_id', org)
      .eq('requirement_id', requirementId).limit(200),
    sb.from('inventory_locations').select('id').eq('organization_id', org).eq('project_id', projectId).eq('kind', 'PROJECT_SITE').limit(20),
    itemId ? readPromised(sb, org, itemId) : Promise.resolve(new Map<string, number>()),
  ]);
  if (lines.error) throw new Error('transferências do requisito');
  if (sites.error) throw new Error('canteiros do projeto');
  const lineRows = (lines.data ?? []) as Array<{ transfer_id: string; quantity: unknown; received_quantity: unknown;
    source_reservation_id?: string | null }>;
  const [transfers, done] = await Promise.all([
    selectIn<{ id: string; transfer_number: string; status: string; from_location_id: string }>(lineRows.map((l) => l.transfer_id),
      (c) => sb.from('inventory_transfers').select('id,transfer_number,status,from_location_id').eq('organization_id', org).in('id', c)),
    selectIn<Row>(((sites.data ?? []) as Row[]).map((s) => str(s.id)), (c) => sb.from('inventory_transfers')
      .select('from_location_id,to_location_id,dispatched_at,received_at').eq('organization_id', org).in('status', ['RECEIVED', 'CLOSED'])
      .not('received_at', 'is', null).gte('dispatched_at', since.toISOString()).in('to_location_id', c).limit(200)),
  ]);
  const byId = new Map(transfers.map((t) => [t.id, t]));
  const open = (l: { quantity: unknown; received_quantity: unknown }) => Math.max(0, num(l.quantity) - num(l.received_quantity));
  const inTransit = lineRows.flatMap((l) => {
    const t = byId.get(l.transfer_id);
    return t && DISPATCHED_TRANSFER.includes(t.status) && open(l) > 0 ? [{ number: t.transfer_number, qty: open(l) }] : [];
  });
  // A linha que MOVE uma reserva já está em "reservado" (e o banco não a soma de novo): não é pendência a mais.
  const pendingLines = pendingTransferLines(lineRows, transfers);
  const pending = pendingLines.map(({ transfer: t, qty }) => ({ number: t.transfer_number, qty, fromLocationId: t.from_location_id,
    status: t.status }));
  const pendingRefs = pendingTransferRefsByRequirement(lineRows.map((l) => ({ ...l, requirement_id: requirementId })), transfers)
    .get(requirementId) ?? [];
  const transit = done.flatMap((t) => {
    const days = (Date.parse(String(t.received_at)) - Date.parse(String(t.dispatched_at))) / 86_400_000;
    return Number.isFinite(days) ? [{ fromId: String(t.from_location_id), toId: String(t.to_location_id), days: Math.max(0, days) }] : [];
  });
  return { transit, inTransit, pending, pendingRefs, promised };
}

/**
 * O cadastro dos fornecedores citados (perfil, nome, contato e pontualidade
 * DERIVADA dos recebimentos — `supplier_delivery_performance`). Nome só com a
 * leitura de partes; sem ela, "Restrito" (nunca vazio). Contato: só se HÁ
 * e-mail/telefone — o endereço não sai daqui.
 */
async function readSupplierInfo(
  sb: SupabaseClient, org: string, ids: readonly string[], names: boolean, known: readonly SupplierProfileRow[] = [],
): Promise<Map<string, SupplierInfo>> {
  const have = new Map(known.map((p) => [p.id, p]));
  const missing = ids.filter((id) => !have.has(id));
  const read = await selectIn<SupplierProfileRow>(missing, (c) => sb.from('supplier_profiles')
    .select('id,party_id,status,categories,default_lead_time_days,contact_name,contact_email,contact_phone').eq('organization_id', org).in('id', c));
  for (const p of read) have.set(p.id, p);
  const profiles = ids.map((id) => have.get(id)).filter((p): p is SupplierProfileRow => !!p);
  const [parties, perf] = await Promise.all([
    names ? selectIn<{ id: string; legal_name: string | null; trade_name: string | null }>(profiles.map((p) => p.party_id),
      (c) => sb.from('parties').select('id,legal_name,trade_name').eq('organization_id', org).in('id', c)) : Promise.resolve([]),
    selectIn<{ supplier_id: string; promised_lines: unknown; on_time_lines: unknown }>(profiles.map((p) => p.id),
      (c) => sb.from('supplier_delivery_performance').select('supplier_id,promised_lines,on_time_lines').eq('organization_id', org)
        .in('supplier_id', c)),
  ]);
  const partyName = new Map(parties.map((p) => [p.id, p.trade_name?.trim() || p.legal_name?.trim() || null]));
  const perfOf = new Map(perf.map((p) => [p.supplier_id, { promised_lines: num(p.promised_lines), on_time_lines: num(p.on_time_lines) }]));
  return new Map(profiles.map((p) => [p.id, {
    id: p.id,
    name: names ? partyName.get(p.party_id) ?? 'Fornecedor' : 'Restrito',
    status: (p.status as SupplierStatus) ?? 'PROSPECT',
    categories: p.categories ?? [],
    contactName: p.contact_name?.trim() || null,
    hasEmail: !!p.contact_email?.trim(),
    hasPhone: !!p.contact_phone?.trim(),
    defaultLeadDays: nullableNum(p.default_lead_time_days),
    onTimeRate: onTimeRate(perfOf.get(p.id)),
  }]));
}

const SUPPLIER_PROFILE_COLUMNS = 'id,party_id,status,categories,default_lead_time_days,contact_name,contact_email,contact_phone';
const QUOTE_COLUMNS = 'id,rfq_id,supplier_id,version,status,currency,freight_amount,tax_amount,payment_terms,validity_date,lead_time_days,deviations';

/** Requisição que não é mais demanda: cancelada, ou encerrada (248: tudo liberado). */
const DEAD_REQUISITION = new Set(['CANCELLED', 'CLOSED']);

/**
 * As solicitações de compra que contêm o requisito em foco, com as cotações
 * das suas linhas: convidados, envio, propostas avaliadas, recomendação,
 * decisão e pedido. `decisionKey` entra depois, com a caixa.
 *
 * 248: a quantidade é o EM ABERTO do requisito em foco (visão
 * `purchase_requisition_open_allocations`: alocado − liberado) e o liberado
 * vem com a nota do livro (`procurement_requisition_releases`: não pedido na
 * emissão, liberado no cancelamento). Canceladas, encerradas e as que não têm
 * mais nada em aberto para o foco ficam fora — liberado não é demanda; a
 * linha oferecida à cotação (`lineId`) é uma com saldo aberto. Banco ainda
 * sem a 248: a tabela de alocações, aberto = alocado (`readOpenAllocations`).
 *
 * A necessidade da solicitação é a mínima das alocações ABERTAS do foco — a
 * data do PRÓPRIO requisito (`opts.requiredBy`); a da linha pode guardar a de
 * um requisito já liberado. Cada cotação diz se está VIVA para a linha em
 * foco (`liveForLine`: ABERTA, ou DECIDIDA cujo pedido não cancelado pediu a
 * linha — a regra do banco); numa cotação ABERTA a comparação corre só sobre
 * as linhas que ainda viram pedido (requisição em busca e saldo aberto).
 */
async function readProcurement(
  sb: SupabaseClient, org: string, focus: MaterialBalance, today: string,
  opts: { amountVisible: boolean; supplierNames: boolean; requiredBy: string | null },
): Promise<RequisitionView[]> {
  const allocs = await readOpenAllocations(async (src) => {
    const res = await sb.from(src.table).select(src.columns).eq('organization_id', org).eq('requirement_id', focus.requirementId).limit(READ_LIMIT);
    if (res.error) throw new Error(`alocações de requisição: ${res.error.message}`);
    return (res.data ?? []) as unknown as Row[];
  });
  if (!allocs.length) return [];
  const lines = await selectIn<{ id: string; requisition_id: string; quantity: unknown }>(
    allocs.map((a) => a.requisitionLineId), (c) => sb.from('purchase_requisition_lines').select('id,requisition_id,quantity')
      .eq('organization_id', org).in('id', c));
  const lineIds = lines.map((l) => l.id);
  const [reqs, links, releaseRows, lineOrders] = await Promise.all([
    selectIn<{ id: string; requisition_number: string; status: string; requested_at: string | null }>(
      lines.map((l) => l.requisition_id), (c) => sb.from('purchase_requisitions').select('id,requisition_number,status,requested_at')
        .eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; rfq_id: string; requisition_line_id: string | null }>(lineIds, (c) => sb.from('procurement_rfq_lines')
      .select('id,rfq_id,requisition_line_id').eq('organization_id', org).in('requisition_line_id', c)),
    readRequisitionReleases(() => selectIn<Row>(lineIds, (c) => sb.from(REQUISITION_RELEASES_TABLE).select(REQUISITION_RELEASE_COLUMNS)
      .eq('organization_id', org).eq('requirement_id', focus.requirementId).in('requisition_line_id', c))),
    // As linhas de pedido das linhas em foco: cotação DECIDIDA só está viva para a linha que o pedido dela pediu.
    selectIn<{ purchase_order_id: string; requisition_line_id: string | null }>(lineIds, (c) => sb.from('purchase_order_lines')
      .select('purchase_order_id,requisition_line_id').eq('organization_id', org).in('requisition_line_id', c)),
  ]);
  const rfqIds = Array.from(new Set(links.map((l) => l.rfq_id)));
  const [rfqs, rfqLines, invited, quotes, decisions, releaseOrders] = await Promise.all([
    selectIn<RfqRow>(rfqIds, (c) => sb.from('procurement_rfqs').select('id,rfq_number,status,response_due').eq('organization_id', org).in('id', c)),
    selectIn<RfqLineRow>(rfqIds, (c) => sb.from('procurement_rfq_lines').select('id,rfq_id,requisition_line_id,item_id,quantity,required_by')
      .eq('organization_id', org).in('rfq_id', c)),
    selectIn<{ id: string; rfq_id: string; supplier_id: string }>(rfqIds, (c) => sb.from('procurement_rfq_suppliers')
      .select('id,rfq_id,supplier_id').eq('organization_id', org).in('rfq_id', c)),
    selectIn<QuoteRow>(rfqIds, (c) => sb.from('supplier_quotes').select(QUOTE_COLUMNS).eq('organization_id', org).in('rfq_id', c)),
    selectIn<DecisionRow>(rfqIds, (c) => sb.from('sourcing_decisions').select('id,rfq_id,quote_id,follows_recommendation,decided_at')
      .eq('organization_id', org).in('rfq_id', c)),
    // O número do pedido de cada liberação (pode ser um pedido antigo, fora das decisões lidas aqui).
    selectIn<{ id: string; order_number: string }>(releaseRows.map((r) => str(r.purchase_order_id)),
      (c) => sb.from('purchase_orders').select('id,order_number').eq('organization_id', org).in('id', c)),
  ]);
  const orderNumber = new Map(releaseOrders.map((p) => [p.id, p.order_number]));
  const current = quotes.filter((q) => q.status === 'RECEIVED');
  const supplierIds = Array.from(new Set([...invited.map((i) => i.supplier_id), ...current.map((q) => q.supplier_id)]));
  // As linhas de requisição das cotações ABERTAS (de qualquer requisito): o estado da requisição e o aberto da linha
  // (todas as alocações dela, não só a do foco) dizem o que ainda vira pedido.
  const openRfqIds = new Set(rfqs.filter((r) => r.status === 'OPEN').map((r) => r.id));
  const orderableCandidates = Array.from(new Set(rfqLines.filter((l) => openRfqIds.has(l.rfq_id)).map((l) => l.requisition_line_id)
    .filter((id): id is string => !!id)));
  const focusLineSet = new Set(lineIds);
  const [quoteLines, suppliers, pos, sentAt, otherLines, candidateAllocs] = await Promise.all([
    selectIn<QuoteLineRow>(current.map((q) => q.id), (c) => sb.from('supplier_quote_lines')
      .select('quote_id,rfq_line_id,unit_price,quantity,lead_time_days,compliant').eq('organization_id', org).in('quote_id', c)),
    readSupplierInfo(sb, org, supplierIds, opts.supplierNames),
    selectIn<DecisionPoRow>(decisions.map((d) => d.id), (c) => sb.from('purchase_orders').select('id,order_number,status,sourcing_decision_id')
      .eq('organization_id', org).in('sourcing_decision_id', c)),
    // O livro de e-mails é de admin/auditoria: só `related_entity_id` e a data, dos convites JÁ lidos acima sob a RLS.
    // Se ele não responde, "enviada / não enviada" seria chute (e ofereceria reenviar): a parte inteira diz que não
    // carregou — o contrato não tem "envio desconhecido" por convite.
    invited.length ? readRfqDispatches(org, invited.map((i) => i.id)) : Promise.resolve(new Map<string, string>()),
    selectIn<{ id: string; requisition_id: string; quantity: unknown }>(orderableCandidates.filter((id) => !focusLineSet.has(id)),
      (c) => sb.from('purchase_requisition_lines').select('id,requisition_id,quantity').eq('organization_id', org).in('id', c)),
    readOpenAllocations((src) => selectIn<Row>(orderableCandidates, async (c) => {
      const res = await sb.from(src.table).select(src.columns).eq('organization_id', org).in(src.lineColumn, c);
      return { data: (res.data ?? []) as unknown as Row[], error: res.error };
    })),
  ]);
  const knownReqs = new Set(reqs.map((r) => r.id));
  const otherReqs = await selectIn<{ id: string; status: string }>(otherLines.map((l) => l.requisition_id).filter((id) => !knownReqs.has(id)),
    (c) => sb.from('purchase_requisitions').select('id,status').eq('organization_id', org).in('id', c));
  const reqStatus = new Map([...reqs, ...otherReqs].map((r) => [r.id, r.status]));
  const lineFacts = new Map([...lines, ...otherLines].map((l) => [l.id, l]));
  // A régua de `procurement_decide`: a requisição em busca (SUBMITTED/SOURCING) e a linha com saldo aberto > 0.
  const orderable = (requisitionLineId: string | null) => {
    const l = requisitionLineId ? lineFacts.get(requisitionLineId) : undefined;
    return !!l && rfqLineOrderable(reqStatus.get(l.requisition_id),
      lineOpenQuantity(num(l.quantity), candidateAllocs.filter((a) => a.requisitionLineId === l.id)));
  };
  // Viva para a linha: ABERTA, ou DECIDIDA cujo pedido não cancelado pediu a linha.
  const ordersLine = rfqOrderedLines(decisions, pos, lineOrders);

  const views = new Map<string, RfqView>();
  for (const rfq of rfqs.filter((r) => r.status !== 'CANCELLED')) {
    const decision = decisions.filter((d) => d.rfq_id === rfq.id)
      .sort((a, b) => String(b.decided_at ?? '').localeCompare(String(a.decided_at ?? '')))[0] ?? null;
    const po = decision ? pos.filter((p) => p.sourcing_decision_id === decision.id && p.status !== 'CANCELLED')[0] ?? null : null;
    const mine = rfqLines.filter((l) => l.rfq_id === rfq.id);
    views.set(rfq.id, rfqView({
      rfq, lines: mine,
      focusLineIds: new Set(mine.filter((l) => l.requisition_line_id && focusLineSet.has(l.requisition_line_id)).map((l) => l.id)),
      needBy: focus.needBy, invited: invited.filter((i) => i.rfq_id === rfq.id), quotes: current.filter((q) => q.rfq_id === rfq.id),
      quoteLines, decision, po, suppliers, sentAt, today, amountVisible: opts.amountVisible,
      orderableLineIds: rfq.status === 'OPEN' ? new Set(mine.filter((l) => orderable(l.requisition_line_id)).map((l) => l.id)) : undefined,
    }));
  }

  const unit = focus.item?.unit ?? null;
  // O aberto e o liberado do requisito em foco, por linha da requisição.
  const openOf = new Map<string, number>(); const releasedOf = new Map<string, number>();
  for (const a of allocs) {
    openOf.set(a.requisitionLineId, (openOf.get(a.requisitionLineId) ?? 0) + a.openQty);
    releasedOf.set(a.requisitionLineId, (releasedOf.get(a.requisitionLineId) ?? 0) + a.releasedQty);
  }
  return reqs.filter((r) => !DEAD_REQUISITION.has(r.status))
    .sort((a, b) => String(b.requested_at ?? '').localeCompare(String(a.requested_at ?? '')) || a.requisition_number.localeCompare(b.requisition_number))
    .flatMap((r): RequisitionView[] => {
      const myLines = lines.filter((l) => l.requisition_id === r.id);
      // Só as linhas com o foco EM ABERTO são demanda: quantidade, data, linha a cotar e cotações vêm delas.
      const openLines = myLines.filter((l) => (openOf.get(l.id) ?? 0) > 0);
      const qty = openLines.reduce((s, l) => s + (openOf.get(l.id) ?? 0), 0);
      if (!(qty > 0)) return [];
      const openLineIds = new Set(openLines.map((l) => l.id));
      const myLineIds = new Set(myLines.map((l) => l.id));
      const releasedQty = myLines.reduce((s, l) => s + (releasedOf.get(l.id) ?? 0), 0);
      const rfqOfReq = Array.from(new Set(links.filter((l) => l.requisition_line_id && openLineIds.has(l.requisition_line_id)).map((l) => l.rfq_id)));
      const lineId = openLines[0]?.id ?? null;
      return [{
        id: r.id,
        number: r.requisition_number,
        status: r.status,
        statusLabel: REQUISITION_STATUS_LABEL[r.status as RequisitionStatus] ?? 'Solicitação',
        qty,
        unit,
        // A mínima das alocações ABERTAS do foco = a data do próprio requisito (a da linha pode ser a de um liberado).
        requiredBy: opts.requiredBy,
        lineId,
        releasedQty,
        releaseNote: releasedQty > 0
          ? releaseNote(lineReleases(releaseRows.filter((x) => myLineIds.has(String(x.requisition_line_id))), (id) => orderNumber.get(id)), unit)
          : null,
        href: `/supply/compras?stage=solicitacoes&rq=${encodeURIComponent(r.id)}`,
        rfqs: rfqOfReq.map((id) => views.get(id)).filter((v): v is RfqView => !!v)
          .map((v) => ({ ...v, liveForLine: !!lineId && links.some((x) => x.rfq_id === v.id && x.requisition_line_id === lineId)
            && lineInLiveRfq(v.status, ordersLine(v.id, lineId)) }))
          .sort((a, b) => Number(b.status === 'OPEN') - Number(a.status === 'OPEN') || b.number.localeCompare(a.number)),
      }];
    });
}

/**
 * Os fornecedores candidatos para o item: HOMOLOGADOS (e em avaliação) cuja
 * categoria cadastrada é a do item, ou que já cotaram/forneceram o item. O
 * prazo é o da proposta mais recente para o item; sem ela, o padrão do
 * cadastro. Nunca inventado.
 */
async function readSupplierCandidates(
  sb: SupabaseClient, org: string, itemId: string, opts: { supplierNames: boolean },
): Promise<{ candidates: SupplierCandidate[]; truncated: boolean }> {
  const [item, profiles, rfqLines, poLines] = await Promise.all([
    sb.from('supply_items').select('id,category').eq('organization_id', org).eq('id', itemId).limit(1),
    sb.from('supplier_profiles').select(SUPPLIER_PROFILE_COLUMNS).eq('organization_id', org).in('status', ['HOMOLOGATED', 'PROSPECT'])
      .order('id').limit(READ_LIMIT),
    sb.from('procurement_rfq_lines').select('rfq_id').eq('organization_id', org).eq('item_id', itemId).limit(READ_LIMIT),
    sb.from('purchase_order_lines').select('purchase_order_id').eq('organization_id', org).eq('item_id', itemId).limit(READ_LIMIT),
  ]);
  if (item.error) throw new Error('item em foco');
  if (profiles.error) throw new Error('fornecedores');
  if (rfqLines.error) throw new Error('cotações do item');
  if (poLines.error) throw new Error('pedidos do item');
  const profileRows = (profiles.data ?? []) as unknown as SupplierProfileRow[];
  const [quotes, pos] = await Promise.all([
    selectIn<{ supplier_id: string; lead_time_days: unknown; recorded_at: string | null; status: string }>(
      ((rfqLines.data ?? []) as Row[]).map((r) => str(r.rfq_id)), (c) => sb.from('supplier_quotes')
        .select('supplier_id,lead_time_days,recorded_at,status').eq('organization_id', org).in('rfq_id', c)),
    selectIn<{ id: string; supplier_id: string | null; status: string }>(((poLines.data ?? []) as Row[]).map((r) => str(r.purchase_order_id)),
      (c) => sb.from('purchase_orders').select('id,supplier_id,status').eq('organization_id', org).in('id', c)),
  ]);
  const history = new Set<string>([
    ...quotes.filter((q) => q.status !== 'WITHDRAWN').map((q) => q.supplier_id),
    ...pos.filter((p) => p.status !== 'CANCELLED' && p.supplier_id).map((p) => p.supplier_id as string),
  ]);
  const category = str(((item.data ?? []) as Row[])[0]?.category);
  const basis = supplierBasis({ category, profiles: profileRows, historySupplierIds: history });
  const quotedLead = new Map<string, number>();
  for (const q of [...quotes].filter((x) => x.status !== 'WITHDRAWN' && nullableNum(x.lead_time_days) !== null)
    .sort((a, b) => String(a.recorded_at ?? '').localeCompare(String(b.recorded_at ?? '')))) {
    quotedLead.set(q.supplier_id, nullableNum(q.lead_time_days) as number);
  }
  const info = await readSupplierInfo(sb, org, Array.from(basis.keys()), opts.supplierNames, profileRows);
  return { candidates: supplierCandidates({ basis, info, quotedLead }), truncated: profileRows.length >= READ_LIMIT };
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
  'contracts.view', 'finance.view',
  // As alçadas das rotas governadas que o Supply do local oferece (o mesmo `anyOf` de cada rota).
  'procurement.request', 'procurement.source', 'procurement.approve', 'suppliers.manage', 'inventory.reserve', 'inventory.manage',
  // 246: a exceção de cobertura (o banco a reconfere em `purchase_requisition_from_shortage`).
  'procurement.coverage_override'] as const;

/**
 * O que ESTA pessoa pode fazer aqui — as chaves exatas das rotas governadas:
 * requisições (`procurement.request`), cotação/decisão/envio
 * (`procurement.source`), aprovação (`procurement.approve`), cadastro de
 * fornecedor (`suppliers.manage`), reserva (`inventory.reserve`),
 * transferência (`inventory.manage` OU `inventory.reserve`, a da rota) e a
 * exceção de cobertura (`procurement.coverage_override`, 246 — comprar também
 * o que a transferência pendente cobre; a requisição em si segue exigindo
 * `procurement.request`, e o banco reconfere as duas).
 */
export function supplyCapabilities(has: Readonly<Record<string, boolean>>, aiSearch: SupplyCapabilities['aiSearch']): SupplyCapabilities {
  return {
    request: has['procurement.request'] === true,
    source: has['procurement.source'] === true,
    approve: has['procurement.approve'] === true,
    suppliersManage: has['suppliers.manage'] === true,
    reserve: has['inventory.reserve'] === true,
    transfer: has['inventory.manage'] === true || has['inventory.reserve'] === true,
    aiSearch,
    coverageOverride: has['procurement.request'] === true && has['procurement.coverage_override'] === true,
  };
}

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
  const { materials, shortageById, typeById, requiredById, truncated } = coverage.data;
  const focus = pickFocus(materials, requested);
  const liveShortage = (id: string): number | null => (shortageById.has(id) ? shortageById.get(id) as number : truncated ? null : 0);
  // RLS de cotação, proposta e decisão (234): procurement.view OU supply.view — o mesmo portão do valor.
  const procurementGate = has['procurement.view'] || has['supply.view'];

  const [stock, orders, site, planFacts, procurement, suppliers] = await Promise.all([
    sitePart(stockGate, 'o estoque do item', async () => (focus?.item
      ? readStock(sb, org, projectId, focus.item.id) : { nodes: [] as StockNode[], truncated: false }), timings, 'stock'),
    sitePart(ordersGate, 'os pedidos', async () => (focus
      ? readOrders(sb, org, projectId, focus, { amountVisible, supplierNames }) : { orders: [], poIds: new Set<string>() }), timings, 'orders'),
    sitePart(true, 'a posição do local', () => readSite(sb, org, projectId), timings, 'site'),
    sitePart(stockGate, 'as transferências do material', async () => (focus
      ? readPlanFacts(sb, org, projectId, focus.requirementId, focus.item?.id ?? null, today)
      : { transit: [], inTransit: [], pending: [], pendingRefs: [], promised: new Map<string, number>() }),
    timings, 'planFacts'),
    sitePart(procurementGate, 'as solicitações e cotações', async () => (focus
      ? readProcurement(sb, org, focus, today, { amountVisible, supplierNames, requiredBy: requiredById.get(focus.requirementId) ?? null })
      : []), timings, 'procurement'),
    sitePart(procurementGate, 'os fornecedores do item', async () => (focus?.item
      ? readSupplierCandidates(sb, org, focus.item.id, { supplierNames }) : { candidates: [], truncated: false }), timings, 'suppliers'),
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
  const siteData = site.state === 'ok' ? site.data : { coordinate: null, locations: [] };

  // Solicitações e cotações; a chave de Decisões do pedido em aprovação vem da caixa DESTA pessoa.
  const procurementSection: SiteSupplyData['procurement'] = procurement.state !== 'ok' ? procurement
    : { state: 'ok', data: { requisitions: withDecisionKeys(procurement.data, inbox.state === 'ok' ? inbox.data : null) } };

  // O plano: sem o estoque (restrito ou falhou) não há plano honesto — "compre tudo" seria mentira.
  let plan: SiteSupplyData['plan'];
  if (!focus) plan = { state: 'ok', data: { steps: [], remainingShortage: 0, basis: 'Sem material em foco neste local.' } };
  else if (stock.state === 'restricted' || planFacts.state === 'restricted') plan = { state: 'restricted' };
  else if (stock.state === 'error' || planFacts.state === 'error') {
    plan = { state: 'error', message: 'Não foi possível montar o plano: o estoque do item não carregou.' };
  } else if (stock.state === 'ok' && planFacts.state === 'ok') {
    const open = procurement.state === 'ok'
      ? procurement.data.filter((r) => r.status === 'SUBMITTED' || r.status === 'SOURCING').map((r) => ({ number: r.number })) : null;
    plan = {
      state: 'ok',
      data: supplyPlan({
        focus, requirementType: typeById.get(focus.requirementId) ?? null, stock: stock.data.nodes, site: siteData.coordinate,
        siteLocations: siteData.locations, transit: planFacts.data.transit, inTransit: planFacts.data.inTransit,
        pendingTransfers: planFacts.data.pending, promised: planFacts.data.promised, requisitions: open,
        purchaseOrders: orders.state === 'ok' ? orders.data.orders.map((o) => ({ number: o.number })) : null,
        caps: { reserve: has['inventory.reserve'], transfer: has['inventory.manage'] || has['inventory.reserve'],
          manage: has['inventory.manage'], request: has['procurement.request'] },
        projectId, today,
      }),
      ...(stock.data.truncated ? { truncated: true } : {}),
    };
  } else plan = { state: 'error', message: 'Não foi possível montar o plano.' };

  // 246: o material em foco com a LISTA das suas transferências pendentes (para resolvê-las no Estoque);
  // o número (`pendingTransfer`) e o comprável seguem os da visão.
  const focusView = focus && planFacts.state === 'ok' ? withPendingTransfers(focus, planFacts.data.pendingRefs) : focus;
  const data: SiteSupplyData = {
    focus: focusView,
    materials: focusView === focus ? materials : materials.map((m) => (m === focus ? focusView as MaterialBalance : m)),
    stock: stock.state === 'ok'
      ? { state: 'ok', data: stock.data.nodes, ...(stock.data.truncated ? { truncated: true } : {}) }
      : stock,
    orders: orders.state === 'ok' ? { state: 'ok', data: orders.data.orders } : orders,
    apex,
    decisions,
    site: siteData.coordinate,
    plan,
    procurement: procurementSection,
    suppliers: suppliers.state === 'ok'
      ? { state: 'ok', data: suppliers.data.candidates, ...(suppliers.data.truncated ? { truncated: true } : {}) }
      : suppliers,
    capabilities: supplyCapabilities(has, supplierDiscoveryAvailability()),
    truncated,
  };
  return { ok: true, today, project, supply: { state: 'ok', data, ...(truncated ? { truncated: true } : {}) } };
}
