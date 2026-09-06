/**
 * Prova, objeto por objeto, que as migrations 089–111 estão de fato aplicadas
 * na base apontada por SUPABASE_DB_URL — e reconcilia o registro canônico
 * `supabase_migrations.schema_migrations`, que parou em 088.
 *
 *   node scripts/prove-migrations-089-111.mjs            # SÓ PROVA (não escreve nada)
 *   node scripts/prove-migrations-089-111.mjs --apply    # prova e grava as linhas faltantes
 *
 * Por que isto existe
 * -------------------
 * As migrations 089–111 foram aplicadas pelos runners de `scripts/`, que rodam o
 * arquivo dentro de uma transação com preflight e asserções reais — mas não
 * gravam linha no registro. O schema está certo; o registro é que deixou de
 * descrever o banco. Qualquer ferramenta guiada pelo registro (`supabase db push`)
 * tentaria reaplicar 089 em diante e quebraria no primeiro CREATE TABLE.
 *
 * A regra desta reconciliação é uma só: NADA é marcado como aplicado por estar
 * presente no diretório. Cada versão só entra no registro depois que TODOS os
 * seus efeitos estruturais forem encontrados no banco. Presença de arquivo não
 * é prova; efeito no schema é. Migration com efeito parcial é reportada como
 * PARCIAL e interrompe a reconciliação — meia migration aplicada é um estado
 * que nenhum runner descreve.
 *
 * Nenhum SQL de migration é reexecutado aqui. O registro é escrito com as
 * mesmas colunas que o próprio Supabase CLI usa (version, name), sem
 * `statements` — a lista de comandos serve para replay, e replay é exatamente
 * o que não deve acontecer com uma migration já aplicada.
 */
import { readdirSync } from 'node:fs';
import pg from 'pg'; import dotenv from 'dotenv';
dotenv.config({ path: '.env', quiet: true }); dotenv.config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');

/** Predicados estruturais. Cada um vira um SELECT que devolve boolean. */
const tbl = n => [`tabela ${n}`, `SELECT to_regclass('public.${n}') IS NOT NULL`];
const col = (t, c) => [`${t}.${c}`, `SELECT EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='${t}' AND column_name='${c}')`];
const colNotNull = (t, c) => [`${t}.${c} NOT NULL`, `SELECT EXISTS(SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='${t}' AND column_name='${c}' AND is_nullable='NO')`];
const idx = n => [`índice ${n}`, `SELECT EXISTS(SELECT 1 FROM pg_class WHERE relkind='i'
  AND relnamespace='public'::regnamespace AND relname='${n}')`];
const fn = n => [`função ${n}()`, `SELECT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND proname='${n}')`];
const trg = (t, n) => [`gatilho ${n} em ${t}`, `SELECT EXISTS(SELECT 1 FROM pg_trigger
  WHERE NOT tgisinternal AND tgrelid='public.${t}'::regclass AND tgname='${n}')`];
const con = (t, n) => [`constraint ${n} em ${t}`, `SELECT EXISTS(SELECT 1 FROM pg_constraint
  WHERE conrelid='public.${t}'::regclass AND conname='${n}')`];
const pol = (t, n) => [`política ${n} em ${t}`, `SELECT EXISTS(SELECT 1 FROM pg_policies
  WHERE schemaname='public' AND tablename='${t}' AND policyname='${n}')`];
const rls = t => [`RLS habilitada em ${t}`, `SELECT coalesce((SELECT relrowsecurity FROM pg_class
  WHERE relnamespace='public'::regnamespace AND relname='${t}'), false)`];
const perm = k => [`permissão ${k}`, `SELECT EXISTS(SELECT 1 FROM public.permissions WHERE key='${k}')`];
const raw = (label, sql) => [label, sql];

/**
 * Efeito estrutural de cada migration. A lista não precisa cobrir cada linha do
 * arquivo — precisa cobrir o que só existe se AQUELE arquivo rodou, e cobrir
 * cada bloco independente dele, para que uma aplicação parcial apareça.
 */
