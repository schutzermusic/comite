/**
 * Applies and proves forward-only release corrections 159–160.
 * Default is a rollback rehearsal; pass --apply to commit schema + registry.
 * Every proof row lives after SAVEPOINT proofs and is rolled back before commit.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';
import { recordMigrationApplied } from './lib/migration-registry.mjs';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('SUPABASE_DB_URL ausente. Migrations 159–160 não executadas.');
  process.exit(2);
}

const migrations = [
  ['159', 'contracts_operationalization_release_hardening'],
  ['160', 'contract_operational_fact_ai_provenance'],
];
const stripTransaction = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
let ok = true;
const must = (label, condition, detail = '') => {
  console.log(`   ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) ok = false;
};
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const mustReject = async (label, sql, params, fragment) => {
  await client.query('SAVEPOINT rejected_operation');
  try {
    await client.query(sql, params);
    await client.query('ROLLBACK TO SAVEPOINT rejected_operation');
    must(label, false, 'operation was accepted');
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT rejected_operation');
    const message = error instanceof Error ? error.message : String(error);
    must(label, message.toLowerCase().includes(fragment.toLowerCase()), message.slice(0, 180));
  }
};
const assumeUser = async (userId) => {
  await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
  await client.query(`SELECT set_config('request.jwt.claim.role', $1, true)`, [userId ? 'authenticated' : '']);
};

try {
  await client.connect();
  await client.query('SET SESSION default_transaction_read_only = off');
  const tip = (await one(
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::int DESC LIMIT 1',
  ))?.version;
  must('registry tip is 158 before correction', tip === '158', String(tip));
  if (tip !== '158') throw new Error(`Unexpected migration tip: ${tip}`);

  await client.query('BEGIN');
  for (const [version, name] of migrations) {
    const sql = readFileSync(`supabase/migrations/${version}_${name}.sql`, 'utf8');
    await client.query(stripTransaction(sql));
    await recordMigrationApplied(client, version, name);
    console.log(`   · ${version}_${name} applied in transaction`);
  }

  const registered = await client.query(
    `SELECT version FROM supabase_migrations.schema_migrations WHERE version IN ('159','160') ORDER BY version`,
  );
  must('159 and 160 are atomically registered', registered.rows.map((r) => r.version).join(',') === '159,160');

  const definers = await client.query(`
    SELECT p.proname, p.prosecdef, p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])
  `, [[
    'organization_has_business_calendar', 'organization_shift_business_days',
    'apex_followup_due_nudges', 'apex_followup_should_escalate',
    'apex_followup_create', 'apex_followup_transition', 'apex_followup_assign',
    'apex_followup_confirm_completion', 'contract_clause_resolve_attention',
    'apex_followup_complete_verified_evidence', 'contract_obligations_apply_schedule_anchor',
  ]]);
  must('all corrected definers have fixed public,pg_temp search_path',
    definers.rows.length === 11 && definers.rows.every((r) =>
      r.prosecdef && r.proconfig?.some((v) => v.replaceAll(' ', '') === 'search_path=public,pg_temp')),
  );

  const provenanceColumns = await one(`
    SELECT count(*)::int n FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name = ANY(ARRAY['contract_obligation_definitions','contract_billing_conditions',
         'contract_guarantees','contract_insurance_requirements','contract_indexation_rules'])
       AND column_name = ANY(ARRAY['ai_origin','ai_analysis_id','ai_provider','ai_model','ai_confidence',
         'ai_pipeline_version','ai_requesting_user_id','ai_evidence','ai_fingerprint'])
  `);
  must('all five fact families have all nine AI provenance columns', provenanceColumns.n === 45, String(provenanceColumns.n));

  await client.query('SAVEPOINT proofs');

  const memberships = (await client.query(`
    SELECT DISTINCT om.user_id
      FROM public.organization_memberships om
     WHERE om.status='ACTIVE'
     ORDER BY om.user_id
  `)).rows;
  let editor = null;
  let denied = null;
  for (const member of memberships) {
    await assumeUser(member.user_id);
    const context = await one(`SELECT public.current_user_organization_id() org,
      public.current_user_is_admin() admin,
      public.current_user_has_permission('contracts.edit') can_edit`);
    if (context.org && (context.admin || context.can_edit) && !editor) editor = { userId: member.user_id, org: context.org };
    if (context.org && !context.admin && !context.can_edit && !denied) denied = { userId: member.user_id, org: context.org };
  }
  must('found an authenticated editor for live authority proofs', Boolean(editor));
  must('found an authenticated member without contracts.edit', Boolean(denied));
  if (!editor || !denied) throw new Error('Live RBAC fixtures are unavailable.');

  await assumeUser(null);
  const contract = await one(`
    INSERT INTO public.contracts (organization_id,title,contract_number,status,start_date,end_date)
    VALUES ($1,'[PROOF 159] authority','[PROOF 159]','active',DATE '2026-01-01',DATE '2026-12-31')
    RETURNING id
  `, [editor.org]);
  const document = await one(`
    INSERT INTO public.contract_documents (organization_id,contract_id,title,file_path,document_type)
    VALUES ($1,$2,'[PROOF 159] evidence','proof/159.pdf','contract') RETURNING id
  `, [editor.org, contract.id]);

  await client.query(`INSERT INTO public.organization_business_calendars (organization_id)
    VALUES ($1) ON CONFLICT (organization_id) DO NOTHING`, [editor.org]);
  const acceptanceDefinition = await one(`
    INSERT INTO public.contract_obligation_definitions
      (organization_id,contract_id,title,responsible_side,source_document_id,source_page,source_excerpt,
       effective_from,activation_kind,due_kind,calendar_basis,schedule_anchor,
       schedule_anchor_offset_days,recurrence_kind)
    VALUES ($1,$2,'[PROOF 159] after acceptance','contracting_organization',$3,1,'após o aceite da medição',
            DATE '2026-01-01','schedule_anchor','days_after_schedule_anchor','calendar_days',
            'measurement_acceptance',2,'one_time') RETURNING id
  `, [editor.org, contract.id, document.id]);
  await one(`SELECT public.contract_obligations_materialize($1,DATE '2026-12-31',$2) n`,
    [acceptanceDefinition.id, editor.org]);
  const measurementRule = await one(`
    INSERT INTO public.contract_measurement_requirements
      (organization_id,contract_id,title,source_document_id,effective_from)
    VALUES ($1,$2,'[PROOF 159] measurement',$3,DATE '2026-01-01') RETURNING id
  `, [editor.org, contract.id, document.id]);
  let project = await one(`SELECT id FROM public.projects WHERE organization_id=$1 LIMIT 1`, [editor.org]);
  if (!project) {
    project = await one(`INSERT INTO public.projects (id,organization_id,project)
      VALUES ('PROOF-159',$1,'{"codigo":"PROOF-159","nome":"proof"}'::jsonb) RETURNING id`, [editor.org]);
  }
  await client.query(`INSERT INTO public.contract_project_links (organization_id,contract_id,project_id)
    VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [editor.org, contract.id, project.id]);
  const planned = await one(`
    INSERT INTO public.project_measurements
      (organization_id,project_id,contract_id,contract_measurement_rule_id,occurrence_key,expected_at,status)
    VALUES ($1,$2,$3,$4,'proof-planned',DATE '2026-09-30','PLANNED') RETURNING id
  `, [editor.org, project.id, contract.id, measurementRule.id]);
  const beforeAcceptance = await one(`SELECT public.contract_obligations_apply_schedule_anchor($1,$2) n`,
    [planned.id, editor.org]);
  const stillAwaiting = await one(`SELECT date_state,due_date FROM public.contract_obligation_instances
    WHERE definition_id=$1`, [acceptanceDefinition.id]);
  must('measurement_acceptance ignores planned expected_at',
    Number(beforeAcceptance.n) === 0 && stillAwaiting.date_state === 'AWAITING_SCHEDULE_ANCHOR' && stillAwaiting.due_date === null);
  const accepted = await one(`
    INSERT INTO public.project_measurements
      (organization_id,project_id,contract_id,contract_measurement_rule_id,occurrence_key,expected_at,
       status,accepted_at,acceptance_source,accepted_external_ref)
    VALUES ($1,$2,$3,$4,'proof-accepted',DATE '2026-09-30','ACCEPTED','2026-10-03T12:00:00Z',
            'integration','proof-159') RETURNING id
  `, [editor.org, project.id, contract.id, measurementRule.id]);
  const afterAcceptance = await one(`SELECT public.contract_obligations_apply_schedule_anchor($1,$2) n`,
    [accepted.id, editor.org]);
  const resolvedAcceptance = await one(`SELECT date_state,due_date,schedule_anchor_date
    FROM public.contract_obligation_instances WHERE definition_id=$1`, [acceptanceDefinition.id]);
  must('measurement_acceptance uses actual accepted_at deterministically',
    Number(afterAcceptance.n) === 1
      && resolvedAcceptance.date_state === 'RESOLVED'
      && new Date(resolvedAcceptance.schedule_anchor_date).toISOString().slice(0, 10) === '2026-10-03'
      && new Date(resolvedAcceptance.due_date).toISOString().slice(0, 10) === '2026-10-05');

  const attentionClause = await one(`
    INSERT INTO public.contract_clauses
      (organization_id,contract_id,title,clause_type,content,risk_level,source_document_id,
       source_page,source_excerpt,ai_flagged,review_status,ai_confidence,ai_provider,ai_model)
    VALUES ($1,$2,'[PROOF 159] attention','penalidade','multa material','high',$3,
            1,'multa material',true,'draft',0.9,'proof','proof-model') RETURNING id
  `, [editor.org, contract.id, document.id]);
  await assumeUser(editor.userId);
  await one(`SELECT public.contract_clause_resolve_attention($1,'confirm','proof')`, [attentionClause.id]);
  await assumeUser(null);
  await mustReject('service cannot reuse an attention-resolution stamp',
    `UPDATE public.contract_clauses SET interpretation_state='dismissed' WHERE id=$1`,
    [attentionClause.id], 'governance violation');

  const reviewClause = await one(`
    INSERT INTO public.contract_clauses
      (organization_id,contract_id,title,clause_type,content,risk_level,source_document_id,
       source_page,source_excerpt,ai_flagged,review_status,ai_confidence,ai_provider,ai_model)
    VALUES ($1,$2,'[PROOF 159] review','pagamento','30 dias','low',$3,
            1,'pagamento em 30 dias',true,'draft',0.9,'proof','proof-model') RETURNING id
  `, [editor.org, contract.id, document.id]);
  await assumeUser(editor.userId);
  await client.query(`UPDATE public.contract_clauses
    SET review_status='validated',reviewed_by=$2,reviewed_at=now() WHERE id=$1`,
    [reviewClause.id, editor.userId]);
  await assumeUser(null);
  await mustReject('service cannot reuse a reviewer stamp for a different decision',
    `UPDATE public.contract_clauses SET review_status='rejected' WHERE id=$1`,
    [reviewClause.id], 'governance violation');

  await assumeUser(editor.userId);
  const first = await one(`SELECT (public.apex_followup_create(
    'proof-159-idempotency','contract',$1,$1,'Governed proof',NULL,NULL,NULL,'Owner',NULL,7,NULL,NULL,
    'human_confirmation',NULL)).id id`, [contract.id]);
  const retry = await one(`SELECT (public.apex_followup_create(
    'proof-159-idempotency','contract',$1,$1,'Governed proof',NULL,NULL,NULL,'Owner',NULL,7,NULL,NULL,
    'human_confirmation',NULL)).id id`, [contract.id]);
  must('duplicate create returns the same follow-up', first.id === retry.id);
  const createdEvents = await one(`SELECT count(*)::int n FROM public.apex_followup_events
    WHERE followup_id=$1 AND event_type='created'`, [first.id]);
  must('duplicate create emits one created event', createdEvents.n === 1, String(createdEvents.n));
  const actor = await one(`SELECT actor_kind, actor_user_id FROM public.apex_followup_events
    WHERE followup_id=$1 AND event_type='created'`, [first.id]);
  must('human API/RPC actor is the actual auth.uid()',
    actor.actor_kind === 'human' && actor.actor_user_id === editor.userId,
    `${actor.actor_kind}/${actor.actor_user_id}`);

  await one(`SELECT public.apex_followup_assign($1,NULL,NULL,'Human owner')`, [first.id]);
  await assumeUser(null);
  await mustReject('service cannot reuse a human responsibility stamp',
    `UPDATE public.apex_followups SET responsible_text='Impersonated' WHERE id=$1`, [first.id], 'governance violation');

  await assumeUser(editor.userId);
  await one(`SELECT public.apex_followup_transition($1,'CANCELLED','closed',NULL,NULL)`, [first.id]);
  await assumeUser(null);
  await mustReject('terminal follow-up cannot be rewritten',
    `UPDATE public.apex_followups SET state_note='rewritten' WHERE id=$1`, [first.id], 'immutable');

  await assumeUser(editor.userId);
  const deterministic = await one(`SELECT (public.apex_followup_create(
    'proof-159-evidence','contract',$1,$1,'Evidence proof',NULL,NULL,NULL,'Owner',NULL,NULL,NULL,NULL,
    'deterministic_evidence','{"expectedTaxId":"123"}'::jsonb)).id id`, [contract.id]);
  await assumeUser(null);
  await mustReject('arbitrary evidence UUID cannot close a follow-up',
    `UPDATE public.apex_followups SET state='COMPLETED',closure_basis='verified_evidence',closed_at=now(),
      verified_at=now(),verification_evidence_id=gen_random_uuid() WHERE id=$1`,
    [deterministic.id], 'not validated');
  await mustReject('trusted verifier rejects evidence that fails the rule',
    `SELECT public.apex_followup_complete_verified_evidence($1,$2,'999',NULL)`,
    [deterministic.id, document.id], 'does not satisfy');

  await assumeUser(denied.userId);
  await mustReject('SECURITY DEFINER mutation enforces contracts.edit internally',
    `SELECT public.apex_followup_create('proof-159-denied','contract',$1,$1,'Denied',NULL,NULL,NULL,'Owner')`,
    [contract.id], 'contracts.edit');

  const otherOrg = await one(`SELECT id FROM public.organizations WHERE id<>$1 LIMIT 1`, [editor.org]);
  if (otherOrg) {
    await assumeUser(editor.userId);
    await mustReject('authenticated org A cannot query org B follow-up queue',
      `SELECT * FROM public.apex_followup_due_nudges($1,CURRENT_DATE)`, [otherOrg.id], 'outside authenticated tenant');
    await mustReject('authenticated org A cannot query org B calendar',
      `SELECT public.organization_has_business_calendar($1)`, [otherOrg.id], 'outside authenticated tenant');
  } else {
    must('cross-org fixture exists', false, 'only one organization in live database');
  }

  await assumeUser(null);
  await client.query('ROLLBACK TO SAVEPOINT proofs');
  if (!ok) throw new Error('One or more release-hardening proofs failed.');

  if (apply) {
    await client.query('COMMIT');
    console.log('=== MIGRATIONS 159–160 APPLIED AND REGISTERED ===');
  } else {
    await client.query('ROLLBACK');
    console.log('=== REHEARSAL PASSED; ROLLED BACK ===');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  console.error(`✗ FAILED: ${error instanceof Error ? error.message : String(error)}`);
  ok = false;
} finally {
  await client.end().catch(() => undefined);
}

process.exit(ok ? 0 : 1);
