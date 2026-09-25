/**
 * Transporte de e-mail compartilhado. O que se prova:
 *  • o AMBIENTE escolhe o transporte (explícito > chave do Resend > none), e
 *    valor desconhecido fecha em none;
 *  • `none` é SIMULATED e não toca no provedor;
 *  • o Resend recebe a chave de idempotência; 429/5xx/rede é transitório, o
 *    resto do 4xx é permanente;
 *  • a captura só fala com esta máquina;
 *  • toda tentativa vai para email_dispatches, e auditoria que falha não
 *    derruba o envio; endereço de destinatário nunca vai para log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, insert, ctor } = vi.hoisted(() => ({ send: vi.fn(), insert: vi.fn(), ctor: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
    constructor(key: string) { ctor(key); }
  },
}));
vi.mock('@/lib/platform/server-client', () => ({
  platformServiceClient: () => ({ from: (table: string) => ({ insert: (row: unknown) => insert(table, row) }) }),
}));

import {
  EmailPermanentError, EmailTransientError, captureEndpoint, classifyResendError, emailTransportKind, sendAppEmail,
} from '@/lib/notifications/email';

const TO = 'fulana@apex-qa.test';
const MSG = { to: TO, subject: 'Decisão necessária — Compra de R$ 182.400', html: '<p>x</p>', text: 'x' };
const OPTS = {
  idempotencyKey: 'apex-dd-abc', organizationId: '11111111-1111-4111-8111-111111111111',
  related: { type: 'purchase_order', id: 'e4a2beae-9aa0-408f-81d1-df8bae481035' },
};
const RESEND_ENV = { RESEND_API_KEY: 're_test_key', APP_EMAIL_FROM: 'INSIGHT APEX <no-reply@insightapex.co>' };

beforeEach(() => {
  send.mockReset();
  ctor.mockReset();
  insert.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('seleção do transporte', () => {
  it('explícito manda; sem ele, a chave do Resend decide', () => {
    expect(emailTransportKind({ APEX_EMAIL_TRANSPORT: 'capture', RESEND_API_KEY: 're_x' })).toBe('capture');
    expect(emailTransportKind({ APEX_EMAIL_TRANSPORT: 'NONE', RESEND_API_KEY: 're_x' })).toBe('none');
    expect(emailTransportKind({ RESEND_API_KEY: 're_x' })).toBe('resend');
    expect(emailTransportKind({ RESEND_API_KEY: '' })).toBe('none');
    expect(emailTransportKind({})).toBe('none');
  });

  it('valor desconhecido fecha em none — erro de digitação não vira envio', () => {
    expect(emailTransportKind({ APEX_EMAIL_TRANSPORT: 'smtp', RESEND_API_KEY: 're_x' })).toBe('none');
  });
});

describe('none', () => {
  it('é SIMULATED, não carrega o SDK e fica registrado como simulado', async () => {
    const r = await sendAppEmail(MSG, OPTS, {});
    expect(r).toEqual({ outcome: 'SIMULATED', provider: 'none', messageId: null });
    expect(ctor).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith('email_dispatches', expect.objectContaining({
      status: 'simulated', provider: 'none', related_entity_type: 'purchase_order', related_entity_id: OPTS.related.id,
      organization_id: OPTS.organizationId,
    }));
  });
});

describe('resend', () => {
  it('envia com remetente, texto e chave de idempotência; registra o id do provedor', async () => {
    send.mockResolvedValue({ data: { id: 're_msg_1' }, error: null, headers: null });
    const r = await sendAppEmail(MSG, OPTS, RESEND_ENV);
    expect(r).toEqual({ outcome: 'SENT', provider: 'resend', messageId: 're_msg_1' });
    expect(ctor).toHaveBeenCalledWith('re_test_key');
    expect(send).toHaveBeenCalledWith(
      { from: 'INSIGHT APEX <no-reply@insightapex.co>', to: [TO], subject: MSG.subject, html: MSG.html, text: MSG.text },
      { idempotencyKey: 'apex-dd-abc' },
    );
    expect(insert).toHaveBeenCalledWith('email_dispatches', expect.objectContaining({ status: 'sent', provider_message_id: 're_msg_1' }));
  });

  it.each([
    [429, 'rate_limit_exceeded', EmailTransientError],
    [500, 'internal_server_error', EmailTransientError],
    [503, 'application_error', EmailTransientError],
    [null, 'application_error', EmailTransientError],
    [409, 'concurrent_idempotent_requests', EmailTransientError],
    [422, 'validation_error', EmailPermanentError],
    [403, 'invalid_from_address', EmailPermanentError],
    [409, 'invalid_idempotent_request', EmailPermanentError],
  ])('HTTP %s (%s) é %s', async (statusCode, name, Kind) => {
    send.mockResolvedValue({ data: null, error: { statusCode, name, message: `to ${TO} recusado` }, headers: null });
    const err = await sendAppEmail(MSG, OPTS, RESEND_ENV).catch((e) => e);
    expect(err).toBeInstanceOf(Kind);
    expect(err.code).toBe(name);
    // A mensagem do provedor pode ecoar o destinatário: não é copiada.
    expect(err.message).not.toContain(TO);
    expect(insert).toHaveBeenCalledWith('email_dispatches', expect.objectContaining({ status: 'failed', provider: 'resend' }));
  });

  it('classificação isolada: rede sem status é transitória', () => {
    expect(classifyResendError({ statusCode: null, name: 'application_error' })).toBeInstanceOf(EmailTransientError);
    expect(classifyResendError({ statusCode: 400, name: 'invalid_parameter' })).toBeInstanceOf(EmailPermanentError);
  });

  it('transporte resend sem chave é erro de configuração, permanente', async () => {
    const err = await sendAppEmail(MSG, OPTS, { APEX_EMAIL_TRANSPORT: 'resend' }).catch((e) => e);
    expect(err).toBeInstanceOf(EmailPermanentError);
    expect(err.code).toBe('missing_api_key');
    expect(ctor).not.toHaveBeenCalled();
  });

  it('exceção do SDK vira transitória (a chave torna a repetição segura)', async () => {
    send.mockRejectedValue(new Error('boom'));
    await expect(sendAppEmail(MSG, OPTS, RESEND_ENV)).rejects.toBeInstanceOf(EmailTransientError);
  });

  it('destinatário e chave inválidos são recusados antes do provedor', async () => {
    await expect(sendAppEmail({ ...MSG, to: 'sem-arroba' }, OPTS, RESEND_ENV)).rejects.toMatchObject({ code: 'invalid_recipient' });
    await expect(sendAppEmail(MSG, { ...OPTS, idempotencyKey: 'x'.repeat(257) }, RESEND_ENV)).rejects.toMatchObject({ code: 'invalid_idempotency_key' });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('captura (QA)', () => {
  const CAPTURE = { APEX_EMAIL_TRANSPORT: 'capture', EMAIL_CAPTURE_URL: 'http://127.0.0.1:55424' };

  it('recusa qualquer host que não seja desta máquina, sem abrir conexão', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const url of ['https://mailpit.example.com', 'http://10.0.0.5:55424', 'http://127.0.0.1.evil.example']) {
      const err = await sendAppEmail(MSG, OPTS, { APEX_EMAIL_TRANSPORT: 'capture', EMAIL_CAPTURE_URL: url }).catch((e) => e);
      expect(err).toBeInstanceOf(EmailPermanentError);
      expect(err.code).toBe('capture_not_local');
    }
    await expect(sendAppEmail(MSG, OPTS, { APEX_EMAIL_TRANSPORT: 'capture' })).rejects.toMatchObject({ code: 'capture_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captureEndpoint({ EMAIL_CAPTURE_URL: 'http://localhost:55424' }).toString()).toBe('http://localhost:55424/api/v1/send');
  });

  it('manda para o Mailpit local no formato da API de envio e devolve o ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ID: 'mp-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await sendAppEmail(MSG, OPTS, CAPTURE);
    expect(r).toEqual({ outcome: 'SENT', provider: 'capture', messageId: 'mp-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:55424/api/v1/send');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      From: { Email: 'no-reply@insightapex.co', Name: 'INSIGHT APEX' }, To: [{ Email: TO }],
      Subject: MSG.subject, HTML: MSG.html, Text: MSG.text, Headers: { 'X-Apex-Idempotency-Key': 'apex-dd-abc' },
    });
    expect(insert).toHaveBeenCalledWith('email_dispatches', expect.objectContaining({ status: 'sent', provider: 'capture' }));
  });

  it('coletor fora do ar é transitório; 400 é permanente', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(sendAppEmail(MSG, OPTS, CAPTURE)).rejects.toBeInstanceOf(EmailTransientError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(sendAppEmail(MSG, OPTS, CAPTURE)).rejects.toBeInstanceOf(EmailTransientError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"Error":"bad"}', { status: 400 })));
    await expect(sendAppEmail(MSG, OPTS, CAPTURE)).rejects.toBeInstanceOf(EmailPermanentError);
  });
});

describe('auditoria', () => {
  it('auditoria que falha não derruba o envio, e o log não leva o destinatário', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    insert.mockRejectedValue(new Error('db down'));
    send.mockResolvedValue({ data: { id: 're_msg_2' }, error: null, headers: null });
    await expect(sendAppEmail(MSG, OPTS, RESEND_ENV)).resolves.toMatchObject({ outcome: 'SENT' });
    insert.mockResolvedValue({ error: { code: '42501', message: `denied for ${TO}` } });
    await expect(sendAppEmail(MSG, OPTS, {})).resolves.toMatchObject({ outcome: 'SIMULATED' });
    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(logged).not.toContain(TO);
    expect(logged).not.toContain(MSG.subject);
  });

  it('id relacionado que não é uuid não vai para a coluna uuid', async () => {
    await sendAppEmail(MSG, { ...OPTS, related: { type: 'decision', id: 'purchase_order:x:s1' } }, {});
    expect(insert).toHaveBeenCalledWith('email_dispatches', expect.objectContaining({ related_entity_type: 'decision', related_entity_id: null }));
  });
});
