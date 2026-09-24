/**
 * CICLO DE APROVAÇÃO DO PEDIDO DE COMPRA sob POLÍTICA do motor — sessões
 * reais, e o relógio real da plataforma (`/api/platform/jobs/drain`):
 *
 *  • cancelar com aprovação PENDENTE cancela o pedido no motor, em nome de
 *    quem cancelou (nenhuma decisão órfã);
 *  • aprovação decidida no motor chega ao pedido pela ROTA DE EVENTO, ligada
 *    pelo próprio trabalhador capaz — sem "sincronizar" manual;
 *  • rejeição devolve ao rascunho e a ressubmissão abre OUTRO pedido de aprovação;
 *  • com a rota desligada, a reconciliação periódica aplica o desfecho.
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { apiAs, APP_URL, browserClientAs, governed, one, qaDb, qaEnv, qaLive, tag } from './support';

let db: pg.Client;
const cutover: string[] = [];

test.beforeAll(async () => {
  db = await qaDb();
  const org = qaLive().organization.id;
  cutover.push((await one<{ id: string }>(db, `INSERT INTO public.approval_engine_cutover
    (organization_id, business_domain, subject_type, action_type, justification)
    VALUES ($1,'procurement','purchase_order','approve','QA isolado: pedido de compra sob política') RETURNING id`, [org])).id);
  // Uma política ATIVA de pedido de compra por inquilino: reusa a do QA se já existir (o motor recusa duas na mesma precedência).
  const active = await db.query(`SELECT v.id FROM public.approval_policy_versions v JOIN public.approval_policies p ON p.id = v.policy_id
    WHERE v.organization_id = $1 AND v.subject_type = 'purchase_order' AND v.status = 'ACTIVE' LIMIT 1`, [org]).catch(() => ({ rows: [] }));
  if (active.rows.length) return;
  const key = `procurement.po.qa_${tag().toLowerCase()}`;
  const pol = (await one<{ id: string }>(db, `INSERT INTO public.approval_policies (organization_id, policy_key, name, business_domain)
    VALUES ($1,$2,'[QA] Aprovação de compras','procurement') RETURNING id`, [org, key])).id;
  const ver = (await one<{ id: string }>(db, `INSERT INTO public.approval_policy_versions (organization_id, policy_id, version_no,
    subject_type, action_type, decision_purpose) VALUES ($1,$2,1,'purchase_order','approve','APPROVAL') RETURNING id`, [org, pol])).id;
  const stage = (await one<{ id: string }>(db, `INSERT INTO public.approval_policy_stages (organization_id, policy_version_id, stage_no, name)
    VALUES ($1,$2,1,'Financeiro') RETURNING id`, [org, ver])).id;
  await db.query(`INSERT INTO public.approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key, name,
    decision_purpose, eligibility_mode, role_key, sod_forbid_requester) VALUES ($1,$2,$3,'fin','Financeiro','APPROVAL','ROLE','financeiro',true)`,
    [org, ver, stage]);
  await db.query(`SELECT public.approval_policy_activate($1)`, [ver]);
});
test.afterAll(async () => {
  // A política sai de cena: os demais specs voltam à governança por alçada declarada.
  await db.query(`DELETE FROM public.approval_engine_cutover WHERE id = ANY($1)`, [cutover]);
  // O motor escolhe a política ATIVA mesmo sem a linha de corte: a versão sai de cena (ACTIVE → INACTIVE).
  await db.query(`UPDATE public.approval_policy_versions SET status = 'INACTIVE'
    WHERE organization_id = $1 AND subject_type = 'purchase_order' AND status = 'ACTIVE'`, [qaLive().organization.id]);
  await db.query(`UPDATE public.apex_event_routes SET activation = 'ON_WORKER_CAPABILITY'
    WHERE job_type = 'procurement.purchase_order.apply_approval'`);
  await db?.end();
});

/** Pedido em RASCUNHO pelo caminho governado, com Compras como ator. */
async function draftPo(qty: number) {
  const g = await governed(db); const live = qaLive(); const t = tag(); const compras = live.users.compras.id;
  const item = await g.item(`AP-${t}`); const project = await g.project(`AP${t}`);
  const site = await g.location(`AP-S-${t}`, 'PROJECT_SITE', { project_id: project });
  const req = await g.material(project, item, qty);
  const rc = await g.act<{ requisition_id: string }>('purchase_requisition_from_shortage', g.org, compras, g.J({ requirement_ids: [req] }));
  const lines = (await db.query(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rc.requisition_id])).rows;
  const rfq = await g.act<{ rfq_id: string }>('procurement_rfq_create', g.org, compras, g.J({ requisition_line_ids: lines.map((l) => l.id),
    supplier_ids: [live.suppliers.a] }));
  const rfqLines = (await db.query(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id])).rows;
  const quote = await g.act<{ quote_id: string }>('procurement_quote_record', g.org, compras, g.J({ rfq_id: rfq.rfq_id,
    supplier_id: live.suppliers.a, lead_time_days: 7, validity_date: '2099-01-01',
    lines: rfqLines.map((l) => ({ rfq_line_id: l.id, unit_price: 25 })) }));
  const dec = await g.act<{ purchase_order_id: string }>('procurement_decide', g.org, compras,
    g.J({ rfq_id: rfq.rfq_id, quote_id: quote.quote_id, rationale: 'QA: proposta única' }));
  await g.act('purchase_order_update_draft', g.org, compras, dec.purchase_order_id, g.J({ delivery_location_id: site }));
  return dec.purchase_order_id;
}

