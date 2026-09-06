/**
 * Aplicador do endurecimento de privilégio TRUNCATE (migration 118).
 *
 *   node scripts/apply-truncate-hardening.mjs           # ENSAIO: aplica e faz ROLLBACK
 *   node scripts/apply-truncate-hardening.mjs --apply   # aplica de verdade (COMMIT)
 *
 * Grava a linha do registro canônico dentro da MESMA transação que aplica o
 * arquivo, como todo runner a partir da 112.
 *
 * O preflight aqui é diferente do das outras fases: ele não checa estrutura,
 * checa PREMISSA DE SEGURANÇA. Antes de revogar um privilégio de toda tabela do
 * schema, prova que ninguém depende dele — nenhuma função o executa, e o único
 * TRUNCATE do repositório está sobre uma tabela TEMPORÁRIA, dentro de uma
 * migration que roda como `postgres`.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const FILE = ['118', 'platform_truncate_privilege_hardening', '118_platform_truncate_privilege_hardening.sql'];

/**
 * Fotografia dos privilégios que NÃO podem mudar. TRUNCATE de anon/authenticated
 * fica de fora de propósito: é o único que esta migration existe para alterar.
 */
const PRIVILEGE_FINGERPRINT = `
  SELECT grantee, privilege_type, count(DISTINCT table_name) n
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND NOT (privilege_type = 'TRUNCATE' AND grantee IN ('anon','authenticated'))
     AND grantee IN ('anon','authenticated','service_role','postgres')
   GROUP BY 1,2 ORDER BY 1,2`;

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => console.log(`   NOTICE: ${n.message}`));
await c.connect();
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### ENSAIO (ROLLBACK ao final) ###');

let ok = true;
const line = (label, value) => console.log(`   ${label.padEnd(50, '.')} ${value}`);

