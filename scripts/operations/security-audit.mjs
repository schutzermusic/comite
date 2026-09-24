/**
 * AUDITORIA DE SEGURANÇA — Operações e Supply (230+).
 *
 *   node scripts/operations/security-audit.mjs                       # schema aplicado (somente leitura)
 *   node scripts/operations/security-audit.mjs --with-migrations 231 # ensaia antes de aplicar (ROLLBACK)
 *
 * Confere, para cada tabela/função registrada em `lib/registry.mjs`:
 *   • RLS ligada e ao menos uma política de leitura;
 *   • nenhuma escrita de `authenticated`, nenhuma leitura de `anon`;
 *   • toda FK de domínio carrega `organization_id` (coerência de inquilino no banco);
 *   • livros append-only: UPDATE recusado, DELETE pela regra canônica;
 *   • funções governadas negadas ao navegador e alcançáveis pelo service_role;
 *   • `SECURITY DEFINER` com `search_path` fixo;
 *   • permissões semeadas e concedidas ao owner_admin.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { migrationFile, strip } from './lib/proof-kit.mjs';
import { registryUpTo, OPERATIONS_REGISTRY } from './lib/registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const argv = process.argv.slice(2);
const withVersions = argv.includes('--with-migrations') ? argv.filter((a) => /^\d{3}$/.test(a)) : [];
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const results = [];
const report = (label, ok, detail) => {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;

try {
  await db.connect();
  await db.query('BEGIN');
  if (withVersions.length) {
    for (const v of withVersions) {
      await db.query(strip(readFileSync(`supabase/migrations/${migrationFile(v)}`, 'utf8')));
      console.log(`      (migration ${v} aplicada dentro do ensaio)`);
    }
  } else {
    await db.query('SET TRANSACTION READ ONLY');
  }

  const applied = new Set((await all('SELECT version FROM supabase_migrations.schema_migrations')).map((r) => r.version));
  const known = Object.keys(OPERATIONS_REGISTRY).filter((v) => applied.has(v) || withVersions.includes(v));
  const tip = known.sort().at(-1);
  if (!tip) throw new Error('Nenhuma migration de Operações aplicada ou ensaiada.');
  const reg = registryUpTo(tip);
  console.log(`Auditando Operações/Supply até ${tip} (${reg.versions.join(', ')}).\n`);

  for (const t of reg.tables) {
    const r = await one(`SELECT c.relrowsecurity rls,
        (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('r','*')) read_policies,
        has_table_privilege('authenticated', c.oid, 'INSERT') ai, has_table_privilege('authenticated', c.oid, 'UPDATE') au,
        has_table_privilege('authenticated', c.oid, 'DELETE') ad, has_table_privilege('authenticated', c.oid, 'TRUNCATE') at,
        has_table_privilege('anon', c.oid, 'SELECT') an
      FROM pg_class c WHERE c.oid = to_regclass('public.' || $1)`, [t]);
    if (!r) { report(`${t}: existe`, false); continue; }
    report(`${t}: RLS + política de leitura`, r.rls && r.read_policies > 0, `políticas=${r.read_policies}`);
    report(`${t}: navegador não escreve, anônimo não lê`, !r.ai && !r.au && !r.ad && !r.at && !r.an);

    const fks = await all(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
      WHERE conrelid = ('public.' || $1)::regclass AND contype = 'f'`, [t]);
    const domainFks = fks.filter((f) => !/REFERENCES (auth\.users|organizations)\(/.test(f.def));
    const incoherent = domainFks.filter((f) => !/^FOREIGN KEY \(organization_id,/.test(f.def));
    report(`${t}: FKs de domínio compostas com organization_id`, incoherent.length === 0,
      incoherent.map((f) => f.conname).join(', ') || `${domainFks.length} FK(s)`);
  }

  for (const t of reg.ledgers) {
    const triggers = await all(`SELECT t.tgname, p.proname, t.tgtype FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = ('public.' || $1)::regclass AND NOT t.tgisinternal`, [t]);
    const names = triggers.map((x) => x.proname);
    report(`${t}: livro append-only (UPDATE recusado, DELETE canônico)`,
      names.includes('operations_reject_history_rewrite') && names.includes('contracts_reject_history_erasure'),
      names.join(', '));
  }

  for (const fn of reg.functions) {
    const r = await one(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') a,
        has_function_privilege('anon', $1, 'EXECUTE') b, has_function_privilege('service_role', $1, 'EXECUTE') s,
        p.prosecdef definer, p.proconfig cfg
      FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || $1)`, [fn]);
    if (!r) { report(`${fn}: existe`, false); continue; }
    report(`${fn.split('(')[0]}: negada ao navegador, alcançável pelo servidor`, !r.a && !r.b && r.s);
    if (r.definer) {
      report(`${fn.split('(')[0]}: DEFINER com search_path fixo`,
        (r.cfg ?? []).some((c) => c.startsWith('search_path=')));
    }
  }

  for (const key of reg.permissions) {
    const r = await one(`SELECT EXISTS (SELECT 1 FROM public.permissions WHERE key = $1) seeded,
        EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
                 JOIN public.permissions p ON p.id = rp.permission_id
                WHERE r.key = 'owner_admin' AND r.organization_id IS NULL AND p.key = $1) granted`, [key]);
    report(`permissão ${key}: semeada e concedida ao owner_admin`, r.seeded && r.granted);
  }

  // Nenhuma função nova de Operações/Supply alcançável por authenticated, mesmo fora do registro.
  const leaked = await all(`SELECT p.oid::regprocedure::text fn FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname ~ '^(internal_service_order_|operations_|project_requirement|supply_|inventory_|procurement_|purchase_|goods_receipt|stock_transfer|receiving_)'
      AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname NOT IN (${["'internal_service_order_is_locked'"].join(',')})`);
  report('nenhuma função de Operações/Supply executável pelo navegador', leaked.length === 0,
    leaked.map((r) => r.fn).join(', '));
} catch (error) {
  report('auditoria concluída sem erro inesperado', false, error.message);
} finally {
  await db.query('ROLLBACK').catch(() => undefined);
  await db.end().catch(() => undefined);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações passaram. ROLLBACK — nada foi gravado.`);
process.exitCode = failed ? 1 : 0;
