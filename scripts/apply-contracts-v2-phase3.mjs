/**
 * Aplicador da Fase 3 do Contracts V2 — motor de obrigações (114, 115, 116).
 *
 *   node scripts/apply-contracts-v2-phase3.mjs           # ENSAIO: aplica e faz ROLLBACK
 *   node scripts/apply-contracts-v2-phase3.mjs --apply   # aplica de verdade (COMMIT)
 *
 * As três vão na MESMA transação, junto com a gravação no registro canônico de
 * migrations — a 115 depende dos alvos compostos da 114, e a 116 das duas. Meia
 * fase aplicada deixa o banco num estado que nenhum teste descreve.
 *
 *   114  definições, partes contratuais, proveniência, linhagem
 *   115  instâncias, recorrência idempotente, prazo, dependências, histórico
 *   116  evidência, dispensa/exceção, escalonamento, impacto financeiro,
 *        fronteira da lista de tarefas legada
 *   117  ativação derivada da regra (substitui a materialização da 115)
 *
 * O ensaio é o padrão: roda o mesmo SQL contra os dados REAIS desta base, prova
 * o resultado com dado descartável, e desfaz. Nada é aplicado sem `--apply`, e
 * nem com `--apply` se uma prova falhar.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
import { recordMigrationApplied, assertRegistryMatches } from './lib/migration-registry.mjs';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');
const FILES = [
  ['114', 'contract_obligation_definitions', '114_contract_obligation_definitions.sql'],
  ['115', 'contract_obligation_instances', '115_contract_obligation_instances.sql'],
  ['116', 'contract_obligation_evidence_and_boundaries', '116_contract_obligation_evidence_and_boundaries.sql'],
  // A 117 substitui a materialização da 115 para derivar a ativação da regra.
  // Vai junto porque uma base que pare na 116 resolveria toda obrigação como
  // DESCONHECIDA — estado que nenhum teste desta fase descreve.
  ['117', 'contract_obligation_activation', '117_contract_obligation_activation.sql'],
];

const PHASE3_TABLES = `('contract_obligation_definitions','contract_obligation_parties',
  'contract_obligation_instances','contract_obligation_instance_history',
  'contract_obligation_dependencies','contract_obligation_instance_dependencies',
  'contract_obligation_evidence_requirements','contract_obligation_evidence',
  'contract_obligation_exceptions','contract_obligation_escalation_rules',
  'contract_obligation_financial_impacts')`;

/** Verdade contratual já gravada, comparada antes e depois da DDL. */
const FINGERPRINT = `
  SELECT 'contracts' t, count(*) n, md5(coalesce(string_agg(
    (id,organization_id,title,contract_number,counterparty_name,status,start_date,end_date,
     total_value,data_class,deleted_at)::text,'' ORDER BY id),'')) f FROM contracts
  UNION ALL SELECT 'clauses', count(*), md5(coalesce(string_agg(
    (id,organization_id,contract_id,title,content,source_page)::text,'' ORDER BY id),'')) FROM contract_clauses
  UNION ALL SELECT 'amendments', count(*), md5(coalesce(string_agg(
    (id,organization_id,contract_id,amendment_number,effective_date)::text,'' ORDER BY id),'')) FROM contract_amendments
  UNION ALL SELECT 'documents', count(*), md5(coalesce(string_agg(
    (id,organization_id,contract_id,title,file_path)::text,'' ORDER BY id),'')) FROM contract_documents
  UNION ALL SELECT 'milestones', count(*), md5(coalesce(string_agg(
    (id,organization_id,contract_id,title,due_date,status)::text,'' ORDER BY id),'')) FROM contract_milestones
  UNION ALL SELECT 'legacy_obligations', count(*), md5(coalesce(string_agg(
    (id,organization_id,contract_id,title,status,due_date,evidence,completed_at)::text,'' ORDER BY id),''))
    FROM contract_obligations`;

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => console.log(`   NOTICE: ${n.message}`));
await c.connect();
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### ENSAIO (ROLLBACK ao final) ###');

let ok = true;
const line = (label, value) => console.log(`   ${label.padEnd(46, '.')} ${value}`);

