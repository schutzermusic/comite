/**
 * DECISÕES — orquestração de avisos. Server-only (service role).
 *
 *   evento de domínio (rota → platform.decisions.notify)
 *   varredura a cada 15 min (platform.decisions.sweep)       → decision_notices_plan
 *   ato em tela / submissão (after(), depois da resposta)       (livro de entrega)
 *                                                               → entrega por canal
 *
 * O que este módulo NÃO faz: decidir, guardar estado de decisão ou escolher
 * destinatário. Quem recebe o quê é do banco (240: decision_assignees +
 * decision_notice_channels + estado do canal + preferência da pessoa); aqui
 * só se ENTREGA o que o livro já planejou, e se registra o resultado.
 *
 * Nada roda dentro da transação do negócio: a decisão existe mesmo que o
 * e-mail ou o WhatsApp falhem. Uma entrega que falha vira retentativa com
 * recuo no próprio livro (decision_delivery_record); a falha de UMA entrega
 * nunca interrompe as outras. Só falha de infraestrutura (banco inalcançável)
 * sobe como RetryableJobError, para o trabalho repetir inteiro.
 *
 * "Uma vez só" não é um "já mandei?" lido antes de enviar: é a chave
 * determinística do livro (replanejar não cria segunda linha), o in-app na
 * mesma transação do registro, e a chave de idempotência repassada ao
 * provedor de e-mail/WhatsApp.
 */
if (typeof window !== 'undefined') {
  throw new Error('decisions/notify.ts não pode ser importado no navegador');
}

import { createHash } from 'node:crypto';
import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPublicAppOrigin } from '@/lib/config/app-url';
import { EmailPermanentError, EmailTransientError, emailTransportKind, sendAppEmail } from '@/lib/notifications/email';
import { resolveWhatsAppChannel, WhatsAppSendError, type WhatsAppChannel, type WhatsAppIntegrationRow } from '@/lib/notifications/whatsapp';
import { RetryableJobError } from '@/lib/platform/jobs/errors';
import { platformServiceClient } from '@/lib/platform/server-client';
import {
  ACTION_NOTICE_KINDS, emailNotice, inAppNotice, whatsAppNotice,
  type NoticeContext, type NoticeKind, type NoticeOutcome,
} from './content';
import { decisionHref, kindLabel, parseDecisionKey } from './model';
import { nameBook, type NameBook } from './names';

export type { NoticeKind, NoticeOutcome } from './content';

export interface NoticeTrigger { key: string; kind: NoticeKind; outcome?: NoticeOutcome | null }

type Env = Record<string, string | undefined>;

/** Cliente e ambiente injetáveis: o trabalho passa o seu, o teste passa um falso. */
export interface NotifyOptions { client?: SupabaseClient; env?: Env }
export interface DeliverOptions extends NotifyOptions { limit?: number; budgetMs?: number }

/** Lote de arrendamento pequeno: o orçamento é conferido entre lotes, e um lote nunca é abandonado no meio. */
const CLAIM_BATCH = 10;
const LEASE_SECONDS = 120;

// ---------------------------------------------------------------------------
// Planejar
// ---------------------------------------------------------------------------

export interface PlanError { key: string; kind: string; code: string; retryable: boolean }
export interface PlanResult { organizationId: string | null; keys: number; planned: number; errors: PlanError[] }

/** Evento de domínio → decisão(ões) e tipo de aviso → linhas do livro (idempotente). */
export async function planForEvent(eventId: string, opts: NotifyOptions = {}): Promise<PlanResult> {
  const sb = opts.client ?? platformServiceClient();
  const { data, error } = await sb.rpc('decision_keys_for_event', { p_event_id: eventId });
  if (error) throw infraFailure('keys_for_event', error);
  const rows = (data ?? []) as Array<{ organization_id: string; decision_key: string; notice_kind: NoticeKind; outcome: NoticeOutcome | null }>;
  const result: PlanResult = { organizationId: rows[0]?.organization_id ?? null, keys: rows.length, planned: 0, errors: [] };
  for (const r of rows) {
    await planOne(sb, r.organization_id, { key: r.decision_key, kind: r.notice_kind, outcome: r.outcome }, result);
  }
  return result;
}

