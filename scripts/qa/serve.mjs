/**
 * Serve o aplicativo apontado para o QA ISOLADO (build de produção).
 *
 *   node scripts/qa/serve.mjs            # compila se preciso e sobe em :9102
 *   node scripts/qa/serve.mjs --build    # força recompilar
 *   node scripts/qa/serve.mjs --build-only
 *
 * Build de produção, e não `next dev`: o servidor de desenvolvimento compila
 * rota sob demanda e satura quando vários specs rodam juntos — a prova viva
 * precisa de um servidor que responda como o de produção responde.
 *
 * Tudo que sairia da máquina é neutralizado em `appEnvForQa` (IA, e-mail,
 * cron), e o endereço do Supabase é o local — o guarda recusa outro.
 */
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { loadQaEnv, appEnvForQa } from './lib/qa-env.mjs';

const qa = loadQaEnv();
const port = qa.QA_APP_PORT || '9102';
const DIST = '.next-qa';
const env = { ...process.env, ...appEnvForQa(qa, port), NEXT_DIST_DIR: DIST, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };

const mustBuild = process.argv.includes('--build') || process.argv.includes('--build-only') || !fs.existsSync(`${DIST}/BUILD_ID`);
if (mustBuild) {
  console.log(`▸ next build → ${DIST} (Supabase ${qa.QA_API_URL})`);
  const r = spawnSync('npx', ['next', 'build'], { env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (process.argv.includes('--build-only')) process.exit(0);

console.log(`▸ next start :${port} (QA isolado)`);
const child = spawn('npx', ['next', 'start', '-p', port], { env, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
