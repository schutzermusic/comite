/**
 * Remove contratos deixados por `tests/contracts-onboarding.spec.ts`.
 *
 * O E2E limpa o que cria, mas a limpeza depende do banco: se a conexão cair
 * DEPOIS de o assistente salvar o contrato e ANTES de o teste capturar o id, o
 * `afterAll` não tem o que apagar e a linha fica. Foi o que aconteceu em
 * 25/08/2026, quando as portas do Postgres ficaram inacessíveis no meio de uma
 * execução.
 *
 * `audit_logs` NÃO é tocado — a trilha registra o que aconteceu, e apagá-la
 * para arrumar o banco falsificaria o registro que ela existe para preservar.
 *
 * Uso: node scripts/cleanup-e2e-contracts.mjs
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const { rows } = await client.query(
  `select id, contract_number, title, data_class
     from contracts where contract_number like 'E2E-%'`,
);

if (rows.length === 0) {
  console.log('Nenhum contrato de E2E pendente.');
} else {
  console.log(`${rows.length} contrato(s) de E2E encontrados:`);
  for (const r of rows) console.log(`  ${r.contract_number} · ${r.title} · ${r.data_class}`);

  for (const c of rows) {
    // Aditivos antes das cláusulas: `contract_amendment_clauses` as referencia.
    await client.query(
      `delete from contract_amendment_clauses where amendment_id in
         (select id from contract_amendments where contract_id = $1)`, [c.id]);
    await client.query(`delete from contract_amendments where contract_id = $1`, [c.id]);
    await client.query(`delete from contract_penalties where contract_id = $1`, [c.id]);
    /*
      Fase 3 antes das cláusulas e documentos: a definição de obrigação
      referencia a sua ORIGEM com ON DELETE RESTRICT, e é isso que impede apagar
      a cláusula que sustenta uma obrigação viva. A ordem aqui é a mesma regra
      que protege o contrato de verdade, não um detalhe de limpeza.
    */
    /*
      Fase 4 antes de tudo o mais do contrato: o pedido durável de extração
      referencia documento, análise e trabalho, e o vínculo de evento referencia
      a definição de obrigação. Nenhum dos dois é história contratual — são
      execução — e por isso saem junto com o contrato de teste.
    */
    await client.query(`delete from contract_clause_extraction_requests where contract_id = $1`, [c.id]);
    await client.query(`delete from contract_obligation_event_bindings where contract_id = $1`, [c.id]);

    for (const table of [
      'contract_obligation_evidence',
      'contract_obligation_exceptions',
      'contract_obligation_financial_impacts',
      'contract_obligation_evidence_requirements',
      'contract_obligation_dependencies',
      'contract_obligation_instances',
      'contract_obligation_definitions',
    ]) {
      await client.query(`delete from ${table} where contract_id = $1`, [c.id]);
    }
    await client.query(`update contract_clauses set superseded_by_clause_id = null where contract_id = $1`, [c.id]);
    await client.query(`delete from contract_clauses where contract_id = $1`, [c.id]);
    await client.query(`delete from contract_ai_analyses where contract_id = $1`, [c.id]);
    await client.query(
      `update contract_documents set superseded_by_document_id = null,
         supersedes_document_id = null, superseded_at = null where contract_id = $1`, [c.id]);
    for (const [table, column] of [
      ['contract_obligations', 'contract_id'],
      ['contract_billing_events', 'contract_id'],
      ['contract_documents', 'contract_id'],
      ['contract_milestones', 'contract_id'],
      ['contract_approvals', 'contract_id'],
      ['contract_project_links', 'contract_id'],
      ['contract_risks_links', 'contract_id'],
      ['contract_files', 'contract_id'],
      ['tasks', 'related_contract_id'],
    ]) {
      await client.query(`delete from ${table} where ${column} = $1`, [c.id]);
    }
    await client.query(`delete from contracts where id = $1`, [c.id]);
    console.log(`  removido: ${c.contract_number}`);
  }
}

/*
  Trabalho de fila deixado pelo E2E.

  `domain_events` NÃO é varrido: fato registrado é história, e apagá-lo para
  arrumar o banco é a mesma falsificação que apagar `audit_logs`. O que sai é a
  FILA — trabalho que aponta para contrato que não existe mais e que, se ficasse,
  o trabalhador tentaria executar cinco vezes antes de virar carta morta.
*/
const orphan = await client.query(
  `delete from apex_jobs j
    where j.job_type = 'contracts.clause_extraction.execute'
      and not exists (
        select 1 from contract_clause_extraction_requests r
         where r.id = (j.payload->>'request_id')::uuid)
    returning j.id`);
if (orphan.rowCount > 0) console.log(`${orphan.rowCount} trabalho(s) de extração órfão(s) removido(s).`);

await client.end();
