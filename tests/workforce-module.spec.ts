/**
 * E2E — módulo Pessoas & Custos completo (Fases 1–9).
 * Pré-requisitos:
 *   1. node scripts/qa-seed-workforce.mjs   (usuário QA + limpeza)
 *   2. servidor rodando em http://localhost:9002 (next start)
 * Rodar: npx playwright test tests/workforce-module.spec.ts --project=chromium
 *
 * Login real via /login; percorre todas as rotas do módulo exercitando
 * os fluxos principais (alocação, apontamento, ponto, governança,
 * inteligência, geofence, REP-P/AFD).
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';

type QaEnv = {
  email: string;
  password: string;
  projectId: string;
  personId: string;
  personName: string;
};

const qa: QaEnv = JSON.parse(readFileSync('tests/.qa-env.json', 'utf8'));

test.describe.configure({ mode: 'serial' });
test.setTimeout(420_000);

/** input/select dentro do wrapper cujo <label> direto tem o texto dado. */
const byLabel = (scope: Page | Locator, label: string, control: 'input' | 'select' = 'input') =>
  scope.locator(`div:has(> label:text-is("${label}")) ${control}`).first();

async function expectToast(page: Page, text: string | RegExp, timeout = 15_000) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout });
}

test('valida o módulo Pessoas & Custos ponta a ponta', async ({ page }) => {
  page.setDefaultTimeout(20_000);

  await test.step('login', async () => {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(qa.email);
    await page.locator('input[type="password"]').fill(qa.password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  });

  await test.step('pessoas — cadastro QA visível com CPF', async () => {
    await page.goto('/workforce-cost/pessoas');
    await expect(page.getByRole('heading', { name: 'Pessoas' }).first()).toBeVisible();
    await byLabel(page, 'Buscar').fill('QA Workforce');
    await expect(page.getByText(qa.personName).first()).toBeVisible();
  });

  await test.step('equipe do projeto — criar alocação 60%', async () => {
    await page.goto(`/projetos/${qa.projectId}?tab=team`);
    await page.getByRole('button', { name: 'Alocar pessoa' }).click();
    await expect(page.getByText('Alocação com vigência')).toBeVisible();
    await byLabel(page, 'Colaborador', 'select').selectOption({ label: qa.personName });
    await byLabel(page, 'Função no projeto').fill('QA Engineer');
    await byLabel(page, 'Percentual (%)').fill('60');
    await page.getByRole('button', { name: 'Alocar', exact: true }).click();
    await expectToast(page, 'Pessoa alocada');
    await expect(page.getByText(qa.personName).first()).toBeVisible();
    await expect(page.getByText('60%').first()).toBeVisible();
  });

  await test.step('apontamentos — entrada manual → enviar → auto-aprovação', async () => {
    await page.goto(`/projetos/${qa.projectId}?tab=timesheet`);
    await expect(page.getByText('Meu apontamento')).toBeVisible();
    await byLabel(page, 'Horas').fill('4');
    await byLabel(page, 'Descrição').fill('QA e2e — apontamento manual');
    await page.getByRole('button', { name: 'Adicionar rascunho' }).click();
    await expectToast(page, 'Apontamento criado como rascunho');
    await page.getByRole('button', { name: 'Consolidar e enviar' }).click();
    await expectToast(page, 'Apontamentos enviados');
    // registro limpo → aprovado automaticamente
    await expect(page.getByText(/Aprovado · auto/).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step('jornada — bater entrada e saída (NSR no banco)', async () => {
    await page.goto('/workforce-cost/jornada');
    await expect(page.getByText('Minha jornada de hoje')).toBeVisible();
    await page.getByRole('button', { name: 'Entrada', exact: true }).click();
    await expectToast(page, 'Entrada registrada');
    await page.getByRole('button', { name: 'Saída', exact: true }).click();
    await expectToast(page, 'Saída registrada');
    await expect(page.getByText('Jornadas diárias')).toBeVisible();
  });

  await test.step('aprovações — fila renderiza', async () => {
    await page.goto('/workforce-cost/aprovacoes');
    await expect(page.getByRole('heading', { name: 'Aprovações de Horas' }).first()).toBeVisible();
    await expect(
      page.getByText('Fila vazia').or(page.getByText('Registros pendentes')).first(),
    ).toBeVisible();
  });

  await test.step('capacidade — matriz mostra a pessoa QA', async () => {
    await page.goto('/workforce-cost/capacidade');
    await expect(page.getByRole('heading', { name: 'Capacidade e Alocação' }).first()).toBeVisible();
    await expect(page.getByText(qa.personName).first()).toBeVisible({ timeout: 25_000 });
  });

  await test.step('custos — página renderiza (sem folha na competência)', async () => {
    await page.goto('/workforce-cost/custos');
    await expect(page.getByRole('heading', { name: 'Custo de Mão de Obra' }).first()).toBeVisible();
    await expect(page.getByText('Snapshots da competência')).toBeVisible();
  });

  await test.step('governança — varredura classifica exceções', async () => {
    await page.goto('/workforce-cost/governanca');
    await expect(page.getByRole('heading', { name: /Governança/ }).first()).toBeVisible();
    await page.getByRole('button', { name: /Executar varredura/ }).click();
    await expectToast(page, 'Varredura concluída', 30_000);
  });

  await test.step('inteligência — forecast + simulador (+ IA soft)', async () => {
    await page.goto('/workforce-cost/inteligencia');
    await expect(page.getByRole('heading', { name: 'Inteligência de Capacidade' }).first()).toBeVisible();
    await expect(page.getByText('Forecast de capacidade', { exact: false })).toBeVisible();

    await byLabel(page, 'Necessidade (%)').fill('30');
    await page.getByRole('button', { name: 'Ranquear candidatos' }).click();
    await expect(page.getByText(qa.personName).first()).toBeVisible({ timeout: 25_000 });

    // IA: chamada real ao Anthropic — sucesso OU erro tratado, sem quebrar a página
    const aiButton = page.getByRole('button', { name: /Gerar insights/ });
    if (await aiButton.isVisible()) {
      await aiButton.click();
      const success = page.getByText('Recomendações').first();
      const failure = page.getByText('Não foi possível gerar insights de IA').first();
      try {
        await expect(success.or(failure)).toBeVisible({ timeout: 120_000 });
        const ok = await success.isVisible().catch(() => false);
        test.info().annotations.push({
          type: 'ai-insights',
          description: ok ? 'IA gerou insights com sucesso' : 'IA indisponível — erro tratado na UI',
        });
      } catch {
        test.info().annotations.push({ type: 'ai-insights', description: 'timeout aguardando IA' });
      }
    }
  });

  await test.step('geofences — criar cerca por coordenada', async () => {
    await page.goto('/workforce-cost/geofences');
    await expect(page.getByRole('heading', { name: /Geofences/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Nova cerca' }).first().click();
    await expect(page.getByText('Endereço ou coordenada')).toBeVisible();
    await byLabel(page, 'Nome da cerca').fill('QA Cerca');
    await byLabel(page, 'Latitude').fill('-19.924500');
    await byLabel(page, 'Longitude').fill('-43.935200');
    await byLabel(page, 'Raio (m)').fill('300');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expectToast(page, 'Cerca criada');
    await expect(page.getByText('QA Cerca').first()).toBeVisible();
    // globo Cesium OU fallback — ambos válidos em headless
    await expect(
      page.locator('canvas').first().or(page.getByText('Globo indisponível')),
    ).toBeVisible({ timeout: 30_000 });
  });

  await test.step('ponto oficial — configurar empregador + gerar AFD + trilha', async () => {
    await page.goto('/workforce-cost/ponto-oficial');
    await expect(page.getByRole('heading', { name: /Ponto Oficial/ }).first()).toBeVisible();

    await byLabel(page, 'Razão social').fill('QA Empresa Ltda');
    await byLabel(page, 'CNPJ').fill('12345678000199');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expectToast(page, 'Configuração salva');

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await page.getByRole('button', { name: /Gerar e baixar AFD/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^AFD_\d{14}_REP_P_.*\.txt$/);
    await expectToast(page, 'AFD gerado');

    // trilha imutável registra o arquivo
    await expect(page.getByText(/^AFD$/).first()).toBeVisible();

    // espelho de ponto abre janela de impressão
    await byLabel(page, 'Colaborador', 'select').selectOption({ label: qa.personName });
    const popupPromise = page.waitForEvent('popup', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Imprimir espelho' }).click();
    const popup = await popupPromise;
    await expect(popup.getByText('Espelho de Ponto', { exact: false })).toBeVisible();
    await popup.close();

    // comprovante por marcação (2 punches de hoje) — valida escrita na
    // trilha fiscal (2º window.open é bloqueado no chromium headless)
    await page.getByRole('button', { name: /Listar marcações/ }).click();
    await expect(page.getByText(/NSR \d+/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Comprovante' }).first().click();
    await expect(page.getByText(/^Comprovante$/).first()).toBeVisible({ timeout: 15_000 });
  });
});
