import { defineConfig, devices } from '@playwright/test';

/**
 * Leia a documentação do Playwright: https://playwright.dev/docs/test-configuration.
 * https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  /* Execute os testes em arquivos em paralelo */
  fullyParallel: true,
  /* Falhe o build no CI se você deixar test.only no código. */
  forbidOnly: !!process.env.CI,
  /* Retry no CI, mas não localmente. */
  retries: process.env.CI ? 2 : 0,
  /* Opte por não executar testes em paralelo localmente. */
  workers: process.env.CI ? 1 : undefined,
  /* Configuração compartilhada para todos os projetos abaixo. Veja https://playwright.dev/docs/api/class-testoptions. */
  reporter: 'html',
  /* Configurações compartilhadas para todos os projetos abaixo. Veja https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* URL base para usar em ações como `await page.goto('/')`. */
    baseURL: 'http://localhost:9002',
    /* Colete rastreamento quando executar novamente os testes falhos. Veja https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projetos para principais navegadores */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    /* WebKit comentado devido a erro "Bus error" em alguns sistemas macOS
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    */

    /* Teste contra dispositivos móveis. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Teste contra navegadores em modo headless. */
    // {
    //   name: 'chromium',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Execute seu servidor de desenvolvimento local antes de iniciar os testes */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:9002',
    reuseExistingServer: !process.env.CI,
  },
});

