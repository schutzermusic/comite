/**
 * O FLUXO COMPLETO DO SUPPLY NO DASHBOARD, COM ESCRITA REAL (QA isolado, 1440 px).
 *
 * Um projeto DESCARTÁVEL por execução (etiqueta única) — nunca o caso de
 * demonstração de Tucuruí. Cenário pelas funções governadas (o mesmo caminho
 * das telas): obra "SE Fluxo <tag> 138 kV" com canteiro em Altamira/PA, um
 * cabo de 500 m confirmado, 100 m no canteiro e 150 m num almoxarifado em
 * Santarém/PA.
 *
 *   owner       analisa a rede (varredura), vê o plano e executa Reservar e
 *               Transferir pelo próprio plano
 *   compras     cria a solicitação de compra, convida os homologados e envia
 *               a cotação (e-mail capturado no Mailpit), decide o fornecedor
 *               no A × B e envia o pedido para aprovação
 *   (propostas) chegam pelo registro governado de Compras
 *   financeiro  aprova a compra NO Dashboard — o MESMO ato de Decisões —
 *               e o pedido fica APROVADO
 *
 * COBERTURA (regra 246, docs/operations-supply/COVERAGE-SEMANTICS.md): a
 * transferência pedida (REQUESTED/APPROVED, sem reserva na origem) é PENDENTE —
 * não é cobertura e não é comprada de novo. A solicitação do passo 2 leva o
 * comprável (500 − 100 reservados − 150 pendentes = 250), não 400. As
 * regressões (projetos descartáveis próprios, pelas rotas reais de cada papel)
 * provam: nada coberto em dobro; transferência cancelada ou perdida no caminho
 * volta ao descoberto; despachada reduz a compra; nenhuma compra além do
 * requerido por ações concorrentes; a exceção de cobertura é governada.
 *
 * Capturas em test-results/dashboard-supply-flow-shots — revisão visual, nunca versionadas.
 *
 *   QA_APP_URL=http://localhost:9103 npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/dashboard-supply-flow.spec.ts
 */
import fs from 'node:fs';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type pg from 'pg';
import { apiAs, authFile, forcedOverlap, governed, one, qaDb, qaLive, tag, type QaRole } from './support';
import { mailsTo, plusDays } from './decisions-support';

test.setTimeout(300_000);

const T = tag();
const SHOTS = 'test-results/dashboard-supply-flow-shots';
const SITE = { lat: -3.2033, lng: -52.2064 };      // Altamira/PA
const DEPOT = { lat: -2.443, lng: -54.7082 };      // Santarém/PA

let db: pg.Client;
let S: {
  projectId: string; projectName: string; itemId: string; itemCode: string; requirementId: string;
  siteId: string; depotId: string; supplierA: { id: string; name: string; email: string | null }; supplierB: { id: string; name: string; email: string | null };
};
const opened: BrowserContext[] = [];

async function as(browser: Browser, role: QaRole): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(role), viewport: { width: 1440, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('insight-theme-preference', 'dark'); } catch { /* sem armazenamento */ } });
  opened.push(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  page.on('pageerror', (e) => { throw new Error(`[${role}] erro de runtime: ${e.message}`); });
  return page;
}
const shot = async (page: Page, name: string) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
/** O elemento VISÍVEL de um test id (a tela pode ter a cópia de saída/entrada de um painel ou a versão do celular). */
const tid = (page: Page, id: string) => page.getByTestId(id).filter({ visible: true }).first();
const supply = (page: Page) => page.goto(`/dashboard?site=${S.projectId}&m=supply`);
const confirmDialog = (page: Page) => tid(page, 'dg-supply-confirm-submit');

/** Abre a etapa do fluxo (cabeçalho-botão) quando o conteúdo ainda não está à vista. */
async function reveal(page: Page, stepId: string, contentId: string) {
  const content = tid(page, contentId);
  if (!(await content.isVisible().catch(() => false))) {
    const step = tid(page, stepId);
    if (await step.count()) await step.getByRole('button').first().click();
  }
  await expect(content).toBeVisible({ timeout: 30_000 });
  await content.scrollIntoViewIfNeeded();
  return content;
}

async function scan(page: Page) {
  // Entrada do módulo: "Analisar a rede de estoque" (ou "de novo"), o atalho para a decisão, ou o fluxo já aberto
  const flow = tid(page, 'dg-supply-plan');
  const scanBtn = tid(page, 'dg-supply-scan');
  const shortcut = page.getByRole('button', { name: /Ir direto/ }).filter({ visible: true }).first();
  await expect(scanBtn.or(shortcut).or(flow).first()).toBeVisible({ timeout: 60_000 });
  if (!(await flow.isVisible().catch(() => false))) {
    if (await scanBtn.isVisible().catch(() => false)) await scanBtn.click();
    else if (await shortcut.isVisible().catch(() => false)) await shortcut.click();
  }
  // o painel do fluxo abre quando o globo termina a varredura (ou pelo prazo de segurança);
  // com a compra já em andamento, ele abre na etapa atual (o plano fica recolhido)
  await expect(flow).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
}