const MIGRATIONS = {
  '089': { name: 'aso_document_first', checks: [
    col('aso_documents', 'review_status'), col('aso_documents', 'document_status'),
    col('aso_documents', 'esocial_match_status'), col('aso_documents', 'validity_date'),
    col('aso_documents', 'original_file_url'), col('aso_documents', 'extracted_fields_json'),
    col('aso_documents', 'reviewed_fields_json'),
    con('aso_documents', 'aso_documents_review_status_check'),
    con('aso_documents', 'aso_documents_document_status_check'),
    con('aso_documents', 'aso_documents_esocial_match_status_check'),
    con('aso_documents', 'aso_documents_approval_needs_reviewer'),
    idx('aso_documents_pending_review_idx'), fn('touch_aso_documents'),
    trg('aso_documents', 'aso_documents_touch'),
    raw('coluna antiga aso_documents.status removida (rename ocorreu)',
      `SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='aso_documents' AND column_name='status')`),
  ] },
  '090': { name: 'fiscal_nfse', checks: [
    tbl('fiscal_establishments'), tbl('fiscal_provider_configs'), tbl('fiscal_parties'),
    tbl('fiscal_service_catalog'), tbl('fiscal_documents'), tbl('fiscal_document_items'),
    tbl('fiscal_tax_lines'), tbl('fiscal_events'), tbl('fiscal_transmission_attempts'),
    tbl('fiscal_jobs'), tbl('tax_obligation'),
    fn('protect_fiscal_document_snapshot'),
    trg('fiscal_documents', 'protect_fiscal_document_snapshot'),
    col('ledger_entry', 'organization_id'), col('apar_title', 'organization_id'),
    rls('ledger_entry'), rls('apar_title'),
    pol('ledger_entry', 'le_select'), pol('apar_title', 'apar_select'),
    perm('fiscal.view'),
    raw('bucket de storage fiscal', `SELECT EXISTS(SELECT 1 FROM storage.buckets WHERE id='fiscal-documents')`),
  ] },
  '091': { name: 'contract_data_class', checks: [
    col('contracts', 'data_class'), idx('idx_contracts_data_class'),
    con('contracts', 'contracts_data_class_check'),
  ] },
  '092': { name: 'contract_operational_instrumentation', checks: [
    idx('idx_contract_milestones_contract'), idx('idx_contract_milestones_owner'),
    idx('idx_contract_clauses_contract'), idx('idx_contract_penalties_clause'),
    idx('idx_contract_risks_links_clause'), idx('idx_contract_billing_events_milestone'),
  ] },
  '093': { name: 'contract_clause_ai_provenance', checks: [
    idx('idx_contract_clauses_ai_analysis'), idx('idx_contract_clauses_review'),
    col('contract_clauses', 'review_status'),
  ] },
  '094': { name: 'clause_analysis_lifecycle', checks: [
    idx('idx_contract_ai_analyses_contract'), idx('idx_contract_ai_analyses_document'),
    idx('idx_contract_documents_supersedes'), idx('idx_contract_documents_current'),
    idx('idx_contract_clauses_ai_fingerprint'),
  ] },
  '095': { name: 'contracts_soft_delete_select_fix', checks: [
    pol('contracts', 'contracts_select_scoped'),
    raw('a política de leitura de contratos considera deleted_at',
      `SELECT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contracts'
        AND policyname='contracts_select_scoped' AND qual LIKE '%deleted_at%')`),
  ] },
  '096': { name: 'project_teams', checks: [
    tbl('project_teams'), tbl('project_team_members'), tbl('project_timeline_team_assignments'),
    idx('project_teams_name_unique_idx'), idx('project_team_members_active_unique_idx'),
    idx('timeline_team_assignments_active_unique_idx'),
    rls('project_teams'), rls('project_team_members'), rls('project_timeline_team_assignments'),
    pol('project_teams', 'project_teams_select'), pol('project_team_members', 'project_team_members_select'),
    trg('project_teams', 'set_project_teams_updated_at'),
  ] },
  '097': { name: 'apex_session_writeback', checks: [
    col('project_work_sessions', 'resolution_method'), col('project_work_sessions', 'match_confidence'),
    idx('work_sessions_automation_key_idx'), idx('work_sessions_apex_idx'),
    pol('project_work_sessions', 'work_sessions_insert'),
    raw('project_work_sessions.source aceita apex_reconstruction',
      `SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.project_work_sessions'::regclass
        AND conname='project_work_sessions_source_check'
        AND pg_get_constraintdef(oid) LIKE '%apex_reconstruction%')`),
  ] },
  '098': { name: 'contract_amendments', checks: [
    tbl('contract_amendments'), tbl('contract_amendment_clauses'),
    idx('idx_contract_amendments_number'), idx('idx_contract_amendments_contract'),
    idx('idx_contract_amendment_clauses_amendment'),
    rls('contract_amendments'), rls('contract_amendment_clauses'),
    pol('contract_amendments', 'contract_amendments_select'),
    pol('contract_amendment_clauses', 'contract_amendment_clauses_select'),
  ] },
  '099': { name: 'tenant_isolation_reference_tables', checks: [
    colNotNull('cost_center', 'organization_id'), colNotNull('supplier', 'organization_id'),
    idx('idx_cost_center_org'), idx('idx_supplier_org'), idx('idx_cost_center_org_code'),
    rls('cost_center'), rls('supplier'),
    pol('cost_center', 'cost_center_select_scoped'), pol('supplier', 'supplier_select_scoped'),
    pol('supplier', 'supplier_insert_scoped'), pol('supplier', 'supplier_update_scoped'),
    pol('supplier', 'supplier_delete_scoped'),
    raw('as políticas irrestritas de referência foram removidas',
      `SELECT NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
        AND tablename IN ('cost_center','supplier') AND policyname IN ('ref_read_cc','ref_write_cc','ref_read_sup','ref_write_sup'))`),
  ] },
  '100': { name: 'contract_approval_safety', checks: [
    fn('contract_approval_step_order'), fn('enforce_contract_approval_safety'),
    trg('contract_approvals', 'trg_contract_approval_safety'),
    pol('contract_approvals', 'contract_approvals_insert'),
    pol('contract_approvals', 'contract_approvals_update'),
    raw('a política irrestrita contract_approvals_manage foi removida',
      `SELECT NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
        AND tablename='contract_approvals' AND policyname='contract_approvals_manage')`),
  ] },
  '101': { name: 'contract_status_vocabulary', checks: [
    fn('contract_status_vocabulary'), con('contracts', 'contracts_status_check'),
  ] },
  '102': { name: 'platform_parties', checks: [
    tbl('parties'), tbl('party_roles'),
    con('parties', 'parties_org_id_unique'), con('parties', 'parties_document_coherent'),
    con('parties', 'parties_cnpj_len'), con('parties', 'parties_cpf_len'),
    con('parties', 'parties_person_document'),
    con('party_roles', 'party_roles_party_same_org'), con('party_roles', 'party_roles_role_check'),
    idx('uq_parties_org_document'), idx('uq_party_roles_party_role'),
    fn('party_role_vocabulary'),
    trg('parties', 'trg_parties_updated_at'), trg('party_roles', 'trg_party_roles_updated_at'),
    rls('parties'), rls('party_roles'),
    pol('parties', 'parties_select_scoped'), pol('party_roles', 'party_roles_select_scoped'),
  ] },
  '103': { name: 'parties_perm_seeds', checks: [
    perm('parties.view'), perm('parties.create'), perm('parties.edit'), perm('parties.delete'),
    raw('owner_admin recebeu as quatro permissões de Party',
      `SELECT (SELECT count(*) FROM public.role_permissions rp
         JOIN public.roles r ON r.id=rp.role_id AND r.key='owner_admin' AND r.organization_id IS NULL
         JOIN public.permissions p ON p.id=rp.permission_id
        WHERE p.key IN ('parties.view','parties.create','parties.edit','parties.delete')) = 4`),
  ] },
  '104': { name: 'tenant_isolation_client_business_unit', checks: [
    colNotNull('client', 'organization_id'), colNotNull('business_unit', 'organization_id'),
    idx('idx_client_org'), idx('idx_business_unit_org'),
    idx('idx_client_org_cnpj'), idx('idx_business_unit_org_code'), idx('idx_business_unit_org_cnpj'),
    rls('client'), rls('business_unit'),
    pol('client', 'client_select_scoped'), pol('client', 'client_insert_scoped'),
    pol('client', 'client_update_scoped'), pol('client', 'client_delete_scoped'),
    pol('business_unit', 'business_unit_select_scoped'), pol('business_unit', 'business_unit_write_scoped'),
    raw('as políticas irrestritas de client/business_unit foram removidas',
      `SELECT NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public'
        AND tablename IN ('client','business_unit') AND policyname IN ('ref_read_cli','ref_write_cli','ref_read_bu','ref_write_bu'))`),
  ] },
  '105': { name: 'canonical_cost_center', checks: [
    col('finance_cost_centers', 'parent_id'), col('finance_cost_centers', 'business_unit_id'),
    idx('idx_fcc_parent'), idx('idx_fcc_bu'),
    con('finance_cost_centers', 'fcc_org_id_unique'), con('finance_cost_centers', 'fcc_parent_same_org'),
    con('finance_cost_centers', 'fcc_parent_not_self'),
    raw('ledger_entry.cost_center_id aponta para finance_cost_centers',
      `SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
        AND conrelid='public.ledger_entry'::regclass AND confrelid='public.finance_cost_centers'::regclass)`),
    raw('allocation_rule.cost_center_id aponta para finance_cost_centers',
      `SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE contype='f'
        AND conrelid='public.allocation_rule'::regclass AND confrelid='public.finance_cost_centers'::regclass)`),
  ] },
  '106': { name: 'contracts_counterparty_party', checks: [
    col('contracts', 'counterparty_party_id'),
    con('contracts', 'contracts_counterparty_party_same_org_fkey'),
    idx('contracts_org_counterparty_party_idx'),
    raw('counterparty_name histórico continua existindo', col('contracts', 'counterparty_name')[1]),
  ] },
  '107': { name: 'fcc_business_unit_tenant_fk', checks: [
    con('business_unit', 'business_unit_org_id_unique'),
    con('finance_cost_centers', 'fcc_business_unit_same_org'),
    raw('fcc_business_unit_same_org é composta por inquilino',
      `SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.finance_cost_centers'::regclass
        AND conname='fcc_business_unit_same_org'
        AND pg_get_constraintdef(oid) LIKE '%(organization_id, business_unit_id)%')`),
  ] },
  '108': { name: 'contract_temporal_lineage', checks: [
    tbl('contract_amendment_revisions'), tbl('contract_instrument_lineage'),
    idx('contracts_org_id_phase2'), idx('clauses_org_contract_id_phase2'),
    idx('documents_org_contract_id_phase2'), idx('amendments_org_contract_id_phase2'),
    idx('milestones_org_contract_id_phase2'), idx('links_unique_target_phase2'),
    idx('lineage_one_contract_parent'), idx('lineage_one_amendment_parent'),
    con('contract_clauses', 'clauses_contract_tenant_phase2'),
    con('contract_clauses', 'clauses_source_document_contract_phase2'),
    con('contract_documents', 'documents_contract_tenant_phase2'),
    con('contract_amendments', 'amendments_contract_tenant_phase2'),
    con('contract_amendments', 'amendments_document_contract_phase2'),
    colNotNull('contract_amendment_clauses', 'contract_id'),
    con('contract_amendment_clauses', 'links_amendment_contract_phase2'),
    con('contract_amendment_clauses', 'links_clause_contract_phase2'),
    con('contract_amendment_clauses', 'links_replacement_contract_phase2'),
    con('contract_amendment_clauses', 'links_no_self_replacement_phase2'),
    fn('contracts_fill_clause_link_scope'), fn('contracts_reject_history_mutation'),
    fn('contracts_reject_amendment_reparenting'), fn('contracts_capture_amendment_revision'),
    fn('contracts_validate_instrument_lineage'), fn('create_contract_amendment_with_lineage'),
    trg('contract_amendments', 'capture_amendment_revision'),
    trg('contract_amendments', 'amendment_identity_immutable'),
    trg('contract_instrument_lineage', 'validate_instrument_lineage'),
    rls('contract_amendment_revisions'), rls('contract_instrument_lineage'),
    raw('todo aditivo existente tem revisão de base (backfill da 108 rodou)',
      `SELECT NOT EXISTS(SELECT 1 FROM public.contract_amendments a
        WHERE (SELECT count(*) FROM public.contract_amendment_revisions r WHERE r.amendment_id=a.id)=0)`),
  ] },
  '109': { name: 'contract_structured_definitions', checks: [
    tbl('contract_guarantees'), tbl('contract_insurance_requirements'), tbl('contract_indexation_rules'),
    tbl('contract_billing_conditions'), tbl('contract_measurement_requirements'),
    fn('contracts_validate_fact_predecessor'), fn('contracts_protect_referenced_clause'),
    fn('contracts_protect_original_terms'),
    trg('contract_clauses', 'protect_referenced_clause'), trg('contracts', 'protect_original_terms'),
    rls('contract_guarantees'), rls('contract_insurance_requirements'), rls('contract_indexation_rules'),
    rls('contract_billing_conditions'), rls('contract_measurement_requirements'),
    raw('as cinco tabelas estruturadas têm gatilho de predecessor',
      `SELECT (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname='validate_predecessor'
        AND tgrelid::regclass::text IN ('contract_guarantees','contract_insurance_requirements',
          'contract_indexation_rules','contract_billing_conditions','contract_measurement_requirements')) = 5`),
  ] },
  '110': { name: 'contract_history_erasure_boundary', checks: [
    fn('contracts_reject_history_erasure'), fn('contracts_clause_is_referenced'),
    trg('contract_amendment_clauses', 'amendment_clause_history_no_erasure'),
    trg('contract_amendment_revisions', 'amendment_revisions_no_erasure'),
    trg('contract_instrument_lineage', 'lineage_no_erasure'),
    raw('amendment_no_hard_delete passou a chamar a barreira de apagamento',
      `SELECT EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
        AND tgname='amendment_no_hard_delete'
        AND tgfoid='public.contracts_reject_history_erasure()'::regprocedure)`),
    raw('os gatilhos de imutabilidade viraram BEFORE UPDATE (16 = UPDATE apenas)',
      `SELECT NOT EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
        AND tgname IN ('amendment_clause_history_immutable','amendment_revisions_immutable','lineage_immutable')
        AND (tgtype & 8) <> 0)`),
  ] },
  '111': { name: 'clause_reference_probe_tenant_scope', checks: [
    raw('contracts_clause_is_referenced decide o inquilino pelo JWT, não por current_user',
      `SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname='contracts_clause_is_referenced'
        AND prosecdef AND prosrc LIKE '%current_user_organization_id%' AND prosrc LIKE '%auth.uid()%'
        AND prosrc NOT LIKE '%current_user %')`),
    raw('anon não pode executar a sondagem de cláusula',
      `SELECT NOT has_function_privilege('anon','public.contracts_clause_is_referenced(uuid)','EXECUTE')`),
    raw('authenticated continua podendo executá-la',
      `SELECT has_function_privilege('authenticated','public.contracts_clause_is_referenced(uuid)','EXECUTE')`),
  ] },
};

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
console.log(APPLY ? '### RECONCILIAÇÃO (grava no registro) ###' : '### SOMENTE PROVA (nada é gravado) ###\n');

