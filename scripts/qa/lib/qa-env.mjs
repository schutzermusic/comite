/**
 * Ambiente de QA ISOLADO — a única fonte de endereço e chave para escrita de
 * teste.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * O `.env.local` aponta para o banco hospedado, onde vive a organização real.
 * Escrita de teste ali já custou limpeza manual (ver `cleanup-contracts-v2-
 * phase6-disposable.mjs`) e deixa rastro que o `audit_logs` append-only não
 * permite apagar. Todo teste que ESCREVE lê o endereço daqui, e daqui só sai
 * endereço local: o guarda recusa qualquer host que não seja a máquina.
 *
 * O ambiente é uma pilha Supabase local (Docker, `qa/supabase`) com o esquema
 * `public` restaurado de um dump SÓ DE ESTRUTURA do banco hospedado — a
 * mesma definição que roda em produção, sem nenhum dado de negócio.
 */
import fs from 'node:fs';
import path from 'node:path';

export const QA_DIR = path.resolve('qa');
export const QA_ENV_FILE = path.join(QA_DIR, '.env.qa');
export const QA_LIVE_FILE = path.resolve('tests/.qa-live.json');

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Recusa qualquer endereço que não seja desta máquina. */
export function assertLocal(url, label) {
  let host;
  try { host = new URL(url).hostname; } catch { throw new Error(`[QA GUARD] ${label}: endereço inválido.`); }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`[QA GUARD] ${label} aponta para "${host}". Escrita de QA só acontece no ambiente local isolado.`);
  }
  return url;
}

export function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Variáveis do ambiente de QA, já conferidas pelo guarda. */
export function loadQaEnv() {
  const env = parseEnvFile(QA_ENV_FILE);
  if (!env.QA_DB_URL || !env.QA_API_URL || !env.QA_SERVICE_ROLE_KEY) {
    throw new Error(`[QA] ${QA_ENV_FILE} ausente ou incompleto — rode \`node scripts/qa/build-env.mjs\`.`);
  }
  assertLocal(env.QA_DB_URL, 'QA_DB_URL');
  assertLocal(env.QA_API_URL, 'QA_API_URL');
  return env;
}

/**
 * Variáveis para subir o APLICATIVO contra o QA. Tudo que poderia sair da
 * máquina é neutralizado: e-mail, provedores de IA e segredos de cron.
 */
export function appEnvForQa(env, port) {
  const site = `http://localhost:${port}`;
  return {
    NEXT_PUBLIC_SUPABASE_URL: env.QA_API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.QA_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.QA_SERVICE_ROLE_KEY,
    SUPABASE_DB_URL: env.QA_DB_URL,
    NEXT_PUBLIC_APP_URL: site,
    NEXT_PUBLIC_SITE_URL: site,
    NEXT_PUBLIC_PONTO_URL: site,
    APEX_JOBS_SECRET: env.QA_JOBS_SECRET,
    CRON_SECRET: env.QA_JOBS_SECRET,
    APEX_AI_ENABLED: 'false',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    RESEND_API_KEY: '',
    /*
      E-mail do aplicativo vai para o coletor LOCAL da pilha (Mailpit,
      `[local_smtp]` em qa/supabase/config.toml, porta 55424) — nunca para o
      Resend. O transporte de captura recusa por conta própria qualquer
      endereço que não seja desta máquina (src/lib/notifications/email.ts).
    */
    APEX_EMAIL_TRANSPORT: 'capture',
    EMAIL_CAPTURE_URL: assertLocal('http://127.0.0.1:55424', 'EMAIL_CAPTURE_URL'),
    APEX_QA_ENVIRONMENT: '1',
  };
}
