/**
 * E2E — Fase 7: a cadeia contrato-a-caixa, na tela.
 *
 * Pré-requisitos:
 *   1. node scripts/qa-contracts-governance-seed.mjs   (contrato [QA] + relações)
 *   2. node scripts/qa-seed-workforce.mjs              (usuário QA owner_admin)
 *   3. servidor em http://localhost:9002
 * Rodar: npx playwright test tests/contracts-phase7-faturamentos.spec.ts --project=chromium
 *
 * Login real via /login, como todo E2E deste repositório — nenhum bypass de
 * autenticação é introduzido aqui.
 *
 * ─── O que esta suíte prova, e por que na tela ────────────────────────────
 *
 * As provas de banco já garantem que o resolvedor devolve DESCONHECIDO quando
 * não há título em Finanças. O que só a tela prova é que esse desconhecido
 * chega ao olho como palavra, e não como "R$ 0,00" — que é a mentira concreta
 * que a §62 existe para impedir, e que só aparece depois da renderização.
 *
 * Esta suíte é somente de LEITURA. Ela não libera faturamento: liberar é ato
 * governado com efeito em Fiscal e Finanças, e um E2E que o dispare deixaria
 * cadeia de produção pela metade a cada execução.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as {
  email: string; password: string;
};

const CONTRACT_NUMBER = 'QA-0001';

let ctx: BrowserContext;
let page: Page;
let contractId: string;

/*
  A carteira navega por SLUG na query, não por aba clicável: `?view=faturamentos`
  é o link estável que a própria interface gera. Clicar na aba dependeria do
  rótulo visível, que a §85 permite mudar sem quebrar link salvo — e um teste
  preso ao rótulo quebraria junto.
*/
const openFaturamentos = async () => {
  await page.goto('/contratos?view=faturamentos', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Cadeia por evento')).toBeVisible({ timeout: 120_000 });
};

const withDb = async <T>(fn: (q: (sql: string, params?: unknown[]) => Promise<T[]>) => Promise<T[]>) => {
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(async (sql, params) => (await client.query(sql, params)).rows as T[]);
  } finally {
    await client.end();
  }
};

/*
  O `/contratos` é uma das páginas mais pesadas do app e a primeira visita
  paga a compilação do Turbopack inteira. Trinta segundos cobrem a navegação
  de uma rota já compilada e não cobrem a primeira — o que fazia esta suíte
  falhar por AQUECIMENTO, e não por defeito.
*/
test.setTimeout(180_000);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(180_000);

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  await page.locator('input[type="password"]').fill(qa.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });

  const rows = await withDb<{ id: string }>((q) =>
    q('select id from contracts where contract_number = $1 and deleted_at is null limit 1',
      [CONTRACT_NUMBER]));
  expect(rows.length, 'contrato [QA] ausente — rode scripts/qa-contracts-governance-seed.mjs').toBe(1);
  contractId = rows[0].id;

  // Aquecimento: paga a compilação das duas rotas uma vez, aqui, em vez de
  // cobrá-la do primeiro teste que passar por elas.
  await openFaturamentos();
  await page.goto(`/contratos/${contractId}`, { waitUntil: 'domcontentloaded' });
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await ctx?.close();
});

test('Faturamentos abre a seção da cadeia por evento', async () => {
  await openFaturamentos();

  await expect(page.getByText('Cadeia por evento')).toBeVisible();
  await expect(page.getByText(
    'Origem do valor, elegibilidade, liberação, nota, recebido e conciliação')).toBeVisible();
});

/*
  ─── Por que a prova de renderização mora no DOSSIÊ ───────────────────────

  Os cinco eventos de faturamento que existem em produção pertencem ao
  contrato `[QA]`, que é `data_class = 'demo'`. A carteira oficial os EXCLUI,
  e isso é o comportamento correto: a §99 proíbe que raiz demo entre em
  métrica oficial, e o filtro padrão da carteira honra essa fronteira.

  Uma suíte que forçasse a carteira a exibi-los provaria o oposto do que se
  quer. O dossiê do contrato, que é onde aquele contrato legitimamente se
  mostra, é o lugar certo para provar que a AUSÊNCIA de vínculo financeiro
  aparece como palavra e não como "R$ 0,00".
*/
test('sem título em Finanças, RECEBIDO diz desconhecido — nunca R$ 0', async () => {
  await page.goto(`/contratos/${contractId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Financeiro' }).click();
  await expect(page.getByText('Cadeia até o caixa')).toBeVisible({ timeout: 120_000 });

  const chain = page.locator('section').filter({ hasText: 'Cadeia até o caixa' });
  // Os cinco eventos são anteriores à Fase 7 e não têm título em Finanças.
  await expect(chain.getByText('Recebido').first()).toBeVisible();
  await expect(chain.getByText('Sem vínculo com Finanças').first()).toBeVisible();
  // E a origem do valor deles é declaradamente desconhecida (§126).
  await expect(chain.getByText('Anterior à Fase 7 — origem não registrada').first()).toBeVisible();
  await expect(chain.getByText('Origem não registrada').first()).toBeVisible();
  // O defeito exato que esta prova guarda.
  await expect(chain.getByText('R$ 0,00')).toHaveCount(0);
});

test('a lista legada é rotulada como registro histórico, sem KPI de caixa', async () => {
  await openFaturamentos();

  await expect(page.getByText('Eventos de faturamento (registro histórico)')).toBeVisible();
  // Os cartões que afirmavam caixa a partir de `paid_at` saíram (§59, §121).
  await expect(page.getByText('Realizado', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Saldo a faturar', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Eventos com vencimento passado')).toBeVisible();
});

test('o dossiê Financeiro usa o MESMO painel da carteira', async () => {
  await page.goto(`/contratos/${contractId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Financeiro' }).click();

  await expect(page.getByText('Cadeia até o caixa')).toBeVisible({ timeout: 120_000 });
  // Mesmas colunas, mesmo vocabulário: é o mesmo componente e o mesmo serviço.
  await expect(page.getByText('Elegível a faturar').first()).toBeVisible();
  await expect(page.getByText('Recebido').first()).toBeVisible();
  await expect(page.getByText(/^Elegibilidade:/).first()).toBeVisible();
  await expect(page.getByText(/^Liberação:/).first()).toBeVisible();
});

test('nenhuma métrica inventada de caixa aparece na tela (§121)', async () => {
  await openFaturamentos();
  await expect(page.getByText('Cadeia por evento')).toBeVisible();

  for (const forbidden of ['DSO', 'Inadimplência', '% recebido', 'Pronto para faturar']) {
    await expect(page.getByText(forbidden, { exact: false })).toHaveCount(0);
  }
});
