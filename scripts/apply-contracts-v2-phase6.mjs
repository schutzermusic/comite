/**
 * Fase 6 — aplicação das migrations 130–134 (Medição de Projeto).
 *
 *   node scripts/apply-contracts-v2-phase6.mjs           # ENSAIO (ROLLBACK)
 *   node scripts/apply-contracts-v2-phase6.mjs --apply   # COMETE
 *
 * O ensaio exercita o MESMO caminho do modo aplicar, incluindo a bateria
 * inteira contra organizações descartáveis. Um ensaio que só criasse tabelas
 * provaria que o DDL roda, e nada sobre o motor de medição.
 *
 * Quem aplica, registra: `recordMigrationApplied` roda DENTRO da transação.
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';
import { runPhase6Assertions } from './lib/phase6-assertions.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const MIGRATIONS = [
  ['130', 'project_measurements'],
  ['131', 'project_measurement_evidence'],
  ['132', 'project_measurement_readiness'],
  ['133', 'project_measurement_runtime'],
  ['134', 'project_measurement_candidates_and_legacy'],
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
  must('ponta do registro é 129', tip === '129', tip);
  if (tip !== '129') throw new Error(`esperava 129, encontrei ${tip}`);

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

  must('Motor de Aprovação saudável (Fase 5 intacta)',
    (await one(`SELECT to_regclass('public.approval_requests') r`)).r !== null);
  must('Grafo de Eventos saudável (Fase 4 intacta)',
    (await one(`SELECT to_regclass('public.domain_events') r`)).r !== null);
  must('apex_jobs saudável', (await one(`SELECT to_regclass('public.apex_jobs') r`)).r !== null);

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
  const battery = await runPhase6Assertions(c, { must, one });
  if (!battery) ok = false;

  // ---------------- LIMPEZA DO CENÁRIO ----------------
  /*
    O cenário descartável sai ANTES do commit.

    No modo ensaio o ROLLBACK já daria conta, e foi por isso que a primeira
    versão deste runner não limpava nada — o que estava errado, e a aplicação
    real provou: as organizações `[P6]`, com as medições e os eventos delas,
    foram cometidas junto com as migrations. A §59 e a §102 pedem o contrário,
    e a §110 exige poder afirmar que nenhuma medição falsa existe em produção.

    Apagar a organização basta: `organizations` cascateia para projeto,
    contrato, medição, evidência, exigência, história e evento. Os usuários
    descartáveis não pendem da organização e saem por e-mail.
  */
  console.log('\n=== LIMPEZA DO CENÁRIO DESCARTÁVEL ===');
  const orgsGone = await one(
    `WITH d AS (DELETE FROM organizations WHERE name LIKE '[P6]%' RETURNING 1)
     SELECT count(*)::int n FROM d`);
  must('organizações descartáveis apagadas', true, `${orgsGone.n} organizações`);
  const usersGone = await one(
    `WITH d AS (DELETE FROM auth.users WHERE email LIKE 'p6.%@example.test' RETURNING 1)
     SELECT count(*)::int n FROM d`);
  must('usuários descartáveis apagados', true, `${usersGone.n} usuários`);

  must('nenhuma medição sobrou do cenário',
    (await one(`SELECT count(*)::int n FROM project_measurements`)).n === 0,
    String((await one(`SELECT count(*)::int n FROM project_measurements`)).n));
  must('nenhum evento de medição sobrou do cenário',
    (await one(`SELECT count(*)::int n FROM domain_events WHERE aggregate_type='project_measurement'`)).n === 0);

  // ---------------- PORTÃO PÓS-APLICAÇÃO ----------------
  console.log('\n=== PORTÃO PÓS-APLICAÇÃO ===');
  const t1 = await one(
    `SELECT count(*)::int n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')`);
  must('TRUNCATE de navegador continua ZERO', t1.n === 0, String(t1.n));

  must('registro descreve o diretório depois da aplicação',
    (await assertRegistryMatches(c, { files, expectedAbsent: ['090'] })).length === 0);

  // A tabela de medição fica VAZIA em produção depois desta migration. Não é
  // uma promessa sobre cuidado: é a contagem, depois da limpeza.
  must('project_measurements VAZIA em produção',
    (await one(`SELECT count(*)::int n FROM project_measurements`)).n === 0);
  must('nenhum evento de medição em produção',
    (await one(`SELECT count(*)::int n FROM domain_events WHERE aggregate_type='project_measurement'`)).n === 0);
  must('nenhuma organização [P6] restante',
    (await one(`SELECT count(*)::int n FROM organizations WHERE name LIKE '[P6]%'`)).n === 0);

  // O legado permanece EXATAMENTE como estava. A Fase 6 lê `measured_amount`;
  // não o escreve, não o move e não o apaga.
  must('nenhum marco fora do cenário teve measured_amount alterado',
    (await one(`SELECT count(*)::int n FROM contract_milestones
                 WHERE title NOT LIKE '[P6]%' AND measured_amount IS NOT NULL`)).n === 1,
    'o único marco com valor apurado é o de QA, que já existia');

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
