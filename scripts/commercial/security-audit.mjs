/**
 * AUDITORIA DE SEGURANÇA E DE DADOS do módulo comercial.
 *
 * Somente LEITURA — não abre transação e não escreve nada. Responde quatro
 * perguntas, e cada uma tem um jeito de falhar que não aparece em teste de
 * funcionalidade:
 *
 *  1. RLS: alguma tabela nova ficou sem política, ou sem RLS ligada?
 *  2. RBAC: alguma função governada ficou alcançável pelo navegador?
 *  3. Inquilino: alguma linha aponta para outra organização?
 *  4. Fabricação: entrou dado de mentira, ou documento duplicado?
 *
 *   node scripts/commercial/security-audit.mjs
 *   node scripts/commercial/security-audit.mjs --with-migrations 217
 *
 * `--with-migrations` aplica as versões pedidas numa transação, audita o
 * schema resultante e desfaz tudo (ROLLBACK) — é como se audita uma
 * migration ANTES de aplicá-la. Sem a opção, nenhuma transação é aberta.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

const argv = process.argv.slice(2);
const withVersions = argv.includes('--with-migrations') ? argv.filter((a) => /^\d{3}$/.test(a)) : [];
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const migrationFiles = readdirSync('supabase/migrations').filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
// A ponta esperada do registro é a última migration do repositório.
const EXPECTED_TIP = migrationFiles.at(-1).slice(0, 3);

/*
  FIXTURES DE QA — o que distingue dado de teste de dado de negócio.

  Não é o nome do cliente nem o título (nada de lista de nomes permitidos):
  é QUEM criou e a MARCA que as nossas próprias provas carimbam.
    • criado pela identidade de automação de QA (`tests/.qa-env.json` ou
      QA_AUTOMATION_EMAIL) — a conta que os testes E2E usam;
    • número/título com a marca dos geradores de prova deste repositório
      (`PROOF-`, `P2xx-` das provas de migration, `Prova 2xx`, `[E2E]`).
  As provas rodam em ROLLBACK e os E2E interceptam escrita: qualquer linha
  assim que SOBREVIVA no banco é vazamento de fixture — isso reprova.
  Registro criado por pessoa com nome "teste" não é fixture: é informado
  (INFO) para o dono decidir, e não reprova.
*/
const qaEmail = process.env.QA_AUTOMATION_EMAIL
  ?? (existsSync('tests/.qa-env.json') ? JSON.parse(readFileSync('tests/.qa-env.json', 'utf8')).email : null);
const FIXTURE_MARK = String.raw`(^|[^A-Z])(PROOF-|P2[0-9]{2}-|\[E2E\])|^Prova 2[0-9]{2}`;

const NEW_TABLES = [
  'commercial_engagements', 'commercial_engagement_authorizations', 'engagement_project_links',
  'commercial_divergences', 'commercial_contacts', 'commercial_opportunities',
  'commercial_proposals', 'commercial_proposal_revisions', 'commercial_extracted_facts',
  'commercial_execution_blueprints', 'commercial_execution_blueprint_items',
  'internal_service_orders', 'commercial_engagement_history',
  'commercial_opportunity_stage_events', 'commercial_site_surveys', 'commercial_site_survey_events',
  'commercial_execution_starts', 'commercial_proposal_link_events',
  // 217 — aceite do pacote PT + PC
  'commercial_proposal_context_acceptances',
];

const GOVERNED_FUNCTIONS = [
  'commercial_engagement_create', 'commercial_engagement_attach_authorization',
  'commercial_engagement_set_governing', 'commercial_engagement_authorize',
  'commercial_proposal_revision_record_outcome', 'internal_service_order_create',
  'internal_service_order_compare_with_governing', 'internal_service_order_issue',
  'internal_service_order_bind_project', 'commercial_divergence_resolve',
  'commercial_contact_upsert', 'commercial_opportunity_upsert', 'commercial_proposal_create',
  'commercial_proposal_revise', 'commercial_proposal_revision_transition',
  'commercial_fact_record', 'commercial_fact_confirm', 'commercial_blueprint_create',
  'commercial_opportunity_transition_stage', 'commercial_site_survey_create',
  'commercial_site_survey_transition', 'commercial_site_survey_record',
  'commercial_site_survey_register_attachment', 'commercial_site_survey_record_apex_candidate',
  'commercial_close_and_start_execution', 'commercial_execution_start_regularize',
  'contract_billing_eligibility_resolve_core', 'commercial_proposal_register_document',
  'commercial_proposal_link_opportunity',
  // 217 — contexto PT + PC: aprovação do pacote, vínculo do contexto, resposta do cliente ao pacote
  'commercial_proposal_context_transition', 'commercial_proposal_context_link_opportunity',
  'commercial_proposal_context_record_outcome',
];

