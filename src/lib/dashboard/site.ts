/**
 * LOCAL EM FOCO — `GET /api/dashboard/site/[projectId]` (Visão geral).
 *
 * O que está acontecendo NESTE local, pelas MESMAS leituras e regras do
 * Dashboard, recortadas no projeto — nenhuma verdade nova:
 *  • saúde = `deriveProjectHealth` com os mesmos fatos da Visão Geral de
 *    Operações (a mesma derivação que pinta o marcador no globo);
 *  • a fila = as MESMAS funções de linha do Dashboard (`opsRow`,
 *    `overdueGroupRow`, `materialRow`, `billingRows`, `mergeFeed`, `rankFeed`,
 *    `buildFeedModel`) — mesmo `key`, mesmo `explainRef`: "Entender" funciona igual;
 *  • medições, riscos (nunca `financial_exposure`), cobertura, sinais da Apex,
 *    contrato vinculado, faturamento dos contratos vinculados, decisões e
 *    calendário — cada um sob o portão do Dashboard (espelho da RLS).
 *
 * Leituras ESTREITAS pelo cliente AUTENTICADO, com `.eq('organization_id')` e
 * `.eq('project_id')` em cada tabela. Service role: só o que as leituras
 * compostas já faziam (contagens de bloqueio das OS — `countsFor`, o mesmo do
 * Projeto 360 e do Entender —, nomes de responsáveis e o enriquecimento da
 * caixa de Decisões), cada um depois do seu portão.
 *
 * Restrito nunca é 0; uma leitura que falhou nunca parece calma: a seção vira
 * `error`, e a fila diz o que não carregou (`failed`) ou que é piso (`partial`).
 */
if (typeof window !== 'undefined') {
  throw new Error('dashboard/site.ts não pode ser importado no navegador');
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { hasOptionalPermission } from '@/lib/commercial/server-session';
import { resolveOwnerNames } from '@/lib/commercial/owner-directory';
import { serviceOrderStatusLabels } from '@/lib/commercial/labels';
import type { ServiceOrderStatus } from '@/lib/commercial/types';
import { listSupplySignals } from '@/lib/supply/intelligence-read';
import { fromViewRow, type CoverageViewRow } from '@/lib/supply/coverage';
import { selectIn } from '@/lib/supabase/select-in';
import { enrichInbox, viewerInbox } from '@/lib/decisions/read';
import type { DecisionInboxRow } from '@/lib/decisions/types';
import { decisionHref, effectiveDeadline, prioritize } from '@/lib/decisions/model';
import { amountText } from '@/components/decisions/view';
import { countsFor } from '@/lib/operations/service-orders/read-model';
import { serviceOrderNextAction } from '@/lib/operations/service-orders/next-action';
import type { ServiceOrderCounts } from '@/lib/operations/service-orders/types';
import { MEASUREMENT_STATUS_LABEL, type MeasurementStatus } from '@/lib/projects/measurements/types';
import {
  horizonOf, isCriticalActivity, isInProgressActivity, isMaterialOpenRisk, isOperationalMeasurementPending, isOverdueActivity,
  measurementLane, type ActivityLike, type Horizon,
} from '@/lib/operations/overview-rules';
import { groupOverdueByProject, overdueActivityTone } from '@/lib/operations/overview-aggregates';
import type { AttentionItem } from '@/lib/operations/overview';
import { deriveProjectHealth, physicalProgress } from '@/lib/operations/projects/health';
import { isActiveProjectStatus } from '@/lib/operations/project-identity';
import { DOMAIN_LABEL } from './types';
import type {
  CalendarItem, DecisionPreview, Domain, FeedModel, FeedRow, HealthLevel, NextAction, SectionState, SiteHud, SitePosition,
} from './types';
import {
  addDays, billingClass, billingRows, buildCalendar, buildFeedModel, decisionPreview, isoDay, materialRisk, materialRow, maskedMoney,
  mergeFeed, mergeLaneParts, needCalendarItems, operationCalendarItems, opsRow, overdueGroupRow, rankFeed, sumByCurrency,
  CALENDAR_DAYS, DOMAIN_ORDER, type BillingEventLike, type CalendarLaneState, type MaterialNeed, type SignalLike,
} from './rules';
import { INBOX_SECTION_TIMEOUT_MS } from './overview';
import {
  dataOf, mapSection, num, readPaged, readProjectCoverage, runSiteSection, str, text, SUPPLY_COVERED_REQUIREMENT_TYPES,
  type SiteContext, type Timings,
} from './site-common';

type Row = Record<string, unknown>;
type Json = Record<string, unknown>;

/* ══════════════════════════════════════════════════════════════════════════
   REGRAS PURAS (exportadas para teste)
   ══════════════════════════════════════════════════════════════════════════ */

export type SiteActivity = ActivityLike & {
  id: string;
  parent_id: string | null;
  wbs_code: string | null;
  row_order: number | null;
  type: string;
  title: string;
  actual_start: string | null;
  duration_minutes: number | null;
  percent_complete: number | null;
  responsible_user_id: string | null;
};

/** Aberta para Operações: nem concluída nem cancelada, sem término real (a mesma leitura de `overview-rules`). */
export const isOpenActivity = (a: ActivityLike) => a.status !== 'completed' && a.status !== 'cancelled' && !a.actual_finish;
/** O conjunto que a Visão Geral de Operações lê (o filtro do servidor dela: sem concluídas nem canceladas). */
const opsSet = (all: readonly SiteActivity[]) => all.filter((a) => a.status !== 'completed' && a.status !== 'cancelled');
/** Folhas abertas — a base da saúde (`openByProject` da Visão Geral). */
const openLeaves = (all: readonly SiteActivity[]) => opsSet(all).filter((a) => !a.is_summary && !a.actual_finish);
const isBlocked = (a: ActivityLike) => a.delay_status === 'blocked' || a.status === 'blocked';

/** Números do cronograma do projeto. `null` = o projeto não tem cronograma (nenhuma atividade ativa). */
export function scheduleSummary(all: readonly SiteActivity[], today: string, partial: boolean) {
  if (!all.length) return null;
  const open = openLeaves(all);
  return {
    open: open.length,
    overdue: open.filter((a) => isOverdueActivity(a, today)).length,
    critical: open.filter((a) => isCriticalActivity(a, today)).length,
    inProgress: opsSet(all).filter((a) => isInProgressActivity(a)).length,
    blocked: open.filter(isBlocked).length,
    partial,
  };
}

/** Próximo marco DO CRONOGRAMA (a regra da Visão Geral: marco aberto com término planejado de hoje em diante). */
export function nextScheduleMilestone(all: readonly SiteActivity[], today: string): { id: string; date: string; title: string | null } | null {
  let best: { id: string; date: string; title: string | null } | null = null;
  for (const a of opsSet(all)) {
    const date = isoDay(a.planned_finish);
    if (!a.is_milestone || !date || date < today) continue;
    if (!best || date < best.date) best = { id: a.id, date, title: a.title ?? null };
  }
  return best;
}

/** Peso de uma atividade para escolher a fase: duração registrada; sem ela, o intervalo planejado em dias. */
function activityWeight(a: SiteActivity): number {
  if (a.duration_minutes && a.duration_minutes > 0) return a.duration_minutes;
  const s = isoDay(a.planned_start); const f = isoDay(a.planned_finish);
  if (s && f && f >= s) return (Date.parse(`${f}T12:00:00Z`) - Date.parse(`${s}T12:00:00Z`)) / 86_400_000 + 1;
  return 1;
}

/** Descendentes de cada linha (pelo `parent_id`, com guarda de ciclo). */
function descendantsOf(all: readonly SiteActivity[]): Map<string, SiteActivity[]> {
  const byId = new Map(all.map((a) => [a.id, a]));
  const out = new Map<string, SiteActivity[]>();
  for (const a of all) {
    const seen = new Set<string>([a.id]);
    let p = a.parent_id ? byId.get(a.parent_id) : undefined;
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.set(p.id, [...(out.get(p.id) ?? []), a]);
      p = p.parent_id ? byId.get(p.parent_id) : undefined;
    }
  }
  return out;
}

