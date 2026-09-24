/**
 * Sobe a pilha Supabase LOCAL do QA isolado (Docker).
 *
 *   node scripts/qa/up.mjs          # sobe (ou confirma que está de pé)
 *   node scripts/qa/up.mjs --stop   # derruba, sem backup do volume
 *
 * As versões dos serviços são FIXADAS aqui, e não deixadas ao padrão da CLI:
 * o QA tem de reproduzir o mesmo comportamento em qualquer máquina, e o padrão
 * muda a cada versão da CLI. A CLI lê a fixação de `qa/supabase/.temp`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { QA_DIR } from './lib/qa-env.mjs';

const PINS = {
  'postgres-version': '17.6.1.165', // mesma major/minor do banco hospedado (17.6)
  'gotrue-version': 'v2.196.0',
  'rest-version': 'v16.1',
  'storage-version': 'v1.70.3',
  'realtime-version': 'v2.129.3',
  'studio-version': '2026.08.17-sha-0c1da8f',
  'pgmeta-version': 'v0.98.0',
  'edge-runtime-version': 'v1.74.3',
};

const run = (args) => spawnSync('supabase', [...args, '--workdir', QA_DIR], { stdio: 'inherit' }).status;

if (process.argv.includes('--stop')) process.exit(run(['stop', '--no-backup']));

const temp = path.join(QA_DIR, 'supabase', '.temp');
fs.mkdirSync(temp, { recursive: true });
for (const [file, version] of Object.entries(PINS)) fs.writeFileSync(path.join(temp, file), version);
process.exit(run(['start']));