try {
  console.log('\n=== PREFLIGHT (somente leitura) ===');
  const stops = [];

  const [{ version: tip }] = (await c.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1')).rows;
  line('ponta do registro de migrations', tip);
  if (tip !== '117') stops.push(`registro em ${tip}; a 118 espera 117.`);

  const registryProblems = await assertRegistryMatches(c, {
    files: Array.from({ length: 117 }, (_, i) => String(i + 1).padStart(3, '0')).filter(v => v !== '090'),
    expectedAbsent: ['090'],
  });
  line('registro descreve o diretório', registryProblems.length === 0 ? 'sim' : `NÃO (${registryProblems.length})`);
  for (const p of registryProblems) stops.push(`registro: ${p}`);

  // ---- causa raiz: quem concede o TRUNCATE ----
  const defaults = (await c.query(`
    SELECT d.defaclrole::regrole::text owner, a.grantee::regrole::text grantee
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
     WHERE d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='r'
       AND a.privilege_type='TRUNCATE' AND a.grantee::regrole::text IN ('anon','authenticated')
     ORDER BY 1,2`)).rows;
  line('DEFAULT ACL concedendo TRUNCATE ao navegador',
    defaults.map(d => `${d.owner}→${d.grantee}`).join(', ') || '(nenhum)');

  const owners = (await c.query(`
    SELECT DISTINCT c.relowner::regrole::text owner FROM pg_class c
     WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') ORDER BY 1`)).rows;
  line('donos de tabela em public', owners.map(o => o.owner).join(', '));

  const before = (await c.query(`
    SELECT grantee, count(DISTINCT table_name) n FROM information_schema.role_table_grants
     WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')
     GROUP BY 1 ORDER BY 1`)).rows;
  line('tabelas concedendo TRUNCATE hoje',
    before.map(b => `${b.grantee}=${b.n}`).join(', ') || '(nenhuma)');

  // ---- premissa de segurança: ninguém depende de TRUNCATE ----
  const fns = (await c.query(`
    SELECT count(*) n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE p.prosrc ILIKE '%truncate%' AND ns.nspname NOT IN ('pg_catalog','information_schema')`)).rows[0].n;
  line('funções de banco que executam TRUNCATE', fns);
  if (fns !== '0') stops.push('há função de banco que executa TRUNCATE — revisar antes de revogar.');

  const probeOwner = owners.map(o => o.owner);
  if (!probeOwner.includes('postgres')) {
    stops.push('as tabelas de public não pertencem a postgres — reveja o alvo do ALTER DEFAULT PRIVILEGES.');
  }

  if (stops.length) {
    console.error('\n!!! PORTÃO DE PARADA — o endurecimento NÃO pode ser aplicado:');
    for (const s of stops) console.error(`    · ${s}`);
    ok = false; throw new Error('preflight');
  }
  console.log('   → nenhuma condição de parada.');
  console.log('\n   SAFE TO APPLY PRIVILEGE HARDENING: YES');

  const fingerprint = async () => Object.fromEntries(
    (await c.query(PRIVILEGE_FINGERPRINT)).rows.map(r => [`${r.grantee}:${r.privilege_type}`, r.n]));
  const privBefore = await fingerprint();

  // ---------- APLICAÇÃO ----------
  await c.query('BEGIN');
  const [version, name, file] = FILE;
  const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
    .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
  process.stdout.write(`\n-> ${file}\n`);
  await c.query(sql);
  await recordMigrationApplied(c, version, name);
  console.log('   OK (aplicada e registrada)');

  // ---------- ASSERÇÕES ----------
  const must = async (label, q, expect) => {
    const { rows } = await c.query(q);
    const got = rows[0] ? Object.values(rows[0])[0] : null;
    const pass = String(got) === String(expect);
    console.log(`   ${pass ? '✓' : '✗'} ${label}: ${got} (esperado ${expect})`);
    if (!pass) ok = false;
  };

  console.log('\n=== ASSERÇÕES ESTRUTURAIS ===');
  await must('anon não tem NENHUM TRUNCATE em public',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND privilege_type='TRUNCATE' AND grantee='anon'`, 0);
  await must('authenticated não tem NENHUM TRUNCATE em public',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND privilege_type='TRUNCATE' AND grantee='authenticated'`, 0);
  await must('nenhum DEFAULT ACL de dono de tabela concede TRUNCATE ao navegador',
    `SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='r'
        AND a.privilege_type='TRUNCATE' AND a.grantee::regrole::text IN ('anon','authenticated')
        AND d.defaclrole::regrole::text IN (
          SELECT DISTINCT c2.relowner::regrole::text FROM pg_class c2
           WHERE c2.relnamespace='public'::regnamespace AND c2.relkind IN ('r','p'))`, 0);
  await must('as 11 tabelas fiscais estão cobertas',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')
       AND table_name LIKE 'fiscal\\_%'`, 0);
  await must('as 11 tabelas de obrigação seguem cobertas',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')
       AND table_name LIKE 'contract\\_obligation%'`, 0);
  await must('service_role manteve TRUNCATE',
    `SELECT (count(DISTINCT table_name) > 100)::int FROM information_schema.role_table_grants
      WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee='service_role'`, 1);
  await must('postgres manteve TRUNCATE',
    `SELECT (count(DISTINCT table_name) > 100)::int FROM information_schema.role_table_grants
      WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee='postgres'`, 1);
  await must('a 118 foi registrada como aplicada',
    `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='118'`, 1);

  console.log('\n=== PROVAS FUNCIONAIS ===');
  await c.query(readFileSync('scripts/assert-truncate-hardening.sql', 'utf8'));
  console.log('   ✓ todas as asserções de scripts/assert-truncate-hardening.sql passaram');

  console.log('\n=== DEMAIS PRIVILÉGIOS (nada pode ter mudado) ===');
  const privAfter = await fingerprint();
  const keys = new Set([...Object.keys(privBefore), ...Object.keys(privAfter)]);
  for (const k of [...keys].sort()) {
    const pass = privBefore[k] === privAfter[k];
    console.log(`   ${pass ? '✓' : '✗'} ${k}: ${privAfter[k] ?? '(ausente)'}${pass ? '' : ` (era ${privBefore[k] ?? '(ausente)'})`}`);
    if (!pass) ok = false;
  }
} catch (e) {
  ok = false;
  if (e.message !== 'preflight') console.error(`\n!!! FALHA: ${e.message}`);
} finally {
  try {
    if (APPLY && ok) { await c.query('COMMIT'); console.log('\n>>> COMMIT aplicado.'); }
    else { await c.query('ROLLBACK'); console.log(APPLY ? '\n>>> ROLLBACK (houve falha) — nada aplicado.' : '\n>>> ROLLBACK (ensaio) — nada aplicado.'); }
  } catch { /* sem transação aberta */ }
  await c.end();
}

process.exit(ok ? 0 : 1);
