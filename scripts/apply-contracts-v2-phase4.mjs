/**
 * Aplicador da Fase 4 do Contracts V2 — grafo de eventos e trabalho durável.
 *
 *   node scripts/apply-contracts-v2-phase4.mjs           # ENSAIO: aplica e faz ROLLBACK
 *   node scripts/apply-contracts-v2-phase4.mjs --apply   # aplica de verdade (COMMIT)
 *
 * As quatro vão na MESMA transação, junto com a gravação no registro canônico:
 * a 120 chama funções da 119, a 121 registra um provedor de rota que a 120
 * criou, e a 122 referencia `apex_jobs`. Meia fase aplicada deixaria o banco
 * num estado que nenhum teste descreve.
 *
 *   119  domain_events, emissor controlado, registro de rotas
 *   120  apex_jobs, reivindicação com SKIP LOCKED, concessão, ceifa, roteamento
 *   121  vínculos de evento de Contratos, emissão transacional, ativação externa,
 *        produtor de materialização
 *   122  pedido durável de extração de cláusulas
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
  ['119', 'platform_domain_events', '119_platform_domain_events.sql'],
  ['120', 'platform_apex_jobs', '120_platform_apex_jobs.sql'],
  ['121', 'contracts_event_bindings_and_emission', '121_contracts_event_bindings_and_emission.sql'],
  ['122', 'contracts_clause_extraction_queue', '122_contracts_clause_extraction_queue.sql'],
];

const PHASE4_TABLES = `('domain_events','apex_jobs','apex_event_routes',
  'apex_dynamic_route_providers','contract_obligation_event_bindings',
  'contract_clause_extraction_requests')`;

/** Verdade já gravada — contratual e de obrigações — comparada antes e depois. */
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
  UNION ALL SELECT 'obligation_definitions', count(*), md5(coalesce(string_agg(
    (id,organization_id,contract_id,title,activation_kind,due_kind,recurrence_kind,status)::text,
    '' ORDER BY id),'')) FROM contract_obligation_definitions
  UNION ALL SELECT 'obligation_instances', count(*), md5(coalesce(string_agg(
    (id,organization_id,definition_id,occurrence_key,state,activation_state,activated_at,
     due_date,due_confidence)::text,'' ORDER BY id),'')) FROM contract_obligation_instances
  UNION ALL SELECT 'obligation_history', count(*), md5(coalesce(string_agg(
    (id,instance_id,previous_state,next_state,transition)::text,'' ORDER BY id),''))
    FROM contract_obligation_instance_history
  UNION ALL SELECT 'fiscal_documents', count(*), md5(coalesce(string_agg(
    (id,organization_id,status)::text,'' ORDER BY id),'')) FROM fiscal_documents
  UNION ALL SELECT 'fiscal_jobs', count(*), md5(coalesce(string_agg(
    (id,organization_id,status)::text,'' ORDER BY id),'')) FROM fiscal_jobs`;

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => console.log(`   NOTICE: ${n.message}`));
await c.connect();
await c.query('SET SESSION default_transaction_read_only = off');
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### ENSAIO (ROLLBACK ao final) ###');

let ok = true;
const line = (label, value) => console.log(`   ${label.padEnd(48, '.')} ${value}`);

try {
  // ---------- PREFLIGHT ----------
  console.log('\n=== PREFLIGHT (somente leitura) ===');
  const stops = [];

  const [{ version: tip }] = (await c.query(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1')).rows;
  line('ponta do registro de migrations', tip);
  if (tip !== '118') stops.push(`registro em ${tip}; a 119 espera 118.`);

  const registryProblems = await assertRegistryMatches(c, {
    files: Array.from({ length: 118 }, (_, i) => String(i + 1).padStart(3, '0')).filter(v => v !== '090'),
    expectedAbsent: ['090'],
  });
  line('registro descreve o diretório', registryProblems.length === 0 ? 'sim' : `NÃO (${registryProblems.length})`);
  for (const p of registryProblems) stops.push(`registro: ${p}`);

  const already = (await c.query(`SELECT count(*) n FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname IN ${PHASE4_TABLES}`)).rows[0].n;
  line('tabelas da Fase 4 já presentes', `${already}/6`);
  if (already !== '0') stops.push(`${already} tabela(s) da Fase 4 já existem — migration aplicada é registro, não rascunho.`);

  // A Fase 4 pendura a emissão nos gatilhos e nas funções da Fase 3.
  for (const fn of ['contract_obligations_materialize', 'contract_obligations_record_transition',
    'contracts_reject_history_erasure', 'current_user_organization_id']) {
    const has = (await c.query(
      `SELECT count(*) n FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace`, [fn])).rows[0].n;
    if (has === '0') stops.push(`função ${fn}() ausente — a Fase 4 depende dela.`);
  }
  line('funções da Fase 3 disponíveis', 'sim');

  const truncate = (await c.query(`SELECT count(*) n FROM information_schema.role_table_grants
    WHERE table_schema='public' AND privilege_type='TRUNCATE' AND grantee IN ('anon','authenticated')`)).rows[0].n;
  line('TRUNCATE de navegador (esperado 0)', truncate);
  if (truncate !== '0') stops.push('o endurecimento da 118 regrediu — investigue o dono e o ACL padrão antes de criar tabela nova.');

  // O Fiscal continua dono da fila dele. A Fase 4 não a substitui.
  const fiscalJobs = (await c.query(
    `SELECT count(*) n FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='fiscal_jobs'`)).rows[0].n;
  line('fiscal_jobs presente e intocada', fiscalJobs === '1' ? 'sim' : 'NÃO');
  if (fiscalJobs !== '1') stops.push('fiscal_jobs desapareceu — a Fase 4 não pode prosseguir sem entender por quê.');

  const unrestricted = (await c.query(`SELECT count(*) n FROM pg_policies WHERE schemaname='public'
    AND tablename LIKE 'contract_%' AND (qual='true' OR with_check='true')`)).rows[0].n;
  line('políticas irrestritas em Contratos', unrestricted);
  if (unrestricted !== '0') stops.push('há política irrestrita em tabela de Contratos.');

  if (stops.length) {
    console.error('\n!!! PORTÃO DE PARADA — a Fase 4 NÃO pode ser aplicada:');
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

  // ---------- ASSERÇÕES ESTRUTURAIS ----------
  const must = async (label, sql, expect) => {
    const { rows } = await c.query(sql);
    const got = rows[0] ? Object.values(rows[0])[0] : null;
    const pass = String(got) === String(expect);
    console.log(`   ${pass ? '✓' : '✗'} ${label}: ${got} (esperado ${expect})`);
    if (!pass) ok = false;
  };

  console.log('\n=== ASSERÇÕES ESTRUTURAIS ===');
  await must('as 6 tabelas existem com RLS habilitada',
    `SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace
       AND relname IN ${PHASE4_TABLES} AND relrowsecurity`, 6);
  await must('nenhuma escrita concedida a authenticated/anon',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND table_name IN ${PHASE4_TABLES} AND grantee IN ('authenticated','anon')
       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`, 0);
  await must('a fila e o grafo são INVISÍVEIS ao navegador',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND table_name IN ('domain_events','apex_jobs','apex_event_routes','apex_dynamic_route_providers')
       AND grantee IN ('authenticated','anon')`, 0);
  await must('trabalho e evento são presos ao MESMO inquilino',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid='public.apex_jobs'::regclass AND confrelid='public.domain_events'::regclass
       AND pg_get_constraintdef(oid) LIKE '%(organization_id, event_id)%'`, 1);
  await must('causação é presa ao MESMO inquilino',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid='public.domain_events'::regclass AND confrelid='public.domain_events'::regclass
       AND pg_get_constraintdef(oid) LIKE '%(organization_id, causation_event_id)%'`, 1);
  await must('o vínculo de obrigação usa alvo composto',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid='public.contract_obligation_event_bindings'::regclass
       AND confrelid='public.contract_obligation_definitions'::regclass
       AND pg_get_constraintdef(oid) LIKE '%(organization_id, contract_id, definition_id)%'`, 1);
  await must('o fato é imutável por gatilho',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.domain_events_reject_fact_rewrite()'::regprocedure`, 1);
  await must('apagar evento é recusado à aplicação',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid='public.domain_events'::regclass
       AND tgfoid='public.contracts_reject_history_erasure()'::regprocedure`, 1);
  await must('a emissão é transacional (3 gatilhos de saída)',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgfoid IN (
       'public.contract_obligations_emit_transition_event()'::regprocedure,
       'public.contract_obligations_emit_evidence_event()'::regprocedure,
       'public.contracts_emit_amendment_created_event()'::regprocedure)`, 3);
  await must('a reivindicação usa FOR UPDATE SKIP LOCKED',
    `SELECT count(*) FROM pg_proc WHERE proname='apex_jobs_claim'
       AND prosrc LIKE '%FOR UPDATE SKIP LOCKED%'`, 1);
  await must('concluir exige o token corrente',
    `SELECT count(*) FROM pg_proc WHERE proname='apex_jobs_complete'
       AND prosrc LIKE '%lock_token = p_lock_token%'`, 1);
  await must('o ceifador INVALIDA o token antigo',
    `SELECT count(*) FROM pg_proc WHERE proname='apex_jobs_reap' AND prosrc LIKE '%lock_token = NULL%'`, 1);
  await must('o provedor de rota de Contratos está registrado',
    `SELECT count(*) FROM apex_dynamic_route_providers
       WHERE provider_function='public.contracts_obligation_activation_routes' AND enabled`, 1);
  await must('o registro ESTÁTICO de rotas nasce vazio',
    `SELECT count(*) FROM apex_event_routes`, 0);
  for (const t of ['domain_events', 'apex_jobs', 'contract_obligation_event_bindings',
    'contract_clause_extraction_requests']) {
    await must(`${t} nasce VAZIA (nenhum fato histórico fabricado)`, `SELECT count(*) FROM ${t}`, 0);
  }

  console.log('\n=== FRONTEIRA DO FISCAL E DO PONTO ===');
  await must('fiscal_jobs continua existindo, intocada',
    `SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='fiscal_jobs'`, 1);
  await must('nenhuma FK nova aponta para fiscal_jobs',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid::regclass::text IN ${PHASE4_TABLES}
       AND confrelid='public.fiscal_jobs'::regclass`, 0);
  await must('ponto_job_runs continua existindo, intocada',
    `SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='ponto_job_runs'`, 1);

  console.log('\n=== PROVAS FUNCIONAIS ===');
  await c.query('SAVEPOINT provas');
  await c.query(readFileSync('scripts/assert-contracts-v2-phase4.sql', 'utf8'));
  // As provas criam e apagam o próprio cenário; o SAVEPOINT é a segunda
  // garantia de que nada delas atravessa para a base real.
  await c.query('ROLLBACK TO SAVEPOINT provas');
  console.log('   ✓ todas as asserções de scripts/assert-contracts-v2-phase4.sql passaram');

  console.log('\n=== REGISTRO DE MIGRATIONS ===');
  for (const [v] of FILES) {
    await must(`a ${v} foi registrada como aplicada`,
      `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='${v}'`, 1);
  }
  await must('a 090 continua FORA do registro',
    `SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='090'`, 0);

  console.log('\n=== VERDADE JÁ GRAVADA ===');
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
