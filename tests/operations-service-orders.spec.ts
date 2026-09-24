/**
 * E2E — Operações: Visão Geral, Ordens de Serviço e workspace da OS.
 *
 * Leituras vão ao servidor REAL com o usuário QA (owner_admin). NENHUMA
 * escrita chega ao banco: todo não-GET para `/api/operations` e
 * `/api/commercial` é abortado e registrado. Onde a organização de QA não
 * tem OS real, o workspace é validado com um estado interceptado (marcado
 * `intercepted`) — a tela é a real, só o payload é de fixture.
 *
 * Fotos (não versionadas) em `test-results/operations/`.
 *
 *   PONTO_E2E_REUSE=1 npx playwright test tests/operations-service-orders.spec.ts --project=chromium
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as { email: string; password: string };
const OUT = 'test-results/operations';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let ctx: BrowserContext;
let page: Page;
const blockedWrites: string[] = [];
const consoleErrors: string[] = [];

async function signIn(target: Page) {
  await target.goto('/login');
  await target.locator('input[type="email"]').fill(qa.email);
  const password = target.locator('input[type="password"]');
  await password.fill(qa.password);
  await password.press('Enter');
  await target.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
}

async function expectNoFailureSurface(target: Page) {
  await expect(target.getByText(/Esta ação exige:/i)).toHaveCount(0);
  await expect(target.getByText(/Application error|Unhandled Runtime Error/i)).toHaveCount(0);
  await expect(target.getByText(/Não foi possível (carregar|consultar|montar)/i)).toHaveCount(0);
}

async function snap(name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

const noHorizontalScroll = () =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  for (const pattern of ['**/api/operations/**', '**/api/commercial/**']) {
    await ctx.route(pattern, (route) => {
      if (route.request().method() === 'GET') return route.continue();
      blockedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.abort();
    });
  }
  await signIn(page);
});

test.afterAll(async () => { await ctx?.close(); });

test('1 · a sidebar tem o grupo Operações com os destinos canônicos', async () => {
  await page.goto('/operacoes');
  const action = page.locator('[data-sidebar="menu-action"][aria-label$="submenu de Operações"]').first();
  await expect(action).toHaveAttribute('aria-expanded', 'true', { timeout: 40_000 });
  for (const label of ['Visão Geral', 'Ordens de Serviço', 'Projetos', 'Mapa de Operações']) {
    await expect(page.locator('.hud-nav-submenu').getByRole('link', { name: label, exact: true }).first()).toBeVisible();
  }
  await expect(page.locator('[data-sidebar="menu-action"][aria-label$="submenu de Projetos"]')).toHaveCount(0);
});

test('2 · Visão Geral de Operações monta com números definidos e fila de decisão', async () => {
  await page.goto('/operacoes');
  await expect(page.getByRole('heading', { name: 'O que está autorizado, o que está travado' })).toBeVisible({ timeout: 60_000 });
  for (const kpi of ['Projetos ativos', 'OS aguardando emissão', 'Atividades críticas', 'Projetos em risco', 'Pendências de medição']) {
    await expect(page.getByText(kpi, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('O que precisa de decisão').first()).toBeVisible();
  await expect(page.getByText('Execução próxima').first()).toBeVisible();
  await expectNoFailureSurface(page);
  await snap('overview-1440');
});

test('3 · Ordens de Serviço: fila, filtros e as duas portas de entrada', async () => {
  await page.goto('/operacoes/ordens-servico');
  await expect(page.getByRole('heading', { name: 'Ordens de Serviço internas' })).toBeVisible({ timeout: 60_000 });
  for (const f of ['Todas', 'Aguardando emissão', 'Travadas', 'Sem projeto', 'Em execução']) {
    await expect(page.getByRole('group', { name: 'Filtrar ordens' }).getByRole('button', { name: new RegExp(`^${f}`) })).toBeVisible();
  }
  await expectNoFailureSurface(page);
  await snap('service-orders-1440');

  await page.getByRole('button', { name: /Gerar a partir de proposta/ }).first().click();
  const generate = page.getByTestId('generate-os-modal');
  await expect(generate).toBeVisible();
  await expect(generate.getByText(/Carregando pacotes aceitos/)).toHaveCount(0, { timeout: 30_000 });
  await expect(generate.getByText(/pacote PT \+ PC aceito|Nenhum pacote PT \+ PC aceito/i).or(
    generate.getByRole('radiogroup', { name: 'Pacotes aceitos' }))).toBeVisible();
  await snap('generate-modal');
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await page.getByRole('button', { name: /Importar OS/ }).first().click();
  const importModal = page.getByTestId('import-os-modal');
  await expect(importModal.getByText('Trabalho autorizado')).toBeVisible();
  await expect(importModal.locator('input[type="file"]')).toHaveAttribute('accept', 'application/pdf');
  await snap('import-modal');
  await page.getByRole('button', { name: 'Cancelar' }).click();
});

const OS_ID = '00000000-0000-4000-8000-00000000c230';
const fixture = {
  ok: true,
  order: {
    id: OS_ID, engagement_id: 'e1', os_number: 'OS-2026-0042', title: 'Montagem eletromecânica — SE Norte',
    origin: 'from_accepted_proposal', status: 'PENDING_CONFIRMATION', authorized_value: '1250000', currency: 'BRL',
    scope_summary: null, site_label: 'Subestação Norte', planned_start: '2026-10-05', planned_finish: '2026-12-20',
    project_id: null, source_proposal_revision_id: 'r2', source_context_acceptance_id: 'a1',
    governing_technical_revision_id: 'r1', governing_commercial_revision_id: 'r2', governing_combined_revision_id: null,
    document_id: null, issued_at: null, issued_by: null, responsible_user_id: null, notes: null,
    created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z',
  },
  engagement: { id: 'e1', title: 'SE Norte', counterparty_name: 'Energética Norte S.A.', status: 'AUTHORIZED' },
  package: {
    acceptanceId: 'a1', acceptedAt: '2026-09-18T12:00:00Z', acceptanceSource: 'purchase_order', acceptanceExternalRef: 'PO 4500',
    technical: { revisionId: 'r1', proposalId: 'p1', proposalNumber: 'PT-2899.02', revision: 1, status: 'ACCEPTED', kind: 'TECHNICAL' },
    commercial: { revisionId: 'r2', proposalId: 'p2', proposalNumber: 'PC-2899.02', revision: 1, status: 'ACCEPTED', kind: 'COMMERCIAL' },
    combined: null,
  },
  sourceRevision: null,
  governingAuthorization: { id: 'g1', source_kind: 'accepted_proposal', authorized_value: '1250000', currency: 'BRL' },
  items: [
    { id: 'i1', kind: 'SCOPE', position: 1, title: 'Montagem eletromecânica da subestação', detail: null, quantity: null, unit: null,
      planned_date: null, origin: 'proposal_package', source_document_kind: 'TECHNICAL_PROPOSAL', source_revision_id: 'r1',
      source_fact_id: 'f1', source_document_id: null, source_page: 3, source_quote: 'montagem eletromecânica completa',
      ai_provider: 'openai', ai_model: 'gpt-6-luna', confidence: '0.93', confirmation_state: 'CONFIRMED', confirmed_by: 'u1', confirmed_at: '2026-09-20T12:00:00Z' },
    { id: 'i2', kind: 'RESOURCE', position: 2, title: 'Cabo 35 mm', detail: '1000 m', quantity: '1000', unit: 'm',
      planned_date: null, origin: 'proposal_package', source_document_kind: 'TECHNICAL_PROPOSAL', source_revision_id: 'r1',
      source_fact_id: 'f2', source_document_id: null, source_page: 7, source_quote: 'cabo de 35 mm², 1.000 m',
      ai_provider: 'openai', ai_model: 'gpt-6-luna', confidence: '0.81', confirmation_state: 'UNCONFIRMED', confirmed_by: null, confirmed_at: null },
  ],
  divergences: [
    { id: 'd1', scope: 'VALUE', field_path: 'authorized_value', left_source_kind: 'accepted_proposal', left_value: '1250000',
      right_source_kind: 'internal_service_order', right_value: '1300000', severity: 'BLOCKING',
      summary: 'OS interna declara 1300000; a fonte regente declara 1250000.', detected_by: 'rule', ai_model: null, confidence: null,
      state: 'OPEN', resolved_source_kind: null, resolution_note: null, resolved_at: null, created_at: '2026-09-20T12:00:00Z', service_order_id: OS_ID },
  ],
  revisions: [], exceptions: [], history: [], events: [], documents: [], project: null,
  people: { u1: 'Paula Ribeiro' },
  counts: { items: 2, unreviewedItems: 1, openDivergences: 1, blockingOpen: 1 },
  nextAction: { code: 'REVIEW_CONTENT', label: 'Revisar 1 linha lida', tone: 'warning', needsDecision: true },
  capabilities: { manage: true, override: true, bindProject: true, ingest: true, resolveDivergences: true,
    issueNormally: false, issueWithException: false },
};

test('4 · workspace da OS: pacote exato, portão de emissão, linhas com proveniência (intercepted)', async () => {
  await page.route(`**/api/operations/service-orders/${OS_ID}`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: fixture }) : route.abort());
  await page.goto(`/operacoes/ordens-servico/${OS_ID}`);
  const ws = page.getByTestId('os-workspace');
  await expect(ws).toBeVisible({ timeout: 60_000 });
  await expect(ws.getByText('PT-2899.02').first()).toBeVisible();
  await expect(ws.getByText('PC-2899.02').first()).toBeVisible();
  await expect(ws.getByText(/Próxima ação: Revisar 1 linha lida/)).toBeVisible();
  await expect(ws.getByText('Conteúdo revisado por pessoa')).toBeVisible();
  await expect(ws.getByText('1 bloqueante(s) em aberto')).toBeVisible();
  await expect(ws.getByRole('button', { name: 'Emitir OS' })).toBeDisabled();
  await expect(ws.getByText('Pendente de revisão').first()).toBeVisible();
  await expect(ws.getByText(/p\. 7/).first()).toBeVisible();
  await snap('workspace-summary-intercepted');

  // Revisar uma linha tenta escrever — e a escrita é abortada antes do servidor.
  const before = blockedWrites.length;
  await ws.getByTestId('os-line').filter({ hasText: 'Cabo 35 mm' }).getByRole('button', { name: 'Confirmar' }).click();
  await expect.poll(() => blockedWrites.length).toBeGreaterThan(before);
  expect(blockedWrites.at(-1)).toBe(`PUT /api/operations/service-orders/${OS_ID}/items`);

  await ws.getByRole('tab', { name: /Divergências/ }).click();
  await expect(ws.getByTestId('os-divergence')).toHaveCount(1);
  await expect(ws.getByText('Bloqueante').first()).toBeVisible();
  await expect(ws.getByRole('button', { name: 'Confronto assistido' })).toBeVisible();
  await snap('workspace-divergences-intercepted');

  await ws.getByRole('tab', { name: 'Projeto' }).click();
  await expect(ws.getByText('O projeto nasce da OS emitida')).toBeVisible();
  await page.unroute(`**/api/operations/service-orders/${OS_ID}`);
});

test('5 · uma OS real (quando existe) abre no workspace pela fila', async () => {
  await page.goto('/operacoes/ordens-servico');
  await expect(page.getByRole('heading', { name: 'Ordens de Serviço internas' })).toBeVisible({ timeout: 60_000 });
  const first = page.locator('table.crm-table tbody a.crm-row-open').first();
  if (await first.count() === 0) {
    test.info().annotations.push({ type: 'note', description: 'Organização de QA sem OS real — coberto pelo teste 4.' });
    return;
  }
  await first.click();
  await expect(page.getByTestId('os-workspace')).toBeVisible({ timeout: 60_000 });
  for (const tab of ['Resumo', 'Escopo e atividades', 'Materiais & Recursos', 'Divergências', 'Documentos', 'Projeto', 'Histórico']) {
    await expect(page.getByRole('tab', { name: new RegExp(`^${tab}`) })).toBeVisible();
  }
  await expectNoFailureSurface(page);
});

test('6 · a API de Operações não responde a quem não está autenticado', async ({ request }) => {
  // O middleware manda para /login ANTES da rota; a rota, se alcançada, responde 401.
  // Em nenhum caso sai dado: nem JSON de OS, nem de visão geral.
  const denied = (status: number, location: string | undefined) =>
    status === 401 || (status === 307 && (location ?? '').includes('/login'));
  for (const url of ['/api/operations/overview', '/api/operations/service-orders', '/api/operations/service-orders/packages']) {
    const res = await request.get(url, { maxRedirects: 0 });
    expect(denied(res.status(), res.headers().location), `${url} → ${res.status()}`).toBe(true);
    expect(await res.text()).not.toContain('"serviceOrders"');
  }
  const write = await request.post(`/api/operations/service-orders/${OS_ID}/issue`, { data: { mode: 'normal' }, maxRedirects: 0 });
  expect(denied(write.status(), write.headers().location)).toBe(true);
});

test('7 · celular: fila de OS e visão geral sem rolagem horizontal', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/operacoes/ordens-servico');
  await expect(page.getByRole('heading', { name: 'Ordens de Serviço internas' })).toBeVisible({ timeout: 60_000 });
  expect(await noHorizontalScroll()).toBe(true);
  await snap('service-orders-390');
  await page.goto('/operacoes');
  await expect(page.getByRole('heading', { name: 'O que está autorizado, o que está travado' })).toBeVisible({ timeout: 60_000 });
  expect(await noHorizontalScroll()).toBe(true);
  await snap('overview-390');
  await page.setViewportSize({ width: 1440, height: 900 });
});

test('8 · nenhuma escrita chegou ao servidor e nenhum erro de runtime', async () => {
  expect(blockedWrites.every((w) => w.startsWith('PUT ') || w.startsWith('POST ') || w.startsWith('PATCH '))).toBe(true);
  // "Failed to fetch" é aborto de rede (escritas que este spec aborta, ou busca cortada na navegação), não erro de runtime.
  expect(consoleErrors.filter((e) => /Unhandled|TypeError|ReferenceError/.test(e) && !/Failed to fetch/.test(e))).toEqual([]);
});
