/**
 * LEITURA DA APEX PELO RELÓGIO DA PLATAFORMA — produtor → trabalho → handler
 * → livro de sinais, pela drenagem real (`/api/platform/jobs/drain`):
 *
 *  • a drenagem enfileira a leitura do inquilino (uma por hora);
 *  • o trabalho roda o motor determinístico e ABRE a falta com evidência e
 *    ato recomendado — sem agir: nenhuma reserva, requisição, pedido,
 *    recebimento ou movimento de estoque nasce da leitura;
 *  • coberta a falta por um ato humano, a leitura seguinte a RESOLVE.
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { apiAs, APP_URL, governed, one, qaDb, qaEnv, qaLive, tag } from './support';

let db: pg.Client;
test.beforeAll(async () => { db = await qaDb(); });
test.afterAll(async () => { await db?.end(); });

async function drain() {
  const res = await fetch(`${APP_URL}/api/platform/jobs/drain`, { method: 'POST',
    headers: { Authorization: `Bearer ${qaEnv().QA_JOBS_SECRET}`, 'x-apex-trigger': 'qa-live' } });
  expect(res.status).toBe(200);
  return (await res.json()).counters as Record<string, number>;
}
/**
 * A leitura desta hora já pode ter rodado (outra prova drenou antes, a chave é
 * por hora). A prova enfileira pela MESMA função do produtor numa janela
 * única e futura — o trabalho roda já (run_after = agora) — e drena.
 */
let window = 1000 + Math.floor(Date.now() / 1000) % 500_000;
async function sweepNow() {
  window += 1;
  await db.query(`SELECT public.supply_intelligence_enqueue_sweep(now() + make_interval(hours => $1))`, [window]);
  await drain();
}
const facts = async (org: string) => one<{ reservations: number; requisitions: number; orders: number; receipts: number; movements: number }>(db,
  `SELECT (SELECT count(*)::int FROM public.inventory_reservations WHERE organization_id = $1) reservations,
          (SELECT count(*)::int FROM public.purchase_requisitions WHERE organization_id = $1) requisitions,
          (SELECT count(*)::int FROM public.purchase_orders WHERE organization_id = $1) orders,
          (SELECT count(*)::int FROM public.goods_receipts WHERE organization_id = $1) receipts,
          (SELECT count(*)::int FROM public.inventory_movements WHERE organization_id = $1) movements`, [org]);

test('a drenagem agenda a leitura da Apex do inquilino (uma por hora)', async () => {
  const org = qaLive().organization.id;
  const g = await governed(db); const t = tag();
  await g.material(await g.project(`IA${t}`), await g.item(`IA-${t}`), 5);
  await drain();
  const job = await one(db, `SELECT count(*)::int n FROM public.apex_jobs WHERE organization_id = $1
    AND job_type = 'supply.intelligence.sweep' AND idempotency_key = 'supply-intelligence-sweep:' || $1::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24')`, [org]);
  expect(job.n).toBe(1);
  await drain();
  const again = await one(db, `SELECT count(*)::int n FROM public.apex_jobs WHERE organization_id = $1
    AND job_type = 'supply.intelligence.sweep' AND idempotency_key LIKE 'supply-intelligence-sweep:' || $1::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24') || '%'`, [org]);
  expect(again.n).toBe(1);
});

test('a leitura agendada abre a falta com evidência, não age, e resolve quando a falta é coberta', async () => {
  const org = qaLive().organization.id;
  const g = await governed(db); const t = tag();
  const item = await g.item(`IB-${t}`); const project = await g.project(`IB${t}`);
  const req = await g.material(project, item, 25, '2026-10-20');

  const before = await facts(org);
  await sweepNow();
  const signal = await one<{ id: string; kind: string; status: string; evidence: unknown; rationale: string; recommended_action: { kind: string } }>(db,
    `SELECT id, kind, status, evidence, rationale, recommended_action FROM public.supply_signals
      WHERE organization_id = $1 AND requirement_id = $2 ORDER BY first_seen_at DESC LIMIT 1`, [org, req]);
  expect(signal).toBeTruthy();
  expect(signal.kind).toBe('SHORTAGE');
  expect(signal.status).toBe('OPEN');
  expect(signal.recommended_action.kind).toBe('REQUISITION');
  expect(JSON.stringify(signal.evidence)).toContain('25');
  expect(signal.rationale.length).toBeGreaterThan(10);
  expect(await facts(org)).toEqual(before); // a Apex observou e recomendou; nenhum fato de negócio nasceu

  // Um ato HUMANO cobre a falta (estoque recebido e reservado pelo almoxarifado).
  const wh = await g.location(`IB-W-${t}`, 'WAREHOUSE');
  await g.stock(item, wh, 25);
  const res = await (await apiAs('almoxarifado')).post('/api/supply/inventory/reservations',
    { data: { requirementId: req, locationId: wh, quantity: 25, idempotencyKey: `ib-${t}` } });
  expect(res.status()).toBe(200);
  await sweepNow();
  const after = await one(db, `SELECT status, resolved_at IS NOT NULL resolved FROM public.supply_signals WHERE id = $1`, [signal.id]);
  expect(after).toEqual({ status: 'RESOLVED', resolved: true });
  const history = await one(db, `SELECT count(*) FILTER (WHERE transition = 'resolved' AND actor_kind = 'apex')::int n
    FROM public.supply_signal_history WHERE signal_id = $1`, [signal.id]);
  expect(history.n).toBe(1);
});
