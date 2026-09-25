/**
 * ALERTA DE ASO: O RESUMO DE SAÚDE NÃO VAI PARA ENDEREÇO DIGITADO (QA isolado).
 *
 * Antes: `POST /api/workforce/aso-alerts { recipients: [...] }` mandava nomes,
 * lotação e situação de exame ocupacional a qualquer e-mail, sem validação.
 * Agora só membros com vínculo ativo e `people.view_sensitive_data` nesta
 * organização (migration 245), escolhidos por referência; assunto neutro;
 * transporte compartilhado com chave de idempotência e registro.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=api tests/qa-live/aso-alerts.spec.ts
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { apiAs, one, qaDb, qaLive, tag } from './support';

test.describe.configure({ mode: 'serial' });

const T = tag();
const VICTIM = `externo.${T.toLowerCase()}@example.test`;
const ROUTE = '/api/workforce/aso-alerts';
const MAILPIT = 'http://127.0.0.1:55424';
const requestId = crypto.randomUUID();
let db: pg.Client;
let personId: string;

const mails = async (address: string) => {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=200`);
  return res.ok ? ((await res.json()).messages ?? []) as Array<{ ID: string; Subject: string; Created: string }> : [];
};

test.beforeAll(async () => {
  db = await qaDb();
  // Uma pessoa ativa sem ASO enviado: pendência "sem documento" — há o que comunicar.
  personId = (await one<{ id: string }>(db, `INSERT INTO public.people (organization_id, full_name, status, department)
    VALUES ($1, $2, 'active', 'Montagem') RETURNING id`, [qaLive().organization.id, `Colaborador ASO ${T}`])).id;
});
test.afterAll(async () => {
  await db?.query(`DELETE FROM public.people WHERE id = $1`, [personId]).catch(() => undefined);
  await db?.end();
});

test('1 · o corpo antigo com endereço livre é RECUSADO — o resumo de saúde não sai para fora', async () => {
  const owner = await apiAs('owner');
  const legacy = await owner.post(ROUTE, { data: { recipients: [VICTIM] } });
  expect(legacy.status(), await legacy.text()).toBe(400);
  const smuggled = await owner.post(ROUTE, { data: { request_id: crypto.randomUUID(), to: [{ type: 'member', id: qaLive().users.owner.id, email: VICTIM }] } });
  expect(smuggled.status()).toBe(400);
  const raw = await owner.post(ROUTE, { data: { request_id: crypto.randomUUID(), to: [VICTIM] } });
  expect(raw.status()).toBe(400);
  expect(await mails(VICTIM)).toHaveLength(0);
});

test('2 · destinatário só da lista autorizada: sem dado sensível, outro inquilino ou id inventado → 422; teto explícito', async () => {
  const live = qaLive();
  const owner = await apiAs('owner');
  for (const id of [live.users.rh.id, live.users.outsider.id, crypto.randomUUID()]) {
    const res = await owner.post(ROUTE, { data: { request_id: crypto.randomUUID(), to: [{ type: 'member', id }] } });
    expect(res.status(), id).toBe(422);
  }
  const many = Array.from({ length: 21 }, () => ({ type: 'member', id: crypto.randomUUID() }));
  expect((await owner.post(ROUTE, { data: { request_id: crypto.randomUUID(), to: many } })).status()).toBe(400);
  // Quem não vê dado sensível não envia nem lista destinatários.
  expect((await (await apiAs('rh')).post(ROUTE, { data: { request_id: crypto.randomUUID(), to: [{ type: 'member', id: live.users.owner.id }] } })).status()).toBe(403);
  expect((await (await apiAs('rh')).get(`${ROUTE}?view=recipients`)).status()).toBe(403);
  const dir = await (await owner.get(`${ROUTE}?view=recipients`)).json();
  const ids = dir.members.map((m: { id: string }) => m.id);
  expect(ids).toContain(live.users.owner.id);
  expect(ids).not.toContain(live.users.rh.id);
  expect(ids).not.toContain(live.users.outsider.id);
});

test('3 · envio tipado: pelo transporte compartilhado, assunto neutro, registrado; ensaio não devolve o conteúdo', async () => {
  const live = qaLive();
  const owner = await apiAs('owner');
  const rehearsal = await owner.post(ROUTE, { data: { request_id: crypto.randomUUID(), to: [{ type: 'member', id: live.users.owner.id }], test: true } });
  const rb = await rehearsal.json();
  expect(rehearsal.status(), JSON.stringify(rb)).toBe(200);
  expect(rb).toMatchObject({ test: true, simulated: true, recipients: 1 });
  expect(JSON.stringify(rb)).not.toContain(`Colaborador ASO ${T}`);

  const before = (await mails(live.users.owner.email)).length;
  const res = await owner.post(ROUTE, { data: { request_id: requestId, to: [{ type: 'member', id: live.users.owner.id }] } });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ ok: true, recipients: 1, delivered: { sent: 1, failed: 0 } });
  await expect.poll(async () => (await mails(live.users.owner.email)).length, { timeout: 15_000 }).toBe(before + 1);
  const newest = (await mails(live.users.owner.email))[0];
  expect(newest.Subject).toMatch(/^\[SST\] Resumo de vencimentos de ASO — \d{2}\/\d{2}\/\d{4}$/);
  expect(newest.Subject).not.toContain(T);
  const ledger = await one<{ n: number; subject: string }>(db, `SELECT count(*)::int n, max(subject) subject FROM public.email_dispatches
    WHERE related_entity_type = 'aso_alert_digest' AND related_entity_id = $1 AND status = 'sent'`, [requestId]);
  expect(ledger.n).toBe(1);
  expect(ledger.subject).not.toMatch(/vencido|Colaborador/);
});

test('4 · repetir o mesmo pedido não manda de novo a quem já recebeu', async () => {
  const live = qaLive();
  const before = (await mails(live.users.owner.email)).length;
  const res = await (await apiAs('owner')).post(ROUTE, { data: { request_id: requestId, to: [{ type: 'member', id: live.users.owner.id }] } });
  expect(res.status()).toBe(200);
  expect((await res.json()).delivered).toMatchObject({ sent: 0, skipped: 1 });
  expect((await mails(live.users.owner.email)).length).toBe(before);
});
