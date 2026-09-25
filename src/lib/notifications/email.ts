/**
 * E-MAIL DA PLATAFORMA — o transporte compartilhado. Server-only.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * Até aqui cada módulo que manda e-mail importava o SDK do Resend por conta
 * própria (agenda, folha, ASO, medições, faturamento, ponto): seis remetentes,
 * seis jeitos de falhar e nenhum com chave de idempotência — um envio que o
 * processo não chegou a registrar virava segundo e-mail na retentativa. Este é
 * o primeiro módulo compartilhado. Os seis continuam como estão (dívida
 * registrada); o que nasce depois dele, Decisões primeiro, passa por aqui.
 *
 * ─── Três transportes, escolhidos pelo AMBIENTE, nunca pelo chamador ────
 *
 *   resend    o provedor real (RESEND_API_KEY). A chave de idempotência vai
 *             no cabeçalho `Idempotency-Key`: o provedor devolve o mesmo envio
 *             em vez de mandar outro.
 *   capture   o coletor LOCAL de QA (Mailpit da pilha isolada). Só fala com
 *             esta máquina — o mesmo guarda de scripts/qa/lib/qa-env.mjs.
 *   none      nada sai. O resultado é SIMULATED, e diz isso: simulado não é
 *             enviado, e a tela não pode confundir um com o outro.
 *
 * Cada tentativa fica em `email_dispatches` (sent | simulated | failed). A
 * auditoria que falha não desfaz o envio que aconteceu — e nunca é motivo de
 * reenviar. Endereço e conteúdo não vão para log.
 */
if (typeof window !== 'undefined') {
  throw new Error('notifications/email.ts não pode ser importado no navegador');
}

import type { CreateEmailResponse } from 'resend';
import { platformServiceClient } from '@/lib/platform/server-client';

export type EmailTransportKind = 'resend' | 'capture' | 'none';
type Env = Record<string, string | undefined>;

export const DEFAULT_EMAIL_FROM = 'INSIGHT APEX <no-reply@insightapex.co>';

/** Falha que melhora repetindo: rede, 429, 5xx, envio concorrente com a mesma chave. */
export class EmailTransientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmailTransientError';
    this.code = code;
  }
}

/** Falha que repetir não conserta: endereço inválido, remetente recusado, configuração ausente. */
export class EmailPermanentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmailPermanentError';
    this.code = code;
  }
}

/** Anexo textual gerado pelo servidor (ex.: o .ics do convite). */
export interface AppEmailAttachment { filename: string; content: string; contentType: string }
export interface AppEmailMessage { to: string; subject: string; html: string; text: string; attachments?: AppEmailAttachment[] }
export interface AppEmailOptions {
  /** Estável por AVISO, não por tentativa: é ela que impede o segundo e-mail. */
  idempotencyKey: string;
  organizationId: string;
  related?: { type: string; id: string | null };
}
export interface AppEmailResult { outcome: 'SENT' | 'SIMULATED'; provider: string; messageId: string | null }

const TRANSPORTS = new Set<EmailTransportKind>(['resend', 'capture', 'none']);

/**
 * APEX_EMAIL_TRANSPORT explícito manda; sem ele, a chave do Resend decide.
 * Valor desconhecido fecha em `none`: um erro de digitação não pode virar
 * envio real para um transporte que ninguém declarou.
 */
export function emailTransportKind(env: Env = process.env): EmailTransportKind {
  const explicit = (env.APEX_EMAIL_TRANSPORT ?? '').trim().toLowerCase();
  if (explicit) return TRANSPORTS.has(explicit as EmailTransportKind) ? (explicit as EmailTransportKind) : 'none';
  return env.RESEND_API_KEY?.trim() ? 'resend' : 'none';
}