/** Gatilhos vindos de um ato em tela (a chave já é conhecida). */
export async function planTriggers(organizationId: string, triggers: NoticeTrigger[], opts: NotifyOptions = {}): Promise<PlanResult> {
  const sb = opts.client ?? platformServiceClient();
  const result: PlanResult = { organizationId, keys: triggers.length, planned: 0, errors: [] };
  for (const t of triggers) {
    if (!parseDecisionKey(t.key)) { result.errors.push({ key: t.key, kind: t.kind, code: 'INVALID_KEY', retryable: false }); continue; }
    await planOne(sb, organizationId, t, result);
  }
  return result;
}

async function planOne(sb: SupabaseClient, org: string, t: NoticeTrigger, into: PlanResult): Promise<void> {
  const { data, error } = await sb.rpc('decision_notices_plan', {
    p_org: org, p_key: t.key, p_kind: t.kind, p_outcome: t.kind === 'RESOLVED' ? t.outcome ?? null : null,
  });
  if (error) { into.errors.push({ key: t.key, kind: t.kind, code: error.code || 'PLAN_FAILED', retryable: isTransient(error) }); return; }
  into.planned += Number(data ?? 0);
}

/**
 * As decisões ABERTAS de um objeto de origem, com a mesma gramática de chave
 * do banco. Pedido de compra: alçada declarada → submissão vigente; política
 * → estágio corrente do pedido de aprovação ligado a ele. Outras origens do
 * motor: o pedido de aprovação PENDENTE do objeto.
 */
export async function openDecisionKeysForSubject(
  organizationId: string, subjectType: string, subjectId: string, opts: NotifyOptions = {},
): Promise<string[]> {
  const sb = opts.client ?? platformServiceClient();
  if (!/^[0-9a-f-]{36}$/i.test(subjectId)) return [];
  let requests: Array<{ id: string; status: string; current_stage_no: number | null }> = [];
  if (subjectType === 'purchase_order') {
    const { data: po, error } = await sb.from('purchase_orders')
      .select('id, status, approval_governance, approval_request_id')
      .eq('organization_id', organizationId).eq('id', subjectId)
      .maybeSingle<{ id: string; status: string; approval_governance: string | null; approval_request_id: string | null }>();
    if (error) throw infraFailure('subject_read', error);
    if (!po || po.status !== 'APPROVAL_REQUIRED') return [];
    if (po.approval_governance === 'AUTHORITY') {
      const { data: n, error: e } = await sb.rpc('decision_po_submission', { p_org: organizationId, p_po: subjectId });
      if (e) throw infraFailure('po_submission', e);
      return keep([`purchase_order:${subjectId}:s${Number(n ?? 0)}`]);
    }
    if (po.approval_governance !== 'POLICY' || !po.approval_request_id) return [];
    const { data, error: e } = await sb.from('approval_requests').select('id, status, current_stage_no')
      .eq('organization_id', organizationId).eq('id', po.approval_request_id);
    if (e) throw infraFailure('request_read', e);
    requests = (data ?? []) as typeof requests;
  } else {
    const { data, error } = await sb.from('approval_requests').select('id, status, current_stage_no')
      .eq('organization_id', organizationId).eq('subject_type', subjectType).eq('subject_id', subjectId).eq('status', 'PENDING');
    if (error) throw infraFailure('request_read', error);
    requests = (data ?? []) as typeof requests;
  }
  return keep(requests.filter((r) => r.status === 'PENDING' && r.current_stage_no)
    .map((r) => `approval_request:${r.id}:e${r.current_stage_no}`));
}
const keep = (keys: string[]) => keys.filter((k) => parseDecisionKey(k) !== null);