/**
 * FASE ATUAL — a etapa-resumo EM ANDAMENTO de maior peso (ela mesma em
 * andamento, ou com uma folha em andamento dentro); sem resumo, a folha em
 * andamento de maior peso. Peso = duração registrada, senão o intervalo
 * planejado. `percent` = o percentual registrado da linha; num resumo sem
 * percentual, o avanço físico das folhas dele (`physicalProgress`). Nada em
 * andamento → `null` (nunca uma fase inventada).
 */
export function currentPhase(all: readonly SiteActivity[]): { id: string; title: string; percent: number | null } | null {
  const desc = descendantsOf(all);
  const running = (a: SiteActivity) => isOpenActivity(a) && (a.status === 'in_progress' || Boolean(a.actual_start));
  const summaries = all.filter((a) => a.is_summary && isOpenActivity(a)
    && (running(a) || (desc.get(a.id) ?? []).some((d) => !d.is_summary && running(d))));
  const pool = summaries.length ? summaries : all.filter((a) => !a.is_summary && running(a));
  if (!pool.length) return null;
  const weight = (a: SiteActivity) => (a.is_summary
    ? (desc.get(a.id) ?? []).filter((d) => !d.is_summary).reduce((s, d) => s + activityWeight(d), 0) || activityWeight(a)
    : activityWeight(a));
  const pick = [...pool].sort((x, y) => weight(y) - weight(x)
    || (isoDay(x.planned_start) ?? '9999').localeCompare(isoDay(y.planned_start) ?? '9999')
    || (x.row_order ?? Number.MAX_SAFE_INTEGER) - (y.row_order ?? Number.MAX_SAFE_INTEGER) || x.id.localeCompare(y.id))[0];
  let percent: number | null = pick.percent_complete === null ? null : Math.max(0, Math.min(100, pick.percent_complete));
  if (percent === null && pick.is_summary) {
    const leaves = (desc.get(pick.id) ?? []).filter((d) => !d.is_summary);
    percent = hasProgressBase(leaves) ? physicalProgress(leaves).percent : null;
  }
  return { id: pick.id, title: pick.title || 'Atividade do cronograma', percent };
}

/** Há BASE para o avanço físico: alguma folha não cancelada com percentual registrado ou concluída. */
function hasProgressBase(items: readonly SiteActivity[]): boolean {
  return items.some((a) => !a.is_summary && a.status !== 'cancelled' && (a.status === 'completed' || a.percent_complete !== null));
}

/** Avanço físico do projeto (`physicalProgress`, a regra do Projeto 360) — só com base; senão `null`. */
export function projectProgress(all: readonly SiteActivity[]): { percent: number } | null {
  if (!hasProgressBase(all)) return null;
  const p = physicalProgress([...all]);
  return p.percent === null ? null : { percent: p.percent };
}

/** Escopo cadastrado do projeto (`descricao` do cadastro canônico, depois do V2) — nunca texto inventado. */
export function projectScope(json: Json, v2: Json | null): string | null {
  return text(json.descricao) ?? text(json.escopo) ?? text(v2?.descricao) ?? text(v2?.description) ?? null;
}

/* ── Saúde (a MESMA derivação da Visão Geral de Operações) ─────────────── */

export interface SiteMeasurement { id: string; status: MeasurementStatus; expected_at: string | null; occurrence_key: string; customer_due_at: string | null }
export interface SiteRisk { id: string; title: string; severity: string; status: string; responsible_id: string | null; due_date: string | null }
export interface SiteDependency { id: string; title: string; required_by: string | null }
export interface SiteServiceOrder {
  id: string; os_number: string; title: string; status: ServiceOrderStatus; project_id: string | null;
  planned_start: string | null; ownerName: string | null; counts: ServiceOrderCounts;
}

export interface HealthFacts {
  activities: readonly SiteActivity[];
  measurements: readonly SiteMeasurement[];
  risks: readonly SiteRisk[];
  /** Requisitos com falta ao vivo (`shortage > 0`): data de necessidade declarada. */
  shortages: ReadonlyArray<{ requiredBy: string | null }>;
  dependencies: readonly SiteDependency[];
  serviceOrders: readonly SiteServiceOrder[];
}

/**
 * Saúde do projeto — `deriveProjectHealth` com EXATAMENTE os fatos que a
 * Visão Geral de Operações conta para este projeto (o marcador do globo):
 * folhas abertas, OS em emissão com bloqueio, medição em correção/vencida,
 * riscos abertos, falta de material (≤ 14 dias = perto da necessidade),
 * dependência do cliente vencida. O que a pessoa não lê entra vazio — como lá.
 */
export function siteHealth(f: HealthFacts, today: string): { level: HealthLevel; reasons: string[] } {
  const open = openLeaves(f.activities);
  const soon = addDays(today, 14);
  const nearShort = f.shortages.filter((s) => s.requiredBy && s.requiredBy <= soon).length;
  const h = deriveProjectHealth({
    openActivities: open.length,
    criticalActivities: open.filter((a) => isCriticalActivity(a, today)).length,
    overdueActivities: open.filter((a) => isOverdueActivity(a, today)).length,
    blockedActivities: open.filter(isBlocked).length,
    serviceOrdersBlocked: f.serviceOrders.filter((o) => o.counts.blockingOpen > 0
      && (o.status === 'DRAFT' || o.status === 'PENDING_CONFIRMATION')).length,
    measurementsInCorrection: f.measurements.filter((m) => measurementLane(m.status) === 'CORRECTION').length,
    measurementsOverdue: f.measurements.filter((m) => m.status === 'PLANNED' && m.expected_at !== null && m.expected_at < today).length,
    criticalRisks: f.risks.filter((r) => r.severity === 'critical').length,
    highRisks: f.risks.filter((r) => r.severity === 'high').length,
    risksWithoutOwner: f.risks.filter(isMaterialOpenRisk).filter((r) => !r.responsible_id).length,
    materialShortNearNeed: nearShort,
    materialShort: f.shortages.length - nearShort,
    customerDependenciesOverdue: f.dependencies.filter((d) => d.required_by && d.required_by < today).length,
  }, open.length > 0);
  return { level: h.level, reasons: h.reasons.map((r) => r.text) };
}

/* ── Itens da fila de Operações (os textos da Visão Geral, recortados) ──── */

const enc = encodeURIComponent;
const opsTone = (t: string): AttentionItem['tone'] => (t === 'danger' ? 'danger' : t === 'warning' ? 'warning' : 'accent');

/**
 * OS, medição, risco e dependência → `AttentionItem` com os MESMOS textos de
 * `operationsOverview` (depois `opsRow` os torna linhas do Dashboard).
 * Diferença única: a OS não traz o cliente do trabalho autorizado (lido lá pelo
 * service role em `listServiceOrders`) — o objeto é "número · título".
 */
