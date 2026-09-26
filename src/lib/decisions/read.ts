/**
 * DECISÕES — o read model do servidor (server-only).
 *
 * Tudo aqui é LEITURA de uma projeção calculada no banco (240). A caixa, a
 * Equipe, as Concluídas e o acesso ao detalhe vêm das portas `*_for_viewer`,
 * que tiram a identidade de auth.uid() e a organização da sessão — nunca de
 * parâmetro. O que o servidor acrescenta pelo service role (nomes, linhas do
 * pedido, sinais, a comparação de propostas, a decisão resolvida) é lido SÓ
 * para os objetos que a projeção já autorizou e SÓ dentro da organização
 * ativa. Nada é gravado; nenhum estado de decisão mora aqui.
 */
if (typeof window !== 'undefined') {
  throw new Error('decisions/read.ts não pode ser importado no navegador');
}

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { platformServiceClient } from '@/lib/platform/server-client';
import { selectIn } from '@/lib/supabase/select-in';
import { date as fmtDate, daysBetween, money, qty, todayIso } from '@/components/ax/format';
import { emailTransportKind, type EmailTransportKind } from '@/lib/notifications/email';
import { resolveWhatsAppChannel } from '@/lib/notifications/whatsapp';
import { nameBook, type NameBook } from './names';
import {
  AUTHORITY_SOURCE_LABEL, OUTCOME_STATUS, categoryLabel, kindLabel, prioritize, sourceLink, statusOf, toDecisionItem, whyFacts,
} from './model';
import { purchaseOrderDetail } from './detail-procurement';
import { billingEventDetail } from './detail-billing';
import type {
  Bottleneck, ChannelStatus, CompletedItem, ContextLine, DecisionAccess, DecisionAssignment, DecisionDetail, DecisionInboxRow,
  DecisionItem, DecisionOpenState, DecisionOutcome, DecisionsTab, DecisionsWorkspace, DeliverySummary, Fact, PersonRef,
  ResolvedDecision, TeamItem, TeamScope, TimelineEntry,
} from './types';

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const uniq = (ids: Array<string | null | undefined>) => Array.from(new Set(ids.filter((x): x is string => !!x)));
const byTime = (a: { at: string }, b: { at: string }) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0);

/** A sessão de que o read model precisa — a de `requireCommercialSession`. */
export interface DecisionsSession { supabase: SupabaseClient; user: { id: string }; organizationId: string }

/** Falha de leitura com mensagem para a pessoa (a rota responde 500 com ela). */
export class DecisionsReadError extends Error {
  /** NOT_PROVISIONED: as funções de Decisões não existem neste banco (migrations 240+ pendentes). */
  constructor(message: string, readonly code: 'READ_FAILED' | 'NOT_PROVISIONED' = 'READ_FAILED') {
    super(message); this.name = 'DecisionsReadError';
  }
}

/** Função RPC inexistente (PostgREST PGRST202 / Postgres 42883): Decisões não foi instalada aqui. */
export function readError(error: { code?: string | null } | null, message: string): DecisionsReadError {
  if (error?.code === 'PGRST202' || error?.code === '42883') {
    return new DecisionsReadError('Decisões ainda não está instalada neste ambiente (migrations 240+ pendentes). Fale com quem administra a plataforma.', 'NOT_PROVISIONED');
  }
  return new DecisionsReadError(message);
}

const FMT = {
  money: (v: number | null, c?: string | null) => money(v, c || 'BRL'),
  date: (v: string | null) => fmtDate(v),
};

export const DECISIONS_TABS: readonly DecisionsTab[] = ['minhas', 'equipe', 'concluidas'];
export const isDecisionsTab = (v: unknown): v is DecisionsTab => DECISIONS_TABS.includes(v as DecisionsTab);

