/**
 * Fase 7 — correção final: aplica exclusivamente a migration 144.
 *
 *   node scripts/apply-contracts-v2-phase7-final-correction.mjs
 *   node scripts/apply-contracts-v2-phase7-final-correction.mjs --apply
 *
 * As asserções vivem num SAVEPOINT e são desfeitas antes do COMMIT: a
 * migration persiste, o mundo descartável e suas concessões não.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';
import { runPhase7CorrectionAssertions } from './lib/phase7-correction-assertions.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const VERSION = '144';
const NAME = 'release_capability_policy_selection';
const FILE = `supabase/migrations/${VERSION}_${NAME}.sql`;
const c = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');

let ok = true;
const must = (label, pass, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async (sql, params) => (await c.query(sql, params)).rows[0];

try {
  console.log('=== PORTÃO PRÉ-APLICAÇÃO 144 ===');
  const tip = (await one(
    `SELECT version FROM supabase_migrations.schema_migrations
      ORDER BY version::int DESC LIMIT 1`)).version;
  must('ponta do registro é 143', tip === '143', tip);
  must('autoridades continuam ZERO antes da conversão',
    (await one(`SELECT count(*)::int n FROM contract_billing_release_authorities`)).n === 0);
  must('144 ainda não registrada',
    (await one(`SELECT count(*)::int n FROM supabase_migrations.schema_migrations WHERE version=$1`,
      [VERSION])).n === 0);
  must('TRUNCATE de navegador é ZERO',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_schema='public' AND privilege_type='TRUNCATE'
                   AND grantee IN ('anon','authenticated')`)).n === 0);

  const files = readdirSync('supabase/migrations')
    .filter((f) => /^\d{3}_.*\.sql$/.test(f)).map((f) => f.slice(0, 3)).sort();
  const beforeProblems = await assertRegistryMatches(c, {
    files: files.filter((v) => v !== VERSION), expectedAbsent: ['090'],
  });
  must('registro 001–143 consistente com o diretório', beforeProblems.length === 0,
    beforeProblems.join('; '));
  if (!ok) throw new Error('portão pré-aplicação vermelho');

  const baseline = await one(
    `SELECT (SELECT count(*)::int FROM organizations) orgs,
            (SELECT count(*)::int FROM auth.users) users,
            (SELECT count(*)::int FROM contract_billing_release_authorities) authorities,
            (SELECT count(*)::int FROM contract_billing_events) billing`);

  console.log('\n=== APLICAÇÃO 144 ===');
  await c.query('BEGIN');
  const sql = readFileSync(FILE, 'utf8')
    .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
  await c.query(sql);
  await recordMigrationApplied(c, VERSION, NAME);
  must('144 aplicada e registrada', true);

  console.log('\n=== ASSERÇÕES PERMANENTES DA CORREÇÃO ===');
  await c.query('SAVEPOINT phase7_final_assertions');
  const battery = await runPhase7CorrectionAssertions(c, { must, one });
  if (!battery) ok = false;
  await c.query('ROLLBACK TO SAVEPOINT phase7_final_assertions');
  await c.query('RELEASE SAVEPOINT phase7_final_assertions');

  console.log('\n=== PORTÃO PÓS-APLICAÇÃO ===');
  const after = await one(
    `SELECT (SELECT count(*)::int FROM organizations) orgs,
            (SELECT count(*)::int FROM auth.users) users,
            (SELECT count(*)::int FROM contract_billing_release_authorities) authorities,
            (SELECT count(*)::int FROM contract_billing_events) billing`);
  must('asserções deixaram resíduo ZERO', JSON.stringify(after) === JSON.stringify(baseline),
    `${JSON.stringify(baseline)} → ${JSON.stringify(after)}`);
  must('DML direto de navegador revogado',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_schema='public'
                   AND table_name='contract_billing_release_authorities'
                   AND privilege_type IN ('INSERT','UPDATE','DELETE')
                   AND grantee IN ('anon','authenticated')`)).n === 0);
  must('amount_scope e declared_by são obrigatórios e sem default',
    (await one(`SELECT count(*)::int n FROM information_schema.columns
                 WHERE table_schema='public'
                   AND table_name='contract_billing_release_authorities'
                   AND column_name IN ('amount_scope','declared_by')
                   AND is_nullable='NO' AND column_default IS NULL`)).n === 2);
  must('registro descreve o diretório com 144',
    (await assertRegistryMatches(c, { files, expectedAbsent: ['090'] })).length === 0);
  must('TRUNCATE de navegador continua ZERO',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_schema='public' AND privilege_type='TRUNCATE'
                   AND grantee IN ('anon','authenticated')`)).n === 0);

  if (APPLY && ok) {
    await c.query('COMMIT');
    console.log('\n### COMETIDO: somente migration 144 ###');
  } else {
    await c.query('ROLLBACK');
    console.log(APPLY ? '\n### ROLLBACK: bateria vermelha ###' : '\n### ROLLBACK (ensaio) ###');
  }
} catch (e) {
  ok = false;
  try { await c.query('ROLLBACK'); } catch { /* transação já encerrada */ }
  console.error('\nFALHA:', e.message);
} finally {
  await c.end();
}

console.log(ok ? 'VERDE' : 'VERMELHO');
process.exit(ok ? 0 : 1);
