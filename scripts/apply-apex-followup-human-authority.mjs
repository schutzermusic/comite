/**
 * Runner da migration 157 — o caminho governado da autoridade humana.
 *
 * A bateria prova o que a migration existe para garantir: que a função grava
 * com privilégio de dono SEM aceitar de quem é a decisão, e que a conexão sem
 * sessão continua sem conseguir produzir autoridade humana por caminho nenhum.
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
  console.error('SUPABASE_DB_URL ausente. Migration 157 não executada.');
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
const mustReject = async (label, sql, params, fragment) => {
  await client.query('SAVEPOINT probe');
  try {
    await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT probe');
    must(label, false, 'a operação foi aceita');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT probe');
    must(label, String(error.message).includes(fragment), String(error.message).slice(0, 110));
  }
};

try {
  await client.connect();
  await client.query('SET SESSION default_transaction_read_only = off');

  const tip = (await one(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1')).version;
  must('ponta do registro é 156', tip === '156', String(tip));
  if (tip !== '156') throw new Error(`ponta inesperada: ${tip}`);

  await client.query('BEGIN');
  await client.query(stripTransaction(readFileSync(
    'supabase/migrations/157_apex_followup_human_authority.sql', 'utf8')));
  await recordMigrationApplied(client, '157', 'apex_followup_human_authority');

  console.log('\n── as três funções existem e são SECURITY DEFINER ──');
  for (const name of ['apex_followup_assign', 'apex_followup_confirm_completion',
                      'contract_clause_resolve_attention']) {
    const row = await one(
      `SELECT prosecdef FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace`, [name]);
    must(`${name} presente e security definer`, row?.prosecdef === true);
  }

  console.log('\n── a autoridade não é parâmetro ──');
  for (const name of ['apex_followup_assign', 'apex_followup_confirm_completion',
                      'contract_clause_resolve_attention']) {
    const args = (await one(
      `SELECT pg_get_function_arguments(oid) a FROM pg_proc
        WHERE proname=$1 AND pronamespace='public'::regnamespace`, [name])).a;
    must(`${name} não aceita carimbo de usuário`,
      !/assigned_by|verified_by|resolved_by|p_user_id|p_actor/.test(args), args.slice(0, 90));
  }

  console.log('\n── privilégios ──');
  for (const [name, sig] of [
    ['apex_followup_assign', 'uuid,uuid,uuid,text,date,integer,text'],
    ['apex_followup_confirm_completion', 'uuid,text'],
    ['contract_clause_resolve_attention', 'uuid,text,text'],
  ]) {
    must(`${name} executável por authenticated`,
      (await one(`SELECT has_function_privilege('authenticated', 'public.${name}(${sig})', 'EXECUTE') p`)).p === true);
    must(`${name} NÃO executável por anon`,
      (await one(`SELECT has_function_privilege('anon', 'public.${name}(${sig})', 'EXECUTE') p`)).p === false);
  }
  must('anon perdeu SELECT em apex_followups',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_name='apex_followups' AND grantee='anon' AND privilege_type='SELECT'`)).n === 0);

  console.log('\n── sem sessão, nada de autoridade ──');
  await mustReject('designação recusada sem sessão',
    `SELECT public.apex_followup_assign(gen_random_uuid(), NULL, NULL, 'Fulano')`, [],
    'sessão autenticada');
  await mustReject('conclusão humana recusada sem sessão',
    `SELECT public.apex_followup_confirm_completion(gen_random_uuid())`, [],
    'sessão autenticada');
  await mustReject('decisão sobre interpretação recusada sem sessão',
    `SELECT public.contract_clause_resolve_attention(gen_random_uuid(), 'confirm')`, [],
    'sessão autenticada');

  if (!ok) throw new Error('bateria da migration 157 reprovada');

  if (apply) {
    await client.query('COMMIT');
    console.log('\n=== MIGRATION 157 COMETIDA E REGISTRADA ===');
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