export function siteAttentionItems(input: {
  projectId: string; projectName: string; today: string;
  serviceOrders: readonly SiteServiceOrder[] | null;
  measurements: readonly SiteMeasurement[] | null;
  risks: readonly SiteRisk[] | null;
  dependencies: readonly SiteDependency[] | null;
}): AttentionItem[] {
  const { projectId, projectName, today } = input;
  const out: AttentionItem[] = [];
  for (const o of input.serviceOrders ?? []) {
    const next = serviceOrderNextAction(o.status, o.project_id, o.counts);
    if (!next.needsDecision) continue;
    out.push({
      id: `os:${o.id}`, kind: 'service_order', object: o.os_number, issue: next.label, impact: o.title,
      due: o.planned_start, owner: o.ownerName, tone: opsTone(next.tone),
      href: `/operacoes/ordens-servico/${o.id}`, actionLabel: 'Abrir OS', projectId: o.project_id, refId: o.id,
    });
  }
  for (const m of (input.measurements ?? []).filter((x) => x.status === 'RETURNED_FOR_CORRECTION' || x.status === 'CUSTOMER_CORRECTION_REQUESTED')) {
    out.push({
      id: `meas:${m.id}`, kind: 'measurement', object: `Medição ${m.occurrence_key}`,
      issue: m.status === 'CUSTOMER_CORRECTION_REQUESTED' ? 'Cliente pediu correção' : 'Devolvida para correção',
      impact: projectName, due: m.customer_due_at ?? m.expected_at, owner: null, tone: 'warning',
      href: `/projetos/${enc(projectId)}?tab=measurements`, actionLabel: 'Corrigir medição', projectId, refId: m.id,
    });
  }
  for (const r of (input.risks ?? []).filter((x) => isMaterialOpenRisk(x) && !x.responsible_id)) {
    out.push({
      id: `risk:${r.id}`, kind: 'risk', object: r.title, issue: 'Risco material sem responsável',
      impact: projectName, due: r.due_date?.slice(0, 10) ?? null, owner: null, tone: r.severity === 'critical' ? 'danger' : 'warning',
      href: `/projetos/${enc(projectId)}?tab=risks`, actionLabel: 'Atribuir dono', projectId, refId: r.id,
    });
  }
  for (const d of (input.dependencies ?? []).filter((x) => x.required_by && x.required_by < today)) {
    out.push({
      id: `dep:${d.id}`, kind: 'dependency', object: d.title, issue: 'Dependência do cliente vencida',
      impact: projectName, due: d.required_by, owner: null, tone: 'danger',
      href: `/projetos/${enc(projectId)}?tab=timeline`, actionLabel: 'Cobrar cliente', projectId, refId: d.id,
    });
  }
  return out;
}

/* ── Medições e riscos ─────────────────────────────────────────────────── */

export function measurementSummary(rows: readonly SiteMeasurement[], today: string) {
  const next = rows.filter((m) => m.status === 'PLANNED' || m.status === 'IN_PREPARATION' || m.status === 'READY_FOR_SUBMISSION')
    .sort((a, b) => (a.expected_at ?? '9999').localeCompare(b.expected_at ?? '9999') || a.id.localeCompare(b.id))[0] ?? null;
  return {
    pending: rows.filter((m) => isOperationalMeasurementPending(m.status, m.expected_at, today)).length,
    inCorrection: rows.filter((m) => measurementLane(m.status) === 'CORRECTION').length,
    awaitingCustomer: rows.filter((m) => measurementLane(m.status) === 'AWAITING_CUSTOMER').length,
    next: next ? {
      id: next.id, key: next.occurrence_key, expected: isoDay(next.expected_at), status: next.status,
      statusLabel: MEASUREMENT_STATUS_LABEL[next.status] ?? 'Medição',
    } : null,
  };
}

/** Riscos abertos do projeto — só contagens (nunca `financial_exposure`). */
export function riskSummary(rows: readonly SiteRisk[]) {
  return {
    open: rows.length,
    critical: rows.filter((r) => r.severity === 'critical').length,
    high: rows.filter((r) => r.severity === 'high').length,
    withoutOwner: rows.filter(isMaterialOpenRisk).filter((r) => !r.responsible_id).length,
  };
}

/* ── Localização (oficial → canteiro do Supply; nunca estimada) ─────────── */

const EVIDENCE_KINDS = new Set(['contract_scope', 'contract_clause', 'manual']);
const PENDING_STATES = new Set(['UNRESOLVED', 'REQUIRES_ATTENTION', 'CONFLICT']);

/** Latitude/longitude finitas e dentro da faixa — senão não há ponto (nunca NaN no globo). */
export function validLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined || lat === '' || lng === '') return null;
  const a = Number(lat); const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

const UFS: ReadonlySet<string> = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const ufOf = (v: unknown) => { const t = text(v)?.toUpperCase() ?? null; return t && UFS.has(t) ? t : null; };

/** "Canteiro CANT-TUCURUI" — o código do local; sem código, o nome (sem repetir "Canteiro"). O MESMO rótulo do marcador. */
export function siteLabelOf(code: unknown, name: unknown): string {
  const c = text(code);
  if (c) return `Canteiro ${c}`;
  const n = text(name);
  if (!n) return 'Canteiro';
  return /^canteiro\b/i.test(n) ? n : `Canteiro ${n}`;
}

/**
 * A posição do local — a MESMA regra do marcador do portfólio (`sites.ts`):
 * a OFICIAL (`project_globe_marker`, com proveniência; precisão desconhecida =
 * a mais conservadora, município); sem ela, o canteiro do Supply
 * (`inventory_locations` PROJECT_SITE ativo com lat/lng) quando é UM só — mais
 * de um é ambíguo e não vira ponto. Cidade/UF do canteiro vêm do cadastro do
 * projeto (o local não as tem).
 */
export function sitePosition(canonical: Row | null, sites: readonly Row[], project: Json, projectV2: Json | null = null): SitePosition | null {
  if (canonical && EVIDENCE_KINDS.has(String(canonical.evidence_kind))) {
    const at = validLatLng(canonical.latitude, canonical.longitude);
    if (at) {
      return {
        ...at,
        precision: canonical.precision === 'site' ? 'site' : 'municipality',
        label: text(canonical.site_label), municipality: text(canonical.municipality), uf: ufOf(canonical.state_code),
        source: 'canonical',
        evidence: {
          kind: canonical.evidence_kind as 'contract_scope' | 'contract_clause' | 'manual',
          contractId: str(canonical.source_contract_id), documentId: str(canonical.source_document_id),
          page: num(canonical.source_page), at: str(canonical.geocoded_at),
        },
      };
    }
  }
  const located = sites.map((s) => ({ s, at: validLatLng(s.latitude, s.longitude) })).filter((x) => x.at);
  if (located.length !== 1) return null;
  const { s, at } = located[0];
  const v2 = projectV2 ?? {};
  const loc = (v2.location && typeof v2.location === 'object' ? v2.location : {}) as Json;
  return {
    ...(at as { lat: number; lng: number }),
    precision: 'site',
    label: siteLabelOf(s.code, s.name),
    municipality: text(project.cidade) ?? text(project.city) ?? text(loc.city),
    uf: ufOf(project.uf) ?? ufOf(v2.uf) ?? ufOf(loc.uf),
    source: 'project_site',
    evidence: { kind: 'supply_site', contractId: null, documentId: null, page: null, at: str(s.updated_at) },
  };
}

