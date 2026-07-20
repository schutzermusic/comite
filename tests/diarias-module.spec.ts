/**
 * E2E — módulo Diárias de Campo (Fases 1–5).
 * Pré-requisitos:
 *   1. node scripts/qa-seed-workforce.mjs
 *   2. node scripts/qa-seed-diarias.mjs
 *   3. servidor em http://localhost:9002 (playwright sobe via webServer)
 * Rodar: npx playwright test tests/diarias-module.spec.ts --project=chromium
 *
 * Percorre: política → prévia (Fase 1) → aprovação com segregação de
 * funções (Fase 2) → lote + exportação (Fase 3) → conciliação (Fase 4)
 * → inteligência (Fase 5), além das abas Operação do dia e Exceções e
 * do modal de nova política.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const qa = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8'));

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const now = new Date();
const untilMon = ((8 - now.getDay()) % 7) || 7;
const weekStartDate = new Date(now);
weekStartDate.setDate(now.getDate() + untilMon);
const WEEK_START = iso(weekStartDate);

/** Zera generated_by da semana-alvo (simula gerador ≠ aprovador). */
async function clearGenerator(): Promise<void> {
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(
      `update allowance_weeks set generated_by = null
        where organization_id = $1 and week_start = $2 and simulation_mode = true`,
      [qa.orgId, WEEK_START],
    );
  } finally {
    await client.end();
  }
}

async function validateMissingResidence(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(
      `insert into person_residence_municipalities
        (organization_id, person_id, municipality_code, municipality_name, state_code,
         valid_from, source, status, verified_by, verified_at)
       select $1, p.id, '4113700', 'Londrina', 'PR', current_date,
              'hr_registration', 'validated', pr.user_id, now()
       from people p
       join profiles pr on pr.organization_id = p.organization_id and pr.user_id is not null
       where p.organization_id = $1 and p.full_name = 'QA Diárias Sem Município'
       limit 1`,
      [qa.orgId],
    );
  } finally {
    await client.end();
  }
}

const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const toast = (page: Page, re: RegExp, timeout = 20_000) =>
  expect(page.getByText(re).first()).toBeVisible({ timeout });

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

