/**
 * Envio da cotação ao fornecedor — src/lib/supply/rfq-send.ts e a rota
 * POST /api/supply/procurement/rfqs/[id]/send, com o service role, o
 * transporte de e-mail e a auditoria simulados (hermético — nada sai):
 *  1. o e-mail: item, quantidade, unidade, necessidade, prazo de resposta e
 *     como responder — nunca preço interno nem os outros fornecedores;
 *  2. o ato: só cotação ABERTA da organização, só convidado, desfecho por
 *     fornecedor (SENT · SIMULATED · NO_CONTACT · ALREADY_SENT · FAILED),
 *     chave de idempotência estável, `related_entity` do convite, auditoria
 *     com o desfecho de cada convite (sem endereço); quem já cotou e o
 *     prospecto achado na internet não recebem e-mail;
 *  3. o livro de envios: só `sent` de transporte que entrega (o coletor de QA
 *     não conta), o mais antigo, só as colunas de id/data;
 *  4. a rota: alçada `procurement.source` E leitura de cotações, recusa em
 *     português, nome só com leitura de partes, id e corpo validados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendAppEmail: vi.fn(),
  logAuditEventServer: vi.fn(),
  resolveOwnerNames: vi.fn(),
  requireOperationsSession: vi.fn(),
  db: { current: null as unknown },
}));

vi.mock('@/lib/platform/server-client', () => ({ platformServiceClient: () => mocks.db.current }));
vi.mock('@/lib/notifications/email', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/notifications/email')>()),
  sendAppEmail: mocks.sendAppEmail,
}));
vi.mock('@/lib/audit/log-audit-event-server', () => ({ logAuditEventServer: mocks.logAuditEventServer }));
vi.mock('@/lib/commercial/owner-directory', () => ({ resolveOwnerNames: mocks.resolveOwnerNames }));
vi.mock('@/lib/operations/session', () => ({
  requireOperationsSession: mocks.requireOperationsSession,
  hasOptionalPermission: async (s: { permissions: Set<string> }, key: string) => s.permissions.has(key),
  isSessionError: (r: object) => 'error' in r,
}));

import { EmailPermanentError, EmailTransientError } from '@/lib/notifications/email';
import {
  outcomeOf, readRfqDispatches, rfqEmail, rfqIdempotencyKey, RFQ_DISPATCH_TYPE, sendRfqInvitations,
} from '@/lib/supply/rfq-send';

const ORG = '00000000-0000-4000-8000-00000000000a';
const RFQ = '11111111-1111-4111-8111-111111111111';
const SUP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SUP_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INV_A = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const INV_B = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
const INV_C = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';

/* ── Service role simulado ──────────────────────────────────────────────── */

type Spec = { rows?: Record<string, unknown>[]; error?: string };
type Call = { table: string; ops: Array<[string, unknown[]]> };

function fakeDb(tables: Record<string, Spec>, calls: Call[] = []) {
  return {
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      const run = () => {
        const spec = tables[table] ?? {};
        if (spec.error) return { data: null, error: { message: spec.error } };
        let rows = spec.rows ?? [];
        const has = (r: Record<string, unknown>, c: unknown) => typeof c === 'string' && c in r;
        for (const [m, a] of call.ops) {
          if (m === 'eq') rows = rows.filter((r) => !has(r, a[0]) || r[a[0] as string] === a[1]);
          if (m === 'neq') rows = rows.filter((r) => !has(r, a[0]) || r[a[0] as string] !== a[1]);
          if (m === 'in') rows = rows.filter((r) => !has(r, a[0]) || (a[1] as unknown[]).includes(r[a[0] as string]));
          if (m === 'not' && a[1] === 'in') {
            const list = String(a[2]).replace(/^\(|\)$/g, '').split(',');
            rows = rows.filter((r) => !has(r, a[0]) || !list.includes(String(r[a[0] as string])));
          }
        }
        return { data: rows, error: null };
      };
      for (const m of ['select', 'eq', 'neq', 'in', 'not', 'order', 'limit']) chain[m] = (...args: unknown[]) => { call.ops.push([m, args]); return chain; };
      chain.maybeSingle = () => {
        const r = run();
        return Promise.resolve({ data: r.error ? null : (r.data as unknown[])[0] ?? null, error: r.error });
      };
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => { try { return resolve(run()); } catch (e) { return reject(e); } };
      return chain;
    },
  };
}