/* ── Contrato e faturamento ────────────────────────────────────────────── */

export interface SiteContractLinks {
  links: Array<{ contractId: string; label: string }>;
  /** Contratos vinculados SÓ a este projeto — só os eventos deles entram na fila do local. */
  singleProject: Set<string>;
}

export interface SiteBillingRead {
  events: BillingEventLike[];
  /** Títulos dos eventos (só com `receivablesGate`): vencimento e situação para a raia Recebíveis. */
  receivables: Array<{ billingEventId: string; contractId: string | null; dueDate: string | null; status: string | null; linked: boolean }>;
  truncated: boolean;
}

/** Resumo do faturamento dos contratos vinculados (valor só com o RPC financeiro e lista inteira). */
export function billingSummary(read: SiteBillingRead, financial: boolean) {
  const live = read.events.filter((e) => !e.cancelledAt && !e.supersededById);
  return {
    events: live.length,
    awaitingRelease: read.events.filter((e) => billingClass(e) === 'release').length,
    invoicesToIssue: read.events.filter((e) => billingClass(e) === 'invoice').length,
    total: read.truncated ? null : maskedMoney(sumByCurrency(live.map((e) => ({ amount: e.eligibleAmount, currency: e.currency }))), financial),
  };
}

/* ── Decisões do local ─────────────────────────────────────────────────── */

/**
 * As linhas da caixa que são DESTE local: a decisão que carrega o projeto
 * (pedido de compra) ou a liberação de faturamento de um evento de contrato
 * vinculado (o evento não tem projeto).
 */
export function siteInboxRows(
  rows: readonly DecisionInboxRow[], projectId: string, linkedContracts: ReadonlySet<string>, eventContract: ReadonlyMap<string, string | null>,
): DecisionInboxRow[] {
  return rows.filter((r) => r.project_id === projectId
    || (r.subject_type === 'contract_billing_event' && linkedContracts.has(eventContract.get(r.subject_id) ?? '')));
}

/* ── A próxima ação ────────────────────────────────────────────────────── */

/** A próxima ação da linha mais grave — só com a fila inteira (ok, sem falha, sem corte) e não vazia. */
export function siteNextAction(attention: SectionState<FeedModel>): NextAction | null {
  if (attention.state !== 'ok') return null;
  const d = attention.data;
  if (d.failed.length > 0 || d.partial || !d.rows.length) return null;
  return d.rows[0].nextAction;
}

/* ══════════════════════════════════════════════════════════════════════════
   LEITURAS ESTREITAS (cliente autenticado, organização + projeto)
   ══════════════════════════════════════════════════════════════════════════ */

const ACTIVITY_COLUMNS = 'id,parent_id,wbs_code,row_order,type,title,status,priority,delay_status,is_milestone,is_summary,'
  + 'planned_start,planned_finish,actual_start,actual_finish,duration_minutes,percent_complete,responsible_user_id';
/** Teto do cronograma de UM projeto (páginas de 1000). */
export const SITE_ACTIVITIES_CAP = 5000;
const READ_LIMIT = 1000;

export function toSiteActivity(r: Row): SiteActivity {
  return {
    id: String(r.id), parent_id: str(r.parent_id), wbs_code: str(r.wbs_code), row_order: num(r.row_order),
    type: String(r.type ?? 'task'), title: String(r.title ?? ''), status: String(r.status ?? ''), priority: String(r.priority ?? ''),
    delay_status: String(r.delay_status ?? ''), is_milestone: r.is_milestone === true || r.type === 'milestone', is_summary: r.is_summary === true,
    planned_start: isoDay(r.planned_start), planned_finish: isoDay(r.planned_finish), actual_start: isoDay(r.actual_start),
    actual_finish: isoDay(r.actual_finish), duration_minutes: num(r.duration_minutes), percent_complete: num(r.percent_complete),
    responsible_user_id: str(r.responsible_user_id),
  };
}

/** O cronograma ATIVO do projeto (todas as linhas, inclusive concluídas — o avanço precisa delas). */
export async function readSiteActivities(sb: SupabaseClient, org: string, projectId: string) {
  const { rows, truncated } = await readPaged<Row>('o cronograma do projeto', (from, to) => sb.from('project_timeline_items')
    .select(ACTIVITY_COLUMNS).eq('organization_id', org).eq('project_id', projectId).eq('is_active', true).is('deleted_at', null)
    .order('row_order', { ascending: true, nullsFirst: false }).order('id').range(from, to), SITE_ACTIVITIES_CAP);
  return { activities: rows.map(toSiteActivity), truncated };
}

async function readMeasurements(sb: SupabaseClient, org: string, projectId: string) {
  const res = await sb.from('project_measurements').select('id,status,expected_at,occurrence_key,customer_due_at')
    .eq('organization_id', org).eq('project_id', projectId).not('status', 'in', '(CANCELLED,SUPERSEDED,REJECTED)')
    .order('expected_at', { ascending: true, nullsFirst: false }).limit(READ_LIMIT);
  if (res.error) throw new Error('medições do projeto');
  const rows = ((res.data ?? []) as Row[]).map((m) => ({
    id: String(m.id), status: String(m.status) as MeasurementStatus, expected_at: isoDay(m.expected_at),
    occurrence_key: String(m.occurrence_key ?? ''), customer_due_at: isoDay(m.customer_due_at),
  }));
  return { rows, truncated: rows.length >= READ_LIMIT };
}

async function readRisks(sb: SupabaseClient, org: string, projectId: string) {
  // Colunas EXPLÍCITAS: `financial_exposure` nunca é lida aqui.
  const res = await sb.from('risks').select('id,title,severity,status,responsible_id,due_date')
    .eq('organization_id', org).eq('reference_id', projectId).in('status', ['open', 'mitigating']).limit(READ_LIMIT);
  if (res.error) throw new Error('riscos do projeto');
  const rows: SiteRisk[] = ((res.data ?? []) as Row[]).map((r) => ({
    id: String(r.id), title: String(r.title ?? 'Risco'), severity: String(r.severity ?? ''), status: String(r.status ?? ''),
    responsible_id: str(r.responsible_id), due_date: str(r.due_date),
  }));
  return { rows, truncated: rows.length >= READ_LIMIT };
}

/**
 * Faltas AO VIVO do projeto (a `readCoverage` do Dashboard, recortada no
 * projeto): os requisitos confirmados de material/serviço → a cobertura de
 * cada um (`readProjectCoverage`, a mesma visão) → só os com falta, com o
 * título do requisito e a atividade (início planejado = necessidade efetiva).
 */
