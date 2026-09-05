/**
 * Aplicador das migrations da Fase 2 do Contracts V2 (108, 109).
 *
 *   node scripts/apply-contracts-v2-phase2.mjs           # ENSAIO: aplica e faz ROLLBACK
 *   node scripts/apply-contracts-v2-phase2.mjs --apply   # aplica de verdade (COMMIT)
 *
 * As duas migrations vão numa transação só: a 109 depende das chaves compostas e do
 * gatilho de imutabilidade criados na 108, e meia fase aplicada deixa o banco num
 * estado que nenhum teste descreve.
 *
 *   108  linhagem temporal do instrumento   (chaves compostas por inquilino,
 *                                            revisões imutáveis de aditivo,
 *                                            contract_instrument_lineage)
 *   109  definições contratuais estruturadas (garantias, seguros, indexação,
 *                                            condições de faturamento, requisitos
 *                                            de medição; proteção da cláusula e do
 *                                            valor/prazo originais)
 *   110  fronteira reescrita vs. apagamento  (reescrever história continua
 *                                            recusado a todo mundo; apagar um
 *                                            contrato inteiro volta a ser
 *                                            possível pelo caminho privilegiado)
 *
 * O ensaio é o modo padrão de propósito: executa o mesmo SQL, roda as mesmas provas
 * contra os dados REAIS desta base, e desfaz tudo no fim. Se qualquer prova falhar,
 * o COMMIT não acontece nem com `--apply`.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
import { phase2Preflight } from './preflight-contracts-v2-phase2.mjs';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');

/**
 * Subconjunto a aplicar: `node scripts/apply-contracts-v2-phase2.mjs 110`.
 *
 * Numa base virgem da fase, 108→110 roda de ponta a ponta. Numa base que já
 * recebeu 108 e 109, reaplicá-las não é operação válida — elas CRIAM tabelas e
 * gatilhos, e migration aplicada é registro, não rascunho. As asserções e o
 * ensaio continuam valendo: rodam contra o estado completo da fase, venha ele
 * do que já está no banco ou do que esta execução acabou de aplicar.
 */
const ONLY = process.argv.filter(a => /^1\d\d$/.test(a));
const ALL_FILES = ['108_contract_temporal_lineage.sql', '109_contract_structured_definitions.sql',
  '110_contract_history_erasure_boundary.sql'];
const FILES = ONLY.length ? ALL_FILES.filter(f => ONLY.some(n => f.startsWith(n))) : ALL_FILES;
if (ONLY.length && FILES.length !== ONLY.length) {
  console.error(`!!! Migration não encontrada entre ${ONLY.join(', ')}`);
  process.exit(1);
}

/** Colunas de verdade contratual já gravada, comparadas antes e depois da DDL. */
const HISTORY_FINGERPRINT = `
  SELECT 'contracts' table_name,count(*) n,md5(coalesce(string_agg(
    (id,organization_id,title,contract_number,counterparty_name,counterparty_party_id,contract_type,status,
     lifecycle_stage,start_date,end_date,signed_date,currency,total_value,monthly_value,data_class,deleted_at)::text,
    '' ORDER BY id),'')) fingerprint FROM contracts
  UNION ALL SELECT 'clauses',count(*),md5(coalesce(string_agg(
    (id,organization_id,contract_id,clause_type,title,content,source_document_id,source_page,source_excerpt,
     amount,percentage,term_days,review_status,superseded_by_clause_id)::text,'' ORDER BY id),'')) FROM contract_clauses
  UNION ALL SELECT 'amendments',count(*),md5(coalesce(string_agg(
    (id,organization_id,contract_id,amendment_number,title,document_id,status,signed_date,effective_date,
     value_delta,value_absolute,new_end_date,term_extension_days,scope_change,notes,deleted_at)::text,
    '' ORDER BY id),'')) FROM contract_amendments
  UNION ALL SELECT 'amendment_clauses',count(*),md5(coalesce(string_agg(
    (id,organization_id,amendment_id,clause_id,replacement_clause_id,effect,note)::text,'' ORDER BY id),''))
    FROM contract_amendment_clauses`;

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
c.on('notice', n => console.log(`   NOTICE: ${n.message}`));
await c.connect();
console.log(APPLY ? '### MODO APLICAR (COMMIT) ###' : '### ENSAIO (ROLLBACK ao final) ###');
console.log(`### migrations: ${FILES.map(f => f.slice(0, 3)).join(', ')} ###`);

