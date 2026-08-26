/**
 * P2E — operação da inteligência de cláusulas.
 *
 * Ciclo de vida, fila de revisão, cobertura e métricas. Tudo puro, testado sem
 * banco e sem rede — as regras que decidem o que aparece para um humano fazer
 * precisam ser verificáveis linha a linha.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deriveLifecycle, documentAnalysisStates, LIFECYCLE_LABEL,
  buildReviewInbox, applyInboxFilters, inboxPriority,
  contractCoverage, clauseOpsMetrics, benchmarkReadiness,
} from '@/lib/contracts/trust/clause-operations';
import { buildTrustedContract, relationsBatchFromDetail } from '@/lib/contracts/trust/read-model';
import { attentionItems } from '@/lib/contracts/trust/attention';
import { CLAUSE_CATEGORIES } from '@/lib/contracts/clause-categories';
import type {
  ContractAiAnalysisRow, ContractClauseRow, ContractDetail, ContractDocumentRow, ContractRow,
} from '@/lib/contracts/contract-service';
import { PROJECT_CEMIG } from './fixtures/contract-fixtures';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const NOW = new Date('2026-08-24T12:00:00.000Z');
const ID = 'qa-contract-0001';

const doc = (over: Partial<ContractDocumentRow> = {}): ContractDocumentRow => ({
  id: 'doc-1', organization_id: 'org-1', contract_id: ID, title: 'Contrato assinado.pdf',
  file_path: 'org/c/doc.pdf', document_type: 'contract', status: 'approved',
  uploaded_by: 'u', approved_at: null, approved_by: null, rejection_reason: null,
  version: 1, supersedes_document_id: null, superseded_by_document_id: null, superseded_at: null,
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  ...over,
} as ContractDocumentRow);

const analysis = (over: Partial<ContractAiAnalysisRow> = {}): ContractAiAnalysisRow => ({
  id: 'an-1', organization_id: 'org-1', contract_id: ID, status: 'completed',
  summary: null, risk_summary: null, extracted_data: {}, findings: [],
  created_by: 'u', created_at: '2026-08-10T00:00:00Z', completed_at: '2026-08-10T00:05:00Z',
  document_id: 'doc-1', started_at: '2026-08-10T00:00:00Z', error_message: null,
  model: 'claude-opus-5', extractor_version: 'clause-extractor/1.0.0', superseded_by_analysis_id: null,
  ...over,
} as ContractAiAnalysisRow);

const clause = (over: Partial<ContractClauseRow> = {}): ContractClauseRow => ({
  id: 'cl-1', organization_id: 'org-1', contract_id: ID, clause_type: 'penalidade',
  title: 'Multa por atraso', content: null, risk_level: 'high', ai_flagged: true,
  source_document_id: 'doc-1', source_page: 12, source_excerpt: 'trecho literal do contrato aqui',
  amount: null, percentage: 2, term_days: null, review_status: 'draft',
  reviewed_by: null, reviewed_at: null,
  ai_confidence: 0.9, ai_model: 'claude-opus-5', ai_analysis_id: 'an-1',
  ai_proposed_at: '2026-08-20T00:00:00Z', ai_proposed_title: 'Multa por atraso',
  ai_proposed_content: null, superseded_by_clause_id: null,
  created_by: 'u', updated_by: 'u', created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
  ...over,
} as ContractClauseRow);

const row: ContractRow = {
  id: ID, organization_id: 'org-1', project_id: null, client_id: null, supplier_id: null,
  title: '[QA] Contrato', contract_number: 'QA-0001', counterparty_name: 'Fornecedor QA',
  contract_type: 'Serviços', status: 'active', lifecycle_stage: null,
  start_date: null, end_date: '2027-05-13', signed_date: null, renewal_date: null,
  currency: 'BRL', total_value: 1_200_000, monthly_value: null, payment_terms: null,
  scope_summary: null, risk_level: 'high', health_score: null, owner_user_id: 'u',
  created_by: 'u', updated_by: 'u', created_at: '2026-05-14T09:00:00Z',
  updated_at: '2026-05-14T09:00:00Z', deleted_at: null, data_class: 'live',
} as ContractRow;

const base: ContractDetail = {
  contract: row, clauses: [], penalties: [], milestones: [], risks: [], files: [], aiAnalyses: [],
  billingEvents: [] as never, obligations: [] as never, approvals: [] as never,
  projectLinks: [] as never, riskLinks: [] as never, documents: [] as never, amendments: [], amendmentClauses: [], amendmentsError: null
};

const trusted = (clauses: ContractClauseRow[] = []) =>
  buildTrustedContract(row, relationsBatchFromDetail({ ...base, clauses }), [PROJECT_CEMIG], NOW);

// ═══════════════════════════════════════════════════════════════════
// 1 · Ciclo de vida
// ═══════════════════════════════════════════════════════════════════

describe('deriveLifecycle', () => {
  const counts = (pending: number, decided: number, total: number) => ({ pending, decided, total });

  it('sem análise e sem proposta: nunca analisado', () => {
    expect(deriveLifecycle(null, counts(0, 0, 0))).toBe('not-analyzed');
  });

  it('em execução', () => {
    expect(deriveLifecycle('running', counts(0, 0, 0))).toBe('analyzing');
  });

  it('falha é estado terminal e visível', () => {
    expect(deriveLifecycle('failed', counts(0, 0, 0))).toBe('failed');
    // Mesmo com propostas antigas na mesa, a falha domina o estado.
    expect(deriveLifecycle('failed', counts(3, 0, 3))).toBe('failed');
  });

  it('concluída com pendências e nenhuma decisão: propostas disponíveis', () => {
    expect(deriveLifecycle('completed', counts(3, 0, 3))).toBe('proposals-available');
  });

  it('concluída com decisão parcial: em revisão', () => {
    expect(deriveLifecycle('completed', counts(1, 2, 3))).toBe('in-review');
  });

  it('concluída e tudo decidido: revisado', () => {
    expect(deriveLifecycle('completed', counts(0, 3, 3))).toBe('reviewed');
  });

  it('concluída SEM proposta alguma é revisado, não pendente', () => {
    // Documento lido que não continha cláusula não é trabalho pendente —
    // deixá-lo na fila encheria a caixa de entrada de nada.
    expect(deriveLifecycle('completed', counts(0, 0, 0))).toBe('reviewed');
  });

  it('todo estado tem rótulo', () => {
    for (const state of Object.keys(LIFECYCLE_LABEL)) {
      expect(LIFECYCLE_LABEL[state as keyof typeof LIFECYCLE_LABEL]).toBeTruthy();
    }
  });
});

describe('documentAnalysisStates', () => {
  it('ordena por urgência: falha primeiro, revisado por último', () => {
    const states = documentAnalysisStates(
      [doc({ id: 'd-ok', title: 'C' }), doc({ id: 'd-fail', title: 'A' }), doc({ id: 'd-new', title: 'B' })],
      [
        analysis({ id: 'a1', document_id: 'd-ok', status: 'completed' }),
        analysis({ id: 'a2', document_id: 'd-fail', status: 'failed', error_message: 'timeout' }),
      ],
      [],
    );
    expect(states.map((s) => s.lifecycle)).toEqual(['failed', 'not-analyzed', 'reviewed']);
    expect(states[0].errorMessage).toBe('timeout');
  });

  it('análise substituída não define o estado — a viva define', () => {
    const states = documentAnalysisStates(
      [doc()],
      [
        analysis({ id: 'velha', status: 'superseded', created_at: '2026-08-01T00:00:00Z' }),
        analysis({ id: 'nova', status: 'completed', created_at: '2026-08-10T00:00:00Z' }),
      ],
      [clause()],
    );
    expect(states[0].analysisId).toBe('nova');
    expect(states[0].lifecycle).toBe('proposals-available');
  });

  it('documento substituído continua listado e marcado', () => {
    const states = documentAnalysisStates(
      [doc({ superseded_by_document_id: 'doc-2' })], [], [],
    );
    // Sumir com ele apagaria a linhagem.
    expect(states).toHaveLength(1);
    expect(states[0].superseded).toBe(true);
  });

  it('conta propostas por decisão', () => {
    const states = documentAnalysisStates([doc()], [analysis()], [
      clause({ id: 'a', review_status: 'draft' }),
      clause({ id: 'b', review_status: 'validated' }),
      clause({ id: 'c', review_status: 'rejected' }),
    ]);
    expect(states[0]).toMatchObject({ proposalsPending: 1, proposalsValidated: 1, proposalsRejected: 1 });
    expect(states[0].lifecycle).toBe('in-review');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2 · Fila de revisão
// ═══════════════════════════════════════════════════════════════════

describe('fila de revisão', () => {
  const docs = new Map([['doc-1', doc()], ['doc-old', doc({ id: 'doc-old', superseded_by_document_id: 'doc-1' })]]);

  it('só propostas de IA pendentes entram na fila', () => {
    const inbox = buildReviewInbox([trusted([
      clause({ id: 'pendente', review_status: 'draft' }),
      clause({ id: 'validada', review_status: 'validated', source_page: 13 }),
      clause({ id: 'manual', ai_flagged: false, source_page: 14 }),
    ])], docs, NOW);
    expect(inbox.map((i) => i.clauseId)).toEqual(['pendente']);
  });

  it('confiança baixa sobe na fila — é onde a pessoa agrega mais', () => {
    const inbox = buildReviewInbox([trusted([
      clause({ id: 'clara', ai_confidence: 0.95, source_page: 1 }),
      clause({ id: 'duvidosa', ai_confidence: 0.3, source_page: 2 }),
      clause({ id: 'media', ai_confidence: 0.7, source_page: 3 }),
    ])], docs, NOW);
    expect(inbox.map((i) => i.clauseId)).toEqual(['duvidosa', 'media', 'clara']);
  });

  it('proposta de documento substituído vai para o FIM', () => {
    const inbox = buildReviewInbox([trusted([
      clause({ id: 'obsoleta', source_document_id: 'doc-old', ai_confidence: 0.1, source_page: 5 }),
      clause({ id: 'atual', ai_confidence: 0.99, source_page: 6 }),
    ])], docs, NOW);
    // Mesmo com confiança baixíssima, revisar leitura de papel superado é
    // trabalho jogado fora.
    expect(inbox.map((i) => i.clauseId)).toEqual(['atual', 'obsoleta']);
    expect(inbox[1].fromSupersededDocument).toBe(true);
  });

  it('a idade pressiona a prioridade', () => {
    const recente = inboxPriority({ confidence: 0.8, riskLevel: 'medium', ageDays: 0, fromSupersededDocument: false });
    const parada = inboxPriority({ confidence: 0.8, riskLevel: 'medium', ageDays: 20, fromSupersededDocument: false });
    expect(parada).toBeLessThan(recente);
  });

  it('risco alto sobe', () => {
    const alto = inboxPriority({ confidence: 0.8, riskLevel: 'high', ageDays: null, fromSupersededDocument: false });
    const baixo = inboxPriority({ confidence: 0.8, riskLevel: 'low', ageDays: null, fromSupersededDocument: false });
    expect(alto).toBeLessThan(baixo);
  });

  it('carrega a evidência em cada item — revisar sem trecho é impossível', () => {
    const inbox = buildReviewInbox([trusted([clause()])], docs, NOW);
    expect(inbox[0].excerpt).toBe('trecho literal do contrato aqui');
    expect(inbox[0].page).toBe(12);
    expect(inbox[0].documentTitle).toBe('Contrato assinado.pdf');
  });

  it('calcula a idade em dias a partir da proposta', () => {
    const inbox = buildReviewInbox([trusted([clause()])], docs, NOW);
    expect(inbox[0].ageDays).toBe(4);
  });

  it('demonstração fica fora da fila oficial', () => {
    const demo = buildTrustedContract(
      { ...row, data_class: 'demo' } as ContractRow,
      relationsBatchFromDetail({ ...base, clauses: [clause()] }), [PROJECT_CEMIG], NOW,
    );
    expect(buildReviewInbox([demo], docs, NOW)).toEqual([]);
    expect(buildReviewInbox([demo], docs, NOW, {}, { officialOnly: false })).toHaveLength(1);
  });
});

describe('filtros da fila', () => {
  const docs = new Map([['doc-1', doc()]]);
  const inbox = () => buildReviewInbox([trusted([
    clause({ id: 'a', clause_type: 'penalidade', ai_confidence: 0.9, source_page: 1 }),
    clause({ id: 'b', clause_type: 'sla', ai_confidence: 0.4, source_page: 2 }),
    clause({ id: 'c', clause_type: 'sla', ai_confidence: null, source_page: 3, review_status: 'in_review' }),
  ])], docs, NOW);

  it('filtra por categoria', () => {
    expect(applyInboxFilters(inbox(), { category: 'sla' }).map((i) => i.clauseId).sort()).toEqual(['b', 'c']);
  });

  it('filtra por estado de revisão', () => {
    expect(applyInboxFilters(inbox(), { status: 'in_review' }).map((i) => i.clauseId)).toEqual(['c']);
  });

  it('filtra por confiança máxima, e SEM confiança conta como duvidosa', () => {
    const low = applyInboxFilters(inbox(), { maxConfidence: 0.5 }).map((i) => i.clauseId).sort();
    // Não saber o quanto a leitura é firme é tão incerto quanto saber que é fraca.
    expect(low).toEqual(['b', 'c']);
  });

  it('filtra por idade mínima', () => {
    expect(applyInboxFilters(inbox(), { minAgeDays: 10 })).toEqual([]);
    expect(applyInboxFilters(inbox(), { minAgeDays: 3 })).toHaveLength(3);
  });

  it('"all" não filtra', () => {
    expect(applyInboxFilters(inbox(), { category: 'all', status: 'all', contractId: 'all' })).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3 · Cobertura
// ═══════════════════════════════════════════════════════════════════

describe('cobertura por contrato', () => {
  it('o esperado é o vocabulário inteiro — nenhuma inferência decide o que o contrato "deveria" ter', () => {
    const cov = contractCoverage(trusted([]), [doc()], []);
    expect(cov.expectedCategories).toBe(CLAUSE_CATEGORIES.length);
    expect(cov.categories).toHaveLength(CLAUSE_CATEGORIES.length);
    expect(cov.categories.every((c) => c.missing)).toBe(true);
  });

  it('só cláusula VALIDADA conta como cobertura', () => {
    const cov = contractCoverage(trusted([
      clause({ id: 'p', clause_type: 'sla', review_status: 'draft', source_page: 1 }),
      clause({ id: 'v', clause_type: 'pagamento', review_status: 'validated', source_page: 2 }),
    ]), [doc()], []);
    expect(cov.validatedCategories).toBe(1);
    expect(cov.categories.find((c) => c.category === 'sla')?.missing).toBe(true);
    expect(cov.categories.find((c) => c.category === 'pagamento')?.missing).toBe(false);
  });

  it('conta documentos vigentes nunca analisados', () => {
    const cov = contractCoverage(trusted([]), [
      doc({ id: 'd1' }),
      doc({ id: 'd2' }),
      doc({ id: 'd3', superseded_by_document_id: 'd1' }),
    ], [analysis({ document_id: 'd1', status: 'completed' })]);
    // d2 nunca foi analisado; d3 está substituído e não conta.
    expect(cov.documentsNotAnalyzed).toBe(1);
  });

  it('sem documento a cobertura não é apurável — não vira 0%', () => {
    expect(contractCoverage(trusted([]), [], []).coverageRatio).toBeNull();
  });

  it('conta análises que falharam', () => {
    const cov = contractCoverage(trusted([]), [doc()], [analysis({ status: 'failed' })]);
    expect(cov.analysesFailed).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4 · Métricas e prontidão para comparação
// ═══════════════════════════════════════════════════════════════════

describe('métricas operacionais', () => {
  const docs = new Map([['doc-1', doc()], ['doc-old', doc({ id: 'doc-old', superseded_by_document_id: 'doc-1' })]]);

  it('agrega o trabalho pendente da carteira', () => {
    const c = trusted([
      clause({ id: 'p1', review_status: 'draft', source_page: 1 }),
      clause({ id: 'v1', review_status: 'validated', clause_type: 'sla', source_page: 2 }),
      clause({ id: 'obs', source_document_id: 'doc-old', source_page: 3 }),
    ]);
    const cov = contractCoverage(c, [doc(), doc({ id: 'd2' })], [analysis({ status: 'failed' })]);
    const inbox = buildReviewInbox([c], docs, NOW);
    const m = clauseOpsMetrics([cov], inbox);

    expect(m.proposalsAwaitingReview).toBe(1);   // a obsoleta não conta como trabalho
    expect(m.staleProposals).toBe(1);
    expect(m.contractsWithIncompleteReview).toBe(1);
    expect(m.analysesFailed).toBe(1);
    expect(m.validatedClauses).toBe(1);
    expect(m.contractsWithValidatedCoverage).toBe(1);
    expect(m.documentsAwaitingAnalysis).toBe(2);
  });
});

describe('prontidão para comparação entre contratos', () => {
  const covWith = (id: string, categories: string[]) => {
    // O batch é indexado pelo id do contrato do DETALHE: sem trocar as duas
    // pontas, as cláusulas não chegam ao read model.
    const contract = { ...row, id } as ContractRow;
    const detail: ContractDetail = {
      ...base,
      contract,
      clauses: categories.map((cat, i) => clause({
        id: `${id}-${cat}`, contract_id: id, clause_type: cat,
        review_status: 'validated', source_page: i + 1,
      })),
    };
    return contractCoverage(
      buildTrustedContract(contract, relationsBatchFromDetail(detail), [PROJECT_CEMIG], NOW),
      [doc()], [],
    );
  };

  it('a resposta é DADO, não opinião — e hoje é não', () => {
    const r = benchmarkReadiness([covWith('c1', ['sla'])]);
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/ao menos 5 contratos/);
    expect(r.contractsWithData).toBe(1);
  });

  it('contratos suficientes mas sem massa por categoria ainda não basta', () => {
    const coverages = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id, i) => covWith(id, [CLAUSE_CATEGORIES[i]]));
    const r = benchmarkReadiness(coverages);
    // Cinco contratos, mas cada um com uma categoria diferente: o "padrão"
    // de cada categoria seria uma única observação.
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/Nenhuma categoria/);
  });

  it('fica pronto quando há massa em contratos e por categoria', () => {
    const coverages = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => covWith(id, ['sla', 'pagamento']));
    const r = benchmarkReadiness(coverages);
    expect(r.ready).toBe(true);
    expect([...r.categoriesReady].sort()).toEqual(['pagamento', 'sla']);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Reanálise segura
// ═══════════════════════════════════════════════════════════════════

describe('reanálise', () => {
  const extractor = read('src/lib/ai/contract-clause-extractor.ts');

  it('pula leitura idêntica em vez de duplicar', () => {
    expect(extractor).toContain('proposalFingerprint');
    expect(extractor).toContain('duplicateCount');
    // O índice único do banco é a rede, não o mecanismo: deixar o banco
    // recusar quebraria o lote inteiro e perderia as propostas novas.
    const migration = read('supabase/migrations/094_clause_analysis_lifecycle.sql');
    expect(migration).toContain('idx_contract_clauses_ai_fingerprint');
    expect(migration).toContain('UNIQUE INDEX');
  });

  it('marca a análise anterior como substituída sem tocar nas decisões humanas', () => {
    expect(extractor).toContain("status: 'superseded'");
    expect(extractor).toContain('superseded_by_analysis_id: analysis.id');
    expect(extractor).toMatch(/NÃO são tocadas/);
  });

  it('registra `running` ANTES da chamada e falha de forma visível', () => {
    expect(extractor).toContain("status: 'running'");
    expect(extractor).toContain('failAnalysis');
    expect(extractor).toContain("status: 'failed'");
    // Rede caída não pode deixar o documento eternamente "analisando".
    expect(extractor).toContain('Anthropic.APIError');
  });

  it('substituir documento encerra as propostas pendentes dele', () => {
    const service = read('src/lib/contracts/contract-service.ts');
    expect(service).toContain('supersedeContractDocument');
    expect(service).toContain("in('review_status', ['draft', 'in_review'])");
    // Validadas são afirmação humana e continuam sendo verdade histórica.
    expect(service).toMatch(/Cláusulas já VALIDADAS não são tocadas/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Sinais de atenção da operação de análise
// ═══════════════════════════════════════════════════════════════════

describe('sinais de atenção da análise documental', () => {
  const withAnalyses = (
    analyses: ContractAiAnalysisRow[],
    documents: ContractDocumentRow[] = [doc()],
  ) => {
    const detail: ContractDetail = {
      ...base,
      aiAnalyses: analyses,
      documents: documents as never,
    };
    return buildTrustedContract(row, relationsBatchFromDetail(detail), [PROJECT_CEMIG], NOW);
  };

  it('análise que falhou vira ATENÇÃO, com o motivo', () => {
    const items = attentionItems(withAnalyses([analysis({ status: 'failed', error_message: 'timeout na leitura' })]), NOW);
    const failed = items.find((i) => i.id === 'clause-analysis-failed');
    expect(failed?.severity).toBe('warning');
    expect(failed?.reason).toContain('timeout na leitura');
  });

  it('documento vigente nunca analisado é CONFIGURAÇÃO, não falha', () => {
    const items = attentionItems(withAnalyses([], [doc()]), NOW);
    const notAnalyzed = items.find((i) => i.id === 'documents-not-analyzed');
    expect(notAnalyzed?.severity).toBe('setup');
    // A frase que impede a leitura errada da ausência.
    expect(notAnalyzed?.reason).toMatch(/não significa ausência de cláusula/);
  });

  it('documento substituído não cobra análise', () => {
    const items = attentionItems(
      withAnalyses([], [doc({ superseded_by_document_id: 'doc-2' })]), NOW,
    );
    expect(items.find((i) => i.id === 'documents-not-analyzed')).toBeUndefined();
  });

  it('documento já analisado não cobra análise', () => {
    const items = attentionItems(
      withAnalyses([analysis({ document_id: 'doc-1', status: 'completed' })], [doc()]), NOW,
    );
    expect(items.find((i) => i.id === 'documents-not-analyzed')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Fixtures de E2E não podem colidir com o índice de idempotência
// ═══════════════════════════════════════════════════════════════════

describe('as fixtures de E2E respeitam a impressão digital', () => {
  it('cada proposta semeada tem página e trecho próprios', () => {
    /*
      O índice único de 094 trata mesma página + mesmo trecho como a MESMA
      leitura. O helper semeava sempre página 12 e o mesmo texto, e a segunda
      chamada quebrava — o índice pegou duplicata na minha própria fixture.
    */
    const spec = read('tests/contracts-module.spec.ts');
    expect(spec).toContain('seedCounter += 1');
    expect(spec).toContain('over.page ?? (10 + seedCounter)');
    expect(spec).not.toContain('over.page ?? 12');
  });
});