async function readSiteCoverage(sb: SupabaseClient, org: string, projectId: string, projectName: string) {
  const reqs = await readPaged<{ id: string; title: string | null }>('os requisitos de material do projeto', (from, to) => sb
    .from('project_requirements').select('id,title').eq('organization_id', org).eq('project_id', projectId).eq('status', 'CONFIRMED')
    .in('requirement_type', [...SUPPLY_COVERED_REQUIREMENT_TYPES]).order('id').range(from, to), 5_000);
  const cov = await readProjectCoverage<CoverageViewRow>(sb, org, projectId, reqs.rows.map((r) => r.id), reqs.truncated);
  const short = cov.rows.map((r) => ({ r, coverage: fromViewRow(r) })).filter((x) => x.coverage.shortage > 0)
    .sort((a, b) => (a.r.required_by ?? '9999').localeCompare(b.r.required_by ?? '9999') || a.r.requirement_id.localeCompare(b.r.requirement_id));
  const acts = await selectIn<{ id: string; title: string | null; planned_start: string | null }>(short.map((x) => x.r.activity_id),
    (c) => sb.from('project_timeline_items').select('id,title,planned_start').eq('organization_id', org).in('id', c));
  const actMap = new Map(acts.map((a) => [a.id, a]));
  const title = new Map(reqs.rows.map((r) => [r.id, r.title]));
  const needs: MaterialNeed[] = short.map(({ r, coverage }) => {
    const act = r.activity_id ? actMap.get(r.activity_id) : undefined;
    return {
      requirementId: r.requirement_id, projectId: r.project_id, project: projectName,
      title: title.get(r.requirement_id) ?? null, unit: r.unit, requiredBy: r.required_by,
      activity: act ? { id: act.id, title: act.title, plannedStart: act.planned_start } : null, coverage,
    };
  });
  return { needs, truncated: reqs.truncated || cov.truncated };
}

async function readDependencies(sb: SupabaseClient, org: string, projectId: string): Promise<SiteDependency[]> {
  const res = await sb.from('project_requirements').select('id,title,required_by')
    .eq('organization_id', org).eq('project_id', projectId).eq('requirement_type', 'CUSTOMER_DEPENDENCY').eq('status', 'CONFIRMED')
    .is('satisfied_at', null).limit(READ_LIMIT);
  if (res.error) throw new Error('dependências do cliente');
  return ((res.data ?? []) as Row[]).map((d) => ({ id: String(d.id), title: String(d.title ?? 'Dependência do cliente'), required_by: isoDay(d.required_by) }));
}

const OS_LIMIT = 300;

/** As OS do projeto (RLS de OS) + as contagens de bloqueio pela MESMA regra do portão de emissão (`countsFor`). */
async function readSiteServiceOrders(sb: SupabaseClient, org: string, projectId: string) {
  const res = await sb.from('internal_service_orders').select('id,engagement_id,os_number,title,status,project_id,planned_start,responsible_user_id')
    .eq('organization_id', org).eq('project_id', projectId).order('created_at', { ascending: false }).limit(OS_LIMIT);
  if (res.error) throw new Error('OS do projeto');
  const orders = (res.data ?? []) as Array<{ id: string; engagement_id: string; os_number: string; title: string; status: ServiceOrderStatus;
    project_id: string | null; planned_start: string | null; responsible_user_id: string | null }>;
  const [counts, owners] = await Promise.all([
    countsFor(org, orders),
    resolveOwnerNames(org, orders.map((o) => o.responsible_user_id)),
  ]);
  const zero: ServiceOrderCounts = { items: 0, unreviewedItems: 0, openDivergences: 0, blockingOpen: 0 };
  const rows: SiteServiceOrder[] = orders.map((o) => ({
    id: o.id, os_number: o.os_number, title: o.title, status: o.status, project_id: o.project_id,
    planned_start: isoDay(o.planned_start), ownerName: o.responsible_user_id ? owners[o.responsible_user_id] ?? null : null,
    counts: counts.get(o.id) ?? zero,
  }));
  return { rows, truncated: orders.length >= OS_LIMIT };
}

/** Pessoas alocadas (ativas, distintas) — leitura da sessão sob a RLS de `project_allocations`. */
async function readTeam(sb: SupabaseClient, org: string, projectId: string) {
  const { rows } = await readPaged<{ person_id: string }>('a equipe alocada', (from, to) => sb.from('project_allocations').select('person_id')
    .eq('organization_id', org).eq('project_id', projectId).eq('status', 'active').order('id').range(from, to), 20_000);
  return { allocated: new Set(rows.map((r) => r.person_id)).size };
}

async function readLocation(sb: SupabaseClient, org: string, projectId: string, project: Json, projectV2: Json | null) {
  const [canonical, sites, pending] = await Promise.all([
    sb.from('project_globe_marker').select('project_id,latitude,longitude,precision,site_label,municipality,state_code,evidence_kind,'
      + 'source_contract_id,source_document_id,source_page,geocoded_at').eq('organization_id', org).eq('project_id', projectId).limit(1),
    sb.from('inventory_locations').select('id,code,name,latitude,longitude,updated_at').eq('organization_id', org)
      .eq('project_id', projectId).eq('kind', 'PROJECT_SITE').eq('active', true)
      .not('latitude', 'is', null).not('longitude', 'is', null).limit(20),
    sb.from('project_location_attention').select('resolution_state,attention_reason').eq('organization_id', org)
      .eq('project_id', projectId).limit(1),
  ]);
  if (canonical.error || sites.error || pending.error) throw new Error('localização do projeto');
  const position = sitePosition(((canonical.data ?? []) as unknown as Row[])[0] ?? null, (sites.data ?? []) as Row[], project, projectV2);
  const p = ((pending.data ?? []) as Row[])[0];
  const state = p ? String(p.resolution_state) : null;
  return {
    position,
    pending: !position && state && PENDING_STATES.has(state)
      ? { state: state as 'UNRESOLVED' | 'REQUIRES_ATTENTION' | 'CONFLICT', reason: text(p?.attention_reason) } : null,
  };
}

/** Contratos vinculados ao projeto (`project_contract_link_governed`), com rótulo e quais são só deste projeto. */
async function readContractLinks(sb: SupabaseClient, org: string, projectId: string): Promise<SiteContractLinks> {
  const res = await sb.from('project_contract_link_governed').select('contract_id').eq('organization_id', org)
    .eq('project_id', projectId).limit(200);
  if (res.error) throw new Error('vínculo do projeto com contrato');
  const ids = Array.from(new Set(((res.data ?? []) as Row[]).map((r) => str(r.contract_id)).filter((x): x is string => !!x)));
  if (!ids.length) return { links: [], singleProject: new Set() };
  const [labels, siblings] = await Promise.all([
    selectIn<{ id: string; contract_number: string | null; title: string | null }>(ids,
      (c) => sb.from('contracts').select('id,contract_number,title').eq('organization_id', org).in('id', c)),
    selectIn<{ contract_id: string; project_id: string }>(ids,
      (c) => sb.from('project_contract_link_governed').select('contract_id,project_id').eq('organization_id', org).in('contract_id', c)),
  ]);
  const label = new Map(labels.map((r) => [r.id, [r.contract_number, r.title].filter(Boolean).join(' · ') || 'Contrato']));
  const projectsOf = new Map<string, Set<string>>();
  for (const s of siblings) projectsOf.set(s.contract_id, (projectsOf.get(s.contract_id) ?? new Set()).add(s.project_id));
  return {
    links: ids.map((id) => ({ contractId: id, label: label.get(id) ?? 'Contrato' })),
    singleProject: new Set(ids.filter((id) => { const p = projectsOf.get(id); return !!p && p.size === 1 && p.has(projectId); })),
  };
}

const BILLING_VIEW = 'contract_to_cash_read_model';