function tables(over: Record<string, Spec> = {}): Record<string, Spec> {
  return {
    procurement_rfqs: { rows: [
      { organization_id: ORG, id: RFQ, rfq_number: 'COT-260924-98CDA', status: 'OPEN', response_due: '2026-09-27' },
    ] },
    procurement_rfq_suppliers: { rows: [
      { organization_id: ORG, rfq_id: RFQ, id: INV_A, supplier_id: SUP_A },
      { organization_id: ORG, rfq_id: RFQ, id: INV_B, supplier_id: SUP_B },
    ] },
    procurement_rfq_lines: { rows: [
      { organization_id: ORG, rfq_id: RFQ, id: 'l1', item_id: 'item-cabo', quantity: '500', required_by: '2026-09-30' },
    ] },
    supply_items: { rows: [{ organization_id: ORG, id: 'item-cabo', code: 'CABO-35-XLPE', description: 'Cabo de potência 35 mm² XLPE 15 kV', unit: 'm' }] },
    supplier_profiles: { rows: [
      { organization_id: ORG, id: SUP_A, party_id: 'pa', status: 'HOMOLOGATED', contact_name: 'Rita', contact_email: 'vendas@cabosnorte.example' },
      { organization_id: ORG, id: SUP_B, party_id: 'pb', status: 'HOMOLOGATED', contact_name: null, contact_email: null },
      { organization_id: ORG, id: SUP_C, party_id: 'pc', status: 'SUSPENDED', contact_name: null, contact_email: 'c@c.example' },
    ] },
    parties: { rows: [
      { organization_id: ORG, id: 'pa', legal_name: '[QA] Cabos Norte Ltda', trade_name: 'Cabos Norte' },
      { organization_id: ORG, id: 'pb', legal_name: '[QA] Fios Pará Ltda', trade_name: null },
      { organization_id: ORG, id: 'pc', legal_name: 'Suspensa Ltda', trade_name: null },
    ] },
    organizations: { rows: [{ id: ORG, name: 'Insight Engenharia' }] },
    email_dispatches: { rows: [] },
    // Propostas com preço existem — o envio só pergunta QUEM já cotou (nunca o preço). Aqui, de um fornecedor não convidado.
    supplier_quotes: { rows: [{ organization_id: ORG, id: 'q', rfq_id: RFQ, supplier_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'RECEIVED',
      freight_amount: 900 }] },
    ...over,
  };
}

const input = (over: Partial<Parameters<typeof sendRfqInvitations>[0]> = {}) => ({
  organizationId: ORG, actor: { id: 'u-compras', email: 'compras@insight.example' }, rfqId: RFQ, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.current = fakeDb(tables());
  mocks.sendAppEmail.mockResolvedValue({ outcome: 'SENT', provider: 'resend', messageId: 'm-1' });
  mocks.logAuditEventServer.mockResolvedValue({ ok: true });
  mocks.resolveOwnerNames.mockResolvedValue({ 'u-compras': 'Carla Compras' });
});

/* ── 1. O e-mail ────────────────────────────────────────────────────────── */

