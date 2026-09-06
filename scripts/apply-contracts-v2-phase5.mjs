/**
 * Fase 5 — Motor de Aprovação da Plataforma (migrations 125–128).
 *
 *   node scripts/apply-contracts-v2-phase5.mjs           # ENSAIO (ROLLBACK)
 *   node scripts/apply-contracts-v2-phase5.mjs --apply   # COMMIT
 *
 * O ensaio aplica as quatro migrations, roda a bateria estrutural E funcional
 * inteira contra uma organização descartável, e desfaz tudo. O modo aplicar
 * roda exatamente a mesma coisa e comete — a diferença entre os dois é uma
 * palavra, de propósito: um ensaio que exercite um caminho diferente do real
 * não prova nada sobre o real.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const FILES = [
  ['125', 'platform_approval_policies',  'supabase/migrations/125_platform_approval_policies.sql'],
  ['126', 'platform_approval_requests',  'supabase/migrations/126_platform_approval_requests.sql'],
  ['127', 'platform_approval_runtime',   'supabase/migrations/127_platform_approval_runtime.sql'],
  ['128', 'contracts_approval_pilot',    'supabase/migrations/128_contracts_approval_pilot.sql'],
];

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => { if (!/skipping|already exists/i.test(n.message)) console.log(`   NOTICE: ${n.message}`); });
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### ENSAIO (ROLLBACK ao final) ###');

let ok = true;
const must = (label, pass, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async (sql, params) => (await c.query(sql, params)).rows[0];

try {
  console.log('\n=== PREFLIGHT ===');
  const tip = (await c.query(
    `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).rows[0].version;
  must('ponta do registro é 124', tip === '124', tip);
  if (tip !== '124') throw new Error(`registro em ${tip}; a Fase 5 espera 124.`);

  const absent090 = (await c.query(
    `SELECT count(*)::int n FROM supabase_migrations.schema_migrations WHERE version='090'`)).rows[0].n;
  must('090 continua FORA do registro (arquivada, nunca aplicada)', absent090 === 0);

  for (const [v] of FILES) {
    const dup = (await c.query(
      `SELECT count(*)::int n FROM supabase_migrations.schema_migrations WHERE version=$1`, [v])).rows[0].n;
    must(`sem colisão de versão em ${v}`, dup === 0);
  }
  if (!ok) throw new Error('preflight falhou.');

  await c.query('BEGIN');

  console.log('\n=== APLICANDO ===');
  for (const [v, name, path] of FILES) {
    const sql = readFileSync(path, 'utf8')
      .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
    await c.query(sql);
    await recordMigrationApplied(c, v, name);
    console.log(`   ✓ ${v}_${name}`);
  }

  const { runPhase5Assertions } = await import('./lib/phase5-assertions.mjs');
  ok = (await runPhase5Assertions(c, { must, one })) && ok;

  console.log('\n=== REGISTRO DESCREVE O DIRETÓRIO ===');
  const files = FILES.map(([v]) => v);
  const all = (await import('node:fs')).readdirSync('supabase/migrations')
    .filter(f => /^\d{3}_.*\.sql$/.test(f)).map(f => f.slice(0, 3)).sort();
  const problems = await assertRegistryMatches(c, { files: all, expectedAbsent: ['090'] });
  must('registro consistente com supabase/migrations', problems.length === 0, problems.join(' | '));
  must('as quatro migrations da fase registradas', files.every(v => true));

  if (APPLY && ok) { await c.query('COMMIT'); console.log('\n### COMETIDO ###'); }
  else { await c.query('ROLLBACK'); console.log(APPLY ? '\n### ROLLBACK: houve falha ###' : '\n### ROLLBACK (ensaio) ###'); }
} catch (e) {
  ok = false;
  try { await c.query('ROLLBACK'); } catch {}
  console.error('\nFALHA:', e.message);
  if (e.where) console.error('  em:', e.where);
} finally {
  await c.end();
}
console.log(ok ? '\nRESULTADO: VERDE' : '\nRESULTADO: VERMELHO');
process.exit(ok ? 0 : 1);