let fatal = false;

// ---- 0) colisão de versão: no diretório e no registro ----------------------
const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql'));
const byVersion = new Map();
for (const f of files) {
  const v = f.slice(0, 3);
  if (!/^\d{3}$/.test(v)) continue;
  byVersion.set(v, [...(byVersion.get(v) ?? []), f]);
}
const collisions = [...byVersion].filter(([, fs]) => fs.length > 1);
console.log('=== COLISÃO DE VERSÃO ===');
console.log(`   ${collisions.length === 0 ? '✓' : '✗'} arquivos: ${collisions.length === 0
  ? 'nenhuma versão duplicada no diretório' : collisions.map(([v, fs]) => `${v}: ${fs.join(', ')}`).join(' | ')}`);
if (collisions.length) fatal = true;
const dup = (await c.query(`SELECT version, count(*) n FROM supabase_migrations.schema_migrations
  GROUP BY version HAVING count(*) > 1`)).rows;
console.log(`   ${dup.length === 0 ? '✓' : '✗'} registro: ${dup.length === 0
  ? 'nenhuma versão duplicada' : dup.map(r => `${r.version}×${r.n}`).join(', ')}`);
if (dup.length) fatal = true;

// ---- 1) estado atual do registro ------------------------------------------
const registry = new Set((await c.query('SELECT version FROM supabase_migrations.schema_migrations')).rows
  .map(r => r.version));