// ---------------------------------------------------------------------------
// Entregar
// ---------------------------------------------------------------------------

export interface DeliveryCounters {
  claimed: number;
  delivered: number;      // in-app (exatamente uma vez, na transação do livro)
  sent: number;           // e-mail/WhatsApp aceito pelo transporte
  simulated: number;      // transporte de e-mail `none`
  not_configured: number;
  skipped: number;
  cancelled: number;
  retried: number;        // FAILED com recuo — volta sozinho
  dead: number;           // DEAD — repetir não conserta
  stale: number;          // arrendamento perdido para outra tentativa
  unrecorded: number;     // o resultado não pôde ser gravado (banco)
  budget_exhausted: boolean;
}

type DeliveryChannel = 'in_app' | 'email' | 'whatsapp';
interface DeliveryRow {
  id: string;
  organization_id: string;
  decision_key: string;
  subject_type: string;
  subject_id: string;
  notice_kind: NoticeKind;
  outcome: NoticeOutcome | null;
  recipient_user_id: string;
  recipient_role: string;
  channel: DeliveryChannel;
  lease_token: string;
  idempotency_key: string;
  attempt_count: number;
}

type RecordResult = 'SENT' | 'DELIVERED' | 'SIMULATED' | 'NOT_CONFIGURED' | 'SKIPPED' | 'CANCELLED' | 'RETRY' | 'FAIL';
/** Estado que o banco devolveu (ou o que aconteceu com o registro). */
type Tally = 'SENT' | 'DELIVERED' | 'SIMULATED' | 'NOT_CONFIGURED' | 'SKIPPED' | 'CANCELLED' | 'FAILED' | 'DEAD' | 'STALE' | 'UNRECORDED';

interface LoadedDecision {
  resolved: Record<string, unknown>;
  open: boolean;
  subjectType: string;
  supplierId: string | null;
  needBy: string | null;
  decideBy: string | null;
  names: NameBook;
}

interface Run {
  sb: SupabaseClient;
  env: Env;
  organizationId: string;
  appOrigin: string;
  decisions: Map<string, Promise<LoadedDecision | null>>;
  emails: Map<string, Promise<{ email: string | null; unavailable: boolean }>>;
  today?: Promise<string>;
  whatsapp?: Promise<WhatsAppChannel>;
}

/**
 * Entrega o que está VENCIDO no livro da organização: arrenda em lotes,
 * carrega o contexto uma vez por decisão, manda por canal e registra.
 * O orçamento para de ARRENDAR; o lote já arrendado é terminado.
 */
export async function deliverDue(organizationId: string, opts: DeliverOptions = {}): Promise<DeliveryCounters> {
  const sb = opts.client ?? platformServiceClient();
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 50)));
  const budgetMs = Math.max(0, opts.budgetMs ?? 20_000);
  const started = Date.now();
  const run: Run = {
    sb, env: opts.env ?? process.env, organizationId, appOrigin: getPublicAppOrigin(),
    decisions: new Map(), emails: new Map(),
  };
  const c: DeliveryCounters = {
    claimed: 0, delivered: 0, sent: 0, simulated: 0, not_configured: 0, skipped: 0, cancelled: 0,
    retried: 0, dead: 0, stale: 0, unrecorded: 0, budget_exhausted: false,
  };

  while (c.claimed < limit) {
    if (Date.now() - started >= budgetMs) { c.budget_exhausted = true; break; }
    const batch = Math.min(CLAIM_BATCH, limit - c.claimed);
    const { data, error } = await sb.rpc('decision_deliveries_claim', {
      p_org: organizationId, p_limit: batch, p_lease_seconds: LEASE_SECONDS,
    });
    if (error) throw infraFailure('claim', error);
    const rows = (data ?? []) as DeliveryRow[];
    c.claimed += rows.length;
    for (const row of rows) tally(c, await deliverOne(run, row));
    if (rows.length < batch) break;
  }

  if (c.unrecorded > 0) {
    // O arrendamento vence e a varredura retoma; o trabalho repete para não
    // declarar como concluído o que não ficou escrito.
    throw new RetryableJobError('decisions_delivery_unrecorded',
      `${c.unrecorded} entrega(s) sem resultado gravado no livro de avisos.`);
  }
  return c;
}