const po = (id: string) => one<{ status: string; g: string | null; rq: string | null; approved_by: string | null }>(db,
  `SELECT status, approval_governance g, approval_request_id rq, approved_by FROM public.purchase_orders WHERE id = $1`, [id]);
const submit = async (id: string) => {
  const res = await (await apiAs('compras')).post(`/api/supply/procurement/purchase-orders/${id}`, { data: { action: 'submit' } });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
};
async function engineDecide(requestId: string, decision: 'APPROVED' | 'REJECTED', reason: string | null = null) {
  const step = await one<{ id: string }>(db, `SELECT id FROM public.approval_request_steps WHERE request_id = $1`, [requestId]);
  const sb = await browserClientAs('financeiro');
  const { data, error } = await sb.rpc('approval_decide', { p_request_step_id: step.id, p_decision: decision,
    p_idempotency_key: `qa-${decision}-${requestId}`, p_reason: reason, p_delegation_id: null, p_expected_fingerprint: null });
  expect(error).toBeNull();
  return data as { request_status: string };
}
async function drain() {
  const res = await fetch(`${APP_URL}/api/platform/jobs/drain`, { method: 'POST',
    headers: { Authorization: `Bearer ${qaEnv().QA_JOBS_SECRET}`, 'x-apex-trigger': 'qa-live' } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.paused).toBe(false);
  return body.counters as Record<string, number>;
}

test('cancelar com aprovação pendente cancela o pedido no motor, em nome de quem cancelou', async () => {
  const id = await draftPo(10);
  const sub = await submit(id);
  expect(sub.result.governance).toBe('POLICY');
  const before = await po(id);
  const res = await (await apiAs('compras')).post(`/api/supply/procurement/purchase-orders/${id}`,
    { data: { action: 'cancel', reason: 'Cliente adiou a obra' } });
  expect(res.status()).toBe(200);
  const after = await po(id);
  const req = await one(db, `SELECT status, finalized_by FROM public.approval_requests WHERE id = $1`, [before.rq]);
  expect(after.status).toBe('CANCELLED');
  expect(req).toEqual({ status: 'CANCELLED', finalized_by: qaLive().users.compras.id });
  const pending = await one(db, `SELECT count(*)::int n FROM public.approval_requests WHERE subject_id = $1 AND status = 'PENDING'`, [id]);
  expect(pending.n).toBe(0);
});

test('aprovação no motor chega ao pedido pela rota de evento ligada pelo trabalhador capaz', async () => {
  const id = await draftPo(20);
  await submit(id);
  const { rq } = await po(id);
  expect((await engineDecide(rq!, 'APPROVED')).request_status).toBe('APPROVED');
  expect((await po(id)).status).toBe('APPROVAL_REQUIRED');
  await drain();
  const routes = await one(db, `SELECT count(*) FILTER (WHERE enabled)::int enabled_n, count(*)::int n FROM public.apex_event_routes
    WHERE job_type = 'procurement.purchase_order.apply_approval'`);
  expect(routes).toEqual({ enabled_n: 5, n: 5 });
  await drain();
  const after = await po(id);
  expect(after.status).toBe('APPROVED');
  expect(after.approved_by).toBe(qaLive().users.financeiro.id);
  const job = await one(db, `SELECT j.status FROM public.apex_jobs j JOIN public.domain_events e ON e.id = j.event_id
    WHERE j.job_type = 'procurement.purchase_order.apply_approval' AND e.aggregate_id = $1 AND e.event_type = 'approval.request.approved'`, [rq]);
  expect(job.status).toBe('COMPLETED');
});

test('rejeição volta ao rascunho; a ressubmissão abre OUTRO pedido de aprovação', async () => {
  const id = await draftPo(30);
  await submit(id);
  const first = (await po(id)).rq!;
  await engineDecide(first, 'REJECTED', 'Preço acima da referência');
  await drain(); await drain();
  expect((await po(id)).status).toBe('DRAFT');
  await submit(id);
  const again = await po(id);
  expect(again.status).toBe('APPROVAL_REQUIRED');
  expect(again.rq).not.toBe(first);
  const st = await one(db, `SELECT status FROM public.approval_requests WHERE id = $1`, [again.rq]);
  expect(st.status).toBe('PENDING');
});

test('com a rota desligada, a reconciliação periódica aplica o desfecho', async () => {
  await db.query(`UPDATE public.apex_event_routes SET enabled = false, activation = 'MANUAL'
    WHERE job_type = 'procurement.purchase_order.apply_approval'`);
  const id = await draftPo(40);
  await submit(id);
  const { rq } = await po(id);
  await engineDecide(rq!, 'APPROVED');
  const counters = await drain();
  expect(counters.producers_enqueued).toBeGreaterThanOrEqual(1);
  await drain();
  expect((await po(id)).status).toBe('APPROVED');
  const job = await one(db, `SELECT status FROM public.apex_jobs WHERE organization_id = $1
    AND job_type = 'procurement.purchase_order.reconcile_approvals' ORDER BY created_at DESC LIMIT 1`, [qaLive().organization.id]);
  expect(job.status).toBe('COMPLETED');
});
