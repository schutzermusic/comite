/** Aplica e registra a migration 204 (derivação do pai na escrita). */
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

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('204_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '204', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];

  // Prova viva: uma regra de medição inserida SEM o pai passa a nascer com ele.
  const contract = (await db.query(
    `SELECT id, organization_id, engagement_id FROM public.contracts
      WHERE deleted_at IS NULL AND engagement_id IS NOT NULL LIMIT 1`)).rows[0];
  if (!contract) throw new Error('Nenhum contrato com engajamento para provar a derivação.');

  const rule = (await db.query(
    `INSERT INTO public.contract_measurement_requirements
       (organization_id, contract_id, title, effect, measurement_basis, accumulation_mode,
        aggregation_mode, cadence, source_reference)
     VALUES ($1,$2,'[PROVA 204] derivação do pai','added','UNKNOWN','UNKNOWN','UNKNOWN','UNKNOWN',
             'prova de migration')
     RETURNING engagement_id`, [contract.organization_id, contract.id])).rows[0];
  if (rule.engagement_id !== contract.engagement_id) {
    failures.push(`regra nasceu com engagement_id=${rule.engagement_id}, esperado ${contract.engagement_id}`);
  }

  const definers = await db.query(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef
       AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       AND p.proname IN ('commercial_engagement_fill_from_contract',
                         'engagement_project_links_mirror_contract')`);
  if (definers.rowCount > 0) {
    failures.push(`gatilhos SECURITY DEFINER expostos: ${definers.rows.map((r) => r.proname)}`);
  }

  const anonDefiners = await db.query(`
    SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef
       AND has_function_privilege('anon', p.oid, 'EXECUTE')`);
  if (anonDefiners.rows[0].n !== 0) {
    failures.push(`${anonDefiners.rows[0].n} função(ões) SECURITY DEFINER alcançável(is) por anon`);
  }

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Derivação do pai provada em escrita real; nenhuma SECURITY DEFINER exposta a anon.');

  /*
    A linha de prova é DESFEITA sempre — inclusive no modo --apply. Ela existe
    para provar o gatilho, não para virar uma regra de medição de mentira num
    contrato de produção. O ROLLBACK ao savepoint remove só ela.
  */
  await db.query(
    `DELETE FROM public.contract_measurement_requirements
      WHERE title = '[PROVA 204] derivação do pai'`);

  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 204 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
