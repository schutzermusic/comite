/**
 * DECISÕES — provas vivas pela API (sessões reais, banco do QA isolado).
 *
 *   1. alçada declarada: a decisão chega a quem tem a alçada, e só a quem tem;
 *   2. avisos: in-app entregue, e-mail pela infraestrutura existente (captura
 *      local), WhatsApp NÃO configurado; reentrega idempotente;
 *   3. tela velha e concorrência FORÇADA: uma decisão, uma história;
 *   4. mesmo resultado que o ato feito em Compras;
 *   5. ajuste solicitado volta a Compras, avisa quem submeteu, ressubmissão é outra decisão;
 *   6. motor de aprovação: mesma caixa, ato do motor, pedido reflete na hora;
 *   7. WhatsApp só por configuração explícita, pelo adaptador de provedor;
 *   8. fronteira do navegador: RLS e RPC direta.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=api tests/qa-live/decisions-api.spec.ts
 */
import { expect, test } from '@playwright/test';
import type pg from 'pg';
import { apiAs, browserClientAs, forcedOverlap, one, qaDb, qaLive, tag, type QaRole } from './support';
import {
  countFor, decisionPath, decisionPurchaseOrder, drain, keyForAuthority, mailBody, mailsTo, submitPo, workspaceFor,
} from './decisions-support';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

let db: pg.Client;
const T = tag();
const intent = (s: string) => `qa-${T}-${s}`.slice(0, 80);
type Row = Record<string, unknown>;

const deliveries = (key: string, user: string) => db.query(`SELECT channel, state, provider, provider_message_id, failure_code,
  destination_hint, notice_kind FROM public.decision_deliveries WHERE decision_key = $1 AND recipient_user_id = $2 ORDER BY channel`, [key, user])
  .then((r) => r.rows as Row[]);
const poRow = (id: string) => one<{ status: string; approved_by: string | null; approval_authority_id: string | null;
  approved_fingerprint: string | null; approval_governance: string | null; approval_request_id: string | null }>(db,
  `SELECT status, approved_by, approval_authority_id, approved_fingerprint, approval_governance, approval_request_id FROM public.purchase_orders WHERE id = $1`, [id]);
const act = async (role: QaRole, key: string, body: Row) => (await apiAs(role)).post(`${decisionPath(key)}/act`, { data: body });

test.beforeAll(async () => {
  db = await qaDb();
  // Sem política ATIVA de compra: estas provas começam pela alçada declarada (o seed do QA declara a do Financeiro).
  await db.query(`UPDATE public.approval_policy_versions SET status = 'INACTIVE'
    WHERE organization_id = $1 AND subject_type = 'purchase_order' AND status = 'ACTIVE'`, [qaLive().organization.id]);
});
test.afterAll(async () => { await db?.end(); });

let A: Awaited<ReturnType<typeof decisionPurchaseOrder>>;
let keyA: string;