function tally(c: DeliveryCounters, t: Tally): void {
  switch (t) {
    case 'DELIVERED': c.delivered += 1; break;
    case 'SENT': c.sent += 1; break;
    case 'SIMULATED': c.simulated += 1; break;
    case 'NOT_CONFIGURED': c.not_configured += 1; break;
    case 'SKIPPED': c.skipped += 1; break;
    case 'CANCELLED': c.cancelled += 1; break;
    case 'FAILED': c.retried += 1; break;
    case 'DEAD': c.dead += 1; break;
    case 'STALE': c.stale += 1; break;
    case 'UNRECORDED': c.unrecorded += 1; break;
  }
}

async function deliverOne(run: Run, row: DeliveryRow): Promise<Tally> {
  try {
    const decision = await loadDecision(run, row.decision_key);
    if (!decision) {
      return record(run, row, 'CANCELLED', { code: 'DECISION_NOT_FOUND', reason: 'A decisão não existe mais na origem.' });
    }
    // "Decisão necessária" depois da decisão tomada é o spam que o livro existe para impedir.
    if (ACTION_NOTICE_KINDS.has(row.notice_kind) && !decision.open) {
      return record(run, row, 'CANCELLED', { code: 'DECISION_CLOSED', reason: 'A decisão foi encerrada antes do envio.' });
    }
    const ctx = await noticeContext(run, decision, row);
    if (row.channel === 'in_app') return await deliverInApp(run, row, ctx);
    if (row.channel === 'email') return await deliverEmail(run, row, ctx);
    if (row.channel === 'whatsapp') return await deliverWhatsApp(run, row, ctx);
    return record(run, row, 'FAIL', { code: 'UNKNOWN_CHANNEL' });
  } catch (error) {
    // Falha de UMA entrega (contexto, diretório, canal): retentativa com recuo; as outras seguem.
    const code = codeOf(error) ?? 'DELIVERY_ERROR';
    console.warn('[decisions/notify] entrega falhou', { delivery: row.id, channel: row.channel, code });
    return record(run, row, 'RETRY', { code, reason: 'Falha ao preparar ou entregar o aviso; nova tentativa com recuo.' });
  }
}

async function record(run: Run, row: DeliveryRow, result: RecordResult, extra: {
  provider?: string | null; messageId?: string | null; code?: string | null; reason?: string | null; hint?: string | null;
} = {}): Promise<Tally> {
  try {
    const { data, error } = await run.sb.rpc('decision_delivery_record', {
      p_id: row.id, p_lease: row.lease_token, p_result: result,
      p_provider: extra.provider ?? null, p_message_id: extra.messageId ?? null,
      p_code: extra.code ? extra.code.slice(0, 120) : null,
      p_reason: extra.reason ? extra.reason.slice(0, 1000) : null,
      p_destination_hint: extra.hint ?? null,
    });
    if (error) throw error;
    return stateTally(data);
  } catch {
    console.warn('[decisions/notify] resultado da entrega não gravado', { delivery: row.id, result });
    return 'UNRECORDED';
  }
}

function stateTally(state: unknown): Tally {
  switch (state) {
    case 'SENT': case 'DELIVERED': case 'SIMULATED': case 'NOT_CONFIGURED': case 'SKIPPED': case 'CANCELLED':
    case 'FAILED': case 'DEAD':
      return state;
    default: return 'STALE'; // STALE | NOT_FOUND: outra tentativa é dona da linha
  }
}

// --- canais ----------------------------------------------------------------

