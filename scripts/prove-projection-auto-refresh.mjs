/**
 * PROVA DE ATUALIZAÇÃO AUTOMÁTICA — sempre em transação, sempre desfeita.
 *
 * A afirmação sob teste é "não existe botão Sincronizar porque não existe
 * cópia". Comentário não prova isso; mutação prova. Cada cenário altera uma
 * fonte de verdade, LÊ a projeção sem executar nenhuma sincronização, e
 * desfaz tudo com ROLLBACK ao final.
 *
 * Este script NUNCA aceita `--apply`. Ele existe para não gravar nada.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

const CONTRACT = 'JA10182283/2025';
const results = [];

const read = async () => (await db.query(`
  SELECT contract_value, entitlement_total, reconciliation_delta, milestone_count, project_id
    FROM public.project_contract_financial_read_model WHERE contract_number = $1`, [CONTRACT])).rows[0];

const check = (label, ok, detail) => {
  results.push({ cenário: label, automático: ok ? 'SIM' : 'NÃO', observado: detail });
  if (!ok) throw new Error(`${label}: a projeção NÃO acompanhou — ${detail}`);
};

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');
  await db.query('BEGIN');

  const cid = (await db.query(
    'SELECT id, organization_id FROM public.contracts WHERE contract_number=$1', [CONTRACT])).rows[0];
  const baseline = await read();
  console.log('Linha de base:', JSON.stringify(baseline));

  // ── 1. MUDANÇA DE VALOR DO CONTRATO (o que um aditivo efetivo faz) ────
  await db.query('SAVEPOINT s1');
  await db.query('UPDATE public.contracts SET total_value = total_value + 1000000 WHERE id=$1', [cid.id]);
  let now = await read();
  check('valor do contrato +1.000.000',
    Number(now.contract_value) === Number(baseline.contract_value) + 1000000
      && Number(now.reconciliation_delta) === Number(baseline.reconciliation_delta) - 1000000,
    `valor ${now.contract_value}, divergência ${now.reconciliation_delta}`);
  await db.query('ROLLBACK TO s1');

  // ── 2. MUDANÇA DE DIREITO (entitlement rule) ──────────────────────────
  await db.query('SAVEPOINT s2');
  await db.query(`UPDATE public.contract_billing_entitlement_rules
    SET fixed_amount = fixed_amount + 100 WHERE contract_id=$1 AND active`, [cid.id]);
  now = await read();
  check('cada um dos 6 direitos +100',
    Number(now.entitlement_total) === Number(baseline.entitlement_total) + 600,
    `direito ${now.entitlement_total}`);
  await db.query('ROLLBACK TO s2');

  // ── 3. MARCO NOVO (operacionalização do contrato mudando) ─────────────
  await db.query('SAVEPOINT s3');
  await db.query(`INSERT INTO public.contract_milestones
      (organization_id, contract_id, title, status, milestone_type)
    VALUES ($1,$2,'Evento 07 · prova transitória','pending','evento_contratual')`,
  [cid.organization_id, cid.id]);
  now = await read();
  check('marco novo no contrato',
    now.milestone_count === baseline.milestone_count + 1,
    `marcos ${now.milestone_count}`);
  await db.query('ROLLBACK TO s3');

  // ── 4. RELIGAÇÃO DO PROJETO ───────────────────────────────────────────
  await db.query('SAVEPOINT s4');
  await db.query('DELETE FROM public.contract_project_links WHERE contract_id=$1', [cid.id]);
  await db.query('UPDATE public.contracts SET project_id = NULL WHERE id=$1', [cid.id]);
  const unlinked = await read();
  check('vínculo removido: o contrato some da visão do projeto',
    unlinked === undefined, 'nenhuma linha');
  await db.query('ROLLBACK TO s4');

  // ── 5. MAPEAMENTO GOVERNADO: o gatilho passa a ser APURADO ────────────
  //
  // O cenário mais importante. Enquanto o mapeamento é `system_proposed`, os
  // marcos precisam continuar NOT_ASSESSED; só a ACEITAÇÃO por revisor muda
  // o veredito. As duas metades são medidas em sequência.
  await db.query('SAVEPOINT s5');
  const req = (await db.query(
    `SELECT id FROM public.contract_measurement_requirements
      WHERE contract_id=$1 AND effect <> 'removed' ORDER BY created_at LIMIT 1`, [cid.id])).rows[0];
  const proj = (await db.query(
    'SELECT project_id FROM public.contract_project_links WHERE contract_id=$1', [cid.id])).rows[0];

  const tl = (await db.query(`INSERT INTO public.project_timeline_items
      (organization_id, project_id, title, status, is_active)
    VALUES ($1,$2,'Etapa transitória de prova','in_progress',true) RETURNING id`,
  [cid.organization_id, proj.project_id])).rows[0];

  const assessedOf = async () => (await db.query(`
    SELECT count(*) FILTER (WHERE trigger_assessment = 'NOT_ASSESSED')::int not_assessed,
           count(*) FILTER (WHERE trigger_assessment = 'NOT_OCCURRED')::int not_occurred,
           count(*) FILTER (WHERE trigger_assessment = 'OCCURRED')::int occurred
      FROM public.project_contract_milestone_read_model m
      JOIN public.contracts c ON c.id = m.contract_id
     WHERE c.contract_number = $1`, [CONTRACT])).rows[0];

  await db.query(`INSERT INTO public.contract_measurement_rule_timeline_mappings
      (organization_id, contract_id, rule_id, project_id, timeline_item_id,
       mapping_source, review_state)
    VALUES ($1,$2,$3,$4,$5,'system_proposed','proposed')`,
  [cid.organization_id, cid.id, req.id, proj.project_id, tl.id]);

  let a = await assessedOf();
  check('mapeamento PROPOSTO não apura gatilho nenhum',
    a.not_assessed === 6 && a.not_occurred === 0 && a.occurred === 0, JSON.stringify(a));

  /*
    A aceitação exige revisor NOMEADO — `cmrtm_proposal_needs_review` recusa
    uma proposta que vira aceita sem `reviewed_by` e `reviewed_at`. Ou seja: a
    fronteira entre proposto e aceito não é só filtro de visão, é restrição de
    banco, e o "sim" tem dono registrado.
  */
  const reviewer = (await db.query(
    'SELECT created_by FROM public.contracts WHERE id=$1', [cid.id])).rows[0].created_by;
  await db.query(`UPDATE public.contract_measurement_rule_timeline_mappings
    SET review_state = 'accepted', reviewed_by = $2, reviewed_at = now() WHERE rule_id = $1`,
  [req.id, reviewer]);
  a = await assessedOf();
  check('mapeamento ACEITO apura — e o resultado é NOT_OCCURRED, não OCCURRED',
    a.not_assessed === 5 && a.not_occurred === 1 && a.occurred === 0, JSON.stringify(a));

  await db.query(`UPDATE public.project_timeline_items
    SET status='completed', actual_finish = now() WHERE id=$1`, [tl.id]);
  a = await assessedOf();
  check('fim REAL da etapa → OCCURRED',
    a.not_assessed === 5 && a.occurred === 1, JSON.stringify(a));

  // E o mais importante de todos: execução concluída NÃO cria caixa.
  const cash = (await db.query(`
    SELECT count(*) FILTER (WHERE billing_event_id IS NOT NULL)::int billed,
           count(*) FILTER (WHERE measurement_id IS NOT NULL)::int measured,
           count(*) FILTER (WHERE measurement_accepted_value IS NOT NULL)::int accepted
      FROM public.project_contract_milestone_read_model m
      JOIN public.contracts c ON c.id = m.contract_id
     WHERE c.contract_number = $1`, [CONTRACT])).rows[0];
  check('execução concluída NÃO fabricou medição, aceite nem faturamento',
    cash.billed === 0 && cash.measured === 0 && cash.accepted === 0, JSON.stringify(cash));
  await db.query('ROLLBACK TO s5');

  const restored = await read();
  check('tudo restaurado ao estado original',
    JSON.stringify(restored) === JSON.stringify(baseline), JSON.stringify(restored));

  console.log('\nNenhuma sincronização foi executada em nenhum cenário.');
  console.table(results);
} catch (error) {
  console.error('\nFALHOU:', error.message);
  process.exitCode = 1;
} finally {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  await db.end();
  console.log('\nROLLBACK — o banco não foi alterado por este script.');
}