test('1. a decisão de compra chega a quem tem a alçada — e só a quem tem', async () => {
  const live = qaLive();
  const before = await countFor('financeiro');
  A = await decisionPurchaseOrder(db, `A${T}`);
  const sub = await submitPo(A.poId);
  expect(sub.governance).toBe('AUTHORITY');
  keyA = keyForAuthority(A.poId);
  await expect.poll(() => countFor('financeiro')).toBe(before + 1);

  const ws = await workspaceFor('financeiro');
  const item = ws.mine.find((d: Row) => d.key === keyA);
  expect(item, 'decisão na caixa do Financeiro').toBeTruthy();
  expect(item.amount).toBe(182_400);
  expect(item.kindLabel).toBe('Compra');
  expect(item.projectName).toBe(A.projectName);
  expect(item.actions).toEqual(['APPROVE', 'REQUEST_ADJUSTMENT']);
  expect(item.authority.kind).toBe('PROCUREMENT_AUTHORITY');
  expect(item.authority.sourceReference).toBe('ATA-QA-001');
  expect(JSON.stringify(item.context)).toContain('Elétrica Rápida Norte');

  for (const role of ['compras', 'almoxarifado', 'rh', 'juridico', 'gestor', 'engenharia', 'owner', 'outsider'] as QaRole[]) {
    const other = await workspaceFor(role);
    const keys = [...other.mine, ...other.alsoEligible].map((d: Row) => d.key);
    expect(keys, `${role} não recebe a decisão`).not.toContain(keyA);
  }

  const detail = await (await apiAs('financeiro')).get(decisionPath(keyA));
  expect(detail.status()).toBe(200);
  const d = await detail.json();
  expect(d.access).toBe('DECIDER');
  expect(d.canAct).toBe(true);
  expect(d.actions).toEqual(['APPROVE', 'REQUEST_ADJUSTMENT']);
  expect(JSON.stringify(d.why)).toContain('ATA-QA-001');
  expect(d.comparison.options).toHaveLength(2);
  const chosen = d.comparison.options.find((o: Row) => o.chosen);
  const cheapest = d.comparison.options.find((o: Row) => o.cheapest);
  expect(chosen.supplier).toContain('Elétrica Rápida Norte');
  expect(cheapest.supplier).toContain('Cabos Amazônia');
  expect(cheapest.lateDays).toBeGreaterThan(0);
  expect(chosen.lateDays).toBe(0);
  expect(d.impact.map((i: Row) => i.statement).join(' ')).toMatch(/a mais, mas atende o cronograma/);
  expect(d.sourceHref).toContain(`po=${A.poId}`);

  // Compras (quem submeteu) acompanha como participante, sem ato; RH e outro inquilino não abrem.
  const asBuyer = await (await (await apiAs('compras')).get(decisionPath(keyA))).json();
  expect(asBuyer.access).toBe('PARTICIPANT');
  expect(asBuyer.canAct).toBe(false);
  expect((await (await apiAs('rh')).get(decisionPath(keyA))).status()).toBe(404);
  expect((await (await apiAs('outsider')).get(decisionPath(keyA))).status()).toBe(404);
  // E não agem — nem pelo endpoint de Decisões.
  expect((await act('compras', keyA, { action: 'APPROVE', expectedFingerprint: null, intentId: intent('buyer') })).status()).toBe(403);
  expect((await act('outsider', keyA, { action: 'APPROVE', expectedFingerprint: null, intentId: intent('out') })).status()).toBe(404);
  expect((await poRow(A.poId)).status).toBe('APPROVAL_REQUIRED');
  void live;
});

test('2. avisos: in-app entregue, e-mail pela infraestrutura existente, WhatsApp não configurado — e sem duplicar', async () => {
  const fin = qaLive().users.financeiro;
  // A submissão agenda a entrega logo após a resposta; a drenagem é a garantia.
  await drain();
  await expect.poll(async () => (await deliveries(keyA, fin.id)).map((r) => `${r.channel}:${r.state}`).join(','), { timeout: 60_000 })
    .toBe('email:SENT,in_app:DELIVERED,whatsapp:NOT_CONFIGURED');
  const rows = await deliveries(keyA, fin.id);
  const email = rows.find((r) => r.channel === 'email')!;
  expect(email.provider).toBe('capture');
  expect(email.provider_message_id).toBeTruthy();
  expect(rows.find((r) => r.channel === 'whatsapp')!.failure_code).toBe('CHANNEL_NOT_CONFIGURED');

  const n = await one<{ type: string; link_url: string; title: string }>(db, `SELECT type, link_url, title FROM public.notifications
    WHERE recipient_user_id = $1 AND link_url = $2 ORDER BY created_at DESC LIMIT 1`, [fin.id, `/decisoes?d=${encodeURIComponent(keyA)}`]);
  expect(n.type).toBe('decisions.new');

  const mails = await mailsTo(fin.email, 'Decisão necessária — Compra de R$ 182.400', A.projectName);
  expect(mails.length).toBe(1);
  const body = await mailBody(mails[0].ID);
  expect(body.HTML).toContain(A.projectName);
  expect(body.HTML).toContain('Elétrica Rápida Norte');
  expect(body.HTML).toContain('Analisar no Apex');
  expect(body.HTML).toContain(`/decisoes?d=${encodeURIComponent(keyA)}`);
  expect(body.HTML).toMatch(/não é uma aprovação/);

  // Reentrega: drenar de novo não cria linha nem e-mail novos.
  const before = (await db.query(`SELECT count(*)::int n FROM public.decision_deliveries WHERE decision_key = $1`, [keyA])).rows[0].n;
  await drain(); await drain();
  const after = (await db.query(`SELECT count(*)::int n FROM public.decision_deliveries WHERE decision_key = $1`, [keyA])).rows[0].n;
  expect(after).toBe(before);
  expect((await mailsTo(fin.email, 'Decisão necessária — Compra de R$ 182.400', A.projectName)).length).toBe(1);
});