test('Diárias de Campo — fluxo ponta a ponta (Fases 1–5)', async ({ page }) => {
  page.setDefaultTimeout(25_000);

  await test.step('login', async () => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(qa.email);
    await page.locator('input[type="password"]').fill(qa.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  });

  await test.step('abre o módulo Diárias', async () => {
    await page.goto('/workforce-cost/diarias');
    await expect(page.getByRole('heading', { name: 'Diárias de Campo' })).toBeVisible({
      timeout: 40_000,
    });
  });

  await test.step('Políticas — QA Diária ativa', async () => {
    await tab(page, 'Políticas').click();
    await expect(page.getByText('QA Diária').first()).toBeVisible();
    await expect(page.getByText('Ativa').first()).toBeVisible();
  });

  await test.step('Políticas — modal de nova política não fica quebrado', async () => {
    await page.getByRole('button', { name: 'Nova política' }).click();
    await expect(page.getByRole('heading', { name: 'Nova política de diária' })).toBeVisible();
    await expect(page.getByText('Nome da política')).toBeVisible();
    await expect(page.getByText('Valor da diária')).toBeVisible();
    await expect(page.getByText('Modo de escala')).toBeVisible();
    // o select de projeto não deve ficar preso no placeholder vazio
    const projSelect = page.locator('div:has(> label:text-is("Projeto")) select').first();
    await expect(projSelect).toHaveValue('__all__');
    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  await test.step('Fase 1 — gerar prévia semanal', async () => {
    const previewToast = /Pr[ée]via gerada \(v\d+\) — \d+ diárias/;
    await tab(page, 'Planejamento semanal').click();
    await page.getByRole('button', { name: /Gerar prévia|Recalcular prévia/ }).click();
    await toast(page, previewToast);
    await expect(page.getByText(qa.personName).first()).toBeVisible();
    await tab(page, 'Exceções').click();
    await expect(page.getByText('QA Diárias Mesma Cidade').first()).toBeVisible();
    await expect(page.getByText('Mesmo município').first()).toBeVisible();
    await expect(page.getByText('QA Diárias Sem Município').first()).toBeVisible();
    await expect(page.getByText('Residência não validada').first()).toBeVisible();
    await validateMissingResidence();
    await tab(page, 'Planejamento semanal').click();
    await expect(page.getByText(previewToast)).toHaveCount(0, { timeout: 10_000 });
    await page.getByRole('button', { name: /Recalcular prévia/ }).click();
    await toast(page, previewToast);
    await tab(page, 'Operação do dia').click();
    await expect(page.getByText('Deslocamento elegível').first()).toBeVisible();
    await tab(page, 'Planejamento semanal').click();
  });

  await test.step('Fase 2 — enviar para gestor, revisar, validar RH', async () => {
    const managerTransition = page.waitForResponse((response) =>
      response.request().method() === 'PATCH'
      && response.url().includes('/rest/v1/allowance_weeks')
      && (response.request().postData() ?? '').includes('manager_review'),
    );
    await page.getByRole('button', { name: 'Enviar para gestor' }).click();
    const managerResponse = await managerTransition;
    const managerBody = await managerResponse.text();
    expect(managerResponse.ok(), managerBody).toBeTruthy();
    expect(managerBody).toContain('manager_review');
    await toast(page, /Enviar para gestor — conclu/);
    await expect(page.getByRole('button', { name: 'Concluir revisão do gestor' })).toBeVisible();
    await page.getByRole('button', { name: 'Concluir revisão do gestor' }).click();
    await toast(page, /Concluir revisão do gestor — conclu/);
    await expect(page.getByRole('button', { name: 'Validar vínculo e ausências (RH)' })).toBeVisible();
    await page.getByRole('button', { name: 'Validar vínculo e ausências (RH)' }).click();
    await toast(page, /Validar vínculo e ausências \(RH\) — conclu/);
    await expect(page.getByText('RH validou')).toBeVisible();
  });

  await test.step('Fase 2 — segregação bloqueia auto-aprovação', async () => {
    await page.getByRole('button', { name: 'Aprovar lote (Financeiro)' }).click();
    await toast(page, /Segrega|não pode ser o único aprovador/);
  });

  await test.step('Fase 2 — aprovação por aprovador distinto', async () => {
    await clearGenerator();
    await page.reload();
    await page.getByRole('button', { name: 'Aprovar lote (Financeiro)' }).click();
    await toast(page, /Aprovar lote \(Financeiro\) — conclu/);
  });

  await test.step('Fase 3 — gerar lote e exportar CSV', async () => {
    await tab(page, 'Lotes de pagamento').click();
    await page.getByRole('button', { name: 'Gerar lote' }).click();
    await toast(page, /Lote .* gerado/);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/DIARIAS-.*\.csv/);
    await toast(page, /Lote exportado/);
  });

  await test.step('Fase 4 — conciliar semana', async () => {
    await tab(page, 'Histórico e conciliação').click();
    await page.getByRole('button', { name: 'Conciliar semana' }).click();
    await toast(page, /Concilia[çc][ãa]o conclu[íi]da/);
  });

  await test.step('Operação do dia — lista do dia', async () => {
    await tab(page, 'Operação do dia').click();
    await expect(page.getByText(qa.personName).first()).toBeVisible();
  });

  await test.step('Exceções — fila renderiza', async () => {
    await tab(page, 'Exceções').click();
    await expect(page.getByText(/exce[çc]/i).first()).toBeVisible();
  });

  await test.step('Fase 5 — inteligência (alertas + custo por projeto)', async () => {
    await tab(page, 'Inteligência').click();
    await expect(page.getByText('Alertas de inconsistência')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByText('Custo por projeto')).toBeVisible();
    await expect(page.getByText(/Total\s+R\$/).first()).toBeVisible();
  });

  await test.step('Exportar PDF — relatório enterprise abre', async () => {
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: /Exportar PDF/ }).click(),
    ]);
    await expect(popup.getByText('Diárias de Campo').first()).toBeVisible({ timeout: 20_000 });
    await popup.close();
  });
});