const tip = [...registry].sort().at(-1);
console.log(`\n=== REGISTRO ANTES ===\n   ${registry.size} linhas, última versão ${tip}`);

// ---- 2) prova, migration por migration ------------------------------------
console.log('\n=== PROVA ESTRUTURAL 089–111 ===');
const proven = [], partial = [], absent = [];
for (const [version, m] of Object.entries(MIGRATIONS)) {
  const file = files.find(f => f.startsWith(version + '_'));
  if (!file) { console.log(`\n${version}  ✗ ARQUIVO AUSENTE no repositório`); absent.push(version); fatal = true; continue; }
  const failed = [];
  for (const [label, sql] of m.checks) {
    let got;
    try { got = (await c.query(sql)).rows[0] && Object.values((await c.query(sql)).rows[0])[0]; }
    catch (e) { got = false; }
    if (got !== true) failed.push(label);
  }
  const total = m.checks.length;
  if (failed.length === 0) {
    proven.push({ version, name: m.name, file });
    console.log(`${version}  ✓ ${file.padEnd(52)} ${total}/${total} efeitos presentes${registry.has(version) ? '  (já no registro)' : ''}`);
  } else if (failed.length === total) {
    absent.push(version); fatal = true;
    console.log(`${version}  ✗ ${file.padEnd(52)} NÃO APLICADA (0/${total})`);
  } else {
    partial.push({ version, failed }); fatal = true;
    console.log(`${version}  ✗ ${file.padEnd(52)} PARCIAL (${total - failed.length}/${total}) — faltam:`);
    for (const f of failed) console.log(`        · ${f}`);
  }
}

