/**
 * Credenciais dos specs de tela de Operações e Supply.
 *
 * Por padrão, o usuário QA do inquilino real (`tests/.qa-env.json`) — os specs
 * interceptam toda escrita. Com `E2E_TARGET=qa-live` (o que o
 * `playwright.e2e-qa.config.ts` define), o titular do QA ISOLADO
 * (`tests/.qa-live.json`): mesmas telas, dados de cenário realista, e nenhum
 * byte lido ou escrito no inquilino real.
 */
import { readFileSync } from 'node:fs';
import type { ClientConfig } from 'pg';

export interface E2eCredentials { email: string; password: string; orgId: string }

export function e2eCredentials(): E2eCredentials {
  if (process.env.E2E_TARGET === 'qa-live') {
    const live = JSON.parse(readFileSync('tests/.qa-live.json', 'utf8')) as {
      password: string; organization: { id: string }; users: Record<string, { email: string }>;
    };
    return { email: live.users.owner.email, password: live.password, orgId: live.organization.id };
  }
  return JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')) as E2eCredentials;
}

export const onIsolatedQa = () => process.env.E2E_TARGET === 'qa-live';

/**
 * Conexão de LEITURA dos specs (sempre dentro de `BEGIN TRANSACTION READ ONLY`):
 * no QA isolado, o banco local (`qa/.env.qa`, sem TLS); fora dele, o do
 * inquilino real (`SUPABASE_DB_URL`).
 */
export function e2eDbConfig(): ClientConfig {
  if (onIsolatedQa()) {
    const env = Object.fromEntries(readFileSync('qa/.env.qa', 'utf8').split('\n')
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
      .map((m) => [m![1], m![2].replace(/^['"]|['"]$/g, '')]));
    const url = String(env.QA_DB_URL ?? '');
    if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error('QA_DB_URL não é local — o QA isolado recusa.');
    return { connectionString: url, ssl: false };
  }
  return { connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } };
}
