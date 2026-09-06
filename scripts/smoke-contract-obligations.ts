/**
 * Prova de ponta a ponta do motor de obrigações contra o banco REAL.
 *
 *   npx tsx scripts/smoke-contract-obligations.ts
 *
 * Percorre o ciclo inteiro com as mesmas funções que as rotas chamam, numa
 * organização descartável criada e apagada aqui dentro:
 *
 *   contrato → cláusula → definição com proveniência → partes multilaterais →
 *   materialização idempotente → transições com histórico → evidência →
 *   dispensa → resolução `asOf` → bloqueio de faturamento
 *
 * Organização descartável, e não a real, porque obrigação de teste num contrato
 * de produção é exatamente a "obrigação fabricada" que esta fase proíbe. O
 * DELETE final também prova que a exclusão privilegiada alcança a subárvore.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

import {
  createObligationDefinition, loadContractObligationsAsOf, materializeObligation,
  recordObligationEvidence, recordObligationException, transitionObligationInstance,
  obligationServiceClient,
} from '../src/lib/contracts/obligations/server/store';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`   ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const suffix = Math.random().toString(36).slice(2, 10);
let organizationId = '';
const pgc = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pgc.connect();

  const org = await admin.from('organizations')
    .insert({ name: `Obrig Smoke ${suffix}`, slug: `obrig-smoke-${suffix}` }).select('id').single();
  if (org.error) throw new Error(`organização de prova: ${org.error.message}`);
  organizationId = String(org.data.id);
  const actor = { organizationId, userId: null as unknown as string };
  console.log(`\n=== ORGANIZAÇÃO DESCARTÁVEL ${organizationId} ===`);

  const contract = await admin.from('contracts').insert({
    organization_id: organizationId, title: 'Contrato de prova', contract_number: `P-${suffix}`,
    counterparty_name: 'Contraparte de prova', status: 'active',
    start_date: '2026-01-01', end_date: '2026-12-31',
  }).select('id').single();
  if (contract.error) throw new Error(`contrato: ${contract.error.message}`);
  const contractId = String(contract.data.id);

  const document = await admin.from('contract_documents').insert({
    organization_id: organizationId, contract_id: contractId,
    title: 'Contrato assinado.pdf', file_path: `${organizationId}/contrato.pdf`, document_type: 'contract',
  }).select('id').single();
  const documentId = String(document.data!.id);

  const clause = await admin.from('contract_clauses').insert({
    organization_id: organizationId, contract_id: contractId, clause_type: 'obligation',
    title: 'Cláusula 5.1', content: 'Entregar relatório mensal de segurança até o dia 5.',
    source_document_id: documentId, source_page: 12,
  }).select('id').single();
  const clauseId = String(clause.data!.id);

  const party = await admin.from('parties').insert({
    organization_id: organizationId, kind: 'organization', legal_name: 'Seguradora de prova',
    document_type: 'cnpj', document_number: '11222333000181',
  }).select('id').single();
  const partyId = String(party.data!.id);

  // ─────────────────── 1. DEFINIÇÃO COM PROVENIÊNCIA ───────────────────
  console.log('\n=== 1. DEFINIÇÃO ===');
  const definition = await createObligationDefinition(actor, {
    contractId, title: 'Relatório mensal de segurança',
    requirementText: 'Entregar relatório de segurança até o dia 5 do mês seguinte.',
    responsibleSide: 'contracting_organization',
    sourceClauseId: clauseId, sourcePage: 12, sourceExcerpt: 'Cláusula 5.1',
    effectiveFrom: '2026-01-01', activationKind: 'contract_start',
    dueKind: 'days_after_activation', dueOffsetDays: 5, calendarBasis: 'calendar_days',
    recurrenceKind: 'monthly', blocksBilling: true,
    parties: [
      { role: 'obligor', partyText: 'Insight Energia' },
      { role: 'beneficiary', partyText: 'Cliente contratante' },
      { role: 'insurer', partyId },
      // Identidade não provada: o texto fica, o vínculo não é inventado.
      { role: 'verifier', partyText: 'Órgão fiscalizador municipal' },
    ],
  }) as { id: string };
  check('definição registrada com proveniência', Boolean(definition.id));

  const noProvenance = await admin.from('contract_obligation_definitions')
    .insert({ organization_id: organizationId, contract_id: contractId, title: 'Sem origem' });
  check('obrigação SEM origem é recusada', Boolean(noProvenance.error));

  // ─────────────────── 2. RESPONSABILIDADE MULTILATERAL ───────────────────
  console.log('\n=== 2. RESPONSABILIDADE ===');
  let snapshot = await loadContractObligationsAsOf(organizationId, contractId, '2026-03-08');
  const parties = snapshot.obligations[0].definition.parties;
  check('quatro partes contratuais registradas', parties.length === 4, parties.map((p) => p.role).join(', '));
  check('a seguradora usa a Party CANÔNICA', parties.find((p) => p.role === 'insurer')?.partyId === partyId);
  check('o verificador preserva o TEXTO sem inventar vínculo',
    parties.find((p) => p.role === 'verifier')?.partyId === null
    && Boolean(parties.find((p) => p.role === 'verifier')?.partyText));
  check('lado contratualmente responsável registrado',
    snapshot.obligations[0].definition.responsibleSide === 'contracting_organization');

  // ─────────────────── 3. MATERIALIZAÇÃO ───────────────────
  console.log('\n=== 3. RECORRÊNCIA ===');
  const first = await materializeObligation(actor, definition.id, '2026-06-30');
  check('materialização mensal criou 6 ocorrências', first === 6, String(first));
  const again = await materializeObligation(actor, definition.id, '2026-06-30');
  check('reexecutar NÃO duplica', again === 0, `${again} criada(s)`);
  const extended = await materializeObligation(actor, definition.id, '2026-08-31');
  check('estender o horizonte acrescenta só o que falta', extended === 2, String(extended));
  const beyond = await materializeObligation(actor, definition.id, '2030-12-31');
  const total = (await pgc.query('SELECT count(*) n FROM contract_obligation_instances WHERE definition_id = $1', [definition.id])).rows[0].n;
  check('a recorrência respeita o fim do contrato', total === '12', `${total} ocorrências, +${beyond} na última chamada`);

  // ─────────────────── 4. RESOLUÇÃO asOf ───────────────────
  console.log('\n=== 4. RESOLUÇÃO NA DATA ===');
  snapshot = await loadContractObligationsAsOf(organizationId, contractId, '2026-03-08');
  const march = snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-03')!;
  const april = snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-04')!;
  check('março (venceu dia 6) está ATRASADA em 08/03', march.urgency === 'OVERDUE', march.urgency);
  check('abril ainda está por vencer', april.urgency === 'UPCOMING', april.urgency);
  check('a definição vigora na data', snapshot.obligations[0].effective === 'TRUE');
  check('o contrato está com faturamento BLOQUEADO', snapshot.billingBlock.state === 'TRUE');

  const before = await loadContractObligationsAsOf(organizationId, contractId, '2025-12-31');
  check('antes da vigência, a definição não vigora', before.obligations[0].effective === 'FALSE');
  check('e nada bloqueia faturamento', before.billingBlock.state === 'FALSE');

  // ─────────────────── 5. TRANSIÇÕES E HISTÓRICO ───────────────────
  console.log('\n=== 5. CICLO DA OCORRÊNCIA ===');
  // A ocorrência já nasce OPEN porque a ativação é determinada pela regra
  // (início do contrato). Voltar para NOT_ACTIVATED seria desfazer um fato.
  check('ocorrência com ativação determinada pela regra nasce OPEN', march.state === 'OPEN', march.state);
  check('e com a data de ativação gravada', Boolean(march.activatedAt), march.activatedAt ?? 'ausente');
  const invalid = await admin.from('contract_obligation_instances')
    .update({ state: 'NOT_ACTIVATED' }).eq('id', march.id).select('id');
  check('transição inválida é recusada', Boolean(invalid.error));

  await transitionObligationInstance(actor, march.id, 'SATISFIED', { satisfactionBasis: 'explicit_completion' });
  const history = await pgc.query(
    'SELECT previous_state, next_state, transition FROM contract_obligation_instance_history WHERE instance_id = $1 ORDER BY recorded_at', [march.id]);
  check('nascimento e transição viraram histórico', history.rows.length === 2,
    history.rows.map((r) => r.transition).join(' → '));
  check('o histórico registra de onde veio e para onde foi',
    history.rows.at(-1)!.previous_state === 'OPEN' && history.rows.at(-1)!.next_state === 'SATISFIED');

  const rewrite = await pgc.query(
    `UPDATE contract_obligation_instance_history SET note = 'x' WHERE instance_id = $1`, [march.id])
    .then(() => null).catch((e: Error) => e);
  check('o histórico não pode ser reescrito', rewrite !== null);

  snapshot = await loadContractObligationsAsOf(organizationId, contractId, '2026-03-08');
  const marchAfter = snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-03')!;
  check('cumprida sai da fila de atrasadas', marchAfter.urgency === 'NOT_APPLICABLE');
  check('cumprida deixa de bloquear', marchAfter.blocksBilling === 'FALSE');
  check('...mas as OUTRAS ocorrências continuam bloqueando', snapshot.billingBlock.state === 'TRUE');
  check('cumprir março não apagou a exigência de abril',
    snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-04')!.state === 'OPEN');

  // ─────────────────── 6. EVIDÊNCIA ───────────────────
  console.log('\n=== 6. EVIDÊNCIA ===');
  const requirement = await admin.from('contract_obligation_evidence_requirements').insert({
    organization_id: organizationId, contract_id: contractId, definition_id: definition.id,
    requirement_text: 'Relatório assinado pelo engenheiro responsável',
    evidence_type: 'document', mandatory: true, requires_formal_acceptance: true,
  }).select('id').single();
  const requirementId = String(requirement.data!.id);

  snapshot = await loadContractObligationsAsOf(organizationId, contractId, '2026-03-08');
  const aprilInst = snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-04')!;
  check('sem evidência, a completude é FALSA', aprilInst.evidenceComplete === 'FALSE', aprilInst.evidenceComplete);

  await recordObligationEvidence(actor, { contractId, instanceId: aprilInst.id, requirementId, documentId });
  snapshot = await loadContractObligationsAsOf(organizationId, contractId, '2026-03-08');
  const withEvidence = snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-04')!;
  check('evidência anexada NÃO é evidência aceita', withEvidence.evidence[0].acceptanceState === 'pending');
  check('presença não completa quando o contrato exige aceite',
    withEvidence.evidenceComplete === 'UNKNOWN', withEvidence.evidenceComplete);
  check('e a obrigação NÃO virou cumprida sozinha', withEvidence.state !== 'SATISFIED');

  // ─────────────────── 7. DISPENSA ───────────────────
  console.log('\n=== 7. DISPENSA ===');
  const mayInst = snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-05')!;
  await recordObligationException(actor, {
    contractId, instanceId: mayInst.id, kind: 'waiver', scope: 'instance',
    reason: 'Acordo comercial registrado em ata da diretoria',
    effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30',
  });
  snapshot = await loadContractObligationsAsOf(organizationId, contractId, '2026-03-08');
  let may = snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-05')!;
  check('dispensa SEM autoridade não suprime o bloqueio',
    may.exceptions[0].effective === false && may.blocksBilling === 'TRUE');

  await pgc.query(
    `UPDATE contract_obligation_exceptions SET authority_reference = 'Ata da diretoria 12/2026' WHERE instance_id = $1`, [mayInst.id]);
  snapshot = await loadContractObligationsAsOf(organizationId, contractId, '2026-03-08');
  may = snapshot.obligations[0].instances.find((i) => i.occurrenceKey === '2026-05')!;
  check('com autoridade, a dispensa passa a valer', may.exceptions[0].effective === true);
  check('e a ocorrência deixa de bloquear', may.blocksBilling === 'FALSE');

  const expired = await loadContractObligationsAsOf(organizationId, contractId, '2026-08-08');
  const mayLater = expired.obligations[0].instances.find((i) => i.occurrenceKey === '2026-05')!;
  check('dispensa VENCIDA volta a bloquear', mayLater.blocksBilling === 'TRUE', mayLater.blocksBilling);
  check('a obrigação original continua inteira',
    Boolean(expired.obligations[0].instances.find((i) => i.occurrenceKey === '2026-05')));

  // ─────────────────── 8. blocks_billing DESCONHECIDO ───────────────────
  console.log('\n=== 8. DESCONHECIDO NÃO VIRA FALSO ===');
  const unknownDef = await createObligationDefinition(actor, {
    contractId, title: 'Obrigação com bloqueio não apurado',
    sourceDocumentId: documentId, effectiveFrom: '2026-01-01',
    activationKind: 'contract_start', dueKind: 'unspecified', recurrenceKind: 'one_time',
    // blocksBilling omitido de propósito: ninguém leu o contrato para saber.
  }) as { id: string };
  await materializeObligation(actor, unknownDef.id, '2026-12-31');
  snapshot = await loadContractObligationsAsOf(organizationId, contractId, '2026-08-08');
  const unknownOb = snapshot.obligations.find((o) => o.definition.id === unknownDef.id)!;
  check('bloqueio não apurado resolve para UNKNOWN', unknownOb.blocksBilling === 'UNKNOWN', unknownOb.blocksBilling);
  check('e o contrato o reporta como indeterminado',
    snapshot.billingBlock.unknownDefinitionIds.includes(unknownDef.id));
  check('prazo não especificado fica DESCONHECIDO, não "no prazo"',
    unknownOb.instances[0].urgency === 'UNKNOWN' && unknownOb.instances[0].dueConfidence === 'unknown');

  // ─────────────────── 9. LINHAGEM ───────────────────
  console.log('\n=== 9. LINHAGEM ===');
  const amended = await createObligationDefinition(actor, {
    contractId, title: 'Relatório mensal de segurança (v2 — prazo de 10 dias)',
    sourceClauseId: clauseId, predecessorId: definition.id, changeEffect: 'altered',
    effectiveFrom: '2026-07-01', activationKind: 'contract_start',
    dueKind: 'days_after_activation', dueOffsetDays: 10, calendarBasis: 'calendar_days',
    recurrenceKind: 'monthly', blocksBilling: true,
  }) as { id: string };
  const original = await pgc.query(
    'SELECT title, effective_from, due_offset_days FROM contract_obligation_definitions WHERE id = $1', [definition.id]);
  check('o aditivo NÃO reescreveu a exigência anterior',
    original.rows[0].title === 'Relatório mensal de segurança' && Number(original.rows[0].due_offset_days) === 5);
  const secondSuccessor = await admin.from('contract_obligation_definitions').insert({
    organization_id: organizationId, contract_id: contractId, title: 'Sucessor ambíguo',
    source_clause_id: clauseId, predecessor_id: definition.id, change_effect: 'altered',
  });
  check('sucessor ambíguo é recusado', Boolean(secondSuccessor.error));

  const past = await loadContractObligationsAsOf(organizationId, contractId, '2026-03-08');
  const future = await loadContractObligationsAsOf(organizationId, contractId, '2026-09-08');
  check('em março, a v2 ainda não vigora',
    past.obligations.find((o) => o.definition.id === amended.id)!.effective === 'FALSE');
  check('em setembro, a v2 vigora',
    future.obligations.find((o) => o.definition.id === amended.id)!.effective === 'TRUE');
  check('e a v1 continua consultável na data em que valia',
    past.obligations.find((o) => o.definition.id === definition.id)!.effective === 'TRUE');
}

async function cleanup() {
  if (!organizationId) return;
  console.log('\n=== LIMPEZA ===');
  await pgc.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
  const left = await pgc.query(
    `SELECT (SELECT count(*) FROM contract_obligation_definitions WHERE organization_id = $1)
          + (SELECT count(*) FROM contract_obligation_instances WHERE organization_id = $1)
          + (SELECT count(*) FROM contract_obligation_instance_history WHERE organization_id = $1)
          + (SELECT count(*) FROM contract_obligation_evidence WHERE organization_id = $1)
          + (SELECT count(*) FROM contract_obligation_exceptions WHERE organization_id = $1)
          + (SELECT count(*) FROM contracts WHERE organization_id = $1) n`, [organizationId]);
  check('apagar a organização alcançou toda a subárvore', left.rows[0].n === '0', `${left.rows[0].n} linha(s)`);
}

async function run() {
  try { await main(); }
  catch (error) {
    failures += 1;
    console.error(`\n!!! FALHA: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await cleanup().catch((e: Error) => console.error(`!!! limpeza incompleta: ${e.message}`));
    await pgc.end();
  }
  console.log(`\n${failures === 0 ? '>>> MOTOR DE OBRIGAÇÕES: TODAS AS PROVAS PASSARAM' : `>>> ${failures} PROVA(S) FALHARAM`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
void obligationServiceClient;