async function deliverInApp(run: Run, row: DeliveryRow, ctx: NoticeContext): Promise<Tally> {
  const n = inAppNotice(ctx);
  const { data, error } = await run.sb.rpc('decision_delivery_in_app', {
    p_id: row.id, p_lease: row.lease_token, p_title: n.title, p_body: n.body, p_link: n.link,
  });
  if (error) throw tagged('IN_APP_FAILED', error);
  return stateTally(data);
}

/**
 * Reconferido NA HORA DO ENVIO, não só no planejamento: a linha pode esperar
 * na fila (varredura, recuo) enquanto a pessoa sai da organização, desliga o
 * e-mail para si ou a organização desliga o canal. Nesses casos nada sai.
 */
async function externalGate(run: Run, row: DeliveryRow, channel: 'email' | 'whatsapp'): Promise<Tally | null> {
  const { data: member, error: mErr } = await run.sb.from('organization_memberships').select('status')
    .eq('organization_id', run.organizationId).eq('user_id', row.recipient_user_id).maybeSingle<{ status: string }>();
  if (mErr) throw tagged('MEMBERSHIP_UNAVAILABLE', mErr);
  if (member?.status !== 'ACTIVE') {
    return record(run, row, 'SKIPPED', { code: 'RECIPIENT_INACTIVE', reason: 'O destinatário não é mais membro ativo da organização.' });
  }
  if (channel !== 'email') return null;
  const [{ data: integ, error: iErr }, { data: pref, error: pErr }] = await Promise.all([
    run.sb.from('notification_channel_integrations').select('status')
      .eq('organization_id', run.organizationId).eq('channel', 'email').maybeSingle<{ status: string }>(),
    run.sb.from('user_notification_preferences').select('enabled')
      .eq('organization_id', run.organizationId).eq('user_id', row.recipient_user_id).eq('channel', 'email').maybeSingle<{ enabled: boolean }>(),
  ]);
  if (iErr || pErr) throw tagged('PREFERENCE_UNAVAILABLE', (iErr ?? pErr) as { message?: string; code?: string });
  if (integ?.status === 'DISABLED') return record(run, row, 'SKIPPED', { code: 'CHANNEL_DISABLED', reason: 'O e-mail foi desligado na organização.' });
  if (pref?.enabled === false) return record(run, row, 'SKIPPED', { code: 'USER_OPTED_OUT', reason: 'A pessoa desligou o e-mail para si.' });
  return null;
}

async function deliverEmail(run: Run, row: DeliveryRow, ctx: NoticeContext): Promise<Tally> {
  const gate = await externalGate(run, row, 'email');
  if (gate) return gate;
  const address = await emailOf(run, row.recipient_user_id);
  if (address.unavailable) return record(run, row, 'RETRY', { code: 'DIRECTORY_UNAVAILABLE', reason: 'Diretório de usuários indisponível.' });
  if (!address.email) return record(run, row, 'FAIL', { code: 'NO_EMAIL', reason: 'O destinatário não tem e-mail utilizável.' });
  const hint = maskEmail(address.email);
  const provider = emailTransportKind(run.env);
  const mail = emailNotice(ctx);
  try {
    const sent = await sendAppEmail(
      { to: address.email, subject: mail.subject, html: mail.html, text: mail.text },
      { idempotencyKey: providerKey(row), organizationId: run.organizationId, related: { type: row.subject_type, id: row.subject_id } },
      run.env,
    );
    return record(run, row, sent.outcome, { provider: sent.provider, messageId: sent.messageId, hint });
  } catch (error) {
    if (error instanceof EmailPermanentError) return record(run, row, 'FAIL', { provider, code: error.code, reason: error.message, hint });
    if (error instanceof EmailTransientError) return record(run, row, 'RETRY', { provider, code: error.code, reason: error.message, hint });
    return record(run, row, 'RETRY', { provider, code: 'EMAIL_UNEXPECTED', reason: 'Falha inesperada no envio do e-mail.', hint });
  }
}

