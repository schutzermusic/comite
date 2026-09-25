/**
 * AVISOS POR E-MAIL DA AGENDA E DO CRONOGRAMA — o contrato tipado.
 *
 * O navegador diz O QUE aconteceu ("convidei para a reunião X", "atribuí a
 * atividade Y") e mais nada. Assunto, HTML, remetente e destinatários são do
 * servidor: ele relê o registro na sessão RLS de quem pediu, na organização
 * ativa, e tira os destinatários do próprio registro (convidados gravados,
 * responsável, gestor). Um corpo com `subject`, `html` ou `recipients` é
 * recusado — não ignorado — para que um cliente antigo falhe alto.
 *
 * Puro: sem banco, sem rede. O resolvedor com banco está em
 * `email-notice-server.ts`; a rota em `src/app/api/agenda/email/send`.
 */
import { createHash } from 'node:crypto';

export type AgendaEmailRequest =
  | { kind: 'meeting_invite'; id: string }
  | { kind: 'task_assigned'; id: string }
  | { kind: 'task_status'; id: string }
  | { kind: 'timeline_assigned'; id: string }
  | { kind: 'timeline_delay'; id: string };

export type AgendaEmailKind = AgendaEmailRequest['kind'];

/** O único campo de identidade aceito por tipo de aviso. */
export const AGENDA_EMAIL_ID_FIELD: Record<AgendaEmailKind, string> = {
  meeting_invite: 'event_id',
  task_assigned: 'task_id',
  task_status: 'task_id',
  timeline_assigned: 'assignment_id',
  timeline_delay: 'delay_log_id',
};

/** Máximo de destinatários por aviso: uma reunião real, não uma lista de disparo. */
export const MAX_NOTICE_RECIPIENTS = 50;
/** Aviso de fato (tarefa criada, atribuição, atraso) só vale logo depois do fato. */
export const NOTICE_WINDOW_MS = 30 * 60 * 1000;
/** Reenvio de convite ao mesmo convidado: no máximo um a cada 10 minutos. */
export const INVITE_RESEND_BUCKET_MS = 10 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Mesma forma aceita pelo transporte (notifications/email.ts), sem aspas, vírgulas ou quebras. */
const MAILBOX = /^[^\s@<>"';:,\\]+@[^\s@<>"';:,\\]+\.[^\s@<>"';:,\\]+$/;

export type ParseResult = { ok: true; request: AgendaEmailRequest } | { ok: false; error: string };

export function parseAgendaEmailRequest(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Corpo inválido.' };
  const b = body as Record<string, unknown>;
  const kind = b.kind;
  if (typeof kind !== 'string' || !(kind in AGENDA_EMAIL_ID_FIELD)) {
    return { ok: false, error: 'Tipo de aviso desconhecido. Conteúdo e destinatários são definidos pelo servidor.' };
  }
  const field = AGENDA_EMAIL_ID_FIELD[kind as AgendaEmailKind];
  const extra = Object.keys(b).filter((k) => k !== 'kind' && k !== field);
  if (extra.length > 0) {
    return { ok: false, error: `Campos não aceitos (${extra.sort().join(', ')}): conteúdo e destinatários são definidos pelo servidor.` };
  }
  const id = b[field];
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: `${field} inválido.` };
  return { ok: true, request: { kind: kind as AgendaEmailKind, id } as AgendaEmailRequest };
}

/** Endereços válidos, sem repetição (sem diferença de caixa) e sem os excluídos. */
export function noticeRecipients(candidates: Array<string | null | undefined>, exclude: Array<string | null | undefined> = []): string[] {
  const out = new Map<string, string>();
  const skip = new Set(exclude.filter(Boolean).map((e) => String(e).trim().toLowerCase()));
  for (const raw of candidates) {
    const email = String(raw ?? '').trim();
    const key = email.toLowerCase();
    if (!email || !MAILBOX.test(email) || skip.has(key) || out.has(key)) continue;
    out.set(key, email);
  }
  return [...out.values()];
}

/** Um fato "recente": aconteceu há no máximo NOTICE_WINDOW_MS (e não no futuro além de um minuto de relógio). */
export function isFresh(at: string | null | undefined, now = Date.now()): boolean {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) && now - t <= NOTICE_WINDOW_MS && t - now <= 60_000;
}

/**
 * Chave de idempotência do aviso: estável por (aviso, fato, destinatário),
 * nunca por tentativa. O endereço entra como resumo — a chave vai ao provedor.
 */
export function noticeIdempotencyKey(kind: AgendaEmailKind, fact: string, recipient: string): string {
  const who = createHash('sha256').update(recipient.trim().toLowerCase()).digest('hex').slice(0, 20);
  return `agenda:${kind}:${fact}:${who}`;
}

const TZ = 'America/Sao_Paulo';

/** "qui., 12 de jun. de 2026, 14:00" no fuso da operação — o servidor roda em UTC. */
export function meetingDateLabel(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/** Prazo com hora (tarefas). */
export function dueDateTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

/** Data de calendário (cronograma), sem fuso: "2026-06-12" → "12 de jun. de 2026". */
export function calendarDateLabel(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}
