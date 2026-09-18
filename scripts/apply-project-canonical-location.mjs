/** Ensaia ou aplica e registra atomicamente a migration 176. */
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

const counts = async () => (await db.query(`SELECT
  (SELECT count(*)::int FROM public.contracts) contracts,
  (SELECT count(*)::int FROM public.projects) projects,
  (SELECT count(*)::int FROM public.contract_milestones) milestones,
  (SELECT count(*)::int FROM public.contract_billing_events) billing_events,
  (SELECT count(*)::int FROM public.project_geofences) geofences,
  (SELECT count(*)::int FROM public.projects WHERE project_v2->'location' IS NOT NULL) v2_with_location
`)).rows[0];

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  const tip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (tip !== '175') throw new Error(`Expected registry tip 175, received ${tip}.`);
  const files = readdirSync('supabase/migrations').filter((f) => f.startsWith('176_'));
  if (files.length !== 1) throw new Error(`Expected one migration 176, found ${files.length}.`);

  const before = await counts();

  await db.query('BEGIN');
  await db.query(strip(readFileSync(`supabase/migrations/${files[0]}`, 'utf8')));
  await recordMigrationApplied(db, '176', 'project_canonical_location');

  const failures = [];
  const after = await counts();
  for (const [k, v] of Object.entries(after)) {
    if (v !== before[k]) failures.push(`${k}: ${before[k]} → ${v} (não deveria mudar dado)`);
  }

  /* A tabela nasce VAZIA. Nenhuma coordenada é semeada por migration. */
  const seeded = (await db.query(
    'SELECT count(*)::int n FROM public.project_canonical_location')).rows[0].n;
  if (seeded !== 0) failures.push(`tabela nasceu com ${seeded} linhas — coordenada semeada`);

  const markers = (await db.query('SELECT count(*)::int n FROM public.project_globe_marker')).rows[0].n;
  if (markers !== 0) failures.push(`globo já tem ${markers} marcadores sem nenhuma resolução`);

  /* RLS ligada e navegador sem escrita. */
  const sec = (await db.query(`SELECT
    (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND relname='project_canonical_location') rls,
    has_table_privilege('authenticated','public.project_canonical_location','SELECT') a_sel,
    has_table_privilege('authenticated','public.project_canonical_location','INSERT') a_ins,
    has_table_privilege('authenticated','public.project_canonical_location','UPDATE') a_upd,
    has_table_privilege('anon','public.project_canonical_location','SELECT') anon_sel,
    has_table_privilege('authenticated','public.project_globe_marker','SELECT') g_sel,
    has_table_privilege('authenticated','public.project_globe_marker','INSERT') g_ins,
    has_table_privilege('anon','public.project_globe_marker','SELECT') g_anon`)).rows[0];
  if (sec.rls !== true) failures.push('RLS desligada');
  if (!sec.a_sel) failures.push('authenticated sem SELECT');
  if (sec.a_ins || sec.a_upd) failures.push('authenticated COM escrita na canônica');
  if (sec.anon_sel) failures.push('anon com SELECT na canônica');
  if (!sec.g_sel || sec.g_ins || sec.g_anon) failures.push('privilégio errado em project_globe_marker');

  /* ── As recusas, provadas contra o banco e não contra o comentário ──── */
  const org = (await db.query(
    `SELECT organization_id FROM public.contracts WHERE contract_number='JA10182283/2025'`)).rows[0]?.organization_id;
  const proj = 'proj-3a445bb5-c576-445d-bb49-adcddd52dc1d';

  const refuses = async (label, sql, params) => {
    try { await db.query(`SAVEPOINT s`); await db.query(sql, params); await db.query('ROLLBACK TO s');
      failures.push(`${label}: o banco ACEITOU, e deveria recusar`);
    } catch { await db.query('ROLLBACK TO s'); }
  };

  await refuses('RESOLVED sem coordenada', `
    INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, evidence_kind, site_label,
       source_excerpt, resolution_fingerprint)
    VALUES ($1,$2,'RESOLVED','contract_scope','UHE X','trecho','fp-a')`, [org, proj]);

  await refuses('RESOLVED sem proveniência textual', `
    INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, evidence_kind, site_label,
       latitude, longitude, precision, resolution_fingerprint)
    VALUES ($1,$2,'RESOLVED','contract_scope','UHE X',-18.5,-49.5,'site','fp-b')`, [org, proj]);

  await refuses('RESOLVED com precisão de estado', `
    INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, evidence_kind, site_label,
       latitude, longitude, precision, source_excerpt, resolution_fingerprint)
    VALUES ($1,$2,'RESOLVED','contract_scope','Goiás',-16.0,-49.0,'region','trecho','fp-c')`, [org, proj]);

  await refuses('evidência de sede/endereço legal', `
    INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, evidence_kind, resolution_fingerprint)
    VALUES ($1,$2,'UNRESOLVED','legal_address','fp-d')`, [org, proj]);

  await refuses('UNRESOLVED carregando coordenada escondida', `
    INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, evidence_kind, latitude, longitude,
       resolution_fingerprint)
    VALUES ($1,$2,'UNRESOLVED','none',-18.5,-49.5,'fp-e')`, [org, proj]);

  /* Duas canônicas vivas para o mesmo projeto = dois marcadores. Impossível. */
  await db.query('SAVEPOINT dup');
  await db.query(`INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, evidence_kind, resolution_fingerprint)
    VALUES ($1,$2,'UNRESOLVED','none','fp-live-1')`, [org, proj]);
  await refuses('segunda canônica viva no mesmo projeto', `
    INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, evidence_kind, resolution_fingerprint)
    VALUES ($1,$2,'REQUIRES_ATTENTION','none','fp-live-2')`, [org, proj]);
  /* Idempotência: mesma impressão digital, segunda gravação recusada. */
  await refuses('mesma resolution_fingerprint duas vezes', `
    INSERT INTO public.project_canonical_location
      (organization_id, project_id, resolution_state, evidence_kind, resolution_fingerprint)
    VALUES ($1,$2,'UNRESOLVED','none','fp-live-1')`, [org, proj]);
  /* Imutabilidade dos fatos. */
  await refuses('UPDATE de latitude numa linha existente', `
    UPDATE public.project_canonical_location SET latitude = -1 WHERE resolution_fingerprint='fp-live-1'`, []);
  await db.query('ROLLBACK TO dup');

  const registryTip = (await db.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  )).rows[0]?.version;
  if (registryTip !== '176') failures.push(`registry tip ${registryTip} ≠ 176`);

  if (failures.length) throw new Error(`Prova falhou:\n  - ${failures.join('\n  - ')}`);

  console.log('Intocado:', JSON.stringify(after));
  console.log('Canônicas semeadas:', seeded, '| marcadores no globo:', markers);
  console.log('Segurança:', JSON.stringify(sec));
  console.log('Todas as recusas do banco funcionaram.');

  if (apply) { await db.query('COMMIT'); console.log('\nAPLICADO.'); }
  else { await db.query('ROLLBACK'); console.log('\nENSAIO — desfeito. Use --apply para gravar.'); }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  console.error('\nFALHOU:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