/** Eventos dos contratos vinculados (colunas EXPLÍCITAS; valor só com o RPC financeiro; título só com `receivablesGate`). */
async function readSiteBilling(sb: SupabaseClient, org: string, contractIds: string[], financial: boolean, receivables: boolean): Promise<SiteBillingRead> {
  if (!contractIds.length) return { events: [], receivables: [], truncated: false };
  const columns = 'billing_event_id,contract_id,title,currency,release_state,eligibility_state,fiscal_document_id,superseded_by_id,legacy_row,cancelled_at'
    + (financial ? ',eligible_amount' : '') + (receivables ? ',due_date,receivable_status,finance_link_state' : '');
  const rows = await selectIn<Row>(contractIds, (c) => sb.from(BILLING_VIEW).select(columns).eq('organization_id', org)
    .in('contract_id', c).is('cancelled_at', null).order('billing_event_id').limit(READ_LIMIT) as unknown as PromiseLike<{
      data: Row[] | null; error: { message: string } | null }>);
  const events: BillingEventLike[] = rows.map((r) => ({
    billingEventId: String(r.billing_event_id), contractId: str(r.contract_id), title: str(r.title),
    eligibleAmount: financial ? num(r.eligible_amount) : null, currency: str(r.currency),
    releaseState: str(r.release_state), eligibilityState: str(r.eligibility_state), fiscalDocumentId: str(r.fiscal_document_id),
    supersededById: str(r.superseded_by_id), legacyRow: r.legacy_row === null || r.legacy_row === undefined ? null : r.legacy_row === true,
    cancelledAt: str(r.cancelled_at),
  }));
  return {
    events,
    receivables: receivables ? rows.map((r) => ({
      billingEventId: String(r.billing_event_id), contractId: str(r.contract_id), dueDate: isoDay(r.due_date),
      status: str(r.receivable_status), linked: r.finance_link_state === 'LINKED',
    })) : [],
    truncated: rows.length >= READ_LIMIT,
  };
}

/** Entregas previstas (ETA, próximos 30 dias) dos pedidos VIVOS deste projeto. */
async function readSiteInbound(sb: SupabaseClient, org: string, projectId: string, projectName: string, today: string) {
  const pos = await sb.from('purchase_orders').select('id,order_number').eq('organization_id', org).eq('project_id', projectId)
    .in('status', ['ISSUED', 'PARTIALLY_RECEIVED']).limit(200);
  if (pos.error) throw new Error('pedidos do projeto');
  const poRows = (pos.data ?? []) as Array<{ id: string; order_number: string | null }>;
  const poMap = new Map(poRows.map((p) => [p.id, p]));
  const ships = await selectIn<Row>(poRows.map((p) => p.id), (c) => sb.from('inbound_shipments').select('id,purchase_order_id,eta,status')
    .eq('organization_id', org).in('status', ['EXPECTED', 'IN_TRANSIT']).gte('eta', today).lte('eta', addDays(today, CALENDAR_DAYS))
    .in('purchase_order_id', c).order('eta').limit(200));
  const items: CalendarItem[] = [];
  for (const s of ships) {
    const po = poMap.get(String(s.purchase_order_id));
    const date = isoDay(s.eta);
    if (!po || !date) continue;
    items.push({
      id: `ship:${String(s.id)}`, date, title: `Entrega do pedido ${po.order_number ?? ''}`.trim(), lane: 'supply', kind: 'delivery',
      tone: 'neutral', href: `/supply/compras?stage=pedidos&po=${enc(po.id)}`, project: projectName,
    });
  }
  return { items, truncated: poRows.length >= 200 || ships.length >= 200 };
}

/**
 * Decisões DESTE local: a caixa canônica (mesma leitura, mesmo enriquecimento,
 * mesma ordem de Decisões), recortada. A liberação de faturamento só é do local
 * quando o evento é de um contrato vinculado: o evento → contrato sai do
 * faturamento já lido, e o que faltar, de uma leitura estreita da mesma view
 * (RLS da pessoa). Vínculo que FALHOU com liberação na caixa → `error` (não
 * se sabe se é daqui — nunca "0 decisões").
 */
