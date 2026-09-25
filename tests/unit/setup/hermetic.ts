/**
 * TESTE DE UNIDADE É HERMÉTICO — POR CONSTRUÇÃO, NÃO POR CONVENÇÃO.
 *
 * Carregado pelo projeto `unit` do vitest (vitest.config.ts) antes de CADA
 * arquivo de tests/unit. Nenhum teste de unidade alcança banco, API ou
 * provedor — nem o hospedado (produção), nem o QA local:
 *
 *   1. credenciais saem do ambiente (URL de banco, chaves Supabase, segredos);
 *   2. `dotenv` não lê arquivo: `.env`/`.env.local` (que apontam para
 *      PRODUÇÃO) não repovoam o ambiente;
 *   3. todo socket é recusado ANTES de qualquer E/S (pg, fetch/undici, http);
 *   4. `fetch` global recusa — teste que precisa de rede simula (vi.stubGlobal).
 *
 * Teste que precise de banco de verdade mora em tests/qa-db (projeto `qa-db`),
 * SÓ contra o QA isolado e dentro de transação desfeita.
 */
import net from 'node:net';
import { vi } from 'vitest';

export class HermeticViolation extends Error {
  constructor(what: string) {
    super(`HERMETIC_UNIT_TEST: ${what} é proibido em teste de unidade — simule, ou mova o teste para tests/qa-db (QA isolado).`);
    this.name = 'HermeticViolation';
  }
}

// 1. Credenciais fora do ambiente.
const CREDENTIAL = /(DATABASE_URL|DB_URL|SUPABASE|SERVICE_ROLE|ANON_KEY|API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i;
for (const key of Object.keys(process.env)) {
  if (CREDENTIAL.test(key) || /^PG[A-Z]+$/.test(key)) delete process.env[key];
}

// 2. dotenv não lê arquivo nenhum.
vi.mock('dotenv', async (importOriginal) => {
  const real = await importOriginal<typeof import('dotenv')>();
  const config = () => ({ parsed: {} });
  return { ...real, config, configDotenv: config, default: { ...real, config, configDotenv: config } };
});

// 3. Nenhum socket: recusado antes da resolução de nome e de qualquer byte.
net.Socket.prototype.connect = function hermeticConnect(): never {
  throw new HermeticViolation('abrir conexão de rede (socket)');
} as typeof net.Socket.prototype.connect;

// 4. fetch global recusa (vi.stubGlobal/vi.spyOn continuam podendo simular).
globalThis.fetch = (async () => { throw new HermeticViolation('fetch de rede'); }) as typeof fetch;
