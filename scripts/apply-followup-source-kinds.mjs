/** Aplica e registra a migration 206 (autoridade única do vocabulário de origem). */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const EXPECTED = [
  'contract', 'contract_clause', 'contract_obligation_instance', 'contract_billing_condition',
  'contract_risk', 'contract_guarantee', 'contract_insurance_requirement',
  'commercial_opportunity', 'commercial_proposal', 'commercial_engagement', 'internal_service_order',
];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('206_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '206', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const kinds = (await db.query('SELECT public.apex_followup_source_kinds() k')).rows[0].k;
  for (const kind of EXPECTED) if (!kinds.includes(kind)) failures.push(`papel ausente: ${kind}`);
  if (kinds.length !== EXPECTED.length) failures.push(`esperava ${EXPECTED.length}, encontrei ${kinds.length}`);

  const checks = await db.query(`
    SELECT conname FROM pg_constraint
     WHERE conrelid='public.apex_followups'::regclass AND contype='c'
       AND pg_get_constraintdef(oid) ILIKE '%source_kind%'`);
  const names = checks.rows.map((r) => r.conname);
  if (names.length !== 1 || names[0] !== 'af_source_kind') {
    failures.push(`constraint de origem deveria ser só af_source_kind, encontrei: ${names.join(', ')}`);
  }

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log(`Vocabulário único: ${kinds.length} papéis, cobrados por af_source_kind apenas.`);

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 206 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
