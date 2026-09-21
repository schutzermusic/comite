/**
 * Aplica a migration 183 — decisão financeira canônica do módulo de Projetos.
 *
 * Compõe permissões que já existem (005) numa função só e faz o evento de
 * medição perguntar a ela em vez de perguntar a `contracts.view_values`.
 * Não cria permissão, não concede nada, não muda RLS de linha.
 *
 * Uso: node scripts/apply-project-financial-visibility.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '183_project_financial_visibility.sql';
const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');
  const sql = fs.readFileSync(`supabase/migrations/${FILE}`, 'utf8')
    .replace(/^BEGIN;$/m, '-- BEGIN (controlado pelo script)')
    .replace(/^COMMIT;$/m, '-- COMMIT (controlado pelo script)');
  await client.query(sql);
  console.log('✓', FILE);

  const fn = await client.query(`
    SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='current_user_can_view_project_financials'`);
  if (fn.rows[0].n !== 1) throw new Error('função canônica ausente');
  console.log('  current_user_can_view_project_financials ✓');

  // Nenhuma permissão nova pode ter sido criada.
  const perms = await client.query(`SELECT count(*)::int AS n FROM public.permissions`);
  console.log('  permissions no catálogo:', perms.rows[0].n, '(inalterado)');

  const states = await client.query(`
    SELECT link_state, count(*)::int n FROM public.project_schedule_contract_events
     GROUP BY 1 ORDER BY 1`);
  for (const r of states.rows) console.log(`    ${r.link_state}: ${r.n}`);

  const events = await client.query('SELECT count(*)::int AS n FROM public.contract_billing_events');
  console.log('  contract_billing_events:', events.rows[0].n, '(inalterado pela 183)');

  if (apply) { await client.query('COMMIT'); console.log('\nAPLICADA.'); }
  else { await client.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Rode com --apply.'); }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally { await client.end(); }