// ── Cobertura do requisito, lida da visão canônica (a mesma de todas as telas) ──
type Cov = { required: number; reserved: number; consumed: number; transit: number; ordered: number; inspection: number;
  requested: number; pending: number; shortage: number; purchasable: number };
const coverage = (requirementId: string) => one<Cov>(db, `SELECT required_qty::float8 AS required, reserved_qty::float8 AS reserved,
    consumed_qty::float8 AS consumed, in_transit_qty::float8 AS transit, on_order_qty::float8 AS ordered,
    inspection_qty::float8 AS inspection, requested_qty::float8 AS requested, pending_transfer_qty::float8 AS pending,
    shortage_qty::float8 AS shortage, purchasable_qty::float8 AS purchasable
  FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [requirementId]);
/** Tudo o que já promete o requisito: confirmado, comprometido, requisitado e o pendente interno. Nunca passa do requerido. */
const promised = (c: Cov) => c.reserved + c.consumed + c.transit + c.ordered + c.inspection + c.requested + c.pending;

// ── As rotas reais, com a sessão de cada papel (RBAC da rota + permissão conferida no banco) ──
type Out = { status: number; error: string; result: {
  requisition_id?: string; requisition_number?: string; requisitioned_qty?: number; override?: boolean; replayed?: boolean;
  transfer_id?: string; transfer_number?: string;
} };
const apis = new Map<QaRole, APIRequestContext>();
let seq = 0;
const intent = (what: string) => `flx-${T}-${what}-${++seq}`;
async function post(role: QaRole, path: string, data: unknown): Promise<Out> {
  let api = apis.get(role);
  if (!api) { api = await apiAs(role); apis.set(role, api); }
  const res = await api.post(path, { data, timeout: 120_000 });
  const body = await res.json().catch(() => ({})) as { result?: Out['result']; error?: string };
  return { status: res.status(), error: body.error ?? '', result: body.result ?? {} };
}
const REQUISITIONS = '/api/supply/procurement/requisitions';
const TRANSFERS = '/api/supply/inventory/transfers';
const RESERVATIONS = '/api/supply/inventory/reservations';
const requisition = (role: QaRole, requirementId: string, extra: Record<string, unknown> = {}) =>
  post(role, REQUISITIONS, { source: 'SHORTAGE', requirementIds: [requirementId], idempotencyKey: intent('rc'), ...extra });
const requestTransfer = (role: QaRole, s: Scn, quantity: number) => post(role, TRANSFERS, {
  fromLocationId: s.depotId, toLocationId: s.siteId, projectId: s.projectId, idempotencyKey: intent('tr'),
  lines: [{ itemId: s.itemId, quantity, requirementId: s.requirementId }] });
const transferAct = (role: QaRole, id: string | undefined, body: Record<string, unknown>) => post(role, `${TRANSFERS}/${id}`, body);
const reserve = (role: QaRole, s: Scn, quantity: number) =>
  post(role, RESERVATIONS, { requirementId: s.requirementId, locationId: s.siteId, quantity, idempotencyKey: intent('rs') });
/** Compila as rotas no servidor de desenvolvimento ANTES da sobreposição (senão a primeira chamada chega sozinha). */
const warm = async () => { for (const p of [REQUISITIONS, TRANSFERS, RESERVATIONS]) await post('owner', p, {}); };
const LOCK_REQUIREMENT = 'SELECT 1 FROM public.project_requirements WHERE id = $1 FOR UPDATE';

/** Um projeto descartável por regressão: canteiro em Altamira, almoxarifado em Santarém, um cabo confirmado. */
type Scn = { projectId: string; itemId: string; siteId: string; depotId: string; requirementId: string };
async function scenario(suffix: string, o: { required: number; site?: number; depot?: number }): Promise<Scn> {
  const g = await governed(db);
  const code = `${T}-${suffix}`;
  const projectId = `qa-flx-${code.toLowerCase()}`;
  await db.query(`INSERT INTO public.projects (id, organization_id, project, created_by) VALUES ($1,$2,$3,$4)`,
    [projectId, g.org, g.J({ id: projectId, nome: `SE Fluxo ${code} 138 kV — cobertura`, cliente: 'Cliente QA Fluxo',
      status: 'em_andamento', cidade: 'Altamira', uf: 'PA' }), g.actor]);
  const itemId = await g.item(`FLX-CABO-${code}`, 'm', 'Cabos');
  const siteId = await g.location(`FLX-S-${code}`, 'PROJECT_SITE', { project_id: projectId, latitude: SITE.lat, longitude: SITE.lng });
  const depotId = await g.location(`FLX-D-${code}`, 'WAREHOUSE', { latitude: DEPOT.lat, longitude: DEPOT.lng });
  if (o.site) await g.stock(itemId, siteId, o.site);
  if (o.depot) await g.stock(itemId, depotId, o.depot);
  return { projectId, itemId, siteId, depotId, requirementId: await g.material(projectId, itemId, o.required, plusDays(12)) };
}

test.beforeAll(async () => {
  db = await qaDb();
  const g = await governed(db);
  const live = qaLive();
  // Governança por alçada declarada (o mesmo ajuste das provas de Decisões).
  await db.query(`UPDATE public.approval_policy_versions SET status = 'INACTIVE'
    WHERE organization_id = $1 AND subject_type = 'purchase_order' AND status = 'ACTIVE'`, [g.org]);
  const itemCode = `FLX-CABO-${T}`;
  const itemId = await g.item(itemCode, 'm', 'Cabos');
  const projectId = `qa-flx-${T.toLowerCase()}`;
  const projectName = `SE Fluxo ${T} 138 kV — Ampliação do pátio`;
  await db.query(`INSERT INTO public.projects (id, organization_id, project, created_by) VALUES ($1,$2,$3,$4)`,
    [projectId, g.org, g.J({ id: projectId, nome: projectName, cliente: 'Cliente QA Fluxo', status: 'em_andamento', cidade: 'Altamira', uf: 'PA' }), g.actor]);
  const siteId = await g.location(`FLX-S-${T}`, 'PROJECT_SITE', { project_id: projectId, latitude: SITE.lat, longitude: SITE.lng });
  const depotId = await g.location(`FLX-D-${T}`, 'WAREHOUSE', { latitude: DEPOT.lat, longitude: DEPOT.lng });
  await g.stock(itemId, siteId, 100);
  await g.stock(itemId, depotId, 150);
  const requirementId = await g.material(projectId, itemId, 500, plusDays(12));
  const sup = async (id: string) => one<{ id: string; name: string; email: string | null }>(db,
    `SELECT sp.id, coalesce(nullif(btrim(p.trade_name), ''), btrim(p.legal_name)) AS name, sp.contact_email AS email
      FROM public.supplier_profiles sp JOIN public.parties p ON p.id = sp.party_id WHERE sp.id = $1`, [id]);
  S = { projectId, projectName, itemId, itemCode, requirementId, siteId, depotId,
    supplierA: await sup(live.suppliers.a), supplierB: await sup(live.suppliers.b) };
});
test.afterAll(async () => {
  for (const c of opened) await c.close().catch(() => undefined);
  for (const a of apis.values()) await a.dispose().catch(() => undefined);
  await db?.end();
});

test.describe('fluxo completo no Dashboard', () => {
test.describe.configure({ mode: 'serial' });

test('1 · owner analisa a rede: varredura, plano da Apex; Reservar e Transferir pelo próprio plano', async ({ browser }) => {
  const page = await as(browser, 'owner');
  await supply(page);
  await expect(tid(page, 'dg-supply-material')).toContainText('500');
  await shot(page, '01-necessidade');
  await scan(page);
  const steps = tid(page, 'dg-supply-plan-steps');
  await expect(steps).toBeVisible({ timeout: 30_000 });
  await expect(steps).toContainText('Reservar');
  await expect(steps).toContainText('Transferir');
  await expect(steps).toContainText('Comprar');
  await shot(page, '02-plano');

  // Reservar 100 m no canteiro
  await tid(page, 'dg-plan-act-reserve').click();
  await expect(tid(page, 'dg-supply-plan-confirm')).toBeVisible();
  await confirmDialog(page).click();
  await expect.poll(async () => (await one<{ n: number }>(db, `SELECT coalesce(sum(quantity),0)::int AS n FROM public.inventory_reservations
    WHERE organization_id = (SELECT organization_id FROM public.projects WHERE id = $1) AND requirement_id = $2 AND status = 'ACTIVE'`,
    [S.projectId, S.requirementId])).n, { timeout: 30_000 }).toBe(100);

  // Transferir 150 m de Santarém para o canteiro
  await expect(tid(page, 'dg-plan-act-transfer')).toBeVisible({ timeout: 30_000 });
  await tid(page, 'dg-plan-act-transfer').click();
  await confirmDialog(page).click();
  await expect.poll(async () => (await db.query(`SELECT t.status FROM public.inventory_transfers t
    WHERE t.from_location_id = $1 AND t.to_location_id = $2`, [S.depotId, S.siteId])).rows.map((r) => r.status), { timeout: 30_000 })
    .toContain('REQUESTED');
  await shot(page, '03-reserva-e-transferencia');
});

test('2 · compras cria a solicitação pelo Dashboard — só o comprável; a transferência pedida não é comprada de novo', async ({ browser }) => {
  // 500 requeridos, 100 reservados, 150 em transferência PEDIDA: a falta segue 400 (pendente não é cobertura), comprável 250
  expect(await coverage(S.requirementId)).toMatchObject({ required: 500, reserved: 100, pending: 150, shortage: 400, requested: 0, purchasable: 250 });
  const tr = await one<{ n: string }>(db, `SELECT transfer_number AS n FROM public.inventory_transfers
    WHERE from_location_id = $1 AND to_location_id = $2 AND status = 'REQUESTED'`, [S.depotId, S.siteId]);

  const page = await as(browser, 'compras');
  await supply(page);
  await scan(page);
  // "Criar solicitação" no passo Comprar do plano abre direto a confirmação (a quantidade dita é a que o BANCO pede)
  await tid(page, 'dg-plan-act-buy').click();
  const dialog = tid(page, 'dg-supply-requisition-confirm');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText('250');
  await expect(tid(page, 'dg-supply-requisition-pending-note')).toContainText(tr.n);
  await shot(page, '04-solicitacao-confirmacao');
  await confirmDialog(page).click();
  await expect.poll(async () => (await db.query(`SELECT r.status FROM public.purchase_requisitions r
    JOIN public.purchase_requisition_lines l ON l.requisition_id = r.id
    JOIN public.purchase_requisition_line_requirements x ON x.line_id = l.id
    WHERE x.requirement_id = $1`, [S.requirementId])).rows.map((r) => r.status), { timeout: 30_000 }).toContain('SUBMITTED');
  await expect(tid(page, 'dg-supply-requisition')).toContainText('RC-');
  await shot(page, '05-solicitacao-criada');

  // Sem dupla cobertura: o rastro leva 250 (não 400) e nada passa dos 500
  const traced = await one<{ q: number }>(db, `SELECT coalesce(sum(quantity), 0)::float8 AS q
    FROM public.purchase_requisition_line_requirements WHERE requirement_id = $1`, [S.requirementId]);
  expect(traced.q).toBe(250);
  const after = await coverage(S.requirementId);
  expect(after).toMatchObject({ requested: 250, pending: 150, purchasable: 0, shortage: 400 });
  expect(promised(after)).toBe(500);

  // O resto está pedido em transferência: comprar mais fica bloqueado — dito na tela, e Compras não tem a exceção
  await page.reload();
  await scan(page);
  await reveal(page, 'dg-supply-step-requisition', 'dg-supply-requisition-blocked');
  await expect(tid(page, 'dg-supply-transfer-pending')).toContainText(tr.n);
  await expect(tid(page, 'dg-supply-resolve-transfer')).toHaveAttribute('href', /\/supply\/estoque\?view=transferencias&transfer=/);
  await expect(page.getByTestId('dg-supply-coverage-exception')).toHaveCount(0);
  await shot(page, '05b-compra-bloqueada-pela-transferencia');
  // e o banco recusa uma segunda compra, nomeando a transferência
  const again = await requisition('compras', S.requirementId);
  expect(again.status).toBe(422);
  expect(again.error).toContain(tr.n);
});

test('3 · compras convida os homologados e envia a cotação (e-mail capturado)', async ({ browser }) => {
  const page = await as(browser, 'compras');
  await supply(page);
  await scan(page);
  const box = await reveal(page, 'dg-supply-step-suppliers', 'dg-supply-suppliers');
  // exatamente A e B convidados
  for (const cb of await box.getByRole('checkbox').all()) if (await cb.isChecked()) await cb.uncheck();
  await box.getByRole('checkbox', { name: `Convidar ${S.supplierA.name}` }).check();
  await box.getByRole('checkbox', { name: `Convidar ${S.supplierB.name}` }).check();
  await tid(page, 'dg-supply-invite').click();
  await expect(tid(page, 'dg-supply-invite-confirm')).toBeVisible();
  await shot(page, '06-convite-confirmacao');
  await confirmDialog(page).click();
  await expect(tid(page, 'dg-supply-send-results')).toBeVisible({ timeout: 60_000 });
  await shot(page, '07-cotacao-enviada');
  const rfq = await one<{ id: string; status: string; invited: number }>(db, `SELECT q.id, q.status,
      (SELECT count(*)::int FROM public.procurement_rfq_suppliers s WHERE s.rfq_id = q.id) AS invited
    FROM public.procurement_rfqs q JOIN public.procurement_rfq_lines rl ON rl.rfq_id = q.id
    JOIN public.purchase_requisition_line_requirements x ON x.line_id = rl.requisition_line_id
    WHERE x.requirement_id = $1 ORDER BY q.created_at DESC LIMIT 1`, [S.requirementId]);
  expect(rfq.status).toBe('OPEN');
  expect(rfq.invited).toBe(2);
  // o e-mail da cotação chegou à captura do QA para quem tem contato
  for (const s of [S.supplierA, S.supplierB]) {
    if (!s.email) continue;
    await expect.poll(async () => (await mailsTo(s.email as string, '', S.itemCode)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  }
});

test('4 · as propostas chegam (registro governado de Compras)', async () => {
  const g = await governed(db);
  const compras = qaLive().users.compras.id;
  const rfq = await one<{ id: string }>(db, `SELECT q.id FROM public.procurement_rfqs q JOIN public.procurement_rfq_lines rl ON rl.rfq_id = q.id
    JOIN public.purchase_requisition_line_requirements x ON x.line_id = rl.requisition_line_id
    WHERE x.requirement_id = $1 AND q.status = 'OPEN' ORDER BY q.created_at DESC LIMIT 1`, [S.requirementId]);
  const lines = (await db.query(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.id])).rows;
  const quote = (supplier: string, price: number, lead: number) => g.act('procurement_quote_record', g.org, compras, g.J({
    rfq_id: rfq.id, supplier_id: supplier, lead_time_days: lead, validity_date: '2099-01-01', payment_terms: '28 dias',
    lines: lines.map((l) => ({ rfq_line_id: l.id, unit_price: price })) }));
  await quote(S.supplierA.id, 38.9, 20);   // mais barato, chega depois da necessidade (12 dias)
  await quote(S.supplierB.id, 41.2, 5);    // mais caro, chega a tempo
});

test('5 · compras vê o A × B com a recomendação da Apex, decide e envia para aprovação', async ({ browser }) => {
  const page = await as(browser, 'compras');
  await supply(page);
  await scan(page);
  const ab = await reveal(page, 'dg-supply-step-quotes', 'dg-supply-ab');
  await expect(ab).toContainText(S.supplierA.name);
  await expect(ab).toContainText(S.supplierB.name);
  await expect(tid(page, 'dg-supply-recommendation')).toContainText('Apex recomenda');
  await ab.scrollIntoViewIfNeeded();
  await shot(page, '08-a-x-b');
  await tid(page, 'dg-supply-decide').click();
  await expect(tid(page, 'dg-supply-decide-confirm')).toBeVisible();
  await shot(page, '09-decidir-confirmacao');
  await confirmDialog(page).click();
  const po = await expect.poll(async () => (await db.query(`SELECT po.id, po.status FROM public.purchase_orders po
    JOIN public.purchase_order_lines l ON l.purchase_order_id = po.id
    WHERE po.project_id = $1 OR l.item_id = $2`, [S.projectId, S.itemId])).rows.map((r) => r.status), { timeout: 30_000 }).toContain('DRAFT');
  void po;
  // enviar para aprovação (o canteiro vira o local de entrega quando faltar)
  const submit = tid(page, 'dg-supply-submit');
  await expect(submit).toBeVisible({ timeout: 30_000 });
  await submit.click();
  await expect(tid(page, 'dg-supply-submit-confirm')).toBeVisible();
  await confirmDialog(page).click();
  await expect.poll(async () => (await db.query(`SELECT DISTINCT po.status FROM public.purchase_orders po
    JOIN public.purchase_order_lines l ON l.purchase_order_id = po.id WHERE l.item_id = $1`, [S.itemId])).rows.map((r) => r.status),
    { timeout: 30_000 }).toContain('APPROVAL_REQUIRED');
  await shot(page, '10-enviado-para-aprovacao');
});

test('6 · financeiro aprova a compra no Dashboard — o mesmo ato de Decisões', async ({ browser }) => {
  const page = await as(browser, 'financeiro');
  await supply(page);
  await scan(page);
  const decision = tid(page, 'dg-supply-decision');
  for (const st of ['dg-supply-step-quotes', 'dg-supply-step-follow']) {
    if (await decision.isVisible().catch(() => false)) break;
    const step = tid(page, st);
    if (await step.count()) { await step.getByRole('button').first().click(); await page.waitForTimeout(800); }
  }
  await expect(decision).toBeVisible({ timeout: 90_000 });
  await decision.scrollIntoViewIfNeeded();
  const approve = tid(page, 'dg-decision-act-approve').first();
  await expect(approve).toBeVisible({ timeout: 60_000 });
  await shot(page, '11-aprovar');
  await approve.click();
  await expect(tid(page, 'decision-confirm')).toBeVisible();
  await tid(page, 'decision-reason').fill('Chega a tempo para o lançamento — aprovado pelo fluxo do Dashboard.').catch(() => undefined);
  await shot(page, '12-aprovar-confirmacao');
  await tid(page, 'decision-confirm-submit').click();
  await expect.poll(async () => (await db.query(`SELECT DISTINCT po.status, po.approved_by FROM public.purchase_orders po
    JOIN public.purchase_order_lines l ON l.purchase_order_id = po.id WHERE l.item_id = $1`, [S.itemId])).rows.map((r) => r.status),
    { timeout: 60_000 }).toContain('APPROVED');
  const po = await one<{ approved_by: string }>(db, `SELECT po.approved_by FROM public.purchase_orders po
    JOIN public.purchase_order_lines l ON l.purchase_order_id = po.id WHERE l.item_id = $1 LIMIT 1`, [S.itemId]);
  expect(po.approved_by).toBe(qaLive().users.financeiro.id);
  await page.waitForTimeout(3000);
  await shot(page, '13-aprovado');
});

test('7 · busca externa: com a IA desligada no QA a tela diz isso — e a lista interna continua', async ({ browser }) => {
  const page = await as(browser, 'compras');
  await supply(page);
  await scan(page);
  await reveal(page, 'dg-supply-step-suppliers', 'dg-supply-suppliers');
  const off = tid(page, 'dg-supply-discover-off');
  const btn = tid(page, 'dg-supply-discover');
  if (await btn.count()) {
    await btn.first().click();
    await expect(tid(page, 'dg-supply-discover-out')).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(off).toBeVisible();
  }
  await shot(page, '14-busca-externa');
});
});

/**
 * REGRESSÕES DA REGRA 246 — cada uma no seu projeto descartável, pelas rotas
 * reais (almoxarifado reserva/transfere, compras requisita, o titular decide a
 * exceção). Independentes entre si: uma falha não pula as outras.
 */
test.describe('cobertura 246 — o que a transferência cobre, e quando', () => {

test('8 · transferência cancelada volta ao descoberto: a compra seguinte leva os 150', async () => {
  const s = await scenario('CAN', { required: 500, site: 100, depot: 150 });
  expect((await reserve('almoxarifado', s, 100)).status).toBe(200);
  const tr = await requestTransfer('almoxarifado', s, 150);
  expect(tr.status).toBe(200);
  expect(await coverage(s.requirementId)).toMatchObject({ shortage: 400, pending: 150, purchasable: 250 });

  const first = await requisition('compras', s.requirementId);
  expect(first.status).toBe(200);
  expect(first.result).toMatchObject({ requisitioned_qty: 250, override: false });
  const blocked = await requisition('compras', s.requirementId);
  expect(blocked.status).toBe(422);
  expect(blocked.error).toContain(String(tr.result.transfer_number));

  const cancel = await transferAct('almoxarifado', tr.result.transfer_id, { action: 'cancel', reason: 'Santarém precisou do cabo em outra obra.' });
  expect(cancel.status).toBe(200);
  expect(await coverage(s.requirementId)).toMatchObject({ shortage: 400, requested: 250, pending: 0, purchasable: 150 });

  const second = await requisition('compras', s.requirementId);
  expect(second.status).toBe(200);
  expect(second.result).toMatchObject({ requisitioned_qty: 150, override: false });
  const end = await coverage(s.requirementId);
  expect(end).toMatchObject({ requested: 400, pending: 0, purchasable: 0 });
  expect(promised(end)).toBe(500);
});

test('9 · transferência perdida no caminho (despachada, encerrada sem receber) devolve a falta', async () => {
  const s = await scenario('LOST', { required: 500, depot: 150 });
  const tr = await requestTransfer('almoxarifado', s, 150);
  expect(tr.status).toBe(200);
  expect((await transferAct('almoxarifado', tr.result.transfer_id, { action: 'approve' })).status).toBe(200);
  expect((await transferAct('almoxarifado', tr.result.transfer_id, { action: 'dispatch', carrier: 'Balsa QA' })).status).toBe(200);
  expect(await coverage(s.requirementId)).toMatchObject({ transit: 150, pending: 0, shortage: 350, purchasable: 350 });

  const first = await requisition('compras', s.requirementId);
  expect(first.result).toMatchObject({ requisitioned_qty: 350 });
  expect(promised(await coverage(s.requirementId))).toBe(500);

  const close = await transferAct('almoxarifado', tr.result.transfer_id, { action: 'close', reason: 'Carga extraviada na balsa — nada chegou ao canteiro.' });
  expect(close.status).toBe(200);
  expect(await coverage(s.requirementId)).toMatchObject({ transit: 0, pending: 0, shortage: 500, requested: 350, purchasable: 150 });

  const second = await requisition('compras', s.requirementId);
  expect(second.result).toMatchObject({ requisitioned_qty: 150 });
  const end = await coverage(s.requirementId);
  expect(end).toMatchObject({ requested: 500, purchasable: 0 });
  expect(promised(end)).toBe(500);
});

test('10 · aprovada ainda é pendente; despachada reduz a compra — e nem a exceção compra de novo o que já saiu', async () => {
  const s = await scenario('DSP', { required: 500, site: 100, depot: 150 });
  expect((await reserve('almoxarifado', s, 100)).status).toBe(200);
  const tr = await requestTransfer('almoxarifado', s, 150);
  expect(tr.status).toBe(200);
  // aprovar não segura estoque: continua pendente, a falta continua 400
  expect((await transferAct('almoxarifado', tr.result.transfer_id, { action: 'approve' })).status).toBe(200);
  expect(await coverage(s.requirementId)).toMatchObject({ transit: 0, pending: 150, shortage: 400, purchasable: 250 });
  // despachar compromete: vira "em trânsito" e a falta cai para 250
  expect((await transferAct('almoxarifado', tr.result.transfer_id, { action: 'dispatch' })).status).toBe(200);
  expect(await coverage(s.requirementId)).toMatchObject({ transit: 150, pending: 0, shortage: 250, purchasable: 250 });

  const buy = await requisition('compras', s.requirementId);
  expect(buy.status).toBe(200);
  expect(buy.result).toMatchObject({ requisitioned_qty: 250, override: false });
  // a exceção só compra o PENDENTE; o despachado já é cobertura — nada a comprar
  const exception = await requisition('owner', s.requirementId,
    { coverageOverride: { reason: 'Tentativa de comprar de novo o que já está em trânsito.' } });
  expect(exception.status).toBe(422);
  const end = await coverage(s.requirementId);
  expect(end).toMatchObject({ reserved: 100, transit: 150, requested: 250, purchasable: 0 });
  expect(promised(end)).toBe(500);
});

test('11 · concorrência: duas compras ao mesmo tempo não compram o pendente; a mesma chave dá a mesma solicitação', async () => {
  await warm();
  const s = await scenario('RR', { required: 500, depot: 150 });
  expect((await requestTransfer('almoxarifado', s, 150)).status).toBe(200);
  const race = await forcedOverlap(LOCK_REQUIREMENT, [s.requirementId],
    () => [requisition('compras', s.requirementId), requisition('compras', s.requirementId)]);
  expect(race.map((r) => r.status).sort()).toEqual([200, 422]);
  expect(race.find((r) => r.status === 200)?.result).toMatchObject({ requisitioned_qty: 350 });
  const c = await coverage(s.requirementId);
  expect(c).toMatchObject({ requested: 350, pending: 150, purchasable: 0 });
  expect(promised(c)).toBe(500);

  // repetição concorrente com a MESMA chave: uma solicitação só, a outra resposta é a repetição dela
  const k = await scenario('RK', { required: 300 });
  const key = intent('same');
  const twice = await forcedOverlap(LOCK_REQUIREMENT, [k.requirementId],
    () => [requisition('compras', k.requirementId, { idempotencyKey: key }), requisition('compras', k.requirementId, { idempotencyKey: key })]);
  expect(twice.map((r) => r.status)).toEqual([200, 200]);
  expect(twice[0].result.requisition_id).toBe(twice[1].result.requisition_id);
  expect(twice.map((r) => r.result.replayed).sort()).toEqual([false, true]);
  expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM public.purchase_requisitions WHERE idempotency_key = $1`, [key])).n).toBe(1);
  expect(await coverage(k.requirementId)).toMatchObject({ requested: 300, purchasable: 0 });
});

