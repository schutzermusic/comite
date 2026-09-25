/**
 * AGENDA: O E-MAIL NÃO É UM RELAY (QA isolado, rota real, captura Mailpit).
 *
 * Antes: qualquer papel com meetings.create/tasks.create mandava pela rota o
 * assunto, o HTML e os destinatários que quisesse — o servidor repassava ao
 * provedor com o remetente da plataforma. Agora o navegador só nomeia o fato
 * ({ kind, <registro>_id }); o servidor relê o registro na sessão RLS de quem
 * pediu, na organização ativa, tira os destinatários do registro e o conteúdo
 * dos modelos dele.
 *
 * E as notificações in-app: pela RLS REAL do navegador (anon + JWT), o
 * destinatário lê e marca como lida — não reescreve nem apaga.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=api tests/qa-live/agenda-email.spec.ts
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { apiAs, browserClientAs, one, qaDb, qaLive, tag } from './support';
import { mailBody, mailsTo } from './decisions-support';

test.describe.configure({ mode: 'serial' });

const T = tag();
const GUEST = `convidado.${T.toLowerCase()}@example.test`;
const VICTIM = `vitima.${T.toLowerCase()}@example.test`;
const WATCHER = `observador.${T.toLowerCase()}@example.test`;
const SEND = '/api/agenda/email/send';
let db: pg.Client;
let eventId: string;
let taskId: string;

const dispatches = async (sql: string, params: unknown[]) =>
  (await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.email_dispatches WHERE ${sql}`, params)).n;

test.beforeAll(async () => {
  db = await qaDb();
  const live = qaLive();
  const org = live.organization.id;
  const gestor = live.users.gestor;
  eventId = (await one<{ id: string }>(db, `INSERT INTO public.calendar_events
      (organization_id, owner_user_id, type, title, description, starts_at, ends_at, status, visibility, meeting_link)
    VALUES ($1,$2,'meeting',$3,'<script>alert(1)</script> pauta', now() + interval '2 days', now() + interval '2 days 1 hour',
      'scheduled','organization','javascript:alert(document.cookie)') RETURNING id`,
  [org, gestor.id, `Revisão ${T} <img src=x onerror=alert(1)>`])).id;
  await db.query(`INSERT INTO public.calendar_event_attendees (event_id, organization_id, user_id, email, name, role, is_external)
    VALUES ($1,$2,$3,$4,'Gestor','organizer',false), ($1,$2,NULL,$5,'Convidado','attendee',true)`,
  [eventId, org, gestor.id, gestor.email, GUEST]);
  taskId = (await one<{ id: string }>(db, `INSERT INTO public.tasks
      (organization_id, creator_user_id, title, priority, status, notify_emails)
    VALUES ($1,$2,$3,'high','todo',$4::jsonb) RETURNING id`,
  [org, live.users.financeiro.id, `Tarefa ${T}`, JSON.stringify([WATCHER])])).id;
});
test.afterAll(async () => { await db?.end(); });

test('1 · o corpo livre {subject, html, recipients} é RECUSADO — nada sai, nada é registrado', async () => {
  const api = await apiAs('gestor');
  const res = await api.post(SEND, { data: {
    subject: `PHISH ${T}`, html: '<a href="https://evil.example/login">Confirme sua senha</a>', recipients: [VICTIM],
  } });
  expect(res.status(), await res.text()).toBe(400);
  expect((await res.json()).error).toMatch(/servidor/);
  // Mesmo tipado, conteúdo e destinatários do cliente não passam.
  const smuggled = await api.post(SEND, { data: { kind: 'meeting_invite', event_id: eventId, recipients: [VICTIM], html: '<b>x</b>' } });
  expect(smuggled.status()).toBe(400);
  expect(await dispatches(`subject LIKE $1 OR target_email = $2`, [`%PHISH ${T}%`, VICTIM])).toBe(0);
  expect(await mailsTo(VICTIM, 'PHISH')).toHaveLength(0);
});

test('2 · convite tipado: destinatário do REGISTRO, conteúdo escapado do servidor, .ics anexo, histórico gravado', async () => {
  const res = await (await apiAs('gestor')).post(SEND, { data: { kind: 'meeting_invite', event_id: eventId } });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ ok: true, kind: 'meeting_invite', recipients: 1, sent: 1, failed: 0 });

  await expect.poll(async () => (await mailsTo(GUEST, `Revisão ${T}`)).length, { timeout: 15_000 }).toBe(1);
  const [msg] = await mailsTo(GUEST, `Revisão ${T}`);
  const full = await mailBody(msg.ID) as unknown as { HTML: string; Text: string; Attachments: Array<{ FileName: string; ContentType: string }> };
  expect(full.HTML).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(full.HTML).not.toContain('<img src=x');
  expect(full.HTML).not.toContain('<script>');
  expect(full.HTML).not.toMatch(/href="javascript:/i);
  expect(full.HTML).toContain(`/reunioes?event=${eventId}`);
  expect(full.Text).toContain(`Revisão ${T}`);
  expect(full.Attachments.map((a) => a.FileName)).toEqual(['reuniao.ics']);
  // O organizador não recebe o próprio convite.
  expect(await mailsTo(qaLive().users.gestor.email, `Revisão ${T}`)).toHaveLength(0);
  expect(await dispatches(`related_entity_type = 'calendar_event' AND related_entity_id = $1 AND status = 'sent'`, [eventId])).toBe(1);
});

test('3 · autoridade e inquilino: quem não gerencia a reunião, outra organização e papel sem permissão — recusados', async () => {
  const before = await dispatches(`related_entity_id = $1`, [eventId]);
  const rh = await (await apiAs('rh')).post(SEND, { data: { kind: 'meeting_invite', event_id: eventId } });
  expect([403, 404], await rh.text()).toContain(rh.status());
  const outsider = await (await apiAs('outsider')).post(SEND, { data: { kind: 'meeting_invite', event_id: eventId } });
  expect(outsider.status(), await outsider.text()).toBe(404);
  const compras = await (await apiAs('compras')).post(SEND, { data: { kind: 'meeting_invite', event_id: eventId } });
  expect(compras.status()).toBe(403);
  expect(await dispatches(`related_entity_id = $1`, [eventId])).toBe(before);
});

test('4 · tarefa: só quem criou avisa, para o que está gravado; fora da janela, não repete', async () => {
  const owner = await (await apiAs('owner')).post(SEND, { data: { kind: 'task_assigned', task_id: taskId } });
  expect(owner.status(), await owner.text()).toBe(403);

  const res = await (await apiAs('financeiro')).post(SEND, { data: { kind: 'task_assigned', task_id: taskId } });
  expect(res.status(), await res.text()).toBe(200);
  expect(await res.json()).toMatchObject({ recipients: 1, sent: 1 });
  await expect.poll(async () => (await mailsTo(WATCHER, `Tarefa ${T}`)).length, { timeout: 15_000 }).toBe(1);

  await db.query(`UPDATE public.tasks SET created_at = now() - interval '2 hours' WHERE id = $1`, [taskId]);
  const late = await (await apiAs('financeiro')).post(SEND, { data: { kind: 'task_assigned', task_id: taskId } });
  expect(late.status(), await late.text()).toBe(409);
  expect(await mailsTo(WATCHER, `Tarefa ${T}`)).toHaveLength(1);
});

test('5 · notificação in-app pela RLS real do navegador: lê e marca lida — não reescreve, não apaga', async () => {
  const live = qaLive();
  const fin = live.users.financeiro.id;
  const { id } = await one<{ id: string }>(db, `SELECT public.create_notification_for($1, $2, 'task_status', $3, NULL, '/reunioes') id`,
    [live.organization.id, fin, `Aviso ${T}`]);
  const sb = await browserClientAs('financeiro');

  const seen = await sb.from('notifications').select('id, title').eq('id', id);
  expect(seen.data).toEqual([{ id, title: `Aviso ${T}` }]);
  const rewrite = await sb.from('notifications').update({ title: 'FORJADO', link_url: 'https://evil.example' }).eq('id', id).select();
  expect(rewrite.error?.code, JSON.stringify(rewrite)).toBe('42501');
  const erase = await sb.from('notifications').delete().eq('id', id).select();
  expect(erase.error?.code, JSON.stringify(erase)).toBe('42501');
  const read = await sb.rpc('notification_mark_read', { p_notification_id: id });
  expect(read.data).toBe(true);

  const row = await one<{ title: string; link_url: string; read_at: string | null }>(db,
    `SELECT title, link_url, read_at FROM public.notifications WHERE id = $1`, [id]);
  expect(row.title).toBe(`Aviso ${T}`);
  expect(row.link_url).toBe('/reunioes');
  expect(row.read_at).not.toBeNull();
  // Outra pessoa não marca a notificação alheia.
  const other = await (await browserClientAs('gestor')).rpc('notification_mark_read', { p_notification_id: id });
  expect(other.data).toBe(false);
});

test('6 · atraso no cronograma: responsável e gestor tirados do REGISTRO (não do navegador); só quem reportou avisa', async () => {
  const live = qaLive();
  const org = live.organization.id;
  const projectId = `qa-agenda-${T.toLowerCase()}`;
  await db.query(`INSERT INTO public.projects (id, organization_id, project, created_by) VALUES ($1,$2,$3,$4)`, [projectId, org,
    JSON.stringify({ id: projectId, nome: `Projeto ${T}`, status: 'em_andamento', responsavel: { id: live.users.financeiro.id } }),
    live.users.gestor.id]);
  const item = await one<{ id: string }>(db, `INSERT INTO public.project_timeline_items
      (organization_id, project_id, title, type, status, responsible_user_id, created_by)
    VALUES ($1,$2,$3,'task','delayed',$4,$5) RETURNING id`,
  [org, projectId, `Atividade ${T}`, live.users.engenharia.id, live.users.gestor.id]);
  const log = await one<{ id: string }>(db, `INSERT INTO public.project_delay_logs
      (organization_id, project_id, timeline_item_id, reported_by, old_status, new_status, reason_category, new_forecast_finish)
    VALUES ($1,$2,$3,$4,'in_progress','delayed','supplier_delay', current_date + 10) RETURNING id`,
  [org, projectId, item.id, live.users.gestor.id]);

  const stranger = await (await apiAs('engenharia')).post(SEND, { data: { kind: 'timeline_delay', delay_log_id: log.id } });
  expect([403, 404], await stranger.text()).toContain(stranger.status());

  const res = await (await apiAs('gestor')).post(SEND, { data: { kind: 'timeline_delay', delay_log_id: log.id } });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({ recipients: 2, sent: 2, failed: 0 });
  for (const who of [live.users.financeiro.email, live.users.engenharia.email]) {
    await expect.poll(async () => (await mailsTo(who, `Atividade ${T}`)).length, { timeout: 15_000 }).toBe(1);
  }
  const [msg] = await mailsTo(live.users.financeiro.email, `Atividade ${T}`);
  const full = await mailBody(msg.ID);
  expect(full.HTML).toContain(`Projeto ${T}`);
  expect(full.HTML).toContain('Atraso de fornecedor');
  expect(await mailsTo(live.users.gestor.email, `Atividade ${T}`)).toHaveLength(0);
});
