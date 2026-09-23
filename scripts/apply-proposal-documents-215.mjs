/**
 * Aplica e registra a 215 (PDF da proposta antes do trabalho autorizado).
 * Sem `--apply` é ensaio. As provas rodam num SAVEPOINT e são sempre desfeitas:
 * nenhuma proposta ou documento de prova sobrevive, nem com `--apply`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await one('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1'))?.version;
  if (tip !== '214') throw new Error(`Esperava ponta 214, encontrei ${tip}.`);
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('215_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '215', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const fn = await one(`SELECT has_function_privilege('authenticated', 'public.commercial_proposal_register_document(uuid,uuid,uuid,jsonb)', 'EXECUTE') b`);
  if (fn.b) failures.push('registro de documento alcançável pelo navegador');

  // Provas de comportamento — sempre desfeitas.
  await db.query('SAVEPOINT proofs');
  const { org, actor } = await one(`SELECT p.organization_id org, p.user_id actor FROM public.profiles p WHERE p.status='active' ORDER BY p.created_at LIMIT 1`);
  const created = await one(`SELECT public.commercial_proposal_create($1,$2,$3) r`, [org, actor, JSON.stringify({
    proposal_number: `PROOF-215-${Date.now()}`, kind: 'TECHNICAL', title: 'Prova 215', counterparty_name: 'Prova', currency: 'BRL' })]);
  const rev = created.r.revision_id;
  const first = await one(`SELECT public.commercial_proposal_register_document($1,$2,$3,$4) r`, [org, actor, rev,
    JSON.stringify({ file_path: `${org}/proposals/x.pdf`, content_sha256: 'c'.repeat(64) })]);
  if (first.r.document_context !== 'TECHNICAL_PROPOSAL') failures.push('papel do documento não derivou da proposta');
  const again = await one(`SELECT public.commercial_proposal_register_document($1,$2,$3,$4) r`, [org, actor, rev,
    JSON.stringify({ file_path: `${org}/proposals/y.pdf`, content_sha256: 'c'.repeat(64) })]);
  if (!again.r.reused || again.r.document_id !== first.r.document_id) failures.push('mesmo arquivo registrado duas vezes');
  await db.query('SAVEPOINT sp_other');
  try {
    await db.query(`SELECT public.commercial_proposal_register_document($1,$2,$3,$4)`, [org, actor, rev,
      JSON.stringify({ file_path: `${org}/proposals/z.pdf`, content_sha256: 'd'.repeat(64) })]);
    failures.push('revisão aceitou um segundo documento');
  } catch { await db.query('ROLLBACK TO SAVEPOINT sp_other'); }
  await db.query('SAVEPOINT sp_foreign');
  try {
    await db.query(`SELECT public.commercial_proposal_register_document($1,$2,$3,$4)`, [org, actor, rev,
      JSON.stringify({ file_path: `00000000-0000-0000-0000-000000000000/x.pdf` })]);
    failures.push('caminho fora do inquilino aceito');
  } catch { await db.query('ROLLBACK TO SAVEPOINT sp_foreign'); }
  const linked = await one(`SELECT document_id FROM public.commercial_proposal_revisions WHERE id=$1`, [rev]);
  if (linked.document_id !== first.r.document_id) failures.push('revisão não aponta para o documento');
  await db.query('ROLLBACK TO SAVEPOINT proofs');

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Pai de proposta, um documento por revisão, deduplicação, inquilino e privilégio — provado.');
  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 215 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
