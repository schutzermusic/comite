/**
 * Aplica as migrations 179 e 180 — PLANEJAMENTO MENSAL DE FATURAMENTO.
 *
 * As duas são ADITIVAS: criam uma visão, quatro tabelas novas, funções novas e
 * um gatilho novo. Nenhuma tabela existente perde coluna, nenhum dado é
 * reescrito e nenhum objeto anterior é derrubado.
 *
 * O único ponto que toca superfície quente é o gatilho
 * `trg_billing_schedule_reprogramming` em `project_timeline_items`: ele dispara
 * apenas quando `planned_finish`/`forecast_finish` mudam E existe mapeamento
 * GOVERNADO para aquela etapa — nos demais UPDATEs ele retorna na primeira
 * linha, sem tocar em nada.
 *
 * Uso:  node scripts/apply-billing-month-planning.mjs [--apply]
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

const FILES = [
  '179_billing_month_planning.sql',
  '180_billing_month_planning_functions.sql',
];

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query('BEGIN');

  for (const f of FILES) {
    const sql = fs.readFileSync(`supabase/migrations/${f}`, 'utf8')
      // As migrations trazem o próprio BEGIN/COMMIT; aqui a transação é nossa,
      // para que o ensaio possa desfazer as duas juntas.
      .replace(/^BEGIN;$/m, '-- BEGIN (controlado pelo script)')
      .replace(/^COMMIT;$/m, '-- COMMIT (controlado pelo script)');
    await client.query(sql);
    console.log('✓', f);
  }

  // ── Conferências antes de confirmar ───────────────────────────────────
  const view = await client.query(`
    SELECT count(*)::int AS n FROM public.contract_billing_month_plan`);
  console.log('  contract_billing_month_plan:', view.rows[0].n, 'linha(s)');

  const objects = await client.query(`
    SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('contract_billing_month_plan',
                         'contract_billing_schedule_reprogrammings',
                         'contract_billing_alert_policies',
                         'contract_billing_milestone_alerts',
                         'contract_billing_alert_dispatches')
     ORDER BY c.relname`);
  for (const r of objects.rows) {
    console.log(`  ${r.relkind === 'v' ? 'visão ' : 'tabela'} ${r.relname}`);
  }

  const fns = await client.query(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname IN (
       'contract_billing_alerts_materialize',
       'contract_billing_alert_recipients',
       'contract_billing_alert_record_dispatch',
       'contract_billing_propose_timeline_mapping',
       'contract_measurement_rule_timeline_review',
       'contract_billing_alert_policy_declare',
       'contract_billing_record_schedule_reprogramming')
     ORDER BY p.proname`);
  console.log('  funções:', fns.rows.length);

  const trg = await client.query(`
    SELECT tgname FROM pg_trigger
     WHERE tgname = 'trg_billing_schedule_reprogramming' AND NOT tgisinternal`);
  console.log('  gatilho de reprogramação:', trg.rowCount ? 'instalado' : 'AUSENTE');

  // A RLS precisa estar LIGADA nas quatro tabelas novas antes de confirmar:
  // tabela nova sem RLS num schema multi-inquilino é vazamento, não pendência.
  const rls = await client.query(`
    SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relname IN (
       'contract_billing_schedule_reprogrammings','contract_billing_alert_policies',
       'contract_billing_milestone_alerts','contract_billing_alert_dispatches')`);
  const semRls = rls.rows.filter((r) => !r.relrowsecurity);
  if (semRls.length) {
    throw new Error(`RLS desligada em: ${semRls.map((r) => r.relname).join(', ')}`);
  }
  console.log('  RLS ligada nas 4 tabelas novas');

  if (apply) {
    await client.query('COMMIT');
    console.log('\nAPLICADO.');
    // PostgREST guarda o schema em cache. Sem este aviso, a API continua
    // respondendo "Could not find the table in the schema cache" mesmo com a
    // visão já existindo no banco.
    await client.query(`NOTIFY pgrst, 'reload schema'`);
    console.log('Cache de schema do PostgREST: recarga solicitada.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nENSAIO — desfeito. Rode com --apply para aplicar.');
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