describe('o pedido de cotação (e-mail)', () => {
  const msg = rfqEmail({
    organization: 'Insight Engenharia', rfqNumber: 'COT-260924-98CDA', supplierName: 'Cabos Norte', contactName: 'Rita',
    responseDue: '2026-09-27', buyer: { name: 'Carla Compras', email: 'compras@insight.example' },
    lines: [{ code: 'CABO-35-XLPE', description: 'Cabo de potência 35 mm² XLPE 15 kV', quantity: 500, unit: 'm', requiredBy: '2026-09-30' }],
  });

  it('diz o item, a quantidade, a unidade, a necessidade, o prazo de resposta e como responder', () => {
    expect(msg.subject).toBe('Pedido de cotação COT-260924-98CDA — Insight Engenharia');
    expect(msg.text).toContain('Olá, Rita.');
    expect(msg.text).toContain('- CABO-35-XLPE — Cabo de potência 35 mm² XLPE 15 kV: 500 m · necessário até 30/09/2026');
    expect(msg.text).toContain('Prazo para resposta: 27/09/2026.');
    expect(msg.text).toContain('preço unitário, frete, impostos, prazo de entrega em dias, condição de pagamento e validade da proposta');
    expect(msg.text).toContain('Responda a Carla Compras (compras@insight.example) citando o número COT-260924-98CDA.');
    expect(msg.html).toContain('<strong>COT-260924-98CDA</strong>');
  });

  it('nunca preço interno, estimativa nem os outros fornecedores; HTML escapado', () => {
    expect(`${msg.text}${msg.html}`).not.toMatch(/R\$|estimad|or[çc]amento|Fios Pará/i);
    const evil = rfqEmail({ organization: '<b>X</b>', rfqNumber: 'COT-1', supplierName: 'S & Cia', contactName: null, responseDue: null,
      buyer: { name: null, email: null }, lines: [{ code: null, description: '<script>x</script>', quantity: 1.5, unit: null, requiredBy: null }] });
    expect(evil.html).not.toContain('<script>');
    expect(evil.html).toContain('&lt;script&gt;');
    expect(evil.text).toContain('Olá, S & Cia.');
    expect(evil.text).toContain('Prazo para resposta: o quanto antes.');
    expect(evil.text).toContain('Responda ao contato de compras de <b>X</b> citando o número COT-1.');
    expect(evil.text).toContain('- <script>x</script>: 1,5');
  });

  it('chave de idempotência estável por fornecedor da cotação; desfecho do transporte dito como é', () => {
    expect(rfqIdempotencyKey(RFQ, SUP_A)).toBe(`rfq:${RFQ}:supplier:${SUP_A}`);
    expect(outcomeOf({ outcome: 'SENT', provider: 'resend', messageId: 'x' }).outcome).toBe('SENT');
    expect(outcomeOf({ outcome: 'SENT', provider: 'capture', messageId: 'x' })).toEqual({ outcome: 'SIMULATED',
      message: 'Registrado — ambiente de teste: o e-mail ficou no coletor local e não foi ao fornecedor.' });
    expect(outcomeOf({ outcome: 'SIMULATED', provider: 'none', messageId: null })).toEqual({ outcome: 'SIMULATED',
      message: 'Simulado — o envio de e-mail está desligado nesta instalação.' });
  });
});

/* ── 2. O ato ───────────────────────────────────────────────────────────── */

