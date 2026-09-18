/**
 * JA10182283/2025 — ENEL GREEN POWER CACHOEIRA DOURADA S.A.
 * Registra os 6 EVENTOS CONTRATUAIS de medição/faturamento da Parte A, item 4.
 *
 * ─── O que este script afirma, e o que ele recusa afirmar ──────────────────
 *
 * AFIRMA (tem lastro documental verificado por sha256):
 *   · que o contrato define 6 eventos, com percentual e valor fixos  → contract_milestones
 *   · que cada valor é DIREITO CONTRATUAL FIXO, não valor medido      → contract_billing_entitlement_rules
 *   · o que cada evento exige para ser medido e aceito                → contract_measurement_requirements
 *
 * RECUSA afirmar (não há dado de projeto que sustente):
 *   · que qualquer gatilho contratual OCORREU
 *   · que qualquer medição foi aceita
 *   · que qualquer faturamento foi liberado, emitido, recebido ou pago
 *
 * Por isso NENHUMA linha de `contract_billing_events` é criada aqui, e nenhum
 * marco nasce com `completed_at`, `measured_amount` ou `due_date`. O projeto
 * ligado (proj-3a445bb5…) tem ZERO itens de cronograma: sem etapa real, não há
 * mapeamento possível, e o estado honesto de todos os 6 é NÃO APURADO.
 *
 * ─── A ponte com o cronograma, quando ele existir ─────────────────────────
 *
 * A ligação marco→cronograma já existe no domínio e é REUSADA, não recriada:
 *
 *     contract_milestones
 *       ← contract_measurement_requirements.milestone_id        (criado aqui)
 *       ← contract_measurement_rule_timeline_mappings.rule_id   (vazio: sem etapa)
 *       → project_timeline_items                                (inexistentes hoje)
 *
 * Criar a exigência agora é o que torna o mapeamento futuro um ato governado de
 * um passo — e `review_state = 'accepted'` continua exigindo revisor humano.
 *
 * Uso:  node scripts/apply-ja10182283-billing-milestones.mjs [--apply]
 *       Sem --apply, ensaia dentro de transação e desfaz.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const ORG = 'ea674f46-1ea2-421a-9122-eefe9307776a';
const CONTRACT = '0a795a7b-ad6f-4569-b1d5-df9ed204c0c6';
const PROJECT = 'proj-3a445bb5-c576-445d-bb49-adcddd52dc1d';
const DOCUMENT = '3665b62e-9fd8-4dcf-bb87-a9eb24538494';
/** sha256 do PDF assinado, conferido byte a byte contra o storage. */
const DOCUMENT_SHA = '4698fd9186438940c2b007893007567a0e9cdfca2dc2888667dfcfd1813f09c1';
/** Parte A, item 4 — "VALOR DE CADA UMA DAS PARCELAS E CRONOGRAMA DE PAGAMENTO". */
const SOURCE_PAGE = 1;
const SOURCE_REF = 'Parte A, item 4 — Cronograma de pagamento (tabela "Evento / Descrição do evento / Percentual / Valor do evento")';

/*
  Os seis eventos, transcritos do original assinado. `percent` e `amount` são o
  que a tabela imprime; nada aqui é calculado a partir do total, justamente para
  que a divergência de 1 centavo descrita abaixo continue visível.
*/
const EVENTS = [
  { n: 1, percent: 10, amount: '803233.98',  title: 'Na assinatura do contrato e liberação para início' },
  { n: 2, percent: 20, amount: '1606467.95', title: 'No transporte do equipamento para nossa fábrica (CIF)' },
  { n: 3, percent: 25, amount: '2008084.94', title: 'Sacar bobinas | Pedido de materiais' },
  { n: 4, percent: 25, amount: '2008084.94', title: 'Apresentação dos materiais em fábrica e projetos/ desenhos' },
  { n: 5, percent: 10, amount: '803233.98',  title: 'Montagem e fechamento do enrolamento estatórico' },
  { n: 6, percent: 10, amount: '803233.98',  title: 'Na entrega do relatório final' },
];

/*
  A soma aritmética dos seis eventos é 8.032.339,77. O item 3 da Parte A e a
  linha "Valor total" da própria tabela dizem 8.032.339,76. A diferença de um
  centavo está NO ORIGINAL ASSINADO — é arredondamento do rateio percentual, não
  erro de transcrição. O script registra os valores como impressos e deixa a
  divergência exposta; conciliá-la é decisão comercial, não de carga de dados.
*/
const SUM_OF_EVENTS = '8032339.77';
const CONTRACT_STATED_TOTAL = '8032339.76';

