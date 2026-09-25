/**
 * ALERTA DE VENCIMENTO DE ASO POR E-MAIL — o contrato tipado. Puro.
 *
 * O resumo leva nome, lotação e situação de exame ocupacional: dado de saúde.
 * O navegador escolhe QUEM recebe só entre membros que o servidor lista
 * (vínculo ativo + `people.view_sensitive_data`, migration 245) — nunca um
 * endereço. Um corpo com `recipients`, e-mail na referência ou campo estranho
 * é recusado, não ignorado.
 */
import { createHash } from 'node:crypto';

export const MAX_ASO_DIGEST_RECIPIENTS = 20;

export interface AsoDigestIntent {
  to: Array<{ type: 'member'; id: string }>;
  /** Uma por envio: repetir não manda de novo a quem já recebeu. */
  request_id: string;
  /** Ensaio: resolve e valida, não envia. */
  test: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = new Set(['to', 'request_id', 'test']);

export function parseAsoDigestIntent(body: unknown): { ok: true; intent: AsoDigestIntent } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Corpo inválido.' };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !ALLOWED.has(k));
  if (extra.length > 0) {
    return { ok: false, error: `Campos não aceitos (${extra.sort().join(', ')}): os destinatários são membros escolhidos da lista do servidor.` };
  }
  if (!Array.isArray(b.to) || b.to.length === 0) return { ok: false, error: 'Escolha ao menos um destinatário.' };
  if (b.to.length > MAX_ASO_DIGEST_RECIPIENTS) return { ok: false, error: `No máximo ${MAX_ASO_DIGEST_RECIPIENTS} destinatários.` };
  const to: AsoDigestIntent['to'] = [];
  for (const r of b.to) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: 'Destinatário inválido.' };
    const ref = r as Record<string, unknown>;
    if (Object.keys(ref).some((k) => k !== 'type' && k !== 'id') || ref.type !== 'member' || typeof ref.id !== 'string' || !UUID.test(ref.id)) {
      return { ok: false, error: 'Destinatário é um membro {type: "member", id} — o endereço vem do servidor.' };
    }
    to.push({ type: 'member', id: ref.id.toLowerCase() });
  }
  if (typeof b.request_id !== 'string' || !UUID.test(b.request_id)) return { ok: false, error: 'request_id inválido.' };
  if (b.test !== undefined && typeof b.test !== 'boolean') return { ok: false, error: 'test inválido.' };
  return { ok: true, intent: { to, request_id: b.request_id.toLowerCase(), test: b.test === true } };
}

/**
 * Assunto NEUTRO: nada de contagem de vencidos, nome ou lotação — o assunto
 * aparece em notificação de celular, lista de caixa de entrada e auditoria.
 */
export function asoDigestSubject(today: string): string {
  const [y, m, d] = today.slice(0, 10).split('-');
  return `[SST] Resumo de vencimentos de ASO — ${d}/${m}/${y}`;
}

export function asoDigestKey(requestId: string, email: string): string {
  return `aso-digest:${requestId}:${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24)}`;
}