/** Leitura de decisão nunca vai para cache: é "o que precisa de mim AGORA". */
export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** O segmento da rota como chave. Chave válida não tem `%`; decodificar de novo é inofensivo. */
export function decisionKeyParam(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

/** Falha de leitura → 500 com a frase da leitura (nunca o texto do banco). */
export function decisionsReadFailure(error: unknown) {
  if (!(error instanceof DecisionsReadError)) console.error('[decisions] leitura falhou', error);
  const known = error instanceof DecisionsReadError ? error : null;
  return NextResponse.json({ ok: false, error: known ? known.message : 'Não foi possível ler as decisões.', code: known?.code ?? 'READ_FAILED' },
    { status: known?.code === 'NOT_PROVISIONED' ? 503 : 500, headers: NO_STORE });
}

// ---------------------------------------------------------------------------
// Regras puras (testadas em tests/unit/decisions-read.test.ts)
// ---------------------------------------------------------------------------

/**
 * "400 m · Cabo 35 mm +2 itens" — a linha de MAIOR valor do pedido e quantas
 * mais existem. O valor decide qual linha representa o pedido: é a que pesa
 * na decisão.
 */
export function needSummary(lines: Array<{ quantity: number; unit: string | null; code: string | null; description: string | null; value: number }>): string | null {
  if (!lines.length) return null;
  const head = [...lines].sort((a, b) => b.value - a.value || String(a.code ?? '').localeCompare(String(b.code ?? '')))[0];
  const what = head.description ?? head.code ?? 'item';
  const extra = lines.length - 1;
  return `${qty(head.quantity, head.unit)} · ${what}${extra ? ` +${extra} ${extra === 1 ? 'item' : 'itens'}` : ''}`;
}

/**
 * As linhas de contexto do cartão de compra, na ordem do produto. Linha sem
 * dado não aparece — nunca "—" fingindo que o dado existe. O fornecedor é o
 * do pedido (o escolhido na decisão de compra); ele só é chamado de
 * "recomendado" quando a recomendação registrada aponta para a proposta
 * escolhida.
 */
export function purchaseOrderContext(input: {
  project: string | null; supplier: string | null; followsRecommendation: boolean | null; need: string | null;
  needBy: string | null; decideBy: string | null; requestedBy: string | null;
}): ContextLine[] {
  const out: ContextLine[] = [];
  if (input.project) out.push({ label: 'Projeto', value: input.project });
  if (input.supplier) {
    out.push({ label: input.followsRecommendation ? 'Fornecedor recomendado' : 'Fornecedor escolhido', value: input.supplier, emphasis: true });
  }
  if (input.need) out.push({ label: 'Necessidade', value: input.need });
  if (input.needBy) out.push({ label: 'Necessário até', value: fmtDate(input.needBy) });
  if (input.decideBy && input.decideBy !== input.needBy) out.push({ label: 'Decidir até', value: fmtDate(input.decideBy) });
  if (input.requestedBy) out.push({ label: 'Solicitado por', value: input.requestedBy });
  return out;
}

export function billingContext(input: {
  contract: string | null; counterparty: string | null; event: string | null; dueDate: string | null; requestedBy: string | null;
}): ContextLine[] {
  const out: ContextLine[] = [];
  if (input.contract) out.push({ label: 'Contrato', value: input.contract, emphasis: true });
  if (input.counterparty) out.push({ label: 'Contraparte', value: input.counterparty });
  if (input.event) out.push({ label: 'Evento', value: input.event });
  if (input.dueDate) out.push({ label: 'Vencimento', value: fmtDate(input.dueDate) });
  if (input.requestedBy) out.push({ label: 'Solicitado por', value: input.requestedBy });
  return out;
}

/**
 * "Crítico" só com EVIDÊNCIA gravada: um requisito vivo de prioridade crítica
 * atendido pelo pedido, ou um sinal crítico ABERTO da Apex sobre o pedido ou
 * sobre um desses requisitos. A razão nomeia a evidência.
 */
export function criticalEvidence(
  requirements: Array<{ title: string; priority: string | null; status?: string | null }>,
  signals: Array<{ title: string; severity: string; status: string }>,
): { reason: string } | null {
  const req = requirements.find((r) => r.priority === 'critical' && !['CANCELLED', 'SUPERSEDED'].includes(String(r.status ?? '')));
  if (req) return { reason: `Requisito crítico: ${req.title}` };
  const sig = signals.find((s) => s.severity === 'critical' && s.status === 'OPEN');
  if (sig) return { reason: `Sinal crítico da Apex: ${sig.title}` };
  return null;
}

/** Dias de calendário (São Paulo) desde o pedido. */
export function waitingDays(requestedAt: string | null, today: string): number | null {
  if (!requestedAt) return null;
  const t = Date.parse(requestedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, daysBetween(todayIso(new Date(t)), today));
}

/** Linha crua de `decision_team_for_viewer()`. */
export interface DecisionTeamRow {
  decision_key: string; source_kind: DecisionItem['source']; category: string; subject_type: string; subject_id: string;
  title: string; amount: number | string | null; currency: string | null; amount_restricted: boolean; project_id: string | null;
  requested_by: string | null; requested_at: string | null; due_at: string | null; need_by: string | null; decide_by: string | null;
  overdue: boolean; state: DecisionOpenState; assignees: Array<{ user_id: string; assignment: DecisionAssignment }> | null;
}

export function toTeamItem(r: DecisionTeamRow, names: Pick<NameBook, 'person' | 'project'>, today: string): TeamItem {
  return {
    key: r.decision_key, source: r.source_kind, category: r.category, kindLabel: kindLabel(r.subject_type), title: r.title,
    amount: r.amount_restricted ? null : num(r.amount), amountRestricted: Boolean(r.amount_restricted), currency: r.currency,
    projectId: r.project_id, projectName: names.project(r.project_id), requestedBy: names.person(r.requested_by),
    requestedAt: r.requested_at, waitingDays: waitingDays(r.requested_at, today), dueAt: r.due_at,
    needBy: r.need_by ? String(r.need_by).slice(0, 10) : null, decideBy: r.decide_by ? String(r.decide_by).slice(0, 10) : null,
    overdue: Boolean(r.overdue), state: r.state, status: statusOf(r.state, null),
    owners: (r.assignees ?? []).map((a) => ({ id: a.user_id, name: names.person(a.user_id)?.name ?? null, assignment: a.assignment })),
  };
}

/** Vencidas primeiro; depois as sem decisor; depois a espera mais longa. */
export function sortTeamItems(items: TeamItem[]): TeamItem[] {
  return [...items].sort((a, b) => Number(b.overdue) - Number(a.overdue)
    || Number(b.state === 'SEM_DECISOR') - Number(a.state === 'SEM_DECISOR')
    || (b.waitingDays ?? -1) - (a.waitingDays ?? -1) || a.key.localeCompare(b.key));
}

/**
 * ONDE as decisões param: por dono (faixa primária ou escalada — quem só é
 * elegível não é o gargalo), com a decisão sem nenhum dono agrupada em
 * `owner: null` ("Sem decisor elegível"). O valor soma só o que o espectador
 * pode ver, e só quando há UMA moeda: somar reais com dólares seria inventar.
 */
export function aggregateBottlenecks(items: TeamItem[]): Bottleneck[] {
  type Acc = { owner: PersonRef | null; open: number; overdue: number; oldest: number | null; amounts: Map<string, number> };
  const acc = new Map<string, Acc>();
  const add = (k: string, owner: PersonRef | null, it: TeamItem) => {
    const a = acc.get(k) ?? { owner, open: 0, overdue: 0, oldest: null, amounts: new Map<string, number>() };
    a.open += 1;
    if (it.overdue) a.overdue += 1;
    if (it.waitingDays !== null) a.oldest = Math.max(a.oldest ?? 0, it.waitingDays);
    if (!it.amountRestricted && it.amount !== null) {
      const c = it.currency ?? 'BRL';
      a.amounts.set(c, (a.amounts.get(c) ?? 0) + it.amount);
    }
    acc.set(k, a);
  };
  for (const it of items) {
    const owners = new Map(it.owners.filter((o) => o.assignment !== 'ELIGIBLE').map((o) => [o.id, o]));
    if (!owners.size) add('', null, it);
    else for (const o of Array.from(owners.values())) add(o.id, { id: o.id, name: o.name }, it);
  }
  return Array.from(acc.values()).map((a): Bottleneck => ({
    owner: a.owner, open: a.open, overdue: a.overdue, oldestWaitingDays: a.oldest,
    amount: a.amounts.size === 1 ? Array.from(a.amounts.values())[0] : null,
  })).sort((x, y) => y.overdue - x.overdue || y.open - x.open || (y.oldestWaitingDays ?? -1) - (x.oldestWaitingDays ?? -1)
    || String(x.owner?.name ?? '').localeCompare(String(y.owner?.name ?? '')));
}

/** "Alçada declarada — Ata de diretoria/conselho ATA-QA-001 (até R$ 500.000,00)". */
export function procurementAuthoritySummary(a: { source_kind: string; source_reference: string; max_amount: number | string | null; currency: string | null }): string {
  const label = AUTHORITY_SOURCE_LABEL[a.source_kind] ?? a.source_kind;
  const cap = num(a.max_amount) === null ? 'sem teto' : `até ${money(num(a.max_amount), a.currency || 'BRL')}`;
  return `Alçada declarada — ${label} ${a.source_reference} (${cap})`;
}

/** "Política procurement.po v1 — role:financeiro". */
export function policyAuthoritySummary(raw: Row | null | undefined): string | null {
  if (!raw?.policy_key) return null;
  const base = `Política ${String(raw.policy_key)} v${String(raw.policy_version_no ?? '?')}`;
  return raw.authority_basis ? `${base} — ${String(raw.authority_basis)}` : base;
}

/** Linha crua de `decision_history_for_viewer()`. */
export interface DecisionHistoryRow {
  decision_key: string; source_kind: DecisionItem['source']; category: string; subject_type: string; subject_id: string;
  title: string; amount: number | string | null; currency: string | null; project_id: string | null;
  viewer_role: 'DECIDER' | 'REQUESTER'; outcome: DecisionOutcome; decided_by: string | null; decided_at: string | null;
  requested_by: string | null; requested_at: string | null; reason: string | null; authority: Row | null; record_id: string | null;
}

export function toCompletedItem(r: DecisionHistoryRow, names: Pick<NameBook, 'person' | 'project'>,
  authorities: Map<string, { source_kind: string; source_reference: string; max_amount: number | string | null; currency: string | null }>): CompletedItem {
  const authorityId = str(r.authority?.authority_id);
  const declared = authorityId ? authorities.get(authorityId) : undefined;
  return {
    key: r.decision_key, source: r.source_kind, category: r.category, kindLabel: kindLabel(r.subject_type), title: r.title,
    amount: num(r.amount), currency: r.currency, projectId: r.project_id, projectName: names.project(r.project_id),
    viewerRole: r.viewer_role, outcome: r.outcome, status: OUTCOME_STATUS[r.outcome] ?? statusOf(null, r.outcome),
    decidedBy: names.person(r.decided_by), decidedAt: r.decided_at, requestedBy: names.person(r.requested_by), requestedAt: r.requested_at,
    reason: r.reason,
    authoritySummary: r.source_kind === 'PROCUREMENT_AUTHORITY'
      ? (declared ? procurementAuthoritySummary(declared)
        // Devolver ao rascunho não usa alçada de valor (purchase_order_decide só exige a permissão e a SoD):
        // o registro canônico não guarda alçada — e a tela diz isso, em vez de inventar uma.
        : r.outcome === 'ADJUSTMENT_REQUESTED' ? 'Devolução por alçada de compra — exige procurement.approve, sem teto de valor' : null)
      : policyAuthoritySummary(r.authority),
    recordId: r.record_id, sourceHref: sourceLink(r.subject_type, r.subject_id, false).href,
  };
}

export function categoryCounts(items: Array<Pick<DecisionItem, 'category'>>): Array<{ id: string; label: string; count: number }> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1);
  return Array.from(m.entries()).map(([id, count]) => ({ id, label: categoryLabel(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * `decision_resolve` → o formato da tela. O estado de uma decisão ABERTA não
 * vem do resolvedor (ele diz aberta/encerrada e o desfecho); quem chama passa
 * o estado da caixa quando o tem.
 */
export function toResolved(raw: Row, person: (id: string | null) => PersonRef | null, openState: DecisionOpenState | null = null): ResolvedDecision {
  const outcome = (str(raw.outcome) as DecisionOutcome | null) ?? null;
  const open = raw.open === true;
  return {
    key: String(raw.decision_key), source: raw.source_kind as ResolvedDecision['source'], category: String(raw.category ?? 'outros'),
    subjectType: String(raw.subject_type), subjectId: String(raw.subject_id), title: String(raw.title ?? ''),
    amount: num(raw.amount), currency: str(raw.currency), projectId: str(raw.project_id),
    open, outcome, status: statusOf(open ? openState : null, outcome),
    closedBy: person(str(raw.closed_by)), closedAt: str(raw.closed_at), reason: str(raw.reason),
    requestedBy: person(str(raw.requested_by)), requestedAt: str(raw.requested_at), requestNote: str(raw.request_note),
    fingerprint: str(raw.fingerprint), submission: num(raw.submission), requestId: str(raw.request_id), stageNo: num(raw.stage_no),
  };
}

const SKIP_REASON: Record<string, string> = {
  CHANNEL_DISABLED: 'Canal desligado pela organização.',
  CHANNEL_NOT_CONFIGURED: 'Canal não configurado pela organização.',
  USER_OPTED_OUT: 'Você optou por não receber por este canal.',
  NO_OPT_IN: 'Sem número de WhatsApp informado por você (opt-in).',
  DECISION_CLOSED: 'A decisão foi encerrada antes do envio.',
  LEASE_EXPIRED: 'A tentativa anterior não registrou resultado; nova tentativa agendada.',
};

export function deliveryStateLabel(state: string, channel: string): string {
  switch (state) {
    case 'DELIVERED': return 'Entregue';
    case 'SENT': return 'Enviado';
    case 'SIMULATED': return 'Simulado (sem provedor de e-mail)';
    case 'NOT_CONFIGURED': return channel === 'whatsapp' ? 'WhatsApp não configurado' : 'Canal não configurado';
    case 'SKIPPED': return 'Não enviado (preferência/canal)';
    case 'FAILED': return 'Falhou — nova tentativa agendada';
    case 'DEAD': return 'Falhou definitivamente';
    case 'CANCELLED': return 'Cancelado (decisão encerrada)';
    case 'SENDING': return 'Enviando';
    case 'PENDING': return 'Na fila';
    default: return state;
  }
}

/** Uma linha do livro de entrega da PRÓPRIA pessoa, dita em português. */
export function deliverySummary(r: {
  channel: string; notice_kind: string; state: string; sent_at?: string | null; delivered_at?: string | null;
  updated_at?: string | null; created_at?: string | null; failure_code?: string | null; failure_reason?: string | null;
}): DeliverySummary {
  const detail = ['FAILED', 'DEAD', 'SKIPPED', 'CANCELLED', 'NOT_CONFIGURED'].includes(r.state)
    ? (r.failure_code && SKIP_REASON[r.failure_code]) || r.failure_reason || null
    : null;
  return {
    channel: r.channel as DeliverySummary['channel'], noticeKind: r.notice_kind, state: r.state,
    stateLabel: deliveryStateLabel(r.state, r.channel),
    at: r.delivered_at ?? r.sent_at ?? r.updated_at ?? r.created_at ?? null, detail,
  };
}

/** Quem abre sem decidir: por que pode ver, e que ver não é decidir. */
export function accessWhy(access: DecisionAccess, open: boolean): Fact[] {
  const text: Record<DecisionAccess, string> = {
    DECIDER: open ? 'A decisão está sob a sua alçada.' : 'A decisão foi encerrada; o que valeu está no histórico.',
    ELIGIBLE: open ? 'Você tem alçada para esta decisão, mas ela é de outra faixa.' : 'A decisão foi encerrada; o que valeu está no histórico.',
    PARTICIPANT: 'Você participa desta decisão (pediu, decidiu ou foi avisado); ela não está sob a sua alçada agora.',
    SOURCE_READER: 'Você lê o módulo de origem; a decisão não está sob a sua alçada.',
    TEAM: 'A decisão está na fila da sua equipe. Ver não dá direito de decidir: o ato exige a alçada de quem clica.',
  };
  return [{ label: 'Seu acesso', value: text[access] }];
}

/**
 * Estado dos canais para a pessoa, dito a partir do MESMO transporte que a
 * entrega usa: o e-mail pelo transporte da plataforma (resend | captura local
 * de QA | nenhum → simulado), desligável pela organização; o WhatsApp só com
 * linha ENABLED e provedor pronto — variável de ambiente não liga canal
 * externo (240 §13).
 */
export function channelStatusList(input: {
  emailIntegration: { status: string; provider: string } | null;
  emailTransport: EmailTransportKind;
  whatsapp: { state: string; provider: string | null };
  prefs: Array<{ channel: string; enabled: boolean; destination: string | null }>;
}): ChannelStatus[] {
  const pref = (c: string) => input.prefs.find((p) => p.channel === c) ?? null;
  const emailOptIn = pref('email')?.enabled !== false;
  const email: ChannelStatus = input.emailIntegration?.status === 'DISABLED'
    ? { channel: 'email', status: 'DISABLED', provider: input.emailIntegration.provider, detail: 'E-mail desligado pela organização.', viewerOptIn: emailOptIn }
    : input.emailTransport === 'resend'
      ? { channel: 'email', status: 'ACTIVE', provider: 'resend', detail: 'Avisos enviados por e-mail.', viewerOptIn: emailOptIn }
      : input.emailTransport === 'capture'
        ? { channel: 'email', status: 'ACTIVE', provider: 'capture',
          detail: 'Captura local de QA: o e-mail vai ao coletor desta máquina, não a destinatários reais.', viewerOptIn: emailOptIn }
        : { channel: 'email', status: 'SIMULATED', provider: null,
          detail: 'Sem provedor de e-mail no servidor: o envio fica registrado como simulado.', viewerOptIn: emailOptIn };
  const waPref = pref('whatsapp');
  const waOptIn = waPref?.enabled === true && !!waPref.destination;
  const p = input.whatsapp.provider;
  const wa: ChannelStatus = (() => {
    switch (input.whatsapp.state) {
      case 'READY': return { channel: 'whatsapp', status: 'ACTIVE', provider: p, detail: `WhatsApp ativo pelo provedor ${p}.`, viewerOptIn: waOptIn };
      case 'DISABLED': return { channel: 'whatsapp', status: 'DISABLED', provider: p, detail: 'WhatsApp desligado pela organização.', viewerOptIn: waOptIn };
      case 'PROVIDER_NOT_IMPLEMENTED': return { channel: 'whatsapp', status: 'NOT_CONFIGURED', provider: p,
        detail: `O provedor ${p} ainda não está implementado nesta versão: nenhuma mensagem sai.`, viewerOptIn: waOptIn };
      case 'PROVIDER_UNAVAILABLE': return { channel: 'whatsapp', status: 'NOT_CONFIGURED', provider: p,
        detail: `O provedor ${p} não está disponível neste ambiente: nenhuma mensagem sai.`, viewerOptIn: waOptIn };
      case 'CREDENTIALS_MISSING': return { channel: 'whatsapp', status: 'NOT_CONFIGURED', provider: p,
        detail: `O provedor ${p} está sem credenciais no servidor: nenhuma mensagem sai.`, viewerOptIn: waOptIn };
      default: return { channel: 'whatsapp', status: 'NOT_CONFIGURED', provider: null, detail: 'WhatsApp não configurado pela organização.', viewerOptIn: waOptIn };
    }
  })();
  return [
    { channel: 'in_app', status: 'ACTIVE', provider: 'in_app', detail: 'Sempre ativo: os avisos chegam ao sino do Apex.', viewerOptIn: null },
    email, wa,
  ];
}

// ---------------------------------------------------------------------------
// Leitura — a caixa
// ---------------------------------------------------------------------------

export async function viewerInbox(session: DecisionsSession): Promise<DecisionInboxRow[]> {
  const { data, error } = await session.supabase.rpc('decision_inbox_for_viewer');
  if (error) throw readError(error, 'Não foi possível ler a sua caixa de decisões.');
  return (data ?? []) as DecisionInboxRow[];
}

/** A linha da caixa DESTA pessoa para uma chave — presente só se ela decide (ou pode decidir) agora. */
export async function viewerInboxRow(session: DecisionsSession, key: string): Promise<DecisionInboxRow | null> {
  const { data, error } = await session.supabase.rpc('decision_inbox_for_viewer').eq('decision_key', key);
  if (error) throw new DecisionsReadError('Não foi possível ler a sua caixa de decisões.');
  return ((data ?? []) as DecisionInboxRow[])[0] ?? null;
}

/** A contagem do badge — só PRIMARY + ESCALATED, calculada pela mesma projeção da caixa. */
export async function decisionsCount(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc('decision_inbox_count_for_viewer');
  if (error) throw new DecisionsReadError('Não foi possível contar as decisões.');
  return Number(data ?? 0) || 0;
}

interface PurchaseCard {
  supplierId: string | null; followsRecommendation: boolean | null; need: string | null;
  requirementProjects: string[]; critical: { reason: string } | null;
}

/**
 * O que o cartão de compra precisa além da linha da caixa: fornecedor,
 * necessidade, requisitos e sinais. Só para os pedidos QUE A CAIXA TROUXE.
 */
async function purchaseOrderCards(org: string, poIds: string[]): Promise<Map<string, PurchaseCard>> {
  const out = new Map<string, PurchaseCard>();
  if (!poIds.length) return out;
  const sb = platformServiceClient();
  // Em lotes (a caixa pode trazer centenas de pedidos, e as linhas e requisitos deles mais ainda — com a lista inteira
  // na URL, 414) e TUDO OU NADA: qualquer leitura que falhe derruba os cartões inteiros (o chamador cai no "contexto de
  // compra indisponível"). Nunca um cartão pela metade — um sinal crítico que não carregou não pode virar "nada crítico".
  const [pos, lines, poSignals] = await Promise.all([
    selectIn<Row>(poIds, (c) => sb.from('purchase_orders').select('id,supplier_id,sourcing_decision_id').eq('organization_id', org).in('id', c)),
    selectIn<Row>(poIds, (c) => sb.from('purchase_order_lines').select('id,purchase_order_id,item_id,quantity,unit_price')
      .eq('organization_id', org).in('purchase_order_id', c)),
    selectIn<Row>(poIds, (c) => sb.from('supply_signals').select('purchase_order_id,title,severity,status').eq('organization_id', org)
      .eq('status', 'OPEN').eq('severity', 'critical').in('purchase_order_id', c)),
  ]);
  const lineIds = lines.map((l) => String(l.id));
  const decisionIds = uniq(pos.map((p) => str(p.sourcing_decision_id)));
  const [itemRows, allocs, decRows] = await Promise.all([
    selectIn<Row>(uniq(lines.map((l) => str(l.item_id))), (c) => sb.from('supply_items').select('id,code,description,unit')
      .eq('organization_id', org).in('id', c)),
    selectIn<Row>(lineIds, (c) => sb.from('purchase_order_line_requirements').select('line_id,requirement_id')
      .eq('organization_id', org).in('line_id', c)),
    selectIn<Row>(decisionIds, (c) => sb.from('sourcing_decisions').select('id,quote_id,recommended_quote_id')
      .eq('organization_id', org).in('id', c)),
  ]);
  const reqIds = uniq(allocs.map((a) => str(a.requirement_id)));
  const [reqRows, reqSignals] = await Promise.all([
    selectIn<Row>(reqIds, (c) => sb.from('project_requirements').select('id,title,priority,status,project_id')
      .eq('organization_id', org).in('id', c)),
    selectIn<Row>(reqIds, (c) => sb.from('supply_signals').select('requirement_id,title,severity,status').eq('organization_id', org)
      .eq('status', 'OPEN').eq('severity', 'critical').in('requirement_id', c)),
  ]);
  const items = new Map(itemRows.map((i) => [String(i.id), i]));
  // "Recomendado" só com a recomendação GRAVADA apontando para a proposta escolhida — não pelo booleano sozinho.
  const follows = new Map(decRows.map((d) => [String(d.id),
    d.recommended_quote_id ? String(d.recommended_quote_id) === String(d.quote_id) : null]));
  const reqs = new Map(reqRows.map((r) => [String(r.id), r]));
  for (const p of pos) {
    const id = String(p.id);
    const mine = lines.filter((l) => l.purchase_order_id === p.id);
    const mineIds = new Set(mine.map((l) => String(l.id)));
    const myReqIds = uniq(allocs.filter((a) => mineIds.has(String(a.line_id))).map((a) => str(a.requirement_id)));
    const myReqs = myReqIds.map((r) => reqs.get(r)).filter((r): r is Row => !!r);
    const f = p.sourcing_decision_id ? follows.get(String(p.sourcing_decision_id)) : undefined;
    out.set(id, {
      supplierId: str(p.supplier_id),
      followsRecommendation: f ?? null,
      need: needSummary(mine.map((l) => {
        const it = items.get(String(l.item_id));
        const q = num(l.quantity) ?? 0;
        return { quantity: q, unit: str(it?.unit), code: str(it?.code), description: str(it?.description), value: q * (num(l.unit_price) ?? 0) };
      })),
      requirementProjects: uniq(myReqs.filter((r) => !['CANCELLED', 'SUPERSEDED'].includes(String(r.status))).map((r) => str(r.project_id))),
      critical: criticalEvidence(
        myReqs.map((r) => ({ title: String(r.title), priority: str(r.priority), status: str(r.status) })),
        [...poSignals.filter((s) => s.purchase_order_id === p.id), ...reqSignals.filter((s) => myReqIds.includes(String(s.requirement_id)))]
          .map((s) => ({ title: String(s.title), severity: String(s.severity), status: String(s.status) })),
      ),
    });
  }
  return out;
}

interface BillingCard { contract: string | null; counterparty: string | null; event: string | null; dueDate: string | null }

async function billingCards(org: string, ids: string[]): Promise<Map<string, BillingCard>> {
  const out = new Map<string, BillingCard>();
  if (!ids.length) return out;
  const sb = platformServiceClient();
  const { data, error } = await sb.from('contract_billing_events').select('id,contract_id,title,due_date').eq('organization_id', org).in('id', ids);
  if (error) throw new Error('faturamento');
  const rows = (data ?? []) as Row[];
  const contractIds = uniq(rows.map((r) => str(r.contract_id)));
  const contracts = contractIds.length
    ? new Map((((await sb.from('contracts').select('id,title,contract_number,counterparty_name').eq('organization_id', org).in('id', contractIds)).data ?? []) as Row[])
      .map((c) => [String(c.id), c]))
    : new Map<string, Row>();
  for (const r of rows) {
    const c = contracts.get(String(r.contract_id));
    out.set(String(r.id), {
      contract: c ? ([str(c.contract_number), str(c.title)].filter(Boolean).join(' · ') || null) : null,
      counterparty: c ? str(c.counterparty_name) : null, event: str(r.title), dueDate: str(r.due_date),
    });
  }
  return out;
}

/**
 * Linhas da caixa → itens de decisão, com nomes, contexto e evidência de
 * criticidade. Falha na leitura AUXILIAR (contexto) não derruba a caixa: a
 * decisão continua na tela, sem as linhas de contexto — nunca com contexto
 * inventado.
 */
export async function enrichInbox(session: DecisionsSession, rows: DecisionInboxRow[], today: string): Promise<DecisionItem[]> {
  if (!rows.length) return [];
  const org = session.organizationId;
  const poIds = uniq(rows.filter((r) => r.subject_type === 'purchase_order').map((r) => r.subject_id));
  const billingIds = uniq(rows.filter((r) => r.subject_type === 'contract_billing_event').map((r) => r.subject_id));
  const [po, billing] = await Promise.all([
    purchaseOrderCards(org, poIds).catch((e) => { console.error('[decisions] contexto de compra indisponível', e); return new Map<string, PurchaseCard>(); }),
    billingCards(org, billingIds).catch((e) => { console.error('[decisions] contexto de faturamento indisponível', e); return new Map<string, BillingCard>(); }),
  ]);
  const cards = Array.from(po.values());
  const book = await nameBook(org, {
    people: rows.flatMap((r) => [r.requested_by, str(r.authority?.declared_by), str(r.authority?.grantee_user_id)]),
    roles: rows.map((r) => str(r.authority?.grantee_role_id)),
    projects: [...rows.map((r) => r.project_id), ...cards.flatMap((c) => c.requirementProjects)],
    suppliers: cards.map((c) => c.supplierId),
  });
  return rows.map((row) => {
    let context: ContextLine[] = [];
    let critical: { reason: string } | null = null;
    const requestedBy = book.person(row.requested_by)?.name ?? null;
    const card = row.subject_type === 'purchase_order' ? po.get(row.subject_id) : undefined;
    if (card) {
      const project = row.project_id ? book.project(row.project_id) ?? row.project_id
        : card.requirementProjects.length > 1 ? 'Vários projetos'
          : card.requirementProjects.length === 1 ? book.project(card.requirementProjects[0]) ?? card.requirementProjects[0] : null;
      context = purchaseOrderContext({ project, supplier: book.supplier(card.supplierId), followsRecommendation: card.followsRecommendation,
        need: card.need, needBy: row.need_by, decideBy: row.decide_by, requestedBy });
      critical = card.critical;
    }
    const bill = row.subject_type === 'contract_billing_event' ? billing.get(row.subject_id) : undefined;
    if (bill) context = billingContext({ ...bill, requestedBy });
    return toDecisionItem({ row, today, person: book.person, role: book.role, projectName: book.project, context, critical });
  });
}

// ---------------------------------------------------------------------------
// Leitura — o espaço de trabalho (Minhas / Equipe / Concluídas)
// ---------------------------------------------------------------------------

const asScope = (v: unknown): TeamScope => (v === 'ORGANIZATION' || v === 'DIRECT_REPORTS' ? v : 'NONE');

async function teamView(session: DecisionsSession, scope: TeamScope, today: string): Promise<NonNullable<DecisionsWorkspace['team']>> {
  if (scope === 'NONE') return { scope, items: [], bottlenecks: [] };
  const { data, error } = await session.supabase.rpc('decision_team_for_viewer');
  if (error) throw new DecisionsReadError('Não foi possível ler as decisões da equipe.');
  const rows = (data ?? []) as DecisionTeamRow[];
  const book = await nameBook(session.organizationId, {
    people: rows.flatMap((r) => [r.requested_by, ...(r.assignees ?? []).map((a) => a.user_id)]),
    projects: rows.map((r) => r.project_id),
  });
  const items = sortTeamItems(rows.map((r) => toTeamItem(r, book, today)));
  return { scope, items, bottlenecks: aggregateBottlenecks(items) };
}

async function completedView(session: DecisionsSession, limit = 200): Promise<CompletedItem[]> {
  const { data, error } = await session.supabase.rpc('decision_history_for_viewer', { p_limit: limit });
  if (error) throw readError(error, 'Não foi possível ler as decisões concluídas.');
  const rows = (data ?? []) as DecisionHistoryRow[];
  const org = session.organizationId;
  const authorityIds = uniq(rows.filter((r) => r.source_kind === 'PROCUREMENT_AUTHORITY').map((r) => str(r.authority?.authority_id)));
  const [authR, book] = await Promise.all([
    authorityIds.length
      ? platformServiceClient().from('procurement_approval_authorities').select('id,source_kind,source_reference,max_amount,currency')
        .eq('organization_id', org).in('id', authorityIds)
      : Promise.resolve({ data: [], error: null }),
    nameBook(org, { people: rows.flatMap((r) => [r.decided_by, r.requested_by]), projects: rows.map((r) => r.project_id) }),
  ]);
  const authorities = new Map(((authR.data ?? []) as Row[]).map((a) => [String(a.id), {
    source_kind: String(a.source_kind), source_reference: String(a.source_reference),
    max_amount: a.max_amount as number | string | null, currency: str(a.currency),
  }]));
  return rows.map((r) => toCompletedItem(r, book, authorities));
}

export async function decisionsWorkspace(session: DecisionsSession, tab: DecisionsTab): Promise<DecisionsWorkspace> {
  const today = todayIso();
  const [rows, scopeR] = await Promise.all([
    viewerInbox(session),
    session.supabase.rpc('decision_team_scope_for_viewer'),
  ]);
  // Falha de leitura é falha — nunca "sem equipe" nem caixa vazia.
  if (scopeR.error) throw readError(scopeR.error, 'Não foi possível ler o escopo de equipe.');
  const teamScope = asScope(scopeR.data);
  const [items, team, completed] = await Promise.all([
    enrichInbox(session, rows, today),
    tab === 'equipe' ? teamView(session, teamScope, today) : Promise.resolve(null),
    tab === 'concluidas' ? completedView(session) : Promise.resolve(null),
  ]);
  const mine = prioritize(items.filter((i) => i.assignment !== 'ELIGIBLE'));
  const alsoEligible = prioritize(items.filter((i) => i.assignment === 'ELIGIBLE'));
  // Caixa VAZIA (sucesso, zero decisões): o contexto que faz o vazio ser lido
  // como o que é — nada pendente —, e não como tela quebrada.
  const empty = tab === 'minhas' && mine.length === 0 && alsoEligible.length === 0;
  const [setup, recent] = empty
    ? await Promise.all([decisionSetup(session.organizationId, today), completedView(session, 5)])
    : [null, null];
  return {
    generatedAt: new Date().toISOString(), today, viewerId: session.user.id, tab, mine, alsoEligible, team, completed,
    counts: { mine: mine.length, overdue: mine.filter((i) => i.overdue).length, alsoEligible: alsoEligible.length },
    categories: categoryCounts([...mine, ...alsoEligible]), teamScope, setup, recent,
  };
}

/** Políticas de aprovação ATIVAS e alçadas de compra VIGENTES na organização (só contagem). */
export async function decisionSetup(org: string, today: string): Promise<{ policies: number; authorities: number }> {
  const service = platformServiceClient();
  const [pol, auth] = await Promise.all([
    service.from('approval_policy_versions').select('id', { count: 'exact', head: true })
      .eq('organization_id', org).eq('status', 'ACTIVE'),
    service.from('procurement_approval_authorities').select('id', { count: 'exact', head: true })
      .eq('organization_id', org).eq('active', true).is('revoked_at', null)
      .or([
        'and(effective_from.is.null,effective_until.is.null)', `and(effective_from.is.null,effective_until.gte.${today})`,
        `and(effective_from.lte.${today},effective_until.is.null)`, `and(effective_from.lte.${today},effective_until.gte.${today})`,
      ].join(',')),
  ]);
  if (pol.error || auth.error) throw new DecisionsReadError('Não foi possível ler a configuração de decisões.');
  return { policies: pol.count ?? 0, authorities: auth.count ?? 0 };
}

// ---------------------------------------------------------------------------
// Leitura — uma decisão (resolvida e detalhada)
// ---------------------------------------------------------------------------

/** `decision_resolve` pelo service role, SEMPRE na organização da sessão, com os nomes. */
export async function readResolved(org: string, key: string, openState: DecisionOpenState | null = null): Promise<{ raw: Row; resolved: ResolvedDecision } | null> {
  const { data, error } = await platformServiceClient().rpc('decision_resolve', { p_org: org, p_key: key });
  if (error) throw new DecisionsReadError('Não foi possível ler a decisão.');
  const raw = (data ?? null) as Row | null;
  if (!raw) return null;
  const book = await nameBook(org, { people: [str(raw.requested_by), str(raw.closed_by)] });
  return { raw, resolved: toResolved(raw, book.person, openState) };
}

/**
 * As alçadas ATIVAS da organização abaixo do valor — só para EXPLICAR por que
 * a decisão subiu ("acima da alçada de Compras, até R$ 100.000"). Não decide
 * nada: quem decide é `procurement_authority_for_order`, no banco.
 */
async function insufficientAuthorities(org: string, row: DecisionInboxRow, today: string): Promise<Array<{ label: string; ceiling: number | null; currency: string }>> {
  const amount = num(row.amount);
  if (amount === null) return [];
  const currency = row.currency ?? 'BRL';
  const { data } = await platformServiceClient().from('procurement_approval_authorities')
    .select('id,grantee_kind,grantee_role_id,grantee_user_id,max_amount,currency,project_id,effective_from,effective_until')
    .eq('organization_id', org).eq('active', true).eq('currency', currency).not('max_amount', 'is', null).lt('max_amount', amount);
  const rows = ((data ?? []) as Row[]).filter((a) => (a.project_id === null || a.project_id === row.project_id)
    && (!a.effective_from || String(a.effective_from) <= today) && (!a.effective_until || String(a.effective_until) >= today));
  if (!rows.length) return [];
  const book = await nameBook(org, { people: rows.map((a) => str(a.grantee_user_id)), roles: rows.map((a) => str(a.grantee_role_id)) });
  const seen = new Set<string>();
  return rows.map((a) => ({
    label: a.grantee_kind === 'USER' ? book.person(str(a.grantee_user_id))?.name ?? 'pessoa sem nome no diretório'
      : book.role(str(a.grantee_role_id)) ?? 'papel sem nome',
    ceiling: num(a.max_amount), currency,
  })).filter((x) => { const k = `${x.label}|${x.ceiling}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.ceiling ?? 0) - (b.ceiling ?? 0));
}

const ENGINE_DECISION_LABEL: Record<string, string> = {
  APPROVED: 'Aprovação registrada', REJECTED: 'Rejeição registrada', RETURNED_FOR_CORRECTION: 'Ajuste solicitado',
};

/** O que o motor registrou: o pedido (quando o objeto não tem histórico próprio) e cada decisão de etapa. */
export function engineHistory(raw: Row, decisions: Row[], person: (id: string | null) => PersonRef | null): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  if (raw.subject_type !== 'purchase_order' && raw.requested_at) {
    out.push({ at: String(raw.requested_at), label: 'Aprovação solicitada ao motor', actor: person(str(raw.requested_by)), detail: str(raw.request_note) });
  }
  for (const d of decisions) {
    out.push({
      at: String(d.decided_at), label: `${ENGINE_DECISION_LABEL[String(d.decision)] ?? String(d.decision)} — estágio ${String(d.stage_no)} (${String(d.step_key)})`,
      actor: person(str(d.actor_user_id)), detail: str(d.reason),
    });
  }
  return out;
}

/**
 * O detalhe. `null` = a decisão não existe PARA ESTA PESSOA — a mesma resposta
 * para "não existe" e "é de outro inquilino" (a chave só é resolvida dentro da
 * organização ativa, por `decision_access_for_viewer`).
 */
export async function decisionDetail(session: DecisionsSession, key: string): Promise<DecisionDetail | null> {
  const org = session.organizationId; const viewer = session.user.id; const today = todayIso();
  const { data: accessData, error: accessError } = await session.supabase.rpc('decision_access_for_viewer', { p_key: key });
  if (accessError) throw new DecisionsReadError('Não foi possível verificar o acesso à decisão.');
  const access = (accessData ?? null) as DecisionAccess | null;
  if (!access) return null;

  const svc = platformServiceClient();
  const [rawR, row, asgR, delR] = await Promise.all([
    svc.rpc('decision_resolve', { p_org: org, p_key: key }),
    viewerInboxRow(session, key),
    svc.rpc('decision_assignees', { p_org: org, p_key: key }),
    // RLS devolve à pessoa o que é dela (e, a quem administra canais, o da organização): o filtro deixa só o dela.
    session.supabase.from('decision_deliveries')
      .select('channel,notice_kind,state,sent_at,delivered_at,updated_at,created_at,failure_code,failure_reason')
      .eq('organization_id', org).eq('decision_key', key).eq('recipient_user_id', viewer).order('created_at', { ascending: true }),
  ]);
  if (rawR.error) throw new DecisionsReadError('Não foi possível ler a decisão.');
  const raw = (rawR.data ?? null) as Row | null;
  if (!raw) return null;
  const subjectType = String(raw.subject_type); const subjectId = String(raw.subject_id);
  const assignees = (asgR.data ?? []) as Array<{ user_id: string; assignment: DecisionAssignment }>;
  const others = uniq(assignees.map((a) => a.user_id)).filter((id) => id !== viewer);
  const namesAllowed = access === 'DECIDER' || access === 'ELIGIBLE' || access === 'TEAM';
  /*
    Equipe (TEAM) é quem NÃO lê a origem (o portão testa leitura antes da
    equipe): vê quem tem a decisão, há quanto tempo e até quando — nunca o
    valor, as propostas, o histórico ou as justificativas que a Equipe lista
    já esconde ("Restrito").
  */
  const restricted = access === 'TEAM';
  const requestId = raw.source_kind === 'APPROVAL_ENGINE' && !restricted ? str(raw.request_id) : null;
  const revealBilling = async (eventId: string) => {
    const { data } = await session.supabase.rpc('decision_viewer_reads_subject', { p_subject_type: 'contract_billing_event', p_subject_id: eventId });
    return data === true;
  };

  const [items, po, billing, decR, insufficient] = await Promise.all([
    row ? enrichInbox(session, [row], today) : Promise.resolve([] as DecisionItem[]),
    subjectType === 'purchase_order' && !restricted
      ? purchaseOrderDetail(org, subjectId, { today, submission: num(raw.submission), revealBilling }) : Promise.resolve(null),
    subjectType === 'contract_billing_event' && !restricted ? billingEventDetail(org, subjectId) : Promise.resolve(null),
    requestId ? svc.from('approval_decisions').select('id,stage_no,step_key,decision,reason,actor_user_id,decided_at')
      .eq('organization_id', org).eq('request_id', requestId).order('decided_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    row?.source_kind === 'PROCUREMENT_AUTHORITY' ? insufficientAuthorities(org, row, today) : Promise.resolve([]),
  ]);
  const item = items[0] ?? null;
  const decisions = (decR.data ?? []) as Row[];
  const book = await nameBook(org, {
    people: [str(raw.requested_by), str(raw.closed_by), ...(namesAllowed ? others : []), ...decisions.map((d) => str(d.actor_user_id))],
  });
  const openState: DecisionOpenState | null = item?.state ?? (raw.open === true && assignees.length === 0 ? 'SEM_DECISOR' : null);
  const full = toResolved(raw, book.person, openState);
  const resolved = restricted ? { ...full, amount: null, reason: null, requestNote: null, fingerprint: null } : full;
  const canAct = (access === 'DECIDER' || access === 'ELIGIBLE') && !!item && resolved.open;
  const link = sourceLink(subjectType, subjectId, resolved.open);

  return {
    key, access, resolved, item, canAct, amountRestricted: restricted,
    actions: canAct && item ? item.actions : [],
    reasonRequired: canAct && item ? item.reasonRequired : [],
    why: item ? whyFacts(item, FMT, insufficient) : accessWhy(access, resolved.open),
    facts: po?.facts ?? billing?.facts ?? [],
    lines: po?.lines ?? [],
    comparison: po?.comparison ?? null,
    impact: po?.impact ?? [],
    chain: po?.chain ?? billing?.chain ?? [],
    otherDeciders: { count: others.length, people: namesAllowed ? others.map((id) => book.person(id)).filter((p): p is PersonRef => !!p) : [] },
    history: [...(po?.history ?? []), ...engineHistory(raw, decisions, book.person)].sort(byTime),
    notifications: delR.error ? [] : ((delR.data ?? []) as Array<Parameters<typeof deliverySummary>[0]>).map(deliverySummary),
    sourceHref: link.href, sourceLabel: link.label, today,
  };
}

// ---------------------------------------------------------------------------
// Leitura — canais e preferências da pessoa
// ---------------------------------------------------------------------------

export interface ChannelIntegrationView {
  channel: 'email' | 'whatsapp'; status: 'ENABLED' | 'DISABLED'; provider: string; contentLevel: 'MINIMAL' | 'STANDARD';
  reason: string; changedAt: string; changedBy: PersonRef | null;
}
export interface OwnPreferenceView { channel: 'email' | 'whatsapp'; enabled: boolean; destination: string | null; verifiedAt: string | null; updatedAt: string }

/**
 * Canais da organização (todo membro lê: estado de canal não tem segredo) e
 * as preferências da PRÓPRIA pessoa (a RLS só devolve as dela). Lido pelo
 * cliente autenticado — nada aqui precisa do service role.
 */
export async function channelsForViewer(session: DecisionsSession): Promise<{
  channels: ChannelStatus[]; integrations: ChannelIntegrationView[]; preferences: OwnPreferenceView[];
}> {
  const org = session.organizationId;
  const [intR, prefR] = await Promise.all([
    session.supabase.from('notification_channel_integrations').select('channel,status,provider,content_level,reason,changed_by,changed_at')
      .eq('organization_id', org),
    session.supabase.from('user_notification_preferences').select('channel,enabled,destination,verified_at,updated_at')
      .eq('organization_id', org).eq('user_id', session.user.id),
  ]);
  if (intR.error || prefR.error) throw new DecisionsReadError('Não foi possível ler os canais de aviso.');
  const ints = (intR.data ?? []) as Row[]; const prefs = (prefR.data ?? []) as Row[];
  const book = await nameBook(org, { people: ints.map((i) => str(i.changed_by)) });
  const integrations: ChannelIntegrationView[] = ints.map((i) => ({
    channel: i.channel as ChannelIntegrationView['channel'], status: i.status as ChannelIntegrationView['status'], provider: String(i.provider),
    contentLevel: i.content_level as ChannelIntegrationView['contentLevel'], reason: String(i.reason), changedAt: String(i.changed_at),
    changedBy: book.person(str(i.changed_by)),
  }));
  const preferences: OwnPreferenceView[] = prefs.map((p) => ({
    channel: p.channel as OwnPreferenceView['channel'], enabled: Boolean(p.enabled), destination: str(p.destination),
    verifiedAt: str(p.verified_at), updatedAt: String(p.updated_at),
  }));
  const emailRow = integrations.find((i) => i.channel === 'email') ?? null;
  const waRow = ints.find((i) => i.channel === 'whatsapp');
  const whatsapp = resolveWhatsAppChannel(waRow ? { status: String(waRow.status), provider: String(waRow.provider), content_level: str(waRow.content_level) } : null);
  return {
    channels: channelStatusList({ emailIntegration: emailRow, emailTransport: emailTransportKind(), whatsapp, prefs: preferences }),
    integrations, preferences,
  };
}
