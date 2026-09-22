/**
 * Aplica e registra a migration 212 (etapa governada + follow-up comercial).
 *
 * As provas cobrem exatamente o que a migration promete e o que seria fácil
 * quebrar sem perceber: a etapa não pode ser escrita pelo navegador, o
 * histórico de etapa não pode ser reescrito, e a autoridade do acompanhamento
 * tem de responder "comercial" para origem comercial sem deixar de responder
 * "contratos" para origem de contrato.
 */
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

/** Governadas: o servidor executa, o navegador nunca. */
const SERVER_ONLY = ['commercial_opportunity_transition_stage', 'commercial_opportunity_upsert'];
/** Atos humanos: a sessão executa, e a própria função cobra a alçada. */
const SESSION_FUNCTIONS = [
  'apex_followup_create', 'apex_followup_transition',
  'apex_followup_assign', 'apex_followup_confirm_completion',
];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1')).rows[0]?.version;
  if (tip !== '211') throw new Error(`Esperava ponta 211, encontrei ${tip}.`);

  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('212_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '212', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];

  const privileges = await db.query(`
    SELECT p.proname,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') browser,
           has_function_privilege('service_role', p.oid, 'EXECUTE') server
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY($1)`,
    [[...SERVER_ONLY, ...SESSION_FUNCTIONS]]);
  for (const row of privileges.rows) {
    if (SERVER_ONLY.includes(row.proname)) {
      if (row.browser) failures.push(`${row.proname} executável pelo navegador`);
      if (!row.server) failures.push(`${row.proname} inacessível ao servidor`);
    } else if (!row.browser) {
      failures.push(`${row.proname} deixou de ser alcançável pela sessão humana`);
    }
  }
  for (const name of [...SERVER_ONLY, ...SESSION_FUNCTIONS]) {
    if (!privileges.rows.some((row) => row.proname === name)) failures.push(`${name} não existe`);
  }

  // O histórico de etapa é append-only, e escrita direta continua revogada.
  const writable = await db.query(`
    SELECT has_table_privilege('authenticated','public.commercial_opportunity_stage_events', $1) ok`,
    ['INSERT']);
  if (writable.rows[0]?.ok) failures.push('navegador consegue inserir evento de etapa');

  const trigger = await db.query(`
    SELECT count(*)::int n FROM pg_trigger
     WHERE tgrelid = 'public.commercial_opportunity_stage_events'::regclass
       AND tgname = 'cose_append_only' AND NOT tgisinternal`);
  if (trigger.rows[0]?.n !== 1) failures.push('gatilho append-only ausente no histórico de etapa');

  // A coluna de idade de etapa existe, não aceita nulo e já está preenchida.
  const column = await db.query(`
    SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'commercial_opportunities'
       AND column_name = 'stage_entered_at'`);
  if (column.rows[0]?.is_nullable !== 'NO') failures.push('stage_entered_at ausente ou anulável');

  // A autoridade do acompanhamento distingue o domínio da origem.
  const authority = await db.query(`
    SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'apex_followup_authority_ok'`);
  const source = authority.rows[0]?.prosrc ?? '';
  if (!source.includes('commercial.manage')) failures.push('autoridade não reconhece commercial.manage');
  if (!source.includes('contracts.edit')) failures.push('autoridade perdeu contracts.edit');

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Etapa governada, histórico append-only e alçada por domínio — provado.');

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 212 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
