/** Read-only Phase 2 production gate. Never applies schema or changes business rows. */
import pg from 'pg';
import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

export async function phase2Preflight(client) {
  const queries = {
    baseline: `SELECT 'organizations' table_name,count(*) n FROM organizations
      UNION ALL SELECT 'client',count(*) FROM client UNION ALL SELECT 'supplier',count(*) FROM supplier
      UNION ALL SELECT 'business_unit',count(*) FROM business_unit UNION ALL SELECT 'cost_center',count(*) FROM cost_center
      UNION ALL SELECT 'finance_cost_centers',count(*) FROM finance_cost_centers
      UNION ALL SELECT 'ledger_entry',count(*) FROM ledger_entry UNION ALL SELECT 'allocation_rule',count(*) FROM allocation_rule
      UNION ALL SELECT 'parties',count(*) FROM parties UNION ALL SELECT 'party_roles',count(*) FROM party_roles`,
    contracts: `SELECT count(*) total,count(counterparty_name) historical_text,count(counterparty_party_id) canonical_party,
      count(client_id) legacy_client,count(supplier_id) legacy_supplier,count(*) FILTER(WHERE organization_id IS NULL) null_org FROM contracts`,
    data_class: `SELECT data_class,count(*) n FROM contracts GROUP BY 1 ORDER BY 1`,
    amendments: `SELECT count(*) total,count(DISTINCT contract_id) contracts_with_amendments,
      count(DISTINCT contract_id) FILTER(WHERE value_delta IS NOT NULL OR value_absolute IS NOT NULL OR new_end_date IS NOT NULL OR term_extension_days IS NOT NULL) contracts_with_value_term_amendments,
      count(*) FILTER(WHERE effective_date IS NULL) undated,count(*) FILTER(WHERE organization_id IS NULL) null_org FROM contract_amendments`,
    clauses: `SELECT count(*) total,count(source_document_id) source_documents,count(source_page) source_pages,
      count(superseded_by_clause_id) superseded,count(*) FILTER(WHERE organization_id IS NULL) null_org FROM contract_clauses`,
    relationships: `SELECT count(*) total,count(*) FILTER(WHERE organization_id IS NULL) null_org FROM contract_amendment_clauses`,
    ownership_errors: `SELECT 'amendments' table_name,count(*) n FROM contract_amendments a LEFT JOIN contracts c ON c.id=a.contract_id
      WHERE c.id IS NULL OR a.organization_id IS DISTINCT FROM c.organization_id
      UNION ALL SELECT 'clauses',count(*) FROM contract_clauses a LEFT JOIN contracts c ON c.id=a.contract_id WHERE c.id IS NULL OR a.organization_id IS DISTINCT FROM c.organization_id
      UNION ALL SELECT 'documents',count(*) FROM contract_documents a LEFT JOIN contracts c ON c.id=a.contract_id WHERE c.id IS NULL OR a.organization_id IS DISTINCT FROM c.organization_id
      UNION ALL SELECT 'amendment_clauses',count(*) FROM contract_amendment_clauses l LEFT JOIN contract_amendments a ON a.id=l.amendment_id
      LEFT JOIN contract_clauses c ON c.id=l.clause_id LEFT JOIN contract_clauses r ON r.id=l.replacement_clause_id
      WHERE a.id IS NULL OR l.organization_id IS DISTINCT FROM a.organization_id
      OR (l.clause_id IS NOT NULL AND (c.id IS NULL OR c.organization_id IS DISTINCT FROM a.organization_id OR c.contract_id IS DISTINCT FROM a.contract_id))
      OR (l.replacement_clause_id IS NOT NULL AND (r.id IS NULL OR r.organization_id IS DISTINCT FROM a.organization_id OR r.contract_id IS DISTINCT FROM a.contract_id))`,
    duplicate_amendments: `SELECT contract_id,lower(btrim(amendment_number)) number,count(*) n FROM contract_amendments WHERE deleted_at IS NULL GROUP BY 1,2 HAVING count(*)>1`,
    duplicate_links: `SELECT amendment_id,clause_id,count(*) n FROM contract_amendment_clauses WHERE clause_id IS NOT NULL GROUP BY 1,2 HAVING count(*)>1`,
    lineage_columns: `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
      AND table_name IN ('contracts','contract_amendments','contract_clauses','contract_documents')
      AND (column_name LIKE '%parent%' OR column_name LIKE '%source%' OR column_name LIKE '%supersed%' OR column_name IN ('contract_id','effective_date','document_id')) ORDER BY 1,2`,
    registry_tip: `SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1`,
    phase1_columns: `SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='public'
      AND ((table_name='contracts' AND column_name='counterparty_party_id') OR (table_name='finance_cost_centers' AND column_name IN ('parent_id','business_unit_id','type'))
      OR (table_name IN ('client','business_unit') AND column_name='organization_id')) ORDER BY 1,2`,
    phase1_rls: `SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace
      AND relname IN ('parties','party_roles','client','business_unit','finance_cost_centers','contracts') ORDER BY 1`,
    unrestricted_policies: `SELECT tablename,policyname FROM pg_policies WHERE schemaname='public'
      AND tablename IN ('parties','party_roles','client','supplier','business_unit','finance_cost_centers','cost_center','contracts') AND (qual='true' OR with_check='true')`,
    phase1_fks: `SELECT conname,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conname IN
      ('fcc_business_unit_same_org','fcc_parent_same_org','contracts_counterparty_party_same_org_fkey','party_roles_party_same_org') ORDER BY 1`,
    party_permissions: `SELECT count(*) n FROM permissions WHERE key LIKE 'parties.%'`,
    historical_fingerprints: `SELECT 'contracts' table_name,count(*) n,md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) fingerprint FROM contracts t
      UNION ALL SELECT 'clauses',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) FROM contract_clauses t
      UNION ALL SELECT 'amendments',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) FROM contract_amendments t
      UNION ALL SELECT 'amendment_clauses',count(*),md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) FROM contract_amendment_clauses t`,
  };
  const report = {};
  for (const [name, sql] of Object.entries(queries)) report[name] = (await client.query(sql)).rows;
  const stops = [];
  if (report.ownership_errors.some(r => Number(r.n))) stops.push('Unclear/cross-organization ownership or orphan reference');
  if (report.duplicate_amendments.length || report.duplicate_links.length) stops.push('Ambiguous amendment relationships');
  if (report.unrestricted_policies.length || report.phase1_rls.length !== 6 || report.phase1_rls.some(r => !r.relrowsecurity)
      || report.phase1_fks.length !== 4 || report.phase1_columns.length !== 6 || Number(report.party_permissions[0].n) !== 4) stops.push('Phase 1 structural baseline differs');
  return { ...report, stops };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const report = await phase2Preflight(client);
    console.log(JSON.stringify(report, null, 2));
    if (report.stops.length) process.exitCode = 1;
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
}