test('12 · concorrência: compra ∥ transferência ∥ reserva nunca prometem além do requerido', async () => {
  await warm();
  const s = await scenario('MIX', { required: 500, site: 200, depot: 300 });
  const race = await forcedOverlap(LOCK_REQUIREMENT, [s.requirementId], () => [
    requisition('compras', s.requirementId),
    requestTransfer('almoxarifado', s, 300),
    reserve('almoxarifado', s, 200),
  ], 3);
  // qualquer ordem: quem chega por cima do que já está prometido é recusado (422), nunca erro de servidor
  for (const r of race) expect([200, 422]).toContain(r.status);
  expect(race.some((r) => r.status === 200)).toBe(true);
  const c = await coverage(s.requirementId);
  expect(promised(c)).toBe(500);
  expect(c.purchasable).toBe(0);
});

test('13 · exceção de cobertura governada: Compras não tem a alçada; o titular registra, com motivo, no Dashboard', async ({ browser }) => {
  const s = await scenario('EXC', { required: 400, depot: 400 });
  const tr = await requestTransfer('almoxarifado', s, 400);
  expect(tr.status).toBe(200);
  expect(await coverage(s.requirementId)).toMatchObject({ shortage: 400, pending: 400, purchasable: 0 });

  // pela rota: Compras pede a exceção → 403 (a permissão é conferida no banco); motivo curto → 400
  const denied = await requisition('compras', s.requirementId, { coverageOverride: { reason: 'Obra parada esperando o cabo chegar.' } });
  expect(denied.status).toBe(403);
  expect((await requisition('owner', s.requirementId, { coverageOverride: { reason: 'curto' } })).status).toBe(400);
  expect((await coverage(s.requirementId)).requested).toBe(0);

  // na tela de Compras: bloqueada, a transferência dita, sem o botão da exceção
  const compras = await as(browser, 'compras');
  await compras.goto(`/dashboard?site=${s.projectId}&m=supply`);
  await scan(compras);
  await reveal(compras, 'dg-supply-step-requisition', 'dg-supply-requisition-blocked');
  await expect(tid(compras, 'dg-supply-transfer-pending')).toContainText(String(tr.result.transfer_number));
  await expect(compras.getByTestId('dg-supply-coverage-exception')).toHaveCount(0);

  // o titular: a exceção, com a justificativa obrigatória (contador; curta não confirma)
  const owner = await as(browser, 'owner');
  await owner.goto(`/dashboard?site=${s.projectId}&m=supply`);
  await scan(owner);
  await reveal(owner, 'dg-supply-step-requisition', 'dg-supply-requisition-blocked');
  await tid(owner, 'dg-supply-coverage-exception').click();
  await expect(tid(owner, 'dg-supply-exception-confirm')).toBeVisible();
  await tid(owner, 'dg-supply-exception-reason').fill('curto demais');
  await expect(confirmDialog(owner)).toBeDisabled();
  const reason = 'Cliente antecipou a frente de lançamento: a transferência de Santarém não chega a tempo.';
  await tid(owner, 'dg-supply-exception-reason').fill(reason);
  await expect(confirmDialog(owner)).toBeEnabled();
  await shot(owner, '15-excecao-de-cobertura');
  await confirmDialog(owner).click();

  // registrada: livro append-only, evento próprio e auditoria da rota — com a pessoa e o motivo
  await expect.poll(async () => (await db.query(`SELECT 1 FROM public.procurement_coverage_exceptions WHERE requirement_id = $1`,
    [s.requirementId])).rowCount, { timeout: 30_000 }).toBe(1);
  const row = await one<{ requisition_id: string; q: number; p: number; b: number; authorized_by: string; authorized_permission: string; reason: string }>(db,
    `SELECT requisition_id, requisitioned_qty::float8 AS q, pending_transfer_qty::float8 AS p, purchasable_qty::float8 AS b,
       authorized_by, authorized_permission, reason FROM public.procurement_coverage_exceptions WHERE requirement_id = $1`, [s.requirementId]);
  expect(row).toMatchObject({ q: 400, p: 400, b: 0, authorized_by: qaLive().users.owner.id,
    authorized_permission: 'procurement.coverage_override', reason });
  expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM public.domain_events
    WHERE event_type = 'supply.requisition.coverage_exception' AND aggregate_id::text = $1`, [row.requisition_id])).n).toBe(1);
  // a auditoria da rota é gravada logo DEPOIS do ato (que já está confirmado no banco): espera-se por ela
  await expect.poll(async () => (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM public.audit_logs
    WHERE action = 'supply.requisition.submitted' AND entity_id::text = $1 AND metadata->>'override' = 'true'`, [row.requisition_id])).n,
  { timeout: 15_000 }).toBe(1);
  await expect(db.query(`UPDATE public.procurement_coverage_exceptions SET reason = reason || '.' WHERE requirement_id = $1`, [s.requirementId]))
    .rejects.toThrow(/append-only/);
  const end = await coverage(s.requirementId);
  expect(end).toMatchObject({ requested: 400, pending: 400, purchasable: 0 });   // declarado: a exceção comprou o pendente

  // e a tela diz a verdade DEPOIS: o pendente já foi comprado (chega em dobro se despachado) — nunca "não é comprada de novo"
  await owner.reload();
  await scan(owner);
  const overlap = await reveal(owner, 'dg-supply-step-requisition', 'dg-supply-transfer-overlap');
  await expect(overlap).toContainText('exceção de cobertura');
  await expect(overlap).toContainText('em dobro');
  await expect(tid(owner, 'dg-supply-transfer-pending')).not.toContainText('não é comprada de novo');
  const plan = await reveal(owner, 'dg-supply-step-plan', 'dg-supply-plan-steps');
  await expect(plan).toContainText('em dobro');
  await expect(plan).not.toContainText('Acima do que falta');
  await shot(owner, '16-excecao-registrada');
});
});