test('3. tela velha e concorrência forçada: uma decisão, uma história', async () => {
  const fin = qaLive().users.financeiro;
  // Sessão B abre a decisão (tela com a impressão digital de agora).
  const sessionB = await apiAs('financeiro');
  const screenB = await (await sessionB.get(decisionPath(keyA))).json();
  const fp = screenB.item.fingerprint as string;
  const [ra, rb] = await forcedOverlap(`SELECT 1 FROM public.purchase_orders WHERE id = $1 FOR UPDATE`, [A.poId], () => [
    act('financeiro', keyA, { action: 'APPROVE', expectedFingerprint: fp, intentId: intent('A-approve') }),
    sessionB.post(`${decisionPath(keyA)}/act`, { data: { action: 'REQUEST_ADJUSTMENT', reason: 'Rever o frete (tela velha)',
      expectedFingerprint: fp, intentId: intent('B-adjust') } }),
  ]);
  const statuses = [ra.status(), rb.status()].sort();
  expect(statuses).toEqual([200, 409]);
  const loser = ra.status() === 409 ? await ra.json() : await rb.json();
  expect(loser.code).toBe('STALE');
  expect(loser.message).toMatch(/Nada foi alterado/);
  const decided = await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.purchase_order_history
    WHERE purchase_order_id = $1 AND transition IN ('approved','rejected')`, [A.poId]);
  expect(decided.n).toBe(1);

  // A tela velha tenta o ato CONTRÁRIO ao que venceu: STALE, e nada muda.
  const approvedWon = ra.status() === 200;
  const again = await sessionB.post(`${decisionPath(keyA)}/act`, { data: approvedWon
    ? { action: 'REQUEST_ADJUSTMENT', reason: 'Tela velha', expectedFingerprint: fp, intentId: intent('B-adjust-2') }
    : { action: 'APPROVE', expectedFingerprint: fp, intentId: intent('A-approve-2') } });
  expect(again.status()).toBe(409);
  expect((await again.json()).message).toMatch(/Nada foi alterado/);
  // Repetir a MESMA intenção vencedora: resposta idempotente, sem segunda escrita.
  const winner = approvedWon ? { action: 'APPROVE', intentId: intent('A-approve') } : { action: 'REQUEST_ADJUSTMENT', intentId: intent('B-adjust'), reason: 'Rever o frete (tela velha)' };
  const replay = await act('financeiro', keyA, { ...winner, expectedFingerprint: fp });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).outcome).toBe('IDEMPOTENT_REPLAY');
  expect((await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.purchase_order_history
    WHERE purchase_order_id = $1 AND transition IN ('approved','rejected')`, [A.poId])).n).toBe(1);

  // Sai de "Minhas", entra em "Concluídas" — com ator, desfecho e autoridade.
  const ws = await workspaceFor('financeiro', 'concluidas');
  expect(ws.mine.map((d: Row) => d.key)).not.toContain(keyA);
  const done = ws.completed.find((d: Row) => d.key === keyA);
  expect(done.decidedBy.id).toBe(fin.id);
  expect(done.viewerRole).toBe('DECIDER');
  expect(done.authoritySummary).toMatch(/ATA-QA-001/);
});