let ok = true;

try {
  // ---- preflight: as premissas da Fase 2, lidas ANTES de qualquer DDL ----
  console.log('\n=== PREFLIGHT (somente leitura, antes de qualquer alteração) ===');
  const report = await phase2Preflight(c);
  const line = (label, value) => console.log(`   ${label.padEnd(34, '.')} ${value}`);
  const [ct] = report.contracts, [am] = report.amendments, [cls] = report.clauses, [rel] = report.relationships;
  line('contratos', `${ct.total} (texto=${ct.historical_text}, party=${ct.canonical_party}, sem org=${ct.null_org})`);
  line('data_class', report.data_class.map(r => `${r.data_class ?? 'null'}=${r.n}`).join(' '));
  line('aditivos', `${am.total} (contratos=${am.contracts_with_amendments}, valor/prazo=${am.contracts_with_value_term_amendments}, sem data=${am.undated})`);
  line('cláusulas', `${cls.total} (documento=${cls.source_documents}, página=${cls.source_pages}, substituídas=${cls.superseded})`);
  line('relações aditivo-cláusula', rel.total);
  line('erros de posse/órfãos', report.ownership_errors.map(r => `${r.table_name}=${r.n}`).join(' '));
  line('aditivos ambíguos', `${report.duplicate_amendments.length} + ${report.duplicate_links.length} vínculos`);
  line('registro de migrations', report.registry_tip.map(r => r.version).join(',') || '(vazio)');
  line('baseline estrutural Fase 1', `${report.phase1_columns.length} colunas, ${report.phase1_fks.length} FKs, ${report.phase1_rls.filter(r => r.relrowsecurity).length}/6 RLS`);
  line('políticas irrestritas', report.unrestricted_policies.length);

  if (report.stops.length) {
    console.error('\n!!! PORTÃO DE PARADA — a Fase 2 NÃO pode prosseguir:');
    for (const s of report.stops) console.error(`    · ${s}`);
    console.error('    Nada foi gravado. Replaneje antes de tentar de novo.');
    ok = false; throw new Error('preflight');
  }
  console.log('   → nenhuma condição de parada. Premissas da Fase 2 confirmadas.');

  // Impressão digital do histórico: o mesmo hash antes e depois prova que a DDL
  // não reescreveu contrato, cláusula, aditivo nem relação já gravada. As colunas
  // são listadas de propósito — a 108 ACRESCENTA contract_id às relações, e uma
  // coluna nova não é reescrita de história; conteúdo alterado seria.
  const fingerprint = async () => Object.fromEntries((await c.query(HISTORY_FINGERPRINT)).rows
    .map(r => [r.table_name, `${r.n}:${r.fingerprint}`]));
  const before = await fingerprint();

  await c.query('BEGIN');
  for (const f of FILES) {
    const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
      .replace(/^\s*BEGIN;\s*$/gm, '').replace(/^\s*COMMIT;\s*$/gm, '');
    process.stdout.write(`\n-> ${f}\n`);
    await c.query(sql);
    console.log('   OK');
  }

  const must = async (label, sql, expect) => {
    const { rows } = await c.query(sql);
    const got = rows[0] ? Object.values(rows[0])[0] : null;
    const pass = String(got) === String(expect);
    console.log(`   ${pass ? '✓' : '✗'} ${label}: ${got} (esperado ${expect})`);
    if (!pass) ok = false;
  };

  console.log('\n=== ASSERÇÕES ESTRUTURAIS ===');
  const NEW_TABLES = `('contract_instrument_lineage','contract_amendment_revisions','contract_guarantees',
    'contract_insurance_requirements','contract_indexation_rules','contract_billing_conditions',
    'contract_measurement_requirements')`;
  await must('as 7 tabelas novas existem com RLS habilitada',
    `SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace
       AND relname IN ${NEW_TABLES} AND relrowsecurity`, 7);
  await must('nenhuma política irrestrita nas tabelas novas',
    `SELECT count(*) FROM pg_policies WHERE schemaname='public'
       AND tablename IN ${NEW_TABLES} AND (qual='true' OR with_check='true')`, 0);
  await must('toda tabela nova tem política de leitura por inquilino',
    `SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname='public'
       AND tablename IN ${NEW_TABLES} AND cmd='SELECT'
       AND qual LIKE '%current_user_organization_id%'`, 7);
  await must('nenhuma tabela nova concede UPDATE ou DELETE a authenticated',
    `SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public'
       AND table_name IN ${NEW_TABLES} AND grantee IN ('authenticated','anon')
       AND privilege_type IN ('UPDATE','DELETE')`, 0);
  await must('todo fato estruturado referencia o contrato por chave composta',
    `SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid='public.contracts'::regclass
       AND conrelid::regclass::text IN ('contract_guarantees','contract_insurance_requirements',
         'contract_indexation_rules','contract_billing_conditions','contract_measurement_requirements',
         'contract_instrument_lineage')
       AND pg_get_constraintdef(oid) LIKE '%(organization_id, contract_id)%'`, 6);
  await must('toda referência a Party é coerente por inquilino',
    `SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid='public.parties'::regclass
       AND conrelid::regclass::text IN ('contract_guarantees','contract_insurance_requirements',
         'contract_billing_conditions','contract_measurement_requirements')
       AND pg_get_constraintdef(oid) LIKE '%(organization_id, %'`, 6);
  await must('histórico de aditivo e linhagem são append-only',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.contracts_reject_history_mutation()'::regprocedure`, 8);
  await must('apagar história é recusado à aplicação em toda tabela contratual',
    `SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND tgfoid='public.contracts_reject_history_erasure()'::regprocedure`, 9);
  await must('o apagamento privilegiado alcança toda linha da Fase 2',
    `SELECT count(*) FROM pg_constraint WHERE contype='f'
       AND conrelid::regclass::text IN ('contract_guarantees','contract_insurance_requirements',
         'contract_indexation_rules','contract_billing_conditions','contract_measurement_requirements',
         'contract_instrument_lineage','contract_amendment_revisions','contract_amendment_clauses')
       AND confrelid::regclass::text IN ('contracts','contract_amendments','contract_clauses',
         'contract_documents','contract_milestones','contract_guarantees','contract_insurance_requirements',
         'contract_indexation_rules','contract_billing_conditions','contract_measurement_requirements')
       AND pg_get_constraintdef(oid) NOT LIKE '%ON DELETE CASCADE%'`, 0);
  await must('nenhum aditivo perdeu escopo de contrato',
    `SELECT count(*) FROM contract_amendment_clauses l JOIN contract_amendments a ON a.id=l.amendment_id
       WHERE l.contract_id IS DISTINCT FROM a.contract_id`, 0);
  // A linhagem só nasce de um ato explícito: a migration não faz backfill, e o
  // único caminho de escrita registra quem criou. Linha sem autor seria parentesco
  // inventado por schema.
  await must('nenhuma linhagem sem autor (nenhum parentesco inventado)',
    'SELECT count(*) FROM contract_instrument_lineage WHERE created_by IS NULL', 0);
  for (const t of ['contract_guarantees', 'contract_insurance_requirements', 'contract_indexation_rules',
    'contract_billing_conditions', 'contract_measurement_requirements']) {
    await must(`${t} nasce VAZIA (nenhum fato contratual inventado)`, `SELECT count(*) FROM ${t}`, 0);
  }
  await must('cada aditivo existente tem exatamente uma revisão de base',
    `SELECT count(*) FROM contract_amendments a
       WHERE (SELECT count(*) FROM contract_amendment_revisions r WHERE r.amendment_id=a.id)<>1`, 0);

  console.log('\n=== PROVAS FUNCIONAIS (FK, linhagem, imutabilidade e RLS com dado descartável) ===');
  await c.query(readFileSync('scripts/assert-contracts-v2-phase2.sql', 'utf8'));
  console.log('   ✓ todas as asserções de scripts/assert-contracts-v2-phase2.sql passaram');

  console.log('\n=== HISTÓRICO CONTRATUAL ===');
  const after = await fingerprint();
  for (const [t, hash] of Object.entries(before)) {
    const pass = after[t] === hash;
    console.log(`   ${pass ? '✓' : '✗'} ${t}: ${pass ? 'intacto' : `REESCRITO (${hash} -> ${after[t]})`}`);
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
