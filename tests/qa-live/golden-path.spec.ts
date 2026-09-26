/**
 * CAMINHO DE OURO, NO NAVEGADOR, COM ESCRITA REAL (QA isolado).
 *
 * Do pacote PT + PC aceito ao material entregue na obra, pelas telas, com as
 * sessões REAIS de cada papel — nenhuma escrita interceptada:
 *
 *   gestor       gera a OS do pacote aceito → revisa → emite → cria o projeto →
 *                planeja a atividade → registra e confirma a necessidade de
 *                material → reserva o que há no estoque → requisita o resto
 *   compras      abre a cotação com dois fornecedores → registra as duas
 *                propostas → decide → ajusta a entrega → submete
 *   financeiro   aprova por alçada declarada (quem criou não aprova)
 *   compras      emite ao fornecedor
 *   almoxarifado recebe PARCIAL para inspeção → inspeciona e libera → entrega
 *                à obra (consumo do projeto)
 *
 * Depois de cada transição crítica, o estado PERSISTIDO é conferido no banco
 * (OS, projeto, atividade, requisito, cobertura derivada, reserva, requisição,
 * cotação, decisão, pedido, recebimento, livro-razão). O ponto de partida — o
 * aceite do cliente — nasce pelas funções governadas do Comercial (domínio já
 * provado): é dele que a OS nasce, e a prova começa aí.
 *
 *   npx playwright test -c playwright.qa.config.ts --project=desktop tests/qa-live/golden-path.spec.ts
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type pg from 'pg';
import { acceptedPackage, baseFacts } from '../../scripts/qa/lib/commercial.mjs';
import { authFile, governed, one, qaDb, qaLive, tag, type QaRole } from './support';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const T = tag();
const CODE = `GP-CABO-${T}`;
const CUSTOMER = `Cliente Ouro ${T}`;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plus = (n: number) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let db: pg.Client;
const S: {
  acceptanceId: string; engagementId: string; item: string; central: string; centralName: string; supplierA: string; supplierB: string;
  osId?: string; osNumber?: string; projectId?: string; activityId?: string; requirementId?: string; requisitionId?: string; requisitionNumber?: string;
  rfqId?: string; rfqNumber?: string; poId?: string; poNumber?: string; receiptId?: string;
} = {} as never;
const sessions = new Map<QaRole, { ctx: BrowserContext; page: Page }>();

/** A sessão real de um papel (cookies do login pela tela, gravados no global-setup). */
async function as(browser: Browser, role: QaRole): Promise<Page> {
  const open = sessions.get(role);
  if (open) return open.page;
  const ctx = await browser.newContext({ storageState: authFile(role), viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  // Contra `next dev` (:9103), o selo de desenvolvimento do Next fica no canto inferior direito — em cima do
  // "Salvar" das gavetas. Some só o selo; erro de runtime continua acusado pelo `pageerror` abaixo.
  await ctx.addInitScript(() => {
    const hide = () => document.head?.insertAdjacentHTML('beforeend', '<style>nextjs-portal{display:none!important}</style>');
    if (document.head) hide(); else document.addEventListener('DOMContentLoaded', hide, { once: true });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45_000);
  // Nenhuma rota é interceptada: só observamos, para acusar erro de runtime.
  page.on('pageerror', (e) => { throw new Error(`[${role}] erro de runtime: ${e.message}`); });
  sessions.set(role, { ctx, page });
  return page;
}

const coverage = () => one<{ required: number; reserved: number; consumed: number; transit: number; on_order: number; requested: number;
  inspection: number; shortage: number }>(db,
  `SELECT required_qty::float required, reserved_qty::float reserved, consumed_qty::float consumed, in_transit_qty::float transit,
          on_order_qty::float on_order, requested_qty::float requested, coalesce(inspection_qty, 0)::float inspection, shortage_qty::float shortage
     FROM public.supply_requirement_coverage WHERE requirement_id = $1`, [S.requirementId]);

test.beforeAll(async () => {
  db = await qaDb();
  const live = qaLive();
  const g = await governed(db);
  // O aceite do cliente: pacote PT + PC lido, aprovado, enviado e aceito; trabalho autorizado pela proposta aceita.
  const pkg = await acceptedPackage((sql: string, params: unknown[]) => one(db, sql, params), { org: g.org, owner: g.actor }, {
    code: `GP-${T}`, title: `SE Ouro ${T} — dois bays de 138 kV`, customer: CUSTOMER, value: 1_280_000,
    facts: baseFacts('Montagem eletromecânica de dois bays de 138 kV', 'Relatório de comissionamento dos bays',
      'Cliente libera o pátio energizado', { label: 'Cabo de potência 35 mm²', qty: 100, unit: 'm' }),
  });
  S.acceptanceId = pkg.acceptanceId; S.engagementId = pkg.engagementId;
  // Catálogo, saldo livre e fornecedores homologados: o mundo em que a obra acontece.
  S.item = await g.item(CODE, 'm', 'Cabos');
  S.central = live.locations.central;
  S.centralName = (await one<{ name: string }>(db, `SELECT name FROM public.inventory_locations WHERE id = $1`, [S.central])).name;
  await g.stock(S.item, S.central, 40);
  const supplier = async (name: string) => {
    const id = (await g.act<{ supplier_id: string }>('supplier_register', g.org, g.actor, g.J({ legal_name: name, categories: ['Cabos'] }))).supplier_id;
    await g.act('supplier_set_status', g.org, g.actor, id, 'HOMOLOGATED', null);
    return id;
  };
  S.supplierA = await supplier(`Cabos Ouro ${T}`);
  S.supplierB = await supplier(`Fios Ouro ${T}`);
});

test.afterAll(async () => {
  for (const { ctx } of sessions.values()) await ctx.close().catch(() => undefined);
  await db?.end();
});

test('1 · gestor: a OS nasce do pacote aceito, é revisada e emitida', async ({ browser }) => {
  const page = await as(browser, 'gestor');
  await page.goto('/operacoes/ordens-servico');
  await page.getByRole('button', { name: /Gerar a partir de proposta/ }).first().click();
  const panel = page.getByTestId('generate-os-modal');
  await panel.getByRole('radiogroup', { name: 'Pacotes aceitos' }).getByRole('radio').filter({ hasText: CUSTOMER }).click();
  await panel.getByLabel('Local da obra').fill(`SE Ouro ${T}`);
  await panel.getByLabel('Início planejado').fill(plus(10));
  await panel.getByLabel('Término planejado').fill(plus(90));
  await panel.getByRole('button', { name: 'Gerar OS' }).click();
  await page.waitForURL(/\/operacoes\/ordens-servico\/[0-9a-f-]{36}/, { timeout: 90_000 });

  const os = await one<{ id: string; os_number: string; status: string; authorized_value: string; origin: string }>(db,
    `SELECT id, os_number, status, authorized_value, origin FROM public.internal_service_orders WHERE source_context_acceptance_id = $1`, [S.acceptanceId]);
  S.osId = os.id; S.osNumber = os.os_number;
  expect(page.url()).toContain(os.id);
  expect(os).toMatchObject({ origin: 'from_accepted_proposal' });
  expect(Number(os.authorized_value)).toBe(1_280_000); // o valor é o do pacote — não se redigita
  const items = await one<{ n: number; pending: number }>(db, `SELECT count(*)::int n,
    count(*) FILTER (WHERE confirmation_state = 'UNCONFIRMED')::int pending FROM public.internal_service_order_items WHERE service_order_id = $1`, [os.id]);
  expect(items.n).toBeGreaterThan(0);

  const ws = page.getByTestId('os-workspace');
  await expect(ws).toBeVisible();
  // A comparação OS × PT × PC mostra o conteúdo alinhado ao pacote, sem conflito.
  await ws.getByRole('tab', { name: /Comparação OS × PT × PC/ }).click();
  await expect(ws.getByTestId('comparison-row').filter({ hasText: 'Conflito' })).toHaveCount(0);
  await ws.getByRole('tab', { name: /^Resumo/ }).click();
  if (items.pending > 0) {
    await ws.getByRole('button', { name: /Confirmar \d+ pendente/ }).click();
    await expect.poll(async () => (await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.internal_service_order_items
      WHERE service_order_id = $1 AND confirmation_state = 'UNCONFIRMED'`, [os.id])).n).toBe(0);
  }
  await ws.getByRole('button', { name: 'Emitir OS' }).first().click();
  await expect.poll(async () => (await one<{ status: string }>(db, `SELECT status FROM public.internal_service_orders WHERE id = $1`, [os.id])).status,
    { timeout: 30_000 }).toBe('ISSUED');
  const issued = await one<{ issued_by: string; revisions: number }>(db, `SELECT o.issued_by,
    (SELECT count(*)::int FROM public.internal_service_order_revisions r WHERE r.service_order_id = o.id) revisions
    FROM public.internal_service_orders o WHERE o.id = $1`, [os.id]);
  expect(issued.issued_by).toBe(qaLive().users.gestor.id);
  expect(issued.revisions).toBeGreaterThanOrEqual(1);
});

test('2 · gestor: o projeto nasce da OS emitida, e a atividade entra no cronograma canônico', async ({ browser }) => {
  const page = await as(browser, 'gestor');
  await page.goto(`/operacoes/ordens-servico/${S.osId}`);
  await page.getByTestId('os-workspace').getByRole('button', { name: 'Criar ou vincular projeto' }).first().click();
  await page.getByLabel('Nome do projeto').fill(`Obra Ouro ${T}`);
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await expect.poll(async () => (await one<{ project_id: string | null }>(db,
    `SELECT project_id FROM public.internal_service_orders WHERE id = $1`, [S.osId])).project_id, { timeout: 30_000 }).not.toBeNull();
  S.projectId = (await one<{ project_id: string }>(db, `SELECT project_id FROM public.internal_service_orders WHERE id = $1`, [S.osId])).project_id;
  const project = await one<{ nome: string }>(db, `SELECT project->>'nome' nome FROM public.projects WHERE id = $1`, [S.projectId]);
  expect(project.nome).toBe(`Obra Ouro ${T}`);

  await page.goto(`/projetos/${encodeURIComponent(S.projectId!)}?tab=timeline`);
  await page.getByRole('button', { name: 'Nova atividade' }).first().click();
  await page.getByLabel('Nome da atividade').fill(`Lançamento de cabos ${T}`);
  await page.getByLabel('Início planejado').fill(plus(20));
  await page.getByLabel('Término planejado').fill(plus(35));
  await page.getByRole('button', { name: 'Criar atividade' }).click();
  await expect.poll(async () => (await db.query(`SELECT id FROM public.project_timeline_items WHERE project_id = $1 AND title = $2`,
    [S.projectId, `Lançamento de cabos ${T}`])).rowCount, { timeout: 30_000 }).toBe(1);
  const act = await one<{ id: string; planned_start: string }>(db, `SELECT id, planned_start::text FROM public.project_timeline_items
    WHERE project_id = $1 AND title = $2`, [S.projectId, `Lançamento de cabos ${T}`]);
  S.activityId = act.id;
  expect(act.planned_start).toBe(plus(20));
});

test('3 · gestor: a necessidade de material pende da atividade, é confirmada — e a falta aparece derivada', async ({ browser }) => {
  const page = await as(browser, 'gestor');
  await page.goto(`/projetos/${encodeURIComponent(S.projectId!)}?tab=timeline`);
  const panel = page.getByTestId('project-requirements');
  await panel.getByRole('button', { name: /Novo requisito/ }).click();
  const form = page.getByTestId('requirement-form');
  await form.getByLabel('Item do catálogo').selectOption({ label: `${CODE} · Item ${CODE} (m)` });
  await form.getByLabel('Atividade').selectOption({ value: S.activityId! });
  await form.getByLabel('Quantidade').fill('100');
  await form.getByLabel('Necessário em').fill(plus(18));
  // A data que vale é mostrada antes de salvar: a menor entre a declarada e o início da frente.
  await expect(form.getByRole('status')).toContainText('A data que vale');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await expect.poll(async () => (await db.query(`SELECT id FROM public.project_requirements WHERE project_id = $1 AND item_id = $2`,
    [S.projectId, S.item])).rowCount, { timeout: 30_000 }).toBe(1);
  const req = await one<{ id: string; status: string; activity_id: string; quantity: number; unit: string; required_by: string }>(db,
    `SELECT id, status, activity_id, quantity::float quantity, unit, required_by::text FROM public.project_requirements WHERE project_id = $1 AND item_id = $2`,
    [S.projectId, S.item]);
  S.requirementId = req.id;
  expect(req).toMatchObject({ status: 'PLANNED', activity_id: S.activityId, quantity: 100, unit: 'm', required_by: plus(18) });

  await panel.getByTestId('requirement-row').filter({ hasText: 'Item' }).first().getByRole('button', { name: 'Confirmar' }).click();
  await expect.poll(async () => (await one<{ status: string }>(db, `SELECT status FROM public.project_requirements WHERE id = $1`, [S.requirementId])).status,
    { timeout: 30_000 }).toBe('CONFIRMED');
  // Cobertura DERIVADA: nada reservado, nada comprado — falta tudo, mesmo com 40 livres no almoxarifado.
  expect(await coverage()).toMatchObject({ required: 100, reserved: 0, on_order: 0, shortage: 100 });
});

test('4 · gestor: reserva o que há no estoque e requisita a compra do resto — pelo Planejamento de Materiais', async ({ browser }) => {
  const page = await as(browser, 'gestor');
  await page.goto(`/supply/planejamento-materiais?req=${S.requirementId}`);
  const drawer = page.getByTestId('demand-drawer');
  const reserve = drawer.locator('[data-testid="strategy-option"][data-strategy="reserve"], [data-testid="strategy-option"][data-strategy="transfer"]').first();
  await expect(reserve).toBeVisible({ timeout: 60_000 });
  await reserve.getByLabel(/Quantidade/).fill('40');
  await expect(reserve.getByText(/Falta 100 m → /)).toBeVisible();
  await reserve.getByRole('button', { name: /^Reservar/ }).click();
  await expect.poll(async () => (await coverage()).reserved, { timeout: 30_000 }).toBe(40);
  const res = await one<{ n: number; q: number; location_id: string }>(db, `SELECT count(*)::int n, sum(quantity)::float q, min(location_id::text) location_id
    FROM public.inventory_reservations WHERE requirement_id = $1 AND status = 'ACTIVE'`, [S.requirementId]);
  expect(res).toEqual({ n: 1, q: 40, location_id: S.central });
  expect(await coverage()).toMatchObject({ reserved: 40, shortage: 60 });

  // O resto vira requisição de compra — com o requisito de origem.
  await expect(drawer.getByTestId('strategy-option').filter({ hasText: 'Comprar 60 m' })).toBeVisible({ timeout: 30_000 });
  await drawer.getByRole('button', { name: 'Requisitar compra' }).click();
  await expect.poll(async () => (await coverage()).requested, { timeout: 30_000 }).toBe(60);
  const rq = await one<{ id: string; number: string; status: string; q: number }>(db,
    `SELECT r.id, r.requisition_number number, r.status, l.quantity::float q FROM public.purchase_requisitions r
       JOIN public.purchase_requisition_lines l ON l.requisition_id = r.id
       JOIN public.purchase_requisition_line_requirements lr ON lr.line_id = l.id
      WHERE lr.requirement_id = $1`, [S.requirementId]);
  S.requisitionId = rq.id; S.requisitionNumber = rq.number;
  expect(rq).toMatchObject({ status: 'SUBMITTED', q: 60 });
});

test('5 · compras: cotação com dois fornecedores, duas propostas e a decisão que gera o pedido', async ({ browser }) => {
  const page = await as(browser, 'compras');
  await page.goto('/supply/compras?stage=solicitacoes');
  const ws = page.getByTestId('procurement-workspace');
  await ws.getByRole('checkbox', { name: `Cotar ${CODE} de ${S.requisitionNumber}` }).check();
  await ws.getByRole('button', { name: /Abrir cotação \(1\)/ }).click();
  const rfqForm = page.getByTestId('rfq-form');
  await rfqForm.getByRole('checkbox', { name: new RegExp(`Cabos Ouro ${T}`) }).check();
  await rfqForm.getByRole('checkbox', { name: new RegExp(`Fios Ouro ${T}`) }).check();
  await rfqForm.getByLabel('Prazo de resposta').fill(plus(3));
  await rfqForm.getByRole('button', { name: 'Abrir cotação' }).click();
  await expect.poll(async () => (await db.query(`SELECT q.id FROM public.procurement_rfqs q JOIN public.procurement_rfq_lines l ON l.rfq_id = q.id
    WHERE l.item_id = $1`, [S.item])).rowCount, { timeout: 30_000 }).toBe(1);
  const rfq = await one<{ id: string; number: string; invited: number }>(db, `SELECT q.id, q.rfq_number number,
    (SELECT count(*)::int FROM public.procurement_rfq_suppliers s WHERE s.rfq_id = q.id) invited
    FROM public.procurement_rfqs q JOIN public.procurement_rfq_lines l ON l.rfq_id = q.id WHERE l.item_id = $1`, [S.item]);
  S.rfqId = rfq.id; S.rfqNumber = rfq.number;
  expect(rfq.invited).toBe(2);

  await page.goto(`/supply/compras?stage=cotacoes&rfq=${S.rfqId}`);
  const drawer = page.getByTestId('rfq-drawer');
  const quote = async (supplier: string, price: string, lead: string) => {
    await drawer.getByRole('button', { name: 'Registrar proposta' }).click();
    const qf = page.getByTestId('quote-form');
    await qf.getByLabel('Fornecedor').selectOption({ label: supplier });
    await qf.getByLabel(/Preço unitário/).fill(price);
    await qf.getByLabel('Prazo (dias)').fill(lead);
    await qf.getByLabel('Validade').fill(plus(30));
    await qf.getByRole('button', { name: 'Registrar' }).click();
    await expect(qf).toBeHidden({ timeout: 30_000 });
  };
  await quote(`Cabos Ouro ${T}`, '18,50', '8');
  await quote(`Fios Ouro ${T}`, '17,90', '30');
  await expect(drawer.getByTestId('quote-row')).toHaveCount(2);
  const quotes = await one<{ n: number }>(db, `SELECT count(*)::int n FROM public.supplier_quotes WHERE rfq_id = $1`, [S.rfqId]);
  expect(quotes.n).toBe(2);

  // A recomendação explica: o mais barato chega DEPOIS da necessidade; decide-se pelo que chega a tempo.
  await drawer.getByRole('button', { name: 'Decidir compra' }).click();
  const decide = page.getByTestId('decide-form');
  await decide.getByText(new RegExp(`Cabos Ouro ${T}`)).click();
  await decide.getByLabel(/Justificativa/).fill('Chega antes do lançamento de cabos; a outra proposta atrasa a frente.');
  await decide.getByRole('button', { name: 'Decidir e gerar pedido' }).click();
  await expect.poll(async () => (await db.query(`SELECT po.id FROM public.purchase_orders po JOIN public.sourcing_decisions d
    ON d.id = po.sourcing_decision_id WHERE d.rfq_id = $1`, [S.rfqId])).rowCount, { timeout: 30_000 }).toBe(1);
  const po = await one<{ id: string; number: string; status: string; supplier_id: string; total: number; follows: boolean }>(db,
    `SELECT po.id, po.order_number number, po.status, po.supplier_id, d.follows_recommendation follows,
            (SELECT sum(l.quantity * l.unit_price)::float FROM public.purchase_order_lines l WHERE l.purchase_order_id = po.id) total
       FROM public.purchase_orders po JOIN public.sourcing_decisions d ON d.id = po.sourcing_decision_id WHERE d.rfq_id = $1`, [S.rfqId]);
  S.poId = po.id; S.poNumber = po.number;
  expect(po).toMatchObject({ status: 'DRAFT', supplier_id: S.supplierA });
  expect(po.total).toBeCloseTo(60 * 18.5, 2);
});

test('6 · compras submete; financeiro aprova por alçada; compras emite ao fornecedor', async ({ browser }) => {
  const compras = await as(browser, 'compras');
  await compras.goto(`/supply/compras?stage=pedidos&po=${S.poId}`);
  let drawer = compras.getByTestId('po-drawer');
  await drawer.getByRole('button', { name: 'Editar entrega' }).click();
  let act = compras.getByTestId('po-act-form');
  await act.getByLabel('Local de entrega').selectOption({ label: S.centralName });
  await act.getByLabel('Entrega prevista').fill(plus(12));
  await act.getByRole('button', { name: 'Editar entrega' }).click();
  await expect.poll(async () => (await one<{ loc: string | null }>(db, `SELECT delivery_location_id::text loc FROM public.purchase_orders WHERE id = $1`,
    [S.poId])).loc, { timeout: 30_000 }).toBe(S.central);

  await drawer.getByRole('button', { name: 'Submeter à aprovação' }).click();
  act = compras.getByTestId('po-act-form');
  await act.getByLabel(/Observação/).fill('Cabo do lançamento — necessidade em 18 dias');
  await act.getByRole('button', { name: 'Submeter à aprovação' }).click();
  await expect.poll(async () => (await one<{ status: string }>(db, `SELECT status FROM public.purchase_orders WHERE id = $1`, [S.poId])).status,
    { timeout: 30_000 }).toBe('APPROVAL_REQUIRED');
  const submitted = await one<{ governance: string; submitted_by: string }>(db,
    `SELECT approval_governance governance, submitted_by FROM public.purchase_orders WHERE id = $1`, [S.poId]);
  expect(submitted.submitted_by).toBe(qaLive().users.compras.id);

  // Quem criou/submeteu não aprova: a aprovação é de outra pessoa, com alçada declarada.
  const fin = await as(browser, 'financeiro');
  await fin.goto(`/supply/compras?stage=aprovacao&po=${S.poId}`);
  drawer = fin.getByTestId('po-drawer');
  await expect(drawer.getByText(/Aprovação por (alçada|política)/)).toBeVisible();
  if (submitted.governance === 'POLICY') {
    await drawer.getByTestId('po-policy-approval').getByRole('button', { name: 'Aprovar' }).first().click();
  } else {
    await drawer.getByRole('button', { name: 'Aprovar' }).click();
    act = fin.getByTestId('po-act-form');
    await act.getByLabel(/Observação/).fill('Dentro da alçada — cabo de 35 mm² do lançamento');
    await act.getByRole('button', { name: 'Aprovar' }).click();
  }
  await expect.poll(async () => (await one<{ status: string }>(db, `SELECT status FROM public.purchase_orders WHERE id = $1`, [S.poId])).status,
    { timeout: 60_000 }).toBe('APPROVED');
  const approved = await one<{ approved_by: string | null }>(db, `SELECT approved_by FROM public.purchase_orders WHERE id = $1`, [S.poId]);
  expect(approved.approved_by).toBe(qaLive().users.financeiro.id);

  await compras.goto(`/supply/compras?stage=pedidos&po=${S.poId}`);
  await compras.getByTestId('po-drawer').getByRole('button', { name: 'Emitir ao fornecedor' }).click();
  await expect.poll(async () => (await one<{ status: string }>(db, `SELECT status FROM public.purchase_orders WHERE id = $1`, [S.poId])).status,
    { timeout: 30_000 }).toBe('ISSUED');
  // A cobertura agora conta o pedido como entrando: nada falta, 60 a caminho.
  expect(await coverage()).toMatchObject({ reserved: 40, on_order: 60, shortage: 0 });
});

test('7 · almoxarifado: recebe parcial para inspeção, inspeciona e libera — a reserva do requisito cresce', async ({ browser }) => {
  const page = await as(browser, 'almoxarifado');
  await page.goto(`/supply/recebimentos?receive=${S.poId}`);
  const form = page.getByTestId('receive-form');
  await expect(form.getByLabel(`Recebido ${CODE}`)).toHaveValue('60', { timeout: 60_000 });
  await form.getByLabel(`Recebido ${CODE}`).fill('40');
  await form.getByLabel(/Mandar para inspeção/).check();
  await form.getByRole('button', { name: 'Registrar recebimento' }).click();
  await expect(page.getByTestId('receive-done')).toContainText('Em inspeção', { timeout: 60_000 });

  const rc = await one<{ id: string; inspection_status: string; received_by: string; kind: string }>(db,
    `SELECT r.id, r.inspection_status, r.received_by, l.kind FROM public.goods_receipts r JOIN public.inventory_locations l ON l.id = r.location_id
      WHERE r.purchase_order_id = $1`, [S.poId]);
  S.receiptId = rc.id;
  expect(rc).toMatchObject({ inspection_status: 'PENDING', received_by: qaLive().users.almoxarifado.id, kind: 'QUARANTINE' });
  expect(await one(db, `SELECT status, (SELECT received_quantity::float FROM public.purchase_order_lines WHERE purchase_order_id = po.id) rec
    FROM public.purchase_orders po WHERE id = $1`, [S.poId])).toEqual({ status: 'PARTIALLY_RECEIVED', rec: 40 });
  // Entrando, não reservável: 40 em inspeção, 20 ainda esperados.
  expect(await coverage()).toMatchObject({ inspection: 40, reserved: 40, on_order: 20, shortage: 0 });

  await page.goto('/supply/recebimentos?queue=inspection');
  const row = page.getByTestId('inspection-row').filter({ hasText: S.poNumber! });
  await row.getByRole('button', { name: 'Inspecionar' }).click();
  const inspect = page.getByTestId('inspect-form');
  await inspect.getByLabel(`Aprovado ${CODE}`).fill('40');
  await inspect.getByLabel('Liberar para').selectOption({ label: S.centralName });
  await inspect.getByRole('button', { name: 'Registrar inspeção' }).click();
  await expect(inspect).toBeHidden({ timeout: 60_000 });
  expect(await one(db, `SELECT inspection_status FROM public.goods_receipts WHERE id = $1`, [S.receiptId])).toEqual({ inspection_status: 'APPROVED' });
  // A liberação passa pela transferência canônica e reserva para o requisito que o pedido carregava.
  const cov = await coverage();
  expect(cov).toMatchObject({ inspection: 0, reserved: 80, on_order: 20, shortage: 0 });
  const onHand = await one<{ q: number }>(db, `SELECT coalesce(sum(quantity), 0)::float q FROM public.inventory_movements WHERE item_id = $1 AND location_id = $2`,
    [S.item, S.central]);
  expect(onHand.q).toBe(80);
});

test('8 · almoxarifado: entrega à obra — o consumo do projeto sai do livro-razão e da cobertura', async ({ browser }) => {
  const page = await as(browser, 'almoxarifado');
  await page.goto('/supply/estoque?view=reservas');
  const row = page.getByTestId('reservation-row').filter({ hasText: CODE }).first();
  await row.getByRole('button', { name: 'Entregar' }).click();
  const form = page.getByTestId('reservation-form');
  await form.getByLabel(/Quantidade/).fill('25');
  await form.getByRole('button', { name: 'Entregar à obra' }).click();
  await expect.poll(async () => (await coverage()).consumed, { timeout: 30_000 }).toBe(25);
  expect(await coverage()).toMatchObject({ consumed: 25, reserved: 55, on_order: 20, shortage: 0 });
  // O livro-razão conta a história inteira do material, na ordem: saldo livre → recebido na quarentena →
  // liberado pela inspeção (transferência canônica) → entregue à obra.
  const ledger = await db.query(`SELECT m.movement_type type, m.quantity::float q, l.kind, m.project_id
    FROM public.inventory_movements m JOIN public.inventory_locations l ON l.id = m.location_id WHERE m.item_id = $1 ORDER BY m.seq`, [S.item]);
  expect(ledger.rows).toEqual([
    { type: 'ADJUSTMENT', q: 40, kind: 'WAREHOUSE', project_id: null },
    { type: 'RECEIPT', q: 40, kind: 'QUARANTINE', project_id: S.projectId },
    { type: 'TRANSFER_OUT', q: -40, kind: 'QUARANTINE', project_id: S.projectId },
    { type: 'TRANSFER_IN', q: 40, kind: 'WAREHOUSE', project_id: S.projectId },
    { type: 'ISSUE_TO_PROJECT', q: -25, kind: 'WAREHOUSE', project_id: S.projectId },
  ]);

  // A cadeia inteira se lê de volta: o projeto mostra a OS que o autoriza e o consumo do material.
  const gestor = await as(browser, 'gestor');
  await gestor.goto(`/projetos/${encodeURIComponent(S.projectId!)}`);
  await expect(gestor.getByTestId('project-glance').getByRole('link', { name: S.osNumber! })).toBeVisible({ timeout: 60_000 });
});
