/** Ensaia ou aplica e registra atomicamente a migration 177 (renomeia coluna de visão). */
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

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (tip !== '176') throw new Error(`Expected registry tip 176, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((f) => f.startsWith('177_'));
  if (files.length !== 1) throw new Error(`Expected one migration 177, found ${files.length}.`);

  /* Os marcadores existentes têm de sobreviver ao DROP/CREATE, intactos. */
  const before = (await db.query(
    `SELECT project_id, latitude, longitude, site_label, source_page
       FROM public.project_globe_marker ORDER BY project_id`)).rows;
  const locations = (await db.query(
    'SELECT count(*)::int n FROM public.project_canonical_location')).rows[0].n;

  await db.query('BEGIN');
  await db.query(strip(readFileSync(`supabase/migrations/${files[0]}`, 'utf8')));
  await recordMigrationApplied(db, '177', 'globe_marker_column_rename');

  const failures = [];
  const after = (await db.query(
    `SELECT project_id, latitude, longitude, site_label, source_page
       FROM public.project_globe_marker ORDER BY project_id`)).rows;
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    failures.push('os marcadores mudaram — a renomeação deveria ser transparente');
  }
  const locationsAfter = (await db.query(
    'SELECT count(*)::int n FROM public.project_canonical_location')).rows[0].n;
  if (locationsAfter !== locations) failures.push(`localizações ${locations} → ${locationsAfter}`);

  const cols = (await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='project_globe_marker'`)).rows.map((r) => r.column_name);
  if (cols.includes('project_status')) failures.push('a coluna vigiada continua lá');
  if (!cols.includes('project_lifecycle_status')) failures.push('a coluna nova não existe');

  const priv = (await db.query(`SELECT
    has_table_privilege('authenticated','public.project_globe_marker','SELECT') a_sel,
    has_table_privilege('authenticated','public.project_globe_marker','INSERT') a_ins,
    has_table_privilege('anon','public.project_globe_marker','SELECT') anon_sel,
    (SELECT reloptions::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND relname='project_globe_marker') opts`)).rows[0];
  if (!priv.a_sel || priv.a_ins || priv.anon_sel) failures.push('privilégios não foram restaurados');
  if (!String(priv.opts).includes('security_invoker=true')) failures.push('perdeu security_invoker');

  const dup = (await db.query(
    `SELECT project_id FROM public.project_globe_marker GROUP BY 1 HAVING count(*) > 1`)).rows;
  if (dup.length) failures.push(`marcador duplicado: ${JSON.stringify(dup)}`);

  const registryTip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (registryTip !== '177') failures.push(`registry tip ${registryTip} ≠ 177`);

  if (failures.length) throw new Error(`Prova falhou:\n  - ${failures.join('\n  - ')}`);
  console.log('Marcadores preservados:', JSON.stringify(after));
  console.log('Privilégios:', JSON.stringify(priv));

  if (apply) { await db.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await db.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Use --apply para gravar.'); }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  console.error('\nFALHOU:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
