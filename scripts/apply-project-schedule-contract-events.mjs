/**
 * Aplica a migration 181 — EVENTOS DE MEDIÇÃO NO CRONOGRAMA DO PROJETO.
 *
 * ADITIVA. Acrescenta uma coluna com DEFAULT vazio, um CHECK que só restringe
 * o que já era impossível na prática, um índice, uma visão nova e um parâmetro
 * novo (com DEFAULT) na função de proposta. Nenhuma tabela perde coluna,
 * nenhum dado é reescrito.
 *
 * O ponto que merece atenção é o DROP da assinatura antiga de
 * `contract_billing_propose_timeline_mapping` (7 argumentos): sem ele, a nova
 * assinatura viraria SOBRECARGA e a chamada de 7 argumentos ficaria ambígua.
 * O único chamador do produto é `propose-mappings-server.ts`, que passa a
 * chamar a assinatura de 8.
 *
 * Uso:  node scripts/apply-project-schedule-contract-events.mjs [--apply]
 *       Sem --apply, ensaia dentro de uma transação e desfaz.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const FILE = '181_project_schedule_contract_events.sql';

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');

  const sql = fs.readFileSync(`supabase/migrations/${FILE}`, 'utf8')
    .replace(/^BEGIN;$/m, '-- BEGIN (controlado pelo script)')
    .replace(/^COMMIT;$/m, '-- COMMIT (controlado pelo script)');
  await client.query(sql);
  console.log('✓', FILE);

  // ── Conferências antes de confirmar ─────────────────────────────────────
  const view = await client.query(
    'SELECT count(*)::int AS n FROM public.project_schedule_contract_events');
  console.log('  project_schedule_contract_events:', view.rows[0].n, 'linha(s)');

  const states = await client.query(`
    SELECT link_state, count(*)::int AS n
      FROM public.project_schedule_contract_events
     GROUP BY link_state ORDER BY link_state`);
  for (const r of states.rows) console.log(`    ${r.link_state}: ${r.n}`);

  // A assinatura de 7 argumentos NÃO pode ter sobrevivido: duas sobrecargas
  // tornariam a chamada ambígua em tempo de execução.
  const overloads = await client.query(`
    SELECT count(*)::int AS n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'contract_billing_propose_timeline_mapping'`);
  if (overloads.rows[0].n !== 1) {
    throw new Error(`contract_billing_propose_timeline_mapping tem ${overloads.rows[0].n} assinaturas — esperado 1.`);
  }
  console.log('  contract_billing_propose_timeline_mapping: 1 assinatura ✓');

  // Nenhum privilégio novo: a visão é security_invoker e authenticated só lê.
  const grants = await client.query(`
    SELECT grantee, privilege_type
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = 'project_schedule_contract_events'
     ORDER BY grantee, privilege_type`);
  console.log('  grants:', grants.rows.map((g) => `${g.grantee}:${g.privilege_type}`).join(' '));

  // Esta migration não pode ter criado faturamento.
  const events = await client.query(
    'SELECT count(*)::int AS n FROM public.contract_billing_events');
  console.log('  contract_billing_events:', events.rows[0].n, '(inalterado pela 181)');

  if (apply) {
    await client.query('COMMIT');
    console.log('\nAPLICADA.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nENSAIO — desfeito. Rode com --apply para gravar.');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
