/** Live, disposable proofs for migrations 161–163. Every row is rolled back. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });
const suite = process.env.SUPABASE_DB_URL ? describe : describe.skip;

suite('Contracts operationalization final blockers — live', () => {
  let db: InstanceType<typeof import('pg').Client>;
  let org: string; let contract: string; let document: string; let project: string;
  let measurementRule: string; let definition: string; let measurement: string;
  const suffix = Math.random().toString(36).slice(2, 9);
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
  const rejected = async (sql: string, params: unknown[] = []) => {
    await db.query('SAVEPOINT expected_rejection');
    try {
      await db.query(sql, params);
      await db.query('ROLLBACK TO SAVEPOINT expected_rejection');
      return null;
    } catch (error) {
      await db.query('ROLLBACK TO SAVEPOINT expected_rejection');
      return (error as Error).message;
    }
  };

  beforeAll(async () => {
    const pg = await import('pg');
    db = new pg.default.Client({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await db.connect();
    await db.query('SET SESSION default_transaction_read_only = off');
    await db.query('BEGIN');
    org = (await one(`INSERT INTO public.organizations(name,slug)
      VALUES ('[TEST 161] release blockers',$1) RETURNING id`, [`test-161-${suffix}`])).id;
    contract = (await one(`INSERT INTO public.contracts
      (organization_id,title,contract_number,status,start_date,end_date)
      VALUES ($1,'[TEST 161] contract',$2,'active','2026-01-01','2026-12-31') RETURNING id`,
    [org, `TEST-161-${suffix}`])).id;
    document = (await one(`INSERT INTO public.contract_documents
      (organization_id,contract_id,title,file_path,document_type)
      VALUES ($1,$2,'[TEST 161] source',$3,'contract') RETURNING id`,
    [org, contract, `tests/161-${suffix}.pdf`])).id;
    project = `TEST-161-${suffix}`;
    await db.query(`INSERT INTO public.projects(id,organization_id,project)
      VALUES ($1,$2,jsonb_build_object('codigo',$1::text,'nome','[TEST 161] project'))`, [project, org]);
    await db.query(`INSERT INTO public.contract_project_links(organization_id,contract_id,project_id)
      VALUES ($1,$2,$3)`, [org, contract, project]);
    measurementRule = (await one(`INSERT INTO public.contract_measurement_requirements
      (organization_id,contract_id,title,source_document_id,effective_from)
      VALUES ($1,$2,'[TEST 161] measurement',$3,'2026-01-01') RETURNING id`,
    [org, contract, document])).id;
    definition = (await one(`INSERT INTO public.contract_obligation_definitions
      (organization_id,contract_id,title,responsible_side,source_document_id,source_page,source_excerpt,
       effective_from,activation_kind,due_kind,calendar_basis,schedule_anchor,
       schedule_anchor_offset_days,recurrence_kind,blocks_billing)
      VALUES ($1,$2,'[TEST 161] scheduled obligation','contracting_organization',$3,1,
       'Entregar documento cinco dias antes da medição','2026-01-01','schedule_anchor',
       'days_before_schedule_anchor','calendar_days','measurement',5,'one_time',true) RETURNING id`,
    [org, contract, document])).id;
    await one(`SELECT public.contract_obligations_materialize($1,'2026-12-31',$2)`, [definition, org]);
  });

  afterAll(async () => {
    await db?.query('ROLLBACK').catch(() => undefined);
    await db?.end().catch(() => undefined);
  });

  it('emits and routes a real schedule event, then resolves idempotently', async () => {
    measurement = (await one(`INSERT INTO public.project_measurements
      (organization_id,project_id,contract_id,contract_measurement_rule_id,occurrence_key,expected_at,status)
      VALUES ($1,$2,$3,$4,'test-161','2026-09-30','PLANNED') RETURNING id`,
    [org, project, contract, measurementRule])).id;
    const event = await one(`SELECT id FROM public.domain_events
      WHERE organization_id=$1 AND aggregate_id=$2
        AND event_type='projects.measurement.schedule_changed'`, [org, measurement]);
    expect(event?.id).toBeTruthy();

    await one(`SELECT * FROM public.apex_route_pending_events(500)`);
    const job = await one(`SELECT job_type,organization_id FROM public.apex_jobs
      WHERE event_id=$1 AND job_type='contracts.obligation.schedule_anchor.apply'`, [event.id]);
    expect(job).toMatchObject({ job_type: 'contracts.obligation.schedule_anchor.apply', organization_id: org });

    expect(Number((await one(
      `SELECT public.contract_obligations_apply_schedule_anchor($1,$2) n`, [measurement, org])).n)).toBe(1);
    const resolved = await one(`SELECT due_date,date_state,schedule_anchor_ref_id
      FROM public.contract_obligation_instances WHERE definition_id=$1`, [definition]);
    expect(new Date(resolved.due_date).toISOString().slice(0, 10)).toBe('2026-09-25');
    expect(resolved.date_state).toBe('RESOLVED');
    expect(resolved.schedule_anchor_ref_id).toBe(measurement);
    expect(Number((await one(
      `SELECT public.contract_obligations_apply_schedule_anchor($1,$2) n`, [measurement, org])).n)).toBe(0);
    expect(await rejected(
      `SELECT public.contract_obligations_apply_schedule_anchor($1,gen_random_uuid())`, [measurement],
    )).toMatch(/outside the supplied organization/);
  });

  it('keeps acceptance anchors unresolved until actual accepted_at', async () => {
    const acceptanceDef = (await one(`INSERT INTO public.contract_obligation_definitions
      (organization_id,contract_id,title,responsible_side,source_document_id,source_page,source_excerpt,
       effective_from,activation_kind,due_kind,calendar_basis,schedule_anchor,
       schedule_anchor_offset_days,recurrence_kind)
      VALUES ($1,$2,'[TEST 161] acceptance obligation','contracting_organization',$3,1,
       'Entregar documento dois dias após o aceite','2026-01-01','schedule_anchor',
       'days_after_schedule_anchor','calendar_days','measurement_acceptance',2,'one_time') RETURNING id`,
    [org, contract, document])).id;
    await one(`SELECT public.contract_obligations_materialize($1,'2026-12-31',$2)`, [acceptanceDef, org]);
    expect(Number((await one(
      `SELECT public.contract_obligations_apply_schedule_anchor($1,$2) n`, [measurement, org])).n)).toBe(0);
    expect((await one(`SELECT date_state FROM public.contract_obligation_instances
      WHERE definition_id=$1`, [acceptanceDef])).date_state).toBe('AWAITING_SCHEDULE_ANCHOR');

    await db.query(`UPDATE public.project_measurements SET status='IN_PREPARATION' WHERE id=$1`, [measurement]);
    await db.query(`UPDATE public.project_measurements SET status='READY_FOR_SUBMISSION' WHERE id=$1`, [measurement]);
    await db.query(`UPDATE public.project_measurements SET status='SUBMITTED',submitted_at=now() WHERE id=$1`, [measurement]);
    await one(`SELECT public.project_measurement_accept($1,'integration',NULL,NULL,NULL,NULL,$2,NULL,'test')`,
      [measurement, `accepted-${suffix}`]);
    const accepted = await one(`SELECT accepted_at FROM public.project_measurements WHERE id=$1`, [measurement]);
    expect(Number((await one(
      `SELECT public.contract_obligations_apply_schedule_anchor($1,$2) n`, [measurement, org])).n)).toBe(1);
    const resolved = await one(`SELECT schedule_anchor_date,due_date FROM public.contract_obligation_instances
      WHERE definition_id=$1`, [acceptanceDef]);
    expect(new Date(resolved.schedule_anchor_date).toISOString().slice(0, 10))
      .toBe(new Date(accepted.accepted_at).toISOString().slice(0, 10));
  });

  it('executes nudges, waiting, blocking and escalation without duplicates', async () => {
    const make = async (key: string, state: string, extras = '') => (await one(`INSERT INTO public.apex_followups
      (organization_id,idempotency_key,source_kind,source_id,contract_id,goal,responsible_text,state,
       due_date,cadence_days,escalate_after_days,next_expected_event,next_expected_event_at)
      VALUES ($1,$2,'contract',$3,$3,$2,'Owner',$4,'2026-09-01',NULL,NULL,NULL,NULL ${extras}) RETURNING id`,
    [org, `${key}-${suffix}`, contract, state])).id;
    const active = await make('active', 'ACTIVE');
    const blocked = await make('blocked', 'BLOCKED');
    const waiting = (await one(`INSERT INTO public.apex_followups
      (organization_id,idempotency_key,source_kind,source_id,contract_id,goal,responsible_text,state,
       due_date,next_expected_event,next_expected_event_at)
      VALUES ($1,$2,'contract',$3,$3,'waiting','Owner','WAITING_EXTERNAL_PARTY','2026-09-01',
        'customer response','2026-09-15') RETURNING id`, [org, `waiting-${suffix}`, contract])).id;
    const escalation = (await one(`INSERT INTO public.apex_followups
      (organization_id,idempotency_key,source_kind,source_id,contract_id,goal,responsible_text,state,
       due_date,escalate_after_days)
      VALUES ($1,$2,'contract',$3,$3,'escalate','Owner','ACTIVE','2026-09-01',3) RETURNING id`,
    [org, `escalate-${suffix}`, contract])).id;

    const due = await db.query(`SELECT id FROM public.apex_followup_due_nudges($1,'2026-09-11')`, [org]);
    expect(new Set(due.rows.map((row) => row.id))).toEqual(new Set([active, escalation]));
    const shouldEscalate = await db.query(
      `SELECT public.apex_followup_should_escalate($1,'2026-09-11') id`, [org],
    );
    expect(shouldEscalate.rows.map((row) => row.id)).toEqual([escalation]);

    const first = await one(`SELECT public.apex_followups_execute_due($1,'2026-09-11',200) result`, [org]);
    expect(first.result).toMatchObject({ nudged: 1, escalated: 1 });
    const states = await db.query(`SELECT id,state,nudge_count FROM public.apex_followups
      WHERE id=ANY($1::uuid[])`, [[active, blocked, waiting, escalation]]);
    const byId = new Map(states.rows.map((row) => [row.id, row]));
    expect(byId.get(active)?.nudge_count).toBe(1);
    expect(byId.get(blocked)?.nudge_count).toBe(0);
    expect(byId.get(waiting)?.nudge_count).toBe(0);
    expect(byId.get(escalation)?.state).toBe('ESCALATED');

    const second = await one(`SELECT public.apex_followups_execute_due($1,'2026-09-11',200) result`, [org]);
    expect(second.result).toMatchObject({ nudged: 0, escalated: 0 });
    const escalations = await one(`SELECT count(*)::int n FROM public.apex_followup_events
      WHERE followup_id=$1 AND event_type='escalated'`, [escalation]);
    expect(escalations.n).toBe(1);
  });

  it('closes deterministic verification only after a candidate actually passes', async () => {
    const invalidDoc = (await one(`INSERT INTO public.contract_documents
      (organization_id,contract_id,title,file_path,document_type)
      VALUES ($1,$2,'invalid evidence',$3,'certificate') RETURNING id`,
    [org, contract, `tests/invalid-${suffix}.pdf`])).id;
    const validDoc = (await one(`INSERT INTO public.contract_documents
      (organization_id,contract_id,title,file_path,document_type)
      VALUES ($1,$2,'valid evidence',$3,'certificate') RETURNING id`,
    [org, contract, `tests/valid-${suffix}.pdf`])).id;
    const followup = (await one(`INSERT INTO public.apex_followups
      (organization_id,idempotency_key,source_kind,source_id,contract_id,goal,responsible_text,state,
       verification_mode,verification_rule)
      VALUES ($1,$2,'contract',$3,$3,'verify','Owner','ACTIVE','deterministic_evidence',
        '{"expectedTaxId":"123","mustCoverDate":"2026-12-31"}') RETURNING id`,
    [org, `verify-${suffix}`, contract])).id;
    await one(`SELECT public.apex_followup_register_evidence_candidate($1,$2,$3,'999','2027-01-01',$4)`,
      [org, followup, invalidDoc, `trusted:test:${suffix}:invalid`]);
    await one(`SELECT public.apex_followups_execute_due($1,'2026-09-11',200)`, [org]);
    expect((await one(`SELECT state FROM public.apex_followups WHERE id=$1`, [followup])).state).toBe('ACTIVE');

    await one(`SELECT public.apex_followup_register_evidence_candidate($1,$2,$3,'123','2027-01-01',$4)`,
      [org, followup, validDoc, `trusted:test:${suffix}:valid`]);
    await one(`SELECT public.apex_followups_execute_due($1,'2026-09-11',200)`, [org]);
    const closed = await one(`SELECT state,closure_basis,verified_by,verification_evidence_id
      FROM public.apex_followups WHERE id=$1`, [followup]);
    expect(closed).toMatchObject({
      state: 'COMPLETED', closure_basis: 'verified_evidence', verified_by: null,
      verification_evidence_id: validDoc,
    });
    const attempts = await db.query(`SELECT c.document_tax_id,a.verified
      FROM public.apex_followup_verification_attempts a
      JOIN public.apex_followup_evidence_candidates c ON c.id=a.candidate_id
      WHERE a.followup_id=$1`, [followup]);
    expect(Object.fromEntries(attempts.rows.map((row) => [row.document_tax_id, row.verified])))
      .toEqual({ '999': false, '123': true });
  });

  it('persists low-confidence interpretation with null requester but rejects authoritative effect', async () => {
    const analysis = (await one(`INSERT INTO public.contract_ai_analyses
      (organization_id,contract_id,document_id,status,provider,model,extractor_version,created_by)
      VALUES ($1,$2,$3,'completed','test','test-model','test-v1',NULL) RETURNING id`,
    [org, contract, document])).id;
    await db.query(`INSERT INTO public.contract_operational_interpretations
      (organization_id,contract_id,analysis_id,source_document_id,family,fingerprint,
       normalized_payload,source_page,source_excerpt,confidence,provider,model,pipeline_version,
       requesting_user_id,trust_state,trust_reasons,trust_policy_version)
      VALUES ($1,$2,$3,$4,'obligations',$5,'{"blocks_billing":true}',1,
       'Low confidence billing blocker interpretation',0.05,'test','test-model','test-v1',NULL,
       'requires_attention',ARRAY['low_confidence'],'contract-operational-trust/1.0.0')`,
    [org, contract, analysis, document, `low-${suffix}`]);
    const message = await rejected(`INSERT INTO public.contract_obligation_definitions
      (organization_id,contract_id,title,responsible_side,source_document_id,source_page,source_excerpt,
       activation_kind,due_kind,calendar_basis,recurrence_kind,blocks_billing,created_by,
       ai_origin,ai_analysis_id,ai_provider,ai_model,ai_confidence,ai_pipeline_version,
       ai_requesting_user_id,ai_evidence,ai_fingerprint)
      VALUES ($1,$2,'low authority','contracting_organization',$3,1,
       'Low confidence billing blocker interpretation','manual','unspecified','unspecified','one_time',true,NULL,
       'apex_ai',$4,'test','test-model',0.05,'test-v1',NULL,
       jsonb_build_object('documentId',$3::uuid,'page',1,'excerpt','Low confidence billing blocker interpretation'),$5)`,
    [org, contract, document, analysis, `low-authority-${suffix}`]);
    expect(message).toMatch(/low confidence/);
    const persisted = await one(`SELECT trust_state,requesting_user_id,
      normalized_payload->>'blocks_billing' blocks FROM public.contract_operational_interpretations
      WHERE analysis_id=$1`, [analysis]);
    expect(persisted).toMatchObject({ trust_state: 'requires_attention', requesting_user_id: null, blocks: 'true' });

    const high = await one(`INSERT INTO public.contract_obligation_definitions
      (organization_id,contract_id,title,responsible_side,source_document_id,source_page,source_excerpt,
       activation_kind,due_kind,calendar_basis,recurrence_kind,blocks_billing,created_by,
       ai_origin,ai_analysis_id,ai_provider,ai_model,ai_confidence,ai_pipeline_version,
       ai_requesting_user_id,ai_evidence,ai_fingerprint)
      VALUES ($1,$2,'high authority','contracting_organization',$3,2,
       'High confidence and well evidenced operational rule','manual','unspecified','unspecified','one_time',false,NULL,
       'apex_ai',$4,'test','test-model',0.95,'test-v1',NULL,
       jsonb_build_object('documentId',$3::uuid,'page',2,'excerpt','High confidence and well evidenced operational rule'),$5)
      RETURNING id,ai_requesting_user_id`, [org, contract, document, analysis, `high-${suffix}`]);
    expect(high.ai_requesting_user_id).toBeNull();
  });

  it('keeps direct history mutation blocked and allows governed tenant cascade', async () => {
    const event = await one(`SELECT id FROM public.apex_followup_events WHERE organization_id=$1 LIMIT 1`, [org]);
    expect(await rejected(`UPDATE public.apex_followup_events SET note='rewrite' WHERE id=$1`, [event.id]))
      .toMatch(/append-only/);
    expect(await rejected(`DELETE FROM public.apex_followup_events WHERE id=$1`, [event.id]))
      .toMatch(/append-only/);

    // The canonical tenant teardown removes non-cascading Projects roots first;
    // deleting the organization then exercises the Follow-up FK cascades.
    await db.query(`DELETE FROM public.project_measurements WHERE organization_id=$1`, [org]);
    await db.query(`DELETE FROM public.contract_project_links WHERE organization_id=$1`, [org]);
    await db.query(`DELETE FROM public.projects WHERE organization_id=$1`, [org]);
    await db.query(`DELETE FROM public.contracts WHERE organization_id=$1`, [org]);
    await db.query(`DELETE FROM public.organizations WHERE id=$1`, [org]);
    expect((await one(`SELECT count(*)::int n FROM public.apex_followup_events WHERE organization_id=$1`, [org])).n)
      .toBe(0);
    expect((await one(`SELECT count(*)::int n FROM public.apex_followup_evidence_verifications
      WHERE organization_id=$1`, [org])).n).toBe(0);
    expect((await one(`SELECT count(*)::int n FROM public.apex_followups WHERE organization_id=$1`, [org])).n)
      .toBe(0);
  });
});
