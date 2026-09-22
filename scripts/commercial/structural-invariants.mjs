/** Invariantes estruturais do reancoramento — leitura pura. */
import pg from 'pg'; import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const checks = [
  ['project_measurements.engagement_id é NOT NULL',
   `SELECT attnotnull ok FROM pg_attribute
     WHERE attrelid='public.project_measurements'::regclass AND attname='engagement_id'`],
  ['project_measurements.contract_id é NULÁVEL',
   `SELECT NOT attnotnull ok FROM pg_attribute
     WHERE attrelid='public.project_measurements'::regclass AND attname='contract_id'`],
  ['as 3 FKs antigas de contrato continuam existindo',
   `SELECT count(*)=3 ok FROM pg_constraint WHERE conrelid='public.project_measurements'::regclass
     AND conname IN ('pm_contract_tenant','pm_rule_tenant','pm_project_contract_linked')`],
  ['as 3 FKs novas de engajamento existem',
   `SELECT count(*)=3 ok FROM pg_constraint WHERE conrelid='public.project_measurements'::regclass
     AND conname IN ('pm_engagement_tenant','pm_engagement_rule_tenant','pm_engagement_project_linked')`],
  ['a máquina de estados da medição não mudou',
   `SELECT pg_get_constraintdef(oid) LIKE '%PLANNED%SUPERSEDED%' ok FROM pg_constraint
     WHERE conrelid='public.project_measurements'::regclass AND conname='project_measurements_status_check'`],
  ['uma fonte regente por trabalho (índice parcial)',
   `SELECT count(*)=1 ok FROM pg_indexes WHERE tablename='commercial_engagement_authorizations'
     AND indexname='cea_one_governing_per_engagement'`],
  ['uma revisão ACEITA por proposta',
   `SELECT count(*)=1 ok FROM pg_indexes WHERE tablename='commercial_proposal_revisions'
     AND indexname='cpr_one_accepted_per_proposal'`],
  ['fato só é ANCHORED com página E trecho',
   `SELECT pg_get_constraintdef(oid) LIKE '%source_page%source_quote%' ok FROM pg_constraint
     WHERE conname='cef_anchor_is_earned'`],
  ['nenhuma tabela proposal_* paralela',
   `SELECT count(*)=0 ok FROM information_schema.tables WHERE table_schema='public'
     AND table_name IN ('proposal_measurements','proposal_approvals','proposal_billing')`],
  ['portão de emissão de OS instalado',
   `SELECT count(*)=1 ok FROM pg_trigger WHERE tgname='iso_issue_gate'`],
  ['portão de consumo do blueprint instalado',
   `SELECT count(*)=1 ok FROM pg_trigger WHERE tgname='ceb_consumption_gate'`],
  ['contrato novo nasce com pai (gatilho)',
   `SELECT count(*)=1 ok FROM pg_trigger WHERE tgname='contracts_ensure_engagement_before'`],
  ['fila de revisão enxerga medição sem contrato (LEFT JOIN)',
   `SELECT pg_get_viewdef('public.project_measurement_review_queue'::regclass) LIKE '%LEFT JOIN contracts%' ok`],
];

let bad = 0;
for (const [label, sql] of checks) {
  const ok = (await c.query(sql)).rows[0]?.ok === true;
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}
console.log(bad ? `\n${bad} invariante(s) quebrado(s).` : '\nTodos os invariantes estruturais valem.');
await c.end();
process.exitCode = bad ? 1 : 0;