const label = (e) => `Evento ${String(e.n).padStart(2, '0')} · ${e.title}`;

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();
  await db.query('SET SESSION default_transaction_read_only = off');

  // ── Pré-condições. Cada uma existe porque a sua falha tornaria a carga mentira.
  const pre = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contracts
      WHERE id=$1 AND organization_id=$2 AND contract_number='JA10182283/2025') contract_ok,
    (SELECT total_value::text FROM public.contracts WHERE id=$1) total_value,
    (SELECT count(*)::int FROM public.contract_documents
      WHERE id=$3 AND contract_id=$1 AND content_sha256=$4) document_ok,
    (SELECT count(*)::int FROM public.contract_project_links
      WHERE contract_id=$1 AND project_id=$5) project_link_ok,
    (SELECT count(*)::int FROM public.contract_milestones WHERE contract_id=$1) milestones,
    (SELECT count(*)::int FROM public.contract_billing_entitlement_rules WHERE contract_id=$1) rules,
    (SELECT count(*)::int FROM public.contract_measurement_requirements WHERE contract_id=$1) requirements,
    (SELECT count(*)::int FROM public.contract_billing_events WHERE contract_id=$1) billing_events,
    (SELECT count(*)::int FROM public.project_timeline_items
      WHERE project_id=$5 AND is_active AND deleted_at IS NULL) timeline_items`,
    [CONTRACT, ORG, DOCUMENT, DOCUMENT_SHA, PROJECT])).rows[0];

  if (pre.contract_ok !== 1) throw new Error('Contrato JA10182283/2025 não encontrado na organização esperada.');
  if (pre.document_ok !== 1) throw new Error('Documento assinado ausente ou com sha256 divergente — procedência não verificável.');
  if (pre.project_link_ok !== 1) throw new Error('Vínculo contrato↔projeto ausente.');
  if (pre.total_value !== CONTRACT_STATED_TOTAL) throw new Error(`Valor total do contrato é ${pre.total_value}, esperado ${CONTRACT_STATED_TOTAL}.`);
  // Idempotência: este script CRIA. Recarregar por cima duplicaria direito de faturar.
  if (pre.milestones !== 0) throw new Error(`Contrato já possui ${pre.milestones} marco(s). Recarga não é segura — revise antes.`);
  if (pre.rules !== 0) throw new Error(`Contrato já possui ${pre.rules} regra(s) de direito.`);
  if (pre.requirements !== 0) throw new Error(`Contrato já possui ${pre.requirements} exigência(s) de medição.`);

  console.log('Pré-condições conferidas:', JSON.stringify(pre, null, 1));

  await db.query('BEGIN');

  const created = [];
  for (const e of EVENTS) {
    /*
      O MARCO. Nasce `pending`, sem data e sem valor medido — as três colunas
      que só o projeto pode preencher. `project_id` é fato (há vínculo), não
      inferência; `due_date` NULL porque o contrato não data os eventos e o
      cronograma ainda não existe.
    */
    const milestone = (await db.query(
      `INSERT INTO public.contract_milestones
         (organization_id, contract_id, project_id, title, description,
          milestone_type, due_date, completed_at, billing_amount, measured_amount, status)
       VALUES ($1,$2,$3,$4,$5,'evento_contratual',NULL,NULL,$6,NULL,'pending')
       RETURNING id`,
      [ORG, CONTRACT, PROJECT, label(e),
       `Gatilho contratual: ${e.title}. Percentual ${e.percent}% do Preço. `
       + `Origem: ${SOURCE_REF}, página ${SOURCE_PAGE} do contrato assinado. `
       + `Estado do gatilho: NÃO APURADO — o projeto ligado não possui itens de `
       + `cronograma, logo não há etapa real a que mapear nem evidência de ocorrência.`,
       e.amount])).rows[0];

    /*
      O DIREITO. Esta linha diz "este valor é devido pelo evento, independentemente
      de medição de quantidade" — que é exatamente o que um preço fixo por evento
      é. Ela NÃO diz que o evento ocorreu.

      `effective_until` fica NULO de propósito: o direito nascido na vigência não
      caduca com ela, e datar o fim aqui desligaria a regra em 02.11.2026.
    */
    const rule = (await db.query(
      `INSERT INTO public.contract_billing_entitlement_rules
         (organization_id, contract_id, milestone_id, basis, fixed_amount, currency,
          source_document_id, source_page, source_reference, effective_from, active, note)
       VALUES ($1,$2,$3,'FIXED_CONTRACT_ENTITLEMENT',$4,'BRL',$5,$6,$7,'2025-11-03',true,$8)
       RETURNING id`,
      [ORG, CONTRACT, milestone.id, e.amount, DOCUMENT, SOURCE_PAGE,
       `${SOURCE_REF} — Evento ${String(e.n).padStart(2, '0')}`,
       `Preço fixo e irreajustável (Parte A, item 5). ${e.percent}% do Preço de `
       + `R$ ${CONTRACT_STATED_TOTAL}. Direito registrado; ocorrência do gatilho NÃO apurada.`])).rows[0];

    /*
      A EXIGÊNCIA DE MEDIÇÃO. É o extremo contratual da ponte com o cronograma:
      `contract_measurement_rule_timeline_mappings.rule_id` aponta para cá.

      `customer_acceptance_required` é fato de cláusula 2.4.1(a): o pagamento
      está condicionado à aprovação e liberação da conformidade do Boletim de
      Medição. Não é política inventada aqui.
    */
    const requirement = (await db.query(
      `INSERT INTO public.contract_measurement_requirements
         (organization_id, contract_id, title, milestone_id,
          source_document_id, source_page, source_reference, effective_from, effect,
          evidence_required, customer_acceptance_required, required_document_type,
          annex_reference, applicability, report_required, technical_report_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'2025-11-03','added',true,true,'boletim_medicao',
               'Anexo 2 — Boletim de Medição',$8,$9,$10)
       RETURNING id`,
      [ORG, CONTRACT, `Medição do ${label(e)}`, milestone.id, DOCUMENT, SOURCE_PAGE,
       `${SOURCE_REF} — Evento ${String(e.n).padStart(2, '0')}. `
       + `Aceite: Parte B, cláusula 2.4.1(a) — pagamento condicionado à aprovação e `
       + `liberação da conformidade do Boletim de Medição; 5 dias úteis para análise (2.4.1(b)).`,
       `Evento ${String(e.n).padStart(2, '0')} do cronograma de pagamento da Parte A, item 4.`,
       // Só o evento 06 tem relatório como o próprio objeto medido.
       e.n === 6, e.n === 6])).rows[0];

    created.push({ evento: e.n, percentual: e.percent, valor: e.amount,
                   milestone_id: milestone.id, rule_id: rule.id, requirement_id: requirement.id });
  }

  /*
    PROVA. Cada linha abaixo é uma afirmação que o script prometeu — inclusive as
    negativas, que são as que importam: nada foi faturado, liberado ou pago.
  */
  const proof = (await db.query(`SELECT
    (SELECT count(*)::int FROM public.contract_milestones WHERE contract_id=$1) milestones,
    (SELECT count(*)::int FROM public.contract_billing_entitlement_rules WHERE contract_id=$1 AND active) rules,
    (SELECT count(*)::int FROM public.contract_measurement_requirements WHERE contract_id=$1) requirements,
    (SELECT sum(billing_amount)::text FROM public.contract_milestones WHERE contract_id=$1) sum_milestones,
    (SELECT sum(fixed_amount)::text FROM public.contract_billing_entitlement_rules WHERE contract_id=$1 AND active) sum_rules,
    (SELECT count(*)::int FROM public.contract_milestones
      WHERE contract_id=$1 AND status='pending' AND completed_at IS NULL
        AND measured_amount IS NULL AND due_date IS NULL) untouched_by_execution,
    (SELECT count(*)::int FROM public.contract_billing_events WHERE contract_id=$1) billing_events,
    (SELECT count(*)::int FROM public.contract_measurement_rule_timeline_mappings WHERE contract_id=$1) timeline_mappings,
    (SELECT count(*)::int FROM public.contract_measurement_requirements r
      WHERE r.contract_id=$1 AND r.milestone_id IS NOT NULL) requirements_linked_to_milestone`,
    [CONTRACT])).rows[0];

  const failures = [];
  if (proof.milestones !== 6) failures.push(`marcos: ${proof.milestones} ≠ 6`);
  if (proof.rules !== 6) failures.push(`regras de direito: ${proof.rules} ≠ 6`);
  if (proof.requirements !== 6) failures.push(`exigências: ${proof.requirements} ≠ 6`);
  if (proof.requirements_linked_to_milestone !== 6) failures.push('exigência sem marco — ponte incompleta');
  if (proof.sum_milestones !== SUM_OF_EVENTS) failures.push(`soma dos marcos: ${proof.sum_milestones} ≠ ${SUM_OF_EVENTS}`);
  if (proof.sum_rules !== SUM_OF_EVENTS) failures.push(`soma das regras: ${proof.sum_rules} ≠ ${SUM_OF_EVENTS}`);
  if (proof.untouched_by_execution !== 6) failures.push('algum marco nasceu com estado de execução');
  if (proof.billing_events !== 0) failures.push(`eventos de faturamento criados: ${proof.billing_events} ≠ 0`);
  if (proof.timeline_mappings !== 0) failures.push(`mapeamentos de cronograma criados: ${proof.timeline_mappings} ≠ 0`);
  if (failures.length) throw new Error(`Prova falhou:\n  - ${failures.join('\n  - ')}`);

  console.log('\nCriado:', JSON.stringify(created, null, 1));
  console.log('\nProva:', JSON.stringify(proof, null, 1));
  console.log(`\nSoma dos 6 eventos: R$ ${SUM_OF_EVENTS}`);
  console.log(`Total declarado na Parte A, item 3: R$ ${CONTRACT_STATED_TOTAL}`);
  console.log('Divergência de R$ 0,01 — presente no original assinado, preservada sem conciliação.');
  console.log(`Itens de cronograma no projeto ligado: ${pre.timeline_items} → 6 marcos com gatilho NÃO APURADO.`);

  if (apply) {
    await db.query('COMMIT');
    console.log('\nAPLICADO.');
  } else {
    await db.query('ROLLBACK');
    console.log('\nENSAIO — desfeito. Use --apply para gravar.');
  }
} catch (error) {
  try { await db.query('ROLLBACK'); } catch { /* conexão já caída */ }
  console.error('\nFALHOU:', error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
