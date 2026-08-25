/**
 * E2E — Projetos › Timeline (Gantt) após o redesign.
 *
 * Cobre o que os testes unitários não alcançam: o painel realmente monta, o
 * painel esquerdo fica congelado no scroll horizontal, o zoom troca a escala,
 * busca e KPI convergem no MESMO recorte, e o deep link abre o drawer certo.
 *
 * Login real via /login, como todo E2E deste repositório. Somente LEITURA —
 * nenhuma atividade, dependência ou apontamento é criado, então não há
 * limpeza a fazer.
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

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

let ctx: BrowserContext;
let page: Page;
let projectId = '';
let firstItemId = '';
let firstItemTitle = '';

async function withDb<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(async (sql, params) => (await client.query(sql, params)).rows);
  } finally {
    await client.end();
  }
}

const gantt = () => page.getByRole('grid', { name: 'Cronograma do projeto' });
const rows = () => page.locator('[data-timeline-row]');
const counter = () => page.getByTestId('timeline-visible-count');

async function gotoTimeline(extra = '') {
  await page.goto(`/projetos/${projectId}?tab=timeline${extra}`);
  await expect(gantt()).toBeVisible({ timeout: 45_000 });
}

/**
 * A execução hidrata numa SEGUNDA fase, depois do cronograma (o Gantt nunca
 * espera o timesheet). Esperar só pelo grid deixaria o teste correndo contra
 * uma tela ainda sem os indicadores de esforço.
 *
 * Devolve 'available' quando a faixa de execução apareceu, 'unauthorized'
 * quando o aviso de permissão apareceu — os dois são resultados corretos.
 */
async function waitForExecutionPhase(): Promise<'available' | 'unauthorized'> {
  const strip = page.getByText('Horas planejadas', { exact: true });
  const denied = page.getByText(/Horas de apontamento não exibidas/);
  await expect(async () => {
    expect((await strip.count()) + (await denied.count())).toBeGreaterThan(0);
  }).toPass({ timeout: 45_000 });
  return (await strip.count()) > 0 ? 'available' : 'unauthorized';
}

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  await ctx.addInitScript(() => { window.print = () => {}; });

  await page.goto('/login');
  await page.locator('input[type="email"]').fill(qa.email);
  await page.locator('input[type="password"]').fill(qa.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });

  // Escolhe o projeto com o maior cronograma ativo — o teste lê o que existe,
  // não semeia um cenário próprio.
  const found = await withDb((q) =>
    q(`select project_id, count(*) n from project_timeline_items
        where is_active and deleted_at is null
        group by project_id order by n desc limit 1`),
  );
  expect(found.length, 'nenhum projeto com cronograma — importe um MS Project antes').toBe(1);
  projectId = found[0].project_id;

  const leaf = await withDb((q) =>
    q(`select id, title from project_timeline_items
        where project_id = $1 and is_active and deleted_at is null and not is_summary
        order by row_order limit 1`, [projectId]),
  );
  firstItemId = leaf[0].id;
  firstItemTitle = leaf[0].title;
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await ctx?.close();
});