async function deliverWhatsApp(run: Run, row: DeliveryRow, ctx: NoticeContext): Promise<Tally> {
  const channel = await whatsAppChannel(run);
  if (channel.state !== 'READY' || !channel.adapter) {
    return record(run, row, 'NOT_CONFIGURED', {
      provider: channel.provider, code: channel.state,
      reason: channel.state === 'CREDENTIALS_MISSING' && channel.missing.length
        ? `Credenciais ausentes: ${channel.missing.join(', ')}.` : 'O canal WhatsApp não está pronto nesta organização.',
    });
  }
  const gate = await externalGate(run, row, 'whatsapp');
  if (gate) return gate;
  const { data: pref, error } = await run.sb.from('user_notification_preferences')
    .select('enabled, destination')
    .eq('organization_id', run.organizationId).eq('user_id', row.recipient_user_id)
    .eq('channel', 'whatsapp').eq('enabled', true)
    .maybeSingle<{ enabled: boolean; destination: string | null }>();
  if (error) throw tagged('PREFERENCE_UNAVAILABLE', error);
  if (!pref?.destination) {
    return record(run, row, 'SKIPPED', { provider: channel.provider, code: 'NO_OPT_IN', reason: 'A pessoa não ativou o WhatsApp com um número.' });
  }
  const hint = maskPhone(pref.destination);
  try {
    const sent = await channel.adapter.send(
      { to: pref.destination, body: whatsAppNotice(ctx, channel.contentLevel) },
      { idempotencyKey: providerKey(row) },
    );
    return record(run, row, 'SENT', { provider: channel.provider, messageId: sent.messageId, hint });
  } catch (error) {
    if (error instanceof WhatsAppSendError && !error.retryable) {
      return record(run, row, 'FAIL', { provider: channel.provider, code: error.code, reason: error.message, hint });
    }
    return record(run, row, 'RETRY', { provider: channel.provider, code: codeOf(error) ?? 'PROVIDER_ERROR', reason: 'O provedor de WhatsApp falhou.', hint });
  }
}

// --- contexto --------------------------------------------------------------

function loadDecision(run: Run, key: string): Promise<LoadedDecision | null> {
  let p = run.decisions.get(key);
  if (!p) { p = readDecision(run, key); run.decisions.set(key, p); }
  return p;
}

async function readDecision(run: Run, key: string): Promise<LoadedDecision | null> {
  const org = run.organizationId;
  const { data, error } = await run.sb.rpc('decision_resolve', { p_org: org, p_key: key });
  if (error) throw tagged('CONTEXT_UNAVAILABLE', error);
  const r = (data ?? null) as Record<string, unknown> | null;
  if (!r) return null;
  const subjectType = String(r.subject_type ?? '');
  const subjectId = str(r.subject_id);
  let supplierId = str(r.supplier_id);
  let needBy: string | null = null;
  let decideBy: string | null = null;
  if (subjectType === 'purchase_order' && subjectId) {
    // Pela alçada o resolve já traz o fornecedor; pelo motor, o pedido de compra é relido (na organização).
    if (!supplierId) {
      const { data: po } = await run.sb.from('purchase_orders').select('supplier_id')
        .eq('organization_id', org).eq('id', subjectId).maybeSingle<{ supplier_id: string | null }>();
      supplierId = po?.supplier_id ?? null;
    }
    // Prazo operacional derivado (240). Sem ele, a mensagem simplesmente não fala de prazo.
    const { data: t } = await run.sb.rpc('decision_po_timing', { p_org: org, p_po: subjectId });
    const timing = (Array.isArray(t) ? t[0] : t) as { need_by?: string | null; decide_by?: string | null } | null | undefined;
    needBy = str(timing?.need_by)?.slice(0, 10) ?? null;
    decideBy = str(timing?.decide_by)?.slice(0, 10) ?? null;
  }
  // Pelo motor, o prazo de decidir é também a expiração do pedido: vale o que vier antes
  // (a mesma régua de model.effectiveDeadline).
  const dueAt = str(r.due_at)?.slice(0, 10) ?? null;
  if (dueAt && (!decideBy || dueAt < decideBy)) decideBy = dueAt;
  const names = await nameBook(org, {
    people: [str(r.requested_by), str(r.closed_by)],
    projects: [str(r.project_id)],
    suppliers: [supplierId],
  });
  return { resolved: r, open: r.open === true, subjectType, supplierId, needBy, decideBy, names };
}

