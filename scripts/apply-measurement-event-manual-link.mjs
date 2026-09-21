/**
 * Aplica a migration 185 — vínculo MANUAL marco↔etapa.
 *
 * Acrescenta um caminho humano até `accepted` (mesma tabela, mesmos CHECKs,
 * mesma permissão do fluxo de revisão) e passa a garantir UM vínculo aceito
 * por regra e projeto nos dois caminhos de escrita.
 *
 * Uso: node scripts/apply-measurement-event-manual-link.mjs [--apply]
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('BEGIN');
  const sql = fs.readFileSync('supabase/migrations/185_measurement_event_manual_link.sql', 'utf8')
    .replace(/^BEGIN;$/m, '--').replace(/^COMMIT;$/m, '--');
  await client.query(sql);
  console.log('✓ 185_measurement_event_manual_link.sql');

  const fns = await client.query(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'contract_measurement_rule_timeline_link',
       'contract_measurement_rule_timeline_review') ORDER BY 1`);
  console.table(fns.rows);

  // Service role não pode criar vínculo aceito: sem auth.uid(), recusa.
  // A recusa aborta a transação, então a sonda roda dentro de um savepoint.
  await client.query('SAVEPOINT probe');
  try {
    await client.query(`select public.contract_measurement_rule_timeline_link(
      (select id from contract_measurement_requirements limit 1),
      (select id from project_timeline_items where is_active limit 1))`);
    throw new Error('FALHA DE GOVERNANÇA: vinculou sem usuário autenticado');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    if (String(e.message).includes('FALHA DE GOVERNANÇA')) throw e;
    console.log('  vínculo sem usuário RECUSADO ✓ —', e.message.split('\n')[0]);
  }

  const events = await client.query('SELECT count(*)::int AS n FROM public.contract_billing_events');
  console.log('  contract_billing_events:', events.rows[0].n, '(inalterado pela 185)');

  if (apply) { await client.query('COMMIT'); console.log('\nAPLICADA.'); }
  else { await client.query('ROLLBACK'); console.log('\nENSAIO — desfeito.'); }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally { await client.end(); }
