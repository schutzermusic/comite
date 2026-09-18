/** Ensaia ou aplica e registra atomicamente a migration 178 (privilégios do local canônico). */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });
const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');

const TABLE = 'public.project_canonical_location';
const privOf = async () => (await db.query(`SELECT
  has_table_privilege('authenticated',$1,'SELECT')     a_select,
  has_table_privilege('authenticated',$1,'INSERT')     a_insert,
  has_table_privilege('authenticated',$1,'UPDATE')     a_update,
  has_table_privilege('authenticated',$1,'DELETE')     a_delete,
  has_table_privilege('authenticated',$1,'REFERENCES') a_references,
  has_table_privilege('authenticated',$1,'TRIGGER')    a_trigger,
  has_table_privilege('anon',$1,'SELECT')              anon_select,
  has_table_privilege('service_role',$1,'INSERT')      svc_insert,
  has_table_privilege('service_role',$1,'UPDATE')      svc_update`, [TABLE])).rows[0];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (tip !== '177') throw new Error(`Expected registry tip 177, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((f) => f.startsWith('178_'));
  if (files.length !== 1) throw new Error(`Expected one migration 178, found ${files.length}.`);

  /*
    Duas coisas têm de continuar exatamente como estavam: os dados de
    procedência e as políticas de RLS. Revogação de privilégio é a única
    mudança autorizada aqui, então ambas são medidas antes e depois.
  */
  const before = await privOf();
  const rowsBefore = (await db.query(
    `SELECT resolution_state, count(*)::int n FROM ${TABLE} GROUP BY 1 ORDER BY 1`)).rows;
  const rlsBefore = (await db.query(
    `SELECT policyname, cmd, qual, with_check FROM pg_policies
      WHERE schemaname='public' AND tablename='project_canonical_location'
      ORDER BY policyname`)).rows;

  await db.query('BEGIN');
  await db.query(strip(readFileSync(`supabase/migrations/${files[0]}`, 'utf8')));
  await recordMigrationApplied(db, '178', 'canonical_location_privilege_tidy');

  const failures = [];
  const after = await privOf();

  if (!after.a_select) failures.push('a leitura foi embora junto — SELECT tem de ficar');
  for (const gone of ['a_insert', 'a_update', 'a_delete', 'a_references', 'a_trigger']) {
    if (after[gone]) failures.push(`authenticated ainda tem ${gone.slice(2).toUpperCase()}`);
  }
  if (after.anon_select) failures.push('anon voltou a ler a tabela');
  if (!after.svc_insert || !after.svc_update) {
    failures.push('service_role perdeu escrita — o resolvedor deixaria de funcionar');
  }

  const rowsAfter = (await db.query(
    `SELECT resolution_state, count(*)::int n FROM ${TABLE} GROUP BY 1 ORDER BY 1`)).rows;
  if (JSON.stringify(rowsAfter) !== JSON.stringify(rowsBefore)) {
    failures.push(`dados mudaram: ${JSON.stringify(rowsBefore)} → ${JSON.stringify(rowsAfter)}`);
  }
  const rlsAfter = (await db.query(
    `SELECT policyname, cmd, qual, with_check FROM pg_policies
      WHERE schemaname='public' AND tablename='project_canonical_location'
      ORDER BY policyname`)).rows;
  if (JSON.stringify(rlsAfter) !== JSON.stringify(rlsBefore)) failures.push('RLS foi alterada');

  /* O marcador do globo lê por cima desta tabela: não pode cegar. */
  const marker = (await db.query(
    'SELECT count(*)::int n FROM public.project_globe_marker')).rows[0].n;
  if (marker !== 1) failures.push(`marcadores no globo: ${marker} (esperado 1)`);

  const registryTip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (registryTip !== '178') failures.push(`registry tip ${registryTip} ≠ 178`);

  if (failures.length) throw new Error(`Prova falhou:\n  - ${failures.join('\n  - ')}`);
  console.log('Privilégios antes:', JSON.stringify(before));
  console.log('Privilégios depois:', JSON.stringify(after));
  console.log('Linhas intactas:', JSON.stringify(rowsAfter), '· políticas de RLS:', rlsAfter.length);

  if (apply) { await db.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await db.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Use --apply para gravar.'); }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  console.error('\nFALHOU:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