async function noticeContext(run: Run, d: LoadedDecision, row: DeliveryRow): Promise<NoticeContext> {
  const r = d.resolved;
  const label = kindLabel(d.subjectType || row.subject_type);
  return {
    kind: row.notice_kind,
    outcome: row.outcome,
    title: str(r.title) ?? label,
    kindLabel: label,
    amount: num(r.amount),
    currency: str(r.currency),
    projectName: d.names.project(str(r.project_id)),
    supplierName: d.names.supplier(d.supplierId),
    needBy: d.needBy,
    decideBy: d.decideBy,
    today: await todayOf(run),
    // Justificativa só nos avisos de desfecho; aviso de ação não carrega texto de terceiros.
    reason: ACTION_NOTICE_KINDS.has(row.notice_kind) ? null : str(r.reason),
    deciderName: d.names.person(str(r.closed_by))?.name ?? null,
    requesterName: d.names.person(str(r.requested_by))?.name ?? null,
    link: decisionHref(row.decision_key),
    appOrigin: run.appOrigin,
  };
}

/** "Hoje" no fuso da organização — a mesma régua do banco (decision_today). */
function todayOf(run: Run): Promise<string> {
  if (!run.today) {
    run.today = (async () => {
      const { data, error } = await run.sb.rpc('decision_today', { p_org: run.organizationId });
      const d = !error && typeof data === 'string' ? data.slice(0, 10) : null;
      return d ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
    })();
  }
  return run.today;
}

/** O e-mail mora em auth.users, não em profiles: lido pelo service role, um por pessoa, nunca registrado em log. */
function emailOf(run: Run, userId: string): Promise<{ email: string | null; unavailable: boolean }> {
  let p = run.emails.get(userId);
  if (!p) {
    p = (async () => {
      const { data, error } = await run.sb.auth.admin.getUserById(userId);
      if (error) {
        const status = (error as { status?: number }).status;
        return status === 404 ? { email: null, unavailable: false } : { email: null, unavailable: true };
      }
      const email = data.user?.email ?? null;
      return { email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null, unavailable: false };
    })();
    run.emails.set(userId, p);
  }
  return p;
}

function whatsAppChannel(run: Run): Promise<WhatsAppChannel> {
  if (!run.whatsapp) {
    run.whatsapp = (async () => {
      const { data, error } = await run.sb.from('notification_channel_integrations')
        .select('status, provider, content_level')
        .eq('organization_id', run.organizationId).eq('channel', 'whatsapp')
        .maybeSingle<WhatsAppIntegrationRow>();
      if (error) throw tagged('CHANNEL_UNAVAILABLE', error);
      return resolveWhatsAppChannel(data ?? null, run.env);
    })();
  }
  return run.whatsapp;
}

// --- utilitários -----------------------------------------------------------

/**
 * Chave de idempotência do PROVEDOR: estável por linha do livro (não por
 * tentativa), curta e sem o formato da chave interna. SHA-256 da chave do
 * livro com a organização.
 */
export function providerKey(row: Pick<DeliveryRow, 'organization_id' | 'idempotency_key'>): string {
  return `apex-dd-${createHash('sha256').update(`${row.organization_id}|${row.idempotency_key}`).digest('hex')}`;
}

