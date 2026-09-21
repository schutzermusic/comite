/**
 * Aplica a migration 182 — portão de VALOR nos eventos de medição.
 *
 * Só RETIRA visibilidade. Recria `project_schedule_contract_events` com as
 * colunas monetárias atrás de `contracts.view_values` / `finance.view` /
 * admin, e acrescenta `can_view_values` e `generates_billing`.
 *
 * Uso:  node scripts/apply-project-schedule-contract-events-value-gate.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '182_project_schedule_contract_events_value_gate.sql';
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
    SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_schema='public' AND table_name='project_schedule_contract_events'
       AND column_name IN ('can_view_values','generates_billing')`);
  if (cols.rows[0].n !== 2) throw new Error('colunas de portão ausentes');
  console.log('  can_view_values + generates_billing ✓');

  const rows = await client.query(`
    SELECT link_state, count(*)::int n
      FROM public.project_schedule_contract_events GROUP BY 1 ORDER BY 1`);
  for (const r of rows.rows) console.log(`    ${r.link_state}: ${r.n}`);

  const grants = await client.query(`
    SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='project_schedule_contract_events'
       AND grantee IN ('authenticated','anon') ORDER BY grantee, privilege_type`);
  console.log('  grants:', grants.rows.map((g) => `${g.grantee}:${g.privilege_type}`).join(' ') || '(nenhum)');

  const events = await client.query('SELECT count(*)::int AS n FROM public.contract_billing_events');
  console.log('  contract_billing_events:', events.rows[0].n, '(inalterado pela 182)');

  if (apply) { await client.query('COMMIT'); console.log('\nAPLICADA.'); }
  else { await client.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Rode com --apply.'); }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally { await client.end(); }
