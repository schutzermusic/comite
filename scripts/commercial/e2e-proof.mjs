/**
 * PROVAS E2E do Comercial → Engajamento → OS interna → Projeto → Medição →
 * Revisão → Cliente → Faturamento.
 *
 * Roda SEMPRE dentro de uma transação e SEMPRE termina em ROLLBACK. Nenhum
 * estado real é alterado: as provas usam dados REAIS existentes (organização,
 * projeto, contrato e medições de verdade) e acrescentam o mínimo necessário
 * para o cenário, tudo desfeito no fim.
 *
 *   node scripts/commercial/e2e-proof.mjs            # contra o schema aplicado
 *   node scripts/commercial/e2e-proof.mjs --with-migrations 197 198 199 200 201
 */
import { readFileSync, readdirSync } from 'node:fs';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const argv = process.argv.slice(2);
const withMigrations = argv.includes('--with-migrations');
const versions = argv.filter((a) => /^\d+$/.test(a));
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const results = [];
const record = (scenario, step, ok, detail) => {
  results.push({ scenario, step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${scenario} · ${step}${detail ? ` — ${detail}` : ''}`);
};
const assert = (scenario, step, condition, detail) => {
  record(scenario, step, Boolean(condition), detail);
  if (!condition) throw new Error(`${scenario} · ${step} failed: ${detail ?? ''}`);
};
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

/**
 * Executa algo que DEVE falhar, sem derrubar a transação do ensaio.
 * Postgres aborta a transação inteira no primeiro erro; sem SAVEPOINT, provar
 * que um portão bloqueia custaria o restante das provas.
 */
let savepointSeq = 0;
const expectFailure = async (fn) => {
  const sp = `sp_${++savepointSeq}`;
  await db.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    await db.query(`RELEASE SAVEPOINT ${sp}`);
    return null;
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await db.query(`RELEASE SAVEPOINT ${sp}`);
    return error.message;
  }
};

let fatal = null;
try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');

  if (withMigrations) {
    for (const v of versions) {
      const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith(`${v}_`));
      await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
      console.log(`      (migration ${file} applied inside the rehearsal)`);
    }
  }

  // ---- âncoras reais ----------------------------------------------------
  const anchor = await one(`
    SELECT m.id AS measurement_id, m.organization_id, m.project_id, m.contract_id,
           m.engagement_id, m.contract_measurement_rule_id, m.status
      FROM public.project_measurements m
     WHERE m.status = 'PLANNED' AND m.contract_id IS NOT NULL
     ORDER BY m.created_at LIMIT 1`);
  if (!anchor) throw new Error('Nenhuma medição contratada real disponível para o cenário A.');
  const org = anchor.organization_id;
  const actor = (await one(
    `SELECT user_id AS id FROM public.organization_memberships WHERE organization_id = $1 LIMIT 1`,
    [org]))?.id;
  if (!actor) throw new Error('Organização real sem membro: sem ator humano para os cenários.');
  console.log(`\nâncoras reais → org=${org} projeto=${anchor.project_id} contrato=${anchor.contract_id}\n`);

  // =======================================================================
  // A — o projeto com CONTRATO FORMAL continua funcionando igual
  // =======================================================================
  const A = 'A · contrato formal existente';
  {
    assert(A, 'medição herdou o pai sem mudar de contrato',
      anchor.engagement_id && anchor.contract_id,
      `engagement=${anchor.engagement_id} contract=${anchor.contract_id}`);

    const linked = await one(
      `SELECT count(*)::int n FROM public.engagement_project_links
        WHERE organization_id=$1 AND engagement_id=$2 AND project_id=$3`,
      [org, anchor.engagement_id, anchor.project_id]);
    assert(A, 'vínculo projeto↔engajamento espelhado do vínculo contratual', linked.n === 1);

    await db.query(
      `UPDATE public.project_measurements
          SET status='IN_PREPARATION', quantity=1, unit='un',
              measured_value=125000.00, currency='BRL', measured_at=now()
        WHERE id=$1`, [anchor.measurement_id]);
    await db.query(
      `UPDATE public.project_measurements SET status='READY_FOR_SUBMISSION' WHERE id=$1`,
      [anchor.measurement_id]);
    const submitted = await one(
      `SELECT public.project_measurement_transition($1,'SUBMITTED','projects.measurement.submitted',
         'E2E', 'system', NULL, '{}'::jsonb, '{}'::jsonb, NULL, 'submitted_at') r`,
      [anchor.measurement_id]);
    assert(A, 'submissão pela MESMA máquina de estados canônica',
      submitted.r?.status === 'SUBMITTED', JSON.stringify(submitted.r));

    await one(`SELECT public.project_measurement_start_review($1,'E2E') r`, [anchor.measurement_id]);
    await one(`SELECT public.project_measurement_approve_for_customer($1,'E2E') r`, [anchor.measurement_id]);
    const sent = await one(
      `SELECT public.project_measurement_send_to_customer($1,'email',NULL,'cliente@exemplo',
         'E2E-A', (current_date + 15), ARRAY[]::uuid[], 'E2E') r`, [anchor.measurement_id]);
    assert(A, 'envio ao cliente pela MESMA função de sempre',
      sent.r?.status === 'AWAITING_CUSTOMER_ACCEPTANCE', JSON.stringify(sent.r));

    const accepted = await one(
      `SELECT public.project_measurement_accept($1,'signed_bulletin',1,125000.00,'BRL',
         NULL,'BOL-E2E-A',NULL,'E2E') r`, [anchor.measurement_id]);
    assert(A, 'aceite do cliente pela MESMA função de sempre',
      accepted.r?.status === 'ACCEPTED', JSON.stringify(accepted.r));

    const ev = await one(
      `SELECT id FROM public.domain_events
        WHERE organization_id=$1 AND aggregate_id=$2
          AND event_type='projects.measurement.accepted' ORDER BY recorded_at DESC LIMIT 1`,
      [org, anchor.measurement_id]);
    assert(A, 'evento canônico de aceite emitido', Boolean(ev?.id));

    const billing = await one(
      `SELECT public.contract_billing_apply_measurement_accepted($1) r`, [ev.id]);
    assert(A, 'candidato de faturamento criado a partir do aceite',
      billing.r?.created === true, JSON.stringify(billing.r));

    const bev = await one(
      `SELECT contract_id, engagement_id, eligibility_state, release_state, amount
         FROM public.contract_billing_events WHERE id=$1`, [billing.r.billing_event_id]);
    assert(A, 'faturamento mantém o contrato canônico', bev.contract_id === anchor.contract_id);
    assert(A, 'faturamento nasce SEM liberação', bev.release_state === 'NOT_ELIGIBLE'
      || bev.release_state === 'ELIGIBLE' || bev.release_state !== 'RELEASED',
      `release_state=${bev.release_state} eligibility=${bev.eligibility_state}`);

    const inQueue = await one(
      `SELECT count(*)::int n FROM public.project_measurement_review_queue WHERE measurement_id=$1`,
      [anchor.measurement_id]);
    assert(A, 'medição contratada continua na fila de Medições & Aprovações', inQueue.n === 1);
  }

  // =======================================================================
  // B — proposta aceita SEM contrato formal percorre o MESMO caminho
  // =======================================================================
  const B = 'B · proposta aceita sem contrato';
  let engagementB, osB, projectB, measurementB;
  {
    const eng = await one(
      `SELECT public.commercial_engagement_create($1,$2,$3::jsonb) id`,
      [org, actor, JSON.stringify({
        title: '[E2E] Serviços de comissionamento — sem contrato formal',
        counterparty_name: 'Cliente E2E S.A.', origin: 'accepted_proposal', currency: 'BRL',
      })]);
    engagementB = eng.id;
    const engRow = await one(`SELECT status, authorized_value FROM public.commercial_engagements WHERE id=$1`, [engagementB]);
    assert(B, 'engajamento nasce EM ANÁLISE e fora dos KPIs de valor',
      engRow.status === 'UNDER_ANALYSIS' && engRow.authorized_value === null);

    // O PDF canônico da proposta vive no MESMO acervo dos contratos, pendurado
    // no engajamento porque não há instrumento.
    const propDoc = await one(
      `INSERT INTO public.contract_documents
         (organization_id, engagement_id, contract_id, title, file_path, document_type,
          status, content_sha256, uploaded_by)
       VALUES ($1,$2,NULL,'[E2E] Proposta técnica e comercial rev.1','e2e/prop-0001.pdf',
               'commercial_proposal','uploaded', repeat('b',64), $3)
       RETURNING id`, [org, engagementB, actor]);

    // Proposta técnica + comercial (documento combinado), revisão 1.
    const prop = await one(
      `INSERT INTO public.commercial_proposals
         (organization_id, proposal_number, kind, title, counterparty_name, currency, created_by)
       VALUES ($1,'[E2E] PROP-0001','COMBINED','[E2E] Proposta técnica e comercial',
               'Cliente E2E S.A.','BRL',$2) RETURNING id`, [org, actor]);
    const rev = await one(
      `INSERT INTO public.commercial_proposal_revisions
         (organization_id, proposal_id, revision, status, total_value, currency,
          scope_summary, payment_terms, document_id, internally_approved_at,
          internally_approved_by, sent_at, sent_by, created_by)
       VALUES ($1,$2,1,'SENT',480000.00,'BRL',
               'Comissionamento de 4 bays de 138 kV, ensaios e databook.',
               '30 dias após aceite da medição', $4, now(), $3, now(), $3, $3)
       RETURNING id`, [org, prop.id, actor, propDoc.id]);

    const blocked = await expectFailure(() => db.query(
      `SELECT public.commercial_engagement_attach_authorization($1,$2,$3,$4::jsonb)`,
      [org, actor, engagementB, JSON.stringify({
        source_kind: 'accepted_proposal', proposal_revision_id: rev.id,
        authorized_value: 480000, currency: 'BRL' })]));
    assert(B, 'revisão NÃO aceita é recusada como fonte de autorização',
      blocked && /only an ACCEPTED revision/i.test(blocked), blocked ?? 'não bloqueou');

    const outcome = await one(
      `SELECT public.commercial_proposal_revision_record_outcome($1,$2,$3,'ACCEPTED',$4::jsonb) r`,
      [org, actor, rev.id, JSON.stringify({
        acceptance_source: 'signed_document', acceptance_external_ref: 'ACEITE-E2E-001' })]);
    assert(B, 'aceite do cliente registrado por humano nomeado', outcome.r?.status === 'ACCEPTED');
    const revRow = await one(`SELECT recorded_by, acceptance_source FROM public.commercial_proposal_revisions WHERE id=$1`, [rev.id]);
    assert(B, 'aceite carrega quem registrou e como o cliente se manifestou',
      revRow.recorded_by === actor && revRow.acceptance_source === 'signed_document');

    const auth1 = await one(
      `SELECT public.commercial_engagement_attach_authorization($1,$2,$3,$4::jsonb) r`,
      [org, actor, engagementB, JSON.stringify({
        source_kind: 'accepted_proposal', proposal_revision_id: rev.id,
        authorized_value: 480000, currency: 'BRL' })]);
    assert(B, 'proposta aceita vira fonte REGENTE do engajamento', auth1.r?.governing === true);

    const authorized = await one(
      `SELECT public.commercial_engagement_authorize($1,$2,$3,'E2E') r`, [org, actor, engagementB]);
    assert(B, 'engajamento autorizado deriva o valor da fonte regente',
      authorized.r?.status === 'AUTHORIZED');
    const engAuth = await one(`SELECT authorized_value, status FROM public.commercial_engagements WHERE id=$1`, [engagementB]);
    assert(B, 'valor autorizado veio da proposta, não digitado',
      Number(engAuth.authorized_value) === 480000);

    const noContract = await one(
      `SELECT count(*)::int n FROM public.contracts WHERE engagement_id=$1`, [engagementB]);
    assert(B, 'NENHUM contrato falso foi criado', noContract.n === 0);

    const os = await one(
      `SELECT public.internal_service_order_create($1,$2,$3,$4::jsonb) r`,
      [org, actor, engagementB, JSON.stringify({
        origin: 'from_accepted_proposal', source_proposal_revision_id: rev.id,
        os_number: 'OS-E2E-0001', title: '[E2E] OS interna de comissionamento',
        planned_start: '2026-10-01', planned_finish: '2027-02-28' })]);
    osB = os.r.service_order_id;
    const osRow = await one(
      `SELECT authorized_value, currency, scope_summary FROM public.internal_service_orders WHERE id=$1`, [osB]);
    assert(B, 'OS interna herdou valor e escopo da proposta sem redigitação',
      Number(osRow.authorized_value) === 480000 && osRow.scope_summary?.includes('Comissionamento'));

    const cmp = await one(
      `SELECT public.internal_service_order_compare_with_governing($1,$2) r`, [org, osB]);
    assert(B, 'OS confrontada com a fonte regente sem divergência',
      cmp.r?.divergences_opened === 0, JSON.stringify(cmp.r));

    await one(`SELECT public.internal_service_order_issue($1,$2,$3) r`, [org, actor, osB]);

    projectB = `proj-e2e-${Date.now()}`;
    const bound = await one(
      `SELECT public.internal_service_order_bind_project($1,$2,$3,$4,$5::jsonb) r`,
      [org, actor, osB, projectB, JSON.stringify({
        nome: '[E2E] Comissionamento Cliente E2E', cliente: 'Cliente E2E S.A.',
        status: 'em_andamento', tipo: 'transmissao', data_inicio: '2026-10-01' })]);
    assert(B, 'Projeto criado a partir da OS emitida', bound.r?.created === true);
    assert(B, 'nenhum vínculo contratual inventado', bound.r?.contract_linked === false);

    /*
      Regra de medição na MESMA tabela canônica, sem contrato — e sujeita à
      MESMA exigência de procedência que a plataforma já impunha à regra
      contratual: sem cláusula, documento ou referência, a linha não entra.
      A prova abaixo mostra que a exigência continua valendo para proposta.
    */
    const ruleWithoutSource = await expectFailure(() => db.query(
      `INSERT INTO public.contract_measurement_requirements
         (organization_id, engagement_id, contract_id, title, effect,
          measurement_basis, accumulation_mode, aggregation_mode, cadence, created_by)
       VALUES ($1,$2,NULL,'[E2E] Regra sem procedência','added',
               'PERCENTAGE','CUMULATIVE','PERCENTAGE','MONTHLY',$3)`,
      [org, engagementB, actor]));
    assert(B, 'regra de medição sem procedência documental continua recusada',
      Boolean(ruleWithoutSource), ruleWithoutSource ?? 'não bloqueou');

    const rule = await one(
      `INSERT INTO public.contract_measurement_requirements
         (organization_id, engagement_id, contract_id, title, effect,
          measurement_basis, accumulation_mode, aggregation_mode, cadence,
          evidence_required, customer_acceptance_required,
          source_document_id, source_page, source_reference, created_by)
       VALUES ($1,$2,NULL,'[E2E] Medição mensal por avanço físico','added',
               'PERCENTAGE','CUMULATIVE','PERCENTAGE','MONTHLY',true,true,
               $4,7,'Proposta comercial rev.1, item 7.2',$3)
       RETURNING id`, [org, engagementB, actor, propDoc.id]);

    const m = await one(
      `INSERT INTO public.project_measurements
         (organization_id, project_id, contract_id, engagement_id,
          contract_measurement_rule_id, occurrence_key, measurement_basis,
          accumulation_mode, status, quantity, unit, measured_value, currency,
          measured_at, rule_snapshot, origin, created_by)
       VALUES ($1,$2,NULL,$3,$4,'e2e:2026-11','PERCENTAGE','CUMULATIVE',
               'IN_PREPARATION',35,'%',168000.00,'BRL',now(),
               '{"source":"e2e"}'::jsonb,'manual',$5)
       RETURNING id`, [org, projectB, engagementB, rule.id, actor]);
    measurementB = m.id;
    assert(B, 'medição nasceu na MESMA tabela project_measurements, sem contrato', true,
      `measurement=${measurementB}`);

    await db.query(`UPDATE public.project_measurements SET status='READY_FOR_SUBMISSION' WHERE id=$1`, [measurementB]);
    const sub = await one(
      `SELECT public.project_measurement_transition($1,'SUBMITTED','projects.measurement.submitted',
         'E2E','system',NULL,'{}'::jsonb,'{}'::jsonb,NULL,'submitted_at') r`, [measurementB]);
    assert(B, 'MESMA máquina de estados aceitou a medição sem contrato',
      sub.r?.status === 'SUBMITTED', JSON.stringify(sub.r));

    await one(`SELECT public.project_measurement_start_review($1,'E2E') r`, [measurementB]);
    await one(`SELECT public.project_measurement_approve_for_customer($1,'E2E') r`, [measurementB]);
    const sentB = await one(
      `SELECT public.project_measurement_send_to_customer($1,'email',NULL,'cliente@exemplo',
         'E2E-B',(current_date + 15),ARRAY[]::uuid[],'E2E') r`, [measurementB]);
    assert(B, 'MESMA revisão e MESMO envio ao cliente',
      sentB.r?.status === 'AWAITING_CUSTOMER_ACCEPTANCE');

    const accB = await one(
      `SELECT public.project_measurement_accept($1,'signed_bulletin',35,168000.00,'BRL',
         NULL,'BOL-E2E-B',NULL,'E2E') r`, [measurementB]);
    assert(B, 'MESMO aceite do cliente', accB.r?.status === 'ACCEPTED');

    const evB = await one(
      `SELECT id FROM public.domain_events WHERE organization_id=$1 AND aggregate_id=$2
        AND event_type='projects.measurement.accepted' ORDER BY recorded_at DESC LIMIT 1`,
      [org, measurementB]);
    const billB = await one(`SELECT public.contract_billing_apply_measurement_accepted($1) r`, [evB.id]);
    assert(B, 'MESMA elegibilidade de faturamento, agora pelo engajamento',
      billB.r?.created === true, JSON.stringify(billB.r));
    const bevB = await one(
      `SELECT contract_id, engagement_id, amount, release_state FROM public.contract_billing_events WHERE id=$1`,
      [billB.r.billing_event_id]);
    assert(B, 'faturamento sem contrato, ancorado no engajamento',
      bevB.contract_id === null && bevB.engagement_id === engagementB);
    assert(B, 'faturamento nasce sem liberação', bevB.release_state !== 'RELEASED');

    const queueB = await one(
      `SELECT measurement_id, authorization_source_kind, service_order_number, contract_title
         FROM public.project_measurement_review_queue WHERE measurement_id=$1`, [measurementB]);
    assert(B, 'medição sem contrato aparece na MESMA fila contextual',
      queueB?.measurement_id === measurementB
      && queueB.authorization_source_kind === 'accepted_proposal'
      && queueB.service_order_number === 'OS-E2E-0001',
      JSON.stringify(queueB));

    const noTable = await one(`
      SELECT count(*)::int n FROM information_schema.tables
       WHERE table_schema='public'
         AND table_name IN ('proposal_measurements','proposal_approvals','proposal_billing')`);
    assert(B, 'nenhuma tabela paralela de medição/aprovação/faturamento foi criada', noTable.n === 0);
  }

  // =======================================================================
  // C — OS interna CARREGADA é extraída, ligada e confrontada
  // =======================================================================
  const C = 'C · OS interna carregada e confrontada';
  {
    const doc = await one(
      `INSERT INTO public.contract_documents
         (organization_id, engagement_id, contract_id, title, file_path, document_type,
          status, content_sha256, uploaded_by)
       VALUES ($1,$2,NULL,'[E2E] OS interna digitalizada','e2e/os-0002.pdf',
               'internal_service_order','uploaded', repeat('a',64), $3)
       RETURNING id`, [org, engagementB, actor]);
    assert(C, 'documento da OS guardado no acervo canônico, sem contrato', Boolean(doc.id));

    const intake = await one(
      `INSERT INTO public.contract_onboarding_intakes
         (organization_id, uploaded_by, file_name, file_path, file_size, mime_type,
          content_sha256, status, document_context, engagement_id, document_id,
          ai_provider, ai_model, ai_pipeline_version, trust_policy_version,
          extraction, structured_result)
       VALUES ($1,$2,'os-0002.pdf','e2e/os-0002.pdf',20480,'application/pdf',
               repeat('a',64),'READY','INTERNAL_SERVICE_ORDER',$3,$4,
               'anthropic','claude-sonnet-5','commercial-intake.v1','trust.v1',
               '{"raw":"e2e"}'::jsonb,'{"value":505000}'::jsonb)
       RETURNING id`, [org, actor, engagementB, doc.id]);
    assert(C, 'a MESMA fila de ingestão atendeu o contexto INTERNAL_SERVICE_ORDER', Boolean(intake.id));

    const anchored = await one(
      `INSERT INTO public.commercial_extracted_facts
         (organization_id, engagement_id, intake_id, document_id, document_context,
          fact_domain, label, value_numeric, currency, source_page, source_quote,
          confidence, extraction_method, ai_provider, ai_model, ai_pipeline_version,
          provenance_state)
       VALUES ($1,$2,$3,$4,'INTERNAL_SERVICE_ORDER','VALUE','Valor total da OS',
               505000,'BRL',2,'Valor total: R$ 505.000,00',0.94,'ai',
               'anthropic','claude-sonnet-5','commercial-intake.v1','ANCHORED')
       RETURNING id`, [org, engagementB, intake.id, doc.id]);
    const promotableRaw = await one(
      `SELECT public.commercial_fact_promotable($1) p`, [anchored.id]);
    assert(C, 'fato de IA ancorado mas NÃO confirmado ainda não vira regra',
      promotableRaw.p === false);

    const fabricated = await expectFailure(() => db.query(
      `INSERT INTO public.commercial_extracted_facts
         (organization_id, engagement_id, document_context, fact_domain, label,
          extraction_method, ai_provider, ai_model, ai_pipeline_version, provenance_state)
       VALUES ($1,$2,'INTERNAL_SERVICE_ORDER','MEASUREMENT_RULE','Regra deduzida sem fonte',
               'ai','anthropic','claude-sonnet-5','commercial-intake.v1','ANCHORED')`,
      [org, engagementB]));
    assert(C, 'fato sem página e sem trecho NÃO pode se declarar ancorado',
      fabricated && /cef_anchor_is_earned/.test(fabricated), fabricated ?? 'não bloqueou');

    await db.query(
      `UPDATE public.commercial_extracted_facts
          SET confirmation_state='CONFIRMED', confirmed_by=$2, confirmed_at=now()
        WHERE id=$1`, [anchored.id, actor]);
    const promotable = await one(`SELECT public.commercial_fact_promotable($1) p`, [anchored.id]);
    assert(C, 'fato ancorado E confirmado por humano torna-se promovível', promotable.p === true);

    const os2 = await one(
      `SELECT public.internal_service_order_create($1,$2,$3,$4::jsonb) r`,
      [org, actor, engagementB, JSON.stringify({
        origin: 'uploaded_document', document_id: doc.id, intake_id: intake.id,
        os_number: 'OS-E2E-0002', title: '[E2E] OS interna carregada',
        authorized_value: 505000, currency: 'BRL', planned_finish: '2027-06-30' })]);
    const cmp2 = await one(
      `SELECT public.internal_service_order_compare_with_governing($1,$2) r`,
      [org, os2.r.service_order_id]);
    assert(C, 'divergência de valor detectada contra a proposta regente',
      cmp2.r?.divergences_opened >= 1, JSON.stringify(cmp2.r));

    const st = await one(`SELECT status FROM public.internal_service_orders WHERE id=$1`,
      [os2.r.service_order_id]);
    assert(C, 'OS divergente fica em PENDING_CONFIRMATION, sem escolha silenciosa',
      st.status === 'PENDING_CONFIRMATION');

    const issueBlocked = await expectFailure(() => db.query(
      `SELECT public.internal_service_order_issue($1,$2,$3)`,
      [org, actor, os2.r.service_order_id]));
    assert(C, 'emissão bloqueada enquanto a divergência BLOCKING está aberta',
      issueBlocked && /blocking divergence/i.test(issueBlocked), issueBlocked ?? 'não bloqueou');

    const dv = await one(
      `SELECT id, left_value, right_value, severity FROM public.commercial_divergences
        WHERE service_order_id=$1 AND scope='VALUE'`, [os2.r.service_order_id]);
    assert(C, 'divergência preserva os dois lados com valores literais',
      Number(dv.left_value) === 480000 && Number(dv.right_value) === 505000);

    await one(`SELECT public.commercial_divergence_resolve($1,$2,$3,'accepted_proposal',
      'Proposta regente prevalece; OS será reemitida.') r`, [org, actor, dv.id]);
    const after = await one(
      `SELECT state, resolved_source_kind, resolved_by FROM public.commercial_divergences WHERE id=$1`,
      [dv.id]);
    assert(C, 'resolução nomeia a fonte vencedora e o responsável',
      after.state === 'RESOLVED' && after.resolved_source_kind === 'accepted_proposal'
      && after.resolved_by === actor);

    const hist = await one(
      `SELECT count(*)::int n FROM public.commercial_engagement_history
        WHERE engagement_id=$1 AND transition='divergence_resolved'`, [engagementB]);
    assert(C, 'decisão registrada em história append-only', hist.n === 1);

    /*
      A história obedece à MESMA regra das outras 24 tabelas de história da
      plataforma (210): reescrever é proibido a qualquer papel, e apagar é
      proibido à APLICAÇÃO — o apagamento governado de inquilino continua
      alcançando tudo, que é o que a Fase 7.5 exige.
    */
    const mutated = await expectFailure(() => db.query(
      `UPDATE public.commercial_engagement_history SET note='x' WHERE engagement_id=$1`,
      [engagementB]));
    assert(C, 'história do engajamento nunca é reescrita, nem pelo servidor',
      mutated && /não se reescreve/i.test(mutated), mutated ?? 'não bloqueou');

    const erasedByApp = await expectFailure(async () => {
      await db.query('SET LOCAL ROLE authenticated');
      await db.query(
        `DELETE FROM public.commercial_engagement_history WHERE engagement_id=$1`, [engagementB]);
    });
    await db.query('RESET ROLE');
    assert(C, 'a aplicação não apaga história',
      erasedByApp && /erased|denied|negad/i.test(erasedByApp), erasedByApp ?? 'não bloqueou');
  }

  // =======================================================================
  // D — contrato formal chega DEPOIS de proposta + OS + projeto
  // =======================================================================
  const D = 'D · contrato formal chega depois';
  {
    const beforeEngagements = await one(
      `SELECT count(*)::int n FROM public.commercial_engagements WHERE organization_id=$1`, [org]);

    /*
      O contrato é inserido apontando para o MESMO trabalho autorizado. Desde
      a 205/208 isso já registra a autorização e roda o confronto no gatilho —
      não é preciso um segundo ato para que a divergência exista.
    */
    const lateContract = await one(
      `INSERT INTO public.contracts
         (organization_id, title, contract_number, counterparty_name, status, currency,
          total_value, risk_level, engagement_id, created_by, data_class)
       VALUES ($1,'[E2E] Contrato formal tardio','E2E-CT-0001','Cliente E2E S.A.',
               'signed','BRL',505000,'medium',$2,$3,'live')
       RETURNING id`, [org, engagementB, actor]);

    const autoAttached = await one(
      `SELECT id, governing FROM public.commercial_engagement_authorizations
        WHERE organization_id=$1 AND contract_id=$2`, [org, lateContract.id]);
    assert(D, 'contrato entrou no MESMO engajamento pelo gatilho',
      Boolean(autoAttached?.id), `authorization=${autoAttached?.id}`);
    assert(D, 'contrato NÃO virou regente sozinho', autoAttached.governing === false);

    const autoDivergence = await one(
      `SELECT count(*)::int n FROM public.commercial_divergences
        WHERE organization_id=$1 AND right_source_id=$2 AND scope='VALUE' AND state='OPEN'`,
      [org, autoAttached.id]);
    assert(D, 'divergência com a proposta aceita foi aberta pelo próprio gatilho',
      autoDivergence.n === 1, JSON.stringify(autoDivergence));

    // E a porta manual, chamada em seguida, é idempotente em vez de falhar.
    const attach = await one(
      `SELECT public.commercial_engagement_attach_authorization($1,$2,$3,$4::jsonb) r`,
      [org, actor, engagementB, JSON.stringify({
        source_kind: 'formal_contract', contract_id: lateContract.id,
        authorized_value: 505000, currency: 'BRL' })]);
    assert(D, 'anexar o mesmo contrato de novo é idempotente, não erro',
      attach.r?.reused === true && attach.r?.authorization_id === autoAttached.id,
      JSON.stringify(attach.r));
    assert(D, 'a repetição não duplica a divergência', attach.r?.divergences_opened === 0);

    const afterEngagements = await one(
      `SELECT count(*)::int n FROM public.commercial_engagements WHERE organization_id=$1`, [org]);
    assert(D, 'nenhuma segunda relação de negócio foi criada',
      afterEngagements.n === beforeEngagements.n,
      `antes=${beforeEngagements.n} depois=${afterEngagements.n}`);

    const stillGoverning = await one(
      `SELECT source_kind FROM public.commercial_engagement_authorizations
        WHERE engagement_id=$1 AND governing AND state='ACTIVE'`, [engagementB]);
    assert(D, 'a proposta aceita continua regendo até decisão humana',
      stillGoverning.source_kind === 'accepted_proposal');

    const osStill = await one(
      `SELECT authorized_value FROM public.internal_service_orders WHERE id=$1`, [osB]);
    assert(D, 'OS interna existente não foi sobrescrita', Number(osStill.authorized_value) === 480000);

    const mStill = await one(
      `SELECT status, accepted_value, contract_id FROM public.project_measurements WHERE id=$1`,
      [measurementB]);
    assert(D, 'medição aceita não foi reescrita pelo contrato tardio',
      mStill.status === 'ACCEPTED' && Number(mStill.accepted_value) === 168000
      && mStill.contract_id === null);

    const noNote = await expectFailure(() => db.query(
      `SELECT public.commercial_engagement_set_governing($1,$2,$3,NULL)`,
      [org, actor, attach.r.authorization_id]));
    assert(D, 'trocar a fonte regente exige motivo escrito',
      noNote && /written reason/i.test(noNote), noNote ?? 'não bloqueou');

    const promoted = await one(
      `SELECT public.commercial_engagement_set_governing($1,$2,$3,
         'Contrato assinado substitui a proposta como fonte regente.') r`,
      [org, actor, attach.r.authorization_id]);
    assert(D, 'promoção do contrato é explícita, nomeada e registrada',
      promoted.r?.authorization_id === attach.r.authorization_id);
    const histD = await one(
      `SELECT count(*)::int n FROM public.commercial_engagement_history
        WHERE engagement_id=$1 AND transition='governing_source_changed'`, [engagementB]);
    assert(D, 'troca de fonte regente ficou na história', histD.n === 1);

    const chain = await one(
      `SELECT governing_source_kind, governing_contract_id, commercial_proposal_number,
              service_order_number, open_divergence_count
         FROM public.project_commercial_source_chain WHERE project_id=$1`, [projectB]);
    assert(D, 'o projeto mostra a cadeia comercial real',
      chain.governing_source_kind === 'formal_contract'
      && chain.governing_contract_id === lateContract.id
      && chain.service_order_number === 'OS-E2E-0001',
      JSON.stringify(chain));
  }

  // =======================================================================
  // Auditoria transversal
  // =======================================================================
  const X = 'X · integridade transversal';
  {
    const leak = await one(`
      SELECT count(*)::int n FROM public.commercial_engagements e
        JOIN public.commercial_engagement_authorizations a ON a.engagement_id = e.id
       WHERE a.organization_id <> e.organization_id`);
    assert(X, 'nenhuma autorização cruza inquilino', leak.n === 0);

    const orphan = await one(`
      SELECT count(*)::int n FROM public.project_measurements WHERE engagement_id IS NULL`);
    assert(X, 'nenhuma medição sem pai', orphan.n === 0);

    const grants = await db.query(`
      SELECT p.proname,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') browser,
             has_function_privilege('service_role', p.oid, 'EXECUTE') server
        FROM pg_proc p
       WHERE p.proname IN ('commercial_engagement_create','commercial_engagement_authorize',
             'commercial_engagement_set_governing','commercial_engagement_attach_authorization',
             'commercial_proposal_revision_record_outcome','internal_service_order_create',
             'internal_service_order_issue','internal_service_order_bind_project',
             'commercial_divergence_resolve','internal_service_order_compare_with_governing')`);
    const openToBrowser = grants.rows.filter((r) => r.browser).map((r) => r.proname);
    const closedToServer = grants.rows.filter((r) => !r.server).map((r) => r.proname);
    assert(X, 'nenhuma função governada alcançável pelo navegador',
      openToBrowser.length === 0, openToBrowser.join(', '));
    assert(X, 'todas as funções governadas alcançáveis pelo servidor',
      closedToServer.length === 0 && grants.rowCount === 10, closedToServer.join(', '));

    const rls = await db.query(`
      SELECT c.relname, c.relrowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relname IN (
         'commercial_engagements','commercial_engagement_authorizations','engagement_project_links',
         'commercial_divergences','commercial_contacts','commercial_opportunities',
         'commercial_proposals','commercial_proposal_revisions','commercial_extracted_facts',
         'commercial_execution_blueprints','commercial_execution_blueprint_items',
         'internal_service_orders','commercial_engagement_history')`);
    const without = rls.rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    assert(X, 'RLS ligada em todas as tabelas novas',
      without.length === 0 && rls.rowCount === 13, without.join(', '));

    const writes = await db.query(`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee IN ('authenticated','anon') AND table_schema='public'
         AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
         AND table_name IN (
           'commercial_engagements','commercial_engagement_authorizations','engagement_project_links',
           'commercial_divergences','commercial_contacts','commercial_opportunities',
           'commercial_proposals','commercial_proposal_revisions','commercial_extracted_facts',
           'commercial_execution_blueprints','commercial_execution_blueprint_items',
           'internal_service_orders','commercial_engagement_history')`);
    assert(X, 'navegador não escreve em nenhuma tabela nova', writes.rowCount === 0,
      writes.rows.map((r) => `${r.table_name}:${r.privilege_type}`).join(', '));

    const blueprintGate = await one(`
      SELECT count(*)::int n FROM pg_trigger WHERE tgname='ceb_consumption_gate'`);
    assert(X, 'portão do blueprint instalado (planejamento não vira execução sozinho)',
      blueprintGate.n === 1);
  }
} catch (error) {
  fatal = error;
  console.error('\nERRO:', error.message);
  if (error.detail) console.error('detail:', error.detail);
  if (error.where) console.error('where:', error.where);
} finally {
  try { await db.query('ROLLBACK'); console.log('\nROLLBACK aplicado — banco intocado.'); } catch {}
  await db.end();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} provas passaram.`);
process.exit(fatal || failed ? 1 : 0);
