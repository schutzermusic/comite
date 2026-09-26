/**
 * Regras PURAS do Dashboard V2 — "O que está acontecendo".
 *
 * Tudo que decide O QUE a tela diz sai daqui, com definição escrita e testado
 * sem banco (tests/unit/dashboard-v2-rules.test.ts):
 *  • o mapa ÚNICO de gravidade (tom de Operações, sinal da Apex, recebível, comercial);
 *  • o texto da falta de material a partir da cobertura AO VIVO (nunca do sinal gravado);
 *  • a deduplicação pelo objeto canônico (`req:`, `po:`, `os:`, `proj-act:`…) com a
 *    Apex anexada como evidência;
 *  • o agrupamento (atividades vencidas → uma linha por projeto; faturamento →
 *    uma linha por contrato × classe);
 *  • a ordem (gravidade → prazo → domínio) com diversidade de domínio no topo;
 *  • as 11 etapas do fluxo, o dinheiro mascarado e o calendário de 30 dias.
 *
 * Nada aqui consulta, grava ou lê relógio: `today` entra sempre por parâmetro.
 * Só `import type` de módulos do app; as únicas importações em tempo de
 * execução são funções puras do Supply (`supplyRisk`, `needDate`, rótulos).
 */
import type {
  ApexNote, CalendarItem, CalendarLane, CalendarModel, DecisionPreview, Domain, FeedModel, FeedRow, FlowStage,
  HealthLevel, NextAction, ProjectHealthRow, SectionState, Severity, StageId,
} from './types';
import type { AttentionItem } from '@/lib/operations/overview';
import type { AttentionCounts, AttentionKind, OverdueByProjectRow } from '@/lib/operations/overview-aggregates';
import type { DecisionItem } from '@/lib/decisions/types';
import { supplyRisk, type CoverageSummary, type SupplyRisk } from '@/lib/supply/coverage';
import { SIGNAL_KIND_LABEL, needDate, type SignalKind } from '@/lib/supply/intelligence';

