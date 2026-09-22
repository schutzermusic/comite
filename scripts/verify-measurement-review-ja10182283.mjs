/**
 * VALIDAÇÃO DE PONTA A PONTA — JA10182283/2025, no cenário REAL, com ROLLBACK.
 *
 * ─── O que este ensaio faz, e por que num rollback ────────────────────────
 *
 * Percorre o fluxo inteiro sobre a medição REAL do contrato JA10182283/2025:
 *
 *   evidência → pré-análise → envio para análise → correção → reenvio →
 *   aprovação para envio → envio ao cliente → aceite → elegibilidade
 *
 * Cada passo grava de verdade, e ao final TUDO é desfeito. O rollback não é
 * conveniência: os passos criam aprovação interna, aceite de cliente e
 * candidato de faturamento, e deixá-los na base seria exatamente a fabricação
 * de estado real que o plano proíbe.
 *
 * ─── O que ele prova ─────────────────────────────────────────────────────
 *
 *   · o mesmo id atravessa o fluxo — nenhuma medição nova é criada;
 *   · aprovar para envio NÃO aceita;
 *   · aceite exige fonte e proveniência, e o sistema recusa sem elas;
 *   · a pré-análise não valida evidência nem satisfaz exigência;
 *   · documento é single-instance: o mesmo `document_id` nos dois lugares;
 *   · a fila de Contratos vê o MESMO item;
 *   · nenhuma NF, recebível ou pagamento é fabricado.
 *
 * Uso:  node scripts/verify-measurement-review-ja10182283.mjs
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const CONTRACT_NUMBER = 'JA10182283/2025';
const client = new pg.Client({ connectionString: url });
await client.connect();

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

try {
  await client.query('BEGIN');

  // ── 0) O cenário real, sem mock ──────────────────────────────────────
  const contract = await one(
    'SELECT id, organization_id FROM public.contracts WHERE contract_number = $1', [CONTRACT_NUMBER]);
  if (!contract) throw new Error(`Contrato ${CONTRACT_NUMBER} não existe nesta base.`);
  console.log(`\nContrato ${CONTRACT_NUMBER} · organização ${contract.organization_id}`);

  const m0 = await one(`
    SELECT m.* FROM public.project_measurements m
     WHERE m.contract_id = $1
       AND EXISTS (SELECT 1 FROM public.project_measurement_evidence e
                    WHERE e.measurement_id = m.id AND e.revoked_at IS NULL)
     ORDER BY m.expected_at LIMIT 1`, [contract.id]);
  if (!m0) throw new Error('Nenhuma medição real com evidência vinculada neste contrato.');

  const mid = m0.id;
  console.log(`Medição ${mid} · estado inicial ${m0.status}\n`);

  const evidence = await one(
    `SELECT * FROM public.project_measurement_evidence
      WHERE measurement_id = $1 AND revoked_at IS NULL LIMIT 1`, [mid]);

  // ── 1) DOCUMENTO SINGLE-INSTANCE ─────────────────────────────────────
  const doc = await one(
    'SELECT id, project_id, contract_milestone_id, measurement_id FROM public.project_files WHERE id = $1',
    [evidence.source_id]);
  check(Boolean(doc), 'a evidência aponta um documento canônico de project_files');
  check(doc && doc.id === evidence.source_id,
    'o MESMO document_id aparece em Medições & Evidências e em Documentos', doc?.id);

  // ── 2) PRÉ-ANÁLISE: parecer que não decide ───────────────────────────
  const before = await one(`
    SELECT (SELECT status FROM public.project_measurements WHERE id=$1) status,
           (SELECT validation_state FROM public.project_measurement_evidence WHERE id=$2) vstate,
           (SELECT string_agg(requirement_kind||':'||satisfaction_state, ',' ORDER BY requirement_kind)
              FROM public.project_measurement_requirements WHERE measurement_id=$1) reqs`,
    [mid, evidence.id]);

  const analysisId = (await one(
    'SELECT public.project_measurement_preanalysis_open($1,NULL) id', [evidence.id])).id;
  const pre = (await one(
    'SELECT public.project_measurement_preanalysis_complete($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9) j',
    [analysisId, JSON.stringify([
      { requirement_kind: 'EVIDENCE', verdict: 'MET', rationale: 'ensaio', quote: 'trecho', page: 1 },
      { requirement_kind: 'DOCUMENT', verdict: 'NOT_FOUND', rationale: 'ensaio' },
      { requirement_kind: 'TESTS_INSPECTION', verdict: 'NEEDS_HUMAN_REVIEW', rationale: 'ensaio' },
      { requirement_kind: 'CUSTOMER_ACCEPTANCE', verdict: 'NEEDS_HUMAN_REVIEW', rationale: 'ensaio' },
    ]), 'ensaio de validação', 'anthropic', 'claude-sonnet-5', 10, 10, 100, 1])).j;
  check(pre.state === 'COMPLETED', 'a pré-análise conclui e registra o parecer',
    `${pre.met}/${pre.verifiable} verificáveis atendidos`);

  const after = await one(`
    SELECT (SELECT status FROM public.project_measurements WHERE id=$1) status,
           (SELECT validation_state FROM public.project_measurement_evidence WHERE id=$2) vstate,
           (SELECT string_agg(requirement_kind||':'||satisfaction_state, ',' ORDER BY requirement_kind)
              FROM public.project_measurement_requirements WHERE measurement_id=$1) reqs`,
    [mid, evidence.id]);
  check(before.status === after.status, 'a pré-análise NÃO muda o estado da medição');
  check(before.vstate === after.vstate, 'a pré-análise NÃO valida a evidência', after.vstate);
  check(before.reqs === after.reqs, 'a pré-análise NÃO satisfaz exigência contratual');

  const consolidated = (await one('SELECT public.project_measurement_preanalysis($1) j', [mid])).j;
  check(consolidated.not_found === 1 && consolidated.needs_human_review === 2,
    '"não localizado" e "revisão humana" não viram "não atendido"',
    JSON.stringify({ nf: consolidated.not_found, nhr: consolidated.needs_human_review,
      nm: consolidated.not_met }));

  // ── 3) PENDÊNCIAS APARECEM ANTES DO ENVIO ────────────────────────────
  const readiness0 = (await one('SELECT public.project_measurement_readiness($1,NULL) j', [mid])).j;
  check(Array.isArray(readiness0.reasons) && readiness0.reasons.length > 0,
    'as pendências aparecem antes do envio para Contratos',
    readiness0.reasons.join(', '));
  check(readiness0.dimensions.billing_prerequisite !== 'READY',
    'elegibilidade NÃO existe antes de aceite', readiness0.dimensions.billing_prerequisite);

  /*
    ── O ensaio da CADEIA precisa de prontidão de submissão READY ──────────

    Em JA10182283 a medição real está INCOMPLETE (falta o Boletim exigido), e é
    isso que o produto deve dizer. Para exercitar a cadeia, o ensaio satisfaz as
    exigências DENTRO DA TRANSAÇÃO — e a transação é descartada. Nada disso
    sobrevive, e é por isso que este ensaio roda em rollback.
  */
  /*
    As exigências faltantes são satisfeitas pelo CAMINHO GOVERNADO — vinculando
    documentos reais do projeto pela RPC de evidência da 131, um por exigência
    (o índice único da tabela impede o mesmo arquivo servir a duas). Marcar
    `satisfaction_state` à mão não funcionaria nem enganaria ninguém: a
    reconciliação da 132 roda a cada recálculo e reescreve o estado a partir do
    VÍNCULO — que é exatamente o desenho que se quer provar.
  */
  const missing = await client.query(`
    SELECT requirement_kind FROM public.project_measurement_requirements
     WHERE measurement_id = $1 AND required AND satisfaction_state = 'MISSING'
       AND requirement_kind <> 'CUSTOMER_ACCEPTANCE'
     ORDER BY requirement_kind`, [mid]);
  const spare = await client.query(`
    SELECT id FROM public.project_files
     WHERE project_id = $1 AND id <> $2 ORDER BY created_at LIMIT $3`,
    [m0.project_id, evidence.source_id, missing.rows.length]);
  if (spare.rows.length < missing.rows.length) {
    throw new Error(`O ensaio precisa de ${missing.rows.length} documento(s) do projeto para `
      + `satisfazer as exigências pelo caminho governado; há ${spare.rows.length}.`);
  }
  for (let i = 0; i < missing.rows.length; i += 1) {
    await client.query(
      `SELECT public.project_measurement_link_evidence($1,'project_file',$2,'RAW_EVIDENCE','manual',
                                                       NULL,$3,'{}'::jsonb,NULL,NULL)`,
      [mid, spare.rows[i].id, missing.rows[i].requirement_kind]);
  }
  /*
    Exigência de certeza DESCONHECIDA é resolvida como DISPENSA DECLARADA. É a
    decisão humana que o resolvedor exige (`REQUIREMENT_CERTAINTY_UNKNOWN` nunca
    vira READY sozinho), e aqui ela é simulada — dentro do rollback.
  */
  await client.query(`
    UPDATE public.project_measurement_requirements
       SET requirement_certainty = 'declared', required = false,
           satisfaction_state = 'NOT_APPLICABLE'
     WHERE measurement_id = $1 AND requirement_certainty = 'unknown'`, [mid]);
  /*
    A semântica da medição também é DECLARAÇÃO contratual ausente em produção
    (`UNKNOWN`), e o resolvedor recusa submeter sem ela. O ensaio a declara como
    marco de valor fixo — que é o que os seis eventos deste contrato são.
  */
  await client.query(`
    UPDATE public.project_measurements
       SET measurement_basis = 'MILESTONE_FIXED', accumulation_mode = 'MILESTONE_FIXED'
     WHERE id = $1`, [mid]);

  // ── 4) A CADEIA, passo a passo, sempre o MESMO id ─────────────────────
  const walk = async (label, sql, params) => {
    const r = await one(sql, params);
    return { label, r };
  };

  await client.query('UPDATE public.project_measurements SET status = $2 WHERE id = $1',
    [mid, 'IN_PREPARATION']);
  const ready = (await one('SELECT public.project_measurement_mark_ready($1) j', [mid])).j;
  check(ready.status === 'READY_FOR_SUBMISSION', 'prontidão de submissão atingida', ready.status);

  const submitted = (await one('SELECT public.project_measurement_submit($1,$2) j',
    [mid, 'ensaio']))?.j;
  check(submitted.status === 'SUBMITTED' && submitted.measurement_id === mid,
    'PROJETO envia a medição para análise contratual — mesmo id', submitted.status);

  // A fila de Contratos vê o MESMO item.
  const queued = await one(
    'SELECT measurement_id, status FROM public.project_measurement_review_queue WHERE measurement_id = $1',
    [mid]);
  check(Boolean(queued) && queued.measurement_id === mid,
    'Contratos → Aprovações recebe o MESMO item (sem cópia)', queued?.status);

  const inReview = (await one('SELECT public.project_measurement_start_review($1,$2) j',
    [mid, null])).j;
  check(inReview.status === 'UNDER_REVIEW', 'Contratos inicia a análise', inReview.status);

  const returned = (await one(
    'SELECT public.project_measurement_request_correction($1,$2,$3::jsonb) j',
    [mid, 'Falta a assinatura do responsável técnico.',
      JSON.stringify([{ item: 'Assinar a página 3 do boletim', category: 'documental',
        requirement_kind: 'DOCUMENT' }])])).j;
  check(returned.status === 'RETURNED_FOR_CORRECTION',
    'Contratos pode solicitar correção', returned.status);

  const items = await client.query(
    `SELECT item, requested_by_side, round, resolved_at
       FROM public.project_measurement_correction_items WHERE measurement_id = $1`, [mid]);
  check(items.rows.length === 1 && items.rows[0].requested_by_side === 'contract_management',
    'o PROJETO vê a lista exata do que corrigir', items.rows[0]?.item);

  let refusedEmpty = false;
  try {
    await client.query('SAVEPOINT s1');
    await client.query('SELECT public.project_measurement_request_correction($1,$2,$3::jsonb)',
      [mid, 'motivo sem itens', '[]']);
    await client.query('ROLLBACK TO SAVEPOINT s1');
  } catch { refusedEmpty = true; await client.query('ROLLBACK TO SAVEPOINT s1'); }
  check(refusedEmpty, 'pedido de correção SEM itens é recusado');

  const resubmitted = (await one('SELECT public.project_measurement_resubmit($1,$2) j',
    [mid, 'corrigido no ensaio'])).j;
  check(resubmitted.status === 'SUBMITTED' && resubmitted.measurement_id === mid,
    'o PROJETO reenvia o MESMO item — nenhuma medição nova', resubmitted.status);

  const count = await one(
    'SELECT count(*)::int n FROM public.project_measurements WHERE contract_id = $1', [contract.id]);
  check(count.n === 5, 'o reenvio NÃO criou medição nova', `${count.n} medições no contrato`);

  const closed = await one(
    `SELECT count(*)::int n FROM public.project_measurement_correction_items
      WHERE measurement_id = $1 AND resolved_at IS NOT NULL`, [mid]);
  check(closed.n === 1, 'os itens de correção fecham NO REENVIO, com autor');

  const approved = (await one('SELECT public.project_measurement_approve_for_customer($1,$2) j',
    [mid, null])).j;
  check(approved.status === 'APPROVED_FOR_CUSTOMER',
    'Contratos aprova para envio ao cliente', approved.status);

  const afterApproval = (await one('SELECT public.project_measurement_readiness($1,NULL) j', [mid])).j;
  check(afterApproval.dimensions.acceptance !== 'READY',
    'APROVAR PARA ENVIO **não é** aceite', afterApproval.dimensions.acceptance);
  check(afterApproval.dimensions.billing_prerequisite !== 'READY',
    'APROVAR PARA ENVIO não torna elegível', afterApproval.dimensions.billing_prerequisite);

  let refusedAddressee = false;
  try {
    await client.query('SAVEPOINT s2');
    await client.query(
      'SELECT public.project_measurement_send_to_customer($1,$2,NULL,NULL,NULL,NULL,NULL,NULL)',
      [mid, 'email']);
    await client.query('ROLLBACK TO SAVEPOINT s2');
  } catch { refusedAddressee = true; await client.query('ROLLBACK TO SAVEPOINT s2'); }
  check(refusedAddressee, 'envio ao cliente SEM destinatário nem referência é recusado');

  const sent = (await one(
    'SELECT public.project_measurement_send_to_customer($1,$2,NULL,$3,$4,$5,$6::uuid[],NULL) j',
    [mid, 'email', 'contato.enel@exemplo', 'ENSAIO-PROTOCOLO-001', '2026-10-15',
      [doc.id]])).j;
  check(sent.status === 'AWAITING_CUSTOMER_ACCEPTANCE',
    'Contratos envia para aceite da contratante', sent.status);

  const dispatch = await one(
    `SELECT attempt, external_reference, due_at, document_ids
       FROM public.project_measurement_customer_dispatches WHERE measurement_id = $1`, [mid]);
  check(dispatch && dispatch.external_reference === 'ENSAIO-PROTOCOLO-001'
    && Array.isArray(dispatch.document_ids) && dispatch.document_ids[0] === doc.id,
    'a remessa registra referência, prazo e os documentos CANÔNICOS enviados');

  // ── 5) ACEITE: nunca automatizado, sempre comprovado ─────────────────
  let refusedNoSource = false;
  try {
    await client.query('SAVEPOINT s3');
    await client.query('SELECT public.project_measurement_accept($1,NULL)', [mid]);
    await client.query('ROLLBACK TO SAVEPOINT s3');
  } catch { refusedNoSource = true; await client.query('ROLLBACK TO SAVEPOINT s3'); }
  check(refusedNoSource, 'aceite SEM fonte autoritativa é recusado');

  let refusedNoProvenance = false;
  try {
    await client.query('SAVEPOINT s4');
    await client.query(
      'SELECT public.project_measurement_accept($1,$2)', [mid, 'signed_bulletin']);
    await client.query('ROLLBACK TO SAVEPOINT s4');
  } catch { refusedNoProvenance = true; await client.query('ROLLBACK TO SAVEPOINT s4'); }
  check(refusedNoProvenance,
    'aceite EXTERNO sem parte, documento ou referência é recusado (sistema não finge o cliente)');

  const accepted = (await one(
    `SELECT public.project_measurement_accept($1,$2,NULL,NULL,NULL,NULL,$3,NULL,$4) j`,
    [mid, 'signed_bulletin', 'ENSAIO-BM-ASSINADO-001', 'ensaio'])).j;
  check(accepted.status === 'ACCEPTED', 'o aceite externo é registrado com comprovação');

  const provenance = await one(`
    SELECT acceptance_source, accepted_external_ref, accepted_by_user_id
      FROM public.project_measurements WHERE id = $1`, [mid]);
  check(provenance.acceptance_source === 'signed_bulletin'
    && provenance.accepted_external_ref === 'ENSAIO-BM-ASSINADO-001',
    'a proveniência do aceite fica registrada');
  check(provenance.accepted_by_user_id === null,
    'aceite EXTERNO não credita um usuário interno como quem aceitou');

  const hist = await client.query(`
    SELECT to_state, transition, provenance FROM public.project_measurement_history
     WHERE measurement_id = $1 ORDER BY recorded_at`, [mid]);
  check(hist.rows.some((h) => h.transition === 'acceptance_provenance'),
    'o histórico registra QUEM registrou o aceite e sob qual proveniência');
  check(hist.rows.length >= 10, 'o histórico é completo e auditável',
    `${hist.rows.length} linhas`);

  // ── 6) ELEGIBILIDADE — canônica, não presumida ───────────────────────
  const finalReadiness = (await one('SELECT public.project_measurement_readiness($1,NULL) j', [mid])).j;
  check(finalReadiness.dimensions.acceptance === 'READY',
    'aceite registrado acende o farol de aceite');
  console.log(`  · pré-requisito de faturamento após aceite: ${finalReadiness.dimensions.billing_prerequisite}`
    + ` (obrigações travando: ${finalReadiness.blocking_obligations})`);

  // ── 7) FABRICATION AUDIT ─────────────────────────────────────────────
  const fab = await one(`
    SELECT (SELECT count(*)::int FROM public.fiscal_documents) nf,
           (SELECT count(*)::int FROM public.contract_billing_events) ev,
           (SELECT count(*)::int FROM public.finance_receivables) rec`);
  console.log(`\n  Estado financeiro durante o ensaio: NF=${fab.nf} eventos=${fab.ev} recebíveis=${fab.rec}`);
  check(fab.nf === 0, 'nenhuma NF foi fabricada');
  check(fab.rec === 0, 'nenhum recebível foi fabricado');

  // ── 8) RESPONSÁVEIS — sem casamento por aproximação ──────────────────
  const stake = await client.query(
    'SELECT role, user_id, resolution FROM public.project_measurement_stakeholders($1)', [mid]);
  check(stake.rows.length === 6, 'os seis papéis são respondidos');
  check(stake.rows.every((r) => (r.resolution === 'RESOLVED') === (r.user_id !== null)),
    'papel indefinido NÃO recebe um usuário parecido',
    stake.rows.map((r) => `${r.role}=${r.resolution}`).join(' '));

  const sla = (await one('SELECT public.project_measurement_sla($1,NULL) j', [mid])).j;
  check(['NOT_APPLICABLE', 'NOT_ASSESSED'].includes(sla.state),
    'sem política declarada nesta organização, o SLA não inventa prazo', sla.state);

  // ── ROLLBACK ─────────────────────────────────────────────────────────
  await client.query('ROLLBACK');
  console.log('\nROLLBACK executado — nada do ensaio permanece na base.');

  const restored = await one(
    'SELECT status FROM public.project_measurements WHERE id = $1', [mid]);
  check(restored.status === m0.status,
    'a medição real voltou ao estado original', `${m0.status} → ${restored.status}`);
  const noDispatch = await one(
    'SELECT count(*)::int n FROM public.project_measurement_customer_dispatches WHERE measurement_id = $1',
    [mid]);
  const noItems = await one(
    'SELECT count(*)::int n FROM public.project_measurement_correction_items WHERE measurement_id = $1',
    [mid]);
  const noAnalysis = await one(
    'SELECT count(*)::int n FROM public.project_measurement_evidence_analyses WHERE measurement_id = $1',
    [mid]);
  check(noDispatch.n === 0 && noItems.n === 0 && noAnalysis.n === 0,
    'nenhuma remessa, correção ou parecer do ensaio sobrou',
    `remessas=${noDispatch.n} correções=${noItems.n} pareceres=${noAnalysis.n}`);

  console.log(failures === 0 ? '\nRESULTADO: APROVADO' : `\nRESULTADO: ${failures} FALHA(S)`);
  if (failures > 0) process.exitCode = 1;
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