/** "fulano@apex-qa.test" → "f***@apex-qa.test". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/** "+5511987654321" → "+55*******4321". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.length < 8) return '***';
  return `${digits.slice(0, 3)}${'*'.repeat(Math.max(3, digits.length - 7))}${digits.slice(-4)}`;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function codeOf(error: unknown): string | null {
  const c = (error as { code?: unknown } | null)?.code;
  return typeof c === 'string' && c ? c : null;
}

function tagged(code: string, error: { code?: string; message?: string }): Error {
  const e = new Error(`${code}: ${error.message ?? 'erro no banco'}`) as Error & { code: string };
  e.code = error.code ? `${code}:${error.code}` : code;
  return e;
}

/**
 * Transitório = a requisição não chegou ao banco ou o banco está sem
 * conexão. PostgREST sempre traz código para erro de SQL; sem código é rede.
 */
function isTransient(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? '';
  if (!code) return true;
  if (/^PGRST00[0-3]$/.test(code) || /^08/.test(code)) return true;
  if (['40001', '40P01', '53300', '55P03', '57P03'].includes(code)) return true;
  return /fetch failed|network|timeout|timed out|econn|socket hang up/i.test(error.message ?? '');
}

/** Falha de infraestrutura: repetível sobe como RetryableJobError; determinística preserva o código (terminal). */
function infraFailure(where: string, error: { code?: string; message?: string }): Error {
  if (isTransient(error)) return new RetryableJobError(`decisions_${where}_unavailable`, `Banco indisponível em ${where}.`);
  const e = new Error(`Decisões (${where}): ${error.message ?? 'erro no banco'}`) as Error & { code?: string };
  e.code = error.code;
  return e;
}

// ---------------------------------------------------------------------------
// Varredura
// ---------------------------------------------------------------------------

/** Manutenção do livro + replanejamento pelo ESTADO (240) e então a entrega. */
export async function sweepOrganization(organizationId: string, opts: DeliverOptions = {}): Promise<Record<string, unknown>> {
  const sb = opts.client ?? platformServiceClient();
  const { data, error } = await sb.rpc('decision_sweep_plan', { p_org: organizationId });
  if (error) throw infraFailure('sweep_plan', error);
  const delivery = await deliverDue(organizationId, { ...opts, client: sb });
  return { plan: (data ?? {}) as Record<string, unknown>, delivery };
}

// ---------------------------------------------------------------------------
// Depois da resposta
// ---------------------------------------------------------------------------

/** Lote curto: isto roda depois da resposta, e a varredura garante o resto. */
const IMMEDIATE = { limit: 20, budgetMs: 15_000 } as const;

/**
 * Depois da resposta (next/server `after`): planeja os avisos e tenta a
 * entrega imediata. Falha é registrada, nunca propagada — a varredura repete.
 */
export function scheduleDecisionNotify(organizationId: string, triggers: NoticeTrigger[]): void {
  if (!organizationId || !triggers?.length) return;
  const keys = triggers.map((t) => t.key);
  runAfterResponse({ organizationId, keys }, async () => {
    await planTriggers(organizationId, triggers);
    await deliverDue(organizationId, IMMEDIATE);
  });
}

/** Idem, a partir do objeto de origem (ex.: pedido de compra recém-submetido). */
export function scheduleSubjectNotify(organizationId: string, subjectType: string, subjectId: string): void {
  if (!organizationId || !subjectType || !subjectId) return;
  runAfterResponse({ organizationId, subjectType, subjectId }, async () => {
    const keys = await openDecisionKeysForSubject(organizationId, subjectType, subjectId);
    if (keys.length) await planTriggers(organizationId, keys.map((key) => ({ key, kind: 'NEW' as const })));
    await deliverDue(organizationId, IMMEDIATE);
  });
}

/**
 * `after()` é despertador, não garantia (mesmo contrato de jobs/fast-path.ts).
 * Fora de um pedido (script, teste, trabalhador) ele lança; aí a tarefa roda
 * solta, com a mesma rede de proteção. Log só com identificadores.
 */
function runAfterResponse(ids: Record<string, unknown>, task: () => Promise<void>): void {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.warn('[decisions/notify] aviso imediato falhou; a varredura repete', {
        ...ids, code: codeOf(error) ?? (error instanceof Error ? error.name : 'erro'),
      });
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
