/**
 * P2D — inteligência assistida de cláusulas.
 *
 * O foco destes testes é o PORTÃO DE EVIDÊNCIA. Extrair cláusula bem é
 * trabalho do modelo; garantir que nada sem lastro no documento vire registro
 * é trabalho do código, e é isso que se verifica aqui — sem rede, como todo o
 * resto da suíte.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertEvidence, countPdfPages } from '@/lib/ai/contract-clause-extractor';
import {
  CLAUSE_CATEGORIES, CLAUSE_CATEGORY_LABEL, isClauseCategory,
} from '@/lib/contracts/clause-categories';
import { CLAUSE_REVIEW_LABEL, PENDING_REVIEW } from '@/lib/contracts/contract-service';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/** Uma proposta bem-formada, para variar campo a campo. */
const proposal = (over: Record<string, unknown> = {}) => ({
  category: 'penalidade',
  title: 'Multa por atraso na entrega',
  summary: 'Multa de 2% sobre o valor da parcela por atraso superior a 5 dias.',
  source_page: 12,
  source_excerpt: 'A CONTRATADA sujeitar-se-á à multa de 2% (dois por cento) sobre o valor da parcela.',
  risk_level: 'high',
  confidence: 0.9,
  amount: null,
  percentage: 2,
  term_days: null,
  ...over,
});

// ═══════════════════════════════════════════════════════════════════
// Portão de evidência
// ═══════════════════════════════════════════════════════════════════

