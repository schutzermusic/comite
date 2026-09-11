/**
 * Interpretação estruturada de cláusulas contratuais — server-only.
 *
 * ─── O que este arquivo NÃO faz ────────────────────────────────────────────
 *
 * Ele não propõe cláusula. A cláusula já existe: foi escrita e assinada pela
 * contraparte, e o PDF original continua sendo a verdade documental. O que a
 * leitura produz é uma INTERPRETAÇÃO ESTRUTURADA daquele texto — derivada,
 * rastreável até a página, e explicitamente separada da verdade contratual.
 *
 * A diferença não é de vocabulário. No modelo antigo cada leitura entrava numa
 * fila esperando que alguém a "validasse", o que descrevia o Apex como um
 * assistente redigindo contrato e o usuário como revisor de máquina. Num
 * contrato de 195 páginas essa fila é o próprio motivo de ninguém olhar o que
 * importava.
 *
 * ─── Quatro decisões de desenho ────────────────────────────────────────────
 *
 * 1. **O PDF vai nativo para o modelo**, como bloco `document`, em vez de ser
 *    convertido em texto antes. É o que dá número de página confiável: a
 *    página é o que o modelo viu, não o resultado de um extrator de texto que
 *    perde quebra de coluna e rodapé.
 *
 * 2. **Toda interpretação carrega evidência ou é descartada.** O schema exige
 *    `source_page` e `source_excerpt`, e `assertEvidence()` derruba o que
 *    vier sem — antes do banco, que também recusa por CHECK
 *    (`contract_clauses_ai_needs_evidence_check`, migration 093). São duas
 *    barreiras para a mesma regra porque é A regra: leitura que não se confere
 *    no papel não entra.
 *
 * 3. **A saída é INTERPRETAÇÃO, nunca verdade contratual.** Toda linha nasce
 *    `ai_flagged: true`, com provedor, modelo, confiança e o texto original
 *    congelado em `ai_proposed_*`. A proveniência é o que permite conferir a
 *    leitura contra o papel meses depois.
 *
 * 4. **Atenção humana é EXCEÇÃO, e quem a decide é o banco.** A migration 154
 *    classifica cada linha por política determinística: confiança baixa, risco
 *    material, exposição financeira, compromisso jurídico. Este módulo não
 *    escolhe o que entra na fila — ele grava a leitura e a proveniência, e a
 *    política faz o resto. Uma política de autoridade que morasse aqui seria
 *    uma política que o próximo script contorna.
 *
 * `citations: {enabled:true}` daria a proveniência pela API, mas é incompatível
 * com `output_config.format` (retorna 400) — por isso a evidência é campo do
 * schema, e não bloco de citação.
 */

// `server-only` não está instalado neste repo; a guarda é em runtime, como em
// `src/lib/ai/risk-scanner.ts`.
if (typeof window !== 'undefined') {
  throw new Error('contract-clause-extractor.ts não pode ser importado no browser');
}

import { CLAUSE_CATEGORIES, isClauseCategory, type ClauseCategory } from '@/lib/contracts/clause-categories';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { getApexAIGateway, getApexAITaskPolicy, type ApexAIResponse } from '@/lib/ai/gateway';

/**
 * Extração de cláusula de contrato é trabalho sensível a inteligência: erro de
 * leitura vira registro jurídico errado. Não é lugar para modelo menor.
 */
/** Versão do prompt/pipeline, gravada junto da análise para auditoria. */
export const EXTRACTOR_VERSION = 'clause-extractor/1.0.0';

const CONTRACT_FILES_BUCKET = 'contract-files';
/** Limite da API para documento em base64 no corpo da requisição. */
const MAX_PDF_BYTES = 30 * 1024 * 1024;

// ═══════════════════════════════════════════════════════════════════════════
// Categorias
// ═══════════════════════════════════════════════════════════════════════════

// O vocabulário vive em módulo isomórfico: componentes de cliente precisam dos
// rótulos, e importá-los daqui derrubaria a página pela guarda de runtime.
export {
  CLAUSE_CATEGORIES, CLAUSE_CATEGORY_LABEL, isClauseCategory,
  type ClauseCategory,
} from '@/lib/contracts/clause-categories';

// ═══════════════════════════════════════════════════════════════════════════
// Contrato de saída
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Uma cláusula do contrato, lida e estruturada.
 *
 * O nome do tipo preserva o histórico do arquivo; o objeto NÃO é uma proposta
 * de redação. Ele é a leitura de algo que já está escrito no documento.
 */
