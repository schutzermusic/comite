/**
 * ALERTA DE MARCO DE FATURAMENTO CHEGA NO SINO (QA isolado, rota real).
 *
 * Antes: a entrega in-app chamava `create_notification` — a porta do
 * NAVEGADOR, que resolve a organização por auth.uid(). No service role não há
 * auth.uid(): todo alerta in-app terminava FAILED ("Usuário sem organização
 * ativa") e ninguém era avisado no produto. Agora a entrega usa a porta de
 * SERVIDOR (`create_notification_for`, 195/242), com a organização do alerta.
 *
 * Idempotência e histórico preservados: o livro `contract_billing_alert_
 * dispatches` guarda uma linha por (alerta, pessoa, canal) com o id da
 * notificação; repetir a rotina não cria segundo aviso.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=api tests/qa-live/billing-alerts.spec.ts
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { apiAs, browserClientAs, one, qaDb, qaLive, tag } from './support';
import { TODAY } from './decisions-support';

test.describe.configure({ mode: 'serial' });

const T = tag();
let db: pg.Client;
let milestoneId: string;

const dispatch = async () => {
  const res = await (await apiAs('owner')).post('/api/contracts/billing/alerts/dispatch', { data: { asOf: TODAY, test: true } });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  return body;
};

test.beforeAll(async () => {
  db = await qaDb();
  const live = qaLive();
  const org = live.organization.id;
  const fin = live.users.financeiro.id;
  const contract = await one<{ id: string }>(db, `INSERT INTO public.contracts (organization_id, title, owner_user_id, contract_number, counterparty_name)
    VALUES ($1,$2,$3,$4,'Cliente QA') RETURNING id`, [org, `Contrato ${T}`, fin, `CT-${T}`]);
  milestoneId = (await one<{ id: string }>(db, `INSERT INTO public.contract_milestones
      (organization_id, contract_id, title, due_date, owner_user_id, billing_amount)
    VALUES ($1,$2,$3,$4::date + 7,$5, 12500) RETURNING id`, [org, contract.id, `Marco ${T}`, TODAY, fin])).id;
});
test.afterAll(async () => { await db?.end(); });

test('1 · o alerta in-app sai pela porta de servidor: DELIVERED, com a notificação no inquilino do alerta', async () => {
  await dispatch();
  const live = qaLive();
  const alert = await one<{ id: string }>(db, `SELECT id FROM public.contract_billing_milestone_alerts
    WHERE milestone_id = $1 AND as_of_date = $2::date`, [milestoneId, TODAY]);
  expect(alert, 'alerta materializado para o marco a 7 dias').toBeTruthy();
  const ledger = await one<{ state: string; notification_id: string | null; error_message: string | null }>(db,
    `SELECT state, notification_id, error_message FROM public.contract_billing_alert_dispatches
      WHERE alert_id = $1 AND recipient_user_id = $2 AND channel = 'in_app'`, [alert.id, live.users.financeiro.id]);
  expect(ledger, 'linha de entrega in-app').toBeTruthy();
  expect(ledger.error_message, 'antes: "Usuário sem organização ativa"').toBeNull();
  expect(ledger.state).toBe('DELIVERED');
  expect(ledger.notification_id).toBeTruthy();

  const n = await one<{ organization_id: string; recipient_user_id: string; type: string; link_url: string }>(db,
    `SELECT organization_id, recipient_user_id, type, link_url FROM public.notifications WHERE id = $1`, [ledger.notification_id]);
  expect(n).toMatchObject({ organization_id: live.organization.id, recipient_user_id: live.users.financeiro.id,
    type: 'contracts.billing.milestone_due' });
  expect(n.link_url).toMatch(new RegExp(`^/contratos\\?aba=faturamento&marco=${milestoneId}`));

  // O destinatário vê o aviso pela RLS real do navegador.
  const seen = await (await browserClientAs('financeiro')).from('notifications').select('id').eq('id', ledger.notification_id);
  expect(seen.data).toEqual([{ id: ledger.notification_id }]);
});

test('2 · repetir a rotina não gera segundo aviso nem reescreve o histórico', async () => {
  const live = qaLive();
  const before = await one<{ n: number; id: string }>(db, `SELECT count(*)::int n, min(d.notification_id::text) id
    FROM public.contract_billing_alert_dispatches d JOIN public.contract_billing_milestone_alerts a ON a.id = d.alert_id
    WHERE a.milestone_id = $1 AND d.channel = 'in_app' AND d.recipient_user_id = $2`, [milestoneId, live.users.financeiro.id]);
  await dispatch();
  const after = await one<{ n: number; id: string }>(db, `SELECT count(*)::int n, min(d.notification_id::text) id
    FROM public.contract_billing_alert_dispatches d JOIN public.contract_billing_milestone_alerts a ON a.id = d.alert_id
    WHERE a.milestone_id = $1 AND d.channel = 'in_app' AND d.recipient_user_id = $2`, [milestoneId, live.users.financeiro.id]);
  expect(after).toEqual(before);
  const notices = await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.notifications
    WHERE recipient_user_id = $1 AND type = 'contracts.billing.milestone_due' AND link_url LIKE $2`,
  [live.users.financeiro.id, `%marco=${milestoneId}%`]);
  expect(notices.n).toBe(1);
});