describe('assertEvidence', () => {
  it('aceita a proposta completa e normaliza o trecho', () => {
    const { accepted, rejected } = assertEvidence([proposal({ source_excerpt: '  trecho literal com tamanho suficiente  ' })], null);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].source_excerpt).toBe('trecho literal com tamanho suficiente');
  });

  it('DESCARTA proposta sem trecho de origem', () => {
    const { accepted, rejected } = assertEvidence([proposal({ source_excerpt: '' })], null);
    expect(accepted).toEqual([]);
    expect(rejected[0].reason).toMatch(/sem trecho/i);
  });

  it('DESCARTA trecho curto demais para conferir', () => {
    const { rejected } = assertEvidence([proposal({ source_excerpt: 'multa de 2%' })], null);
    expect(rejected[0].reason).toMatch(/curto demais/i);
  });

  it('DESCARTA proposta sem página', () => {
    for (const page of [null, undefined, 0, -1, 3.5, 'doze']) {
      const { accepted, rejected } = assertEvidence([proposal({ source_page: page })], null);
      expect(accepted, `página ${String(page)} deveria ser recusada`).toEqual([]);
      expect(rejected).toHaveLength(1);
    }
  });

  it('DESCARTA página além do documento — leitura fabricada', () => {
    const { accepted, rejected } = assertEvidence([proposal({ source_page: 99 })], 10);
    expect(accepted).toEqual([]);
    expect(rejected[0].reason).toMatch(/além do documento/i);
  });

  it('DESCARTA categoria fora do vocabulário', () => {
    const { rejected } = assertEvidence([proposal({ category: 'clausula_magica' })], null);
    expect(rejected[0].reason).toMatch(/vocabulário/i);
  });

  it('DESCARTA confiança fora de 0..1', () => {
    for (const c of [-0.1, 1.4, 'alta', null]) {
      const { accepted } = assertEvidence([proposal({ confidence: c })], null);
      expect(accepted, `confiança ${String(c)} deveria ser recusada`).toEqual([]);
    }
  });

  it('lista vazia é resultado legítimo — ausência de cláusula é informação', () => {
    const { accepted, rejected } = assertEvidence([], null);
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([]);
  });

  it('uma proposta ruim não contamina as boas', () => {
    const { accepted, rejected } = assertEvidence(
      [proposal(), proposal({ source_excerpt: '' }), proposal({ category: 'sla', title: 'SLA de disponibilidade' })],
      null,
    );
    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(1);
  });

  it('efeito contratual ausente vira null, nunca zero', () => {
    const { accepted } = assertEvidence([proposal({ amount: null, percentage: null, term_days: null })], null);
    expect(accepted[0].amount).toBeNull();
    expect(accepted[0].percentage).toBeNull();
    expect(accepted[0].term_days).toBeNull();
  });

  it('risco inválido cai no meio, não no extremo', () => {
    // Um default "low" faria cláusula mal lida parecer inofensiva.
    const { accepted } = assertEvidence([proposal({ risk_level: 'catastrofico' })], null);
    expect(accepted[0].risk_level).toBe('medium');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Contagem de páginas — o que faz o cerco de evidência fechar
// ═══════════════════════════════════════════════════════════════════

describe('countPdfPages', () => {
  const pdf = (body: string) => Buffer.from(`%PDF-1.7\n${body}\n%%EOF`, 'latin1');

  it('lê o /Count do dicionário /Pages', () => {
    expect(countPdfPages(pdf('1 0 obj << /Type /Pages /Kids [2 0 R] /Count 14 >> endobj'))).toBe(14);
  });

  it('lê também com as chaves em ordem inversa', () => {
    expect(countPdfPages(pdf('1 0 obj << /Count 7 /Type /Pages /Kids [2 0 R] >> endobj'))).toBe(7);
  });

  it('em árvore aninhada, vale o maior — o nó raiz', () => {
    expect(countPdfPages(pdf(
      '1 0 obj << /Type /Pages /Count 30 >> endobj 2 0 obj << /Type /Pages /Count 10 >> endobj',
    ))).toBe(30);
  });

  it('devolve null quando não consegue determinar — falha para o lado seguro', () => {
    // Contar para MENOS descartaria proposta legítima: pior que não checar.
    expect(countPdfPages(pdf('sem dicionario de paginas'))).toBeNull();
    expect(countPdfPages(Buffer.from(''))).toBeNull();
  });

  it('a contagem é de fato usada no gate', () => {
    const extractor = read('src/lib/ai/contract-clause-extractor.ts');
    // O parâmetro existia e recebia `null`: a checagem nunca disparava.
    expect(extractor).toContain('assertEvidence(parsed.clauses ?? [], countPdfPages(bytes))');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Categorias
// ═══════════════════════════════════════════════════════════════════

describe('vocabulário de categorias', () => {
  it('cobre as dez categorias exigidas', () => {
    expect([...CLAUSE_CATEGORIES].sort()).toEqual([
      'compliance', 'garantia', 'pagamento', 'penalidade', 'reajuste',
      'renovacao', 'rescisao', 'responsabilidade', 'seguro', 'sla',
    ]);
    for (const c of CLAUSE_CATEGORIES) expect(CLAUSE_CATEGORY_LABEL[c]).toBeTruthy();
  });

  it('o guard recusa o que não é categoria', () => {
    expect(isClauseCategory('sla')).toBe(true);
    expect(isClauseCategory('outra')).toBe(false);
    expect(isClauseCategory(null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Proposta nunca é verdade contratual
// ═══════════════════════════════════════════════════════════════════

describe('proposta nunca se apresenta como verdade contratual', () => {
  const extractor = read('src/lib/ai/contract-clause-extractor.ts');

  it('toda proposta persistida nasce marcada e pendente', () => {
    expect(extractor).toContain('ai_flagged: true');
    expect(extractor).toContain("review_status: 'draft'");
  });

  it('o texto original é congelado para comparação posterior', () => {
    expect(extractor).toContain('ai_proposed_title');
    expect(extractor).toContain('ai_proposed_content');
  });

  it('o prompt proíbe cláusula sem evidência e admite lista vazia', () => {
    expect(extractor).toMatch(/NÃO proponha a cláusula/);
    expect(extractor).toMatch(/lista vazia/);
    expect(extractor).toMatch(/cláusula inventada é um defeito grave/i);
  });

  it('o banco recusa proposta sem evidência, independentemente do código', () => {
    const migration = read('supabase/migrations/093_contract_clause_ai_provenance.sql');
    expect(migration).toContain('contract_clauses_ai_needs_evidence_check');
    expect(migration).toContain('ai_flagged = false');
    expect(migration).toContain('source_page IS NOT NULL');
  });

  it('o fluxo de revisão humana cobre as quatro decisões', () => {
    expect(Object.keys(CLAUSE_REVIEW_LABEL).sort())
      .toEqual(['draft', 'in_review', 'rejected', 'superseded', 'validated']);
    expect([...PENDING_REVIEW]).toEqual(['draft', 'in_review']);

    const service = read('src/lib/contracts/contract-service.ts');
    expect(service).toContain('supersedeContractClause');
    // Substituir preserva a original em vez de apagá-la.
    expect(service).toContain("review_status: 'superseded'");
    expect(service).toContain('superseded_by_clause_id: created.id');
  });

  it('cada passo do ciclo deixa trilha de auditoria', () => {
    const service = read('src/lib/contracts/contract-service.ts');
    for (const action of [
      'contract.clause_created', 'contract.clause_updated',
      'contract.clause_reviewed', 'contract.clause_superseded',
    ]) {
      expect(service, `sem auditoria de ${action}`).toContain(action);
    }
    const route = read('src/app/api/ai/clause-extraction/[contractId]/route.ts');
    expect(route).toContain('contract.clauses_extracted');
  });

  it('o documento não é truncado em silêncio', () => {
    // Um contrato cortado ao meio produz leitura parcial apresentada como completa.
    expect(extractor).toContain('MAX_PDF_BYTES');
    expect(extractor).toMatch(/excede o limite/);
    expect(extractor).not.toMatch(/\.slice\(0, *MAX_PDF_BYTES\)/);
  });
});
