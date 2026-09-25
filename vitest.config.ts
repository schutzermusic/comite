import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Três projetos, três fronteiras:
 *
 *   unit         tests/unit — HERMÉTICO por construção (tests/unit/setup/
 *                hermetic.ts): sem credencial, sem dotenv, sem socket, sem fetch.
 *   integration  tests/integration — suítes vivas legadas (leem o ambiente).
 *   qa-db        tests/qa-db — banco de verdade SÓ no QA isolado (guarda de
 *                endereço local), cada caso em transação desfeita.
 *
 * Um caminho como `vitest run tests/unit/x.test.ts` cai no projeto `unit` e
 * herda a mesma guarda: não há jeito de rodar um teste de unidade sem ela.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    restoreMocks: true,
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], setupFiles: ['tests/unit/setup/hermetic.ts'] } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'] } },
      { extends: true, test: { name: 'qa-db', include: ['tests/qa-db/**/*.test.ts'], fileParallelism: false } },
    ],
  },
});
