import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const migrations = [
  ['149', 'no_silent_organization_failover'],
  ['150', 'private_project_documents'],
];
const stripTx = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
await client.query('SET SESSION default_transaction_read_only = off');

let ok = true;
const must = (label, pass, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

try {
  const tip = (await one(
    `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`,
  )).version;
  must('ponta do registro é 148', tip === '148', tip);
  if (tip !== '148') throw new Error(`esperava 148, encontrei ${tip}`);

  const nonLogo = Number((await one(
    `SELECT count(*)::int n FROM project_files
      WHERE bucket_id='project-files' AND category <> 'logo'`,
  )).n);
  must('nenhum documento real precisa de migração de bytes', nonLogo === 0, String(nonLogo));
  if (!ok) throw new Error('portão de armazenamento reprovado');

  await client.query('BEGIN');
  for (const [version, name] of migrations) {
    const file = `supabase/migrations/${version}_${name}.sql`;
    await client.query(stripTx(readFileSync(file, 'utf8')));
    await recordMigrationApplied(client, version, name);
    console.log(`   ✓ ${version}_${name}`);
  }

  must('anon não executa SECURITY DEFINER', Number((await one(
    `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef
        AND has_function_privilege('anon',p.oid,'EXECUTE')`,
  )).n) === 0);
  must('bucket de documentos é privado', (await one(
    `SELECT public FROM storage.buckets WHERE id='project-documents'`,
  )).public === false);
  must('bucket público não aceita PDF', !(await one(
    `SELECT allowed_mime_types @> ARRAY['application/pdf']::text[] AS accepts_pdf
       FROM storage.buckets WHERE id='project-files'`,
  )).accepts_pdf);

  if (!ok) throw new Error('bateria pós-DDL reprovada');
  if (APPLY) {
    await client.query('COMMIT');
    console.log('=== COMETIDO: 149–150 ===');
  } else {
    await client.query('ROLLBACK');
    console.log('=== ENSAIO: DESFEITO ===');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('✗ FALHOU:', error.message);
  ok = false;
} finally {
  await client.end();
}

process.exit(ok ? 0 : 1);
