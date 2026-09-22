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
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

const NEW_TABLES = [
  'commercial_engagements', 'commercial_engagement_authorizations', 'engagement_project_links',
  'commercial_divergences', 'commercial_contacts', 'commercial_opportunities',
  'commercial_proposals', 'commercial_proposal_revisions', 'commercial_extracted_facts',
  'commercial_execution_blueprints', 'commercial_execution_blueprint_items',
  'internal_service_orders', 'commercial_engagement_history',
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
];

const findings = [];
const report = (section, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${section}${detail ? ` — ${detail}` : ''}`);
  if (!ok) findings.push(`${section}: ${detail}`);
};

try {
  await db.connect();

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
     WHERE c.organization_id <> e.organization_id`);
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
    (SELECT count(*)::int FROM public.internal_service_orders) service_orders,
    (SELECT count(*)::int FROM public.commercial_proposals) proposals,
    (SELECT count(*)::int FROM public.commercial_opportunities) opportunities,
    (SELECT count(*)::int FROM public.commercial_extracted_facts) facts,
    (SELECT count(*)::int FROM public.commercial_divergences) divergences,
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
  report('Fabricação · nenhuma OS, proposta, oportunidade, fato ou divergência semeada',
    fabricated.service_orders === 0 && fabricated.proposals === 0
      && fabricated.opportunities === 0 && fabricated.facts === 0
      && fabricated.divergences === 0,
    JSON.stringify(fabricated));
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
  report('Registro · ponta em 212', versions.at(-1) === '212', versions.at(-1));

  console.log(`\n${findings.length === 0 ? 'Auditoria limpa.' : `${findings.length} achado(s).`}`);
} catch (error) {
  console.error('FALHOU:', error.message);
  process.exitCode = 1;
} finally { await db.end(); }
process.exitCode = findings.length ? 1 : process.exitCode;