try {
  // ---------- PREFLIGHT ----------
  console.log('\n=== PREFLIGHT (somente leitura) ===');
  const stops = [];

  const [{ version: tip }] = (await c.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1')).rows;
  line('ponta do registro de migrations', tip);
  if (tip !== '113') stops.push(`registro em ${tip}; a 114 espera 113.`);

  const registryProblems = await assertRegistryMatches(c, {
    files: Array.from({ length: 113 }, (_, i) => String(i + 1).padStart(3, '0')).filter(v => v !== '090'),
    expectedAbsent: ['090'],
  });
  line('registro descreve o diretório', registryProblems.length === 0 ? 'sim' : `NÃO (${registryProblems.length})`);
  for (const p of registryProblems) stops.push(`registro: ${p}`);

  const already = (await c.query(`SELECT count(*) n FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname IN ${PHASE3_TABLES}`)).rows[0].n;
  line('tabelas da Fase 3 já presentes', `${already}/11`);
  if (already !== '0') stops.push(`${already} tabela(s) da Fase 3 já existem — migration aplicada é registro, não rascunho.`);

  // A Fase 3 pendura tudo nos alvos compostos que a Fase 2 criou.
  const targets = (await c.query(`SELECT count(*) n FROM pg_indexes WHERE schemaname='public'
     AND indexname IN ('contracts_org_id_phase2','clauses_org_contract_id_phase2',
       'documents_org_contract_id_phase2','amendments_org_contract_id_phase2')`)).rows[0].n;
  line('alvos compostos da Fase 2 disponíveis', `${targets}/4`);
  if (targets !== '4') stops.push('faltam alvos compostos da Fase 2 — a Fase 3 não pode referenciar cláusula/documento/aditivo por inquilino.');

  for (const fn of ['contracts_reject_history_mutation', 'contracts_reject_history_erasure']) {
    const has = (await c.query(`SELECT count(*) n FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace`, [fn])).rows[0].n;
    if (has === '0') stops.push(`função ${fn}() ausente — a Fase 3 reusa a fronteira de história da Fase 2.`);
  }

  // ---- a lista de tarefas legada ----
  const legacy = (await c.query(`SELECT count(*) total,
      count(*) FILTER (WHERE c.data_class = 'demo') demo,
      count(*) FILTER (WHERE c.data_class <> 'demo' OR c.data_class IS NULL) nao_demo
    FROM contract_obligations o JOIN contracts c ON c.id = o.contract_id`)).rows[0];
  line('lista de tarefas legada', `${legacy.total} linha(s): ${legacy.demo} demo, ${legacy.nao_demo} não-demo`);
  // Nenhuma delas é migrada. O número existe para que a mudança apareça no
  // relatório, não porque a fase vá tocar nelas.

  const orphan = (await c.query(`SELECT count(*) n FROM contract_obligations o
    LEFT JOIN contracts c ON c.id = o.contract_id AND c.organization_id = o.organization_id
    WHERE c.id IS NULL`)).rows[0].n;
  line('obrigações legadas órfãs ou cruzadas', orphan);
  if (orphan !== '0') stops.push('há obrigação legada sem contrato coerente — investigue antes de prosseguir.');

  const unrestricted = (await c.query(`SELECT count(*) n FROM pg_policies WHERE schemaname='public'
    AND tablename LIKE 'contract_%' AND (qual='true' OR with_check='true')`)).rows[0].n;
  line('políticas irrestritas em Contratos', unrestricted);
  if (unrestricted !== '0') stops.push('há política irrestrita em tabela de Contratos.');

  if (stops.length) {
    console.error('\n!!! PORTÃO DE PARADA — a Fase 3 NÃO pode ser aplicada:');
    for (const s of stops) console.error(`    · ${s}`);
    ok = false; throw new Error('preflight');
  }
  console.log('   → nenhuma condição de parada.');

  const fingerprint = async () => Object.fromEntries(
    (await c.query(FINGERPRINT)).rows.map(r => [r.t, `${r.n}:${r.f}`]));
  const before = await fingerprint();

  // ---------- APLICAÇÃO ----------
  await c.query('BEGIN');
  for (const [version, name, file] of FILES) {
    const sql = readFileSync(`supabase/migrations/${file}`, 'utf8')
      .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
    process.stdout.write(`\n-> ${file}\n`);
    await c.query(sql);
    await recordMigrationApplied(c, version, name);
    console.log('   OK (aplicada e registrada)');
  }

  // ---------- ASSERÇÕES ----------
  const must = async (label, sql, expect) => {
    const { rows } = await c.query(sql);
    const got = rows[0] ? Object.values(rows[0])[0] : null;
    const pass = String(got) === String(expect);
    console.log(`   ${pass ? '✓' : '✗'} ${label}: ${got} (esperado ${expect})`);
    if (!pass) ok = false;
  };

  console.log('\n=== ASSERÇÕES ESTRUTURAIS ===');
  await must('as 11 tabelas existem com RLS habilitada',
    `SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace
       AND relname IN ${PHASE3_TABLES} AND relrowsecurity`, 11);
  await must('nenhuma política irrestrita',
    `SELECT count(*) FROM pg_policies WHERE schemaname='public'
       AND tablename IN ${PHASE3_TABLES} AND (qual='true' OR with_check='true')`, 0);
  await must('toda tabela tem leitura escopada por organização',
    `SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname='public'
       AND tablename IN ${PHASE3_TABLES} AND cmd='SELECT'
       AND qual LIKE '%current_user_organization_id%'`, 11);
  await must('nenhuma escrita concedida a authenticated/anon',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND table_name IN ${PHASE3_TABLES} AND grantee IN ('authenticated','anon')
       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`, 0);
  await must('toda referência de inquilino é composta',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid::regclass::text IN ${PHASE3_TABLES}
       AND confrelid::regclass::text IN ('contracts','contract_clauses','contract_documents',
         'contract_amendments','parties','contract_obligation_definitions',
         'contract_obligation_instances','contract_obligation_evidence_requirements',
         'contract_obligation_dependencies')
       AND pg_get_constraintdef(oid) NOT LIKE '%(organization_id, %'`, 0);
  await must('a Party contratual usa o cadastro CANÔNICO',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid='public.contract_obligation_parties'::regclass
       AND confrelid='public.parties'::regclass`, 1);
  await must('nenhum vínculo com o razão, AR ou fiscal',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid::regclass::text IN ${PHASE3_TABLES}
       AND confrelid::regclass::text IN ('ledger_entry','apar_title','fiscal_documents')`, 0);
  await must('definição é histórica (gatilho de reescrita)',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.contract_obligations_reject_definition_rewrite()'::regprocedure`, 1);
  await must('transição registra histórico na mesma transação',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.contract_obligations_record_transition()'::regprocedure`, 1);
  await must('ciclos de dependência são rejeitados',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.contract_obligations_reject_dependency_cycle()'::regprocedure`, 1);
  await must('a materialização não é exposta ao navegador',
    `SELECT has_function_privilege('authenticated','public.contract_obligations_materialize(uuid,date,uuid)','EXECUTE')::int`, 0);
  await must('o apagamento privilegiado alcança toda linha da Fase 3',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid::regclass::text IN ${PHASE3_TABLES}
       AND confrelid::regclass::text IN ('organizations','contracts','contract_obligation_definitions',
         'contract_obligation_instances','contract_obligation_dependencies')
       AND pg_get_constraintdef(oid) NOT LIKE '%ON DELETE CASCADE%'`, 0);
  for (const t of ['contract_obligation_definitions', 'contract_obligation_instances',
    'contract_obligation_evidence', 'contract_obligation_exceptions']) {
    await must(`${t} nasce VAZIA (nenhuma obrigação inventada)`, `SELECT count(*) FROM ${t}`, 0);
  }
  console.log('\n=== FRONTEIRA DO LEGADO ===');
  await must('a lista legada NÃO foi migrada nem apagada',
    `SELECT count(*) FROM contract_obligations`, legacy.total);
  await must('a lista legada deixou de ser gravável pelo navegador',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND table_name='contract_obligations' AND grantee IN ('authenticated','anon')
       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`, 0);
  await must('a lista legada continua legível',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND table_name='contract_obligations' AND grantee='authenticated' AND privilege_type='SELECT'`, 1);
  await must('a lista legada se declara legado',
    `SELECT (obj_description('public.contract_obligations'::regclass) LIKE 'LEGADO%')::int`, 1);

  console.log('\n=== PROVAS FUNCIONAIS ===');
  await c.query(readFileSync('scripts/assert-contracts-v2-phase3.sql', 'utf8'));
  console.log('   ✓ todas as asserções de scripts/assert-contracts-v2-phase3.sql passaram');

  console.log('\n=== REGISTRO DE MIGRATIONS ===');
  for (const [v] of FILES) {
    await must(`a ${v} foi registrada como aplicada`,
      `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${v}'`, 1);
  }
  await must('a 090 continua FORA do registro',
    `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='090'`, 0);
  await must('a materialização deriva a ativação da regra',
    `SELECT count(*) FROM pg_proc WHERE proname='contract_obligations_materialize'
       AND prosrc LIKE '%days_after_contract_start%' AND prosrc LIKE '%life_state%'`, 1);

  console.log('\n=== VERDADE CONTRATUAL JÁ GRAVADA ===');
  const after = await fingerprint();
  for (const [t, hash] of Object.entries(before)) {
    const pass = after[t] === hash;
    console.log(`   ${pass ? '✓' : '✗'} ${t}: ${pass ? 'intacto' : `ALTERADO (${hash} -> ${after[t]})`}`);
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
