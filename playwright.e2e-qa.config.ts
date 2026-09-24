import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Os specs de TELA de Operações e Supply contra o QA ISOLADO (`scripts/qa`),
 * em vez do inquilino real: mesmas asserções, cenário realista
 * (`npm run qa:scenario`), escritas ainda interceptadas pelos próprios specs.
 *
 *   node scripts/qa/serve.mjs --dev      # ou o build de produção em :9102
 *   npx playwright test -c playwright.e2e-qa.config.ts
 */
process.env.E2E_TARGET = 'qa-live';

export default defineConfig({
  ...base,
  testDir: './tests',
  testMatch: /(operations|supply)-[a-z-]+\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { ...base.use, baseURL: process.env.QA_APP_URL ?? 'http://localhost:9102' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // O servidor do QA sobe à parte (`scripts/qa/serve.mjs`); o da config base é o do inquilino real.
  webServer: undefined,
});
