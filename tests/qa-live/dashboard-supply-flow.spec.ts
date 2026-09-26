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
 * Capturas em test-results/dashboard-supply-flow-shots — revisão visual, nunca versionadas.
 *
 *   QA_APP_URL=http://localhost:9103 npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/dashboard-supply-flow.spec.ts
 */
import fs from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type pg from 'pg';
import { authFile, governed, one, qaDb, qaLive, tag, type QaRole } from './support';
import { mailsTo, plusDays } from './decisions-support';

test.describe.configure({ mode: 'serial' });
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
test.afterAll(async () => { for (const c of opened) await c.close().catch(() => undefined); await db?.end(); });

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

test('2 · compras cria a solicitação de compra pelo Dashboard', async ({ browser }) => {
  const page = await as(browser, 'compras');
  await supply(page);
  await scan(page);
  // "Criar solicitação" no passo Comprar do plano abre direto a confirmação (a quantidade dita é a que o BANCO pede)
  await tid(page, 'dg-plan-act-buy').click();
  await expect(tid(page, 'dg-supply-requisition-confirm')).toBeVisible({ timeout: 30_000 });
  await shot(page, '04-solicitacao-confirmacao');
  await confirmDialog(page).click();
  await expect.poll(async () => (await db.query(`SELECT r.status FROM public.purchase_requisitions r
    JOIN public.purchase_requisition_lines l ON l.requisition_id = r.id
    JOIN public.purchase_requisition_line_requirements x ON x.line_id = l.id
    WHERE x.requirement_id = $1`, [S.requirementId])).rows.map((r) => r.status), { timeout: 30_000 }).toContain('SUBMITTED');
  await expect(tid(page, 'dg-supply-requisition')).toContainText('RC-');
  await shot(page, '05-solicitacao-criada');
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