export function emailSender(env: Env = process.env): string {
  return env.APP_EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** O endpoint de envio do coletor — só se ele morar nesta máquina. */
export function captureEndpoint(env: Env = process.env): URL {
  const raw = env.EMAIL_CAPTURE_URL?.trim();
  if (!raw) throw new EmailPermanentError('capture_not_configured', 'EMAIL_CAPTURE_URL ausente: a captura não tem para onde mandar.');
  let base: URL;
  try { base = new URL(raw); } catch {
    throw new EmailPermanentError('capture_invalid_url', 'EMAIL_CAPTURE_URL não é um endereço válido.');
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new EmailPermanentError('capture_invalid_url', 'EMAIL_CAPTURE_URL precisa ser http(s).');
  }
  if (!LOCAL_HOSTS.has(base.hostname)) {
    throw new EmailPermanentError('capture_not_local',
      `[QA GUARD] EMAIL_CAPTURE_URL aponta para "${base.hostname}". A captura de e-mail só fala com esta máquina.`);
  }
  return new URL('/api/v1/send', base);
}

/**
 * Classifica a recusa do Resend (SDK 6: `{ name, statusCode, message }`,
 * statusCode null = a requisição nem chegou). A mensagem do provedor NÃO é
 * copiada: ela pode ecoar o endereço do destinatário.
 */
export function classifyResendError(error: { name?: string | null; statusCode?: number | null }): EmailTransientError | EmailPermanentError {
  const status = typeof error.statusCode === 'number' ? error.statusCode : null;
  const name = String(error.name ?? 'application_error');
  const message = `O Resend recusou o envio (${name}${status ? `, HTTP ${status}` : ''}).`;
  if (status === null || status === 429 || status >= 500 || TRANSIENT_RESEND.has(name)) {
    return new EmailTransientError(name, message);
  }
  return new EmailPermanentError(name, message);
}
const TRANSIENT_RESEND = new Set(['rate_limit_exceeded', 'concurrent_idempotent_requests', 'internal_server_error']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Envia UM e-mail pelo transporte do ambiente e registra a tentativa.
 * Devolve SENT (o transporte aceitou) ou SIMULATED (nada saiu); falha sobe
 * como EmailTransientError ou EmailPermanentError — quem chama decide se
 * repete, este módulo não guarda estado de entrega.
 */
export async function sendAppEmail(msg: AppEmailMessage, opts: AppEmailOptions, env: Env = process.env): Promise<AppEmailResult> {
  const kind = emailTransportKind(env);
  try {
    if (!ADDRESS.test(msg.to ?? '')) throw new EmailPermanentError('invalid_recipient', 'Endereço de destinatário inválido.');
    const key = (opts.idempotencyKey ?? '').trim();
    if (!key || key.length > 256) {
      throw new EmailPermanentError('invalid_idempotency_key', 'Chave de idempotência ausente ou maior que 256 caracteres.');
    }
    const result: AppEmailResult = kind === 'none'
      ? { outcome: 'SIMULATED', provider: 'none', messageId: null }
      : kind === 'capture' ? await sendViaCapture(msg, key, env) : await sendViaResend(msg, key, env);
    await recordDispatch(msg, opts, result.outcome === 'SENT' ? 'sent' : 'simulated', result.provider, result.messageId, null);
    return result;
  } catch (error) {
    const failure = error instanceof EmailTransientError || error instanceof EmailPermanentError
      ? error
      // Exceção fora do contrato do SDK: a chave de idempotência torna a repetição segura.
      : new EmailTransientError('email_unexpected', 'Falha inesperada no transporte de e-mail.');
    await recordDispatch(msg, opts, 'failed', kind, null, `${failure.code}: ${failure.message}`);
    throw failure;
  }
}

async function sendViaResend(msg: AppEmailMessage, idempotencyKey: string, env: Env): Promise<AppEmailResult> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new EmailPermanentError('missing_api_key', 'Transporte resend sem RESEND_API_KEY.');
  const { Resend } = await import('resend');
  let response: CreateEmailResponse;
  try {
    response = await new Resend(apiKey).emails.send(
      { from: emailSender(env), to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
        attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: base64(a.content), contentType: a.contentType })) },
      { idempotencyKey },
    );
  } catch {
    // O SDK devolve erro de rede como `{ error }`; exceção aqui é defeito fora do contrato.
    throw new EmailTransientError('resend_unreachable', 'O SDK do Resend falhou antes de responder.');
  }
  if (response.error) throw classifyResendError(response.error);
  return { outcome: 'SENT', provider: 'resend', messageId: response.data?.id ?? null };
}

/**
 * Mailpit: POST /api/v1/send {From, To, Subject, HTML, Text, Headers} → {ID}.
 * O coletor não deduplica; a chave vai num cabeçalho para o teste achar a
 * mensagem, e quem garante "uma vez" é o livro de entrega de quem chama.
 */
async function sendViaCapture(msg: AppEmailMessage, idempotencyKey: string, env: Env): Promise<AppEmailResult> {
  const endpoint = captureEndpoint(env);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: mailbox(emailSender(env)),
        To: [{ Email: msg.to }],
        Subject: msg.subject,
        HTML: msg.html,
        Text: msg.text,
        Headers: { 'X-Apex-Idempotency-Key': idempotencyKey },
        Tags: ['apex'],
        ...(msg.attachments?.length
          ? { Attachments: msg.attachments.map((a) => ({ Filename: a.filename, Content: base64(a.content), ContentType: a.contentType })) }
          : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new EmailTransientError('capture_unreachable', 'O coletor local de e-mail não respondeu.');
  }
  if (!res.ok) {
    const code = `capture_http_${res.status}`;
    if (res.status === 429 || res.status >= 500) throw new EmailTransientError(code, 'O coletor local de e-mail falhou.');
    throw new EmailPermanentError(code, 'O coletor local de e-mail recusou a mensagem.');
  }
  const body = (await res.json().catch(() => null)) as { ID?: unknown } | null;
  return { outcome: 'SENT', provider: 'capture', messageId: typeof body?.ID === 'string' ? body.ID : null };
}

const base64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64');

/** "INSIGHT APEX <no-reply@insightapex.co>" → { Name, Email }. */
function mailbox(from: string): { Email: string; Name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return { Email: from.trim() };
  const name = m[1].replace(/^"(.*)"$/, '$1').trim();
  return name ? { Email: m[2].trim(), Name: name } : { Email: m[2].trim() };
}

async function recordDispatch(
  msg: AppEmailMessage, opts: AppEmailOptions, status: 'sent' | 'simulated' | 'failed',
  provider: string, messageId: string | null, error: string | null,
): Promise<void> {
  try {
    const relatedId = opts.related?.id && UUID.test(opts.related.id) ? opts.related.id : null;
    const { error: dbError } = await platformServiceClient().from('email_dispatches').insert({
      organization_id: opts.organizationId,
      target_email: msg.to ?? '',
      subject: (msg.subject ?? '').slice(0, 500),
      status,
      provider,
      provider_message_id: messageId,
      related_entity_type: opts.related?.type ?? null,
      related_entity_id: relatedId,
      error_message: error ? error.slice(0, 1000) : null,
    });
    if (dbError) console.warn('[notifications/email] auditoria do envio falhou', { organizationId: opts.organizationId, code: dbError.code ?? null });
  } catch {
    // Auditoria que falha não desfaz nem repete o envio.
    console.warn('[notifications/email] auditoria do envio indisponível', { organizationId: opts.organizationId });
  }
}
