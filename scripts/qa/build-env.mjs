/**
 * Monta o ambiente de QA ISOLADO a partir da estrutura REAL de produção.
 *
 *   node scripts/qa/build-env.mjs              # usa o dump em cache se existir
 *   node scripts/qa/build-env.mjs --refresh    # refaz o dump de produção
 *
 * Pré-requisito: `supabase start --workdir qa` (pilha local em Docker).
 *
 * ─── O que sai de produção, e o que NÃO sai ──────────────────────────────
 *
 * Sai, em transação SOMENTE LEITURA:
 *   • a ESTRUTURA do esquema `public` (tabelas, funções, gatilhos, políticas,
 *     concessões) — `pg_dump --schema-only`, sem uma linha de dado;
 *   • o CATÁLOGO global que o RBAC e o roteamento exigem: papéis de sistema,
 *     permissões, concessões papel→permissão, rotas de evento;
 *   • a configuração dos buckets e as políticas do Storage;
 *   • o registro de migrations (versão e nome), para os aplicadores.
 *
 * Não sai: organização, pessoa, projeto, contrato, documento — nenhum dado de
 * negócio. O inquilino de QA nasce vazio, pelo fluxo real de provisionamento,
 * em `scripts/qa/seed.mjs`.
 *
 * Por que dump e não replay das 1–236: é a definição que RODA em produção
 * (aplicada por scripts ao longo de meses). O replay prova outra coisa — que
 * o repositório reconstrói o banco — e fica como prova própria.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';
import { QA_DIR, QA_ENV_FILE, assertLocal } from './lib/qa-env.mjs';

const REFRESH = process.argv.includes('--refresh');
const CACHE_DIR = path.resolve('tmp/qa');
const DUMP_FILE = path.join(CACHE_DIR, 'prod-public-schema.sql');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const step = (m) => console.log(`\n▸ ${m}`);

// ── 1. Endereços do QA local (a própria CLI os informa) ─────────────────────
step('pilha local de QA');
const status = spawnSync('supabase', ['status', '--workdir', QA_DIR, '-o', 'json'], { encoding: 'utf8' });
if (status.status !== 0) throw new Error(`supabase status falhou — a pilha está de pé?\n${status.stderr}`);
const local = JSON.parse(status.stdout.slice(status.stdout.indexOf('{')));
const QA = {
  QA_API_URL: assertLocal(local.API_URL, 'API_URL'),
  QA_DB_URL: assertLocal(local.DB_URL, 'DB_URL'),
  QA_ANON_KEY: local.ANON_KEY,
  QA_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY,
  QA_JWT_SECRET: local.JWT_SECRET,
  QA_STUDIO_URL: local.STUDIO_URL,
  QA_JOBS_SECRET: 'qa-jobs-secret-local-only',
  QA_APP_PORT: '9102',
};
fs.writeFileSync(QA_ENV_FILE, `${Object.entries(QA).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
console.log(`   ${QA_ENV_FILE} escrito (gitignored) · API ${QA.QA_API_URL}`);

// ── 2. Produção, somente leitura ────────────────────────────────────────────
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });
const prodUrl = new URL(process.env.SUPABASE_DB_URL);
if (prodUrl.hostname === '127.0.0.1' || prodUrl.hostname === 'localhost') {
  throw new Error('SUPABASE_DB_URL do .env.local já é local — nada a copiar.');
}
const sessionUrl = new URL(prodUrl); sessionUrl.port = '5432'; // pg_dump pede o pooler de SESSÃO

if (REFRESH || !fs.existsSync(DUMP_FILE)) {
  step('dump da ESTRUTURA do esquema public (produção, somente leitura)');
  const r = spawnSync('pg_dump', [sessionUrl.toString(), '--schema-only', '--schema=public', '--no-owner',
    '--no-security-labels', '--no-publications', '--no-subscriptions', '-f', DUMP_FILE], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error('pg_dump falhou');
}
console.log(`   dump: ${(fs.statSync(DUMP_FILE).size / 1e6).toFixed(1)} MB`);

step('catálogo global e Storage (produção, transação READ ONLY)');
const prod = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await prod.connect();
const catalog = {};
let parity;
try {
  await prod.query('BEGIN READ ONLY');
  const rows = async (sql) => (await prod.query(sql)).rows;
  catalog.roles = await rows(`SELECT * FROM public.roles WHERE organization_id IS NULL`);
  catalog.permissions = await rows(`SELECT * FROM public.permissions`);
  catalog.role_permissions = await rows(`SELECT rp.* FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id WHERE r.organization_id IS NULL`);
  catalog.apex_dynamic_route_providers = await rows(`SELECT * FROM public.apex_dynamic_route_providers`);
  catalog.apex_event_routes = await rows(`SELECT * FROM public.apex_event_routes`);
  catalog.management_category = await rows(`SELECT * FROM public.management_category WHERE organization_id IS NULL`);
  catalog.buckets = await rows(`SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets`);
  catalog.storagePolicies = await rows(`SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'storage'`);
  catalog.migrations = await rows(`SELECT version, name FROM supabase_migrations.schema_migrations`);
  parity = (await rows(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') tables,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v') views,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')) functions,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public') policies,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND NOT t.tgisinternal) triggers`))[0];
} finally {
  await prod.query('ROLLBACK').catch(() => {});
  await prod.end();
}
console.log(`   papéis ${catalog.roles.length} · permissões ${catalog.permissions.length} · concessões ${catalog.role_permissions.length}`
  + ` · rotas ${catalog.apex_event_routes.length} · buckets ${catalog.buckets.length} · políticas de storage ${catalog.storagePolicies.length}`);

// ── 3. Restauração no QA local ─────────────────────────────────────────────
step('restauração da estrutura no QA local');
const qa = new pg.Client({ connectionString: QA.QA_DB_URL });
await qa.connect();
await qa.query('DROP SCHEMA IF EXISTS public CASCADE');
await qa.end();

const prepared = path.join(CACHE_DIR, 'prod-public-schema.qa.sql');
const sql = fs.readFileSync(DUMP_FILE, 'utf8').replace(
  /^CREATE SCHEMA public;$/m,
  // btree_gist mora em `public` em produção; o dump por esquema não traz extensões.
  'CREATE SCHEMA public;\nCREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;',
);
fs.writeFileSync(prepared, sql);
const restore = spawnSync('psql', [QA.QA_DB_URL, '-v', 'ON_ERROR_STOP=0', '-q', '-f', prepared], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const errors = (restore.stderr || '').split('\n').filter((l) => /ERROR/.test(l));
// Única classe de erro aceita: privilégio-padrão do `supabase_admin` (papel de
// plataforma que o `postgres` local não representa). Qualquer outro é defeito.
const unexpected = errors.filter((l) => !/must be (member|able to SET ROLE) .*supabase_admin|permission denied to change default privileges/.test(l));
console.log(`   erros: ${errors.length} (${errors.length - unexpected.length} de privilégio-padrão do supabase_admin, esperados)`);
if (unexpected.length) {
  console.error(unexpected.slice(0, 20).join('\n'));
  throw new Error(`${unexpected.length} erro(s) inesperado(s) na restauração`);
}

const db = new pg.Client({ connectionString: QA.QA_DB_URL });
await db.connect();
try {
  // Os privilégios-padrão do supabase_admin são reaplicados como superusuário local.
  const admin = new pg.Client({ connectionString: QA.QA_DB_URL.replace('postgres:postgres@', 'supabase_admin:postgres@') });
  await admin.connect().then(async () => {
    const lines = sql.split('\n').filter((l) => l.startsWith('ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin'));
    for (const l of lines) await admin.query(l);
    console.log(`   ${lines.length} privilégio(s)-padrão do supabase_admin reaplicados`);

    step('catálogo global');
    const load = async (table, list) => {
      if (!list.length) return;
      await admin.query(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table}, $1::jsonb) ON CONFLICT DO NOTHING`,
        [JSON.stringify(list)]);
      console.log(`   ${table}: ${list.length}`);
    };
    await load('roles', catalog.roles);
    await load('permissions', catalog.permissions);
    await load('role_permissions', catalog.role_permissions);
    await load('apex_dynamic_route_providers', catalog.apex_dynamic_route_providers);
    await load('apex_event_routes', catalog.apex_event_routes);
    await load('management_category', catalog.management_category);

    step('Storage: buckets e políticas');
    for (const b of catalog.buckets) {
      await admin.query(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public,
          file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types`,
        [b.id, b.name, b.public, b.file_size_limit, b.allowed_mime_types]);
    }
    const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const roleList = (r) => (Array.isArray(r) ? r : String(r).replace(/[{}]/g, '').split(',')).map((x) => (x === 'public' ? 'public' : ident(x))).join(', ');
    for (const p of catalog.storagePolicies) {
      await admin.query(`DROP POLICY IF EXISTS ${ident(p.policyname)} ON storage.${ident(p.tablename)}`);
      await admin.query(`CREATE POLICY ${ident(p.policyname)} ON storage.${ident(p.tablename)} AS ${p.permissive}
        FOR ${p.cmd} TO ${roleList(p.roles)}${p.qual ? ` USING (${p.qual})` : ''}${p.with_check ? ` WITH CHECK (${p.with_check})` : ''}`);
    }
    console.log(`   buckets ${catalog.buckets.length} · políticas ${catalog.storagePolicies.length}`);

    step('registro de migrations');
    await admin.query(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
      ALTER SCHEMA supabase_migrations OWNER TO postgres;
      ALTER TABLE supabase_migrations.schema_migrations OWNER TO postgres`);
    for (const m of catalog.migrations) {
      await admin.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [m.version, m.name]);
    }
    console.log(`   ${catalog.migrations.length} versões`);
    await admin.query(`NOTIFY pgrst, 'reload schema'`);
  }).finally(() => admin.end());

  step('paridade com produção');
  const got = (await db.query(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') tables,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v') views,
    (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')) functions,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public') policies,
    (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND NOT t.tgisinternal) triggers`)).rows[0];
  let same = true;
  for (const k of Object.keys(parity)) {
    const ok = parity[k] === got[k]; same &&= ok;
    console.log(`   ${ok ? '✓' : '✗'} ${k}: produção ${parity[k]} · QA ${got[k]}`);
  }
  if (!same) throw new Error('A estrutura do QA não é a de produção.');
  console.log('\n✓ QA isolado pronto. Próximo passo: node scripts/qa/seed.mjs');
} finally {
  await db.end();
}
