/**
 * WHATSAPP SIMULADO — o único provedor implementado, e só para teste e QA.
 *
 * Ele existe para provar o caminho inteiro (canal governado → opt-in →
 * conteúdo → registro de entrega) sem nenhuma rede. Fora de `NODE_ENV=test`
 * ou `APEX_QA_ENVIRONMENT=1` ele não está disponível, e em produção da
 * Vercel nunca está — nem com a variável de QA ligada por engano.
 */
import { randomUUID } from 'node:crypto';
import { WhatsAppSendError, type WhatsAppEnv, type WhatsAppProvider } from './types';

export function fakeWhatsAppAvailable(env: WhatsAppEnv = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false;
  return env.APEX_QA_ENVIRONMENT === '1' || env.NODE_ENV === 'test';
}

export interface FakeWhatsAppMessage { messageId: string; to: string; body: string; idempotencyKey: string; at: string }

// Livro em memória, limitado: é instrumento de teste, não armazenamento.
const LOG_CAP = 500;
const log: FakeWhatsAppMessage[] = [];
const byKey = new Map<string, string>();
const E164 = /^\+[1-9][0-9]{7,14}$/;

export const fakeWhatsAppProvider: WhatsAppProvider = {
  id: 'fake',
  displayName: 'WhatsApp simulado (teste e QA)',
  configured: () => ({ ok: true, missing: [] }),
  async send(message, { idempotencyKey }) {
    // Última linha de defesa: a disponibilidade já foi conferida no registro.
    if (!fakeWhatsAppAvailable(process.env)) {
      throw new WhatsAppSendError('FAKE_OUTSIDE_QA', 'O WhatsApp simulado só existe em teste e QA.', false);
    }
    if (!E164.test(message.to)) throw new WhatsAppSendError('INVALID_DESTINATION', 'Número fora do formato E.164.', false);
    // Mesma chave, mesma mensagem — como um provedor idempotente responderia.
    const prior = byKey.get(idempotencyKey);
    if (prior) return { messageId: prior };
    const messageId = `fake-${randomUUID()}`;
    byKey.set(idempotencyKey, messageId);
    log.push({ messageId, to: message.to, body: message.body, idempotencyKey, at: new Date().toISOString() });
    if (log.length > LOG_CAP) {
      const dropped = log.splice(0, log.length - LOG_CAP);
      for (const d of dropped) byKey.delete(d.idempotencyKey);
    }
    return { messageId };
  },
};

/** Somente teste/QA: o que o simulado "enviou". */
export function fakeWhatsAppLog(): readonly FakeWhatsAppMessage[] {
  return [...log];
}

export function resetFakeWhatsAppLog(): void {
  log.length = 0;
  byKey.clear();
}