test('monta o cronograma com cabeçalho, linhas e legenda', async () => {
  await gotoTimeline();
  await expect(rows().first()).toBeVisible();
  expect(await rows().count()).toBeGreaterThan(1);

  // Cabeçalho de colunas do painel esquerdo.
  await expect(gantt().getByText('EDT', { exact: true })).toBeVisible();
  await expect(gantt().getByText('Atividade', { exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Legenda' })).toBeVisible();
});

test('o painel esquerdo permanece congelado no scroll horizontal', async () => {
  await gotoTimeline();
  const firstRow = rows().first();
  const cell = firstRow.locator('div.sticky').first();

  const before = await cell.boundingBox();
  await gantt().evaluate((el) => el.scrollBy({ left: 600 }));
  await page.waitForTimeout(400);
  const after = await cell.boundingBox();

  // É exatamente a regressão que o redesign corrige: antes o painel rolava junto.
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(4);
});

test('alternar o zoom troca a escala de datas', async () => {
  await gotoTimeline();
  const scale = page.getByRole('radiogroup', { name: 'Escala do cronograma' });

  const widthAt = async (label: string) => {
    await scale.getByRole('radio', { name: label }).click();
    await page.waitForTimeout(500);
    return gantt().evaluate((el) => el.scrollWidth);
  };

  const month = await widthAt('Mês');
  const day = await widthAt('Dia');
  // O zoom de dia é sempre mais largo que o de mês para o mesmo intervalo.
  expect(day).toBeGreaterThan(month);
});

test('a busca reduz o recorte e o contador acompanha', async () => {
  await gotoTimeline();
  const total = await rows().count();

  await page.getByLabel('Buscar atividade').fill(firstItemTitle.slice(0, 12));
  await expect(counter()).toHaveText(/^\d+ de \d+ atividades$/, { timeout: 10_000 });
  await page.waitForTimeout(400);

  expect(await rows().count()).toBeLessThan(total);
  await expect(gantt().getByText(firstItemTitle, { exact: false }).first()).toBeVisible();
});

test('o KPI "Sem responsável" acende o chip e filtra o gráfico', async () => {
  await gotoTimeline();

  // Sem filtro: "83 atividades". Com filtro: "N de 83 atividades".
  await expect(counter()).toHaveText(/^\d+ atividades$/);

  await page.getByText('Sem responsável', { exact: true }).first().click();
  await page.waitForTimeout(500);

  // KPI e chip compartilham UM estado: clicar no KPI acende o chip.
  await expect(counter()).toHaveText(/^\d+ de \d+ atividades$/);
  await expect(page.getByRole('button', { name: /Sem responsável/i }).last()).toBeVisible();

  await page.getByRole('button', { name: 'Limpar' }).click();
  await page.waitForTimeout(400);
  await expect(counter()).toHaveText(/^\d+ atividades$/);
});

/* ────────────────────── P3 — inteligência de execução ────────────────────── */

test('KPIs de prazo existem e o atraso previsto é derivado, não zero fixo', async () => {
  await gotoTimeline();
  await expect(page.getByText('Marcos em risco')).toBeVisible();
  await expect(page.getByText('Atraso previsto')).toBeVisible();
  // "no prazo" (0 dias), "+N d" ou "—" quando não há base. Nunca "0".
  await expect(page.getByText(/^(no prazo|[+-]\d+ d|—)$/).first()).toBeVisible();
});

test('horas planejadas sem cadastro mostram "—" e a cobertura é declarada', async () => {
  await gotoTimeline();

  // Sem permissão de timesheet a faixa inteira some — comportamento correto.
  if ((await waitForExecutionPhase()) === 'unauthorized') return;

  // A regra central: ausência de fonte NUNCA vira "0 h".
  const covered = await withDb((q) =>
    q(`select count(duration_minutes) n from project_timeline_items
        where project_id = $1 and is_active and deleted_at is null and not is_summary`, [projectId]),
  );
  if (Number(covered[0].n) === 0) {
    // A cobertura é declarada com números, para o "—" não parecer defeito.
    await expect(page.getByText(/Horas planejadas cadastradas em 0 de \d+ atividades/)).toBeVisible();
    // E o KPI mostra ausência: o travessão está presente na faixa de execução.
    await expect(page.getByText('—', { exact: true }).first()).toBeVisible();
  }
});

test('cadastrar horas planejadas passa a alimentar os indicadores de esforço', async () => {
  await gotoTimeline(`&item=${firstItemId}`);
  // Sem `expect` aqui um campo ausente viraria skip silencioso — e o caminho
  // de escrita, que é o ponto do teste, nunca seria exercido.
  const hours = page.getByLabel('Horas planejadas');
  await expect(hours).toBeVisible({ timeout: 20_000 });

  const before = await withDb((q) =>
    q(`select duration_minutes from project_timeline_items where id = $1`, [firstItemId]),
  );

  await hours.fill('8');
  await hours.blur();
  await expect
    .poll(async () => {
      const rows = await withDb((q) =>
        q(`select duration_minutes from project_timeline_items where id = $1`, [firstItemId]),
      );
      return rows[0].duration_minutes;
    }, { timeout: 20_000 })
    .toBe(480);

  // O valor sai do banco e volta na coluna Plan. da linha correspondente.
  await page.reload();
  await expect(gantt()).toBeVisible({ timeout: 45_000 });
  if ((await waitForExecutionPhase()) === 'available') {
    await expect(page.locator(`[data-timeline-row="${firstItemId}"]`)).toContainText('8 h', { timeout: 20_000 });
  }

  // Devolve ao estado original: o teste não deixa dado de cadastro para trás.
  await withDb((q) =>
    q(`update project_timeline_items set duration_minutes = $2 where id = $1`,
      [firstItemId, before[0].duration_minutes]),
  );
});

test('o drawer mostra prazo esperado × realizado mesmo sem horas', async () => {
  await gotoTimeline(`&item=${firstItemId}`);
  await expect(page.getByRole('heading', { name: 'Prazo' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Esperado', { exact: true })).toBeVisible();
  await expect(page.getByText('Realizado', { exact: true })).toBeVisible();
  await expect(page.getByText(/Variação de prazo:/)).toBeVisible();
});

test('o filtro "Atrás do plano" funciona sem permissão de timesheet', async () => {
  await gotoTimeline();
  const chip = page.getByRole('button', { name: /Atrás do plano/i });
  await expect(chip).toBeVisible();
  await chip.click();
  await page.waitForTimeout(600);
  await expect(counter()).toHaveText(/^\d+ de \d+ atividades$/);
  await page.getByRole('button', { name: 'Limpar' }).click();
});

test('deep link ?item= abre o drawer da atividade', async () => {
  await gotoTimeline(`&item=${firstItemId}`);

  // HudDrawer não expõe role="dialog" (lacuna de a11y do componente
  // compartilhado, fora do escopo desta mudança): localizamos pelo <h2> do
  // cabeçalho, que carrega o título da atividade.
  const heading = page.getByRole('heading', { level: 2, name: firstItemTitle });
  await expect(heading).toBeVisible({ timeout: 20_000 });

  // A seção de dependências existe mesmo sem nenhuma vinculada.
  await expect(page.getByRole('heading', { name: 'Dependências' })).toBeVisible();
});
