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
import pg from 'pg';
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
const started = run(['start']);
if (started !== 0) process.exit(started);

/*
  O QA é reconstruído com DROP SCHEMA public CASCADE: milhares de objetos numa
  transação só. O padrão do Postgres (64 travas por transação) não comporta;
  o banco local sobe com 4096 (uma vez — `ALTER SYSTEM` persiste no volume).
*/
const db = new pg.Client({ connectionString: 'postgresql://supabase_admin:postgres@127.0.0.1:55422/postgres' });
await db.connect();
const current = Number((await db.query('SHOW max_locks_per_transaction')).rows[0].max_locks_per_transaction);
if (current < 4096) {
  await db.query('ALTER SYSTEM SET max_locks_per_transaction = 4096');
  await db.end();
  spawnSync('docker', ['restart', 'supabase_db_apex-qa'], { stdio: 'inherit' });
  console.log('max_locks_per_transaction → 4096 (banco reiniciado)');
} else {
  await db.end();
}