console.log(`\n   provadas: ${proven.length}   parciais: ${partial.length}   ausentes: ${absent.length}`);

if (fatal) {
  console.error('\n!!! PORTÃO DE PARADA — o registro NÃO será reconciliado.');
  console.error('    Uma migration não provada ou parcialmente aplicada não pode ser marcada como aplicada.');
  await c.end(); process.exit(1);
}

// ---- 3) reconciliação ------------------------------------------------------
const missing = proven.filter(p => !registry.has(p.version));
console.log(`\n=== RECONCILIAÇÃO ===\n   ${missing.length} versões provadas e fora do registro: ${
  missing.map(m => m.version).join(', ') || '(nenhuma)'}`);

if (missing.length && APPLY) {
  await c.query('BEGIN');
  for (const m of missing) {
    await c.query(`INSERT INTO supabase_migrations.schema_migrations (version, name)
      VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`, [m.version, m.name]);
  }
  const after = (await c.query('SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1')).rows[0];
  const holes = (await c.query(`SELECT g::text FROM generate_series(1, 111) g
    WHERE lpad(g::text, 3, '0') NOT IN (SELECT version FROM supabase_migrations.schema_migrations)`)).rows;
  if (holes.length) { await c.query('ROLLBACK'); console.error(`!!! buracos remanescentes: ${holes.map(h => h.g).join(',')}`); await c.end(); process.exit(1); }
  await c.query('COMMIT');
  console.log(`   ✓ ${missing.length} linhas gravadas. Registro agora termina em ${after.version}, sem buracos de 001 a 111.`);
} else if (missing.length) {
  console.log('   (ensaio) rode com --apply para gravar.');
} else {
  console.log('   ✓ registro já descreve o banco.');
}

await c.end();