test('4. mesmo resultado que o ato feito em Compras', async () => {
  const viaSource = await decisionPurchaseOrder(db, `S${T}`, { qty: 10, priceA: 90, priceB: 100 });
  const viaDecisions = await decisionPurchaseOrder(db, `D${T}`, { qty: 10, priceA: 90, priceB: 100 });
  await submitPo(viaSource.poId); await submitPo(viaDecisions.poId);
  const src = await (await apiAs('financeiro')).post(`/api/supply/procurement/purchase-orders/${viaSource.poId}`, { data: { action: 'approve', note: 'Aprovado' } });
  expect(src.status(), await src.text()).toBe(200);
  const key = keyForAuthority(viaDecisions.poId);
  const detail = await (await (await apiAs('financeiro')).get(decisionPath(key))).json();
  const dec = await act('financeiro', key, { action: 'APPROVE', reason: 'Aprovado', expectedFingerprint: detail.item.fingerprint, intentId: intent('parity') });
  expect(dec.status(), await dec.text()).toBe(200);
  const [a, b] = [await poRow(viaSource.poId), await poRow(viaDecisions.poId)];
  expect({ ...b, approved_fingerprint: null }).toEqual({ ...a, approved_fingerprint: null });
  expect(a.approved_by).toBe(qaLive().users.financeiro.id);
  const shape = async (id: string) => one<{ keys: string[]; ev: number }>(db, `SELECT
      (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((SELECT detail FROM public.purchase_order_history WHERE purchase_order_id = $1 AND transition = 'approved')) k) keys,
      (SELECT count(*)::int FROM public.domain_events WHERE aggregate_id = $1 AND event_type = 'supply.purchase_order.approved') ev`, [id]);
  expect(await shape(viaDecisions.poId)).toEqual(await shape(viaSource.poId));
  const audit = await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.audit_logs WHERE entity_id::text = $1
    AND action = 'supply.purchase_order.approve' AND metadata->>'via' = 'decisoes'`, [viaDecisions.poId]);
  expect(audit.n).toBe(1);
});

test('5. ajuste solicitado volta a Compras, avisa quem submeteu — e a ressubmissão é outra decisão', async () => {
  const live = qaLive();
  const B = await decisionPurchaseOrder(db, `B${T}`, { qty: 20, priceA: 45, priceB: 50 });
  await submitPo(B.poId);
  const key1 = keyForAuthority(B.poId, 1);
  const d1 = await (await (await apiAs('financeiro')).get(decisionPath(key1))).json();
  const noReason = await act('financeiro', key1, { action: 'REQUEST_ADJUSTMENT', expectedFingerprint: d1.item.fingerprint, intentId: intent('adj-0') });
  expect(noReason.status()).toBe(422);
  const ok = await act('financeiro', key1, { action: 'REQUEST_ADJUSTMENT', reason: 'Frete acima do contratado; renegociar.',
    expectedFingerprint: d1.item.fingerprint, intentId: intent('adj-1') });
  expect(ok.status(), await ok.text()).toBe(200);
  expect((await poRow(B.poId)).status).toBe('DRAFT');
  const done = (await workspaceFor('financeiro', 'concluidas')).completed.find((c: Row) => c.key === key1);
  expect(done.outcome).toBe('ADJUSTMENT_REQUESTED');
  expect(done.reason).toBe('Frete acima do contratado; renegociar.');
  // Quem submeteu (Compras) recebe o aviso de ajuste, com a justificativa no e-mail.
  await drain();
  await expect.poll(async () => (await deliveries(key1, live.users.compras.id)).map((r) => `${r.notice_kind}:${r.channel}:${r.state}`).join(','),
    { timeout: 60_000 }).toContain('ADJUSTMENT_REQUESTED:in_app:DELIVERED');
  const mails = await mailsTo(live.users.compras.email, 'Ajuste solicitado', B.projectName);
  expect(mails.length).toBeGreaterThanOrEqual(1);
  // Ressubmissão: OUTRA decisão; a tela da primeira não decide a segunda.
  await submitPo(B.poId);
  const key2 = keyForAuthority(B.poId, 2);
  expect((await workspaceFor('financeiro')).mine.map((d: Row) => d.key)).toContain(key2);
  const stale = await act('financeiro', key1, { action: 'APPROVE', expectedFingerprint: d1.item.fingerprint, intentId: intent('adj-2') });
  expect(stale.status()).toBe(409);
});

test('6. motor de aprovação: mesma caixa, o ato do motor, e o pedido reflete na hora', async () => {
  const org = qaLive().organization.id;
  const key = `procurement.po.dec_${T.toLowerCase()}`;
  const pol = (await one<{ id: string }>(db, `INSERT INTO public.approval_policies (organization_id, policy_key, name, business_domain)
    VALUES ($1,$2,'[QA] Decisões — compras por política','procurement') RETURNING id`, [org, key])).id;
  const ver = (await one<{ id: string }>(db, `INSERT INTO public.approval_policy_versions (organization_id, policy_id, version_no,
    subject_type, action_type, decision_purpose) VALUES ($1,$2,1,'purchase_order','approve','APPROVAL') RETURNING id`, [org, pol])).id;
  const stage = (await one<{ id: string }>(db, `INSERT INTO public.approval_policy_stages (organization_id, policy_version_id, stage_no, name)
    VALUES ($1,$2,1,'Financeiro') RETURNING id`, [org, ver])).id;
  await db.query(`INSERT INTO public.approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key, name,
    decision_purpose, eligibility_mode, role_key, sod_forbid_requester) VALUES ($1,$2,$3,'fin','Financeiro','APPROVAL','ROLE','financeiro',true)`,
  [org, ver, stage]);
  await db.query(`SELECT public.approval_policy_activate($1)`, [ver]);
  try {
    const P = await decisionPurchaseOrder(db, `P${T}`, { qty: 5, priceA: 9, priceB: 10 });
    const sub = await submitPo(P.poId);
    expect(sub.governance).toBe('POLICY');
    const rq = (await poRow(P.poId)).approval_request_id!;
    const ekey = `approval_request:${rq}:e1`;
    const item = (await workspaceFor('financeiro')).mine.find((d: Row) => d.key === ekey);
    expect(item.source).toBe('APPROVAL_ENGINE');
    expect(item.actions).toEqual(['APPROVE', 'REJECT', 'REQUEST_ADJUSTMENT']);
    expect(item.authority.policyKey).toBe(key);
    const res = await act('financeiro', ekey, { action: 'APPROVE', expectedFingerprint: item.fingerprint, intentId: intent('engine') });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.downstream.applied).toBe(true);
    // Sem drenagem: o desfecho foi aplicado pela MESMA função da rota de evento.
    expect((await poRow(P.poId)).status).toBe('APPROVED');
    const decisionRow = await one<{ actor_user_id: string; decision: string }>(db,
      `SELECT actor_user_id, decision FROM public.approval_decisions WHERE request_id = $1`, [rq]);
    expect(decisionRow).toEqual({ actor_user_id: qaLive().users.financeiro.id, decision: 'APPROVED' });

    const R = await decisionPurchaseOrder(db, `R${T}`, { qty: 5, priceA: 9, priceB: 10 });
    await submitPo(R.poId);
    const rq2 = (await poRow(R.poId)).approval_request_id!;
    const rkey = `approval_request:${rq2}:e1`;
    const noReason = await act('financeiro', rkey, { action: 'REJECT', expectedFingerprint: null, intentId: intent('engine-rej-0') });
    expect(noReason.status()).toBe(422);
    const rej = await act('financeiro', rkey, { action: 'REJECT', reason: 'Fornecedor fora da estratégia de compras.', expectedFingerprint: null, intentId: intent('engine-rej') });
    expect(rej.status(), await rej.text()).toBe(200);
    expect((await one<{ status: string }>(db, `SELECT status FROM public.approval_requests WHERE id = $1`, [rq2])).status).toBe('REJECTED');
    expect((await poRow(R.poId)).status).toBe('DRAFT');
  } finally {
    await db.query(`UPDATE public.approval_policy_versions SET status = 'INACTIVE' WHERE id = $1`, [ver]);
  }
});

test('7. WhatsApp só por configuração explícita, pelo adaptador de provedor', async () => {
  const live = qaLive();
  // Sem permissão, ninguém liga canal.
  const denied = await (await apiAs('financeiro')).post('/api/decisions/channels', { data: { channel: 'whatsapp', status: 'ENABLED',
    provider: 'fake', contentLevel: 'MINIMAL', reason: 'tentativa sem permissão' } });
  expect(denied.status()).toBe(403);
  const on = await (await apiAs('owner')).post('/api/decisions/channels', { data: { channel: 'whatsapp', status: 'ENABLED',
    provider: 'fake', contentLevel: 'MINIMAL', reason: 'QA isolado: provedor de prova homologado' } });
  expect(on.status(), await on.text()).toBe(200);
  const pref = await (await apiAs('financeiro')).post('/api/decisions/preferences', { data: { channel: 'whatsapp', enabled: true,
    destination: '+5591999990000' } });
  expect(pref.status(), await pref.text()).toBe(200);
  try {
    const W = await decisionPurchaseOrder(db, `W${T}`, { qty: 8, priceA: 11, priceB: 12 });
    await submitPo(W.poId);
    const key = keyForAuthority(W.poId);
    await drain();
    await expect.poll(async () => (await deliveries(key, live.users.financeiro.id)).find((r) => r.channel === 'whatsapp')?.state,
      { timeout: 60_000 }).toBe('SENT');
    const wa = (await deliveries(key, live.users.financeiro.id)).find((r) => r.channel === 'whatsapp')!;
    expect(wa.provider).toBe('fake');
    expect(String(wa.provider_message_id)).toMatch(/^fake-/);
    expect(String(wa.destination_hint)).not.toContain('99990000');
  } finally {
    await (await apiAs('owner')).post('/api/decisions/channels', { data: { channel: 'whatsapp', status: 'DISABLED', provider: 'fake',
      contentLevel: 'MINIMAL', reason: 'QA isolado: fim da prova' } });
    await (await apiAs('financeiro')).post('/api/decisions/preferences', { data: { channel: 'whatsapp', enabled: false, destination: null } });
  }
});

test('8. fronteira do navegador: núcleo inalcançável, RLS no livro de entrega', async () => {
  const live = qaLive();
  const sb = await browserClientAs('financeiro');
  const core = await sb.rpc('decision_inbox', { p_org: live.organization.id, p_user: live.users.owner.id });
  expect(core.error, 'núcleo com parâmetro de usuário não é do navegador').not.toBeNull();
  const actDirect = await sb.rpc('decision_purchase_order_act', { p_organization_id: live.organization.id, p_actor: live.users.financeiro.id,
    p_po_id: A.poId, p_submission: 1, p_expected_fingerprint: null, p_decision: 'APPROVE', p_note: null });
  expect(actDirect.error).not.toBeNull();
  const ins = await sb.from('decision_deliveries').insert({ organization_id: live.organization.id, decision_key: keyA,
    subject_type: 'purchase_order', subject_id: A.poId, notice_kind: 'NEW', recipient_user_id: live.users.financeiro.id,
    recipient_role: 'DECIDER', channel: 'in_app', idempotency_key: `forjado-${T}` });
  expect(ins.error).not.toBeNull();
  const others = await sb.from('decision_deliveries').select('id').neq('recipient_user_id', live.users.financeiro.id);
  expect(others.data ?? []).toHaveLength(0);
  const outsider = await browserClientAs('outsider');
  const peek = await outsider.rpc('decision_access_for_viewer', { p_key: keyA });
  expect(peek.data).toBeNull();
  const theirs = await outsider.rpc('decision_inbox_for_viewer');
  expect((theirs.data ?? []).some((r: Row) => String(r.decision_key).includes(A.poId))).toBe(false);
});

/**
 * SEGUNDA FONTE — liberação de faturamento (Contratos → motor de aprovação).
 *
 * Nenhuma mudança no modelo da caixa: a fonte é outra etapa do MESMO motor;
 * o que muda é a âncora (evento de faturamento em PENDING_RELEASE), a
 * categoria e os atos que o domínio executa (aprovar e rejeitar — "solicitar
 * ajuste" deixaria o evento preso, e por isso não é oferecido).
 */
test('9. segunda fonte: liberação de faturamento pelo motor, na mesma caixa', async () => {
  const live = qaLive(); const org = live.organization.id; const owner = live.users.owner.id;
  const sfx = `${T}`.toLowerCase();
  const perm = (await one<{ id: string }>(db, `SELECT id FROM public.permissions WHERE key = 'contracts.billing.release'`)).id;
  // Quem pede a liberação precisa da permissão — concedida SÓ ao titular do QA, só nesta prova.
  await db.query(`INSERT INTO public.user_permission_overrides (organization_id, user_id, permission_id, effect, reason)
    VALUES ($1,$2,$3,'grant','QA isolado: prova de Decisões') ON CONFLICT (organization_id, user_id, permission_id) DO UPDATE SET effect = 'grant'`,
  [org, owner, perm]);
  let version: string | null = null;
  try {
    const project = `qa-dec-bill-${sfx}`;
    await db.query(`INSERT INTO public.projects (id, organization_id, project) VALUES ($1,$2,$3)`,
      [project, org, JSON.stringify({ id: project, nome: `Contrato QA ${T}`, status: 'em_andamento' })]);
    const party = (await one<{ id: string }>(db, `INSERT INTO public.parties (organization_id, kind, legal_name, document_type, document_number)
      VALUES ($1,'organization',$2,'cnpj',$3) RETURNING id`, [org, `[QA] Cliente Faturamento ${T}`, `1122233300${String(Date.now()).slice(-4)}`])).id;
    const contract = (await one<{ id: string }>(db, `INSERT INTO public.contracts (organization_id, title, status, currency, data_class,
      counterparty_party_id, project_id) VALUES ($1,$2,'active','BRL','demo',$3,$4) RETURNING id`, [org, `[QA] Contrato ${T}`, party, project])).id;
    await db.query(`INSERT INTO public.contract_project_links (organization_id, contract_id, project_id) VALUES ($1,$2,$3)`, [org, contract, project]);
    const milestone = (await one<{ id: string }>(db, `INSERT INTO public.contract_milestones (organization_id, contract_id, project_id, title, status)
      VALUES ($1,$2,$3,'[QA] Marco de medição','pending') RETURNING id`, [org, contract, project])).id;
    const rule = (await one<{ id: string }>(db, `INSERT INTO public.contract_measurement_requirements (organization_id, contract_id, title,
      source_reference, effect, milestone_id, measurement_basis, measurement_currency, accumulation_mode, aggregation_mode, cadence)
      VALUES ($1,$2,'[QA] Regra de medição','Cl. 4','added',$3,'MONETARY','BRL','INCREMENTAL','SUM_INCREMENTAL','MONTHLY') RETURNING id`,
    [org, contract, milestone])).id;
    const measurement = (await one<{ id: string }>(db, `INSERT INTO public.project_measurements (organization_id, project_id, contract_id,
      contract_measurement_rule_id, milestone_id, occurrence_key, occurrence_state, measurement_basis, accumulation_mode, quantity,
      measured_value, currency, status, accepted_at, acceptance_source, accepted_quantity, accepted_value, accepted_currency,
      accepted_external_ref, origin) VALUES ($1,$2,$3,$4,$5,$6,'resolved','MONETARY','INCREMENTAL',1,86500,'BRL','ACCEPTED',
      now(),'signed_bulletin',1,86500,'BRL','BOL-QA','manual') RETURNING id`, [org, project, contract, rule, milestone, `qa-dec-${sfx}`])).id;
    const ev = (await one<{ id: string }>(db, `SELECT public.emit_domain_event($1::uuid,'projects.measurement.accepted',1,'project_measurement',
      $2::uuid,'qa-dec:'||$2::uuid::text,'{}'::jsonb) AS id`, [org, measurement])).id;
    const candidate = (await one<{ r: { billing_event_id: string; eligibility: string } }>(db,
      `SELECT public.contract_billing_apply_measurement_accepted($1) AS r`, [ev])).r;
    expect(candidate.eligibility).toBe('ELIGIBLE');
    const billing = candidate.billing_event_id;

    // Política: liberação exige a aprovação NOMEADA do Financeiro do QA.
    const pol = (await one<{ id: string }>(db, `INSERT INTO public.approval_policies (organization_id, policy_key, name, business_domain)
      VALUES ($1,$2,'[QA] Liberação de faturamento','contracts') RETURNING id`, [org, `contracts.release.dec_${sfx}`])).id;
    version = (await one<{ id: string }>(db, `INSERT INTO public.approval_policy_versions (organization_id, policy_id, version_no, subject_type,
      action_type, decision_purpose) VALUES ($1,$2,1,'contract_billing_event','release','RELEASE') RETURNING id`, [org, pol])).id;
    const stage = (await one<{ id: string }>(db, `INSERT INTO public.approval_policy_stages (organization_id, policy_version_id, stage_no, name)
      VALUES ($1,$2,1,'Financeiro') RETURNING id`, [org, version])).id;
    await db.query(`INSERT INTO public.approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key, name,
      decision_purpose, eligibility_mode, named_user_id) VALUES ($1,$2,$3,'financeiro','Liberação pelo Financeiro','RELEASE','NAMED',$4)`,
    [org, version, stage, live.users.financeiro.id]);
    await db.query(`SELECT public.approval_policy_activate($1)`, [version]);

    // O titular pede a liberação pela função de domínio, na própria sessão (como a tela de Contratos faz).
    const sb = await browserClientAs('owner');
    const rel = await sb.rpc('contract_billing_release', { p_billing_event_id: billing, p_note: 'Boletim assinado pelo cliente' });
    expect(rel.error, JSON.stringify(rel.error)).toBeNull();
    expect((rel.data as Row).release_state).toBe('PENDING_RELEASE');
    const rq = (await one<{ r: string }>(db, `SELECT release_approval_request_id r FROM public.contract_billing_events WHERE id = $1`, [billing])).r;
    const key = `approval_request:${rq}:e1`;

    const item = (await workspaceFor('financeiro')).mine.find((d: Row) => d.key === key);
    expect(item, 'liberação na caixa do Financeiro').toBeTruthy();
    expect(item.category).toBe('financeiro');
    expect(item.kindLabel).toBe('Liberação de faturamento');
    expect(item.actions).toEqual(['APPROVE', 'REJECT']);
    expect((await workspaceFor('compras')).mine.map((d: Row) => d.key)).not.toContain(key);

    const res = await act('financeiro', key, { action: 'APPROVE', expectedFingerprint: item.fingerprint, intentId: intent('billing') });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).downstream.applied).toBe(true);
    const after = await one<{ release_state: string; released_by: string | null }>(db,
      `SELECT release_state, released_by FROM public.contract_billing_events WHERE id = $1`, [billing]);
    expect(after.release_state).toBe('RELEASED');
    expect((await workspaceFor('financeiro')).mine.map((d: Row) => d.key)).not.toContain(key);
  } finally {
    if (version) await db.query(`UPDATE public.approval_policy_versions SET status = 'INACTIVE' WHERE id = $1`, [version]);
    await db.query(`DELETE FROM public.user_permission_overrides WHERE organization_id = $1 AND user_id = $2 AND permission_id = $3`,
      [org, owner, perm]);
  }
});
