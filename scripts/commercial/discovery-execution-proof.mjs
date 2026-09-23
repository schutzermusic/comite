/**
 * PROVAS da 213 — levantamento técnico, fechamento governado e início
 * excepcional — contra o banco real, SEMPRE em transação, SEMPRE em ROLLBACK.
 *
 * Os cenários criam a oportunidade, as propostas e os demais objetos de que
 * precisam dentro da transação. Nada sobrevive ao fim do script: nenhum
 * levantamento, proposta, OS, projeto ou autorização de produção é criado.
 *
 *   node scripts/commercial/discovery-execution-proof.mjs                  # schema aplicado
 *   node scripts/commercial/discovery-execution-proof.mjs --with-migrations 213
 */
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const argv = process.argv.slice(2);
const versions = argv.includes('--with-migrations') ? argv.filter((a) => /^\d+$/.test(a)) : [];
const strip = (sql) => sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gmi, '');

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

let failures = 0;
const assert = (scenario, step, condition, detail) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${scenario} · ${step}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
let sp = 0;
const expectFailure = async (fn) => {
  const name = `sp_${++sp}`;
  await db.query(`SAVEPOINT ${name}`);
  try { await fn(); await db.query(`RELEASE SAVEPOINT ${name}`); return null; }
  catch (error) { await db.query(`ROLLBACK TO SAVEPOINT ${name}`); return error.message; }
};
const rpc = async (fn, args) => {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
  return (await one(`SELECT public.${fn}(${placeholders}) r`, args)).r;
};
const count = async (sql, params) => Number((await one(sql, params)).n);

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');
  for (const v of versions) {
    const [file] = readdirSync('supabase/migrations').filter((f) => f.startsWith(`${v}_`));
    await db.query(strip(readFileSync(`supabase/migrations/${file}`, 'utf8')));
    console.log(`      (migration ${file} aplicada dentro do ensaio)`);
  }

  // ---- âncora: uma organização real com membro ativo -------------------
  const anchor = await one(`
    SELECT p.organization_id org, p.user_id actor
      FROM public.profiles p JOIN auth.users u ON u.id = p.user_id
     WHERE p.status = 'active' ORDER BY p.created_at LIMIT 1`);
  const { org, actor } = anchor;
  const second = (await one(`
    SELECT p.user_id id FROM public.profiles p
     WHERE p.organization_id = $1 AND p.status = 'active' AND p.user_id <> $2 LIMIT 1`, [org, actor]))?.id ?? actor;
  const party = (await one(`
    INSERT INTO public.parties (organization_id, kind, legal_name, active)
    VALUES ($1, 'organization', 'Cliente Ensaio 213', true) RETURNING id`, [org])).id;
  console.log(`\nâncora → org=${org} ator=${actor}\n`);

  const opportunity = async (title, stage = 'DISCOVERY') => rpc('commercial_opportunity_upsert', [org, actor, JSON.stringify({
    title, party_id: party, counterparty_name: 'Cliente Ensaio 213', stage,
    estimated_value: 900000, currency: 'BRL', probability: 0.5, expected_decision_date: '2026-12-15' })]);
  const proposal = async (opp, kind, number, value) => {
    const r = await rpc('commercial_proposal_create', [org, actor, JSON.stringify({
      opportunity_id: opp, proposal_number: number, kind, title: `${kind} ${number}`,
      party_id: party, counterparty_name: 'Cliente Ensaio 213', currency: 'BRL',
      total_value: value, scope_summary: 'Comissionamento de subestação 138 kV' })]);
    return r.revision_id ?? r.proposal_revision_id ?? r.revisionId;
  };
  const sendRevision = async (rev) => {
    for (const to of ['INTERNAL_REVIEW', 'INTERNALLY_APPROVED', 'SENT']) {
      await rpc('commercial_proposal_revision_transition', [org, actor, rev, to]);
    }
  };
  const projectPayload = (name) => JSON.stringify({ nome: name, cliente: 'Cliente Ensaio 213', status: 'em_andamento' });

  // =====================================================================
  // S — levantamento técnico antes da proposta
  // =====================================================================
  const S = 'S · levantamento antes da proposta';
  const oppS = await opportunity('Ensaio 213 · levantamento');
  const survey = await rpc('commercial_site_survey_create', [org, actor, JSON.stringify({
    opportunity_id: oppS, purpose: 'Avaliar condição dos disjuntores', site_name: 'SE Norte',
    technical_responsible_user_id: actor, planned_visit_date: '2026-10-01',
    checklist: [{ key: 'placa', label: 'Dados de placa', done: false, required: true }] })]);
  assert(S, 'nasce AGENDADO quando quem e quando são conhecidos', survey.status === 'SCHEDULED', survey.code);
  assert(S, 'código sequencial por organização', /^LT-\d{4}-\d{3}$/.test(survey.code), survey.code);

  let err = await expectFailure(() => rpc('commercial_site_survey_transition', [org, actor, survey.survey_id, 'COMPLETED', null, '{}']));
  assert(S, 'não conclui sem ter ido a campo', /cannot move from SCHEDULED to COMPLETED/.test(err ?? ''), err);

  await rpc('commercial_site_survey_transition', [org, actor, survey.survey_id, 'IN_FIELD', null, '{}']);
  await rpc('commercial_site_survey_record', [org, actor, survey.survey_id, JSON.stringify({
    findings: { equipment: [{ tag: 'DJ-01', description: 'Disjuntor 138 kV' }], risks: [{ text: 'Área energizada' }] },
    checklist: [{ key: 'placa', label: 'Dados de placa', done: true, required: true }],
    open_questions: [{ id: 'q1', text: 'Janela de desligamento?', resolved: false }] })]);
  await rpc('commercial_site_survey_record', [org, actor, survey.survey_id, JSON.stringify({
    findings: { notes: 'Acesso pela portaria 2' } })]);
  const afterRecord = await one(`SELECT findings, checklist, open_questions FROM public.commercial_site_surveys WHERE id=$1`, [survey.survey_id]);
  assert(S, 'registro de campo mescla por seção, sem apagar a anterior',
    afterRecord.findings.equipment?.length === 1 && afterRecord.findings.notes, JSON.stringify(Object.keys(afterRecord.findings)));

  err = await expectFailure(() => rpc('commercial_site_survey_record_apex_candidate',
    [org, survey.survey_id, '{"likely_scope":[]}', 'anthropic', 'm', 'v1']));
  assert(S, 'Apex não lê levantamento ainda em campo', /only after field work ends/.test(err ?? ''), err);

  const attachment = await rpc('commercial_site_survey_register_attachment', [org, actor, survey.survey_id, JSON.stringify({
    title: 'Foto placa DJ-01', file_path: `${org}/site-surveys/${survey.survey_id}/placa.jpg`,
    document_type: 'site_survey_photo', content_sha256: 'a'.repeat(64) })]);
  const again = await rpc('commercial_site_survey_register_attachment', [org, actor, survey.survey_id, JSON.stringify({
    title: 'Foto placa DJ-01', file_path: `${org}/site-surveys/${survey.survey_id}/placa-2.jpg`,
    document_type: 'site_survey_photo', content_sha256: 'a'.repeat(64) })]);
  assert(S, 'foto vai para o acervo canônico, e o mesmo arquivo não entra duas vezes',
    again.reused === true && again.document_id === attachment.document_id);
  err = await expectFailure(() => rpc('commercial_site_survey_register_attachment', [org, actor, survey.survey_id, JSON.stringify({
    file_path: `${randomUUID()}/x.jpg`, document_type: 'site_survey_photo' })]));
  assert(S, 'caminho fora do inquilino é recusado', /outside the tenant/.test(err ?? ''), err);

  await rpc('commercial_site_survey_transition', [org, actor, survey.survey_id, 'AWAITING_REPORT', null, '{}']);
  await rpc('commercial_site_survey_record_apex_candidate', [org, survey.survey_id,
    JSON.stringify({ likely_scope: [{ text: 'Ensaios em DJ-01', confidence: 0.7, source: 'findings.equipment' }] }),
    'anthropic', 'claude-sonnet-5', 'site-survey-understanding.v1']);
  const afterApex = await one(`SELECT findings, apex_candidate FROM public.commercial_site_surveys WHERE id=$1`, [survey.survey_id]);
  assert(S, 'leitura da Apex fica na coluna dela; a verdade de campo não muda',
    afterApex.apex_candidate && !('likely_scope' in afterApex.findings));
  await rpc('commercial_site_survey_transition', [org, actor, survey.survey_id, 'COMPLETED', null, '{}']);
  err = await expectFailure(() => rpc('commercial_site_survey_record', [org, actor, survey.survey_id, '{"findings":{"notes":"x"}}']));
  assert(S, 'levantamento concluído não aceita mais registro', /record is closed/.test(err ?? ''), err);
  const surveyEvents = await count(`SELECT count(*) n FROM public.commercial_site_survey_events WHERE survey_id=$1`, [survey.survey_id]);
  assert(S, 'cada ato deixou história', surveyEvents >= 8, `${surveyEvents} eventos`);
  err = await expectFailure(() => db.query(`UPDATE public.commercial_site_survey_events SET note='x' WHERE survey_id=$1`, [survey.survey_id]));
  assert(S, 'história do levantamento não se reescreve (nem pelo servidor)', /não se reescreve/.test(err ?? ''), err);
  const surveyCreatedNothing = await count(`
    SELECT (SELECT count(*) FROM public.commercial_engagements e WHERE e.organization_id=$1 AND e.counterparty_party_id=$2)
         + (SELECT count(*) FROM public.internal_service_orders o JOIN public.commercial_engagements e ON e.id=o.engagement_id
             WHERE e.counterparty_party_id=$2) n`, [org, party]);
  assert(S, 'levantamento não criou engajamento, OS nem projeto', surveyCreatedNothing === 0);

  // =====================================================================
  // N — venda normal: PT+PC aceitas → fechar → engajamento → OS → projeto
  // =====================================================================
  const N = 'N · venda normal sem contrato';
  const oppN = await opportunity('Ensaio 213 · normal', 'NEGOTIATION');
  const ptN = await proposal(oppN, 'TECHNICAL', `PT-213-N-${Date.now()}`, 850000);
  const pcN = await proposal(oppN, 'COMMERCIAL', `PC-213-N-${Date.now()}`, 850000);
  await sendRevision(ptN); await sendRevision(pcN);

  err = await expectFailure(() => rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    opportunity_id: oppN, technical_revision_id: ptN, commercial_revision_id: pcN,
    authorization: { type: 'customer_email', date: '2026-09-20' } })]));
  assert(N, 'e-mail do cliente sem evidência é recusado', /requires evidence/.test(err ?? ''), err);
  err = await expectFailure(() => rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    opportunity_id: oppN, commercial_revision_id: pcN, authorization: { type: 'declared', reference: 'verbal' } })]));
  assert(N, 'base declarada não fecha negócio no caminho padrão', /only possible as an exceptional start/.test(err ?? ''), err);

  const projectN = `proj-${randomUUID()}`;
  const closeN = await rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    opportunity_id: oppN, technical_revision_id: ptN, commercial_revision_id: pcN,
    authorization: { type: 'customer_email', date: '2026-09-20', reference: 'E-mail de 20/09 — Eng. Paula' },
    service_order: { mode: 'generate' },
    project: { mode: 'create', project_id: projectN, payload: JSON.parse(projectPayload('Ensaio 213 N')) } })]);
  assert(N, 'engajamento criado e autorizado', closeN.engagement_created === true, closeN.engagement_id);
  assert(N, 'OS interna gerada da proposta e emitida', closeN.service_order_status === 'IN_EXECUTION', closeN.service_order_number);
  assert(N, 'projeto criado a partir da OS', closeN.project_id === projectN);
  assert(N, 'nada ficou bloqueado', closeN.blocked.length === 0, JSON.stringify(closeN.blocked));
  const revN = await one(`SELECT status, acceptance_source, recorded_by FROM public.commercial_proposal_revisions WHERE id=$1`, [pcN]);
  assert(N, 'aceite registrado com a manifestação do cliente e o humano que registrou',
    revN.status === 'ACCEPTED' && revN.acceptance_source === 'customer_email' && revN.recorded_by === actor);
  const govN = await one(`SELECT source_kind, proposal_revision_id, authorized_value FROM public.commercial_engagement_authorizations
                           WHERE engagement_id=$1 AND governing AND state='ACTIVE'`, [closeN.engagement_id]);
  assert(N, 'a proposta COMERCIAL rege, com o valor dela', govN.proposal_revision_id === pcN && Number(govN.authorized_value) === 850000);
  const oppAfterN = await one(`SELECT stage, engagement_id FROM public.commercial_opportunities WHERE id=$1`, [oppN]);
  assert(N, 'oportunidade ganha e ligada ao trabalho', oppAfterN.stage === 'WON' && oppAfterN.engagement_id === closeN.engagement_id);
  const chainN = await one(`SELECT * FROM public.project_commercial_source_chain WHERE project_id=$1`, [projectN]);
  assert(N, 'cadeia de origem do projeto mostra OS, PT e PC, sem contrato',
    chainN && chainN.service_order_id === closeN.service_order_id
    && chainN.technical_proposal_revision_id === ptN && chainN.commercial_proposal_revision_id === pcN
    && chainN.governing_contract_id === null);
  const divN = await count(`SELECT count(*) n FROM public.commercial_divergences WHERE engagement_id=$1`, [closeN.engagement_id]);
  assert(N, 'PT entra sem valor: nenhuma divergência fabricada', divN === 0, `${divN}`);

  // — idempotência: repetir o fechamento não duplica nada ——————————————
  const rerun = await rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    opportunity_id: oppN, technical_revision_id: ptN, commercial_revision_id: pcN,
    authorization: { type: 'customer_email', date: '2026-09-20', reference: 'E-mail de 20/09 — Eng. Paula' },
    service_order: { mode: 'generate' },
    project: { mode: 'create', project_id: `proj-${randomUUID()}`, payload: JSON.parse(projectPayload('dup')) } })]);
  const dupCounts = await one(`
    SELECT (SELECT count(*) FROM public.commercial_engagements WHERE organization_id=$1 AND counterparty_party_id=$2 AND title='Ensaio 213 · normal') eng,
           (SELECT count(*) FROM public.internal_service_orders WHERE engagement_id=$3) os,
           (SELECT count(*) FROM public.engagement_project_links WHERE engagement_id=$3) proj,
           (SELECT count(*) FROM public.commercial_engagement_authorizations WHERE engagement_id=$3) auths,
           (SELECT count(*) FROM public.commercial_execution_starts WHERE engagement_id=$3) starts`,
    [org, party, closeN.engagement_id]);
  assert(N, 'repetir o fechamento reusa engajamento, OS, projeto e fontes',
    rerun.engagement_id === closeN.engagement_id && rerun.project_id === projectN
    && Number(dupCounts.eng) === 1 && Number(dupCounts.os) === 1 && Number(dupCounts.proj) === 1
    && Number(dupCounts.auths) === 3 && Number(dupCounts.starts) === 1, JSON.stringify(dupCounts));

  // =====================================================================
  // F — fast-track: proposta já existe, sem oportunidade informada, PO do cliente
  // =====================================================================
  const F = 'F · fast-track com PO do cliente';
  const oppF = await opportunity('Ensaio 213 · fast-track', 'PROPOSAL');
  const pcF = await proposal(oppF, 'COMBINED', `PTC-213-F-${Date.now()}`, 420000);
  await sendRevision(pcF);
  const closeF = await rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    commercial_revision_id: pcF,
    authorization: { type: 'customer_po', date: '2026-09-21', reference: 'PO 4500012345' },
    service_order: { mode: 'generate' },
    project: { mode: 'create', project_id: `proj-${randomUUID()}`, payload: JSON.parse(projectPayload('Ensaio 213 F')) } })]);
  const oppAfterF = await one(`SELECT stage, engagement_id FROM public.commercial_opportunities WHERE id=$1`, [oppF]);
  assert(F, 'oportunidade descoberta pela proposta, ganha e ligada', oppAfterF.stage === 'WON' && oppAfterF.engagement_id === closeF.engagement_id);
  const sourcesF = await db.query(`SELECT source_kind, governing, authorized_value FROM public.commercial_engagement_authorizations WHERE engagement_id=$1 ORDER BY created_at`, [closeF.engagement_id]);
  assert(F, 'proposta rege; PO registrado como evidência, sem disputar valor',
    sourcesF.rows[0]?.source_kind === 'accepted_proposal' && sourcesF.rows[0]?.governing
    && sourcesF.rows[1]?.source_kind === 'customer_po' && !sourcesF.rows[1]?.governing && sourcesF.rows[1]?.authorized_value === null,
    JSON.stringify(sourcesF.rows));
  assert(F, 'OS e projeto nasceram pelo mesmo caminho canônico', closeF.service_order_status === 'IN_EXECUTION' && closeF.project_id);

  // =====================================================================
  // U — OS interna CARREGADA que diverge da proposta: para, não contorna
  // =====================================================================
  const U = 'U · OS carregada divergente';
  const oppU = await opportunity('Ensaio 213 · OS carregada', 'NEGOTIATION');
  const pcU = await proposal(oppU, 'COMMERCIAL', `PC-213-U-${Date.now()}`, 500000);
  await sendRevision(pcU);
  const existingProject = `proj-${randomUUID()}`;
  await db.query(`INSERT INTO public.projects (id, organization_id, project, created_by) VALUES ($1,$2,$3,$4)`,
    [existingProject, org, projectPayload('Projeto já existente'), actor]);
  const upload = {
    opportunity_id: oppU, commercial_revision_id: pcU,
    authorization: { type: 'customer_email', date: '2026-09-19', reference: 'E-mail 19/09' },
    service_order: { mode: 'upload', os_number: 'OS-EXT-77', file_path: `${org}/service-orders/os-77.pdf`,
                     content_sha256: 'b'.repeat(64), authorized_value: 480000 },
    project: { mode: 'link', project_id: existingProject } };
  const closeU = await rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify(upload)]);
  assert(U, 'OS carregada confrontada: divergência de valor BLOQUEIA a emissão',
    closeU.service_order_status === 'PENDING_CONFIRMATION' && closeU.blocked.some((b) => b.code === 'BLOCKING_DIVERGENCE'),
    JSON.stringify(closeU.blocked));
  assert(U, 'sem OS emitida, nenhum projeto é vinculado', closeU.project_id === null);
  const doc = await one(`SELECT document_type, engagement_id FROM public.contract_documents WHERE id=(SELECT document_id FROM public.internal_service_orders WHERE id=$1)`, [closeU.service_order_id]);
  assert(U, 'PDF da OS entrou no acervo canônico do engajamento', doc?.document_type === 'internal_service_order' && doc.engagement_id === closeU.engagement_id);
  const div = await one(`SELECT id FROM public.commercial_divergences WHERE engagement_id=$1 AND state='OPEN' AND severity='BLOCKING'`, [closeU.engagement_id]);
  await rpc('commercial_divergence_resolve', [org, actor, div.id, 'accepted_proposal', 'Valor da proposta prevalece; OS será reemitida.']);
  const resumed = await rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify(upload)]);
  assert(U, 'retomar depois da decisão humana emite a OS e vincula o projeto EXISTENTE',
    resumed.service_order_id === closeU.service_order_id && resumed.project_id === existingProject
    && resumed.service_order_status === 'IN_EXECUTION', JSON.stringify(resumed));
  const projectsU = await count(`SELECT count(*) n FROM public.projects WHERE organization_id=$1 AND project->>'nome'='Projeto já existente'`, [org]);
  assert(U, 'nenhum projeto duplicado', projectsU === 1);

  // =====================================================================
  // X — início excepcional: documentação pendente bloqueia faturamento
  // =====================================================================
  const X = 'X · início excepcional';
  const oppX = await opportunity('Ensaio 213 · excepcional', 'NEGOTIATION');
  const pcX = await proposal(oppX, 'COMMERCIAL', `PC-213-X-${Date.now()}`, 300000);
  await sendRevision(pcX);
  err = await expectFailure(() => rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    mode: 'EXCEPTIONAL', commercial_revision_id: pcX,
    authorization: { type: 'declared', reference: 'Autorização verbal' }, exception: { reason: 'Parada emergencial' } })]));
  assert(X, 'exceção sem dono, prazo e autorizador interno é recusada', /requires reason, internal authorizer/.test(err ?? ''), err);

  const closeX = await rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    mode: 'EXCEPTIONAL', commercial_revision_id: pcX,
    authorization: { type: 'declared', date: '2026-09-22', reference: 'Ligação do gerente de manutenção às 07h40',
                     customer_authorizer_name: 'Carlos (gerente de manutenção)' },
    exception: { reason: 'Parada emergencial da SE', internal_authorizer_user_id: actor,
                 regularization_owner_user_id: second, regularization_due_date: '2026-10-06' },
    service_order: { mode: 'generate' },
    project: { mode: 'create', project_id: `proj-${randomUUID()}`, payload: JSON.parse(projectPayload('Ensaio 213 X')) } })]);
  assert(X, 'projeto pode começar', closeX.project_id && closeX.service_order_status === 'IN_EXECUTION');
  assert(X, 'estado registrado: documentação PENDENTE', closeX.documentation_state === 'PENDING');
  const revX = await one(`SELECT status FROM public.commercial_proposal_revisions WHERE id=$1`, [pcX]);
  assert(X, 'nenhum aceite de cliente foi fabricado', revX.status === 'SENT', revX.status);
  const histX = await one(`SELECT to_state FROM public.commercial_engagement_history WHERE engagement_id=$1 AND transition='execution_started_exceptionally'`, [closeX.engagement_id]);
  assert(X, 'história registra AUTHORIZED_WITH_PENDING_DOCUMENTATION', histX?.to_state === 'AUTHORIZED_WITH_PENDING_DOCUMENTATION');

  const billingErr = await expectFailure(async () => {
    const ev = await one(`
      INSERT INTO public.contract_billing_events
        (organization_id, engagement_id, title, amount, status, currency, source_kind,
         release_state, eligibility_state, entitlement_key)
      VALUES ($1,$2,'Ensaio 213',100000,'pendente','BRL','MANUAL','NOT_ELIGIBLE','UNKNOWN',$3) RETURNING id`,
      [org, closeX.engagement_id, `e2e-213:${randomUUID()}`]);
    const resolved = await rpc('contract_billing_eligibility_resolve', [ev.id]);
    const codes = (resolved.reasons ?? []).map((r) => r.code);
    assert(X, 'faturamento BLOQUEADO pela pendência documental',
      codes.includes('COMMERCIAL_DOCUMENTATION_PENDING') && resolved.state !== 'ELIGIBLE', `${resolved.state} ${codes.join(',')}`);
    const start = await one(`SELECT id FROM public.commercial_execution_starts WHERE engagement_id=$1`, [closeX.engagement_id]);
    err = await expectFailure(() => rpc('commercial_execution_start_regularize', [org, actor, start.id, JSON.stringify({ source_kind: 'customer_po' })]));
    assert(X, 'regularizar exige nota escrita', /written note/.test(err ?? ''), err);
    const reg = await rpc('commercial_execution_start_regularize', [org, actor, start.id, JSON.stringify({
      source_kind: 'customer_po', external_reference: 'PO 4500099999', note: 'PO recebido em 24/09' })]);
    assert(X, 'regularização reavalia o faturamento travado', reg.documentation_state === 'REGULARIZED' && reg.billing_events_recomputed >= 1);
    const after = await rpc('contract_billing_eligibility_resolve', [ev.id]);
    assert(X, 'depois de regularizar, a pendência sai dos motivos',
      !(after.reasons ?? []).some((r) => r.code === 'COMMERCIAL_DOCUMENTATION_PENDING'));
    const govX = await one(`SELECT source_kind, external_reference FROM public.commercial_engagement_authorizations WHERE engagement_id=$1 AND governing AND state='ACTIVE'`, [closeX.engagement_id]);
    assert(X, 'a evidência recebida passa a reger, por escrito', govX.source_kind === 'customer_po', govX.external_reference);
  });
  if (billingErr) assert(X, 'ensaio de faturamento executado', false, billingErr);

  // =====================================================================
  // G — governança: bloqueios e ausência de motor paralelo
  // =====================================================================
  const G = 'G · governança';
  const oppG = await opportunity('Ensaio 213 · rascunho', 'PROPOSAL');
  const pcG = await proposal(oppG, 'COMMERCIAL', `PC-213-G-${Date.now()}`, 10000);
  err = await expectFailure(() => rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    commercial_revision_id: pcG, authorization: { type: 'accepted_proposal', acceptance_source: 'customer_email' } })]));
  assert(G, 'rascunho não vira aceite no caminho padrão', /only a revision sent to the customer/.test(err ?? ''), err);
  err = await expectFailure(() => rpc('commercial_close_and_start_execution', [org, actor, JSON.stringify({
    opportunity_id: oppS, commercial_revision_id: pcN, authorization: { type: 'accepted_proposal' } })]));
  assert(G, 'proposta de outra oportunidade não entra no fechamento', /another opportunity/.test(err ?? ''), err);

  const privileges = await db.query(`
    SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') browser
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY($1)`, [[
    'commercial_site_survey_create', 'commercial_site_survey_transition', 'commercial_site_survey_record',
    'commercial_site_survey_register_attachment', 'commercial_site_survey_record_apex_candidate',
    'commercial_close_and_start_execution', 'commercial_execution_start_regularize',
    'contract_billing_eligibility_resolve_core']]);
  const reachable = privileges.rows.filter((r) => r.browser).map((r) => r.proname);
  assert(G, 'nenhuma função governada nova alcançável pelo navegador', privileges.rowCount === 8 && reachable.length === 0, reachable.join(','));
  const tables = await db.query(`
    SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid)::int policies,
           has_table_privilege('authenticated', c.oid, 'INSERT') ins, has_table_privilege('authenticated', c.oid, 'UPDATE') upd,
           has_table_privilege('anon', c.oid, 'SELECT') anon_read
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname = ANY($1)`,
    [['commercial_site_surveys', 'commercial_site_survey_events', 'commercial_execution_starts']]);
  assert(G, 'tabelas novas: RLS ligada, política de leitura, sem escrita do navegador, sem anon',
    tables.rowCount === 3 && tables.rows.every((r) => r.relrowsecurity && r.policies > 0 && !r.ins && !r.upd && !r.anon_read),
    JSON.stringify(tables.rows));
  const parallel = await count(`
    SELECT count(*) n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind='r'
       AND c.relname ~ '(quick_measurement|fasttrack_billing|proposal_billing|survey_project|manual_project|proposal_measurement)'`);
  assert(G, 'nenhuma tabela de medição/faturamento/projeto paralela', parallel === 0);

  // Leitura como NAVEGADOR de outra organização: RLS esconde tudo.
  const foreign = await one(`SELECT p.user_id id, p.organization_id org FROM public.profiles p
                              WHERE p.organization_id <> $1 AND p.status='active' LIMIT 1`, [org]);
  if (foreign) {
    await db.query(`SAVEPOINT rls`);
    await db.query(`SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: foreign.id, role: 'authenticated' })]);
    await db.query(`SET LOCAL ROLE authenticated`);
    const seen = await one(`SELECT (SELECT count(*) FROM public.commercial_site_surveys WHERE organization_id=$1)
                                 + (SELECT count(*) FROM public.commercial_execution_starts WHERE organization_id=$1) n`, [org]);
    const denied = await expectFailure(() => rpc('commercial_close_and_start_execution', [org, foreign.id, '{}']));
    await db.query(`ROLLBACK TO SAVEPOINT rls`);
    assert(G, 'outra organização não enxerga levantamento nem início de execução', Number(seen.n) === 0, String(seen.n));
    assert(G, 'navegador não executa o fechamento', /permission denied/.test(denied ?? ''), denied);
  }
} catch (error) {
  console.error('FALHOU:', error.message);
  failures += 1;
} finally {
  try { await db.query('ROLLBACK'); } catch { /* conexão pode ter caído */ }
  await db.end();
}
console.log(failures === 0 ? '\nTodas as provas passaram. ROLLBACK — nada foi gravado.' : `\n${failures} prova(s) falharam. ROLLBACK.`);
process.exitCode = failures === 0 ? 0 : 1;
