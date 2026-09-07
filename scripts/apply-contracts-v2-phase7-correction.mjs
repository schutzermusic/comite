/**
 * Fase 7 — correção: aplicação das migrations 140–142.
 *
 *   node scripts/apply-contracts-v2-phase7-correction.mjs           # ENSAIO (ROLLBACK)
 *   node scripts/apply-contracts-v2-phase7-correction.mjs --apply   # COMETE
 *
 * As migrations 135–139 já estão APLICADAS em produção e não são reescritas: a
 * correção vem por cima, como manda a disciplina de registro do repositório.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';
import { runPhase7CorrectionAssertions } from './lib/phase7-correction-assertions.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const MIGRATIONS = [
  ['140', 'phase7_definer_tenant_boundary'],
  ['141', 'billing_release_authority'],
  ['142', 'release_governance_read_model'],
];

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');

let ok = true;
const must = (label, pass, detail = '') => {
  console.log(`   ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) ok = false;
};
const one = async (sql, params) => (await c.query(sql, params)).rows[0];

try {
  console.log('=== PORTÃO PRÉ-APLICAÇÃO ===');
  const tip = (await one(
    `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).version;
  must('ponta do registro é 139 (Fase 7 aplicada)', tip === '139', tip);
  if (tip !== '139') throw new Error(`esperava 139, encontrei ${tip}`);

  const files = readdirSync('supabase/migrations')
    .filter((f) => /^\d{3}_.*\.sql$/.test(f)).map((f) => f.slice(0, 3)).sort();
  const problems = await assertRegistryMatches(c, {
    files: files.filter((v) => !MIGRATIONS.some(([m]) => m === v)),
    expectedAbsent: ['090'],
  });
  must('registro consistente com o diretório', problems.length === 0, problems.join('; '));
  for (const [v] of MIGRATIONS) {
    must(`sem colisão de versão em ${v}`,
      (await one(`SELECT count(*)::int n FROM supabase_migrations.schema_migrations WHERE version=$1`, [v])).n === 0);
  }
  must('TRUNCATE de navegador é ZERO antes de aplicar',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_schema='public' AND privilege_type='TRUNCATE'
                   AND grantee IN ('anon','authenticated')`)).n === 0);

  const before = await one(
    `SELECT (SELECT count(*)::int FROM contract_billing_events) billing,
            (SELECT count(*)::int FROM finance_receivables) ar,
            (SELECT count(*)::int FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
              WHERE p.key LIKE 'contracts.billing.%') billing_grants`);
  console.log(`   · ANTES: faturamentos=${before.billing} recebíveis=${before.ar} `
    + `concessões contracts.billing.*=${before.billing_grants}`);

  if (!ok) throw new Error('portão pré-aplicação vermelho');

  console.log('\n=== APLICAÇÃO ===');
  await c.query('BEGIN');
  for (const [version, name] of MIGRATIONS) {
    const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')
      .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
    await c.query(sql);
    await recordMigrationApplied(c, version, name);
    must(`${version} aplicada e registrada`, true);
  }

  const battery = await runPhase7CorrectionAssertions(c, { must, one });
  if (!battery) ok = false;

  console.log('\n=== LIMPEZA DO CENÁRIO DESCARTÁVEL ===');
  const disposable = `(SELECT id FROM organizations WHERE name LIKE '[P7X]%')`;
  for (const stmt of [
    `DELETE FROM finance_reconciliations WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_settlements WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_receivable_installments WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_receivables WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_payment_sources WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_billing_fiscal_allocations WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_billing_fiscal_requests WHERE organization_id IN ${disposable}`,
    `DELETE FROM fiscal_jobs WHERE organization_id IN ${disposable}`,
    `DELETE FROM fiscal_documents WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_billing_release_authorities WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_billing_events WHERE organization_id IN ${disposable}`,
    `DELETE FROM project_measurements WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_measurement_requirements WHERE organization_id IN ${disposable}`,
    `DELETE FROM projects WHERE organization_id IN ${disposable}`,
  ]) await c.query(stmt);
  await c.query(`DELETE FROM organizations WHERE name LIKE '[P7X]%'`);
  await c.query(`DELETE FROM auth.users WHERE email LIKE 'p7x.%@example.test'`);

  /*
    A bateria CONCEDE `contracts.billing.release` a `owner_admin` para provar
    que capacidade sozinha não libera. A concessão é do cenário, não do
    produto: ela sai aqui, e o portão pós-aplicação confere que saiu.
  */
  await c.query(
    `DELETE FROM role_permissions rp USING roles r, permissions p
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
        AND r.organization_id IS NULL AND p.key LIKE 'contracts.billing.%'`);

  const residue = await one(
    `SELECT (SELECT count(*)::int FROM organizations WHERE name LIKE '[P7X]%') orgs,
            (SELECT count(*)::int FROM auth.users WHERE email LIKE 'p7x.%@example.test') users,
            (SELECT count(*)::int FROM contract_billing_release_authorities) authorities,
            (SELECT count(*)::int FROM finance_receivables) ar,
            (SELECT count(*)::int FROM finance_settlements) settle,
            (SELECT count(*)::int FROM finance_reconciliations) recon,
            (SELECT count(*)::int FROM finance_payment_sources) sources,
            (SELECT count(*)::int FROM fiscal_documents) docs,
            (SELECT count(*)::int FROM ledger_entry) ledger`);
  for (const [k, v] of Object.entries(residue)) must(`resíduo zero: ${k}`, Number(v) === 0, String(v));

  console.log('\n=== PORTÃO PÓS-APLICAÇÃO ===');
  must('TRUNCATE de navegador continua ZERO',
    (await one(`SELECT count(*)::int n FROM information_schema.role_table_grants
                 WHERE table_schema='public' AND privilege_type='TRUNCATE'
                   AND grantee IN ('anon','authenticated')`)).n === 0);
  must('registro descreve o diretório depois da aplicação',
    (await assertRegistryMatches(c, { files, expectedAbsent: ['090'] })).length === 0);

  const after = await one(
    `SELECT (SELECT count(*)::int FROM contract_billing_events) billing,
            (SELECT count(*)::int FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id
              WHERE p.key LIKE 'contracts.billing.%') billing_grants`);
  must('nenhum faturamento fabricado', after.billing === before.billing,
    `${before.billing} → ${after.billing}`);
  must('ZERO concessão automática de contracts.billing.* resta', after.billing_grants === 0,
    `${before.billing_grants} → ${after.billing_grants}`);
  must('vocabulário de permissões preservado',
    (await one(`SELECT count(*)::int n FROM permissions
                 WHERE key IN ('contracts.billing.release','contracts.billing.adjust')`)).n === 2);

  if (APPLY && ok) {
    await c.query('COMMIT');
    console.log('\n### COMETIDO ###');
  } else {
    await c.query('ROLLBACK');
    console.log(APPLY ? '\n### ROLLBACK: bateria vermelha ###' : '\n### ROLLBACK (ensaio) ###');
  }
} catch (e) {
  ok = false;
  try { await c.query('ROLLBACK'); } catch { /* já desfeita */ }
  console.error('\nFALHA:', e.message);
} finally {
  await c.end();
}

console.log(ok ? 'VERDE' : 'VERMELHO');
process.exit(ok ? 0 : 1);
