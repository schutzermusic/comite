/**
 * E2E — workspace do projeto (wave C) e fila global de Medições & Evidências.
 *
 * Somente leitura, com o usuário QA real. Qualquer não-GET para as APIs de
 * Operações, Comercial e Projetos é abortado e registrado. Fotos (não
 * versionadas) em `test-results/operations/`.
 *
 *   PONTO_E2E_REUSE=1 npx playwright test tests/operations-project-workspace.spec.ts --project=chromium
 */
import { e2eCredentials, e2eDbConfig } from './support/e2e-credentials';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });
const qa = e2eCredentials();

/** Um projeto real da organização de QA — leitura, sessão somente-leitura. */
async function qaProjectId(): Promise<string | null> {
  const db = new pg.Client(e2eDbConfig());
  await db.connect();
  try {
    await db.query('BEGIN TRANSACTION READ ONLY'); // pooler em modo transação: nada de SET SESSION
    const { rows } = await db.query(`SELECT p.id FROM public.projects p WHERE p.organization_id = $1
      ORDER BY (SELECT count(*) FROM public.project_timeline_items t WHERE t.project_id = p.id) DESC, p.id LIMIT 1`, [qa.orgId]);
    return rows[0]?.id ?? null;
  } finally { await db.query('ROLLBACK').catch(() => undefined); await db.end(); }
}
const OUT = 'test-results/operations';

test.describe.configure({ mode: 'serial' });
test.setTimeout(150_000);

let ctx: BrowserContext;
let page: Page;
let projectPath: string | null = null;
const blockedWrites: string[] = [];

async function snap(name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  for (const pattern of ['**/api/operations/**', '**/api/commercial/**', '**/api/projects/**']) {
    await ctx.route(pattern, (route) => {
      if (route.request().method() === 'GET') return route.continue();
      blockedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.abort();
    });
  }
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  const password = page.locator('input[type="password"]');
  await password.fill(qa.password);
  await password.press('Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
});

test.afterAll(async () => { await ctx?.close(); });

test('1 · o projeto abre na Visão Geral: o projeto num olhar e o que trava', async () => {
  const id = await qaProjectId();
  expect(id, 'a organização de QA precisa de ao menos um projeto').toBeTruthy();
  projectPath = `/projetos/${encodeURIComponent(id!)}`;
  await page.goto(projectPath!);
  await expect(page.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
  // Num olhar: estado, período, avanço, saúde (com o motivo), próximo marco e a OS que autoriza o trabalho.
  const glance = page.getByTestId('project-glance');
  for (const label of ['Estado', 'Período', 'Avanço físico', 'Saúde', 'Próximo marco', 'Autorização']) {
    await expect(glance.getByText(label, { exact: true })).toBeVisible();
  }
  const overview = page.getByTestId('project-overview');
  await expect(overview).toBeVisible({ timeout: 60_000 });
  for (const label of ['Atividades críticas', 'Frentes sem prontidão', 'Material sem cobertura']) {
    await expect(overview.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(overview.getByText('Bloqueios críticos')).toBeVisible();
  await expect(overview.getByTestId('project-next-fronts')).toBeVisible();
  await expect(page.getByText(/Não foi possível montar/)).toHaveCount(0);
  await snap('project-overview');
});

test('2 · as abas seguem o plano e vivem na URL; o cronograma mantém ?tab=timeline', async () => {
  for (const tab of ['Visão geral', 'Cronograma e plano', 'Materiais', 'Medições & Evidências', 'Apontamentos', 'Equipe', 'Riscos',
    'Documentos', 'Contexto contratual', 'Histórico']) {
    await expect(page.getByRole('tab', { name: new RegExp(`^${tab}`) })).toBeVisible();
  }
  await page.getByRole('tab', { name: /^Apontamentos/ }).click();
  await expect(page).toHaveURL(/tab=timesheet/);
  await page.goto(`${projectPath}?tab=timeline`);
  await expect(page.getByRole('tab', { name: /^Cronograma e plano/ })).toHaveAttribute('aria-selected', 'true', { timeout: 60_000 });
  await expect(page.getByTestId('project-requirements')).toBeVisible({ timeout: 60_000 });
});

test('3 · o Histórico é um fluxo cronológico de histórias canônicas, em português', async () => {
  await page.goto(`${projectPath}?tab=activity`);
  const timeline = page.getByTestId('project-activity-timeline');
  await expect(timeline).toBeVisible({ timeout: 60_000 });
  await expect(timeline.getByText(/evento\(s\) de/)).toBeVisible();
  // Nenhum evento aparece com o nome técnico do tipo (ex.: "purchase order · submitted").
  await expect(timeline.getByText(/purchase order|goods receipt|sourcing ·|· submitted|· edited/)).toHaveCount(0);
  await expect(page.getByText(/Não foi possível montar/)).toHaveCount(0);
  await snap('project-timeline');
});

test('4 · Medições & Evidências: fila do portfólio sem confundir aprovação com aceite', async () => {
  await page.goto('/operacoes/medicoes');
  await expect(page.getByRole('heading', { name: 'Da evidência ao faturamento' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Aprovada — enviar ao cliente').first()).toBeVisible();
  await expect(page.getByText(/Pacote aprovado internamente — enviar ao cliente \(ainda não é aceite\)/).first()).toBeVisible();
  await expect(page.getByText('Aceita — elegível a faturamento').first()).toBeVisible();
  await expect(page.getByText(/Esta ação exige:/)).toHaveCount(0);
  await snap('measurements-queue');
});

test('5 · as abas novas estabilizam: nenhuma requisição em laço', async () => {
  let calls = 0;
  const count = (r: { url: () => string }) => { if (/\/api\/operations\/|rest\/v1/.test(r.url())) calls += 1; };
  page.on('request', count);
  await page.goto(projectPath!);
  await expect(page.getByTestId('project-overview')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(4000);
  const settled = calls;
  await page.waitForTimeout(6000);
  page.off('request', count);
  expect(calls - settled, `requisições continuam após estabilizar (${calls - settled})`).toBeLessThan(3);
});

test('6 · nenhuma escrita saiu do navegador', async () => {
  expect(blockedWrites).toEqual([]);
});
