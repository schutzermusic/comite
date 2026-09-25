/**
 * FOLHA: O E-MAIL DO FECHAMENTO NÃO É UM RELAY (QA isolado, rotas reais, Mailpit).
 *
 * Antes: quem tinha `people.payroll_send` mandava pela rota o remetente, os
 * destinatários, cc/bcc, o assunto, o HTML e anexos em base64 — o servidor
 * repassava ao provedor. Agora o navegador manda uma INTENÇÃO: o fechamento,
 * referências a membros ativos ou a contatos autorizados por quem administra a
 * folha, e ids de anexos do MESMO fechamento. Assunto, corpo, relatórios
 * gerados e remetente são do servidor; o envio passa pelo transporte
 * compartilhado com chave de idempotência.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=api tests/qa-live/payroll-email.spec.ts
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { apiAs, browserClientAs, one, qaDb, qaLive, tag } from './support';
import { mailBody, mailsTo } from './decisions-support';

test.describe.configure({ mode: 'serial' });

const T = tag();
const t = T.toLowerCase();
const COMPETENCE = `2${String(100 + Math.floor(Math.random() * 899))}-0${1 + Math.floor(Math.random() * 9)}`;
const VICTIM = `vitima.${t}@example.test`;
const CONTACT = `contabilidade.${t}@example.test`;
const SEND = '/api/payroll/email/send';
const MAILPIT = 'http://127.0.0.1:55424';
let db: pg.Client;
let batchId: string;
let otherBatchId: string;
let contactId: string;
let execPdfId: string;
let holeriteId: string;
let foreignAttachmentId: string;
const requestId = crypto.randomUUID();

const intent = (over: Record<string, unknown> = {}) => ({
  kind: 'payroll_closing_package', batch_id: batchId, audience: 'finance',
  to: [{ type: 'member', id: qaLive().users.financeiro.id }, { type: 'contact', id: contactId }],
  cc: [{ type: 'member', id: qaLive().users.gestor.id }],
  attachment_ids: [execPdfId, holeriteId], confirm_sensitive: true, request_id: crypto.randomUUID(), test: false, ...over,
});
const allMails = async (address: string) => {
  const q = encodeURIComponent(`to:"${address}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${q}&limit=200`);
  return res.ok ? ((await res.json()).messages ?? []) as Array<{ ID: string; Subject: string; From: { Address: string } }> : [];
};

async function newBatch(competence: string) {
  const live = qaLive();
  const b = await one<{ id: string }>(db, `INSERT INTO public.payroll_closing_batches
      (organization_id, competence_month, total_amount_cents, previous_month_amount_cents, variation_amount_cents,
       variation_percentage, headcount, status, created_by)
    VALUES ($1,$2,48250000,45100000,3150000,6.98,42,'validated',$3) RETURNING id`,
  [live.organization.id, competence, live.users.rh.id]);
  await db.query(`INSERT INTO public.payroll_cost_center_summaries
      (organization_id, batch_id, cost_center_label, amount_cents, previous_amount_cents, variation_amount_cents, variation_percentage, created_by)
    VALUES ($1,$2,'Engenharia de Campo <script>',30000000,27000000,3000000,11.11,$3),
           ($1,$2,'Administrativo SP',18250000,18100000,150000,0.83,$3)`, [live.organization.id, b.id, live.users.rh.id]);
  return b.id;
}

test.beforeAll(async () => {
  db = await qaDb();
  batchId = await newBatch(COMPETENCE);
  otherBatchId = await newBatch(`${COMPETENCE.slice(0, 4)}-12`); // mês 12 nunca colide com 01–09
});
test.afterAll(async () => { await db?.end(); });

test('1 · o corpo antigo (remetente, destinatários, HTML, anexos do navegador) é RECUSADO — nada sai', async () => {
  const rh = await apiAs('rh');
  const legacy = await rh.post(SEND, { data: {
    from: 'Diretoria <ceo@banco-falso.example>', subject: `PHISH ${T}`, html: '<a href="https://evil.example">Atualize seus dados</a>',
    recipients: [VICTIM], bcc: [VICTIM], attachments: [{ file_name: 'x.html', content_base64: 'PGgxPng8L2gxPg==', file_size: 0 }],
  } });
  expect(legacy.status(), await legacy.text()).toBe(400);
  expect((await legacy.json()).error).toMatch(/servidor/);

  const multipart = await rh.post(SEND, { multipart: {
    meta: JSON.stringify({ subject: `PHISH ${T}`, html: '<b>x</b>', recipients: [VICTIM] }),
    file_0: { name: 'malware.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') },
  } });
  expect(multipart.status(), await multipart.text()).toBe(415);

  // Até a intenção tipada recusa endereço cru na referência.
  const smuggled = await rh.post(SEND, { data: { kind: 'payroll_closing_package', batch_id: batchId, request_id: crypto.randomUUID(),
    to: [{ type: 'member', id: qaLive().users.financeiro.id, email: VICTIM }] } });
  expect(smuggled.status()).toBe(400);

  expect(await allMails(VICTIM)).toHaveLength(0);
  const dispatched = await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.payroll_email_dispatches WHERE $1 = ANY(recipients)`, [VICTIM]);
  expect(dispatched.n).toBe(0);
});

test('2 · contato externo só entra pela mão de quem administra a folha, com auditoria', async () => {
  const denied = await (await apiAs('rh')).post('/api/payroll/email/contacts', { data: { email: CONTACT, display_name: 'Contabilidade' } });
  expect(denied.status(), 'rh envia, mas não autoriza destinatário').toBe(403);
  const invalid = await (await apiAs('owner')).post('/api/payroll/email/contacts', { data: { email: 'a@b.c\r\nBcc: x@evil.example', display_name: 'X' } });
  expect(invalid.status()).toBe(400);
  const ok = await (await apiAs('owner')).post('/api/payroll/email/contacts', { data: { email: CONTACT, display_name: `Contabilidade ${T}` } });
  expect(ok.status(), await ok.text()).toBe(201);
  contactId = (await ok.json()).contact.id;

  const dir = await (await (await apiAs('rh')).get('/api/payroll/email/recipients')).json();
  expect(dir.can_manage_contacts).toBe(false);
  expect(dir.contacts.map((c: { id: string }) => c.id)).toContain(contactId);
  expect(dir.members.map((m: { id: string }) => m.id)).toContain(qaLive().users.financeiro.id);
  // O outro inquilino não aparece no diretório.
  expect(dir.members.map((m: { id: string }) => m.id)).not.toContain(qaLive().users.outsider.id);
});

test('3 · narrativa e relatórios anexáveis são do SERVIDOR, a partir dos números guardados', async () => {
  const rh = await apiAs('rh');
  const res = await rh.post('/api/payroll/ai/analyze', { data: { batch_id: batchId } });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  expect(body.attachments.map((a: { file_type: string }) => a.file_type).sort()).toEqual(['dashboard_snapshot', 'executive_pdf']);
  execPdfId = body.attachments.find((a: { file_type: string }) => a.file_type === 'executive_pdf').id;
  const stored = await one<{ has: boolean }>(db, `SELECT (metadata ? 'email_narrative') has FROM public.payroll_closing_batches WHERE id = $1`, [batchId]);
  expect(stored.has).toBe(true);

  // HTML do navegador não vira relatório anexável.
  const forged = await rh.post(`/api/payroll/batches/${batchId}/actions`, { data: {
    action: 'add_generated_attachment', file_type: 'executive_pdf', file_name: 'x.html', mime_type: 'text/html', content: '<script>alert(1)</script>',
  } });
  expect(forged.status()).toBe(400);

  // Um holerite (sensível) enviado pelo caminho de upload da folha.
  const up = await rh.post(`/api/payroll/batches/${batchId}/files`, { multipart: {
    file_type: 'holerite', file: { name: `holerite-${t}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% holerite QA\n') },
  } });
  expect(up.status(), await up.text()).toBe(200);
  holeriteId = (await up.json()).attachment.id;
  const other = await rh.post(`/api/payroll/batches/${otherBatchId}/files`, { multipart: {
    file_type: 'supporting_document', file: { name: `apoio-${t}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% apoio\n') },
  } });
  expect(other.status(), await other.text()).toBe(200);
  foreignAttachmentId = (await other.json()).attachment.id;
});

test('4 · envio tipado: endereços do diretório, remetente da plataforma, conteúdo escapado do servidor, anexos do cofre', async () => {
  const live = qaLive();
  const res = await (await apiAs('rh')).post(SEND, { data: intent({ request_id: requestId }) });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ ok: true, delivery_status: 'sent', recipients: 3, sent: 3, failed: 0 });

  for (const who of [live.users.financeiro.email, CONTACT, live.users.gestor.email]) {
    await expect.poll(async () => (await mailsTo(who, `Fechamento da Folha — ${COMPETENCE}`)).length, { timeout: 15_000 }).toBe(1);
  }
  const [msg] = await mailsTo(CONTACT, `Fechamento da Folha — ${COMPETENCE}`);
  const full = await mailBody(msg.ID) as unknown as { HTML: string; From: { Address: string }; Attachments: Array<{ FileName: string }> };
  expect(full.From.Address).toBe('no-reply@insightapex.co');
  expect(full.HTML).toContain('R$');
  expect(full.HTML).not.toContain('<script>');
  expect(full.HTML).toContain('&lt;script&gt;');
  const names = full.Attachments.map((a) => a.FileName);
  expect(names).toHaveLength(2);
  expect(names).toEqual(expect.arrayContaining([`holerite-${t}.pdf`, expect.stringMatching(/^relatorio-executivo-folha-.*\.html$/)]));

  const dispatch = await one<{ recipients: string[]; cc: string[]; delivery_status: string }>(db,
    `SELECT d.recipients, d.cc, d.delivery_status FROM public.payroll_email_dispatches d
       JOIN public.payroll_email_packages p ON p.id = d.package_id WHERE p.request_id = $1`, [requestId]);
  expect(dispatch.delivery_status).toBe('sent');
  expect(dispatch.recipients.sort()).toEqual([live.users.financeiro.email, CONTACT].sort());
  expect(dispatch.cc).toEqual([live.users.gestor.email]);
  const audit = await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.email_dispatches e
    JOIN public.payroll_email_packages p ON p.id = e.related_entity_id WHERE p.request_id = $1 AND e.status = 'sent'`, [requestId]);
  expect(audit.n).toBe(3);
});

test('5 · a mesma intenção repetida (duplo clique, nova tentativa) não manda de novo', async () => {
  const res = await (await apiAs('rh')).post(SEND, { data: intent({ request_id: requestId }) });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ replay: true, delivery_status: 'sent' });
  expect(await mailsTo(CONTACT, `Fechamento da Folha — ${COMPETENCE}`)).toHaveLength(1);
});

test('6 · recusas: sensível sem confirmação, anexo de outro fechamento, fora do inquilino, contato revogado, sem permissão', async () => {
  const live = qaLive();
  const rh = await apiAs('rh');
  const before = (await allMails(CONTACT)).length;

  expect((await rh.post(SEND, { data: intent({ confirm_sensitive: false }) })).status()).toBe(400);
  expect((await rh.post(SEND, { data: intent({ attachment_ids: [foreignAttachmentId] }) })).status()).toBe(422);
  expect((await rh.post(SEND, { data: intent({ to: [{ type: 'member', id: live.users.outsider.id }] }) })).status()).toBe(422);
  expect((await rh.post(SEND, { data: intent({ to: [{ type: 'contact', id: crypto.randomUUID() }] }) })).status()).toBe(422);
  const outsider = await (await apiAs('outsider')).post(SEND, { data: intent() });
  expect(outsider.status(), 'fechamento de outro inquilino não existe para ele').toBe(404);
  const financeiro = await (await apiAs('financeiro')).post(SEND, { data: intent() });
  expect(financeiro.status(), 'papel sem people.payroll_send').toBe(403);

  // Revogado deixa de ser destinatário.
  const revoke = await (await apiAs('owner')).delete(`/api/payroll/email/contacts?id=${contactId}`);
  expect(revoke.status()).toBe(200);
  expect((await rh.post(SEND, { data: intent() })).status()).toBe(422);
  const row = await one<{ revoked: boolean }>(db, `SELECT revoked_at IS NOT NULL revoked FROM public.payroll_email_contacts WHERE id = $1`, [contactId]);
  expect(row.revoked).toBe(true);

  expect((await allMails(CONTACT)).length).toBe(before);
});

test('7 · pela RLS real do navegador: não forja linha de anexo, não reescreve narrativa nem rótulo (só o servidor escreve a folha)', async () => {
  const live = qaLive();
  const sb = await browserClientAs('rh');
  const forged = await sb.from('payroll_attachments').insert({
    organization_id: live.organization.id, batch_id: batchId, file_name: 'resumo.pdf', file_type: 'supporting_document',
    security_level: 'aggregate', storage_bucket: 'payroll-holerites', object_path: `/${live.organization.id}/${batchId}/holerite/x.pdf`,
  }).select();
  expect(forged.error?.code, JSON.stringify(forged)).toBe('42501');
  const relabel = await sb.from('payroll_attachments').update({ file_type: 'supporting_document', security_level: 'aggregate' }).eq('id', holeriteId).select();
  expect(relabel.error?.code, JSON.stringify(relabel)).toBe('42501');
  const narrative = await sb.from('payroll_closing_batches').update({ metadata: { email_narrative: { closing_email: 'https://evil.example' } } }).eq('id', batchId).select();
  expect(narrative.error?.code, JSON.stringify(narrative)).toBe('42501');
  const label = await sb.from('payroll_cost_center_summaries').update({ cost_center_label: 'Clique aqui' }).eq('batch_id', batchId).select();
  expect(label.error?.code, JSON.stringify(label)).toBe('42501');
  // A leitura pela RLS continua.
  const read = await sb.from('payroll_closing_batches').select('id').eq('id', batchId);
  expect(read.data).toEqual([{ id: batchId }]);
});

test('8 · quem teve o vínculo revogado deixa de ser destinatário no mesmo instante', async () => {
  const live = qaLive();
  const email = `desligado.${t}@example.test`;
  const uid = (await one<{ id: string }>(db, `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
    VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now()) RETURNING id`, [email])).id;
  try {
    await db.query(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active')`, [uid, live.organization.id, `Desligado ${T}`]);
    await db.query(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at)
      VALUES ($1,$2,'ACTIVE','INVITE',now()) ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'ACTIVE', disabled_at = NULL`, [live.organization.id, uid]);
    const before = await (await (await apiAs('rh')).get('/api/payroll/email/recipients')).json();
    expect(before.members.map((m: { id: string }) => m.id)).toContain(uid);

    await db.query(`UPDATE public.organization_memberships SET status = 'REVOKED', disabled_at = now() WHERE organization_id = $1 AND user_id = $2`, [live.organization.id, uid]);
    const after = await (await (await apiAs('rh')).get('/api/payroll/email/recipients')).json();
    expect(after.members.map((m: { id: string }) => m.id), 'perfil segue "active", mas o vínculo foi revogado').not.toContain(uid);
    const res = await (await apiAs('rh')).post(SEND, { data: intent({ to: [{ type: 'member', id: uid }], cc: [], attachment_ids: [execPdfId], confirm_sensitive: false }) });
    expect(res.status()).toBe(422);
    expect(await allMails(email)).toHaveLength(0);
  } finally {
    await db.query(`DELETE FROM auth.users WHERE id = $1`, [uid]);
  }
});
