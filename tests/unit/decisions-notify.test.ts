/**
 * Orquestração de avisos de Decisões, contra um cliente Supabase FALSO que
 * imita os contratos da 240 (arrendamento, registro com token, in-app).
 * O que se prova:
 *  • in-app vai pela porta transacional do livro, com link relativo;
 *  • e-mail: SENT/SIMULATED registrados com provedor, id e destino mascarado;
 *    transitório vira retentativa, permanente vira DEAD, sem e-mail vira DEAD;
 *    a chave do provedor é estável por linha do livro;
 *  • WhatsApp: sem linha governada é NOT_CONFIGURED; com o simulado pronto e
 *    opt-in é SENT com o conteúdo MINIMAL; sem opt-in é SKIPPED;
 *  • aviso de ação de decisão encerrada é CANCELADO; desfecho segue;
 *  • a falha de UMA entrega não para as outras; só infraestrutura sobe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendAppEmail, afterMock, state } = vi.hoisted(() => ({
  sendAppEmail: vi.fn(),
  afterMock: vi.fn(),
  state: { client: null as unknown },
}));

vi.mock('@/lib/platform/server-client', () => ({ platformServiceClient: () => state.client }));
vi.mock('@/lib/decisions/names', () => ({
  nameBook: async () => ({
    person: (id: string | null) => (id ? { id, name: id === DECIDER ? 'Diretora Financeira' : 'Comprador QA' } : null),
    role: () => null,
    project: (id: string | null) => (id ? 'SE Tucuruí' : null),
    supplier: (id: string | null) => (id ? 'Fornecedor B' : null),
  }),
}));
vi.mock('@/lib/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/email')>()),
  sendAppEmail,
}));
vi.mock('next/server', () => ({ after: afterMock }));

import { EmailPermanentError, EmailTransientError } from '@/lib/notifications/email';
import { fakeWhatsAppLog, resetFakeWhatsAppLog } from '@/lib/notifications/whatsapp';
import { RetryableJobError } from '@/lib/platform/jobs/errors';
import {
  deliverDue, maskEmail, maskPhone, openDecisionKeysForSubject, planForEvent, providerKey, scheduleDecisionNotify,
} from '@/lib/decisions/notify';

const ORG = '11111111-1111-4111-8111-111111111111';
const PO = 'e4a2beae-9aa0-408f-81d1-df8bae481035';
const PO2 = 'f5b3cfbf-0ab1-419f-92e2-e0f9cb592146';
const REQ = 'a1b2c3d4-0000-4000-8000-000000000001';
const KEY = `purchase_order:${PO}:s1`;
const KEY2 = `purchase_order:${PO2}:s1`;
const DECIDER = '22222222-2222-4222-8222-222222222222';
const REQUESTER = '33333333-3333-4333-8333-333333333333';
const USER_NO_MAIL = '44444444-4444-4444-8444-444444444444';

type Row = Record<string, unknown>;
interface Delivery extends Row {
  id: string; decision_key: string; notice_kind: string; outcome: string | null; channel: string;
  recipient_user_id: string; state: string; lease_token: string | null;
}

function resolved(key: string, over: Row = {}): Row {
  const po = key.split(':')[1];
  return {
    decision_key: key, source_kind: 'PROCUREMENT_AUTHORITY', subject_type: 'purchase_order', subject_id: po,
    title: 'Pedido de compra OC-260924-CA44B', amount: 182400, currency: 'BRL', project_id: 'qa-scn-tucurui',
    supplier_id: 'cc2c8b74-52fb-4b1c-9197-faebec1c2da3', requested_by: REQUESTER, closed_by: null, reason: null,
    open: true, ...over,
  };
}

let seq = 0;
function delivery(over: Partial<Delivery>): Delivery {
  seq += 1;
  return {
    id: `d-${seq}`, organization_id: ORG, decision_key: KEY, subject_type: 'purchase_order', subject_id: PO,
    notice_kind: 'NEW', outcome: null, recipient_user_id: DECIDER, recipient_role: 'DECIDER', channel: 'in_app',
    state: 'PENDING', lease_token: null, attempt_count: 0, idempotency_key: `${KEY}|NEW|-|${DECIDER}|in_app|${seq}`,
    ...over,
  } as Delivery;
}

interface FakeOpts {
  deliveries: Delivery[];
  resolve?: Record<string, Row | null | 'ERROR'>;
  users?: Record<string, string | null>;
  tables?: Record<string, Row[]>;
  failRecordFor?: Set<string>;
  claimError?: { code?: string; message: string };
  rpcOverrides?: Record<string, (args: Row) => unknown>;
}

function fakeClient(o: FakeOpts) {
  const calls: Array<{ fn: string; args: Row }> = [];
  const records: Array<Row> = [];
  const tables: Record<string, Row[]> = { ...(o.tables ?? {}) };
  // Padrão: todo destinatário é membro ATIVO (o portão de envio reconfere); o teste que quiser outro estado declara a tabela.
  if (!tables.organization_memberships) {
    tables.organization_memberships = [...new Set(o.deliveries.map((d) => d.recipient_user_id))]
      .map((user_id) => ({ organization_id: ORG, user_id, status: 'ACTIVE' }));
  }
  const byId = new Map(o.deliveries.map((d) => [d.id, d]));
  const rpc = async (fn: string, args: Row) => {
    calls.push({ fn, args });
    if (o.rpcOverrides?.[fn]) return o.rpcOverrides[fn](args);
    switch (fn) {
      case 'decision_deliveries_claim': {
        if (o.claimError) return { data: null, error: o.claimError };
        const due = o.deliveries.filter((d) => d.state === 'PENDING').slice(0, Number(args.p_limit));
        for (const d of due) { d.state = 'SENDING'; d.lease_token = `lease-${d.id}`; }
        return { data: due.map((d) => ({ ...d })), error: null };
      }
      case 'decision_resolve': {
        const r = o.resolve?.[String(args.p_key)];
        if (r === 'ERROR') return { data: null, error: { code: 'PGRST000', message: 'db' } };
        return { data: r === undefined ? resolved(String(args.p_key)) : r, error: null };
      }
      case 'decision_po_timing': return { data: [{ need_by: '2026-09-29', lead_days: 5, decide_by: '2026-09-24' }], error: null };
      case 'decision_today': return { data: '2026-09-24', error: null };
      case 'decision_delivery_in_app': {
        const d = byId.get(String(args.p_id))!;
        if (d.state !== 'SENDING' || d.lease_token !== args.p_lease) return { data: 'STALE', error: null };
        d.state = 'DELIVERED'; d.lease_token = null;
        records.push({ id: d.id, result: 'IN_APP', ...args });
        return { data: 'DELIVERED', error: null };
      }
      case 'decision_delivery_record': {
        const d = byId.get(String(args.p_id))!;
        if (o.failRecordFor?.has(d.id)) return { data: null, error: { code: '', message: 'fetch failed' } };
        if (d.state !== 'SENDING' || d.lease_token !== args.p_lease) return { data: 'STALE', error: null };
        const next = args.p_result === 'RETRY' ? 'FAILED' : args.p_result === 'FAIL' ? 'DEAD' : String(args.p_result);
        d.state = next; d.lease_token = null;
        records.push({ id: d.id, ...args, state: next });
        return { data: next, error: null };
      }
      default: return { data: null, error: { code: '42883', message: `função ${fn} não simulada` } };
    }
  };
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    };
    return b;
  };
  const getUserById = async (id: string) => {
    const email = o.users?.[id];
    if (email === undefined) return { data: { user: null }, error: { status: 404, message: 'User not found' } };
    return { data: { user: { id, email } }, error: null };
  };
  const client = { rpc, from, auth: { admin: { getUserById } } };
  return { client: client as never, calls, records, deliveries: o.deliveries };
}

const recordOf = (records: Row[], id: string) => records.find((r) => r.id === id);

beforeEach(() => {
  sendAppEmail.mockReset();
  afterMock.mockReset();
  resetFakeWhatsAppLog();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { state.client = null; });

describe('in-app', () => {
  it('entrega pela porta transacional do livro, com título do produto e link relativo', async () => {
    const d = delivery({ channel: 'in_app' });
    const f = fakeClient({ deliveries: [d] });
    const c = await deliverDue(ORG, { client: f.client });
    expect(c).toMatchObject({ claimed: 1, delivered: 1, unrecorded: 0 });
    const call = f.calls.find((x) => x.fn === 'decision_delivery_in_app')!;
    expect(call.args).toMatchObject({
      p_id: d.id, p_lease: `lease-${d.id}`,
      p_title: 'Decisão necessária — Compra de R$ 182.400',
      p_link: `/decisoes?d=${encodeURIComponent(KEY)}`,
    });
    expect(String(call.args.p_body)).toContain('Projeto SE Tucuruí');
    expect(f.calls.find((x) => x.fn === 'decision_deliveries_claim')!.args).toMatchObject({ p_org: ORG, p_lease_seconds: 120 });
  });
});

describe('e-mail', () => {
  it('SENT: registra provedor, id da mensagem e destino mascarado; chave do provedor estável', async () => {
    const d = delivery({ channel: 'email' });
    sendAppEmail.mockResolvedValue({ outcome: 'SENT', provider: 'resend', messageId: 're_1' });
    const f = fakeClient({ deliveries: [d], users: { [DECIDER]: 'fulana@apex-qa.test' } });
    const c = await deliverDue(ORG, { client: f.client, env: {} });
    expect(c.sent).toBe(1);
    expect(recordOf(f.records, d.id)).toMatchObject({
      p_result: 'SENT', p_provider: 'resend', p_message_id: 're_1', p_destination_hint: 'f***@apex-qa.test', state: 'SENT',
    });
    const [msg, opts] = sendAppEmail.mock.calls[0];
    expect(msg).toMatchObject({ to: 'fulana@apex-qa.test', subject: 'Decisão necessária — Compra de R$ 182.400' });
    expect(msg.html).toContain('Analisar no Apex');
    expect(opts).toMatchObject({ organizationId: ORG, related: { type: 'purchase_order', id: PO } });
    expect(opts.idempotencyKey).toBe(providerKey(d as never));
    expect(opts.idempotencyKey).toMatch(/^apex-dd-[0-9a-f]{64}$/);
    expect(providerKey(d as never)).toBe(providerKey({ ...d } as never));
  });

  it('SIMULATED quando nada sai', async () => {
    const d = delivery({ channel: 'email' });
    sendAppEmail.mockResolvedValue({ outcome: 'SIMULATED', provider: 'none', messageId: null });
    const f = fakeClient({ deliveries: [d], users: { [DECIDER]: 'fulana@apex-qa.test' } });
    expect((await deliverDue(ORG, { client: f.client, env: {} })).simulated).toBe(1);
    expect(recordOf(f.records, d.id)).toMatchObject({ p_result: 'SIMULATED', p_provider: 'none', state: 'SIMULATED' });
  });

  it('transitório vira retentativa; permanente e sem e-mail viram DEAD', async () => {
    const transient = delivery({ channel: 'email' });
    const permanent = delivery({ channel: 'email', recipient_user_id: REQUESTER });
    const noMail = delivery({ channel: 'email', recipient_user_id: USER_NO_MAIL });
    sendAppEmail.mockImplementation(async (msg: { to: string }) => {
      if (msg.to === 'fulana@apex-qa.test') throw new EmailTransientError('rate_limit_exceeded', 'O Resend recusou o envio.');
      throw new EmailPermanentError('validation_error', 'O Resend recusou o envio.');
    });
    const f = fakeClient({
      deliveries: [transient, permanent, noMail],
      users: { [DECIDER]: 'fulana@apex-qa.test', [REQUESTER]: 'comprador@apex-qa.test', [USER_NO_MAIL]: null },
    });
    const c = await deliverDue(ORG, { client: f.client, env: { RESEND_API_KEY: 're_x' } });
    expect(c).toMatchObject({ claimed: 3, retried: 1, dead: 2 });
    expect(recordOf(f.records, transient.id)).toMatchObject({ p_result: 'RETRY', p_code: 'rate_limit_exceeded', p_provider: 'resend', state: 'FAILED' });
    expect(recordOf(f.records, permanent.id)).toMatchObject({ p_result: 'FAIL', p_code: 'validation_error', state: 'DEAD' });
    expect(recordOf(f.records, noMail.id)).toMatchObject({ p_result: 'FAIL', p_code: 'NO_EMAIL', state: 'DEAD' });
    expect(sendAppEmail).toHaveBeenCalledTimes(2);
  });
});

describe('portão na hora do envio (a linha pode ter esperado na fila)', () => {
  it('quem saiu da organização não recebe e-mail nem WhatsApp — SKIPPED, nada enviado', async () => {
    const mail = delivery({ channel: 'email' });
    const wa = delivery({ channel: 'whatsapp' });
    const f = fakeClient({ deliveries: [mail, wa], users: { [DECIDER]: 'fulana@apex-qa.test' },
      tables: { organization_memberships: [{ organization_id: ORG, user_id: DECIDER, status: 'SUSPENDED' }],
        notification_channel_integrations: [{ organization_id: ORG, channel: 'whatsapp', status: 'ENABLED', provider: 'fake', content_level: 'MINIMAL' }],
        user_notification_preferences: [{ organization_id: ORG, user_id: DECIDER, channel: 'whatsapp', enabled: true, destination: '+5511987654321' }] } });
    await deliverDue(ORG, { client: f.client, env: { RESEND_API_KEY: 're_x', NODE_ENV: 'test' } });
    expect(recordOf(f.records, mail.id)).toMatchObject({ p_result: 'SKIPPED', p_code: 'RECIPIENT_INACTIVE' });
    expect(recordOf(f.records, wa.id)).toMatchObject({ p_result: 'SKIPPED', p_code: 'RECIPIENT_INACTIVE' });
    expect(sendAppEmail).not.toHaveBeenCalled();
    expect(fakeWhatsAppLog()).toHaveLength(0);
  });
  it('e-mail desligado DEPOIS de planejado (pela pessoa ou pela organização) não sai', async () => {
    const optedOut = delivery({ channel: 'email' });
    const f1 = fakeClient({ deliveries: [optedOut], users: { [DECIDER]: 'fulana@apex-qa.test' },
      tables: { user_notification_preferences: [{ organization_id: ORG, user_id: DECIDER, channel: 'email', enabled: false }] } });
    await deliverDue(ORG, { client: f1.client, env: { RESEND_API_KEY: 're_x' } });
    expect(recordOf(f1.records, optedOut.id)).toMatchObject({ p_result: 'SKIPPED', p_code: 'USER_OPTED_OUT' });
    const disabled = delivery({ channel: 'email' });
    const f2 = fakeClient({ deliveries: [disabled], users: { [DECIDER]: 'fulana@apex-qa.test' },
      tables: { notification_channel_integrations: [{ organization_id: ORG, channel: 'email', status: 'DISABLED' }] } });
    await deliverDue(ORG, { client: f2.client, env: { RESEND_API_KEY: 're_x' } });
    expect(recordOf(f2.records, disabled.id)).toMatchObject({ p_result: 'SKIPPED', p_code: 'CHANNEL_DISABLED' });
    expect(sendAppEmail).not.toHaveBeenCalled();
  });
});

describe('WhatsApp', () => {
  const INTEGRATION = { organization_id: ORG, channel: 'whatsapp', status: 'ENABLED', provider: 'fake', content_level: 'MINIMAL' };
  const PREF = { organization_id: ORG, user_id: DECIDER, channel: 'whatsapp', enabled: true, destination: '+5511987654321' };

  it('sem linha governada é NOT_CONFIGURED, com o estado como código — mesmo com o simulado disponível', async () => {
    const d = delivery({ channel: 'whatsapp' });
    const f = fakeClient({ deliveries: [d], tables: { user_notification_preferences: [PREF] } });
    const c = await deliverDue(ORG, { client: f.client, env: { NODE_ENV: 'test', APEX_QA_ENVIRONMENT: '1' } });
    expect(c.not_configured).toBe(1);
    expect(recordOf(f.records, d.id)).toMatchObject({ p_result: 'NOT_CONFIGURED', p_code: 'NOT_CONFIGURED' });
    expect(fakeWhatsAppLog()).toHaveLength(0);
  });

  it('com o simulado pronto e opt-in: SENT com id do provedor, número mascarado e conteúdo MINIMAL', async () => {
    const d = delivery({ channel: 'whatsapp' });
    const f = fakeClient({
      deliveries: [d],
      tables: { notification_channel_integrations: [INTEGRATION], user_notification_preferences: [PREF] },
    });
    const c = await deliverDue(ORG, { client: f.client, env: { NODE_ENV: 'test' } });
    expect(c.sent).toBe(1);
    const rec = recordOf(f.records, d.id)!;
    expect(rec).toMatchObject({ p_result: 'SENT', p_provider: 'fake', p_destination_hint: '+55*******4321' });
    expect(String(rec.p_message_id)).toMatch(/^fake-/);
    const [msg] = fakeWhatsAppLog();
    expect(msg.to).toBe('+5511987654321');
    expect(msg.body).toContain('Decisão necessária');
    expect(msg.body).toContain('Projeto: SE Tucuruí');
    expect(msg.body).not.toContain('R$');
    expect(msg.body).not.toContain('Fornecedor');
  });

  it('sem opt-in é SKIPPED (NO_OPT_IN); provedor oficial reservado é NOT_CONFIGURED com PROVIDER_NOT_IMPLEMENTED', async () => {
    const skipped = delivery({ channel: 'whatsapp', recipient_user_id: REQUESTER });
    const f = fakeClient({ deliveries: [skipped], tables: { notification_channel_integrations: [INTEGRATION], user_notification_preferences: [PREF] } });
    await deliverDue(ORG, { client: f.client, env: { NODE_ENV: 'test' } });
    expect(recordOf(f.records, skipped.id)).toMatchObject({ p_result: 'SKIPPED', p_code: 'NO_OPT_IN' });

    const reserved = delivery({ channel: 'whatsapp' });
    const g = fakeClient({
      deliveries: [reserved],
      tables: { notification_channel_integrations: [{ ...INTEGRATION, provider: 'meta_cloud' }], user_notification_preferences: [PREF] },
    });
    await deliverDue(ORG, { client: g.client, env: { NODE_ENV: 'test' } });
    expect(recordOf(g.records, reserved.id)).toMatchObject({ p_result: 'NOT_CONFIGURED', p_code: 'PROVIDER_NOT_IMPLEMENTED', p_provider: 'meta_cloud' });
  });
});

describe('decisão encerrada e isolamento de falhas', () => {
  it('aviso de ação de decisão encerrada é CANCELADO; o aviso de desfecho segue', async () => {
    const action = delivery({ channel: 'email', notice_kind: 'NEW' });
    const outcome = delivery({ channel: 'in_app', notice_kind: 'RESOLVED', outcome: 'APPROVED', recipient_user_id: REQUESTER });
    const f = fakeClient({
      deliveries: [action, outcome],
      resolve: { [KEY]: resolved(KEY, { open: false, outcome: 'APPROVED', closed_by: DECIDER }) },
      users: { [DECIDER]: 'fulana@apex-qa.test' },
    });
    const c = await deliverDue(ORG, { client: f.client, env: {} });
    expect(c).toMatchObject({ cancelled: 1, delivered: 1 });
    expect(recordOf(f.records, action.id)).toMatchObject({ p_result: 'CANCELLED', p_code: 'DECISION_CLOSED' });
    expect(sendAppEmail).not.toHaveBeenCalled();
    const inApp = f.calls.find((x) => x.fn === 'decision_delivery_in_app')!;
    expect(inApp.args.p_title).toBe('Sua solicitação foi aprovada — Compra de R$ 182.400');
    expect(String(inApp.args.p_body)).toContain('Decidido por Diretora Financeira');
  });

  it('pelo motor, a expiração do pedido antes do prazo operacional é o "decidir até"', async () => {
    const engineKey = `approval_request:${REQ}:e1`;
    const d = delivery({ channel: 'in_app', decision_key: engineKey, notice_kind: 'DUE_SOON' });
    const f = fakeClient({
      deliveries: [d],
      resolve: { [engineKey]: resolved(KEY, { decision_key: engineKey, source_kind: 'APPROVAL_ENGINE', supplier_id: undefined,
        due_at: '2026-09-22T15:00:00+00:00' }) },
      tables: { purchase_orders: [{ organization_id: ORG, id: PO, supplier_id: 'cc2c8b74-52fb-4b1c-9197-faebec1c2da3' }] },
    });
    await deliverDue(ORG, { client: f.client });
    const inApp = f.calls.find((x) => x.fn === 'decision_delivery_in_app')!;
    expect(inApp.args.p_title).toBe('Prazo próximo — Compra de R$ 182.400');
    expect(String(inApp.args.p_body)).toContain('Decidir até 22/09/2026');
    expect(String(inApp.args.p_body)).toContain('Fornecedor Fornecedor B');
  });

  it('decisão que não existe mais é cancelada', async () => {
    const d = delivery({ channel: 'in_app' });
    const f = fakeClient({ deliveries: [d], resolve: { [KEY]: null } });
    await deliverDue(ORG, { client: f.client });
    expect(recordOf(f.records, d.id)).toMatchObject({ p_result: 'CANCELLED', p_code: 'DECISION_NOT_FOUND' });
  });

  it('a falha de uma entrega não para as outras', async () => {
    const broken = delivery({ channel: 'in_app', decision_key: KEY2, subject_id: PO2 });
    const exploding = delivery({ channel: 'email' });
    const fine = delivery({ channel: 'email', recipient_user_id: REQUESTER });
    const inApp = delivery({ channel: 'in_app' });
    sendAppEmail.mockImplementation(async (msg: { to: string }) => {
      if (msg.to === 'fulana@apex-qa.test') throw new Error('bug inesperado');
      return { outcome: 'SENT', provider: 'resend', messageId: 're_ok' };
    });
    const f = fakeClient({
      deliveries: [broken, exploding, fine, inApp],
      resolve: { [KEY2]: 'ERROR' },
      users: { [DECIDER]: 'fulana@apex-qa.test', [REQUESTER]: 'comprador@apex-qa.test' },
    });
    const c = await deliverDue(ORG, { client: f.client, env: {} });
    expect(c).toMatchObject({ claimed: 4, retried: 2, sent: 1, delivered: 1, unrecorded: 0 });
    expect(recordOf(f.records, broken.id)).toMatchObject({ p_result: 'RETRY', state: 'FAILED' });
    expect(String(recordOf(f.records, broken.id)!.p_code)).toContain('CONTEXT_UNAVAILABLE');
    expect(recordOf(f.records, exploding.id)).toMatchObject({ p_result: 'RETRY', p_code: 'EMAIL_UNEXPECTED' });
    expect(recordOf(f.records, fine.id)).toMatchObject({ p_result: 'SENT', p_message_id: 're_ok' });
  });

  it('resultado que não pôde ser gravado: as outras seguem, e o trabalho repete no fim', async () => {
    const lost = delivery({ channel: 'email' });
    const ok = delivery({ channel: 'in_app' });
    sendAppEmail.mockResolvedValue({ outcome: 'SENT', provider: 'resend', messageId: 're_1' });
    const f = fakeClient({ deliveries: [lost, ok], users: { [DECIDER]: 'fulana@apex-qa.test' }, failRecordFor: new Set([lost.id]) });
    await expect(deliverDue(ORG, { client: f.client, env: {} })).rejects.toBeInstanceOf(RetryableJobError);
    expect(ok.state).toBe('DELIVERED');
  });

  it('arrendar falhou por rede: infraestrutura sobe como repetível; erro de SQL preserva o código', async () => {
    const f = fakeClient({ deliveries: [], claimError: { message: 'TypeError: fetch failed' } });
    await expect(deliverDue(ORG, { client: f.client })).rejects.toBeInstanceOf(RetryableJobError);
    const g = fakeClient({ deliveries: [], claimError: { code: '42883', message: 'function does not exist' } });
    const err = await deliverDue(ORG, { client: g.client }).catch((e) => e);
    expect(err).not.toBeInstanceOf(RetryableJobError);
    expect(err.code).toBe('42883');
  });

  it('orçamento esgotado não arrenda nada; lotes respeitam o limite', async () => {
    const f = fakeClient({ deliveries: [delivery({})] });
    expect(await deliverDue(ORG, { client: f.client, budgetMs: 0 })).toMatchObject({ claimed: 0, budget_exhausted: true });
    const many = Array.from({ length: 25 }, () => delivery({ channel: 'in_app' }));
    const g = fakeClient({ deliveries: many });
    const c = await deliverDue(ORG, { client: g.client, limit: 12 });
    expect(c.claimed).toBe(12);
    expect(g.calls.filter((x) => x.fn === 'decision_deliveries_claim').map((x) => x.args.p_limit)).toEqual([10, 2]);
  });
});

describe('planejamento e origem', () => {
  it('evento → chaves → plano por chave; desfecho só em RESOLVED', async () => {
    const f = fakeClient({
      deliveries: [],
      rpcOverrides: {
        decision_keys_for_event: () => ({ data: [
          { organization_id: ORG, decision_key: KEY, notice_kind: 'RESOLVED', outcome: 'APPROVED' },
          { organization_id: ORG, decision_key: KEY2, notice_kind: 'ADJUSTMENT_REQUESTED', outcome: 'IGNORED' },
        ], error: null }),
        decision_notices_plan: (args) => ({ data: args.p_key === KEY ? 2 : 1, error: null }),
      },
    });
    const r = await planForEvent('55555555-5555-4555-8555-555555555555', { client: f.client });
    expect(r).toEqual({ organizationId: ORG, keys: 2, planned: 3, errors: [] });
    const plans = f.calls.filter((x) => x.fn === 'decision_notices_plan').map((x) => x.args);
    expect(plans).toEqual([
      { p_org: ORG, p_key: KEY, p_kind: 'RESOLVED', p_outcome: 'APPROVED' },
      { p_org: ORG, p_key: KEY2, p_kind: 'ADJUSTMENT_REQUESTED', p_outcome: null },
    ]);
  });

  it('chaves abertas do objeto: alçada → submissão vigente; política → estágio corrente; fechado → nenhuma', async () => {
    const f = fakeClient({
      deliveries: [],
      tables: {
        purchase_orders: [
          { organization_id: ORG, id: PO, status: 'APPROVAL_REQUIRED', approval_governance: 'AUTHORITY', approval_request_id: null },
          { organization_id: ORG, id: PO2, status: 'APPROVAL_REQUIRED', approval_governance: 'POLICY', approval_request_id: REQ },
        ],
        approval_requests: [{ organization_id: ORG, id: REQ, status: 'PENDING', current_stage_no: 2 }],
      },
      rpcOverrides: { decision_po_submission: () => ({ data: 3, error: null }) },
    });
    expect(await openDecisionKeysForSubject(ORG, 'purchase_order', PO, { client: f.client })).toEqual([`purchase_order:${PO}:s3`]);
    expect(await openDecisionKeysForSubject(ORG, 'purchase_order', PO2, { client: f.client })).toEqual([`approval_request:${REQ}:e2`]);
    expect(await openDecisionKeysForSubject('99999999-9999-4999-8999-999999999999', 'purchase_order', PO, { client: f.client })).toEqual([]);
    expect(await openDecisionKeysForSubject(ORG, 'purchase_order', 'nao-uuid', { client: f.client })).toEqual([]);
  });

  it('depois da resposta: planeja e entrega; fora de um pedido roda solto; falha nunca propaga', async () => {
    const d = delivery({ channel: 'in_app' });
    const f = fakeClient({ deliveries: [d], rpcOverrides: { decision_notices_plan: () => ({ data: 1, error: null }) } });
    state.client = f.client;
    const pending: Array<() => Promise<void>> = [];
    afterMock.mockImplementation((fn: () => Promise<void>) => { pending.push(fn); });
    scheduleDecisionNotify(ORG, [{ key: KEY, kind: 'NEW' }]);
    expect(f.calls).toHaveLength(0); // nada roda antes da resposta
    await pending[0]();
    expect(f.calls.map((x) => x.fn)).toContain('decision_notices_plan');
    expect(d.state).toBe('DELIVERED');

    afterMock.mockImplementation(() => { throw new Error('`after` was called outside a request scope'); });
    state.client = fakeClient({ deliveries: [], claimError: { message: 'fetch failed' } }).client;
    expect(() => scheduleDecisionNotify(ORG, [{ key: KEY, kind: 'NEW' }])).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('aviso imediato falhou'), expect.objectContaining({ organizationId: ORG }));
  });

  it('máscaras não vazam o endereço inteiro', () => {
    expect(maskEmail('fulana@apex-qa.test')).toBe('f***@apex-qa.test');
    expect(maskPhone('+5511987654321')).toBe('+55*******4321');
  });
});
