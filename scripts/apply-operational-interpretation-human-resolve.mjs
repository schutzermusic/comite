/**
 * Aplica a migration 188 — Aceitar / descartar interpretação operacional.
 *
 * Uso: node scripts/apply-operational-interpretation-human-resolve.mjs [--apply]
 *      Sem --apply, ensaia dentro de uma transação e desfaz.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '188_operational_interpretation_human_resolve.sql';

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');

  const sql = fs.readFileSync(`supabase/migrations/${FILE}`, 'utf8')
    .replace(/^BEGIN;$/m, '-- BEGIN (controlado pelo script)')
    .replace(/^COMMIT;$/m, '-- COMMIT (controlado pelo script)');
  await client.query(sql);
  console.log('✓', FILE);

  const cols = await client.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'contract_operational_interpretations'
       AND column_name IN (
         'human_decision', 'attention_resolved_by',
         'attention_resolved_at', 'attention_resolution_note')
     ORDER BY 1`);
  console.log('  colunas:', cols.rows.map((r) => r.column_name).join(', '));

  const fn = await client.query(`
    SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'contract_operational_interpretation_resolve'`);
  if (fn.rows.length !== 1) throw new Error('RPC resolve ausente');
  console.log('  RPC resolve(', fn.rows[0].args, ') ✓');

  const trust = await client.query(`
    SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'public.contract_operational_interpretations'::regclass
       AND conname = 'contract_operational_interpretations_trust_state_check'`);
  if (!trust.rows[0]?.def?.includes('dismissed')) {
    throw new Error('CHECK trust_state sem dismissed');
  }
  console.log('  trust_state inclui dismissed ✓');

  // Sem sessão autenticada, a RPC deve recusar.
  await client.query('SAVEPOINT probe');
  try {
    await client.query(`
      SELECT public.contract_operational_interpretation_resolve(
        (SELECT id FROM public.contract_operational_interpretations
          WHERE trust_state = 'requires_attention' LIMIT 1),
        'confirm', NULL)`);
    throw new Error('FALHA DE GOVERNANÇA: resolveu sem usuário autenticado');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    if (String(e.message).includes('FALHA DE GOVERNANÇA')) throw e;
    console.log('  resolve sem usuário RECUSADO ✓ —', String(e.message).split('\n')[0]);
  }

  if (apply) {
    await client.query('COMMIT');
    console.log('\nAPLICADA.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nENSAIO — desfeito.');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
