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
 * PEDIDO PARCIAL E CANCELAMENTO (regra 248): emitir um pedido menor que a
 * linha deixa o NÃO PEDIDO explícito no livro append-only de liberações;
 * cancelar reabre só o que ainda falta com toda a outra cobertura contada —
 * nunca acima do requerido, nem em corrida com nova solicitação, reserva ou a
 * emissão de outro pedido da mesma solicitação; a recotação pede só o aberto;
 * proposta velha de solicitação cancelada não vira pedido.
 *
 * ORDEM DAS TRAVAS (regra 249): as corridas que dependem de quem passa
 * primeiro rodam nas DUAS ordens, forçadas na fila da trava — emitir ∥
 * cancelar, e o pedido parcial LEGADO (emitido antes da 248, sem o não pedido
 * no livro) cancelado ∥ nova solicitação, onde só a trava do requisito no
 * cancelamento segura o requerido. A linha que a proposta vencedora não cotou
 * volta a ser cotável — na tela de Compras e pela rota.
 *
 * Capturas em test-results/dashboard-supply-flow-shots — revisão visual, nunca versionadas.
 *
 *   QA_APP_URL=http://localhost:9103 npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/dashboard-supply-flow.spec.ts
 */
import fs from 'node:fs';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type pg from 'pg';
import { apiAs, authFile, forcedOrder, forcedOverlap, governed, one, qaDb, qaLive, tag, type QaRole } from './support';
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
/** Desfecho por requisito do pedido (248): emitir devolve o não pedido; cancelar, o reaberto e o liberado — com item e unidade. */
type ReqOutcome = { requirement_id: string; item_id: string; unit: string; released_qty: number; reopened_qty?: number; cause?: string | null };
type Out = { status: number; error: string; result: {
  requisition_id?: string; requisition_number?: string; requisitioned_qty?: number; override?: boolean; replayed?: boolean;
  transfer_id?: string; transfer_number?: string;
  rfq_id?: string; rfq_number?: string; quote_id?: string; purchase_order_id?: string; order_number?: string;
  status?: string; governance?: string; released?: ReqOutcome[]; requirements?: ReqOutcome[];
  requisitions?: Array<{ requisition_id: string; requisition_number: string; status_from: string; status_to: string }>;
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
/**
 * Compila as rotas no servidor de desenvolvimento ANTES da sobreposição (senão a primeira chamada chega sozinha).
 * Corpo vazio: a rota confere a permissão e recusa o formato (400) — nada é gravado.
 */
const warm = async (paths = [REQUISITIONS, TRANSFERS, RESERVATIONS]) => { for (const p of paths) await post('owner', p, {}); };
const LOCK_REQUIREMENT = 'SELECT 1 FROM public.project_requirements WHERE id = $1 FOR UPDATE';

/**
 * A categoria dos itens deste fluxo — SÓ os fornecedores A e B do seed a têm. Os candidatos do item no Dashboard são
 * os 20 primeiros por homologação, base e pontualidade: em "Cabos", cada rodada do caminho dourado deixa um "Cabos
 * Ouro" homologado com 100% de pontualidade, e com 20 deles A (sem histórico) e B (0%) saíram da lista — o passo 3
 * não achava quem convidar. Com a categoria própria, os candidatos do item são A e B, qualquer que seja o QA.
 */
const FLOW_CATEGORY = 'Cabos Fluxo QA';

/** Um projeto descartável por regressão: canteiro em Altamira, almoxarifado em Santarém, um cabo confirmado. */
type Scn = { projectId: string; itemId: string; itemCode: string; siteId: string; depotId: string; requirementId: string };
async function scenario(suffix: string, o: { required: number; site?: number; depot?: number }): Promise<Scn> {
  const g = await governed(db);
  const code = `${T}-${suffix}`;
  const projectId = `qa-flx-${code.toLowerCase()}`;
  await db.query(`INSERT INTO public.projects (id, organization_id, project, created_by) VALUES ($1,$2,$3,$4)`,
    [projectId, g.org, g.J({ id: projectId, nome: `SE Fluxo ${code} 138 kV — cobertura`, cliente: 'Cliente QA Fluxo',
      status: 'em_andamento', cidade: 'Altamira', uf: 'PA' }), g.actor]);
  const itemCode = `FLX-CABO-${code}`;
  const itemId = await g.item(itemCode, 'm', FLOW_CATEGORY);
  const siteId = await g.location(`FLX-S-${code}`, 'PROJECT_SITE', { project_id: projectId, latitude: SITE.lat, longitude: SITE.lng });
  const depotId = await g.location(`FLX-D-${code}`, 'WAREHOUSE', { latitude: DEPOT.lat, longitude: DEPOT.lng });
  if (o.site) await g.stock(itemId, siteId, o.site);
  if (o.depot) await g.stock(itemId, depotId, o.depot);
  return { projectId, itemId, itemCode, siteId, depotId, requirementId: await g.material(projectId, itemId, o.required, plusDays(12)) };
}

test.beforeAll(async () => {
  db = await qaDb();
  const g = await governed(db);
  const live = qaLive();
  // A e B na categoria do fluxo (idempotente, pelo cadastro governado — só acrescenta; QA semeado antes dela também).
  for (const id of [live.suppliers.a, live.suppliers.b]) {
    const cur = await one<{ party_id: string; categories: string[] }>(db, `SELECT party_id, categories FROM public.supplier_profiles WHERE id = $1`, [id]);
    if (!cur.categories.includes(FLOW_CATEGORY)) {
      await g.act('supplier_register', g.org, g.actor, g.J({ party_id: cur.party_id, categories: [...cur.categories, FLOW_CATEGORY] }));
    }
  }
  // Governança por alçada declarada (o mesmo ajuste das provas de Decisões).
  await db.query(`UPDATE public.approval_policy_versions SET status = 'INACTIVE'
    WHERE organization_id = $1 AND subject_type = 'purchase_order' AND status = 'ACTIVE'`, [g.org]);
  const itemCode = `FLX-CABO-${T}`;
  const itemId = await g.item(itemCode, 'm', FLOW_CATEGORY);
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

// ── 248: compras pelas rotas reais — cotação, proposta, decisão, aprovação, emissão e cancelamento ──
const RFQS = '/api/supply/procurement/rfqs';
const ORDERS = '/api/supply/procurement/purchase-orders';
/** Id que não existe: só para compilar as rotas dinâmicas no aquecimento (o corpo vazio é recusado antes do id). */
const NIL = '00000000-0000-0000-0000-000000000000';
const PROCUREMENT_ROUTES = [REQUISITIONS, RESERVATIONS, RFQS, `${RFQS}/${NIL}`, `${ORDERS}/${NIL}`, `${REQUISITIONS}/${NIL}`];
const LOCK_REQUISITION = 'SELECT 1 FROM public.purchase_requisitions WHERE id = $1 FOR UPDATE';

/** O que o banco reivindica para o requisito (comprometido + requisitado em aberto) — a guarda de toda escrita. */
const claimed = async (requirementId: string) => (await one<{ c: number }>(db,
  `SELECT public.supply_requirement_claimed($1, $2)::float8 AS c`, [qaLive().organization.id, requirementId])).c;
const lineOf = async (requisitionId: string, itemId: string) => (await one<{ id: string }>(db,
  `SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1 AND item_id = $2`, [requisitionId, itemId])).id;
const requisitionState = (id: string) => one<{ status: string }>(db, `SELECT status FROM public.purchase_requisitions WHERE id = $1`, [id]);
const rfqState = (id: string) => one<{ status: string; reason: string | null }>(db,
  `SELECT status, close_reason AS reason FROM public.procurement_rfqs WHERE id = $1`, [id]);
/** O aberto de uma alocação (alocado − liberado), lido da visão canônica. */
const openOf = (requisitionId: string, requirementId: string) => one<{ allocated: number; released: number; open: number }>(db,
  `SELECT allocated_qty::float8 AS allocated, released_qty::float8 AS released, open_qty::float8 AS open
     FROM public.purchase_requisition_open_allocations WHERE requisition_id = $1 AND requirement_id = $2`, [requisitionId, requirementId]);
/** O livro append-only de liberações do requisito, na ordem em que foi escrito. */
const releases = async (requirementId: string) => (await db.query(`SELECT stage, cause, quantity::float8 AS q,
    purchase_order_id AS po, requisition_id AS rq, reason
  FROM public.procurement_requisition_releases WHERE requirement_id = $1 ORDER BY created_at, id`, [requirementId])).rows;
/** Linhas de pedido VIVO (não cancelado) sobre uma linha de solicitação. */
const liveOrderLines = async (requisitionLineId: string) => (await one<{ n: number }>(db, `SELECT count(*)::int AS n
  FROM public.purchase_order_lines pl JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
  WHERE pl.requisition_line_id = $1 AND po.status <> 'CANCELLED'`, [requisitionLineId])).n;

/** Um segundo material confirmado na mesma obra: outro item, outra linha da solicitação. */
async function secondMaterial(s: Scn, suffix: string, required: number) {
  const g = await governed(db);
  const code = `FLX-CONE-${T}-${suffix}`;
  const itemId = await g.item(code, 'un', FLOW_CATEGORY);
  return { itemId, code, requirementId: await g.material(s.projectId, itemId, required, plusDays(12)) };
}

/**
 * Compras cota as linhas com o fornecedor A e registra a proposta — `quantities` fixa, por linha de
 * solicitação, uma quantidade MENOR que a cotada (o pedido parcial); `priced` diz as linhas de
 * solicitação que a proposta preça (as outras ficam SEM preço). A cotação fica aberta.
 */
async function quoted(lineIds: string[], quantities: Record<string, number> = {}, priced: string[] = lineIds) {
  const supplierId = qaLive().suppliers.a;
  const rfq = await post('compras', RFQS, { requisitionLineIds: lineIds, supplierIds: [supplierId] });
  expect(rfq.status, rfq.error).toBe(200);
  const rfqId = String(rfq.result.rfq_id);
  const lines = (await db.query(`SELECT id, requisition_line_id AS line FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfqId])).rows;
  const quote = await post('compras', `${RFQS}/${rfqId}`, { action: 'quote', supplierId, validityDate: '2099-01-01', leadTimeDays: 10,
    paymentTerms: '28 dias', lines: lines.filter((l) => priced.includes(l.line))
      .map((l) => ({ rfqLineId: l.id, unitPrice: 25, ...(quantities[l.line] ? { quantity: quantities[l.line] } : {}) })) });
  expect(quote.status, quote.error).toBe(200);
  return { rfqId, quoteId: String(quote.result.quote_id) };
}
const decide = (q: { rfqId: string; quoteId: string }) => post('compras', `${RFQS}/${q.rfqId}`,
  { action: 'decide', quoteId: q.quoteId, rationale: 'Única proposta do fornecedor homologado (regressão 248).' });
const poAct = (role: QaRole, id: string, body: Record<string, unknown>) => post(role, `${ORDERS}/${id}`, body);
const cancelOrder = (id: string) => poAct('compras', id, { action: 'cancel', reason: 'Fornecedor não confirmou o prazo: recotar o material.' });
const cancelRequisition = (id: string) => post('compras', `${REQUISITIONS}/${id}`,
  { action: 'cancel', reason: 'Frente replanejada: o material sai desta solicitação.' });

/**
 * Da proposta ao pedido, cada ato pela sua rota e com o seu papel: compras decide e submete (alçada
 * declarada — a política do inquilino fica desligada no beforeAll); o Financeiro aprova (quem criou não
 * aprova); compras emite, quando `until` pede.
 */
async function order(q: { rfqId: string; quoteId: string }, until: 'APPROVED' | 'ISSUED' = 'ISSUED') {
  const decided = await decide(q);
  expect(decided.status, decided.error).toBe(200);
  const poId = String(decided.result.purchase_order_id);
  const submitted = await poAct('compras', poId, { action: 'submit', note: 'Regressão 248' });
  expect(submitted.status, submitted.error).toBe(200);
  expect(submitted.result.governance).toBe('AUTHORITY');
  const approved = await poAct('financeiro', poId, { action: 'approve', note: 'Dentro da alçada (regressão 248).' });
  expect(approved.status, approved.error).toBe(200);
  let issued: Out | null = null;
  if (until === 'ISSUED') {
    issued = await poAct('compras', poId, { action: 'issue' });
    expect(issued.status, issued.error).toBe(200);
  }
  return { rfqId: q.rfqId, poId, orderNumber: String(decided.result.order_number), issued };
}

/** A solicitação da falta toda (RC-A, entrega no canteiro) e um pedido EMITIDO de `quantity` contra a sua linha. */
async function partialOrder(s: Scn, quantity: number) {
  const rc = await requisition('compras', s.requirementId, { deliveryLocationId: s.siteId });
  expect(rc.status, rc.error).toBe(200);
  const requisitionId = String(rc.result.requisition_id);
  const lineId = await lineOf(requisitionId, s.itemId);
  const po = await order(await quoted([lineId], { [lineId]: quantity }));
  return { requisitionId, requisitionNumber: String(rc.result.requisition_number), requisitioned: rc.result.requisitioned_qty, lineId, ...po };
}

/**
 * O LEGADO de antes da 248: a RC-A da falta toda e um pedido de `quantity` pela cadeia governada até
 * APROVADO; a emissão de então é refeita por escrita direta — pedido EMITIDO (com o histórico 'issued'
 * que ela gravava) e RC-A PEDIDA, SEM o não pedido no livro: o aberto da alocação segue o requisitado
 * inteiro. As linhas do pedido não mudam (pol_guard: só em rascunho) e a impressão da aprovação é a mesma.
 */
async function legacyPartialOrder(s: Scn, quantity: number) {
  const rc = await requisition('compras', s.requirementId, { deliveryLocationId: s.siteId });
  expect(rc.status, rc.error).toBe(200);
  const requisitionId = String(rc.result.requisition_id);
  const lineId = await lineOf(requisitionId, s.itemId);
  const po = await order(await quoted([lineId], { [lineId]: quantity }), 'APPROVED');
  const actor = qaLive().users.compras.id;
  await db.query('BEGIN');
  try {
    expect((await db.query(`UPDATE public.purchase_orders SET status = 'ISSUED', issued_by = $2, issued_at = now()
      WHERE id = $1 AND status = 'APPROVED' AND approved_fingerprint = public.purchase_order_fingerprint(id)`, [po.poId, actor])).rowCount).toBe(1);
    await db.query(`SELECT public.purchase_order_log(po, 'issued', 'APPROVED', NULL, jsonb_build_object('fingerprint', po.approved_fingerprint), $2)
      FROM public.purchase_orders po WHERE po.id = $1`, [po.poId, actor]);
    expect((await db.query(`UPDATE public.purchase_requisitions SET status = 'ORDERED' WHERE id = $1 AND status = 'SOURCING'`,
      [requisitionId])).rowCount).toBe(1);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  return { requisitionId, requisitionNumber: String(rc.result.requisition_number), lineId, ...po };
}

/**
 * REGRESSÕES DA REGRA 248 — pedido parcial, cancelamento e reabertura. Cada
 * uma no seu projeto descartável, cada ato pela rota real do seu papel
 * (compras cota, decide, emite e cancela; o Financeiro aprova; o almoxarifado
 * reserva). Independentes entre si: uma falha não pula as outras.
 */
test.describe('pedido parcial e cancelamento — 248', () => {

test('14 · pedido parcial emitido, RC-B no resto, compras cancela: reabre 60 — nunca 140 — e a tela de Compras mostra o aberto', async ({ browser }) => {
  const s = await scenario('PAR', { required: 100 });
  const a = await partialOrder(s, 60);   // proposta de 60 contra a linha de 100
  expect(a.requisitioned).toBe(100);
  // emitir deixa o NÃO PEDIDO explícito: 40 no livro (PO_ISSUED · NOT_ORDERED), com o número do pedido — nada reivindicado a mais
  expect(a.issued?.result.released).toMatchObject([{ requirement_id: s.requirementId, item_id: s.itemId, unit: 'm', released_qty: 40 }]);
  const atIssue = await releases(s.requirementId);
  expect(atIssue).toMatchObject([{ stage: 'PO_ISSUED', cause: 'NOT_ORDERED', q: 40, po: a.poId, rq: a.requisitionId }]);
  expect(atIssue[0].reason).toContain(a.orderNumber);
  expect(await openOf(a.requisitionId, s.requirementId)).toEqual({ allocated: 100, released: 40, open: 60 });
  expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM public.domain_events
    WHERE event_type = 'supply.requisition.released' AND idempotency_key = $1`,
  [`requisition:${a.requisitionId}:released:${a.poId}:PO_ISSUED:${s.projectId}`])).n).toBe(1);
  expect((await requisitionState(a.requisitionId)).status).toBe('ORDERED');
  expect(await coverage(s.requirementId)).toMatchObject({ ordered: 60, requested: 0, purchasable: 40 });
  expect(await claimed(s.requirementId)).toBe(60);

  // RC-B leva o resto
  const b = await requisition('compras', s.requirementId);
  expect(b.status, b.error).toBe(200);
  expect(b.result).toMatchObject({ requisitioned_qty: 40 });
  expect(promised(await coverage(s.requirementId))).toBe(100);

  // compras cancela pela rota: reabre SÓ os 60 que o pedido tinha — os 40 já estão na RC-B
  const cancel = await cancelOrder(a.poId);
  expect(cancel.status, cancel.error).toBe(200);
  expect(cancel.result).toMatchObject({ purchase_order_id: a.poId, status: 'CANCELLED', replayed: false,
    requirements: [{ requirement_id: s.requirementId, item_id: s.itemId, unit: 'm', reopened_qty: 60, released_qty: 0 }],
    requisitions: [{ requisition_id: a.requisitionId, requisition_number: a.requisitionNumber, status_from: 'ORDERED', status_to: 'SUBMITTED' }] });
  const after = await coverage(s.requirementId);
  expect(after).toMatchObject({ ordered: 0, requested: 100, purchasable: 0 });
  expect(promised(after)).toBe(100);
  expect(await claimed(s.requirementId)).toBe(100);
  expect(await openOf(a.requisitionId, s.requirementId)).toMatchObject({ open: 60 });
  expect(await releases(s.requirementId)).toHaveLength(1);   // coube no requerido: nada liberado no cancelamento
  expect((await requisitionState(a.requisitionId)).status).toBe('SUBMITTED');
  expect((await rfqState(a.rfqId)).status).toBe('CANCELLED');
  // a repetição devolve o MESMO desfecho, guardado no histórico do pedido
  const replay = await cancelOrder(a.poId);
  expect(replay.status, replay.error).toBe(200);
  expect(replay.result).toMatchObject({ status: 'CANCELLED', replayed: true,
    requirements: cancel.result.requirements, requisitions: cancel.result.requisitions });
  // a auditoria da rota guarda o desfecho por requisito e por requisição — e marca a repetição
  await expect.poll(async () => (await db.query(`SELECT metadata FROM public.audit_logs
    WHERE action = 'supply.purchase_order.cancel' AND entity_id::text = $1 ORDER BY created_at`, [a.poId])).rows
    .map(({ metadata: m }) => ({ replayed: m.replayed, reopened: m.requirements?.[0]?.reopenedQty, to: m.requisitions?.[0]?.to })),
  { timeout: 15_000 }).toEqual([{ replayed: false, reopened: 60, to: 'SUBMITTED' }, { replayed: true, reopened: 60, to: 'SUBMITTED' }]);
  // e uma terceira compra é recusada: nada comprável
  expect((await requisition('compras', s.requirementId)).status).toBe(422);

  // a tela de Compras: a RC-A reaberta com o ABERTO (60 m, não 100), a nota do que o pedido não pediu, e cotável de novo
  const page = await as(browser, 'compras');
  await page.goto(`/supply/compras?stage=solicitacoes&rq=${a.requisitionId}`);
  const card = page.getByRole('article', { name: `Requisição ${a.requisitionNumber}` });
  await expect(card).toBeVisible({ timeout: 60_000 });
  const row = card.getByTestId('requisition-row');
  await expect(row.getByTestId('requisition-open-qty')).toHaveText('60 m');
  await expect(row).toContainText('em aberto de 100 m requisitados');
  await expect(row.getByTestId('requisition-release-note')).toHaveText(`40 m — não pedida no ${a.orderNumber}`);
  await expect(row).toContainText('sem cotação');
  await expect(row.getByRole('checkbox')).toBeVisible();
  await shot(page, '17-compras-solicitacao-reaberta');

  // recotar pede só o aberto
  const again = await post('compras', RFQS, { requisitionLineIds: [a.lineId], supplierIds: [qaLive().suppliers.a] });
  expect(again.status, again.error).toBe(200);
  expect((await one<{ q: number }>(db, `SELECT quantity::float8 AS q FROM public.procurement_rfq_lines WHERE rfq_id = $1`,
    [again.result.rfq_id])).q).toBe(60);
  expect((await requisitionState(a.requisitionId)).status).toBe('SOURCING');
  expect(promised(await coverage(s.requirementId))).toBe(100);
});

test('15 · concorrência: cancelar o pedido ∥ solicitar o resto, e ∥ reservar o resto — nunca além do requerido', async () => {
  await warm(PROCUREMENT_ROUTES);
  // cancelar ∥ nova solicitação: qualquer ordem, as duas passam — a RC nova leva os 40, o cancelamento reabre os 60
  const s = await scenario('CXS', { required: 100 });
  const a = await partialOrder(s, 60);
  expect(await coverage(s.requirementId)).toMatchObject({ ordered: 60, requested: 0, purchasable: 40 });
  const race = await forcedOverlap(LOCK_REQUIREMENT, [s.requirementId],
    () => [cancelOrder(a.poId), requisition('compras', s.requirementId)]);
  expect(race.map((r) => [r.status, r.error])).toEqual([[200, ''], [200, '']]);
  expect(race[0].result.requirements).toMatchObject([{ requirement_id: s.requirementId, reopened_qty: 60, released_qty: 0 }]);
  expect(race[1].result).toMatchObject({ requisitioned_qty: 40 });
  const c = await coverage(s.requirementId);
  expect(c).toMatchObject({ ordered: 0, requested: 100, purchasable: 0 });
  expect(promised(c)).toBe(100);
  expect(await claimed(s.requirementId)).toBe(100);

  // cancelar ∥ reservar os 40 do canteiro: o mesmo — a reserva cabe, o cancelamento reabre só o que ela deixou
  const r = await scenario('CXR', { required: 100, site: 40 });
  const b = await partialOrder(r, 60);
  expect(await coverage(r.requirementId)).toMatchObject({ ordered: 60, requested: 0, purchasable: 40 });
  const race2 = await forcedOverlap(LOCK_REQUIREMENT, [r.requirementId], () => [cancelOrder(b.poId), reserve('almoxarifado', r, 40)]);
  expect(race2.map((x) => [x.status, x.error])).toEqual([[200, ''], [200, '']]);
  expect(race2[0].result.requirements).toMatchObject([{ requirement_id: r.requirementId, reopened_qty: 60, released_qty: 0 }]);
  const d = await coverage(r.requirementId);
  expect(d).toMatchObject({ reserved: 40, ordered: 0, requested: 60, purchasable: 0 });
  expect(promised(d)).toBe(100);
  expect(await claimed(r.requirementId)).toBe(100);
});

/*
 * A regressão que a 16 guarda — a emissão marcando a RC-A "pedida" pelo retrato de ANTES da espera — só
 * aparece com o cancelamento na frente; com a emissão na frente o resultado sai certo mesmo com ela. Então a
 * corrida roda nas DUAS ordens, forçadas na fila da trava da RC-A, e cada uma confere a ordem que rodou.
 */
for (const first of ['cancel', 'issue'] as const) {
test(`16 · concorrência: emitir um pedido ∥ cancelar o outro da MESMA solicitação, ${first === 'cancel' ? 'o cancelamento' : 'a emissão'} na frente — nunca além do requerido`, async () => {
  await warm(PROCUREMENT_ROUTES);
  // RC-A com duas linhas: cabo (100 m) e conector (50 un); pedido A = 60 m do cabo, EMITIDO; pedido B = 50 un, APROVADO
  const suffix = first === 'cancel' ? 'ISC' : 'ISE';
  const s = await scenario(suffix, { required: 100 });
  const y = await secondMaterial(s, suffix, 50);
  const rc = await post('compras', REQUISITIONS, { source: 'SHORTAGE', requirementIds: [s.requirementId, y.requirementId],
    deliveryLocationId: s.siteId, idempotencyKey: intent('rc') });
  expect(rc.status, rc.error).toBe(200);
  const rcA = String(rc.result.requisition_id);
  const lineX = await lineOf(rcA, s.itemId);
  const lineY = await lineOf(rcA, y.itemId);
  const poA = await order(await quoted([lineX], { [lineX]: 60 }));
  const poB = await order(await quoted([lineY]), 'APPROVED');
  expect((await requisitionState(rcA)).status).toBe('SOURCING');   // o conector ainda não tem pedido emitido
  const b = await requisition('compras', s.requirementId);
  expect(b.result).toMatchObject({ requisitioned_qty: 40 });
  expect(promised(await coverage(s.requirementId))).toBe(100);

  // as duas escritas presas na trava da RC-A, soltas na ordem PEDIDA
  const cancel = () => cancelOrder(poA.poId);
  const issue = () => poAct('compras', poB.poId, { action: 'issue' });
  const race = await forcedOrder(LOCK_REQUISITION, [rcA], first === 'cancel' ? [cancel, issue] : [issue, cancel]);
  const [can, iss] = first === 'cancel' ? race : [race[1], race[0]];
  expect([can, iss].map((r) => [r.status, r.error])).toEqual([[200, ''], [200, '']]);   // sem impasse, sem recusa
  // a ordem que rodou: na frente, o cancelamento acha a RC-A em cotação; atrás da emissão, já pedida
  expect(can.result.requisitions).toMatchObject([{ requisition_id: rcA, status_from: first === 'cancel' ? 'SOURCING' : 'ORDERED',
    status_to: 'SOURCING' }]);
  expect(can.result.requirements).toMatchObject([{ requirement_id: s.requirementId, reopened_qty: 60, released_qty: 0 }]);
  expect(iss.result).toMatchObject({ status: 'ISSUED', replayed: false, released: [] });   // o conector foi pedido inteiro
  const x = await coverage(s.requirementId);
  expect(x).toMatchObject({ ordered: 0, requested: 100, purchasable: 0 });
  expect(promised(x)).toBe(100);
  expect(await claimed(s.requirementId)).toBe(100);
  const z = await coverage(y.requirementId);
  expect(z).toMatchObject({ ordered: 50, requested: 0, purchasable: 0 });
  expect(promised(z)).toBe(50);
  // a linha do cabo reabriu sem pedido: a RC-A NÃO fica "pedida" (o conector está no pedido B, emitido)
  expect((await requisitionState(rcA)).status).toBe('SOURCING');
  expect((await requisition('compras', s.requirementId)).status).toBe(422);

  // cancelar depois o pedido B reabre só o conector — o cabo continua no requerido, não volta a 160
  const later = await cancelOrder(poB.poId);
  expect(later.status, later.error).toBe(200);
  expect(later.result.requirements).toMatchObject([{ requirement_id: y.requirementId, reopened_qty: 50, released_qty: 0 }]);
  expect((await requisitionState(rcA)).status).toBe('SUBMITTED');
  const x2 = await coverage(s.requirementId);
  expect(x2).toMatchObject({ ordered: 0, requested: 100 });
  expect(await claimed(s.requirementId)).toBe(100);
  expect(await coverage(y.requirementId)).toMatchObject({ ordered: 0, requested: 50 });
  expect(await claimed(y.requirementId)).toBe(50);
});
}

test('17 · proposta velha de solicitação cancelada não vira pedido — nem sozinha, nem misturada, nem na corrida', async () => {
  await warm(PROCUREMENT_ROUTES);
  // (a) a cotação só da solicitação cancelada é cancelada junto; decidir a proposta velha é recusado
  const s = await scenario('STL', { required: 100 });
  const rc = await requisition('compras', s.requirementId, { deliveryLocationId: s.siteId });
  expect(rc.status, rc.error).toBe(200);
  const rcA = String(rc.result.requisition_id);
  const lineA = await lineOf(rcA, s.itemId);
  const stale = await quoted([lineA]);
  const cancelled = await cancelRequisition(rcA);
  expect(cancelled.status, cancelled.error).toBe(200);
  const rfq = await rfqState(stale.rfqId);
  expect(rfq.status).toBe('CANCELLED');
  expect(rfq.reason).toContain(`Solicitação ${rc.result.requisition_number} cancelada`);
  const refused = await decide(stale);
  expect(refused.status).toBe(422);
  expect(refused.error).toBeTruthy();
  const late = await post('compras', `${RFQS}/${stale.rfqId}`, { action: 'quote', supplierId: qaLive().suppliers.a, validityDate: '2099-01-01',
    lines: [{ rfqLineId: (await one<{ id: string }>(db, `SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [stale.rfqId])).id, unitPrice: 20 }] });
  expect(late.status).toBe(422);   // nem proposta nova numa cotação morta
  expect(await liveOrderLines(lineA)).toBe(0);
  expect(await coverage(s.requirementId)).toMatchObject({ ordered: 0, requested: 0, purchasable: 100 });
  const fresh = await requisition('compras', s.requirementId);
  expect(fresh.result).toMatchObject({ requisitioned_qty: 100 });
  expect(promised(await coverage(s.requirementId))).toBe(100);

  // (b) cotação mista: a linha da solicitação cancelada fica FORA do pedido; a da viva vira pedido
  const m = await scenario('STM', { required: 100 });
  const m2 = await secondMaterial(m, 'STM', 50);
  const dead = await requisition('compras', m.requirementId, { deliveryLocationId: m.siteId });
  const alive = await requisition('compras', m2.requirementId, { deliveryLocationId: m.siteId });
  expect([dead.status, alive.status]).toEqual([200, 200]);
  const deadLine = await lineOf(String(dead.result.requisition_id), m.itemId);
  const aliveLine = await lineOf(String(alive.result.requisition_id), m2.itemId);
  const mixed = await quoted([deadLine, aliveLine]);
  expect((await cancelRequisition(String(dead.result.requisition_id))).status).toBe(200);
  expect((await rfqState(mixed.rfqId)).status).toBe('OPEN');   // a outra solicitação segue viva
  const decided = await decide(mixed);
  expect(decided.status, decided.error).toBe(200);
  const lines = (await db.query(`SELECT requisition_line_id AS line, quantity::float8 AS q FROM public.purchase_order_lines
    WHERE purchase_order_id = $1`, [decided.result.purchase_order_id])).rows;
  expect(lines).toEqual([{ line: aliveLine, q: 50 }]);
  expect(await liveOrderLines(deadLine)).toBe(0);
  expect(await coverage(m.requirementId)).toMatchObject({ ordered: 0, requested: 0, purchasable: 100 });
  expect(await coverage(m2.requirementId)).toMatchObject({ requested: 50, purchasable: 0 });

  // (c) decidir ∥ cancelar a solicitação, presos na trava dela: um vence, o outro é recusado — nunca os dois
  const r = await scenario('STR', { required: 100 });
  const rr = await requisition('compras', r.requirementId, { deliveryLocationId: r.siteId });
  expect(rr.status, rr.error).toBe(200);
  const rq = String(rr.result.requisition_id);
  const rl = await lineOf(rq, r.itemId);
  const q = await quoted([rl]);
  const race = await forcedOverlap(LOCK_REQUISITION, [rq], () => [decide(q), cancelRequisition(rq)]);
  expect(race.map((x) => x.status).sort()).toEqual([200, 422]);
  const cancelWon = race[1].status === 200;
  expect((await requisitionState(rq)).status).toBe(cancelWon ? 'CANCELLED' : 'SOURCING');
  expect((await rfqState(q.rfqId)).status).toBe(cancelWon ? 'CANCELLED' : 'DECIDED');
  expect(await liveOrderLines(rl)).toBe(cancelWon ? 0 : 1);
  // a falta segue comprável só se a solicitação morreu — e o prometido nunca passa do requerido
  expect((await requisition('compras', r.requirementId)).status).toBe(cancelWon ? 200 : 422);
  const end = await coverage(r.requirementId);
  expect(end).toMatchObject({ ordered: 0, requested: 100, purchasable: 0 });
  expect(await claimed(r.requirementId)).toBe(100);
});

/*
 * O pedido parcial emitido pela 248 já deixa o aberto igual ao pedido (a 15 passa com ou sem a trava). No LEGADO —
 * emitido antes, sem o não pedido no livro — o aberto é o requisitado inteiro, e o quanto o cancelamento reabre
 * depende do que ele LÊ do reclamado: só a trava dele no requisito (antes de ler) impede que a reabertura dos 100
 * e a RC-B de 40 somem 140. Nas duas ordens, forçadas na fila da trava do requisito; sem a trava o cancelamento
 * nem entra na fila, e a prova falha.
 */
for (const first of ['cancel', 'requisition'] as const) {
test(`18 · concorrência no legado: cancelar o pedido parcial emitido antes da 248 ∥ solicitar o resto, ${first === 'cancel' ? 'o cancelamento' : 'a solicitação'} na frente — a trava do requisito segura o requerido`, async () => {
  await warm(PROCUREMENT_ROUTES);
  const s = await scenario(first === 'cancel' ? 'LGC' : 'LGR', { required: 100 });
  const a = await legacyPartialOrder(s, 60);
  // o legado: 60 EMITIDOS contra a alocação de 100, nada no livro, a RC-A PEDIDA — os 40 são compráveis
  expect(await releases(s.requirementId)).toEqual([]);
  expect(await openOf(a.requisitionId, s.requirementId)).toEqual({ allocated: 100, released: 0, open: 100 });
  expect((await requisitionState(a.requisitionId)).status).toBe('ORDERED');
  expect(await coverage(s.requirementId)).toMatchObject({ ordered: 60, requested: 0, purchasable: 40 });
  expect(await claimed(s.requirementId)).toBe(60);

  const cancel = () => cancelOrder(a.poId);
  const buy = () => requisition('compras', s.requirementId);
  const race = await forcedOrder(LOCK_REQUIREMENT, [s.requirementId], first === 'cancel' ? [cancel, buy] : [buy, cancel]);
  const [can, rcB] = first === 'cancel' ? race : [race[1], race[0]];
  expect(can.status, can.error).toBe(200);
  expect(can.result.requisitions).toMatchObject([{ requisition_id: a.requisitionId, requisition_number: a.requisitionNumber,
    status_from: 'ORDERED', status_to: 'SUBMITTED' }]);
  if (first === 'cancel') {
    // na frente, nada mais cobre o requisito: reabre os 100 — e a solicitação atrás não tem o que comprar
    expect(can.result.requirements).toMatchObject([{ requirement_id: s.requirementId, reopened_qty: 100, released_qty: 0, cause: null }]);
    expect(rcB.status).toBe(422);
    expect(await releases(s.requirementId)).toEqual([]);
    expect(await openOf(a.requisitionId, s.requirementId)).toEqual({ allocated: 100, released: 0, open: 100 });
  } else {
    // a solicitação na frente leva os 40; o cancelamento reabre 60 e LIBERA 40 — cobertos pela RC-B
    expect(rcB.status, rcB.error).toBe(200);
    expect(rcB.result).toMatchObject({ requisitioned_qty: 40 });
    expect(can.result.requirements).toMatchObject([{ requirement_id: s.requirementId, reopened_qty: 60, released_qty: 40, cause: 'COVERED' }]);
    const ledger = await releases(s.requirementId);
    expect(ledger).toMatchObject([{ stage: 'PO_CANCELLED', cause: 'COVERED', q: 40, po: a.poId, rq: a.requisitionId }]);
    expect(ledger[0].reason).toContain(a.orderNumber);
    expect(await openOf(a.requisitionId, s.requirementId)).toEqual({ allocated: 100, released: 40, open: 60 });
  }
  // qualquer ordem: exatamente o requerido
  const end = await coverage(s.requirementId);
  expect(end).toMatchObject({ ordered: 0, requested: 100, purchasable: 0 });
  expect(promised(end)).toBe(100);
  expect(await claimed(s.requirementId)).toBe(100);
  expect((await requisitionState(a.requisitionId)).status).toBe('SUBMITTED');
});
}

test('19 · a linha que a proposta vencedora não cotou volta a ser cotável — na tela de Compras e pela rota', async ({ browser }) => {
  // uma RC com cabo (100 m) e conector (50 un) numa cotação só; a proposta (única, vencedora) preça só o cabo
  const s = await scenario('F3', { required: 100 });
  const y = await secondMaterial(s, 'F3', 50);
  const rc = await post('compras', REQUISITIONS, { source: 'SHORTAGE', requirementIds: [s.requirementId, y.requirementId],
    deliveryLocationId: s.siteId, idempotencyKey: intent('rc') });
  expect(rc.status, rc.error).toBe(200);
  const rcId = String(rc.result.requisition_id);
  const rcNumber = String(rc.result.requisition_number);
  const lineX = await lineOf(rcId, s.itemId);
  const lineY = await lineOf(rcId, y.itemId);
  const q = await quoted([lineX, lineY], {}, [lineX]);
  const po = await order(q);
  // o pedido leva só o cabo; a cotação fica DECIDIDA e o conector segue aberto, requisitado e sem pedido
  expect((await db.query(`SELECT requisition_line_id AS line, quantity::float8 AS q FROM public.purchase_order_lines
    WHERE purchase_order_id = $1`, [po.poId])).rows).toEqual([{ line: lineX, q: 100 }]);
  expect((await rfqState(q.rfqId)).status).toBe('DECIDED');
  expect((await requisitionState(rcId)).status).toBe('SOURCING');
  expect(await liveOrderLines(lineY)).toBe(0);
  expect(await openOf(rcId, y.requirementId)).toEqual({ allocated: 50, released: 0, open: 50 });
  expect(await coverage(y.requirementId)).toMatchObject({ ordered: 0, requested: 50, purchasable: 0 });

  // a tela de Compras: o conector está SEM COTAÇÃO e se marca para cotar; o cabo, no pedido, não
  const page = await as(browser, 'compras');
  await page.goto(`/supply/compras?stage=solicitacoes&rq=${rcId}`);
  const card = page.getByRole('article', { name: `Requisição ${rcNumber}` });
  await expect(card).toBeVisible({ timeout: 60_000 });
  const rowX = card.getByTestId('requisition-row').filter({ hasText: s.itemCode });
  const rowY = card.getByTestId('requisition-row').filter({ hasText: y.code });
  await expect(rowY.getByTestId('requisition-open-qty')).toHaveText('50 un');
  await expect(rowY).toContainText('sem cotação');
  const pick = rowY.getByRole('checkbox', { name: `Cotar ${y.code} de ${rcNumber}` });
  await expect(pick).toBeVisible();
  await expect(rowX.getByRole('checkbox')).toHaveCount(0);
  await expect(rowX).not.toContainText('sem cotação');
  // marcada, abre a cotação com o aberto do conector
  await pick.check();
  await page.getByRole('button', { name: 'Abrir cotação (1)' }).filter({ visible: true }).first().click();
  const quoting = tid(page, 'rfq-form').getByRole('list', { name: 'Linhas cotadas' });
  await expect(quoting).toContainText(y.code);
  await expect(quoting).toContainText('50 un');
  await shot(page, '18-compras-linha-sem-cotacao');
  await tid(page, 'rfq-form').getByRole('button', { name: 'Voltar' }).click();

  // e se cota de novo pela rota: só o conector, pelo aberto — nada a mais reivindicado
  const again = await post('compras', RFQS, { requisitionLineIds: [lineY], supplierIds: [qaLive().suppliers.a] });
  expect(again.status, again.error).toBe(200);
  expect((await db.query(`SELECT requisition_line_id AS line, quantity::float8 AS q FROM public.procurement_rfq_lines WHERE rfq_id = $1`,
    [again.result.rfq_id])).rows).toEqual([{ line: lineY, q: 50 }]);
  expect((await requisitionState(rcId)).status).toBe('SOURCING');
  expect(await coverage(y.requirementId)).toMatchObject({ ordered: 0, requested: 50, purchasable: 0 });
  expect(await claimed(y.requirementId)).toBe(50);
  expect(await claimed(s.requirementId)).toBe(100);

  // com a cotação nova ABERTA, o conector volta a "em cotação" — sem a caixa
  await page.reload();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(rowY).toContainText('em cotação');
  await expect(rowY.getByRole('checkbox')).toHaveCount(0);
});
});

// ── 250: proposta, decisão e pedido nunca acima do aberto ──────────────────────
/** Cotação (compras) das linhas com os fornecedores; devolve o id e a linha da cotação de cada linha de solicitação. */
async function rfqWith(lineIds: string[], supplierIds: string[]) {
  const rfq = await post('compras', RFQS, { requisitionLineIds: lineIds, supplierIds });
  expect(rfq.status, rfq.error).toBe(200);
  const rfqId = String(rfq.result.rfq_id);
  const rows = (await db.query(`SELECT id, requisition_line_id AS line FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfqId])).rows;
  return { rfqId, lineOf: Object.fromEntries(rows.map((r) => [String(r.line), String(r.id)])) as Record<string, string> };
}
/** Proposta pela rota (compras): `lines` = linha de solicitação → quantidade cotada. */
const quoteAs = (rfq: { rfqId: string; lineOf: Record<string, string> }, supplierId: string, lines: Record<string, number>, price = 25) =>
  post('compras', `${RFQS}/${rfq.rfqId}`, { action: 'quote', supplierId, validityDate: '2099-01-01', leadTimeDays: 10, paymentTerms: '28 dias',
    lines: Object.entries(lines).map(([line, quantity]) => ({ rfqLineId: rfq.lineOf[line], unitPrice: price, quantity })) });
const decideQuote = (rfqId: string, quoteId: string | undefined) => post('compras', `${RFQS}/${rfqId}`,
  { action: 'decide', quoteId, rationale: 'Decisão da regressão 250 (quantidade dentro do aberto).' });
const quotesOf = async (rfqId: string) => (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM public.supplier_quotes WHERE rfq_id = $1`, [rfqId])).n;
/** As linhas de um pedido: quantidade pedida e quanto dela tem requisito. */
const orderLines = async (poId: string) => (await db.query(`SELECT pl.item_id AS item, pl.quantity::float8 AS q,
    COALESCE((SELECT sum(a.quantity) FROM public.purchase_order_line_requirements a WHERE a.line_id = pl.id), 0)::float8 AS traced
  FROM public.purchase_order_lines pl WHERE pl.purchase_order_id = $1 ORDER BY pl.item_id`, [poId])).rows as Array<{ item: string; q: number; traced: number }>;
/**
 * O INVARIANTE da 250 sobre um requisito: somando os pedidos não cancelados, nunca mais pedido do que o requerido;
 * e em todo pedido vivo que toca o requisito, cada linha com requisito tem toda unidade rastreada.
 */
async function neverAbove(requirementId: string) {
  const r = await one<{ required: number; ordered: number; untraced: number }>(db, `SELECT pr.quantity::float8 AS required,
      COALESCE((SELECT sum(a.quantity) FROM public.purchase_order_line_requirements a
                  JOIN public.purchase_order_lines pl ON pl.id = a.line_id JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
                 WHERE a.requirement_id = pr.id AND po.status <> 'CANCELLED'), 0)::float8 AS ordered,
      (SELECT count(*)::int FROM public.purchase_order_lines pl JOIN public.purchase_orders po ON po.id = pl.purchase_order_id
        WHERE po.status <> 'CANCELLED' AND EXISTS (SELECT 1 FROM public.purchase_order_line_requirements a WHERE a.line_id = pl.id AND a.requirement_id = pr.id)
          AND pl.quantity > (SELECT sum(a.quantity) FROM public.purchase_order_line_requirements a WHERE a.line_id = pl.id)) AS untraced
    FROM public.project_requirements pr WHERE pr.id = $1`, [requirementId]);
  expect(r.ordered, 'pedido acima do requerido').toBeLessThanOrEqual(r.required);
  expect(r.untraced, 'unidade pedida sem requisito').toBe(0);
  return r;
}

/**
 * REGRESSÕES DA REGRA 250 — cotado ≤ cotável, decidido ≤ aberto de agora, pedido ≤ o que a requisição cobre;
 * acima disso a rota recusa (422, em português) e nada é aparado. Cada uma no seu projeto descartável.
 */
test.describe('proposta, decisão e pedido nunca acima do aberto — 250', () => {

test('20 · proposta exata passa; acima do aberto é recusada em português e nada fica gravado; sem aparar', async () => {
  const s = await scenario('QEX', { required: 100 });
  const rc = await requisition('compras', s.requirementId, { deliveryLocationId: s.siteId });
  expect(rc.status, rc.error).toBe(200);
  const line = await lineOf(String(rc.result.requisition_id), s.itemId);
  const rfq = await rfqWith([line], [qaLive().suppliers.a]);
  const above = await quoteAs(rfq, qaLive().suppliers.a, { [line]: 101 });
  expect(above.status).toBe(422);
  expect(above.error).toBe(`Proposta acima do cotável: 101 cotados, mas a requisição ${rc.result.requisition_number} só tem 100 em aberto nesta linha. `
    + 'Registre a proposta com a quantidade que cabe.');
  expect(await quotesOf(rfq.rfqId)).toBe(0);
  const exact = await quoteAs(rfq, qaLive().suppliers.a, { [line]: 100 });
  expect(exact.status, exact.error).toBe(200);
  const d = await decideQuote(rfq.rfqId, exact.result.quote_id);
  expect(d.status, d.error).toBe(200);
  expect(await orderLines(String(d.result.purchase_order_id))).toEqual([{ item: s.itemId, q: 100, traced: 100 }]);
  await neverAbove(s.requirementId);
});

test('21 · proposta parcial vira pedido parcial; a segunda decisão, do resto, também nunca passa do aberto — 60 + 40 = 100', async () => {
  const s = await scenario('QPA', { required: 100 });
  const first = await partialOrder(s, 60);
  expect(await orderLines(first.poId)).toEqual([{ item: s.itemId, q: 60, traced: 60 }]);
  const rcb = await requisition('compras', s.requirementId, { deliveryLocationId: s.siteId });
  expect(rcb.status, rcb.error).toBe(200);
  expect(Number(rcb.result.requisitioned_qty)).toBe(40);
  const line = await lineOf(String(rcb.result.requisition_id), s.itemId);
  const rfq = await rfqWith([line], [qaLive().suppliers.a]);
  const over = await quoteAs(rfq, qaLive().suppliers.a, { [line]: 41 });
  expect(over.status).toBe(422);
  expect(over.error).toMatch(/^Proposta acima do cotável: 41 cotados, mas a requisição RC-\S+ só tem 40 em aberto/);
  const ok = await quoteAs(rfq, qaLive().suppliers.a, { [line]: 40 });
  expect(ok.status, ok.error).toBe(200);
  const d = await decideQuote(rfq.rfqId, ok.result.quote_id);
  expect(d.status, d.error).toBe(200);
  expect(await orderLines(String(d.result.purchase_order_id))).toEqual([{ item: s.itemId, q: 40, traced: 40 }]);
  expect((await neverAbove(s.requirementId)).ordered).toBe(100);
});

test('22 · proposta envelhecida: o aberto caiu depois dela — a decisão recusa (cota-se de novo), nada vira pedido; a nova proposta passa', async () => {
  const s = await scenario('QEN', { required: 100 });
  const rc = await requisition('compras', s.requirementId, { deliveryLocationId: s.siteId });
  const line = await lineOf(String(rc.result.requisition_id), s.itemId);
  const rfq = await rfqWith([line], [qaLive().suppliers.a]);
  const q = await quoteAs(rfq, qaLive().suppliers.a, { [line]: 100 });
  expect(q.status, q.error).toBe(200);
  // o aberto da linha cai para 70 DEPOIS da proposta (mudança de fora do caminho governado)
  await db.query(`UPDATE public.purchase_requisition_line_requirements SET quantity = 70 WHERE line_id = $1`, [line]);
  await db.query(`UPDATE public.purchase_requisition_lines SET quantity = 70 WHERE id = $1`, [line]);
  const stale = await decideQuote(rfq.rfqId, q.result.quote_id);
  expect(stale.status).toBe(422);
  expect(stale.error).toBe(`A proposta ficou acima do aberto: 100 cotados, mas a requisição ${rc.result.requisition_number} tem 70 em aberto agora. `
    + 'Registre uma nova proposta com a quantidade que cabe.');
  expect((await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM public.sourcing_decisions WHERE rfq_id = $1`, [rfq.rfqId])).n).toBe(0);
  const again = await quoteAs(rfq, qaLive().suppliers.a, { [line]: 70 });
  expect(again.status, again.error).toBe(200);
  const d = await decideQuote(rfq.rfqId, again.result.quote_id);
  expect(d.status, d.error).toBe(200);
  expect(await orderLines(String(d.result.purchase_order_id))).toEqual([{ item: s.itemId, q: 70, traced: 70 }]);
  await neverAbove(s.requirementId);
});

test('23 · cotação de várias linhas e dois fornecedores: uma linha acima derruba a proposta inteira; parcial numa, exata na outra; a outra proposta não decide de novo', async () => {
  const s = await scenario('QML', { required: 100 });
  const y = await secondMaterial(s, 'QML', 50);
  const rc = await post('compras', REQUISITIONS, { source: 'SHORTAGE', requirementIds: [s.requirementId, y.requirementId],
    idempotencyKey: intent('rc'), deliveryLocationId: s.siteId });
  expect(rc.status, rc.error).toBe(200);
  const rq = String(rc.result.requisition_id);
  const [lx, ly] = [await lineOf(rq, s.itemId), await lineOf(rq, y.itemId)];
  const { a, b } = qaLive().suppliers;
  const rfq = await rfqWith([lx, ly], [a, b]);
  const over = await quoteAs(rfq, a, { [lx]: 100, [ly]: 51 });
  expect(over.status).toBe(422);
  expect(over.error).toMatch(/^Proposta acima do cotável: 51 cotados, mas a requisição RC-\S+ só tem 50 em aberto/);
  expect(await quotesOf(rfq.rfqId)).toBe(0);
  const qa = await quoteAs(rfq, a, { [lx]: 60, [ly]: 50 });
  const qb = await quoteAs(rfq, b, { [lx]: 100, [ly]: 50 }, 27);
  expect([qa.status, qb.status]).toEqual([200, 200]);
  const d = await decideQuote(rfq.rfqId, qa.result.quote_id);
  expect(d.status, d.error).toBe(200);
  const po = String(d.result.purchase_order_id);
  expect(await orderLines(po)).toEqual([{ item: s.itemId, q: 60, traced: 60 }, { item: y.itemId, q: 50, traced: 50 }]
    .sort((m, n) => m.item.localeCompare(n.item)));
  const other = await decideQuote(rfq.rfqId, qb.result.quote_id);
  expect(other.status).toBe(422);
  expect(other.error).toBe('Esta cotação já foi decidida com outra proposta — o pedido é o daquela decisão.');
  const replay = await decideQuote(rfq.rfqId, qa.result.quote_id);
  expect(replay.status, replay.error).toBe(200);
  expect(replay.result).toMatchObject({ replayed: true, purchase_order_id: po });
  await neverAbove(s.requirementId);
  await neverAbove(y.requirementId);
});

for (const first of ['A', 'B'] as const) {
test(`24 · decisões concorrentes na mesma cotação, com propostas diferentes (${first} na frente): um pedido só, a outra recusada — nunca acima do aberto`, async () => {
  const s = await scenario(`QCC${first}`, { required: 100 });
  const rc = await requisition('compras', s.requirementId, { deliveryLocationId: s.siteId });
  const rq = String(rc.result.requisition_id);
  const line = await lineOf(rq, s.itemId);
  const { a, b } = qaLive().suppliers;
  const rfq = await rfqWith([line], [a, b]);
  const qa = await quoteAs(rfq, a, { [line]: 100 });
  const qb = await quoteAs(rfq, b, { [line]: 80 }, 24);
  expect([qa.status, qb.status]).toEqual([200, 200]);
  await warm([RFQS, `${RFQS}/${NIL}`]);
  const byA = () => decideQuote(rfq.rfqId, qa.result.quote_id);
  const byB = () => decideQuote(rfq.rfqId, qb.result.quote_id);
  // a decisão trava requisitos → requisições → cotação: com a requisição presa, as duas esperam na fila, na ordem forçada
  const [won, lost] = await forcedOrder(LOCK_REQUISITION, [rq], first === 'A' ? [byA, byB] : [byB, byA]);
  expect(won.status, won.error).toBe(200);
  expect(lost.status).toBe(422);
  expect(lost.error).toBe('Esta cotação já foi decidida com outra proposta — o pedido é o daquela decisão.');
  const orders = (await db.query(`SELECT po.id FROM public.purchase_orders po JOIN public.sourcing_decisions sd ON sd.id = po.sourcing_decision_id
    WHERE sd.rfq_id = $1`, [rfq.rfqId])).rows;
  expect(orders.map((o) => String(o.id))).toEqual([String(won.result.purchase_order_id)]);
  expect(await orderLines(String(won.result.purchase_order_id))).toEqual([{ item: s.itemId, q: first === 'A' ? 100 : 80, traced: first === 'A' ? 100 : 80 }]);
  await neverAbove(s.requirementId);
});
}
});