/* Funções INTERNAS da 217 (gatilho/auxiliar): ninguém de fora executa — nem o navegador. */
const INTERNAL_FUNCTIONS = [
  'commercial_proposal_context_guard', 'commercial_proposal_context_snapshot_acceptance',
  'commercial_proposal_revision_acceptance_ledger', 'commercial_revision_value_exempt',
  'commercial_revision_acceptance_has_value', 'commercial_proposal_context_acceptances_no_rewrite',
];

/* História imutável: gatilhos que precisam existir. */
const HISTORY_TRIGGERS = [
  ['commercial_proposal_link_events', 'cple_no_rewrite'], ['commercial_proposal_link_events', 'cple_no_erasure'],
  ['commercial_proposal_context_acceptances', 'cpca_no_rewrite'], ['commercial_proposal_context_acceptances', 'cpca_no_erasure'],
  ['commercial_proposals', 'cp_context_guard'], ['commercial_proposal_revisions', 'cpr_acceptance_ledger'],
];

const findings = [];
const report = (section, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${section}${detail ? ` — ${detail}` : ''}`);
  if (!ok) findings.push(`${section}: ${detail}`);
};

try {
  await db.connect();
  if (withVersions.length) {
    await db.query('BEGIN');
    for (const v of withVersions) {
      const file = migrationFiles.find((f) => f.startsWith(`${v}_`));
      if (!file) throw new Error(`Migration ${v} não encontrada.`);
      await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
      await db.query(`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1,$2)
        ON CONFLICT (version) DO NOTHING`, [v, file.slice(4).replace(/\.sql$/, '')]);
    }
    console.log(`(auditando com ${withVersions.join(', ')} aplicada(s) em transação — ROLLBACK no fim)`);
  }

  const has217 = (await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='commercial_proposals' AND column_name='context_id'`)).rowCount > 0;
  if (!has217) report('Contexto PT + PC · 217 aplicada', false, 'context_id ausente — rode com --with-migrations 217 para auditar antes de aplicar');

  // --- 1. RLS ------------------------------------------------------------
  const rls = await db.query(`
    SELECT c.relname, c.relrowsecurity,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relname = ANY($1)`, [NEW_TABLES]);
  report('RLS · todas as tabelas novas existem',
    rls.rowCount === NEW_TABLES.length, `${rls.rowCount}/${NEW_TABLES.length}`);
  const noRls = rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  report('RLS · habilitada em todas', noRls.length === 0, noRls.join(', '));
  const noPolicy = rls.rows.filter((r) => r.policies === 0).map((r) => r.relname);
  report('RLS · política de leitura em todas', noPolicy.length === 0, noPolicy.join(', '));

  // --- 2. Privilégios de tabela -----------------------------------------
  const writes = await db.query(`
    SELECT table_name, privilege_type FROM information_schema.role_table_grants
     WHERE grantee IN ('authenticated','anon') AND table_schema='public'
       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
       AND table_name = ANY($1)`, [NEW_TABLES]);
  report('RBAC · navegador não escreve em tabela nova', writes.rowCount === 0,
    writes.rows.map((r) => `${r.table_name}:${r.privilege_type}`).join(', '));

  const anonGrants = await db.query(`
    SELECT DISTINCT table_name FROM information_schema.role_table_grants
     WHERE grantee='anon' AND table_schema='public' AND table_name = ANY($1)`, [NEW_TABLES]);
  report('RBAC · anon sem privilégio nenhum em tabela nova', anonGrants.rowCount === 0,
    anonGrants.rows.map((r) => r.table_name).join(', '));

  // --- 3. Funções governadas --------------------------------------------
  const fns = await db.query(`
    SELECT p.proname, p.prosecdef,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') browser,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon,
           has_function_privilege('service_role', p.oid, 'EXECUTE') server,
           p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname = ANY($1)`, [GOVERNED_FUNCTIONS]);
  report('RBAC · todas as funções governadas existem',
    fns.rowCount === GOVERNED_FUNCTIONS.length, `${fns.rowCount}/${GOVERNED_FUNCTIONS.length}`);
  report('RBAC · nenhuma alcançável pelo navegador',
    fns.rows.every((r) => !r.browser && !r.anon),
    fns.rows.filter((r) => r.browser || r.anon).map((r) => r.proname).join(', '));
  report('RBAC · todas alcançáveis pelo servidor',
    fns.rows.every((r) => r.server),
    fns.rows.filter((r) => !r.server).map((r) => r.proname).join(', '));
  report('RBAC · SECURITY DEFINER com search_path fixo',
    fns.rows.every((r) => r.prosecdef
      && (r.proconfig ?? []).some((c) => c.startsWith('search_path='))),
    fns.rows.filter((r) => !r.prosecdef
      || !(r.proconfig ?? []).some((c) => c.startsWith('search_path='))).map((r) => r.proname).join(', '));

  const internal = await db.query(`
    SELECT p.proname,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') browser,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname = ANY($1)`, [INTERNAL_FUNCTIONS]);
  report('RBAC · funções internas da 217 existem', internal.rowCount === INTERNAL_FUNCTIONS.length,
    `${internal.rowCount}/${INTERNAL_FUNCTIONS.length}`);
  report('RBAC · funções internas fora do alcance do navegador',
    internal.rows.every((r) => !r.browser && !r.anon),
    internal.rows.filter((r) => r.browser || r.anon).map((r) => r.proname).join(', '));

  const triggers = await db.query(`
    SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
     WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'`);
  const present = new Set(triggers.rows.map((r) => `${r.relname}.${r.tgname}`));
  const missingTriggers = HISTORY_TRIGGERS.filter(([t, g]) => !present.has(`${t}.${g}`)).map(([t, g]) => `${t}.${g}`);
  report('História · vínculo e aceite do pacote imutáveis; contexto guardado', missingTriggers.length === 0,
    missingTriggers.join(', '));

  // --- 4. Isolamento de inquilino ---------------------------------------
  const leaks = await db.query(`
    SELECT 'authorization' k, count(*)::int n FROM public.commercial_engagement_authorizations a
      JOIN public.commercial_engagements e ON e.id=a.engagement_id
     WHERE a.organization_id <> e.organization_id
    UNION ALL SELECT 'project_link', count(*)::int FROM public.engagement_project_links l
      JOIN public.commercial_engagements e ON e.id=l.engagement_id
     WHERE l.organization_id <> e.organization_id
    UNION ALL SELECT 'measurement', count(*)::int FROM public.project_measurements m
      JOIN public.commercial_engagements e ON e.id=m.engagement_id
     WHERE m.organization_id <> e.organization_id
    UNION ALL SELECT 'contract_engagement', count(*)::int FROM public.contracts c
      JOIN public.commercial_engagements e ON e.id=c.engagement_id
     WHERE c.organization_id <> e.organization_id
    ${has217 ? `UNION ALL SELECT 'proposal_context', count(*)::int FROM (
      SELECT context_id FROM public.commercial_proposals GROUP BY context_id
      HAVING count(DISTINCT organization_id) > 1) x
    UNION ALL SELECT 'context_opportunity', count(*)::int FROM (
      SELECT organization_id, context_id FROM public.commercial_proposals WHERE opportunity_id IS NOT NULL
       GROUP BY organization_id, context_id HAVING count(DISTINCT opportunity_id) > 1) x
    UNION ALL SELECT 'acceptance_revision', count(*)::int FROM public.commercial_proposal_context_acceptances a
      JOIN public.commercial_proposal_revisions r
        ON r.id IN (a.technical_revision_id, a.commercial_revision_id, a.combined_revision_id)
      JOIN public.commercial_proposals p ON p.id = r.proposal_id
     WHERE r.organization_id <> a.organization_id OR p.context_id <> a.context_id` : ''}`);
  const crossing = leaks.rows.filter((r) => r.n > 0);
  report('Inquilino · nenhuma linha cruza organização', crossing.length === 0,
    crossing.map((r) => `${r.k}=${r.n}`).join(', '));

  // --- 5. Integridade do reancoramento ----------------------------------
  const anchors = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.project_measurements WHERE engagement_id IS NULL) m_orphan,
    (SELECT count(*)::int FROM public.contract_measurement_requirements WHERE engagement_id IS NULL) r_orphan,
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL AND engagement_id IS NULL) c_orphan,
    (SELECT count(*)::int FROM public.commercial_engagements
      WHERE status='UNDER_ANALYSIS' AND authorized_value IS NOT NULL) kpi_leak,
    (SELECT count(*)::int FROM public.commercial_engagement_authorizations a1
      WHERE a1.governing AND a1.state='ACTIVE'
        AND EXISTS (SELECT 1 FROM public.commercial_engagement_authorizations a2
                     WHERE a2.engagement_id=a1.engagement_id AND a2.governing
                       AND a2.state='ACTIVE' AND a2.id<>a1.id)) double_governing`)).rows[0];
  report('Âncora · nenhuma medição sem pai', anchors.m_orphan === 0, String(anchors.m_orphan));
  report('Âncora · nenhuma regra sem pai', anchors.r_orphan === 0, String(anchors.r_orphan));
  report('Âncora · nenhum contrato vivo sem pai', anchors.c_orphan === 0, String(anchors.c_orphan));
  report('KPI · nada em análise soma valor autorizado', anchors.kpi_leak === 0, String(anchors.kpi_leak));
  report('Governança · uma fonte regente por trabalho',
    anchors.double_governing === 0, String(anchors.double_governing));

  // --- 6. Fabricação ------------------------------------------------------
  //
  // O módulo comercial não semeou UMA linha de negócio. Tudo que existe nas
  // tabelas novas nasceu do backfill (derivado de contrato real) ou de uso.
  /*
    O filtro exclui `migration_backfill` de propósito.

    O backfill COPIA o título do contrato real, e três contratos de produção
    se chamam "[TESTE] Operacionalização". Sinalizá-los aqui seria acusar o
    módulo comercial de ter fabricado um dado que ele apenas herdou — e o
    dado de origem é problema de outro dono. O que esta auditoria precisa
    responder é se ESTE módulo semeou alguma coisa.
  */
  const fabricated = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.commercial_engagements
      WHERE origin <> 'migration_backfill'
        AND (title ILIKE '%[E2E]%' OR title ILIKE '%demo%' OR title ILIKE '%teste%'
             OR counterparty_name ILIKE '%exemplo%')) suspicious_engagements,
    (SELECT count(*)::int FROM public.commercial_engagements e
      WHERE e.origin = 'migration_backfill'
        AND (e.title ILIKE '%teste%' OR e.title ILIKE '%demo%')) inherited_test_titles,
    (SELECT count(*)::int FROM public.commercial_proposals) proposals,
    (SELECT count(*)::int FROM public.commercial_opportunities) opportunities,
    (SELECT count(*)::int FROM public.commercial_engagements WHERE origin='migration_backfill') backfilled,
    (SELECT count(*)::int FROM public.contracts WHERE deleted_at IS NULL) live_contracts,
    (SELECT count(*)::int FROM public.contracts c WHERE c.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.commercial_engagements e
                        WHERE e.id = c.engagement_id
                          AND e.organization_id = c.organization_id)) contracts_without_parent,
    (SELECT count(*)::int FROM public.commercial_engagements e
      WHERE e.origin IN ('migration_backfill','formal_contract')
        AND NOT EXISTS (SELECT 1 FROM public.commercial_engagement_authorizations a
                         WHERE a.engagement_id = e.id)) engagements_without_source`)).rows[0];
  report('Fabricação · o módulo comercial não semeou trabalho de teste',
    fabricated.suspicious_engagements === 0, String(fabricated.suspicious_engagements));
  if (fabricated.inherited_test_titles > 0) {
    console.log(`INFO  Herdado · ${fabricated.inherited_test_titles} trabalho(s) autorizado(s) `
      + 'carregam título de contrato PRÉ-EXISTENTE marcado como teste. '
      + 'Origem: contratos de produção; o backfill copiou o título, não o criou.');
  }
  /*
    Proposta, oportunidade, OS, fato e divergência EXISTEM em uso real — a
    pergunta certa não é "há alguma?", é "alguma é fixture de QA?".
  */
  const qaUser = qaEmail
    ? (await db.query('SELECT id FROM auth.users WHERE lower(email) = lower($1)', [qaEmail])).rows[0]?.id ?? null
    : null;
  const fixtures = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.commercial_proposals
      WHERE created_by = $1 OR proposal_number ~* $2 OR title ~* $2 OR counterparty_name ~* $2) proposals,
    (SELECT count(*)::int FROM public.commercial_opportunities
      WHERE created_by = $1 OR title ~* $2 OR counterparty_name ~* $2) opportunities,
    (SELECT count(*)::int FROM public.internal_service_orders
      WHERE created_by = $1 OR os_number ~* $2 OR title ~* $2) service_orders,
    (SELECT count(*)::int FROM public.commercial_extracted_facts f
      JOIN public.commercial_proposal_revisions r ON r.id = f.subject_id
      JOIN public.commercial_proposals p ON p.id = r.proposal_id
     WHERE p.created_by = $1 OR p.proposal_number ~* $2) facts,
    (SELECT count(*)::int FROM public.commercial_divergences d
      JOIN public.commercial_engagements e ON e.id = d.engagement_id
     WHERE e.origin <> 'migration_backfill' AND (e.created_by = $1 OR e.title ~* $2)) divergences`,
    [qaUser, FIXTURE_MARK])).rows[0];
  report('Fabricação · nenhuma fixture de QA no banco (proposta, oportunidade, OS, fato, divergência)',
    Object.values(fixtures).every((n) => n === 0),
    `${JSON.stringify(fixtures)} · identidade de QA ${qaUser ? 'resolvida' : qaEmail ? 'não encontrada' : 'não configurada'}`);
  const business = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.commercial_proposals) proposals,
    (SELECT count(*)::int FROM public.commercial_opportunities) opportunities,
    (SELECT count(*)::int FROM public.commercial_extracted_facts) facts,
    (SELECT count(*)::int FROM public.commercial_proposals
      WHERE (created_by IS DISTINCT FROM $1) AND (proposal_number ILIKE '%teste%' OR title ILIKE '%teste%')) manual_test_named`,
    [qaUser])).rows[0];
  console.log(`INFO  Negócio · ${business.proposals} proposta(s), ${business.opportunities} oportunidade(s), `
    + `${business.facts} fato(s) criados por pessoas — uso legítimo, não fixture.`);
  if (business.manual_test_named) {
    console.log(`INFO  Negócio · ${business.manual_test_named} proposta(s) criada(s) por PESSOA com "teste" no número/título `
      + '— não é fixture de QA; o dono decide se arquiva.');
  }
  /*
    A contagem crua `backfill === contratos` valia só enquanto nenhum contrato
    NOVO existisse: desde a 205 um contrato criado depois gera engajamento com
    origem `formal_contract`, não `migration_backfill`. O invariante real —
    e o que importa — é que nenhum contrato vivo fique sem pai e nenhum
    engajamento nascido de contrato fique sem fonte.
  */
  report('Backfill · todo contrato vivo tem pai',
    fabricated.contracts_without_parent === 0, String(fabricated.contracts_without_parent));
  report('Backfill · todo trabalho nascido de contrato tem fonte de autorização',
    fabricated.engagements_without_source === 0, String(fabricated.engagements_without_source));

  // Documento duplicado: mesmo conteúdo, mesmo pai, mesmo papel, ambos vivos.
  const dupes = await db.query(`
    SELECT count(*)::int n FROM (
      SELECT organization_id, COALESCE(engagement_id::text, contract_id::text) parent,
             document_type, content_sha256
        FROM public.contract_documents
       WHERE content_sha256 IS NOT NULL AND superseded_by_document_id IS NULL
       GROUP BY 1,2,3,4 HAVING count(*) > 1) d`);
  report('Documento · nenhum duplicado vivo no mesmo pai e papel',
    dupes.rows[0].n === 0, String(dupes.rows[0].n));

  // --- 7. Medição duplicada ----------------------------------------------
  const dupMeasurements = await db.query(`
    SELECT count(*)::int n FROM (
      SELECT organization_id, project_id, contract_measurement_rule_id, occurrence_key, revision
        FROM public.project_measurements
       WHERE occurrence_state='resolved' AND status NOT IN ('SUPERSEDED','CANCELLED')
       GROUP BY 1,2,3,4,5 HAVING count(*) > 1) x`);
  report('Medição · nenhuma ocorrência duplicada viva',
    dupMeasurements.rows[0].n === 0, String(dupMeasurements.rows[0].n));

  // --- 8. Registro de migrations -----------------------------------------
  const registry = await db.query(`
    SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int`);
  const versions = registry.rows.map((r) => r.version);
  report(`Registro · ponta em ${EXPECTED_TIP} (última migration do repositório)`,
    versions.at(-1) === EXPECTED_TIP, versions.at(-1));

  console.log(`\n${findings.length === 0 ? 'Auditoria limpa.' : `${findings.length} achado(s).`}`);
} catch (error) {
  console.error('FALHOU:', error.message);
  process.exitCode = 1;
} finally {
  if (withVersions.length) { try { await db.query('ROLLBACK'); console.log('ROLLBACK — nada foi gravado.'); } catch {} }
  await db.end();
}
process.exitCode = findings.length ? 1 : process.exitCode;
