/**
 * READ MODEL do Dashboard V2 — "O que está acontecendo" (server-only).
 *
 * Compõe leituras que JÁ existem (Operações, Supply, Decisões) e algumas
 * leituras estreitas novas, TODAS pelo cliente AUTENTICADO da sessão
 * (`session.supabase`), com `.eq('organization_id')` em cada tabela e os
 * `.in()` em lotes (`selectIn`). Nenhuma leitura nova pelo service role: as
 * únicas que existem são as que as leituras compostas já faziam (nomes de
 * responsáveis, contexto das OS, enriquecimento da caixa de Decisões), cada
 * uma só depois do portão da sua seção.
 *
 * Portões = espelho da RLS (ARCHITECTURE.md §5). O que a pessoa não lê volta
 * `restricted` — nunca 0. Uma leitura que falhou volta `error` — nunca 0.
 * Cada seção roda isolada (`Promise.allSettled` + prazo): uma que cai não
 * derruba as outras. As regras de texto, gravidade, ordem e agrupamento
 * moram em `./rules` (puras e testadas).
 */
if (typeof window !== 'undefined') {
  throw new Error('dashboard/overview.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { hasOptionalPermission, type CommercialSession } from '@/lib/commercial/server-session';
import { operationsOverview, type OperationsOverview } from '@/lib/operations/overview';
import { listSupplySignals, type SupplySignalsModel } from '@/lib/supply/intelligence-read';
import { supplyFlow } from '@/lib/supply/read-model';
import { fromViewRow, type CoverageViewRow } from '@/lib/supply/coverage';
import { projectIdentity } from '@/lib/operations/project-identity';
import { selectIn } from '@/lib/supabase/select-in';
import { decisionSetup, enrichInbox, viewerInbox } from '@/lib/decisions/read';
import { decisionHref, effectiveDeadline, prioritize } from '@/lib/decisions/model';
import { amountText } from '@/components/decisions/view';
import { DOMAIN_LABEL } from './types';
import type {
  CalendarItem, DashboardOverview, DecisionsModel, Domain, FeedModel, FeedRow, ProjectsModel, SectionState,
} from './types';
import {
  addDays, billingGate, billingRows, buildCalendar, buildFeedModel, buildStages, cappedOpsExtras, decisionPreview, isoDay,
  materialRisk, materialRow, maskedMoney, mergeFeed, mergeLaneParts, needCalendarItems, operationCalendarItems, operationPresence,
  opsRow, overdueGroupRow, projectRows, rankFeed, receivableRows, receivablesGate, sumByCurrency, CALENDAR_DAYS, DOMAIN_ORDER,
  type BillingEventLike, type CalendarLaneState, type MaterialNeed, type ReceivableLike, type SignalLike, type StagesInput,
} from './rules';

type Session = CommercialSession;
type Row = Record<string, unknown>;

/** Prazo de cada seção: passou disso, a seção volta `error` e as outras seguem. */
export const SECTION_TIMEOUT_MS = 6_000;
/** Teto de linhas por leitura (o `max_rows` do PostgREST): chegar nele marca `truncated`. */
const READ_LIMIT = 1000;

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/* ── Portões ────────────────────────────────────────────────────────────── */

export interface DashboardGates {
  projects: boolean;
  /** `projects.measurements.view` || `projects.view`. */
  measurements: boolean;
  risks: boolean;
  /** `operations.view` — OS. */
  operations: boolean;
  /** supply || procurement || receiving || operations.planning || projects (RLS de pedidos/recebimentos, 234/235). */
  supplyFlow: boolean;
  /** As chaves de `/api/supply/intelligence` (RLS de `supply_signals`, 236). */
  signals: boolean;
  /** `billingGate`: a RLS EFETIVA de `contract_billing_events` (lê TODAS as linhas) — ver `./rules`. */
  billing: boolean;
  /** `receivablesGate`: `billingGate` E o predicado de `fs_select` (saldo do título). */
  receivables: boolean;
  /** `current_user_can_view_project_financials()` === true — dinheiro só com isto. */
  financial: boolean;
  commercial: boolean;
  contracts: boolean;
}

const PERMISSION_KEYS = [
  'projects.view', 'projects.measurements.view', 'risks.view', 'operations.view', 'supply.view', 'procurement.view',
  'inventory.view', 'receiving.view', 'operations.planning.view', 'contracts.view', 'contracts.view_values', 'contracts.edit',
  'finance.view', 'commercial.view',
] as const;

/** Todos os portões num só `Promise.all`, perguntados ao MESMO resolvedor da RLS. */
export async function resolveGates(session: Session): Promise<DashboardGates> {
  const sb = session.supabase;
  const [flags, fin, finAdmin, finAnalyst] = await Promise.all([
    Promise.all(PERMISSION_KEYS.map((k) => hasOptionalPermission(session, k))),
    sb.rpc('current_user_can_view_project_financials'),
    sb.rpc('has_finance_role_or_perm', { role_key: 'finance_admin', perm_key: 'finance.admin' }),
    sb.rpc('has_finance_role_or_perm', { role_key: 'finance_analyst', perm_key: 'finance.edit' }),
  ]);
  const has = Object.fromEntries(PERMISSION_KEYS.map((k, i) => [k, flags[i] === true])) as Record<(typeof PERMISSION_KEYS)[number], boolean>;
  const money = {
    contractsViewValues: has['contracts.view_values'], financeView: has['finance.view'],
    contractsView: has['contracts.view'], contractsEdit: has['contracts.edit'],
    financeAdmin: finAdmin.data === true, financeAnalyst: finAnalyst.data === true,
  };
  return {
    projects: has['projects.view'],
    measurements: has['projects.measurements.view'] || has['projects.view'],
    risks: has['risks.view'],
    operations: has['operations.view'],
    supplyFlow: has['supply.view'] || has['procurement.view'] || has['receiving.view'] || has['operations.planning.view'] || has['projects.view'],
    signals: has['supply.view'] || has['procurement.view'] || has['inventory.view'] || has['receiving.view']
      || has['operations.planning.view'] || has['projects.view'],
    // Espelho da RLS EFETIVA da view (não só do primeiro fator): quem passaria no portão e
    // leria 0 linhas veria "0 aguardando liberação" — é Restrito.
    billing: billingGate(money),
    receivables: receivablesGate(money),
    // Falha fechada: só `true` libera dinheiro.
    financial: fin.data === true,
    commercial: has['commercial.view'],
    contracts: has['contracts.view'],
  };
}

/* ── Execução isolada por seção ─────────────────────────────────────────── */

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado ao ler ${label}.`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

async function runSection<T>(
  gate: boolean, label: string, run: () => Promise<T>, timings: Record<string, number> | undefined, key: string,
): Promise<SectionState<T>> {
  if (!gate) return { state: 'restricted' };
  const started = Date.now();
  try {
    const data = await withTimeout(Promise.resolve().then(run), SECTION_TIMEOUT_MS, label);
    return { state: 'ok', data };
  } catch (error) {
    console.error(`[dashboard] seção ${key} falhou`, error);
    return { state: 'error', message: `Não foi possível ler ${label}.` };
  } finally {
    if (timings) timings[key] = Date.now() - started;
  }
}

const settledState = <T>(r: PromiseSettledResult<SectionState<T>>, label: string): SectionState<T> =>
  r.status === 'fulfilled' ? r.value : { state: 'error', message: `Não foi possível ler ${label}.` };

/* ── Leituras estreitas ─────────────────────────────────────────────────── */

const COVERAGE_COLUMNS = 'requirement_id,project_id,activity_id,item_id,requirement_type,required_by,unit,required_qty,'
  + 'reserved_qty,consumed_qty,in_transit_qty,on_order_qty,requested_qty,inspection_qty';

interface CoverageRead { needs: MaterialNeed[]; short: number; truncated: boolean; projectNames: Map<string, string> }

/** Faltas AO VIVO (`shortage_qty > 0`), com atividade, título do requisito e nome do projeto. */
async function readCoverage(sb: SupabaseClient, org: string): Promise<CoverageRead> {
  const res = await sb.from('supply_requirement_coverage').select(COVERAGE_COLUMNS, { count: 'exact' })
    .eq('organization_id', org).gt('shortage_qty', 0)
    .order('required_by', { ascending: true, nullsFirst: false }).order('requirement_id').limit(READ_LIMIT);
  if (res.error || res.count === null || res.count === undefined) throw new Error('cobertura de material');
  const rows = (res.data ?? []) as unknown as CoverageViewRow[];
  const [acts, reqs, projects] = await Promise.all([
    selectIn<{ id: string; title: string | null; planned_start: string | null }>(rows.map((r) => r.activity_id),
      (c) => sb.from('project_timeline_items').select('id,title,planned_start').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; title: string | null }>(rows.map((r) => r.requirement_id),
      (c) => sb.from('project_requirements').select('id,title').eq('organization_id', org).in('id', c)),
    selectIn<{ id: string; project: Record<string, unknown>; project_v2: Record<string, unknown> | null }>(rows.map((r) => r.project_id),
      (c) => sb.from('projects').select('id,project,project_v2').eq('organization_id', org).in('id', c)),
  ]);
  const actMap = new Map(acts.map((a) => [a.id, a]));
  const reqMap = new Map(reqs.map((r) => [r.id, r.title]));
  const projectNames = new Map(projects.map((p) => [p.id, projectIdentity(p.id, p.project, p.project_v2).name]));
  const needs: MaterialNeed[] = [];
  for (const r of rows) {
    const coverage = fromViewRow(r);
    if (coverage.shortage <= 0) continue;
    const act = r.activity_id ? actMap.get(r.activity_id) : undefined;
    needs.push({
      requirementId: r.requirement_id, projectId: r.project_id, project: projectNames.get(r.project_id) ?? null,
      title: reqMap.get(r.requirement_id) ?? null, unit: r.unit, requiredBy: r.required_by,
      activity: act ? { id: act.id, title: act.title, plannedStart: act.planned_start } : null, coverage,
    });
  }
  return { needs, short: res.count, truncated: res.count > rows.length, projectNames };
}

/** Teto das leituras do calendário (entregas, prazos de medição): chegar nele marca a raia `partial`. */
const CALENDAR_READ_LIMIT = 200;

interface InboundRead { items: CalendarItem[]; truncated: boolean }

/** Entregas previstas (ETA) nos próximos 30 dias, só de pedidos vivos. */
async function readInbound(sb: SupabaseClient, org: string, today: string): Promise<InboundRead> {
  const ships = await sb.from('inbound_shipments').select('id,purchase_order_id,eta,status').eq('organization_id', org)
    .in('status', ['EXPECTED', 'IN_TRANSIT']).gte('eta', today).lte('eta', addDays(today, CALENDAR_DAYS))
    .order('eta').limit(CALENDAR_READ_LIMIT);
  if (ships.error) throw new Error('embarques');
  const rows = (ships.data ?? []) as Row[];
  const pos = await selectIn<{ id: string; order_number: string | null; project_id: string | null }>(
    rows.map((s) => str(s.purchase_order_id)),
    (c) => sb.from('purchase_orders').select('id,order_number,project_id').eq('organization_id', org)
      .in('status', ['ISSUED', 'PARTIALLY_RECEIVED']).in('id', c));
  const poMap = new Map(pos.map((p) => [p.id, p]));
  const items: CalendarItem[] = [];
  for (const s of rows) {
    const po = poMap.get(String(s.purchase_order_id));
    const date = isoDay(s.eta);
    if (!po || !date) continue;
    items.push({
      id: `ship:${String(s.id)}`, date, title: `Entrega do pedido ${po.order_number ?? ''}`.trim(), lane: 'supply', kind: 'delivery',
      tone: 'neutral', href: `/supply/compras?stage=pedidos&po=${encodeURIComponent(po.id)}`, project: po.project_id,
    });
  }
  return { items, truncated: rows.length >= CALENDAR_READ_LIMIT };
}

interface MeasurementDuesRead { items: CalendarItem[]; truncated: boolean }

/** Prazos do cliente (`customer_due_at`) das medições que esperam o cliente, nos próximos 30 dias. */
async function readMeasurementDues(sb: SupabaseClient, org: string, today: string): Promise<MeasurementDuesRead> {
  const res = await sb.from('project_measurements').select('id,project_id,occurrence_key,customer_due_at,status')
    .eq('organization_id', org).in('status', ['APPROVED_FOR_CUSTOMER', 'AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_CORRECTION_REQUESTED'])
    .gte('customer_due_at', today).lte('customer_due_at', addDays(today, CALENDAR_DAYS)).order('customer_due_at')
    .limit(CALENDAR_READ_LIMIT);
  if (res.error) throw new Error('prazos de medição');
  const rows = (res.data ?? []) as Row[];
  const items = rows.flatMap((m) => {
    const date = isoDay(m.customer_due_at);
    if (!date) return [];
    return [{
      id: `meas:${String(m.id)}`, date, title: `Medição ${String(m.occurrence_key ?? '')} — prazo do cliente`.replace('  ', ' '),
      lane: 'medicao' as const, kind: 'due' as const, tone: 'warning' as const,
      href: `/projetos/${encodeURIComponent(String(m.project_id))}?tab=measurements`, project: str(m.project_id),
    }];
  });
  return { items, truncated: rows.length >= CALENDAR_READ_LIMIT };
}

/** Rótulo do contrato ("CT-0042 · Retrofit UG-05") — só exibição, lido sob a RLS de contratos. */
async function readContractLabels(sb: SupabaseClient, org: string, ids: Array<string | null>): Promise<Map<string, string>> {
  const rows = await selectIn<{ id: string; contract_number: string | null; title: string | null }>(ids,
    (c) => sb.from('contracts').select('id,contract_number,title').eq('organization_id', org).in('id', c));
  return new Map(rows.map((r) => [r.id, [r.contract_number, r.title].filter(Boolean).join(' · ') || 'Contrato']));
}

interface BillingRead {
  awaitingRelease: number;
  invoicesToIssue: number;
  invoicesAmount: string | null;
  events: BillingEventLike[];
  contractLabels: Map<string, string>;
  truncated: boolean;
}

const BILLING_VIEW = 'contract_to_cash_read_model';

/** Faturamento: contagens exatas + eventos das três classes (colunas EXPLÍCITAS; valor só com o RPC financeiro). */
async function readBilling(sb: SupabaseClient, org: string, financial: boolean): Promise<BillingRead> {
  const columns = 'billing_event_id,contract_id,title,currency,release_state,eligibility_state,fiscal_document_id,'
    + `superseded_by_id,legacy_row,cancelled_at${financial ? ',eligible_amount' : ''}`;
  const [awaiting, toIssue, rows] = await Promise.all([
    sb.from(BILLING_VIEW).select('billing_event_id', { count: 'exact', head: true }).eq('organization_id', org)
      .eq('eligibility_state', 'ELIGIBLE').eq('release_state', 'ELIGIBLE').is('cancelled_at', null).is('superseded_by_id', null)
      .not('legacy_row', 'is', true),
    sb.from(BILLING_VIEW).select('billing_event_id', { count: 'exact', head: true }).eq('organization_id', org)
      .eq('release_state', 'RELEASED').is('fiscal_document_id', null).is('cancelled_at', null),
    sb.from(BILLING_VIEW).select(columns).eq('organization_id', org).is('cancelled_at', null)
      .or('release_state.eq.ELIGIBLE,release_state.eq.PENDING_RELEASE,and(release_state.eq.RELEASED,fiscal_document_id.is.null)')
      .order('billing_event_id').limit(READ_LIMIT),
  ]);
  if (awaiting.error || awaiting.count === null || awaiting.count === undefined) throw new Error('faturamento: aguardando liberação');
  if (toIssue.error || toIssue.count === null || toIssue.count === undefined) throw new Error('faturamento: NF a emitir');
  if (rows.error) throw new Error('faturamento: eventos');
  const events: BillingEventLike[] = ((rows.data ?? []) as unknown as Row[]).map((r) => ({
    billingEventId: String(r.billing_event_id), contractId: str(r.contract_id), title: str(r.title),
    eligibleAmount: financial ? num(r.eligible_amount) : null, currency: str(r.currency),
    releaseState: str(r.release_state), eligibilityState: str(r.eligibility_state), fiscalDocumentId: str(r.fiscal_document_id),
    supersededById: str(r.superseded_by_id), legacyRow: r.legacy_row === null || r.legacy_row === undefined ? null : r.legacy_row === true,
    cancelledAt: str(r.cancelled_at),
  }));
  const truncated = events.length >= READ_LIMIT;
  const invoiceEvents = events.filter((e) => e.releaseState === 'RELEASED' && !e.fiscalDocumentId);
  // `eligible_amount` está em UNIDADES da moeda. Lista cortada → a soma seria piso: não se mostra valor.
  const invoicesAmount = truncated ? null
    : maskedMoney(sumByCurrency(invoiceEvents.map((e) => ({ amount: e.eligibleAmount, currency: e.currency }))), financial);
  const contractLabels = await readContractLabels(sb, org, events.map((e) => e.contractId));
  return {
    awaitingRelease: awaiting.count, invoicesToIssue: toIssue.count, invoicesAmount, events, contractLabels, truncated,
  };
}

interface ReceivablesRead {
  overdue: number;
  open: number;
  linked: number;
  rows: ReceivableLike[];
  contractLabels: Map<string, string>;
  truncated: boolean;
}

const OPEN_RECEIVABLE = ['OPEN', 'PARTIAL', 'OVERDUE'];

/** Recebíveis VINCULADOS ao faturamento contratual (valor em CENTAVOS, só com o RPC financeiro). */
async function readReceivables(sb: SupabaseClient, org: string, financial: boolean): Promise<ReceivablesRead> {
  const columns = `billing_event_id,contract_id,due_date,currency,receivable_status${financial ? ',open_amount_cents' : ''}`;
  const [linked, overdue, rows] = await Promise.all([
    sb.from(BILLING_VIEW).select('billing_event_id', { count: 'exact', head: true }).eq('organization_id', org)
      .eq('finance_link_state', 'LINKED'),
    sb.from(BILLING_VIEW).select('billing_event_id', { count: 'exact', head: true }).eq('organization_id', org)
      .eq('finance_link_state', 'LINKED').eq('receivable_status', 'OVERDUE'),
    sb.from(BILLING_VIEW).select(columns, { count: 'exact' }).eq('organization_id', org)
      .eq('finance_link_state', 'LINKED').in('receivable_status', OPEN_RECEIVABLE)
      .order('due_date', { ascending: true, nullsFirst: false }).limit(READ_LIMIT),
  ]);
  if (linked.error || linked.count === null || linked.count === undefined) throw new Error('recebíveis vinculados');
  if (overdue.error || overdue.count === null || overdue.count === undefined) throw new Error('recebíveis vencidos');
  if (rows.error || rows.count === null || rows.count === undefined) throw new Error('recebíveis em aberto');
  const list: ReceivableLike[] = ((rows.data ?? []) as unknown as Row[]).map((r) => ({
    billingEventId: String(r.billing_event_id), contractId: str(r.contract_id), dueDate: str(r.due_date),
    openAmountCents: financial ? num(r.open_amount_cents) : null, currency: str(r.currency), status: str(r.receivable_status),
  }));
  const contractLabels = await readContractLabels(sb, org, list.map((r) => r.contractId));
  return { overdue: overdue.count, open: rows.count, linked: linked.count, rows: list, contractLabels, truncated: rows.count > list.length };
}

/** Oportunidades em etapa ABERTA (fora de WON/LOST/ABANDONED) — só a contagem. */
async function readOpenOpportunities(sb: SupabaseClient, org: string): Promise<number> {
  const res = await sb.from('commercial_opportunities').select('id', { count: 'exact', head: true })
    .eq('organization_id', org).not('stage', 'in', '(WON,LOST,ABANDONED)');
  if (res.error || res.count === null || res.count === undefined) throw new Error('oportunidades');
  return res.count;
}

/**
 * Trabalho AUTORIZADO sem OS interna viva (a regra ACCEPTED_WITHOUT_SERVICE_ORDER:
 * nenhuma OS com status diferente de CANCELLED). Lido por páginas — a
 * contagem é exata, nunca a de uma leitura cortada.
 */
async function readAuthorizedWithoutOs(sb: SupabaseClient, org: string): Promise<number> {
  const ids: string[] = [];
  for (let from = 0; from < 20_000; from += READ_LIMIT) {
    const page = await sb.from('commercial_engagements').select('id').eq('organization_id', org).eq('status', 'AUTHORIZED')
      .order('id').range(from, from + READ_LIMIT - 1);
    if (page.error) throw new Error('trabalho autorizado');
    const rows = (page.data ?? []) as Array<{ id: string }>;
    ids.push(...rows.map((r) => r.id));
    if (rows.length < READ_LIMIT) break;
  }
  const live = await selectIn<{ engagement_id: string | null }>(ids,
    (c) => sb.from('internal_service_orders').select('engagement_id').eq('organization_id', org).neq('status', 'CANCELLED').in('engagement_id', c));
  const withOs = new Set(live.map((r) => r.engagement_id).filter(Boolean));
  return ids.filter((id) => !withOs.has(id)).length;
}

interface DecisionsRead {
  model: DecisionsModel;
  inboxPurchaseOrderIds: Set<string>;
  inboxBillingIds: Set<string>;
}

/**
 * A caixa CANÔNICA (`decision_inbox_for_viewer`) com o mesmo enriquecimento e
 * a mesma ordem (`prioritize`) de Decisões. Número = PRIMARY + ESCALATED, a
 * definição do selo. Falha (inclusive NOT_PROVISIONED) SOBE → `error`.
 */
async function readDecisions(session: Session, today: string): Promise<DecisionsRead> {
  const rows = await viewerInbox(session);
  const items = await enrichInbox(session, rows, today);
  const mine = prioritize(items.filter((i) => i.assignment !== 'ELIGIBLE'));
  const alsoEligible = items.filter((i) => i.assignment === 'ELIGIBLE').length;
  // A mesma regra de `decisionsWorkspace`: caixa vazia → a configuração explica o vazio.
  const setup = mine.length === 0 && alsoEligible === 0 ? await decisionSetup(session.organizationId, today) : null;
  return {
    model: {
      count: mine.length,
      overdue: mine.filter((i) => i.overdue).length,
      escalated: mine.filter((i) => i.assignment === 'ESCALATED').length,
      alsoEligible,
      top: mine.slice(0, 3).map((i) => decisionPreview(i, {
        href: decisionHref(i.key),
        amountText: i.amount === null ? null : amountText(i.amount, i.currency),
        amountRestricted: false,
        due: effectiveDeadline(i),
      })),
      setup,
    },
    inboxPurchaseOrderIds: new Set(rows.filter((r) => r.subject_type === 'purchase_order').map((r) => r.subject_id)),
    inboxBillingIds: new Set(rows.filter((r) => r.subject_type === 'contract_billing_event').map((r) => r.subject_id)),
  };
}

/* ── Composição ─────────────────────────────────────────────────────────── */

const dataOf = <T>(s: SectionState<T>): T | null => (s.state === 'ok' ? s.data : null);

/** Um número de uma seção de Operações, respeitando o portão da PARTE (ex.: OS sem `operations.view` é Restrito). */
function opsPart<T>(gate: boolean, ops: SectionState<OperationsOverview>, pick: (o: OperationsOverview) => T | null): SectionState<T> {
  if (!gate) return { state: 'restricted' };
  if (ops.state === 'restricted') return { state: 'restricted' };
  if (ops.state === 'error') return ops;
  const v = pick(ops.data);
  return v === null ? { state: 'restricted' } : { state: 'ok', data: v };
}

function mapState<T, U>(s: SectionState<T>, f: (t: T) => U): SectionState<U> {
  return s.state === 'ok' ? { state: 'ok', data: f(s.data) } : s;
}

/**
 * Monta o payload inteiro. `today` é o dia de São Paulo, o mesmo para todas as
 * leituras. `timings` (opcional) recebe a duração de cada seção para o
 * cabeçalho `Server-Timing`.
 */
export async function buildDashboardOverview(
  session: Session, today: string, timings?: Record<string, number>,
): Promise<DashboardOverview> {
  const sb = session.supabase;
  const org = session.organizationId;
  const g = await resolveGates(session);

  const opsGate = g.projects || g.operations || g.measurements || g.risks;
  const settled = await Promise.allSettled([
    runSection(opsGate, 'a visão de Operações', () => operationsOverview(session,
      { projects: g.projects, measurements: g.measurements, risks: g.risks, serviceOrders: g.operations }, today), timings, 'ops'),
    runSection(g.projects, 'a cobertura de material', () => readCoverage(sb, org), timings, 'coverage'),
    runSection(g.supplyFlow, 'o fluxo de compras', () => supplyFlow(session, today), timings, 'flow'),
    // Os abertos críticos/altos INTEIROS (até o teto do PostgREST): o total do cabeçalho depende de
    // cada um (viram linha ou se fundem a uma); passado do teto, a fila sai `partial`.
    runSection(g.signals, 'os achados da Apex', () => listSupplySignals(session,
      { openOnly: true, severities: ['critical', 'high'], limit: READ_LIMIT }), timings, 'signals'),
    runSection(g.supplyFlow, 'as entregas previstas', () => readInbound(sb, org, today), timings, 'inbound'),
    runSection(g.measurements, 'os prazos de medição', () => readMeasurementDues(sb, org, today), timings, 'measurementDues'),
    runSection(g.billing, 'o faturamento', () => readBilling(sb, org, g.financial), timings, 'billing'),
    runSection(g.receivables, 'os recebíveis', () => readReceivables(sb, org, g.financial), timings, 'receivables'),
    runSection(g.commercial, 'as oportunidades', () => readOpenOpportunities(sb, org), timings, 'opportunities'),
    runSection(g.contracts, 'o trabalho autorizado', () => readAuthorizedWithoutOs(sb, org), timings, 'authorized'),
    runSection(true, 'as decisões', () => readDecisions(session, today), timings, 'decisions'),
  ] as const);

  const ops = settledState(settled[0], 'a visão de Operações') as SectionState<OperationsOverview>;
  const coverage = settledState(settled[1], 'a cobertura de material') as SectionState<CoverageRead>;
  const flow = settledState(settled[2], 'o fluxo de compras') as SectionState<Awaited<ReturnType<typeof supplyFlow>>>;
  const signals = settledState(settled[3], 'os achados da Apex') as SectionState<SupplySignalsModel>;
  const inbound = settledState(settled[4], 'as entregas previstas') as SectionState<InboundRead>;
  const measurementDues = settledState(settled[5], 'os prazos de medição') as SectionState<MeasurementDuesRead>;
  const billing = settledState(settled[6], 'o faturamento') as SectionState<BillingRead>;
  const receivables = settledState(settled[7], 'os recebíveis') as SectionState<ReceivablesRead>;
  const opportunities = settledState(settled[8], 'as oportunidades') as SectionState<number>;
  const authorized = settledState(settled[9], 'o trabalho autorizado') as SectionState<number>;
  const decisionsRead = settledState(settled[10], 'as decisões') as SectionState<DecisionsRead>;

  const opsData = dataOf(ops);
  const coverageData = dataOf(coverage);
  const signalsData = dataOf(signals);
  const billingData = dataOf(billing);
  const receivablesData = dataOf(receivables);
  const decisionsData = dataOf(decisionsRead);

  // ── Nomes de projeto (só exibição) de leituras que a pessoa JÁ fez ──
  const projectNames = new Map<string, string>(coverageData?.projectNames ?? []);
  for (const p of opsData?.projectHealth ?? []) projectNames.set(p.projectId, p.project);
  for (const p of opsData?.overdueByProject ?? []) projectNames.set(p.projectId, p.project);
  for (const s of signalsData?.signals ?? []) if (s.projectId && s.project) projectNames.set(s.projectId, s.project);

  // ── Atenção agora ──
  const liveRows: FeedRow[] = [];
  if (opsData) {
    for (const item of opsData.attention) { const r = opsRow(item); if (r) liveRows.push(r); }
    for (const grp of opsData.overdueByProject) liveRows.push(overdueGroupRow(grp));
  }
  if (coverageData) for (const m of coverageData.needs) { const r = materialRow(m, today); if (r) liveRows.push(r); }
  if (billingData) {
    liveRows.push(...billingRows(billingData.events, {
      contractLabel: (id) => (id ? billingData.contractLabels.get(id) ?? null : null),
      financial: g.financial,
      inboxBillingIds: decisionsData?.inboxBillingIds ?? null,
    }));
  }
  if (receivablesData) {
    liveRows.push(...receivableRows(receivablesData.rows, {
      contractLabel: (id) => (id ? receivablesData.contractLabels.get(id) ?? null : null),
      financial: g.financial,
    }));
  }
  const shortageById = new Map((coverageData?.needs ?? []).map((m) => [m.requirementId, m.coverage.shortage]));
  const merged = mergeFeed({
    rows: liveRows,
    signals: (signalsData?.signals ?? []) as SignalLike[],
    inboxPurchaseOrderIds: decisionsData?.inboxPurchaseOrderIds ?? null,
    // Falta ao vivo: só é "0" quando a cobertura foi lida INTEIRA; senão, desconhecida.
    liveShortage: (id) => (!coverageData ? null : shortageById.has(id) ? shortageById.get(id) as number : coverageData.truncated ? null : 0),
  }).map((r) => (r.location.kind === 'project' && r.location.id && !r.location.label
    ? { ...r, location: { ...r.location, label: projectNames.get(r.location.id) ?? null } } : r));
  const ranked = rankFeed(merged);
  // Cada fonte da fila, com o que ela alimenta (para dizer O QUE não carregou).
  const opsDomains: FeedModel['failed'] = [
    ...(g.projects || g.operations || g.risks ? [{ domain: 'operacao' as const, label: DOMAIN_LABEL.operacao }] : []),
    ...(g.measurements ? [{ domain: 'medicao' as const, label: DOMAIN_LABEL.medicao }] : []),
  ];
  const feedSources: Array<{ gate: boolean; state: SectionState<unknown>; feeds: FeedModel['failed'] }> = [
    { gate: opsGate, state: ops, feeds: opsDomains },
    { gate: g.projects, state: coverage, feeds: [{ domain: 'supply', label: 'Cobertura de material' }] },
    { gate: g.signals, state: signals, feeds: [{ domain: 'supply', label: 'Achados da Apex' }] },
    { gate: g.billing, state: billing, feeds: [{ domain: 'faturamento', label: DOMAIN_LABEL.faturamento }] },
    { gate: g.receivables, state: receivables, feeds: [{ domain: 'recebivel', label: DOMAIN_LABEL.recebivel }] },
  ];
  const readSources = feedSources.filter((s) => s.gate);
  let feed: SectionState<FeedModel>;
  if (!readSources.length) feed = { state: 'restricted' };
  else if (readSources.every((s) => s.state.state === 'error')) feed = { state: 'error', message: 'Não foi possível montar a fila de atenção.' };
  else {
    // Leu, mas FALHOU: a fila é parcial — nunca "0 exceções" nem "Nada fora do lugar".
    const failed = readSources.filter((s) => s.state.state === 'error').flatMap((s) => s.feeds);
    // Leu COM CORTE: o total é piso. (A cobertura de Operações não alimenta linha da fila — fica de fora.)
    const partial = Boolean(coverageData?.truncated) || Boolean(billingData?.truncated) || Boolean(receivablesData?.truncated)
      || (signalsData ? (signalsData.openCount ?? 0) > signalsData.signals.length : false)
      || (opsData ? opsData.truncated.activities || opsData.truncated.measurements || opsData.truncated.risks
        || opsData.serviceOrdersTruncated : false);
    feed = {
      state: 'ok',
      data: buildFeedModel(ranked, opsData ? cappedOpsExtras(opsData.attentionCounts, merged) : [], { failed, partial }),
      truncated: failed.length > 0 || partial,
    };
  }

  // ── Fluxo do negócio ──
  const stagesInput: StagesInput = {
    authorizedWithoutOs: authorized,
    openOpportunities: opportunities,
    os: opsPart(g.operations, ops, (o) => (o.serviceOrdersAccess
      ? { awaitingIssue: o.kpis.serviceOrdersAwaitingIssue, blocked: o.kpis.serviceOrdersBlocked, inExecution: o.osFlow.linked,
        partial: o.serviceOrdersTruncated } : null)),
    projects: opsPart(g.projects, ops, (o) => (o.healthCounts && o.kpis.activeProjects !== null && o.kpis.criticalActivities !== null
      && o.projectsWithoutOpenActivity !== null
      ? {
        active: o.kpis.activeProjects, health: o.healthCounts, criticalActivities: o.kpis.criticalActivities,
        withoutSchedule: o.projectsWithoutOpenActivity,
        // A saúde lê cronograma, riscos, medições, cobertura e OS: qualquer uma cortada → críticos é piso.
        healthPartial: o.truncated.activities || o.truncated.risks || o.truncated.measurements || o.truncated.coverage
          || o.serviceOrdersTruncated,
        schedulePartial: o.truncated.activities,
      } : null)),
    needs: mapState(coverage, (c) => ({ short: c.short, critical: c.needs.filter((m) => materialRisk(m, today) === 'critical').length,
      partial: c.truncated })),
    supply: mapState(flow, (f) => ({ lateInbound: f.lateInbound, requisitionsAwaitingSourcing: f.requisitionsAwaitingSourcing,
      receivingIssues: f.receivingIssues })),
    execution: opsPart(g.projects, ops, (o) => (o.overdueActivities !== null && o.inProgressActivities !== null
      ? { overdue: o.overdueActivities, inProgress: o.inProgressActivities, partial: o.truncated.activities } : null)),
    measurement: opsPart(g.measurements, ops, (o) => (o.kpis.measurementPending !== null && o.measurementLanes
      ? { pending: o.kpis.measurementPending, awaitingCustomer: o.measurementLanes.AWAITING_CUSTOMER, inReview: o.measurementLanes.INTERNAL_REVIEW,
        partial: o.truncated.measurements }
      : null)),
    billing: mapState(billing, (b) => ({ awaitingRelease: b.awaitingRelease, invoicesToIssue: b.invoicesToIssue, invoicesAmount: b.invoicesAmount })),
    receivables: mapState(receivables, (r) => ({ overdue: r.overdue, open: r.open, linked: r.linked })),
  };
  const stages = buildStages(stagesInput);

  // ── Projetos ──
  const projects: SectionState<ProjectsModel> = (() => {
    const part = opsPart(g.projects, ops, (o) => (o.projectHealth && o.healthCounts ? { list: o.projectHealth, counts: o.healthCounts } : null));
    if (part.state !== 'ok') return part;
    const total = part.data.counts.critical + part.data.counts.attention + part.data.counts.healthy + part.data.counts.unknown;
    return {
      state: 'ok',
      data: { rows: projectRows(part.data.list, ranked), total, counts: part.data.counts },
      truncated: part.data.list.length < total,
    };
  })();

  // ── Decisões ──
  const decisions: SectionState<DecisionsModel> = mapState(decisionsRead, (d) => d.model);

  // ── Calendário ──
  const withProject = (items: CalendarItem[]) => items.map((it) => (it.project ? { ...it, project: projectNames.get(it.project) ?? null } : it));
  /** Uma leitura → estado da raia, com `partial` quando a leitura veio cortada. */
  const lanePart = <T>(s: SectionState<T>, items: (t: T) => CalendarItem[], cut: (t: T) => boolean): CalendarLaneState =>
    (s.state === 'ok' ? { state: 'ok', data: items(s.data), ...(cut(s.data) ? { partial: true } : {}) } : s);
  // Supply = faltas (cobertura) + entregas (ETA): se UMA falha, a raia sai `partial` — nunca some calada.
  const supplyLane = mergeLaneParts([
    ...(g.projects ? [lanePart(coverage, (c) => needCalendarItems(c.needs, today), (c) => c.truncated)] : []),
    ...(g.supplyFlow ? [lanePart(inbound, (i) => withProject(i.items), (i) => i.truncated)] : []),
  ], 'Supply');
  const operacaoLane: CalendarLaneState = (() => {
    const part = opsPart(g.projects, ops, (o) => (o.horizon ? operationCalendarItems(o.horizon) : null));
    // O horizonte sai do cronograma lido: cortado → a raia é parcial.
    return part.state === 'ok' && opsData?.truncated.activities ? { ...part, partial: true } : part;
  })();
  const calendar = buildCalendar(today, {
    operacao: operacaoLane,
    supply: supplyLane,
    medicao: lanePart(measurementDues, (m) => withProject(m.items), (m) => m.truncated),
    recebivel: lanePart(receivables, (r) => r.rows.flatMap((x) => {
      const date = isoDay(x.dueDate);
      if (!date) return [];
      const label = x.contractId ? r.contractLabels.get(x.contractId) ?? null : null;
      return [{
        id: `rcv:${x.billingEventId}`, date, title: label ? `Vencimento · ${label}` : 'Vencimento de título',
        lane: 'recebivel' as const, kind: 'due' as const, tone: x.status === 'OVERDUE' ? 'danger' as const : 'accent' as const,
        href: '/contratos?view=faturamento', project: null,
      }];
    }), (r) => r.truncated),
  });

  // ── O que a pessoa lê ──
  const readableFlags: Record<Domain, boolean> = {
    comercial: g.commercial || g.contracts,
    operacao: g.projects || g.operations || g.risks,
    supply: g.supplyFlow || g.signals,
    medicao: g.measurements,
    faturamento: g.billing,
    recebivel: g.receivables,
  };
  const readable = DOMAIN_ORDER.filter((d) => readableFlags[d]);
  const notReadable = DOMAIN_ORDER.filter((d) => !readableFlags[d]).map((d) => DOMAIN_LABEL[d]);

  const hasOperation = operationPresence({
    activeProjects: g.projects && opsData && opsData.kpis.activeProjects !== null ? opsData.kpis.activeProjects : null,
    openServiceOrders: g.operations && opsData && opsData.serviceOrdersAccess
      ? { value: opsData.osFlow.draft + opsData.osFlow.review + opsData.osFlow.issued + opsData.osFlow.linked,
        partial: opsData.serviceOrdersTruncated }
      : null,
    openOpportunities: dataOf(opportunities),
    authorizedWithoutOs: dataOf(authorized),
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    today,
    readable,
    notReadable,
    feed,
    stages,
    projects,
    decisions,
    calendar,
    // Sem leitura de sinais (restrito ou falha) → `null`: nunca "ainda sem leitura" quando não se sabe.
    apex: signalsData ? { lastRun: signalsData.lastRun } : null,
    hasOperation,
  };
}
