/**
 * Fronteira de WhatsApp. O que se prova:
 *  • variável de ambiente sozinha nunca liga o canal: sem a linha governada
 *    é NOT_CONFIGURED, mesmo com o simulado disponível;
 *  • linha DISABLED é DISABLED; provedor oficial reservado é
 *    PROVIDER_NOT_IMPLEMENTED, sem nenhum código de rede;
 *  • o simulado só está pronto em teste/QA, e nunca na produção da Vercel;
 *  • o simulado devolve `fake-<uuid>` e é idempotente pela chave.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RESERVED_WHATSAPP_PROVIDERS, WhatsAppSendError, fakeWhatsAppLog, registeredWhatsAppProviders, resetFakeWhatsAppLog,
  resolveWhatsAppChannel, whatsAppProviderAvailability,
} from '@/lib/notifications/whatsapp';

const ENABLED_FAKE = { status: 'ENABLED', provider: 'fake', content_level: 'MINIMAL' };

beforeEach(() => resetFakeWhatsAppLog());

describe('resolução do canal', () => {
  it('sem linha governada é NOT_CONFIGURED — nem o simulado em ambiente de QA liga o canal', () => {
    for (const env of [{ APEX_QA_ENVIRONMENT: '1' }, { NODE_ENV: 'test' }, { APEX_QA_ENVIRONMENT: '1', NODE_ENV: 'test' }]) {
      const ch = resolveWhatsAppChannel(null, env);
      expect(ch.state).toBe('NOT_CONFIGURED');
      expect(ch.adapter).toBeNull();
    }
  });

  it('linha DISABLED é DISABLED, com qualquer provedor', () => {
    expect(resolveWhatsAppChannel({ ...ENABLED_FAKE, status: 'DISABLED' }, { NODE_ENV: 'test' })).toMatchObject({ state: 'DISABLED', adapter: null });
  });

  it('provedor oficial reservado é PROVIDER_NOT_IMPLEMENTED; desconhecido também', () => {
    expect([...RESERVED_WHATSAPP_PROVIDERS]).toEqual(['meta_cloud', 'twilio', 'zenvia', 'gupshup']);
    for (const provider of RESERVED_WHATSAPP_PROVIDERS) {
      expect(resolveWhatsAppChannel({ status: 'ENABLED', provider }, { NODE_ENV: 'test' })).toMatchObject({
        state: 'PROVIDER_NOT_IMPLEMENTED', provider, adapter: null,
      });
      expect(whatsAppProviderAvailability(provider, {})).toEqual({ status: 'PROVIDER_NOT_IMPLEMENTED', reserved: true });
    }
    expect(whatsAppProviderAvailability('inventado', {})).toEqual({ status: 'PROVIDER_NOT_IMPLEMENTED', reserved: false });
    expect(whatsAppProviderAvailability('__proto__', {})).toEqual({ status: 'PROVIDER_NOT_IMPLEMENTED', reserved: false });
    expect(registeredWhatsAppProviders()).toEqual(['fake']);
  });

  it('o simulado só fica pronto em teste ou QA, e nunca na produção da Vercel', () => {
    expect(resolveWhatsAppChannel(ENABLED_FAKE, { NODE_ENV: 'test' }).state).toBe('READY');
    expect(resolveWhatsAppChannel(ENABLED_FAKE, { NODE_ENV: 'production', APEX_QA_ENVIRONMENT: '1' }).state).toBe('READY');
    expect(resolveWhatsAppChannel(ENABLED_FAKE, { NODE_ENV: 'production' }).state).toBe('PROVIDER_UNAVAILABLE');
    expect(resolveWhatsAppChannel(ENABLED_FAKE, { NODE_ENV: 'development' }).state).toBe('PROVIDER_UNAVAILABLE');
    expect(resolveWhatsAppChannel(ENABLED_FAKE, { VERCEL_ENV: 'production', APEX_QA_ENVIRONMENT: '1', NODE_ENV: 'test' }).state)
      .toBe('PROVIDER_UNAVAILABLE');
  });

  it('nível de conteúdo vem da linha, MINIMAL por padrão', () => {
    expect(resolveWhatsAppChannel({ status: 'ENABLED', provider: 'fake' }, { NODE_ENV: 'test' }).contentLevel).toBe('MINIMAL');
    expect(resolveWhatsAppChannel({ ...ENABLED_FAKE, content_level: 'STANDARD' }, { NODE_ENV: 'test' }).contentLevel).toBe('STANDARD');
    expect(resolveWhatsAppChannel(null, {}).contentLevel).toBe('MINIMAL');
  });
});

describe('provedor simulado', () => {
  it('devolve fake-<uuid>, guarda o envio e é idempotente pela chave', async () => {
    const ch = resolveWhatsAppChannel(ENABLED_FAKE, { NODE_ENV: 'test' });
    const a = await ch.adapter!.send({ to: '+5511987654321', body: 'Insight Apex' }, { idempotencyKey: 'k-1' });
    expect(a.messageId).toMatch(/^fake-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const again = await ch.adapter!.send({ to: '+5511987654321', body: 'Insight Apex' }, { idempotencyKey: 'k-1' });
    expect(again.messageId).toBe(a.messageId);
    const b = await ch.adapter!.send({ to: '+5511987654321', body: 'Outra' }, { idempotencyKey: 'k-2' });
    expect(b.messageId).not.toBe(a.messageId);
    expect(fakeWhatsAppLog().map((m) => m.idempotencyKey)).toEqual(['k-1', 'k-2']);
  });

  it('número fora de E.164 é recusado sem repetição', async () => {
    const ch = resolveWhatsAppChannel(ENABLED_FAKE, { NODE_ENV: 'test' });
    const err = await ch.adapter!.send({ to: '11 98765-4321', body: 'x' }, { idempotencyKey: 'k-3' }).catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppSendError);
    expect(err).toMatchObject({ code: 'INVALID_DESTINATION', retryable: false });
    expect(fakeWhatsAppLog()).toHaveLength(0);
  });
});