describe('sendRfqInvitations', () => {
  it('envia aos convidados com e-mail; sem e-mail → NO_CONTACT; idempotência e vínculo com o convite; auditoria sem endereço', async () => {
    const calls: Call[] = [];
    mocks.db.current = fakeDb(tables(), calls);
    const out = await sendRfqInvitations(input({ headers: new Headers({ 'x-forwarded-for': '10.0.0.1' }) }));
    expect(out).toEqual({ status: 200, body: { ok: true, results: [
      { supplierId: SUP_A, name: 'Cabos Norte', outcome: 'SENT', message: 'Pedido de cotação enviado para o e-mail cadastrado.' },
      { supplierId: SUP_B, name: '[QA] Fios Pará Ltda', outcome: 'NO_CONTACT', message: 'Sem e-mail cadastrado — atualize o contato do fornecedor.' },
    ] } });
    expect(mocks.sendAppEmail).toHaveBeenCalledTimes(1);
    const [msg, opts] = mocks.sendAppEmail.mock.calls[0];
    expect(msg.to).toBe('vendas@cabosnorte.example');
    expect(msg.text).toContain('500 m · necessário até 30/09/2026');
    expect(msg.text).toContain('Carla Compras (compras@insight.example)');
    expect(opts).toEqual({ idempotencyKey: `rfq:${RFQ}:supplier:${SUP_A}`, organizationId: ORG, related: { type: RFQ_DISPATCH_TYPE, id: INV_A } });
    // quem enviou o quê a quem: cada convite com o seu desfecho (o ator é o da sessão, gravado pela auditoria)
    expect(mocks.logAuditEventServer).toHaveBeenCalledWith({ organizationId: ORG, action: 'supply.rfq.sent', entityType: 'procurement_rfq',
      entityId: RFQ, metadata: { rfq_number: 'COT-260924-98CDA', suppliers: 2, outcomes: { SENT: 1, NO_CONTACT: 1 }, results: [
        { supplier_id: SUP_A, invitation_id: INV_A, outcome: 'SENT' }, { supplier_id: SUP_B, invitation_id: INV_B, outcome: 'NO_CONTACT' }] } },
    expect.any(Headers));
    expect(JSON.stringify(mocks.logAuditEventServer.mock.calls)).not.toContain('@');
    // toda leitura na organização; das propostas só QUEM cotou (nunca preço) e as linhas de proposta nunca
    for (const c of calls.filter((x) => x.table !== 'organizations')) {
      expect(c.ops.some(([m, a]) => m === 'eq' && a[0] === 'organization_id' && a[1] === ORG), `${c.table} sem inquilino`).toBe(true);
    }
    expect(calls.filter((c) => c.table === 'supplier_quotes').map((c) => c.ops.find(([m]) => m === 'select')?.[1][0])).toEqual(['supplier_id']);
    expect(calls.some((c) => c.table === 'supplier_quote_lines')).toBe(false);
  });

  it('quem já mandou proposta não recebe o pedido — nem pedido explicitamente, nem no "todos"', async () => {
    mocks.db.current = fakeDb(tables({ supplier_quotes: { rows: [
      { organization_id: ORG, id: 'q1', rfq_id: RFQ, supplier_id: SUP_A, status: 'RECEIVED' },
      { organization_id: ORG, id: 'q0', rfq_id: RFQ, supplier_id: SUP_B, status: 'WITHDRAWN' },
    ] } }));
    const out = await sendRfqInvitations(input());
    expect(out.body).toEqual({ ok: true, results: [
      { supplierId: SUP_A, name: 'Cabos Norte', outcome: 'FAILED', message: 'Proposta já registrada nesta cotação — o pedido não é reenviado.' },
      // a proposta retirada não conta: segue o caminho normal (aqui, sem e-mail)
      { supplierId: SUP_B, name: '[QA] Fios Pará Ltda', outcome: 'NO_CONTACT', message: 'Sem e-mail cadastrado — atualize o contato do fornecedor.' },
    ] });
    expect(mocks.sendAppEmail).not.toHaveBeenCalled();
  });

  it('prospecto cadastrado pela busca da Apex na internet não recebe e-mail (contato não verificado); cadastrado por pessoa, sim', async () => {
    const web = 'Encontrado pela busca da Apex na internet em 25/09 — NÃO homologado: verificar cadastro, documentação e capacidade antes de convidar.';
    mocks.db.current = fakeDb(tables({ supplier_profiles: { rows: [
      { organization_id: ORG, id: SUP_A, party_id: 'pa', status: 'PROSPECT', contact_name: null, contact_email: 'vendas@achado.example', notes: web },
      { organization_id: ORG, id: SUP_B, party_id: 'pb', status: 'PROSPECT', contact_name: 'Ana', contact_email: 'ana@fios.example', notes: 'Indicação da obra' },
    ] } }));
    const out = await sendRfqInvitations(input());
    expect(out.body).toMatchObject({ ok: true, results: [
      { supplierId: SUP_A, outcome: 'FAILED',
        message: 'Prospecto encontrado pela busca da Apex na internet: o contato não foi verificado — verifique e homologue em Compras antes de enviar.' },
      { supplierId: SUP_B, outcome: 'SENT' },
    ] });
    expect(mocks.sendAppEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendAppEmail.mock.calls[0][0].to).toBe('ana@fios.example');
  });

  it('sem a leitura de partes: o nome do fornecedor volta "Restrito" (o e-mail ao fornecedor segue com o nome dele)', async () => {
    const out = await sendRfqInvitations(input({ supplierIds: [SUP_A], names: false }));
    expect(out.body).toMatchObject({ ok: true, results: [{ supplierId: SUP_A, name: 'Restrito', outcome: 'SENT' }] });
    expect(mocks.sendAppEmail.mock.calls[0][0].text).toContain('Olá, Rita.');
  });

  it('já enviado → ALREADY_SENT sem reenviar; coletor de QA → SIMULATED', async () => {
    mocks.db.current = fakeDb(tables({ email_dispatches: { rows: [
      { organization_id: ORG, related_entity_type: RFQ_DISPATCH_TYPE, related_entity_id: INV_A, status: 'sent', provider: 'resend',
        created_at: '2026-09-24T16:05:00Z' },
    ] } }));
    let out = await sendRfqInvitations(input({ supplierIds: [SUP_A] }));
    expect(out.body).toEqual({ ok: true, results: [{ supplierId: SUP_A, name: 'Cabos Norte', outcome: 'ALREADY_SENT',
      message: 'Já enviado em 24/09/2026, 13:05.' }] });
    expect(mocks.sendAppEmail).not.toHaveBeenCalled();

    mocks.db.current = fakeDb(tables());
    mocks.sendAppEmail.mockResolvedValue({ outcome: 'SENT', provider: 'capture', messageId: 'mp-1' });
    out = await sendRfqInvitations(input({ supplierIds: [SUP_A] }));
    expect(out.body).toMatchObject({ ok: true, results: [{ supplierId: SUP_A, outcome: 'SIMULATED' }] });

    // o coletor grava `sent` com provider `capture`: não conta como enviado — nem "Já enviado", nem "Cotação enviada" na releitura
    mocks.db.current = fakeDb(tables({ email_dispatches: { rows: [
      { organization_id: ORG, related_entity_type: RFQ_DISPATCH_TYPE, related_entity_id: INV_A, status: 'sent', provider: 'capture',
        created_at: '2026-09-24T16:05:00Z' },
    ] } }));
    out = await sendRfqInvitations(input({ supplierIds: [SUP_A] }));
    expect(out.body).toMatchObject({ ok: true, results: [{ supplierId: SUP_A, outcome: 'SIMULATED' }] });
  });

  it('falha do transporte vira FAILED só naquele fornecedor; suspenso não recebe', async () => {
    mocks.db.current = fakeDb(tables({
      procurement_rfq_suppliers: { rows: [
        { organization_id: ORG, rfq_id: RFQ, id: INV_A, supplier_id: SUP_A },
        { organization_id: ORG, rfq_id: RFQ, id: INV_C, supplier_id: SUP_C },
      ] },
    }));
    mocks.sendAppEmail.mockRejectedValueOnce(new EmailTransientError('rate_limit_exceeded', 'x'));
    let out = await sendRfqInvitations(input());
    expect(out.body).toEqual({ ok: true, results: [
      { supplierId: SUP_A, name: 'Cabos Norte', outcome: 'FAILED', message: 'Não foi possível enviar agora — tente de novo em instantes.' },
      { supplierId: SUP_C, name: 'Suspensa Ltda', outcome: 'FAILED', message: 'Fornecedor suspenso ou bloqueado não recebe pedido de cotação.' },
    ] });
    mocks.sendAppEmail.mockRejectedValueOnce(new EmailPermanentError('invalid_recipient', 'x'));
    out = await sendRfqInvitations(input({ supplierIds: [SUP_A] }));
    expect(out.body).toMatchObject({ ok: true, results: [{ outcome: 'FAILED',
      message: 'O envio foi recusado (endereço inválido ou transporte não configurado).' }] });
  });

  it('recusas: outra organização/inexistente 404; cotação não aberta 422; fornecedor não convidado 422 — sem enviar nada', async () => {
    expect(await sendRfqInvitations(input({ organizationId: '99999999-9999-4999-8999-999999999999' })))
      .toEqual({ status: 404, body: { ok: false, error: 'Cotação não encontrada nesta organização.' } });
    mocks.db.current = fakeDb(tables({ procurement_rfqs: { rows: [
      { organization_id: ORG, id: RFQ, rfq_number: 'COT-1', status: 'DECIDED', response_due: null }] } }));
    expect(await sendRfqInvitations(input())).toEqual({ status: 422, body: { ok: false, error: 'Só cotação aberta é enviada ao fornecedor.' } });
    mocks.db.current = fakeDb(tables());
    expect(await sendRfqInvitations(input({ supplierIds: [SUP_A, SUP_C] })))
      .toEqual({ status: 422, body: { ok: false, error: 'Só fornecedor convidado para esta cotação recebe o pedido.' } });
    mocks.db.current = fakeDb(tables({ procurement_rfq_suppliers: { rows: [] } }));
    expect(await sendRfqInvitations(input())).toEqual({ status: 422, body: { ok: false, error: 'Esta cotação não tem fornecedor convidado.' } });
    expect(mocks.sendAppEmail).not.toHaveBeenCalled();
    expect(mocks.logAuditEventServer).not.toHaveBeenCalled();
  });

  it('a auditoria que falha não desfaz nem repete o envio', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.logAuditEventServer.mockResolvedValue({ ok: false, reason: 'write-failed', error: 'x' });
    const out = await sendRfqInvitations(input({ supplierIds: [SUP_A] }));
    expect(out.body).toMatchObject({ ok: true, results: [{ outcome: 'SENT' }] });
    expect(mocks.sendAppEmail).toHaveBeenCalledTimes(1);
  });
});