async function composeSiteDecisions(
  site: SiteContext, inbox: DecisionInboxRow[], links: SectionState<SiteContractLinks>, billing: SectionState<SiteBillingRead>,
): Promise<{ count: number; overdue: number; top: DecisionPreview[] }> {
  const { session, project, today } = site;
  const sb = session.supabase; const org = session.organizationId;
  const billingSubjects = inbox.filter((r) => r.subject_type === 'contract_billing_event').map((r) => r.subject_id);
  if (billingSubjects.length && links.state === 'error') throw new Error('vínculo com contrato indisponível para as liberações de faturamento');
  const linked = new Set(links.state === 'ok' ? links.data.links.map((l) => l.contractId) : []);
  const eventContract = new Map<string, string | null>();
  if (billing.state === 'ok') for (const e of billing.data.events) eventContract.set(e.billingEventId, e.contractId);
  const missing = billingSubjects.filter((id) => !eventContract.has(id));
  if (linked.size && missing.length) {
    const rows = await selectIn<{ billing_event_id: string; contract_id: string | null }>(missing,
      (c) => sb.from(BILLING_VIEW).select('billing_event_id,contract_id').eq('organization_id', org).in('billing_event_id', c));
    for (const r of rows) eventContract.set(r.billing_event_id, r.contract_id);
  }
  const mine = siteInboxRows(inbox, project.id, linked, eventContract);
  const items = await enrichInbox(session, mine, today);
  const ranked = prioritize(items.filter((i) => i.assignment !== 'ELIGIBLE'));
  return {
    count: ranked.length,
    overdue: ranked.filter((i) => i.overdue).length,
    top: ranked.slice(0, 3).map((i) => ({
      ...decisionPreview(i, {
        href: decisionHref(i.key),
        amountText: i.amount === null ? null : amountText(i.amount, i.currency),
        amountRestricted: false,
        due: effectiveDeadline(i),
      }),
      projectId: i.projectId ?? project.id,
    })),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   COMPOSIÇÃO
   ══════════════════════════════════════════════════════════════════════════ */

const LABEL = {
  activities: 'o cronograma do projeto',
  measurements: 'as medições do projeto',
  risks: 'os riscos do projeto',
  coverage: 'a cobertura de material do projeto',
  dependencies: 'as dependências do cliente',
  serviceOrders: 'as OS do projeto',
  signals: 'os achados da Apex do projeto',
  contracts: 'o vínculo com contratos',
  billing: 'o faturamento dos contratos vinculados',
  inbox: 'a sua caixa de decisões',
  decisions: 'as decisões deste local',
  team: 'a equipe alocada',
  location: 'a localização do projeto',
  inbound: 'as entregas previstas',
} as const;

/** Monta a Visão geral do local. `timings` recebe a duração de cada seção (cabeçalho `Server-Timing`). */
export async function buildSiteHud(site: SiteContext, timings?: Timings): Promise<SiteHud> {
  const { session, gates: g, today, project } = site;
  const sb = session.supabase;
  const org = session.organizationId;
  const pid = project.id;
  const name = project.identity.name;
  const t = timings;

  const activitiesP = runSiteSection(g.projects, LABEL.activities, () => readSiteActivities(sb, org, pid), t, 'activities');
  const measurementsP = runSiteSection(g.measurements, LABEL.measurements, () => readMeasurements(sb, org, pid), t, 'measurements');
  const risksP = runSiteSection(g.risks, LABEL.risks, () => readRisks(sb, org, pid), t, 'risks');
  const coverageP = runSiteSection(g.projects, LABEL.coverage, () => readSiteCoverage(sb, org, pid, name), t, 'coverage');
  const dependenciesP = runSiteSection(g.projects, LABEL.dependencies, () => readDependencies(sb, org, pid), t, 'dependencies');
  const serviceOrdersP = runSiteSection(g.operations, LABEL.serviceOrders, () => readSiteServiceOrders(sb, org, pid), t, 'serviceOrders');
  // Os abertos do projeto (todas as gravidades): `openCount` exato; a fila usa só críticos/altos, como o Dashboard.
  const signalsP = runSiteSection(g.signals, LABEL.signals, () => listSupplySignals(session, { projectId: pid, openOnly: true, limit: READ_LIMIT }), t, 'signals');
  const linksP = runSiteSection(g.contracts, LABEL.contracts, () => readContractLinks(sb, org, pid), t, 'contracts');
  // Faturamento: o portão efetivo (`billingGate`) E o vínculo legível — sem o vínculo não há escopo.
  const billingP: Promise<SectionState<SiteBillingRead>> = linksP.then((links) => {
    if (!g.billing) return { state: 'restricted' } as const;
    if (links.state === 'error') return { state: 'error', message: `Não foi possível ler ${LABEL.billing}.` };
    if (links.state === 'restricted') return { state: 'restricted' };
    return runSiteSection(true, LABEL.billing, () => readSiteBilling(sb, org, links.data.links.map((l) => l.contractId), g.financial, g.receivables), t, 'billing');
  });
  const inboxP = runSiteSection(true, LABEL.inbox, () => viewerInbox(session), t, 'inbox', INBOX_SECTION_TIMEOUT_MS);
  const decisionsP = Promise.all([inboxP, linksP, billingP]).then(([inbox, links, billing]) => (inbox.state !== 'ok'
    ? { state: 'error' as const, message: `Não foi possível ler ${LABEL.decisions}.` }
    : runSiteSection(true, LABEL.decisions, () => composeSiteDecisions(site, inbox.data, links, billing), t, 'decisions')));
  // Equipe: a RLS de `project_allocations` (people.allocations_view OU projects.view) — só pergunta a outra chave se precisar.
  const teamP = (g.projects ? Promise.resolve(true) : hasOptionalPermission(session, 'people.allocations_view'))
    .then((gate) => runSiteSection(gate, LABEL.team, () => readTeam(sb, org, pid), t, 'team'));
  const locationP = runSiteSection(g.projects, LABEL.location, () => readLocation(sb, org, pid, project.json, project.v2), t, 'location');
  const inboundP = runSiteSection(g.supplyFlow, LABEL.inbound, () => readSiteInbound(sb, org, pid, name, today), t, 'inbound');

  const [activities, measurements, risks, coverage, dependencies, serviceOrders, signals, links, billing, inbox, decisions, team, location, inbound]
    = await Promise.all([activitiesP, measurementsP, risksP, coverageP, dependenciesP, serviceOrdersP, signalsP, linksP, billingP, inboxP,
      decisionsP, teamP, locationP, inboundP]);

  const actData = dataOf(activities);
  const covData = dataOf(coverage);
  const sigData = dataOf(signals);
  const billData = dataOf(billing);
  const linkData = dataOf(links);
  const inboxRows = dataOf(inbox);
  const measData = dataOf(measurements);
  const riskData = dataOf(risks);
  const depData = dataOf(dependencies);
  const osData = dataOf(serviceOrders);

  /* ── O que está acontecendo aqui ── */
  // A saúde depende de TODOS os fatos que a pessoa lê: um que falhou não pode deixar o projeto calmo.
  const healthInputs: Array<[boolean, SectionState<unknown>, string]> = [
    [g.projects, activities, 'cronograma'], [g.projects, coverage, 'cobertura de material'], [g.projects, dependencies, 'dependências do cliente'],
    [g.measurements, measurements, 'medições'], [g.risks, risks, 'riscos'], [g.operations, serviceOrders, 'OS'],
  ];
  const healthFailed = healthInputs.filter(([gate, s]) => gate && s.state === 'error').map(([, , what]) => what);
  const now: SiteHud['now'] = (() => {
    if (!actData || healthFailed.length) {
      return { state: 'error', message: `Não foi possível ler o que está acontecendo neste projeto (${healthFailed.join(', ') || 'cronograma'}).` };
    }
    const all = actData.activities;
    const active = isActiveProjectStatus(project.identity.status);
    return {
      state: 'ok',
      data: {
        health: active ? siteHealth({
          activities: all, measurements: measData?.rows ?? [], risks: riskData?.rows ?? [],
          shortages: (covData?.needs ?? []).map((n) => ({ requiredBy: n.requiredBy })), dependencies: depData ?? [],
          serviceOrders: osData?.rows ?? [],
        }, today) : null,
        phase: currentPhase(all),
        schedule: scheduleSummary(all, today, actData.truncated),
        nextMilestone: nextScheduleMilestone(all, today),
        progress: actData.truncated ? null : projectProgress(all),
        team,
        serviceOrders: mapSection(serviceOrders, (d) => d.rows.filter((o) => o.status !== 'CANCELLED').map((o) => ({
          id: o.id, number: o.os_number, status: o.status, statusLabel: serviceOrderStatusLabels[o.status] ?? 'OS',
          href: `/operacoes/ordens-servico/${o.id}`,
        }))),
      },
      ...(actData.truncated || covData?.truncated ? { truncated: true } : {}),
    };
  })();

  /* ── Atenção neste local (as linhas do Dashboard, recortadas) ── */
  const liveRows: FeedRow[] = [];
  for (const item of siteAttentionItems({
    projectId: pid, projectName: name, today, serviceOrders: osData?.rows ?? null, measurements: measData?.rows ?? null,
    risks: riskData?.rows ?? null, dependencies: depData,
  })) {
    const r = opsRow(item);
    if (r) liveRows.push(r);
  }
  if (actData) {
    const overdue = opsSet(actData.activities).filter((a) => isOverdueActivity(a, today));
    if (overdue.length) {
      // Nome do responsável é exibição (a leitura composta de sempre): se falhar, a linha segue sem nome.
      const names = await runSiteSection(true, 'os responsáveis', () => resolveOwnerNames(org, overdue.map((a) => a.responsible_user_id)), t, 'owners');
      const owners = names.state === 'ok' ? names.data : {};
      for (const grp of groupOverdueByProject(overdue.map((a) => ({ ...a, project_id: pid })),
        () => ({ name, client: project.identity.client }), owners)) liveRows.push(overdueGroupRow(grp));
    }
  }
  if (covData) for (const m of covData.needs) { const r = materialRow(m, today); if (r) liveRows.push(r); }
  if (billData && linkData) {
    // O evento não tem projeto: só entra na fila do local quando o contrato é SÓ deste projeto.
    const own = billData.events.filter((e) => e.contractId && linkData.singleProject.has(e.contractId));
    const labelOf = new Map(linkData.links.map((l) => [l.contractId, l.label]));
    liveRows.push(...billingRows(own, {
      contractLabel: (id) => (id ? labelOf.get(id) ?? null : null),
      financial: g.financial,
      inboxBillingIds: inboxRows ? new Set(inboxRows.filter((r) => r.subject_type === 'contract_billing_event').map((r) => r.subject_id)) : null,
    }));
  }
  const shortageById = new Map((covData?.needs ?? []).map((m) => [m.requirementId, m.coverage.shortage]));
  const merged = mergeFeed({
    rows: liveRows,
    signals: ((sigData?.signals ?? []).filter((s) => s.severity === 'critical' || s.severity === 'high')) as SignalLike[],
    inboxPurchaseOrderIds: inboxRows ? new Set(inboxRows.filter((r) => r.subject_type === 'purchase_order').map((r) => r.subject_id)) : null,
    liveShortage: (id) => (!covData ? null : shortageById.has(id) ? shortageById.get(id) as number : covData.truncated ? null : 0),
  }).map((r) => (r.location.kind === 'project' && r.location.id === pid && !r.location.label
    ? { ...r, location: { ...r.location, label: name } } : r));
  const ranked = rankFeed(merged);

  const billingFeedGate = g.billing && g.contracts;
  const feedSources: Array<{ gate: boolean; state: SectionState<unknown>; feeds: FeedModel['failed'] }> = [
    { gate: g.projects, state: activities, feeds: [{ domain: 'operacao', label: DOMAIN_LABEL.operacao }] },
    { gate: g.projects, state: dependencies, feeds: [{ domain: 'operacao', label: DOMAIN_LABEL.operacao }] },
    { gate: g.operations, state: serviceOrders, feeds: [{ domain: 'operacao', label: DOMAIN_LABEL.operacao }] },
    { gate: g.risks, state: risks, feeds: [{ domain: 'operacao', label: DOMAIN_LABEL.operacao }] },
    { gate: g.measurements, state: measurements, feeds: [{ domain: 'medicao', label: DOMAIN_LABEL.medicao }] },
    { gate: g.projects, state: coverage, feeds: [{ domain: 'supply', label: 'Cobertura de material' }] },
    { gate: g.signals, state: signals, feeds: [{ domain: 'supply', label: 'Achados da Apex' }] },
    { gate: billingFeedGate, state: billing, feeds: [{ domain: 'faturamento', label: DOMAIN_LABEL.faturamento }] },
  ];
  const readSources = feedSources.filter((s) => s.gate);
  let attention: SectionState<FeedModel>;
  if (!readSources.length) attention = { state: 'restricted' };
  else if (readSources.every((s) => s.state.state === 'error')) attention = { state: 'error', message: 'Não foi possível montar a fila deste local.' };
  else {
    const seen = new Set<string>();
    const failed = readSources.filter((s) => s.state.state === 'error').flatMap((s) => s.feeds)
      .filter((f) => { const k = `${f.domain}:${f.label}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const partial = Boolean(actData?.truncated) || Boolean(measData?.truncated) || Boolean(riskData?.truncated)
      || Boolean(covData?.truncated) || Boolean(billData?.truncated)
      || Boolean(osData?.truncated) || (sigData ? (sigData.openCount ?? 0) > sigData.signals.length : false);
    attention = { state: 'ok', data: buildFeedModel(ranked, [], { failed, partial }), truncated: failed.length > 0 || partial };
  }

  /* ── Medições, riscos, supply, contrato, faturamento, decisões ── */
  const measurementsSection: SiteHud['measurements'] = mapSection(measurements, (m) => measurementSummary(m.rows, today));
  const risksSection: SiteHud['risks'] = mapSection(risks, (r) => riskSummary(r.rows));
  const supply: SiteHud['supply'] = mapSection(coverage, (c) => ({
    shortages: {
      total: c.needs.length,
      critical: c.needs.filter((m) => materialRisk(m, today) === 'critical').length,
      partial: c.truncated,
    },
    apexOpen: sigData ? sigData.openCount ?? sigData.signals.length : null,
  }));
  const contract: SiteHud['contract'] = mapSection(links, (l) => ({ links: l.links }));
  const billingSection: SiteHud['billing'] = mapSection(billing, (b) => billingSummary(b, g.financial));

  /* ── Calendário do local (30 dias) ── */
  const lanePart = <T>(s: SectionState<T>, items: (x: T) => CalendarItem[], cut: (x: T) => boolean): CalendarLaneState =>
    (s.state === 'ok' ? { state: 'ok', data: items(s.data), ...(cut(s.data) ? { partial: true } : {}) } : s);
  const operacaoLane: CalendarLaneState = lanePart(activities, (a) => {
    const horizon: Record<Horizon, Array<{ id: string; title: string; project: string; projectId: string; date: string | null;
      milestone: boolean; critical: boolean }>> = { 7: [], 14: [], 30: [] };
    for (const x of opsSet(a.activities)) {
      const h = horizonOf(x, today);
      if (!h) continue;
      horizon[h].push({
        id: x.id, title: x.title, project: name, projectId: pid,
        date: (!x.actual_start && x.planned_start && x.planned_start >= today) ? x.planned_start : x.planned_finish,
        milestone: x.is_milestone, critical: isCriticalActivity(x, today),
      });
    }
    return operationCalendarItems(horizon);
  }, (a) => a.truncated);
  const supplyLane = mergeLaneParts([
    ...(g.projects ? [lanePart(coverage, (c) => needCalendarItems(c.needs, today), (c) => c.truncated)] : []),
    ...(g.supplyFlow ? [lanePart(inbound, (i) => i.items, (i) => i.truncated)] : []),
  ], 'Supply');
  const medicaoLane: CalendarLaneState = lanePart(measurements, (m) => m.rows.flatMap((x) => {
    const date = isoDay(x.customer_due_at);
    if (!date || !['APPROVED_FOR_CUSTOMER', 'AWAITING_CUSTOMER_ACCEPTANCE', 'CUSTOMER_CORRECTION_REQUESTED'].includes(x.status)) return [];
    return [{
      id: `meas:${x.id}`, date, title: `Medição ${x.occurrence_key} — prazo do cliente`.replace('  ', ' '),
      lane: 'medicao' as const, kind: 'due' as const, tone: 'warning' as const,
      href: `/projetos/${enc(pid)}?tab=measurements`, project: name,
    }];
  }), (m) => m.truncated);
  const recebivelLane: CalendarLaneState = !g.receivables ? { state: 'restricted' } : lanePart(billing, (b) => b.receivables.flatMap((x) => {
    if (!x.linked || !x.dueDate || !['OPEN', 'PARTIAL', 'OVERDUE'].includes(x.status ?? '')) return [];
    const label = x.contractId ? linkData?.links.find((l) => l.contractId === x.contractId)?.label ?? null : null;
    return [{
      id: `rcv:${x.billingEventId}`, date: x.dueDate, title: label ? `Vencimento · ${label}` : 'Vencimento de título',
      lane: 'recebivel' as const, kind: 'due' as const, tone: x.status === 'OVERDUE' ? 'danger' as const : 'accent' as const,
      href: '/contratos?view=faturamento', project: name,
    }];
  }), (b) => b.truncated);
  const calendar = buildCalendar(today, {
    operacao: g.projects ? operacaoLane : { state: 'restricted' },
    supply: supplyLane,
    medicao: g.measurements ? medicaoLane : { state: 'restricted' },
    recebivel: recebivelLane,
  });

  /* ── O que a pessoa lê ── */
  const readableFlags: Record<Domain, boolean> = {
    comercial: g.commercial || g.contracts,
    operacao: g.projects || g.operations || g.risks,
    supply: g.supplyFlow || g.signals,
    medicao: g.measurements,
    faturamento: g.billing,
    recebivel: g.receivables,
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    today,
    project: {
      id: pid, name, code: project.identity.code, client: project.identity.client, status: project.identity.status,
      scope: projectScope(project.json, project.v2), href: `/projetos/${enc(pid)}?tab=overview`,
    },
    location,
    now,
    attention,
    nextAction: siteNextAction(attention),
    measurements: measurementsSection,
    risks: risksSection,
    supply,
    contract,
    billing: billingSection,
    decisions,
    calendar,
    notReadable: DOMAIN_ORDER.filter((d) => !readableFlags[d]).map((d) => DOMAIN_LABEL[d]),
  };
}
