/**
 * Runner da migration 158 — fecha a superfície DEFINER dos gatilhos.
 *
 * A bateria prova as duas metades: que ninguém alcança as funções por fora, e
 * que os gatilhos continuam funcionando. A segunda metade importa tanto quanto
 * a primeira — uma revogação que desligasse a guarda seria muito pior que a
 * exposição que ela corrige.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('SUPABASE_DB_URL ausente. Migration 158 não executada.');
  process.exit(2);
}

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
const stripTransaction = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
let ok = true;
const must = (label, condition, detail = '') => {
  console.log(`   ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

try {
  await client.connect();
  await client.query('SET SESSION default_transaction_read_only = off');

  const tip = (await one(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1')).version;
  must('ponta do registro é 157', tip === '157', String(tip));
  if (tip !== '157') throw new Error(`ponta inesperada: ${tip}`);

  await client.query('BEGIN');
  await client.query(stripTransaction(readFileSync(
    'supabase/migrations/158_definer_trigger_surface_hardening.sql', 'utf8')));
  await recordMigrationApplied(client, '158', 'definer_trigger_surface_hardening');

  console.log('\n── a superfície DEFINER fechou ──');
  const exposedAnon = await client.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
        AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
  must('nenhuma função SECURITY DEFINER alcançável por anon',
    exposedAnon.rows.length === 0, exposedAnon.rows.map((r) => r.proname).join(', '));

  const noSearchPath = await client.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND (p.proconfig IS NULL OR NOT EXISTS (
              SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%'))`);
  must('nenhuma função DEFINER alcançável pelo navegador sem search_path fixo',
    noSearchPath.rows.length === 0, noSearchPath.rows.map((r) => r.proname).join(', '));

  console.log('\n── e os gatilhos continuam guardando ──');
  const contract = await one(`SELECT id, organization_id FROM public.contracts LIMIT 1`);
  const clause = await one(`SELECT id FROM public.contract_clauses LIMIT 1`);
  const probe = async (label, sql, params, fragment) => {
    await client.query('SAVEPOINT probe');
    try {
      await client.query(sql, params);
      await client.query('ROLLBACK TO SAVEPOINT probe');
      must(label, false, 'a operação foi aceita');
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT probe');
      must(label, String(error.message).includes(fragment), String(error.message).slice(0, 90));
    }
  };
  if (clause) {
    await probe('a guarda de personificação segue ativa',
      `UPDATE public.contract_clauses SET interpretation_state='human_confirmed' WHERE id=$1`,
      [clause.id], 'GOVERNANCE VIOLATION');
  }
  if (contract) {
    await probe('a guarda de autoridade do acompanhamento segue ativa',
      `INSERT INTO public.apex_followups
         (organization_id, source_kind, source_id, contract_id, goal, responsible_text, assigned_by, assigned_at)
       VALUES ($1,'contract',$2,$2,'meta','Fulano',$3, now())`,
      [contract.organization_id, contract.id, '00000000-0000-0000-0000-000000000001'],
      'GOVERNANCE VIOLATION');

    // E a classificação por exceção continua rodando no INSERT.
    await client.query('SAVEPOINT classify');
    const doc = await one(
      `SELECT id FROM public.contract_documents WHERE contract_id=$1 LIMIT 1`, [contract.id]);
    if (doc) {
      const row = await one(
        `INSERT INTO public.contract_clauses
           (organization_id, contract_id, title, clause_type, risk_level,
            source_document_id, source_page, source_excerpt,
            ai_flagged, review_status, ai_confidence, ai_provider, ai_model)
         VALUES ($1,$2,'[158] sonda','pagamento','low',$3,1,'trecho literal suficientemente longo',
                 true,'draft',0.95,'anthropic','claude-sonnet-5')
         RETURNING interpretation_state`, [contract.organization_id, contract.id, doc.id]);
      must('a classificação por exceção segue rodando', row.interpretation_state === 'structured',
        String(row.interpretation_state));
    } else {
      console.log('   · (contrato sem documento: sonda de classificação pulada)');
    }
    await client.query('ROLLBACK TO SAVEPOINT classify');
  }

  if (!ok) throw new Error('bateria da migration 158 reprovada');

  if (apply) {
    await client.query('COMMIT');
    console.log('\n=== MIGRATION 158 COMETIDA E REGISTRADA ===');
  } else {
    await client.query('ROLLBACK');
    console.log('\n=== ENSAIO APROVADO; DESFEITO ===');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(`✗ FALHOU: ${error instanceof Error ? error.message : String(error)}`);
  ok = false;
} finally {
  await client.end().catch(() => undefined);
}

process.exit(ok ? 0 : 1);