/* ── 3. O livro de envios ───────────────────────────────────────────────── */

describe('readRfqDispatches', () => {
  it('só `sent` por transporte que entrega (nunca o coletor de QA), do tipo do convite, o mais antigo por convite; só id e data', async () => {
    const calls: Call[] = [];
    const db = fakeDb({ email_dispatches: { rows: [
      { organization_id: ORG, related_entity_type: RFQ_DISPATCH_TYPE, related_entity_id: INV_A, status: 'sent', provider: 'resend', created_at: '2026-09-24T18:00:00Z' },
      { organization_id: ORG, related_entity_type: RFQ_DISPATCH_TYPE, related_entity_id: INV_A, status: 'sent', provider: 'resend', created_at: '2026-09-24T16:00:00Z' },
      { organization_id: ORG, related_entity_type: RFQ_DISPATCH_TYPE, related_entity_id: INV_B, status: 'simulated', provider: 'none', created_at: '2026-09-24T16:00:00Z' },
      { organization_id: ORG, related_entity_type: RFQ_DISPATCH_TYPE, related_entity_id: INV_B, status: 'sent', provider: 'capture', created_at: '2026-09-24T15:00:00Z' },
      { organization_id: ORG, related_entity_type: 'calendar_event', related_entity_id: INV_C, status: 'sent', provider: 'resend', created_at: '2026-09-24T16:00:00Z' },
    ] } }, calls);
    const out = await readRfqDispatches(ORG, [INV_A, INV_B, INV_C, 'não-uuid'], db as never);
    expect(Object.fromEntries(out)).toEqual({ [INV_A]: '2026-09-24T16:00:00Z' });
    expect(calls[0].ops.find(([m]) => m === 'select')?.[1][0]).toBe('related_entity_id,created_at');
    expect(await readRfqDispatches(ORG, [], db as never)).toEqual(new Map());
  });
});