export interface ClauseProposal {
  category: ClauseCategory;
  title: string;
  /** Resumo estruturado do que a cláusula determina. */
  summary: string;
  /** Página do PDF onde a cláusula foi lida (1-indexada). */
  source_page: number;
  /** Trecho LITERAL do contrato que sustenta a proposta. */
  source_excerpt: string;
  risk_level: 'low' | 'medium' | 'high';
  confidence: number;
  amount: number | null;
  percentage: number | null;
  term_days: number | null;
}

const CLAUSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['clauses'],
  properties: {
    clauses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'category', 'title', 'summary', 'source_page', 'source_excerpt',
          'risk_level', 'confidence', 'amount', 'percentage', 'term_days',
        ],
        properties: {
          category: { type: 'string', enum: [...CLAUSE_CATEGORIES] },
          title: { type: 'string', description: 'Título curto e específico da cláusula.' },
          summary: { type: 'string', description: 'O que a cláusula determina, em linguagem de negócio.' },
          source_page: { type: 'integer', description: 'Página do PDF onde o trecho aparece.' },
          source_excerpt: {
            type: 'string',
            description: 'Trecho LITERAL copiado do contrato, sem paráfrase.',
          },
          risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
          confidence: { type: 'number', description: 'Confiança na extração entre 0 e 1.' },
          amount: { type: ['number', 'null'], description: 'Valor em reais, quando a cláusula fixa um.' },
          percentage: { type: ['number', 'null'], description: 'Percentual, quando a cláusula fixa um.' },
          term_days: { type: ['integer', 'null'], description: 'Prazo em dias, quando a cláusula fixa um.' },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `Você interpreta cláusulas de contratos brasileiros para um sistema de governança corporativa.

O CONTEXTO
O contrato foi escrito e assinado pela contraparte. Ele já vale. Você não redige, não propõe e não altera cláusula nenhuma.

O QUE VOCÊ PRODUZ
Interpretações ESTRUTURADAS das cláusulas que já existem no documento, para que o sistema possa monitorá-las. Você não decide nada: você lê e estrutura. A verdade contratual continua sendo o PDF assinado.

REGRA ABSOLUTA — EVIDÊNCIA
Toda cláusula proposta precisa de um trecho LITERAL do documento em "source_excerpt" e da página em "source_page".
- Copie o trecho exatamente como está no contrato. Não parafraseie, não normalize, não corrija.
- Se você não consegue apontar o trecho e a página, NÃO estruture a cláusula.
- É correto e esperado devolver uma lista vazia quando o documento não contém cláusulas das categorias pedidas.
- Nunca estruture uma cláusula "típica de contratos assim". Ausência de cláusula é uma informação valiosa; cláusula inventada é um defeito grave.

CATEGORIAS
pagamento, reajuste, sla, penalidade, rescisao, renovacao, garantia, responsabilidade, seguro, compliance.
Uma cláusula que não se encaixa em nenhuma delas não deve ser estruturada.

EFEITO CONTRATUAL
Preencha "amount", "percentage" e "term_days" APENAS quando o número estiver escrito no trecho. Os três são independentes e podem coexistir. Use null — nunca zero — quando o contrato não fixa aquele efeito: zero significaria multa de 0% ou prazo de 0 dias.

CONFIANÇA
"confidence" reflete o quanto o trecho sustenta a estruturação, não o quanto a cláusula é importante. Trecho ambíguo, cortado ou de leitura duvidosa deve baixar a confiança, mesmo que a cláusula pareça óbvia.

RISCO
"risk_level" avalia a exposição que a cláusula cria para a contratante, com base no que está escrito.`;

// ═══════════════════════════════════════════════════════════════════════════
// Gate de evidência
// ═══════════════════════════════════════════════════════════════════════════

export type EvidenceRejection = { proposal: unknown; reason: string };

/**
 * Conta as páginas do PDF pelo dicionário `/Pages`, sem abrir um parser.
 *
 * Best-effort de propósito: devolve `null` quando não consegue determinar, e
 * aí a checagem de "página além do documento" simplesmente não roda. Um
 * contador que erra para MENOS descartaria proposta legítima — pior do que não
 * checar. Só o maior `/Count` é considerado, porque PDFs com árvore de páginas
 * aninhada repetem o campo nos nós intermediários.
 */
export function countPdfPages(bytes: Buffer): number | null {
  // `latin1` preserva byte a byte; o dicionário do PDF é ASCII.
  const head = bytes.toString('latin1');
  const counts = [...head.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (counts.length === 0) {
    // Ordem inversa das chaves no dicionário.
    const alt = [...head.matchAll(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (alt.length === 0) return null;
    return Math.max(...alt);
  }
  return Math.max(...counts);
}

/**
 * Separa o que tem evidência do que não tem.
 *
 * Puro e exportado para teste: é a barreira que implementa "nunca inventar
 * cláusula sem evidência documental", e ela precisa ser verificável sem rede.
 */
export function assertEvidence(
  proposals: readonly unknown[],
  pageCount: number | null,
): { accepted: ClauseProposal[]; rejected: EvidenceRejection[] } {
  const accepted: ClauseProposal[] = [];
  const rejected: EvidenceRejection[] = [];

  for (const raw of proposals) {
    const p = raw as Partial<ClauseProposal>;
    const excerpt = typeof p.source_excerpt === 'string' ? p.source_excerpt.trim() : '';

    if (!excerpt) {
      rejected.push({ proposal: raw, reason: 'sem trecho de origem' });
      continue;
    }
    if (excerpt.length < 20) {
      rejected.push({ proposal: raw, reason: 'trecho curto demais para conferência' });
      continue;
    }
    if (typeof p.source_page !== 'number' || !Number.isInteger(p.source_page) || p.source_page < 1) {
      rejected.push({ proposal: raw, reason: 'sem página de origem' });
      continue;
    }
    // Página fora do documento é sinal de leitura fabricada.
    if (pageCount !== null && p.source_page > pageCount) {
      rejected.push({ proposal: raw, reason: `página ${p.source_page} além do documento (${pageCount} páginas)` });
      continue;
    }
    if (!isClauseCategory(p.category)) {
      rejected.push({ proposal: raw, reason: 'categoria fora do vocabulário' });
      continue;
    }
    if (!p.title?.trim()) {
      rejected.push({ proposal: raw, reason: 'sem título' });
      continue;
    }
    if (typeof p.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) {
      rejected.push({ proposal: raw, reason: 'confiança fora de 0..1' });
      continue;
    }

    accepted.push({
      category: p.category as ClauseCategory,
      title: p.title.trim(),
      summary: p.summary?.trim() ?? '',
      source_page: p.source_page,
      source_excerpt: excerpt,
      risk_level: p.risk_level === 'high' || p.risk_level === 'low' ? p.risk_level : 'medium',
      confidence: p.confidence,
      amount: typeof p.amount === 'number' ? p.amount : null,
      percentage: typeof p.percentage === 'number' ? p.percentage : null,
      term_days: typeof p.term_days === 'number' ? p.term_days : null,
    });
  }

  return { accepted, rejected };
}

// ═══════════════════════════════════════════════════════════════════════════
// Execução
// ═══════════════════════════════════════════════════════════════════════════

function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Credenciais de serviço do Supabase ausentes.');
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

/**
 * Impressão digital de uma proposta: mesmo documento, mesma página, mesmo
 * trecho = mesma leitura.
 *
 * Espelha o índice único da migration 094. Existe no código para que a
 * reanálise PULE a duplicata sabendo que pulou — o índice é a rede de
 * segurança, não o mecanismo: deixar o banco recusar daria erro de inserção
 * em lote e perderia as propostas novas junto.
 */
export function proposalFingerprint(
  documentId: string,
  page: number,
  excerpt: string,
): string {
  return `${documentId}|${page}|${excerpt.trim()}`;
}

export interface ExtractionResult {
  analysisId: string;
  documentId: string;
  proposedCount: number;
  rejectedCount: number;
  /** Propostas idênticas a leituras já existentes — puladas, não duplicadas. */
  duplicateCount: number;
  rejections: EvidenceRejection[];
  /** Análise anterior do mesmo documento, marcada como substituída. */
  supersededAnalysisId: string | null;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  version: string;
}

export async function extractClausesFromDocument(
  contractId: string,
  documentId: string,
  actorUserId: string | null,
): Promise<ExtractionResult> {
  const supabase = getServiceClient();

  const { data: document, error: docError } = await supabase
    .from('contract_documents')
    .select('id, contract_id, organization_id, title, file_path')
    .eq('id', documentId)
    .eq('contract_id', contractId)
    .maybeSingle<{ id: string; contract_id: string; organization_id: string; title: string; file_path: string }>();

  if (docError) throw new Error(`Erro ao carregar documento: ${docError.message}`);
  if (!document) throw new Error('Documento não encontrado para este contrato.');
  if (!document.file_path.toLowerCase().endsWith('.pdf')) {
    throw new Error('A extração de cláusulas só lê PDF. Este documento tem outro formato.');
  }

  const { data: blob, error: dlError } = await supabase.storage
    .from(CONTRACT_FILES_BUCKET)
    .download(document.file_path);
  if (dlError || !blob) throw new Error(`Erro ao baixar o documento: ${dlError?.message ?? 'arquivo ausente'}`);

  const bytes = Buffer.from(await blob.arrayBuffer());
  // Sem truncagem silenciosa: um contrato cortado ao meio produziria uma
  // leitura parcial apresentada como completa.
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(
      `O documento tem ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB e excede o limite de ${MAX_PDF_BYTES / 1024 / 1024} MB da análise. Divida o arquivo em partes e analise cada uma.`,
    );
  }

  const startedAt = new Date().toISOString();
  const taskPolicy = getApexAITaskPolicy('CONTRACT_EXTRACTION');

  /*
    A análise é registrada como `running` ANTES da chamada. Sem isso, uma
    falha de rede ou um processo derrubado no meio deixariam o documento com
    aparência de "nunca analisado", e a fila operacional esconderia a falha.
  */
  const { data: analysis, error: analysisError } = await supabase
    .from('contract_ai_analyses')
    .insert({
      organization_id: document.organization_id,
      contract_id: contractId,
      document_id: documentId,
      status: 'running',
      started_at: startedAt,
      provider: taskPolicy.provider,
      model: taskPolicy.model,
      extractor_version: EXTRACTOR_VERSION,
      summary: `Lendo "${document.title}".`,
      extracted_data: { kind: 'clause_extraction', document_id: documentId, document_title: document.title },
      findings: [],
      created_by: actorUserId,
    })
    .select('id')
    .single<{ id: string }>();
  if (analysisError) throw new Error(`Erro ao registrar a análise: ${analysisError.message}`);

  /**
   * Marca a análise como falha e DEVOLVE o erro para quem chama lançar.
   *
   * Devolver em vez de lançar é o que deixa o controle de fluxo visível ao
   * compilador: `throw await failAnalysis(...)` estreita o tipo depois do
   * bloco, enquanto uma função que lança de dentro de um `catch` não.
   */
  const failAnalysis = async (message: string): Promise<Error> => {
    await supabase
      .from('contract_ai_analyses')
      .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
      .eq('id', analysis.id);
    return new Error(message);
  };

  /*
    A chamada é embrulhada porque uma falha de rede, um 429 ou um timeout
    deixariam a análise presa em `running` para sempre — e um documento
    eternamente "analisando" some da fila de trabalho sem nunca ter sido lido.
  */
  let response: ApexAIResponse<{ clauses?: unknown[] }>;
  try {
    response = await getApexAIGateway().generate<{ clauses?: unknown[] }>({
      organizationId: document.organization_id,
      task: 'CONTRACT_EXTRACTION',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: 'Extraia as cláusulas deste contrato conforme as regras do sistema. Se o documento não contiver cláusula de nenhuma das categorias, devolva a lista vazia.',
      document: { mediaType: 'application/pdf', base64: bytes.toString('base64') },
      structuredOutput: { name: 'contract_clauses', schema: CLAUSE_SCHEMA },
    });
  } catch (err) {
    throw await failAnalysis(
      `A análise falhou: ${err instanceof Error ? err.message : 'erro inesperado'}`,
    );
  }

  const parsed = response.output as { clauses?: unknown[] };

  // A contagem de páginas fecha o cerco: uma proposta que cita página inexistente
  // é leitura fabricada, e agora é descartada em vez de registrada.
  const { accepted, rejected } = assertEvidence(parsed.clauses ?? [], countPdfPages(bytes));

  /*
    IDEMPOTÊNCIA. As leituras que já existem para este documento são puladas —
    não reinseridas, não duplicadas. Reanalisar o mesmo papel tem de ser
    seguro: quem clica duas vezes não pode acabar com duas filas de revisão.
  */
  const { data: existingRows } = await supabase
    .from('contract_clauses')
    .select('source_page, source_excerpt, review_status')
    .eq('contract_id', contractId)
    .eq('source_document_id', documentId)
    .eq('ai_flagged', true);

  const existing = new Set(
    (existingRows ?? [])
      .filter((r) => r.review_status !== 'rejected')
      .map((r) => proposalFingerprint(documentId, r.source_page as number, String(r.source_excerpt ?? ''))),
  );

  const fresh = accepted.filter(
    (c) => !existing.has(proposalFingerprint(documentId, c.source_page, c.source_excerpt)),
  );
  const duplicateCount = accepted.length - fresh.length;

  /*
    A análise ANTERIOR do mesmo documento passa a `superseded`. As cláusulas
    que ela originou NÃO são tocadas: decisão humana já registrada é história,
    e apagá-la para "limpar" destruiria a trilha que justifica cada validação.
  */
  const { data: previousAnalyses } = await supabase
    .from('contract_ai_analyses')
    .select('id')
    .eq('contract_id', contractId)
    .eq('document_id', documentId)
    .in('status', ['completed', 'failed'])
    .neq('id', analysis.id);

  let supersededAnalysisId: string | null = null;
  if (previousAnalyses && previousAnalyses.length > 0) {
    await supabase
      .from('contract_ai_analyses')
      .update({ status: 'superseded', superseded_by_analysis_id: analysis.id })
      .in('id', previousAnalyses.map((a) => a.id));
    supersededAnalysisId = previousAnalyses[0].id;
  }

  if (fresh.length > 0) {
    const proposedAt = new Date().toISOString();
    const { error: insertError } = await supabase.from('contract_clauses').insert(
      fresh.map((clause) => ({
        organization_id: document.organization_id,
        contract_id: contractId,
        title: clause.title,
        clause_type: clause.category,
        content: clause.summary || null,
        risk_level: clause.risk_level,
        source_document_id: documentId,
        source_page: clause.source_page,
        source_excerpt: clause.source_excerpt,
        amount: clause.amount,
        percentage: clause.percentage,
        term_days: clause.term_days,
        // `ai_flagged` é o que impede a interpretação de se passar por verdade
        // contratual. `review_status: 'draft'` sobrevive como linhagem de
        // fluxo — desde a migration 154 ele NÃO significa "esperando alguém
        // validar": quem decide se este item pede atenção humana é a política
        // de exceção, no gatilho `classify_interpretation`.
        ai_flagged: true,
        review_status: 'draft',
        ai_confidence: clause.confidence,
        ai_provider: response.provenance.provider,
        ai_model: response.provenance.model,
        ai_analysis_id: analysis.id,
        ai_proposed_at: proposedAt,
        ai_proposed_title: clause.title,
        ai_proposed_content: clause.summary || null,
        created_by: actorUserId,
        updated_by: actorUserId,
      })),
    );
    if (insertError) throw await failAnalysis(`Erro ao registrar as propostas: ${insertError.message}`);
  }

  await supabase
    .from('contract_ai_analyses')
    .update({
      status: 'completed',
      provider: response.provenance.provider,
      model: response.provenance.model,
      input_tokens: response.provenance.usage.inputTokens,
      output_tokens: response.provenance.usage.outputTokens,
      completed_at: new Date().toISOString(),
      summary: `${fresh.length} cláusula(s) interpretadas a partir de "${document.title}".`,
      risk_summary: fresh.length === 0
        ? 'Nenhuma cláusula nova com evidência suficiente foi encontrada no documento.'
        : `${fresh.filter((c) => c.risk_level === 'high').length} de risco alto.`,
      extracted_data: {
        kind: 'clause_extraction',
        provider: response.provenance.provider,
        model: response.provenance.model,
        version: EXTRACTOR_VERSION,
        document_id: documentId,
        document_title: document.title,
        started_at: startedAt,
        structured: fresh.length,
        duplicates_skipped: duplicateCount,
        rejected_without_evidence: rejected.length,
        page_count: countPdfPages(bytes),
        usage: {
          input_tokens: response.provenance.usage.inputTokens,
          output_tokens: response.provenance.usage.outputTokens,
        },
      },
      findings: rejected.map((r) => ({ reason: r.reason })),
    })
    .eq('id', analysis.id);

  return {
    analysisId: analysis.id,
    documentId,
    proposedCount: fresh.length,
    rejectedCount: rejected.length,
    duplicateCount,
    rejections: rejected,
    supersededAnalysisId,
    model: response.provenance.model,
    provider: response.provenance.provider,
    inputTokens: response.provenance.usage.inputTokens,
    outputTokens: response.provenance.usage.outputTokens,
    version: EXTRACTOR_VERSION,
  };
}