describe('a proveniência da análise é lida das COLUNAS, não do jsonb', () => {
  it('o E2E não volta a consultar extracted_data para modelo e versão', () => {
    // Migration 094 promoveu `model`/`extractor_version`/`document_id` a
    // colunas justamente porque dentro do jsonb não dá para consultar — e
    // numa análise que falhou o jsonb nem chega a receber esses campos.
    const spec = read('tests/contracts-module.spec.ts');
    expect(spec).not.toContain('extracted_data.model');
    expect(spec).not.toContain('extracted_data.version');
    expect(spec).toContain('record.model');
    expect(spec).toContain('record.extractor_version');
  });
});

describe('as fixtures de E2E não dependem da ordem dos documentos', () => {
  it('documentos são resolvidos por título, não por posição', () => {
    /*
      `order by created_at` da fixture devolve [Apólice, Contrato, Aditivo] —
      não a ordem do seed — e o cenário 8 ainda acrescenta um documento novo a
      cada execução. Fixar posição fazia o teste asseverar sobre o documento
      errado e falhar por motivo inexistente.
    */
    const spec = read('tests/contracts-module.spec.ts');
    expect(spec).toContain('documentByTitle');
    expect(spec).not.toContain('const [oldDoc, newDoc] = await documentIds()');
    expect(spec).not.toContain('async function documentIds');
  });
});
