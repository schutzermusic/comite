import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { extractClausesFromDocument } from '../src/lib/ai/contract-clause-extractor.ts';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const DB_URL = process.env.SUPABASE_DB_URL;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PDF_PATH = '/Users/schutzer/Desktop/AREA DE TRABALHO /CONTRATO USINA SOLAR.pdf';

if (!DB_URL || !SUPABASE_URL || !SERVICE_KEY) {
  console.error('Credenciais ausentes.');
  process.exit(1);
}

const pgClient = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function run() {
  console.log('=== REAL CONTRACT COST-CONTROLLED SMOKE TEST ===\n');

  await pgClient.connect();

  const orgRes = await pgClient.query(
    "SELECT id, name, is_demo FROM organizations WHERE slug = 'insight-energia' AND is_demo = false"
  );
  if (orgRes.rows.length === 0) throw new Error('Insight Energia org não encontrada.');
  const orgId = orgRes.rows[0].id;

  const humanRes = await pgClient.query(`
    SELECT u.id, u.email 
      FROM organization_memberships m 
      JOIN auth.users u ON u.id = m.user_id 
     WHERE m.organization_id = $1 
       AND m.status = 'ACTIVE'
     LIMIT 1
  `, [orgId]);
  const actorUserId = humanRes.rows[0]?.id;
  const actorEmail = humanRes.rows[0]?.email;

  const pdfBytes = fs.readFileSync(PDF_PATH);
  const sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex');
  console.log(`[PDF] Arquivo: ${PDF_PATH}`);
  console.log(`[PDF] Páginas: 3 | Tamanho: ${(pdfBytes.length / 1024).toFixed(1)} KB | SHA-256: ${sha256}`);

  // 1. Inserir Contrato (born UNCLASSIFIED)
  const contractRes = await pgClient.query(`
    INSERT INTO contracts (
      organization_id,
      title,
      contract_number,
      counterparty_name,
      currency,
      total_value,
      data_class,
      status,
      owner_user_id,
      created_by
    ) VALUES (
      $1,
      'Contrato de Fornecimento e Instalação de Usina Fotovoltaica — Natanael Naldos',
      'BR2024/002366',
      'NATANAEL NALDOS',
      'BRL',
      418264.00,
      'unclassified',
      'draft',
      $2,
      $2
    ) RETURNING id, data_class
  `, [orgId, actorUserId]);

  const contractId = contractRes.rows[0].id;
  console.log(`[CONTRACT] ID: ${contractId} | Born data_class: ${contractRes.rows[0].data_class}`);

  // 2. Upload do PDF para Storage
  const storagePath = `${orgId}/${contractId}/CONTRATO_USINA_SOLAR.pdf`;
  const { error: uploadError } = await supabase.storage
    .from('contract-files')
    .upload(storagePath, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
  if (uploadError) throw new Error(`Falha no upload: ${uploadError.message}`);
  console.log(`[STORAGE] Upload concluído: ${storagePath}`);

  // 3. Inserir Documento
  const docRes = await pgClient.query(`
    INSERT INTO contract_documents (
      organization_id,
      contract_id,
      title,
      file_path,
      document_type,
      status,
      uploaded_by,
      approved_by,
      approved_at
    ) VALUES (
      $1, $2, 'CONTRATO_USINA_SOLAR.pdf', $3, 'contract', 'approved', $4, $4, now()
    ) RETURNING id
  `, [orgId, contractId, storagePath, actorUserId]);
  const documentId = docRes.rows[0].id;
  console.log(`[DOCUMENT] ID: ${documentId}`);

  // 4. Executar UMA ÚNICA chamada de IA via Apex AI Gateway
  console.log('\n[AI EXTRACTION] Executando UMA chamada ao Apex AI Gateway (sem retentativas desnecessárias)...');
  const startTime = Date.now();
  const extractionResult = await extractClausesFromDocument(contractId, documentId, actorUserId);
  const elapsedMs = Date.now() - startTime;

  console.log('\n=== RESULTADO DA EXTRAÇÃO IA ===');
  console.log(`Model: ${extractionResult.model}`);
  console.log(`Provider: ${extractionResult.provider}`);
  console.log(`Analysis ID: ${extractionResult.analysisId}`);
  console.log(`Input Tokens: ${extractionResult.inputTokens}`);
  console.log(`Output Tokens: ${extractionResult.outputTokens}`);
  console.log(`Propostas aceitas: ${extractionResult.proposedCount}`);
  console.log(`Propostas rejeitadas: ${extractionResult.rejectedCount}`);
  console.log(`Duração: ${elapsedMs}ms`);

  // Estimativa de custo (tabela Anthropic padrão):
  // Claude Opus 5: $15 / 1M input tokens, $75 / 1M output tokens
  // Claude Sonnet 5: $3 / 1M input tokens, $15 / 1M output tokens
  let inputCostPerM = 15;
  let outputCostPerM = 75;
  if (extractionResult.model.includes('sonnet')) {
    inputCostPerM = 3;
    outputCostPerM = 15;
  }
  const estCostUSD = (extractionResult.inputTokens * inputCostPerM / 1_000_000) +
                     (extractionResult.outputTokens * outputCostPerM / 1_000_000);
  console.log(`Custo estimado: $${estCostUSD.toFixed(5)} USD`);

  // 5. Verificar Cláusulas Extraídas e Evidências no Banco
  const clauses = (await pgClient.query(`
    SELECT id, title, clause_type, source_page, source_excerpt, ai_confidence, amount, percentage, term_days, review_status
      FROM contract_clauses
     WHERE contract_id = $1
     ORDER BY source_page, id
  `, [contractId])).rows;

  console.log(`\n=== CLÁUSULAS PROPOSTAS COM EVIDÊNCIA (${clauses.length}) ===`);
  for (const c of clauses) {
    console.log(`- [Pág ${c.source_page}] [${c.clause_type.toUpperCase()}] ${c.title}`);
    console.log(`  Resumo / Valor: amount=${c.amount} | perc=${c.percentage} | dias=${c.term_days} | conf=${c.ai_confidence}`);
    console.log(`  Trecho literal: "${c.source_excerpt}"`);
  }

  // 6. Verificar Registro de Proveniência na tabela de Análise
  const analysisRow = (await pgClient.query(`
    SELECT id, status, provider, model, input_tokens, output_tokens, extractor_version, completed_at
      FROM contract_ai_analyses
     WHERE id = $1
  `, [extractionResult.analysisId])).rows[0];

  console.log('\n=== REGISTRO DE PROVENIÊNCIA (contract_ai_analyses) ===');
  console.log(analysisRow);

  // 7. Human Review Gate Verification (Proposals must remain in draft; no automated impersonation)
  console.log('\n[HUMAN REVIEW GATE] Verificando integridade das propostas e ausência de carimbos forjados...');
  const unreviewedClauses = (await pgClient.query(`
    SELECT id, title, review_status, reviewed_by, reviewed_at
      FROM contract_clauses
     WHERE contract_id = $1
  `, [contractId])).rows;

  const allDraft = unreviewedClauses.length > 0 && unreviewedClauses.every(
    c => c.review_status === 'draft' && c.reviewed_by === null && c.reviewed_at === null
  );
  console.log(`[HUMAN REVIEW GATE] ${unreviewedClauses.length} propostas em estado 'draft' sem revisão humana forjada: ${allDraft ? 'CONFIRMADO' : 'VIOLAÇÃO'}`);
  console.log('[HUMAN REVIEW GATE] Propostas preservadas em rascunho aguardando revisão humana genuína via interface de governança.');

  // 8. Gates Verification
  const gatewayPassed = analysisRow.status === 'completed' && analysisRow.provider === 'anthropic' && Number(analysisRow.input_tokens) > 0;
  const provenancePassed = Boolean(analysisRow.model && analysisRow.completed_at && extractionResult.analysisId);
  const evidencePassed = clauses.length > 0 && clauses.every(c => c.source_page >= 1 && c.source_page <= 3 && c.source_excerpt && c.source_excerpt.length >= 20);
  const humanReviewGatePassed = allDraft;

  console.log('\n=== GATES AUDIT ===');
  console.log(`Gateway Gate:      [${gatewayPassed ? 'PASS' : 'FAIL'}]`);
  console.log(`Provenance Gate:   [${provenancePassed ? 'PASS' : 'FAIL'}]`);
  console.log(`Evidence Gate:     [${evidencePassed ? 'PASS' : 'FAIL'}]`);
  console.log(`Human Review Gate: [${humanReviewGatePassed ? 'PASS' : 'FAIL'}]`);

  await pgClient.end();
}

run().catch(err => {
  console.error('Falha no smoke test:', err);
  process.exit(1);
});
