import { defineConfig, devices } from '@playwright/test';

/**
 * Provas VIVAS contra o QA isolado (`scripts/qa`): escritas reais do navegador
 * e da API no banco local — nunca no inquilino real (o guarda do global-setup
 * recusa qualquer endereço que não seja desta máquina).
 *
 *   npm run qa:up && npm run qa:build     # pilha + esquema de produção + semeadura
 *   npx playwright test -c playwright.qa.config.ts
 *
 * Servidor: build de PRODUÇÃO do app apontado para o QA (`scripts/qa/serve.mjs`)
 * — o `next dev` compila rota sob demanda e satura com vários specs.
 * Um trabalhador: as provas de concorrência controlam a própria sobreposição,
 * e os cenários compartilham o mesmo inquilino.
 */
export default defineConfig({
  testDir: './tests/qa-live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  globalSetup: './tests/qa-live/global-setup.ts',
  use: {
    baseURL: process.env.QA_APP_URL ?? 'http://localhost:9102',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'api', testMatch: /(concurrency|roles-api|evidence|approvals|intelligence)\.spec\.ts$/ },
    {
      name: 'desktop', testMatch: /(golden-path|roles-ui|visual)\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', testMatch: /(receiving-mobile|visual-mobile)\.spec\.ts$/, use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/qa/serve.mjs',
    url: 'http://localhost:9102/login',
    reuseExistingServer: true,
    timeout: 900_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