/* ── Datas (dia civil, UTC ao meio-dia: sem fuso, sem NaN) ─────────────── */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-10-12…" → "2026-10-12"; qualquer coisa que não seja um dia de calendário válido → `null`. */
export function isoDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const d = value.slice(0, 10);
  if (!ISO_DAY.test(d)) return null;
  const t = Date.parse(`${d}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === d ? d : null;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dias de `from` até `to` (positivo se `to` é depois). */
export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

/** "2026-10-12" → "12/10". */
export function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const formatQty = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

const COUNTED_PLURAL = /(\d[\d.]*(?:,\d+)?)(\s+)(\p{L}+)\(s\)/gu;

/**
 * "7 dia(s)" → "7 dias"; "1 dia(s)" → "1 dia"; "1 transferência(s)" → "1 transferência".
 * As frases dos motores de Compras e da Apex — e os achados JÁ gravados no
 * banco — trazem o "(s)" do plural; no Dashboard a frase sai em português.
 * Só muda a palavra logo depois de um número; o resto do texto fica igual.
 */
export function plainPlurals(text: string): string {
  return text.replace(COUNTED_PLURAL, (_m, n: string, sp: string, word: string) => {
    const v = Number(n.replace(/\./g, '').replace(',', '.'));
    return `${n}${sp}${word}${Number.isFinite(v) && Math.abs(v) === 1 ? '' : 's'}`;
  });
}

/* ── Gravidade ÚNICA ────────────────────────────────────────────────────── */

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };

/** A ordem do fluxo do negócio — desempate da fila e ordem dos domínios. */
export const DOMAIN_ORDER: readonly Domain[] = ['comercial', 'operacao', 'supply', 'medicao', 'faturamento', 'recebivel'];

/** Operações: `danger` → crítico · `warning` → alto · `accent` → médio. */
export function severityFromOpsTone(tone: 'danger' | 'warning' | 'accent'): Severity {
  return tone === 'danger' ? 'critical' : tone === 'warning' ? 'high' : 'medium';
}

/** Sinal da Apex: `critical`/`high`/`medium` passam; `low` (e o desconhecido) fica no piso, médio. */
export function severityFromSignal(severity: string): Severity {
  return severity === 'critical' ? 'critical' : severity === 'high' ? 'high' : 'medium';
}

/** Recebível vencido → crítico; em aberto no prazo não é exceção de alta gravidade. */
export function severityFromReceivable(overdue: boolean): Severity {
  return overdue ? 'critical' : 'medium';
}

/** Comercial: `blocking` → crítico · `attention` → alto · o resto → médio. */
export function severityFromCommercial(severity: 'blocking' | 'attention' | 'info' | string): Severity {
  return severity === 'blocking' ? 'critical' : severity === 'attention' ? 'high' : 'medium';
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] <= SEVERITY_RANK[b] ? a : b;
}

/* ── Dinheiro (mascarado, por moeda, unidades nunca misturadas) ─────────── */

/**
 * Soma POR MOEDA. Quem chama converte antes: `eligible_amount` já está em
 * unidades; campos `*_cents` entram divididos por 100 — nunca os dois somados
 * crus. Valor não numérico não entra (nunca vira 0 escondido numa soma).
 */
export function sumByCurrency(items: Iterable<{ amount: number | string | null | undefined; currency: string | null | undefined }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    if (it.amount === null || it.amount === undefined || it.amount === '') continue;
    const n = Number(it.amount);
    if (!Number.isFinite(n)) continue;
    const c = (it.currency || 'BRL').toUpperCase();
    out[c] = (out[c] ?? 0) + n;
  }
  return out;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 1.234,56", "R$ 1.234,56 + outras moedas", "em outras moedas"; `null` sem valor. */
export function moneyText(sums: Record<string, number>): string | null {
  const others = Object.keys(sums).filter((c) => c !== 'BRL');
  const hasBrl = sums.BRL !== undefined;
  if (!hasBrl && !others.length) return null;
  if (!hasBrl) return 'em outras moedas';
  return others.length ? `${BRL.format(sums.BRL)} + outras moedas` : BRL.format(sums.BRL);
}

/** Dinheiro só atravessa com `current_user_can_view_project_financials()`; sem ele, `null` (a tela diz "Restrito"). */
export function maskedMoney(sums: Record<string, number>, financial: boolean): string | null {
  return financial ? moneyText(sums) : null;
}

/* ── Portões de faturamento e recebíveis (espelho da RLS EFETIVA) ───────── */

/**
 * As respostas do MESMO resolvedor da RLS (`current_user_has_permission`, com
 * as sobreposições por usuário) para as chaves que decidem a leitura de
 * `contract_to_cash_read_model`. Usado pelo Dashboard e pelo Entender.
 */
export interface BillingGatePerms {
  contractsViewValues: boolean;
  financeView: boolean;
  contractsView: boolean;
  /** `contract_billing_events_manage_permissioned` é FOR ALL: `contracts.edit` também lê. */
  contractsEdit: boolean;
}

export interface ReceivablesGatePerms extends BillingGatePerms {
  /** `has_finance_role_or_perm('finance_admin', 'finance.admin')`. */
  financeAdmin: boolean;
  /** `has_finance_role_or_perm('finance_analyst', 'finance.edit')`. */
  financeAnalyst: boolean;
}

/**
 * A pessoa lê TODOS os eventos de faturamento da organização? A view
 * `contract_to_cash_read_model` é `security_invoker` sobre
 * `contract_billing_events`, cuja leitura (RLS, conferida no banco) é:
 *   contracts.edit
 *   OU (contracts.view_values OU finance.view) E (
 *        contrato preenchido E current_user_can_read_contract(contrato)
 *        OU sem contrato, com engajamento, E contracts.view )
 * `current_user_can_read_contract` = admin OU contracts.view OU contracts.approve
 * OU (projects.view_assigned E responsável pelo projeto do contrato).
 * Só `contracts.view` cobre os DOIS ramos: admin sem ela, `contracts.approve` e o
 * responsável pelo projeto leem só PARTE das linhas — uma contagem sobre parte
 * seria número falso, então esses perfis ficam Restrito.
 */
export function billingGate(p: BillingGatePerms): boolean {
  return p.contractsEdit || ((p.contractsViewValues || p.financeView) && p.contractsView);
}

/**
 * Recebíveis saem da MESMA view (a linha só existe com `billingGate`) e a
 * situação do título (pago, em aberto, vencido) vem de
 * `finance_receivable_balances` sobre `finance_settlements` — `fs_select`:
 * finance.view OU finance_admin OU finance_analyst. Sem isso o pago some e o
 * título parece vencido.
 */
export function receivablesGate(p: ReceivablesGatePerms): boolean {
  return billingGate(p) && (p.financeView || p.financeAdmin || p.financeAnalyst);
}

/* ── Material: a falta lida AO VIVO ─────────────────────────────────────── */

export interface MaterialNeed {
  requirementId: string;
  projectId: string;
  project: string | null;
  /** Título do requisito canônico (só exibição). */
  title: string | null;
  unit: string | null;
  requiredBy: string | null;
  activity: { id: string; title: string | null; plannedStart: string | null } | null;
  /** `pendingTransfer` (246): transferência pedida, sem despacho — não é cobertura; ausente = 0. */
  coverage: Pick<CoverageSummary, 'shortage' | 'status' | 'requested' | 'inbound'> & Partial<Pick<CoverageSummary, 'pendingTransfer'>>;
}

/** Janela da fila: necessidade em até 14 dias (ou já vencida). */
export const MATERIAL_WINDOW_DAYS = 14;

export const MATERIAL_RULE = 'Requisito confirmado com falta, necessidade em até 14 dias ou já vencida';

/** A necessidade efetiva: a mais cedo entre `required_by` e o início planejado da atividade (a regra da Apex). */
export function materialNeedDate(m: Pick<MaterialNeed, 'requiredBy' | 'activity'>): string | null {
  return needDate({ requiredBy: isoDay(m.requiredBy), activityStart: isoDay(m.activity?.plannedStart ?? null) });
}

/** O risco de supply do requisito — `supplyRisk` sobre a necessidade efetiva (a mesma régua em toda a tela). */
export function materialRisk(m: Pick<MaterialNeed, 'requiredBy' | 'activity' | 'coverage'>, today: string): SupplyRisk {
  const need = materialNeedDate(m);
  return supplyRisk(m.coverage, need ? daysFrom(today, need) : null);
}

/**
 * "Falta 12 m — requisitado, sem pedido emitido". Com transferência PEDIDA e
 * ainda não despachada (246), a falta continua (a linha segue pela falta), mas
 * o que falta fazer é despachar: "transferência pedida, sem despacho (N m pendentes)".
 */
export function materialProblem(m: Pick<MaterialNeed, 'coverage' | 'unit'>): string {
  const u = m.unit ? ` ${m.unit}` : '';
  const missing = `Falta ${formatQty(m.coverage.shortage)}${u}`;
  const pending = Math.max(0, Number(m.coverage.pendingTransfer ?? 0) || 0);
  if (pending > 0) {
    return `${missing} — transferência pedida, sem despacho (${formatQty(pending)}${u} pendentes)`
      + (m.coverage.requested > 0 ? '; requisitado, sem pedido emitido' : '');
  }
  if (m.coverage.requested > 0) return `${missing} — requisitado, sem pedido emitido`;
  if (m.coverage.inbound > 0) return `${missing} — a entrada não cobre a necessidade`;
  return `${missing} — sem estoque nem pedido`;
}

/** O primeiro elo a jusante: "Atividade Montagem do estator começa em 12/10". */
export function materialConsequence(m: Pick<MaterialNeed, 'activity'>): string | null {
  const start = isoDay(m.activity?.plannedStart ?? null);
  if (!m.activity || !start) return null;
  return `Atividade ${m.activity.title ?? 'do cronograma'} começa em ${ddmm(start)}`;
}

/** A linha de material da fila — `null` sem falta ou fora da janela de 14 dias. */
export function materialRow(m: MaterialNeed, today: string): FeedRow | null {
  if (m.coverage.shortage <= 0) return null;
  const need = materialNeedDate(m);
  if (!need || daysFrom(today, need) > MATERIAL_WINDOW_DAYS) return null;
  const risk = materialRisk(m, today);
  return {
    key: `req:${m.requirementId}`,
    domain: 'supply',
    severity: risk === 'critical' ? 'critical' : risk === 'high' ? 'high' : 'medium',
    kindLabel: 'Material',
    location: { kind: 'project', id: m.projectId, label: m.project },
    object: m.title ?? 'Material do requisito',
    problem: materialProblem(m),
    consequence: materialConsequence(m),
    due: need,
    owner: null,
    ownerApplicable: false,
    count: 1,
    nextAction: { label: 'Cobrir falta', href: `/supply/planejamento-materiais?req=${encodeURIComponent(m.requirementId)}`, focused: true },
    explainRef: `mat:${m.requirementId}`,
    apex: null,
    rule: MATERIAL_RULE,
  };
}

/* ── Linhas de Operações (OS, medição, risco, dependência) ──────────────── */

/** O Dashboard não usa o verbo "Decidir" — Decisões é dona dele. */
export function osNextActionLabel(issue: string): string {
  return /^decidir\b/i.test(issue.trim()) ? 'Resolver bloqueios na OS' : issue;
}

/** O PROBLEMA da OS, dito como estado (a próxima ação vai no botão). */
export function osProblem(issue: string): string {
  const t = issue.trim();
  let m = /^Decidir (\d+) divergências? bloqueantes?/i.exec(t);
  if (m) return `${plural(Number(m[1]), 'divergência bloqueante', 'divergências bloqueantes')} em aberto`;
  m = /^Revisar (\d+) linhas? lidas?/i.exec(t);
  if (m) return `${plural(Number(m[1]), 'linha lida', 'linhas lidas')} sem revisão`;
  m = /^Conferir (\d+) avisos?/i.exec(t);
  if (m) return `${plural(Number(m[1]), 'aviso', 'avisos')} a conferir antes de emitir`;
  if (/^Emitir OS$/i.test(t)) return 'Pronta para emitir';
  if (/^Criar ou vincular projeto$/i.test(t)) return 'Emitida sem projeto';
  return t;
}

const OPS_RULE: Partial<Record<AttentionKind, string>> = {
  service_order: 'OS aberta cuja próxima ação é da operação (revisar, resolver bloqueio, emitir ou vincular projeto)',
  measurement: 'Medição devolvida para correção (pela análise interna ou pelo cliente)',
  risk: 'Risco aberto de severidade alta ou crítica sem responsável',
  dependency: 'Dependência do cliente confirmada, não atendida e com data vencida',
};

/**
 * Itens da fila de Operações → linhas do Dashboard. Atividade e material NÃO
 * entram daqui: atividade vem agrupada por projeto (`overdueGroupRow`) e
 * material vem da cobertura ao vivo (`materialRow`).
 */
export function opsRow(item: AttentionItem): FeedRow | null {
  const severity = severityFromOpsTone(item.tone);
  const project = item.projectId ? { kind: 'project' as const, id: item.projectId } : null;
  switch (item.kind) {
    case 'service_order':
      return {
        key: `os:${item.refId}`, domain: 'operacao', severity, kindLabel: 'OS',
        location: project ? { ...project, label: null } : { kind: 'organization', id: null, label: item.impact },
        object: item.impact ? `${item.object} · ${item.impact}` : item.object,
        problem: osProblem(item.issue), consequence: null, due: isoDay(item.due),
        owner: item.owner, ownerApplicable: true, count: 1,
        nextAction: { label: osNextActionLabel(item.issue), href: item.href, focused: true },
        explainRef: `os:${item.refId}`, apex: null, rule: OPS_RULE.service_order as string,
      };
    case 'measurement':
      return {
        key: `meas:${item.refId}`, domain: 'medicao', severity, kindLabel: 'Medição',
        location: project ? { ...project, label: item.impact } : { kind: 'organization', id: null, label: null },
        object: item.object, problem: item.issue, consequence: null, due: isoDay(item.due),
        owner: null, ownerApplicable: false, count: 1,
        nextAction: { label: item.actionLabel, href: item.href, focused: false },
        explainRef: `meas:${item.refId}`, apex: null, rule: OPS_RULE.measurement as string,
      };
    case 'risk':
      return {
        key: `risk:${item.refId}`, domain: 'operacao', severity, kindLabel: 'Risco',
        location: project ? { ...project, label: item.impact } : { kind: 'organization', id: null, label: null },
        object: item.object, problem: item.issue, consequence: null, due: isoDay(item.due),
        owner: null, ownerApplicable: true, count: 1,
        nextAction: { label: item.actionLabel, href: item.href, focused: false },
        explainRef: `risk:${item.refId}`, apex: null, rule: OPS_RULE.risk as string,
      };
    case 'dependency':
      return {
        key: `dep:${item.refId}`, domain: 'operacao', severity, kindLabel: 'Cliente',
        location: project ? { ...project, label: item.impact } : { kind: 'organization', id: null, label: null },
        object: item.object, problem: item.issue, consequence: null, due: isoDay(item.due),
        owner: null, ownerApplicable: false, count: 1,
        nextAction: { label: item.actionLabel, href: item.href, focused: false },
        explainRef: `dep:${item.refId}`, apex: null, rule: OPS_RULE.dependency as string,
      };
    default:
      return null;
  }
}

/** "4 atividades vencidas (1 bloqueada)". */
export function overdueProblem(count: number, blocked: number): string {
  const base = plural(count, 'atividade vencida', 'atividades vencidas');
  return blocked > 0 ? `${base} (${plural(blocked, 'bloqueada', 'bloqueadas')})` : base;
}

/**
 * O responsável de uma linha agrupada: um nome → o nome; vários → "Ana e mais 1"
 * (nunca "sem responsável", que seria falso); nenhum → `null` ("sem responsável").
 */
export function groupOwner(names: readonly string[]): string | null {
  if (!names.length) return null;
  return names.length === 1 ? names[0] : `${names[0]} e mais ${names.length - 1}`;
}

/** Atividades vencidas → UMA linha por projeto, apontando para o cronograma. */
export function overdueGroupRow(g: OverdueByProjectRow): FeedRow {
  return {
    key: `proj-act:${g.projectId}`,
    domain: 'operacao',
    severity: g.blocked > 0 || g.critical > 0 ? 'critical' : 'high',
    kindLabel: 'Cronograma',
    location: { kind: 'project', id: g.projectId, label: g.project },
    object: g.project,
    problem: overdueProblem(g.count, g.blocked),
    consequence: null,
    due: isoDay(g.oldestDue),
    owner: groupOwner(g.ownerNames),
    ownerApplicable: true,
    count: g.count,
    nextAction: { label: 'Abrir cronograma', href: `/projetos/${encodeURIComponent(g.projectId)}?tab=timeline`, focused: true },
    explainRef: `proj-act:${g.projectId}`,
    apex: null,
    rule: 'Atividade-folha aberta com término planejado vencido (agrupadas por projeto)',
  };
}

/* ── Faturamento e recebíveis (por contrato × classe) ───────────────────── */

export type BillingClass = 'release' | 'invoice' | 'approval';

export interface BillingEventLike {
  billingEventId: string;
  contractId: string | null;
  title: string | null;
  /** Em UNIDADES da moeda (`eligible_amount`). */
  eligibleAmount: number | null;
  currency: string | null;
  releaseState: string | null;
  eligibilityState: string | null;
  fiscalDocumentId: string | null;
  supersededById: string | null;
  legacyRow: boolean | null;
  cancelledAt: string | null;
}

/**
 * A classe do evento — definições EXATAS (143):
 *  release  = elegível e ainda não liberado (sem cancelamento, substituição ou linha legada);
 *  invoice  = liberado sem nota fiscal (o predicado de `listInvoicesToIssue`);
 *  approval = liberação em aprovação (`PENDING_RELEASE`).
 */
export function billingClass(e: BillingEventLike): BillingClass | null {
  if (e.cancelledAt) return null;
  if (e.eligibilityState === 'ELIGIBLE' && e.releaseState === 'ELIGIBLE' && !e.supersededById && e.legacyRow !== true) return 'release';
  if (e.releaseState === 'RELEASED' && !e.fiscalDocumentId) return 'invoice';
  if (e.releaseState === 'PENDING_RELEASE' && !e.supersededById) return 'approval';
  return null;
}

const BILLING_RULE: Record<BillingClass, string> = {
  release: 'Evento de faturamento elegível ainda não liberado (sem cancelamento, substituição ou linha legada)',
  invoice: 'Evento de faturamento liberado sem nota fiscal emitida',
  approval: 'Liberação de faturamento em aprovação, fora da sua caixa de Decisões',
};
const BILLING_SEVERITY: Record<BillingClass, Severity> = { release: 'high', invoice: 'high', approval: 'medium' };

function billingProblem(cls: BillingClass, n: number): string {
  if (cls === 'release') return `${plural(n, 'evento elegível', 'eventos elegíveis')} aguardando liberação`;
  if (cls === 'invoice') return `${plural(n, 'evento liberado', 'eventos liberados')} sem NF emitida`;
  return `${plural(n, 'liberação parada', 'liberações paradas')} em aprovação`;
}

const withMoney = (text: string, money: string | null) => (money ? `${text} · ${money}` : text);

/**
 * Faturamento → uma linha por contrato × classe. `PENDING_RELEASE` que JÁ
 * está na caixa da pessoa (`contract_billing_event`) sai: Decisões mostra.
 * `inboxBillingIds === null` = caixa ilegível → nada sai (não se esconde às cegas).
 */
export function billingRows(
  events: readonly BillingEventLike[],
  opts: { contractLabel: (id: string | null) => string | null; financial: boolean; inboxBillingIds: ReadonlySet<string> | null },
): FeedRow[] {
  const groups = new Map<string, { cls: BillingClass; contractId: string | null; events: BillingEventLike[] }>();
  for (const e of events) {
    const cls = billingClass(e);
    if (!cls) continue;
    if (cls === 'approval' && opts.inboxBillingIds?.has(e.billingEventId)) continue;
    const k = `${e.contractId ?? 'sem-contrato'}:${cls}`;
    const g = groups.get(k) ?? { cls, contractId: e.contractId, events: [] };
    g.events.push(e);
    groups.set(k, g);
  }
  return Array.from(groups.entries()).map(([k, g]) => {
    const first = g.events[0];
    const label = opts.contractLabel(g.contractId);
    const money = maskedMoney(sumByCurrency(g.events.map((e) => ({ amount: e.eligibleAmount, currency: e.currency }))), opts.financial);
    return {
      key: `bill:${k}`,
      domain: 'faturamento' as const,
      severity: BILLING_SEVERITY[g.cls],
      kindLabel: 'Faturamento',
      location: { kind: 'contract' as const, id: g.contractId, label },
      object: g.events.length === 1 ? first.title ?? 'Evento de faturamento' : `${g.events.length} eventos de faturamento`,
      problem: withMoney(billingProblem(g.cls, g.events.length), money),
      consequence: null,
      due: null,
      owner: null,
      ownerApplicable: false,
      count: g.events.length,
      nextAction: { label: g.cls === 'approval' ? 'Acompanhar aprovação' : 'Abrir faturamento', href: '/contratos?view=faturamento', focused: false },
      explainRef: `bill:${first.billingEventId}`,
      apex: null,
      rule: BILLING_RULE[g.cls],
    };
  });
}

export interface ReceivableLike {
  billingEventId: string;
  contractId: string | null;
  dueDate: string | null;
  /** Em CENTAVOS (`open_amount_cents`). */
  openAmountCents: number | null;
  currency: string | null;
  status: string | null;
}

/** Recebíveis VENCIDOS → uma linha por contrato (crítica). O que está no prazo não é exceção. */
export function receivableRows(
  rows: readonly ReceivableLike[],
  opts: { contractLabel: (id: string | null) => string | null; financial: boolean },
): FeedRow[] {
  const groups = new Map<string, ReceivableLike[]>();
  for (const r of rows) {
    if (r.status !== 'OVERDUE') continue;
    const k = r.contractId ?? 'sem-contrato';
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return Array.from(groups.entries()).map(([k, list]) => {
    const dues = list.map((r) => isoDay(r.dueDate)).filter((d): d is string => !!d).sort();
    const money = maskedMoney(sumByCurrency(list.map((r) => ({
      amount: r.openAmountCents === null ? null : Number(r.openAmountCents) / 100, currency: r.currency }))), opts.financial);
    const contractId = list[0].contractId;
    return {
      key: `rcv:${k}`,
      domain: 'recebivel' as const,
      severity: severityFromReceivable(true),
      kindLabel: 'Recebível',
      location: { kind: 'contract' as const, id: contractId, label: opts.contractLabel(contractId) },
      object: list.length === 1 ? 'Título vencido' : `${list.length} títulos`,
      problem: withMoney(plural(list.length, 'título vencido', 'títulos vencidos'), money),
      consequence: null,
      due: dues[0] ?? null,
      owner: null,
      ownerApplicable: false,
      count: list.length,
      nextAction: { label: 'Abrir recebíveis', href: '/contratos?view=faturamento', focused: false },
      explainRef: `bill:${list[0].billingEventId}`,
      apex: null,
      rule: 'Título vinculado ao faturamento contratual com parcela vencida e saldo em aberto',
    };
  });
}

/* ── Sinais da Apex: evidência anexada ao objeto ────────────────────────── */

export interface SignalLike {
  id: string;
  kind: string;
  severity: string;
  projectId: string | null;
  project: string | null;
  requirementId: string | null;
  purchaseOrderId: string | null;
  title: string;
  rationale: string;
  evidence: Array<{ label: string; value: string; source?: string | null }>;
  lastSeenAt: string | null;
  engineVersion: string | null;
}

const REQ_KINDS = new Set(['SHORTAGE', 'ALTERNATE_STOCK', 'ETA_RISK']);
const PO_KINDS = new Set(['LATE_INBOUND', 'SUPPLIER_RELIABILITY', 'INSPECTION_AGING']);

/**
 * Sinais que ficam DESATUALIZADOS quando a falta ao vivo do requisito zera:
 * só os que falam da falta (SHORTAGE, ALTERNATE_STOCK). ETA_RISK nasce
 * justamente quando a entrada COBRE a quantidade mas chega depois da
 * necessidade — falta 0 por construção; DECISION_PENDING fala da compra
 * parada. A mesma regra na fila e no Entender.
 */
export const STALE_ON_COVERAGE: ReadonlySet<string> = new Set(['SHORTAGE', 'ALTERNATE_STOCK']);

/** A frase de abertura do achado da Apex, por tipo de sinal — a mesma na fila e no Entender. */
export const APEX_LEAD: Record<string, string> = {
  SHORTAGE: 'Apex identificou uma falta sem cobertura',
  ALTERNATE_STOCK: 'Apex identificou estoque disponível para cobrir a falta',
  ETA_RISK: 'Apex identificou uma entrega que chega depois da necessidade',
  LATE_INBOUND: 'Apex identificou uma entrega atrasada',
  SUPPLIER_RELIABILITY: 'Apex identificou um fornecedor pouco pontual',
  DECISION_PENDING: 'Apex identificou uma compra parada',
  INSPECTION_AGING: 'Apex identificou um recebimento esperando inspeção',
};

/** `DECISION_PENDING` de pedido (`decision:po:<id>`) — o de requisição não carrega pedido. */
export function isPurchaseOrderDecision(s: Pick<SignalLike, 'kind' | 'purchaseOrderId'>): boolean {
  return s.kind === 'DECISION_PENDING' && !!s.purchaseOrderId;
}

/** A chave do objeto do sinal: `req:` para os de requisito, `po:` para os de pedido, senão `sig:<id>`. */
export function signalKey(s: Pick<SignalLike, 'id' | 'kind' | 'requirementId' | 'purchaseOrderId'>): string {
  if (REQ_KINDS.has(s.kind) && s.requirementId) return `req:${s.requirementId}`;
  if (PO_KINDS.has(s.kind) && s.purchaseOrderId) return `po:${s.purchaseOrderId}`;
  if (s.kind === 'DECISION_PENDING') {
    if (s.purchaseOrderId) return `po:${s.purchaseOrderId}`;
    if (s.requirementId) return `req:${s.requirementId}`;
  }
  return `sig:${s.id}`;
}

export function apexNote(s: SignalLike, stale: boolean): ApexNote {
  return {
    signalId: s.id,
    kind: s.kind,
    severity: (['critical', 'high', 'medium', 'low'].includes(s.severity) ? s.severity : 'medium') as ApexNote['severity'],
    lead: APEX_LEAD[s.kind] ?? 'Apex identificou um risco de supply',
    title: plainPlurals(s.title),
    rationale: plainPlurals(s.rationale),
    evidence: (s.evidence ?? []).map((e) => ({ label: String(e.label), value: plainPlurals(String(e.value)),
      source: e.source ? plainPlurals(e.source) : null })),
    ranAt: s.lastSeenAt,
    engineVersion: s.engineVersion,
    stale,
  };
}

/** A linha própria de um sinal que não encontrou linha viva do mesmo objeto. */
export function signalRow(s: SignalLike, note: ApexNote): FeedRow {
  const key = signalKey(s);
  const poDecision = isPurchaseOrderDecision(s);
  const reqDecision = s.kind === 'DECISION_PENDING' && !poDecision;
  const kindLabel = REQ_KINDS.has(s.kind) ? 'Material' : 'Compra';
  let problem = SIGNAL_KIND_LABEL[s.kind as SignalKind] ?? 'Risco de supply';
  if (poDecision) problem = 'Aprovação de compra parada';
  else if (reqDecision) problem = /(^|\s)em cotação/i.test(s.title) ? 'Compra parada: requisição em cotação' : 'Compra parada: requisição sem cotação';
  if (note.stale) problem = 'A leitura ao vivo já não mostra falta — achado da Apex desatualizado';

  let nextAction: NextAction = { label: 'Abrir achados da Apex', href: '/supply?focus=apex', focused: false };
  let explainRef: string | null = `sig:${s.id}`;
  if (poDecision && s.purchaseOrderId) {
    nextAction = { label: 'Abrir aprovação', href: `/supply/compras?stage=aprovacao&po=${encodeURIComponent(s.purchaseOrderId)}`, focused: true };
    explainRef = `po:${s.purchaseOrderId}`;
  } else if (reqDecision) {
    nextAction = { label: 'Abrir solicitações', href: '/supply/compras?stage=solicitacoes', focused: false };
  } else if (key.startsWith('req:') && s.requirementId) {
    // ETA_RISK: a entrada cobre a quantidade (sem falta) e chega tarde — não há falta a cobrir.
    nextAction = { label: s.kind === 'ETA_RISK' ? 'Abrir cobertura' : 'Cobrir falta',
      href: `/supply/planejamento-materiais?req=${encodeURIComponent(s.requirementId)}`, focused: true };
    explainRef = `mat:${s.requirementId}`;
  } else if (key.startsWith('po:') && s.purchaseOrderId) {
    nextAction = { label: 'Abrir pedido', href: `/supply/compras?stage=pedidos&po=${encodeURIComponent(s.purchaseOrderId)}`, focused: true };
    explainRef = `po:${s.purchaseOrderId}`;
  }
  return {
    key,
    domain: 'supply',
    // O achado desatualizado não sobe a linha: fica no piso.
    severity: note.stale ? 'medium' : severityFromSignal(s.severity),
    kindLabel,
    location: s.projectId ? { kind: 'project', id: s.projectId, label: s.project } : { kind: 'organization', id: null, label: null },
    object: plainPlurals(s.title),
    problem,
    consequence: null,
    due: null,
    owner: null,
    ownerApplicable: false,
    count: 1,
    nextAction,
    explainRef,
    apex: note,
    rule: poDecision
      ? 'Pedido de compra aguardando aprovação, fora da sua caixa de Decisões (achado persistido da Apex)'
      : 'Achado aberto da Apex, gravidade crítica ou alta (persistido, com versão do motor)',
  };
}

const noteRank = (n: ApexNote) => (n.stale ? 10 : 0) + (SEVERITY_RANK[severityFromSignal(n.severity)] ?? 2);

export interface MergeInput {
  /** Linhas vivas (Operações, material, faturamento, recebíveis). Não são alteradas. */
  rows: readonly FeedRow[];
  /** Sinais ABERTOS da Apex. */
  signals: readonly SignalLike[];
  /** Pedidos na caixa da pessoa (`purchase_order`); `null` = caixa ilegível → nada sai por ela. */
  inboxPurchaseOrderIds: ReadonlySet<string> | null;
  /** Falta ao vivo do requisito: número lido, ou `null` quando a cobertura não foi lida por inteiro. */
  liveShortage: (requirementId: string) => number | null;
}

/**
 * Deduplicação pelo OBJETO: o sinal da Apex vira evidência da linha viva do
 * mesmo `req:`/`po:` (gravidade = a maior das duas); um sinal de FALTA
 * (`STALE_ON_COVERAGE`) cujo requisito já não tem falta AO VIVO é marcado
 * `stale` e não sobe nada; o
 * `DECISION_PENDING` de pedido sai só se o pedido está na caixa da pessoa.
 */
export function mergeFeed(input: MergeInput): FeedRow[] {
  const map = new Map<string, FeedRow>();
  for (const r of input.rows) if (!map.has(r.key)) map.set(r.key, { ...r });
  const signals = [...input.signals].sort((a, b) =>
    SEVERITY_RANK[severityFromSignal(a.severity)] - SEVERITY_RANK[severityFromSignal(b.severity)] || a.id.localeCompare(b.id));
  for (const s of signals) {
    if (isPurchaseOrderDecision(s) && input.inboxPurchaseOrderIds?.has(s.purchaseOrderId as string)) continue;
    const key = signalKey(s);
    const stale = STALE_ON_COVERAGE.has(s.kind) && key.startsWith('req:') && input.liveShortage(key.slice(4)) === 0;
    const note = apexNote(s, stale);
    const existing = map.get(key);
    if (!existing) { map.set(key, signalRow(s, note)); continue; }
    if (!existing.apex || noteRank(note) < noteRank(existing.apex)) existing.apex = note;
    if (!stale) existing.severity = maxSeverity(existing.severity, severityFromSignal(s.severity));
  }
  return Array.from(map.values());
}

/* ── Ordem e diversidade ────────────────────────────────────────────────── */

/** gravidade → prazo (sem prazo por último) → domínio (ordem do fluxo) → chave (estável). */
export function compareRows(a: FeedRow, b: FeedRow): number {
  const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (s) return s;
  if (a.due !== b.due) { if (!a.due) return 1; if (!b.due) return -1; return a.due < b.due ? -1 : 1; }
  const d = DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain);
  if (d) return d;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * As `n` primeiras linhas contêm a PRIMEIRA linha crítica de cada domínio
 * presente (até `n` delas): elas sobem, e o resto do topo é completado na
 * ordem — a ordem relativa é preservada.
 */
export function diversify(rows: readonly FeedRow[], n: number): FeedRow[] {
  const firstCritical: FeedRow[] = [];
  const seen = new Set<Domain>();
  for (const r of rows) {
    if (r.severity !== 'critical' || seen.has(r.domain)) continue;
    seen.add(r.domain);
    firstCritical.push(r);
  }
  const mandatory = new Set(firstCritical.slice(0, n));
  let fill = n - mandatory.size;
  const top: FeedRow[] = [];
  for (const r of rows) {
    if (top.length >= n) break;
    if (mandatory.has(r)) top.push(r);
    else if (fill > 0) { top.push(r); fill -= 1; }
  }
  const inTop = new Set(top);
  return [...top, ...rows.filter((r) => !inTop.has(r))];
}

/** Ordena e aplica a diversidade no topo de 8 (desktop) e de 5 (celular) — os dois valem ao mesmo tempo. */
export function rankFeed(rows: readonly FeedRow[]): FeedRow[] {
  return diversify(diversify([...rows].sort(compareRows), 8), 5);
}

export const FEED_ROWS_CAP = 40;

/** Linhas que a fonte cortou antes de chegar aqui (contadas, não listadas). */
export interface FeedExtra { domain: Domain; total: number; critical: number }

const OPS_KIND_PREFIX: Array<{ kind: AttentionKind; prefix: string; domain: Domain }> = [
  { kind: 'service_order', prefix: 'os:', domain: 'operacao' },
  { kind: 'measurement', prefix: 'meas:', domain: 'medicao' },
  { kind: 'risk', prefix: 'risk:', domain: 'operacao' },
  { kind: 'dependency', prefix: 'dep:', domain: 'operacao' },
];

/**
 * O que Operações contou SEM corte (`attentionCounts`) e não chegou como
 * linha (a fila de lá corta em 15/40): entra no total, nunca some.
 */
export function cappedOpsExtras(counts: AttentionCounts, rows: readonly FeedRow[]): FeedExtra[] {
  const out: FeedExtra[] = [];
  for (const { kind, prefix, domain } of OPS_KIND_PREFIX) {
    const mine = rows.filter((r) => r.key.startsWith(prefix));
    const total = Math.max(0, counts[kind].total - mine.length);
    const critical = Math.max(0, counts[kind].danger - mine.filter((r) => r.severity === 'critical').length);
    if (total > 0) out.push({ domain, total, critical: Math.min(critical, total) });
  }
  return out;
}

/** O que a montagem sabe da COMPLETUDE da fila: fontes que falharam e leituras cortadas. */
export interface FeedCompleteness {
  /** Fontes que a pessoa lê e cuja leitura FALHOU — a fila é parcial, nunca "nada fora do lugar". */
  failed?: FeedModel['failed'];
  /** Alguma fonte foi lida com corte: `total` é piso. */
  partial?: boolean;
}

/** O modelo da fila: total deduplicado SEM corte, críticas, por domínio; linhas cortadas em 40. */
export function buildFeedModel(
  ranked: readonly FeedRow[], extras: readonly FeedExtra[] = [], completeness: FeedCompleteness = {}, cap = FEED_ROWS_CAP,
): FeedModel {
  const byDomain: FeedModel['byDomain'] = {};
  const bump = (d: Domain, total: number, critical: number) => {
    const cur = byDomain[d] ?? { total: 0, critical: 0 };
    byDomain[d] = { total: cur.total + total, critical: cur.critical + critical };
  };
  for (const r of ranked) bump(r.domain, 1, r.severity === 'critical' ? 1 : 0);
  for (const e of extras) bump(e.domain, e.total, e.critical);
  const total = ranked.length + extras.reduce((a, e) => a + e.total, 0);
  const critical = ranked.filter((r) => r.severity === 'critical').length + extras.reduce((a, e) => a + e.critical, 0);
  return {
    rows: ranked.slice(0, cap), total, critical, byDomain,
    failed: [...(completeness.failed ?? [])], partial: completeness.partial === true,
  };
}

/* ── Fluxo do negócio (11 etapas) ───────────────────────────────────────── */

/**
 * `partial` (em cada parte): o número veio de uma leitura COM CORTE (teto do
 * PostgREST ou `.limit()`) — é piso, e a etapa sai com `partial: true` ("≥").
 */
export interface StagesInput {
  /** `contracts.view`: trabalho autorizado sem OS viva. */
  authorizedWithoutOs: SectionState<number>;
  /** `commercial.view`: oportunidades em etapa aberta. */
  openOpportunities: SectionState<number>;
  os: SectionState<{ awaitingIssue: number; blocked: number; inExecution: number; partial?: boolean }>;
  projects: SectionState<{
    active: number; health: Record<HealthLevel, number>; criticalActivities: number;
    /** Projetos ativos sem atividade-folha aberta no cronograma (a definição de Planejamento). */
    withoutSchedule: number;
    /** A saúde saiu de leitura cortada (cronograma, riscos, medições ou cobertura): críticos é piso. */
    healthPartial?: boolean;
    /** O cronograma veio cortado: "sem cronograma" seria TETO (não piso) — sem número. */
    schedulePartial?: boolean;
  }>;
  /** `short` é contagem exata; `partial` = a lista lida foi cortada, então `critical` é piso. */
  needs: SectionState<{ short: number; critical: number; partial?: boolean }>;
  supply: SectionState<{ lateInbound: number; requisitionsAwaitingSourcing: number; receivingIssues: number }>;
  execution: SectionState<{ overdue: number; inProgress: number; partial?: boolean }>;
  measurement: SectionState<{ pending: number; awaitingCustomer: number; inReview: number; partial?: boolean }>;
  billing: SectionState<{ awaitingRelease: number; invoicesToIssue: number; invoicesAmount: string | null }>;
  receivables: SectionState<{ overdue: number; open: number; linked: number }>;
}

export const STAGE_HREF: Record<StageId, string | null> = {
  comercial: '/comercial?view=visao-geral',
  os: '/operacoes/ordens-servico?filter=awaiting',
  projeto: '/projetos',
  planejamento: '/operacoes/planejamento',
  necessidades: '/supply/planejamento-materiais?filter=short',
  supply: '/supply/recebimentos?queue=late',
  execucao: '/operacoes/planejamento?focus=critical',
  medicao: '/operacoes/medicoes',
  faturamento: '/contratos?view=faturamento',
  recebivel: '/contratos?view=faturamento',
  caixa: null,
};

export const STAGE_LABEL: Record<StageId, string> = {
  comercial: 'Comercial', os: 'OS', projeto: 'Projeto', planejamento: 'Planejamento', necessidades: 'Necessidades',
  supply: 'Supply', execucao: 'Execução', medicao: 'Medição', faturamento: 'Faturamento', recebivel: 'Recebível', caixa: 'Caixa',
};

export const STAGE_DEFINITION: Record<StageId, string> = {
  comercial: 'Parado: trabalho autorizado sem OS interna viva (nenhuma OS além das canceladas). Contexto: oportunidades em etapa aberta.',
  os: 'Parado: OS em rascunho ou em confirmação, ainda não emitidas. Bloqueadas: com divergência bloqueante aberta. Em obra: emitidas ou em execução com projeto.',
  projeto: 'Parado: projetos ativos com saúde crítica — a mesma regra da página do projeto.',
  planejamento: 'Parado: projetos ativos sem atividade aberta no cronograma (sem base para a saúde). Contexto: atividades críticas.',
  necessidades: 'Parado: requisitos com falta na cobertura ao vivo (requerido − coberto − entrando > 0). Críticas: necessidade em até 7 dias ou vencida.',
  supply: 'Parado: pedidos emitidos com item em aberto e previsão de entrega vencida.',
  execucao: 'Parado: atividades-folha abertas com término planejado vencido, lidas do cronograma canônico. O avanço nunca é inferido.',
  medicao: 'Parado: medições cuja próxima ação é da operação (preparar evidência vencida ou em preparo, corrigir devolução).',
  faturamento: 'Parado: eventos elegíveis ainda não liberados para faturamento (sem cancelamento, substituição ou linha legada).',
  recebivel: 'Parado: títulos vinculados ao faturamento contratual com parcela vencida e saldo em aberto.',
  caixa: 'Não há razão de caixa conectado ao Apex.',
};

const RESTRICTED_REASON = 'Seu perfil não lê esta etapa';
const ERROR_REASON = 'Não carregou';

/** Comercial `ok` sem o número de autorizadas: o motivo EXATO (a tela nunca mostra 0 no lugar). */
export const COMERCIAL_STUCK_REASON = {
  restricted: 'Autorizadas sem OS: restrito ao seu perfil',
  error: 'Autorizadas sem OS: não carregou',
} as const;

/** Planejamento `ok` sem número: com o cronograma cortado, "sem cronograma" seria teto, não piso. */
export const SCHEDULE_PARTIAL_REASON = 'Sem atividade aberta: leitura do cronograma incompleta';

function stage(id: StageId, over: Partial<FlowStage>): FlowStage {
  return {
    id, label: STAGE_LABEL[id], state: 'ok', stuck: null, context: null, tone: 'neutral',
    href: STAGE_HREF[id], definition: STAGE_DEFINITION[id], reason: null, partial: false, noNumber: null, ...over,
  };
}

/** "≥ 12" quando o número é piso (leitura cortada); "12" quando é exato. */
const atLeast = (n: number, partial: boolean | undefined) => (partial ? `≥ ${n}` : String(n));
const pluralAtLeast = (n: number, one: string, many: string, partial: boolean | undefined) =>
  `${partial ? '≥ ' : ''}${plural(n, one, many)}`;
/** Zero numa leitura cortada não é "em dia": o tom fica neutro. */
const calmTone = (partial: boolean | undefined): FlowStage['tone'] => (partial ? 'neutral' : 'success');

/** Etapa fora de `ok`: sem número, com o motivo. */
function notOk(id: StageId, s: SectionState<unknown>): FlowStage | null {
  if (s.state === 'restricted') return stage(id, { state: 'restricted', reason: RESTRICTED_REASON });
  if (s.state === 'error') return stage(id, { state: 'error', reason: ERROR_REASON });
  return null;
}

export function buildStages(i: StagesInput): FlowStage[] {
  const out: FlowStage[] = [];

  // Comercial — duas leituras independentes; só é "Restrito" quando nenhuma é legível.
  {
    const a = i.authorizedWithoutOs; const o = i.openOpportunities;
    if (a.state !== 'ok' && o.state !== 'ok') {
      out.push(a.state === 'error' || o.state === 'error' ? stage('comercial', { state: 'error', reason: ERROR_REASON })
        : stage('comercial', { state: 'restricted', reason: RESTRICTED_REASON }));
    } else {
      const stuck = a.state === 'ok' ? { value: a.data, noun: a.data === 1 ? 'autorizada sem OS' : 'autorizadas sem OS' } : null;
      out.push(stage('comercial', {
        stuck,
        context: o.state === 'ok' ? plural(o.data, 'oportunidade aberta', 'oportunidades abertas')
          : o.state === 'error' ? 'Oportunidades: não carregou' : null,
        tone: stuck && stuck.value > 0 ? 'warning' : 'neutral',
        // `stuck: null` numa etapa `ok` SEMPRE diz por quê — nunca vira 0 na tela.
        reason: a.state === 'restricted' ? COMERCIAL_STUCK_REASON.restricted
          : a.state === 'error' ? COMERCIAL_STUCK_REASON.error : null,
        noNumber: a.state === 'restricted' ? 'restricted' : a.state === 'error' ? 'error' : null,
      }));
    }
  }

  out.push(notOk('os', i.os) ?? (() => {
    const d = (i.os as { data: { awaitingIssue: number; blocked: number; inExecution: number; partial?: boolean } }).data;
    return stage('os', {
      stuck: { value: d.awaitingIssue, noun: 'a emitir' },
      context: `${pluralAtLeast(d.blocked, 'bloqueada', 'bloqueadas', d.partial)} · ${atLeast(d.inExecution, d.partial)} em obra`,
      tone: d.blocked > 0 ? 'danger' : d.awaitingIssue > 0 ? 'warning' : calmTone(d.partial),
      partial: d.partial === true,
    });
  })());

  type ProjectsPart = Extract<StagesInput['projects'], { state: 'ok' }>['data'];
  out.push(notOk('projeto', i.projects) ?? (() => {
    const d = (i.projects as { data: ProjectsPart }).data;
    return stage('projeto', {
      stuck: { value: d.health.critical, noun: d.health.critical === 1 ? 'crítico' : 'críticos' },
      // Com leitura cortada, "em atenção" pode estar para mais ou para menos: não se diz.
      context: d.healthPartial ? plural(d.active, 'ativo', 'ativos')
        : `${plural(d.active, 'ativo', 'ativos')} · ${d.health.attention} em atenção`,
      tone: d.health.critical > 0 ? 'danger' : d.health.attention > 0 ? 'warning' : calmTone(d.healthPartial),
      partial: d.healthPartial === true,
    });
  })());

  out.push(notOk('planejamento', i.projects) ?? (() => {
    const d = (i.projects as { data: ProjectsPart }).data;
    const context = pluralAtLeast(d.criticalActivities, 'atividade crítica', 'atividades críticas', d.schedulePartial);
    if (d.schedulePartial) {
      return stage('planejamento', { stuck: null, context, tone: 'neutral', reason: SCHEDULE_PARTIAL_REASON, noNumber: 'incomplete' });
    }
    return stage('planejamento', {
      // "Sem atividade aberta", e não "sem cronograma": o painel Projetos usa "Sem cronograma" para a SAÚDE desconhecida (outro número).
      stuck: { value: d.withoutSchedule, noun: 'sem atividade aberta' },
      context,
      tone: d.withoutSchedule > 0 ? 'warning' : 'success',
    });
  })());

  out.push(notOk('necessidades', i.needs) ?? (() => {
    const d = (i.needs as { data: { short: number; critical: number; partial?: boolean } }).data;
    // `short` é contagem exata; só as críticas saem da lista lida (piso quando cortada).
    return stage('necessidades', {
      stuck: { value: d.short, noun: 'sem cobertura' },
      context: `${atLeast(d.critical, d.partial)} ${d.critical === 1 ? 'crítica' : 'críticas'} (≤ 7 dias)`,
      tone: d.critical > 0 ? 'danger' : d.short > 0 ? 'warning' : 'success',
    });
  })());

  out.push(notOk('supply', i.supply) ?? (() => {
    const d = (i.supply as { data: { lateInbound: number; requisitionsAwaitingSourcing: number; receivingIssues: number } }).data;
    return stage('supply', {
      stuck: { value: d.lateInbound, noun: d.lateInbound === 1 ? 'entrega atrasada' : 'entregas atrasadas' },
      context: `${plural(d.requisitionsAwaitingSourcing, 'requisição aguardando cotação', 'requisições aguardando cotação')} · `
        + plural(d.receivingIssues, 'recebimento com pendência', 'recebimentos com pendência'),
      tone: d.lateInbound > 0 ? 'warning' : 'success',
    });
  })());

  out.push(notOk('execucao', i.execution) ?? (() => {
    const d = (i.execution as { data: { overdue: number; inProgress: number; partial?: boolean } }).data;
    return stage('execucao', {
      stuck: { value: d.overdue, noun: d.overdue === 1 ? 'atividade vencida' : 'atividades vencidas' },
      context: `${atLeast(d.inProgress, d.partial)} em andamento`,
      tone: d.overdue > 0 ? 'warning' : calmTone(d.partial),
      partial: d.partial === true,
    });
  })());

  out.push(notOk('medicao', i.measurement) ?? (() => {
    const d = (i.measurement as { data: { pending: number; awaitingCustomer: number; inReview: number; partial?: boolean } }).data;
    return stage('medicao', {
      stuck: { value: d.pending, noun: 'com a operação' },
      context: `${atLeast(d.awaitingCustomer, d.partial)} aguardando cliente · ${atLeast(d.inReview, d.partial)} em análise`,
      tone: d.pending > 0 ? 'warning' : calmTone(d.partial),
      partial: d.partial === true,
    });
  })());

  out.push(notOk('faturamento', i.billing) ?? (() => {
    const d = (i.billing as { data: { awaitingRelease: number; invoicesToIssue: number; invoicesAmount: string | null } }).data;
    return stage('faturamento', {
      stuck: { value: d.awaitingRelease, noun: 'aguardando liberação' },
      context: withMoney(`${d.invoicesToIssue} NF a emitir`, d.invoicesAmount),
      tone: d.awaitingRelease > 0 || d.invoicesToIssue > 0 ? 'warning' : 'success',
    });
  })());

  out.push(notOk('recebivel', i.receivables) ?? (() => {
    const d = (i.receivables as { data: { overdue: number; open: number; linked: number } }).data;
    return stage('recebivel', {
      stuck: { value: d.overdue, noun: d.overdue === 1 ? 'vencido' : 'vencidos' },
      context: d.linked === 0 ? 'nenhum título vinculado' : `${d.open} em aberto`,
      tone: d.overdue > 0 ? 'danger' : 'success',
    });
  })());

  out.push(stage('caixa', { state: 'unavailable', reason: 'Nenhuma conta de caixa conectada' }));
  return out;
}

/* ── Há operação? (decide o estado vazio) ───────────────────────────────── */

/** As leituras que dizem se há operação. `null` = não lida (restrito ou falhou). */
export interface OperationReads {
  activeProjects: number | null;
  /** OS abertas (rascunho, confirmação, emitidas, em obra); `partial` = a lista de OS veio cortada. */
  openServiceOrders: { value: number; partial?: boolean } | null;
  openOpportunities: number | null;
  authorizedWithoutOs: number | null;
}

/**
 * `true`: alguma leitura mostrou operação. `false`: TODAS as leituras de
 * operação (projetos ativos, OS abertas, oportunidades, autorizadas sem OS)
 * responderam, inteiras, e vazias. `null`: alguma não foi lida (restrita ou
 * falhou) ou veio cortada — não se afirma "ainda não há operação".
 */
export function operationPresence(r: OperationReads): boolean | null {
  const parts: Array<boolean | null> = [
    r.activeProjects === null ? null : r.activeProjects > 0,
    r.openServiceOrders === null ? null
      : r.openServiceOrders.value > 0 ? true : r.openServiceOrders.partial ? null : false,
    r.openOpportunities === null ? null : r.openOpportunities > 0,
    r.authorizedWithoutOs === null ? null : r.authorizedWithoutOs > 0,
  ];
  if (parts.some((p) => p === true)) return true;
  return parts.every((p) => p === false) ? false : null;
}

/* ── Projetos ───────────────────────────────────────────────────────────── */

export interface ProjectHealthInput {
  projectId: string;
  project: string;
  client: string | null;
  level: HealthLevel;
  reasons: string[];
  nextMilestone: string | null;
  nextMilestoneTitle: string | null;
}

/** Saúde do projeto + a linha mais grave da fila para ele (a fila chega ORDENADA). */
export function projectRows(health: readonly ProjectHealthInput[], rankedFeed: readonly FeedRow[]): ProjectHealthRow[] {
  return health.map((p) => {
    const top = rankedFeed.find((r) => r.location.kind === 'project' && r.location.id === p.projectId) ?? null;
    const milestone = isoDay(p.nextMilestone);
    return {
      projectId: p.projectId,
      name: p.project,
      client: p.client,
      level: p.level,
      reasons: p.reasons,
      nextMilestone: milestone ? { date: milestone, title: p.nextMilestoneTitle } : null,
      topIssue: top ? { label: `${top.kindLabel}: ${top.problem}`, href: top.nextAction.href, severity: top.severity } : null,
      href: `/projetos/${encodeURIComponent(p.projectId)}?tab=overview`,
      mapHref: `/projetos/operations-3d?project=${encodeURIComponent(p.projectId)}`,
    };
  });
}

/* ── Decisões (a superfície, nunca a caixa) ─────────────────────────────── */

const DECISION_TONE: Record<string, DecisionPreview['priority']['tone']> = {
  danger: 'danger', warning: 'warning', accent: 'accent', info: 'accent', success: 'neutral', neutral: 'neutral',
};

/**
 * Um item da caixa → a prévia do Dashboard (valor já formatado pela mesma regra
 * da caixa). `projectId` só quando a linha da caixa o carrega (pedido de compra);
 * faturamento não tem projeto → `null`.
 */
export function decisionPreview(
  item: Pick<DecisionItem, 'key' | 'kindLabel' | 'title' | 'projectName' | 'priority' | 'overdue' | 'dueAt' | 'decideBy'>
    & { projectId?: string | null },
  opts: { href: string; amountText: string | null; amountRestricted: boolean; due: string | null },
): DecisionPreview {
  return {
    key: item.key,
    projectId: item.projectId ?? null,
    href: opts.href,
    kindLabel: item.kindLabel,
    title: item.title,
    amountText: opts.amountRestricted ? null : opts.amountText,
    amountRestricted: opts.amountRestricted,
    project: item.projectName,
    priority: { label: item.priority.label, tone: DECISION_TONE[item.priority.tone] ?? 'neutral' },
    due: opts.due,
    overdue: item.overdue,
  };
}

/* ── Calendário da empresa (30 dias) ────────────────────────────────────── */

export const CALENDAR_DAYS = 30;
export const CALENDAR_LANE_CAP = 40;

export const CALENDAR_LANE_LABEL: Record<CalendarLane, string> = {
  operacao: 'Operação', supply: 'Supply', medicao: 'Medição', faturamento: 'Faturamento', recebivel: 'Recebíveis',
};

/** Só datas válidas dentro de [hoje, hoje + dias]; em ordem; no máximo `cap` por raia. */
export function laneItems(items: readonly CalendarItem[], today: string, days = CALENDAR_DAYS, cap = CALENDAR_LANE_CAP): CalendarItem[] {
  const end = addDays(today, days);
  return items
    .map((it) => ({ ...it, date: isoDay(it.date) as string }))
    .filter((it) => it.date !== null && it.date >= today && it.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .slice(0, cap);
}

/**
 * Uma raia: o estado da leitura; `partial` numa raia `ok` = parte dela não
 * carregou (uma das leituras falhou) ou veio cortada — o que aparece é incompleto.
 */
export type CalendarLaneState = SectionState<CalendarItem[]> & { partial?: boolean };
export type CalendarLaneInput = Partial<Record<CalendarLane, CalendarLaneState>>;

/**
 * Junta as leituras de UMA raia (ex.: Supply = faltas + entregas). Só as que
 * a pessoa lê entram. Nenhuma legível → `restricted`; todas falharam → `error`;
 * alguma falhou ou veio cortada → `ok` com `partial` (nunca "nada previsto" calado).
 */
export function mergeLaneParts(parts: ReadonlyArray<CalendarLaneState>, label: string): CalendarLaneState {
  if (!parts.length) return { state: 'restricted' };
  const ok = parts.filter((p): p is Extract<CalendarLaneState, { state: 'ok' }> => p.state === 'ok');
  if (!ok.length) return { state: 'error', message: `Não foi possível ler a raia de ${label}.` };
  const partial = ok.length < parts.length || ok.some((p) => p.partial === true);
  return { state: 'ok', data: ok.flatMap((p) => p.data), ...(partial ? { partial: true } : {}) };
}

/** As raias que existem: Operação, Supply, Medição e Recebíveis. Raia ilegível = `restricted`; leitura que falhou = `unavailable`. */
export const CALENDAR_LANES: readonly CalendarLane[] = ['operacao', 'supply', 'medicao', 'recebivel'];

export function buildCalendar(today: string, lanes: CalendarLaneInput): SectionState<CalendarModel> {
  const states = CALENDAR_LANES.map((id) => ({ id, s: lanes[id] ?? ({ state: 'restricted' } as const) }));
  if (states.every((x) => x.s.state === 'restricted')) return { state: 'restricted' };
  if (states.every((x) => x.s.state !== 'ok')) {
    return { state: 'error', message: 'Não foi possível montar o calendário dos próximos 30 dias.' };
  }
  const items: CalendarItem[] = [];
  for (const { id, s } of states) if (s.state === 'ok') items.push(...laneItems(s.data.map((it) => ({ ...it, lane: id })), today));
  return {
    state: 'ok',
    data: {
      days: CALENDAR_DAYS,
      // Raia que falhou fica na lista como `unavailable` (a tela diz "não carregou"); nunca some.
      lanes: states.map(({ id, s }) => ({
        id, label: CALENDAR_LANE_LABEL[id], state: s.state === 'ok' ? 'ok' : s.state === 'restricted' ? 'restricted' : 'unavailable',
        ...(s.state === 'ok' && s.partial ? { partial: true } : {}),
      })),
      items,
    },
  };
}

/** Horizonte do cronograma → marcos e atividades críticas da raia Operação. */
export function operationCalendarItems(horizon: Record<number, Array<{
  id: string; title: string; project: string; projectId: string; date: string | null; milestone: boolean; critical: boolean;
}>> | null): CalendarItem[] {
  if (!horizon) return [];
  const out: CalendarItem[] = [];
  const seen = new Set<string>();
  for (const list of Object.values(horizon)) {
    for (const a of list) {
      if ((!a.milestone && !a.critical) || seen.has(a.id) || !a.date) continue;
      seen.add(a.id);
      out.push({
        id: `act:${a.id}`, date: a.date, title: a.title, lane: 'operacao',
        kind: a.milestone ? 'milestone' : 'activity', tone: a.critical ? 'danger' : 'accent',
        href: `/projetos/${encodeURIComponent(a.projectId)}?tab=timeline`, project: a.project,
      });
    }
  }
  return out;
}

/** Faltas de material → necessidades na raia Supply (tom pelo risco de supply). */
export function needCalendarItems(needs: readonly MaterialNeed[], today: string): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const m of needs) {
    if (m.coverage.shortage <= 0) continue;
    const need = materialNeedDate(m);
    if (!need) continue;
    const risk = materialRisk(m, today);
    out.push({
      id: `need:${m.requirementId}`, date: need, title: `Falta: ${m.title ?? 'material do requisito'}`, lane: 'supply', kind: 'need',
      tone: risk === 'critical' ? 'danger' : risk === 'high' ? 'warning' : 'accent',
      href: `/supply/planejamento-materiais?req=${encodeURIComponent(m.requirementId)}`, project: m.project,
    });
  }
  return out;
}