/* ── 4. A rota ──────────────────────────────────────────────────────────── */

describe('POST /api/supply/procurement/rfqs/[id]/send', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (body?: string) => new Request(`http://x/api/supply/procurement/rfqs/${RFQ}/send`, { method: 'POST', body });
  const as = (perms: string[]) => ({ organizationId: ORG, user: { id: 'u-compras', email: 'compras@insight.example' }, permissions: new Set(perms) });
  const session = as(['procurement.source', 'procurement.view']);

  it('alçada: procurement.source E a leitura de cotações; a recusa em português, nunca a chave da permissão', async () => {
    const { NextResponse } = await import('next/server');
    const { POST } = await import('@/app/api/supply/procurement/rfqs/[id]/send/route');
    mocks.requireOperationsSession.mockResolvedValue({ error: NextResponse.json({ ok: false }, { status: 401 }) });
    expect((await POST(post(), ctx(RFQ))).status).toBe(401);
    // sem a alçada de conduzir cotações
    mocks.requireOperationsSession.mockResolvedValue(as(['procurement.view']));
    let res = await POST(post(), ctx(RFQ));
    expect(res.status).toBe(403);
    let body = await res.json();
    expect(body.error).toBe('Seu perfil não pode enviar pedidos de cotação: isso cabe a quem conduz as cotações em Compras.');
    // alçada sem a leitura de cotações (papel sob medida): a resposta listaria o que a RLS esconde
    mocks.requireOperationsSession.mockResolvedValue(as(['procurement.source']));
    res = await POST(post(), ctx(RFQ));
    expect(res.status).toBe(403);
    body = await res.json();
    expect(body.error).toBe('Seu perfil não lê as cotações de Compras — o envio fica com quem as acompanha.');
    expect(String(body.error)).not.toMatch(/\b[a-z_]+\.[a-z_.]+\b/);
    expect(mocks.sendAppEmail).not.toHaveBeenCalled();
  });

  it('nome do fornecedor só com a leitura de partes (a regra do Dashboard): só supply.view → "Restrito"', async () => {
    mocks.requireOperationsSession.mockResolvedValue(as(['procurement.source', 'supply.view']));
    const { POST } = await import('@/app/api/supply/procurement/rfqs/[id]/send/route');
    const res = await POST(post(JSON.stringify({ supplierIds: [SUP_A] })), ctx(RFQ));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, results: [{ supplierId: SUP_A, name: 'Restrito', outcome: 'SENT' }] });
  });

  it('id e corpo validados; corpo vazio = todos os convidados; o desfecho volta com o status do ato', async () => {
    mocks.requireOperationsSession.mockResolvedValue(session);
    const { POST } = await import('@/app/api/supply/procurement/rfqs/[id]/send/route');
    expect((await POST(post(), ctx('x;drop'))).status).toBe(400);
    expect((await POST(post('{nope'), ctx(RFQ))).status).toBe(400);
    const bad = await POST(post(JSON.stringify({ supplierIds: ['não-uuid'] })), ctx(RFQ));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: 'Fornecedor inválido.' });
    const res = await POST(post(), ctx(RFQ));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ ok: true, results: [{ supplierId: SUP_A, outcome: 'SENT' }, { supplierId: SUP_B, outcome: 'NO_CONTACT' }] });
    const other = await POST(post(JSON.stringify({ supplierIds: [SUP_C] })), ctx(RFQ));
    expect(other.status).toBe(422);
  });

  it('falha inesperada → 500 com mensagem neutra', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.requireOperationsSession.mockResolvedValue(session);
    mocks.db.current = fakeDb(tables({ procurement_rfqs: { error: 'down' } }));
    const { POST } = await import('@/app/api/supply/procurement/rfqs/[id]/send/route');
    const res = await POST(post(), ctx(RFQ));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: 'Não foi possível enviar a cotação agora. Tente de novo em instantes.' });
  });
});
