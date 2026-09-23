/**
 * Aplica e registra a 216 (vínculo governado proposta → oportunidade).
 * Sem `--apply` é ensaio. As provas rodam num SAVEPOINT e são sempre desfeitas:
 * nenhuma proposta, oportunidade ou evento de prova sobrevive, nem com `--apply`.
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

/** Espera que a chamada falhe; desfaz até o savepoint e registra se passou. */
async function rejects(failures, label, sql, params) {
  const sp = `sp_${Math.random().toString(36).slice(2, 8)}`;
  await db.query(`SAVEPOINT ${sp}`);
  try {
    await db.query(sql, params);
    failures.push(label);
  } catch {
    await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
  }
}

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await one('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1'))?.version;
  if (tip !== '215') throw new Error(`Esperava ponta 215, encontrei ${tip}.`);
  await db.query('BEGIN');
  const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith('216_'));
  await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
  await recordMigrationApplied(db, '216', file.slice(4).replace(/\.sql$/, ''));

  const failures = [];
  const fn = await one(`SELECT has_function_privilege('authenticated',
    'public.commercial_proposal_link_opportunity(uuid,uuid,uuid,uuid,text)', 'EXECUTE') b`);
  if (fn.b) failures.push('vínculo alcançável pelo navegador');
  const writes = await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
    WHERE grantee IN ('authenticated','anon') AND table_schema='public'
      AND table_name='commercial_proposal_link_events'
      AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`);
  if (writes.n) failures.push('navegador escreve no histórico de vínculo');

  // Provas de comportamento — sempre desfeitas.
  await db.query('SAVEPOINT proofs');
  const { org, actor } = await one(`SELECT p.organization_id org, p.user_id actor FROM public.profiles p
    WHERE p.status='active' AND p.organization_id IS NOT NULL ORDER BY p.created_at LIMIT 1`);
  const stamp = Date.now();
  const opp = (await one(`SELECT public.commercial_opportunity_upsert($1,$2,$3) id`, [org, actor,
    JSON.stringify({ title: `Prova 216 ${stamp}`, counterparty_name: 'Prova 216', currency: 'BRL' })])).id;
  const other = (await one(`SELECT public.commercial_opportunity_upsert($1,$2,$3) id`, [org, actor,
    JSON.stringify({ title: `Prova 216 outra ${stamp}`, counterparty_name: 'Prova 216', currency: 'BRL' })])).id;
  const proposal = (await one(`SELECT public.commercial_proposal_create($1,$2,$3) r`, [org, actor, JSON.stringify({
    proposal_number: `PROOF-216-${stamp}`, kind: 'COMBINED', title: 'Prova 216', counterparty_name: 'Prova 216' })])).r.proposal_id;
  const link = 'SELECT public.commercial_proposal_link_opportunity($1,$2,$3,$4,$5) r';

  await rejects(failures, 'ator ausente aceito', link, [org, null, proposal, opp, null]);
  await rejects(failures, 'oportunidade de outro inquilino aceita', link,
    [org, actor, proposal, '00000000-0000-4000-8000-000000000000', null]);

  const first = (await one(link, [org, actor, proposal, opp, 'prova'])).r;
  if (!first.linked) failures.push('vínculo não gravado');
  const row = await one('SELECT opportunity_id FROM public.commercial_proposals WHERE id=$1', [proposal]);
  if (row.opportunity_id !== opp) failures.push('proposta não aponta para a oportunidade');
  const again = (await one(link, [org, actor, proposal, opp, null])).r;
  if (again.linked) failures.push('repetição gerou segundo vínculo');
  const events = await one('SELECT count(*)::int n FROM public.commercial_proposal_link_events WHERE proposal_id=$1', [proposal]);
  if (events.n !== 1) failures.push(`esperava 1 evento, há ${events.n}`);
  await rejects(failures, 'proposta movida para outra oportunidade', link, [org, actor, proposal, other, null]);
  await rejects(failures, 'histórico de vínculo reescrito',
    'UPDATE public.commercial_proposal_link_events SET reason=$2 WHERE proposal_id=$1', [proposal, 'x']);

  const loose = (await one(`SELECT public.commercial_proposal_create($1,$2,$3) r`, [org, actor, JSON.stringify({
    proposal_number: `PROOF-216-B-${stamp}`, kind: 'TECHNICAL', title: 'Prova 216 B', counterparty_name: 'Prova 216' })])).r.proposal_id;
  await db.query('SELECT public.commercial_opportunity_transition_stage($1,$2,$3,$4,$5)',
    [org, actor, other, 'LOST', 'prova 216']);
  await rejects(failures, 'vínculo a oportunidade perdida aceito', link, [org, actor, loose, other, null]);
  await db.query('ROLLBACK TO SAVEPOINT proofs');

  if (failures.length) {
    console.error('PROVAS FALHARAM:\n- ' + failures.join('\n- '));
    await db.query('ROLLBACK');
    process.exit(1);
  }
  console.log('Vínculo único, idempotente, no inquilino, com oportunidade viva, histórico imutável e privilégio — provado.');
  if (apply) { await db.query('COMMIT'); console.log('COMMIT — 216 aplicada e registrada.'); }
  else { await db.query('ROLLBACK'); console.log('ENSAIO ok. Use --apply para cometer.'); }
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
