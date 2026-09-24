/**
 * Serve o aplicativo apontado para o QA ISOLADO (build de produção).
 *
 *   node scripts/qa/serve.mjs            # compila se preciso e sobe em :9102
 *   node scripts/qa/serve.mjs --build    # força recompilar
 *   node scripts/qa/serve.mjs --build-only
 *   node scripts/qa/serve.mjs --dev      # `next dev` em :9103, contra o MESMO QA
 *
 * Build de produção, e não `next dev`: o servidor de desenvolvimento compila
 * rota sob demanda e satura quando vários specs rodam juntos — a prova viva
 * precisa de um servidor que responda como o de produção responde. O `--dev`
 * existe só para iterar interface sem recompilar tudo (dist separado).
 *
 * Tudo que sairia da máquina é neutralizado em `appEnvForQa` (IA, e-mail,
 * cron), e o endereço do Supabase é o local — o guarda recusa outro.
 */
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { loadQaEnv, appEnvForQa } from './lib/qa-env.mjs';

const qa = loadQaEnv();
const DEV = process.argv.includes('--dev');
const port = DEV ? '9103' : (qa.QA_APP_PORT || '9102');
const DIST = DEV ? '.next-qa-dev' : '.next-qa';
const env = {
  ...process.env, ...appEnvForQa(qa, port), NEXT_DIST_DIR: DIST,
  NODE_ENV: DEV ? 'development' : 'production', NEXT_TELEMETRY_DISABLED: '1',
};

function run(args, label) {
  console.log(label);
  const child = spawn('npx', ['next', ...args, '-p', port], { env, stdio: 'inherit' });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (DEV) {
  run(['dev', '--turbopack'], `▸ next dev :${port} (QA isolado, ${DIST})`);
} else {
  const mustBuild = process.argv.includes('--build') || process.argv.includes('--build-only') || !fs.existsSync(`${DIST}/BUILD_ID`);
  if (mustBuild) {
    console.log(`▸ next build → ${DIST} (Supabase ${qa.QA_API_URL})`);
    const r = spawnSync('npx', ['next', 'build'], { env, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  if (process.argv.includes('--build-only')) process.exit(0);
  run(['start'], `▸ next start :${port} (QA isolado)`);
}
