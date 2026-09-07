/**
 * Fase 7 — aplicação das migrations 135–139 (cadeia contrato-a-caixa).
 *
 *   node scripts/apply-contracts-v2-phase7.mjs           # ENSAIO (ROLLBACK)
 *   node scripts/apply-contracts-v2-phase7.mjs --apply   # COMETE
 *
 * O ensaio exercita o MESMO caminho do modo aplicar, incluindo a bateria
 * inteira contra organizações descartáveis. Um ensaio que só criasse tabelas
 * provaria que o DDL roda, e nada sobre a cadeia de faturamento.
 *
 * Quem aplica, registra: `recordMigrationApplied` roda DENTRO da transação.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';
import { runPhase7Assertions } from './lib/phase7-assertions.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const MIGRATIONS = [
  ['135', 'finance_tenant_hardening'],
  ['136', 'contracts_billing_entitlement'],
  ['137', 'contracts_fiscal_bridge'],
  ['138', 'finance_receivables_settlements'],
  ['139', 'contract_to_cash_read_model'],
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
  // ---------------- PORTÃO PRÉ-APLICAÇÃO ----------------
  console.log('=== PORTÃO PRÉ-APLICAÇÃO ===');
  const tip = (await one(
    `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1`)).version;
  must('ponta do registro é 134', tip === '134', tip);
  if (tip !== '134') throw new Error(`esperava 134, encontrei ${tip}`);

  const files = readdirSync('supabase/migrations')
    .filter((f) => /^\d{3}_.*\.sql$/.test(f)).map((f) => f.slice(0, 3)).sort();
  const problems = await assertRegistryMatches(c, {
    files: files.filter((v) => !MIGRATIONS.some(([m]) => m === v)),
    expectedAbsent: ['090'],
  });
  must('registro consistente com o diretório (090 arquivada)', problems.length === 0, problems.join('; '));

  must('090 continua fora do registro',
    (await one(`SELECT count(*)::int n FROM supabase_migrations.schema_migrations WHERE version='090'`)).n === 0);

  for (const [v] of MIGRATIONS) {
    must(`sem colisão de versão em ${v}`,
      (await one(`SELECT count(*)::int n FROM supabase_migrations.schema_migrations WHERE version=$1`, [v])).n === 0);
  }

  const t0 = await one(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')`);
  must('TRUNCATE de navegador é ZERO antes de aplicar', t0.n === 0, String(t0.n));

  must('Grafo de Eventos saudável (Fase 4 intacta)',
    (await one(`SELECT to_regclass('public.domain_events') r`)).r !== null);
  must('apex_jobs saudável', (await one(`SELECT to_regclass('public.apex_jobs') r`)).r !== null);
  must('Motor de Aprovação saudável (Fase 5 intacta)',
    (await one(`SELECT to_regclass('public.approval_requests') r`)).r !== null);
  must('Medição de Projeto saudável (Fase 6 intacta)',
    (await one(`SELECT to_regclass('public.project_measurements') r`)).r !== null);
  must('fundação Fiscal presente e com portão de produção',
    (await one(`SELECT to_regclass('public.fiscal_production_gates') r`)).r !== null);

  /*
    Os números de PARTIDA das tabelas legadas de Finanças. Eles são a base de
    comparação do portão pós-aplicação: a §125 proíbe reescrever história, e a
    forma de provar que não se reescreveu é contar antes e contar depois.
  */
  const before = await one(
    `SELECT (SELECT count(*)::int FROM apar_title) apar,
            (SELECT count(*)::int FROM ledger_entry) ledger,
            (SELECT count(*)::int FROM contract_billing_events) billing,
            (SELECT count(*)::int FROM contract_milestones WHERE measured_amount IS NOT NULL) medidos`);
  console.log(`   · linhas ANTES: apar_title=${before.apar} ledger_entry=${before.ledger} `
    + `contract_billing_events=${before.billing} marcos com valor apurado=${before.medidos}`);

  if (!ok) throw new Error('portão pré-aplicação vermelho');

  // ---------------- APLICAÇÃO ----------------
  console.log('\n=== APLICAÇÃO ===');
  await c.query('BEGIN');
  for (const [version, name] of MIGRATIONS) {
    const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8')
      .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
    await c.query(sql);
    await recordMigrationApplied(c, version, name);
    must(`${version} aplicada e registrada`, true);
  }

  // ---------------- BATERIA ----------------
  const battery = await runPhase7Assertions(c, { must, one });
  if (!battery) ok = false;

  // ---------------- LIMPEZA DO CENÁRIO ----------------
  /*
    O cenário descartável sai ANTES do commit, e a limpeza é VERIFICADA, não
    declarada. A §100 é explícita: saída de ensaio não é prova de limpeza.

    Apagar a organização cascateia para projeto, contrato, marco, medição,
    faturamento, pedido fiscal, alocação, recebível, parcela, liquidação,
    conciliação e evento. Os usuários descartáveis não pendem da organização e
    saem por e-mail.
  */
  console.log('\n=== LIMPEZA DO CENÁRIO DESCARTÁVEL ===');
  /*
    A ORDEM importa, e ela não é acidental.

    Boa parte das FKs da Fase 7 é ON DELETE RESTRICT de propósito: um direito
    de faturamento não pode perder a medição que o originou, e um recebível não
    pode perder a liquidação que o pagou. Isso é o que impede apagamento
    silencioso em produção — e é também o que obriga esta limpeza a descer a
    cadeia na ordem inversa da criação, em vez de mandar um DELETE na
    organização e torcer.

    Desabilitar gatilhos para apagar mais rápido seria pior que inútil: a
    cascata do PostgreSQL É gatilho, e desligá-la deixaria órfãos exatamente no
    lugar onde o portão pós-aplicação vai contar resíduo.
  */
  const disposable = `(SELECT id FROM organizations WHERE name LIKE '[P7]%')`;
  for (const stmt of [
    `DELETE FROM finance_reconciliation_candidates WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_reconciliations WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_settlements WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_receivable_installments WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_receivables WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_payment_sources WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_billing_fiscal_allocations WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_billing_fiscal_requests WHERE organization_id IN ${disposable}`,
    `DELETE FROM fiscal_jobs WHERE organization_id IN ${disposable}`,
    `DELETE FROM fiscal_documents WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_billing_events WHERE organization_id IN ${disposable}`,
    `DELETE FROM project_measurements WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_measurement_requirements WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_obligation_instances WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_obligation_definitions WHERE organization_id IN ${disposable}`,
    `DELETE FROM contract_billing_entitlement_rules WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_receivable_basis_policies WHERE organization_id IN ${disposable}`,
    `DELETE FROM finance_posting_rules WHERE organization_id IN ${disposable}`,
    `DELETE FROM projects WHERE organization_id IN ${disposable}`,
  ]) {
    await c.query(stmt);
  }
  const orgsGone = await one(
    `WITH d AS (DELETE FROM organizations WHERE name LIKE '[P7]%' RETURNING 1)
     SELECT count(*)::int n FROM d`);
  must('organizações descartáveis apagadas', true, `${orgsGone.n} organizações`);
  const usersGone = await one(
    `WITH d AS (DELETE FROM auth.users WHERE email LIKE 'p7.%@example.test' RETURNING 1)
     SELECT count(*)::int n FROM d`);
  must('usuários descartáveis apagados', true, `${usersGone.n} usuários`);

  const residue = await one(
    `SELECT (SELECT count(*)::int FROM finance_receivables) ar,
            (SELECT count(*)::int FROM finance_settlements) settle,
            (SELECT count(*)::int FROM finance_reconciliations) recon,
            (SELECT count(*)::int FROM finance_payment_sources) sources,
            (SELECT count(*)::int FROM contract_billing_fiscal_requests) freq,
            (SELECT count(*)::int FROM contract_billing_fiscal_allocations) falloc,
            (SELECT count(*)::int FROM fiscal_documents) docs,
            (SELECT count(*)::int FROM fiscal_jobs) fjobs,
            (SELECT count(*)::int FROM finance_receivable_basis_policies) basis,
            (SELECT count(*)::int FROM ledger_entry) ledger,
            (SELECT count(*)::int FROM project_measurements) medicoes,
            (SELECT count(*)::int FROM organizations WHERE name LIKE '[P7]%') orgs,
            (SELECT count(*)::int FROM domain_events
              WHERE aggregate_type IN ('contract_billing_event','fiscal_document','finance_receivable')) evs`);
  for (const [label, n] of Object.entries(residue)) {
    must(`resíduo zero: ${label}`, Number(n) === 0, String(n));
  }

  // ---------------- PORTÃO PÓS-APLICAÇÃO ----------------
  console.log('\n=== PORTÃO PÓS-APLICAÇÃO ===');
  const t1 = await one(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')`);
  must('TRUNCATE de navegador continua ZERO', t1.n === 0, String(t1.n));

  must('registro descreve o diretório depois da aplicação',
    (await assertRegistryMatches(c, { files, expectedAbsent: ['090'] })).length === 0);

  const after = await one(
    `SELECT (SELECT count(*)::int FROM apar_title) apar,
            (SELECT count(*)::int FROM ledger_entry) ledger,
            (SELECT count(*)::int FROM contract_billing_events) billing,
            (SELECT count(*)::int FROM contract_milestones WHERE measured_amount IS NOT NULL) medidos`);
  must('nenhuma linha legada de apar_title criada ou perdida (§125)', after.apar === before.apar,
    `${before.apar} → ${after.apar}`);
  must('nenhuma linha legada de ledger_entry criada ou perdida (§125)', after.ledger === before.ledger,
    `${before.ledger} → ${after.ledger}`);
  must('nenhum faturamento fabricado em produção (§139)', after.billing === before.billing,
    `${before.billing} → ${after.billing}`);
  must('nenhum valor apurado legado alterado (§13)', after.medidos === before.medidos,
    `${before.medidos} → ${after.medidos}`);

  must('nenhuma organização [P7] restante',
    (await one(`SELECT count(*)::int n FROM organizations WHERE name LIKE '[P7]%'`)).n === 0);

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
