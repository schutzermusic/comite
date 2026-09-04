/**
 * Fase 0 — proveniência, remoção da camada fictícia e fronteira oficial.
 *
 * Parte deste arquivo lê CÓDIGO-FONTE em vez de chamar funções, e isso é
 * deliberado: o que precisa ser travado aqui são decisões que vivem em pontos
 * de chamada dentro de componentes de página — "com que classificação um
 * contrato nasce", "esta aba ainda existe". Montar React só para reencontrar
 * uma constante literal testaria o renderizador, não a decisão.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_STATUS_VOCABULARY,
  isContractStatus,
  type ContractStatus,
} from '@/lib/contracts/contract-service';
import { live, officialByOrigin, isOfficialOrigin, hasOfficialValue } from '@/lib/contracts/trust/trusted';

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const listPage = src('src/app/(main)/contratos/page.tsx');
const detailPage = src('src/app/(main)/contratos/[id]/page.tsx');

// ═══════════════════════════════════════════════════════════════════════════
// 7 · o contrato nasce NÃO CLASSIFICADO
// ═══════════════════════════════════════════════════════════════════════════

describe('0.7 · proveniência na criação', () => {
  it('a criação pela interface passa `unclassified` — nunca `live`', () => {
    const call = listPage.slice(listPage.indexOf('const handleContractOnboarded'));
    const persist = call.slice(0, call.indexOf('});'));
    expect(persist).toContain("dataClass: 'unclassified'");
    expect(persist).not.toContain("dataClass: 'live'");
  });

  it('nenhum caminho da aplicação cria contrato já oficial', () => {
    for (const file of ['src/app/(main)/contratos/page.tsx', 'src/lib/contracts/contract-service.ts']) {
      // A DECLARAÇÃO de tipo (`dataClass: 'live' | 'demo' | 'unclassified'`)
      // continua existindo e deve continuar: o que não pode existir é um ponto
      // de chamada que passe `'live'` na criação.
      expect(src(file)).not.toMatch(/dataClass:\s*'live',/);
    }
  });

  it('`data_class` continua fora do update genérico: promover é ato à parte', () => {
    const service = src('src/lib/contracts/contract-service.ts');
    expect(service).toContain("Omit<CreateContractInput, 'file' | 'dataClass'>");
  });

  it('reclassificar exige justificativa, e sem ela nem tenta escrever', async () => {
    const { reclassifyContract } = await import('@/lib/contracts/contract-service');
    await expect(reclassifyContract('qualquer-id', 'live', '   ')).rejects.toThrow(/Justificativa/i);
  });

  it('a promoção a oficial TEM onde ser feita — senão a regra vira beco sem saída', () => {
    // Nascer `unclassified` só é defensável porque existe o ato que classifica.
    // Sem esta tela, nenhum contrato novo entraria jamais na carteira oficial.
    const ui = src('src/components/contracts/useContractProvenanceModal.tsx');
    expect(ui).toContain('reclassifyContract');
    expect(ui).toContain('Justificativa (obrigatória)');
    // Sem justificativa, o botão não submete.
    expect(ui).toContain('reason.trim().length > 0');
    // E não há valor padrão de justificativa: resposta pré-preenchida não é resposta.
    expect(ui).toContain("setReason('')");
    expect(detailPage).toContain('useContractProvenanceModal');
    expect(detailPage).toContain('Classificar origem');
  });

  it('classificar NÃO é a autoridade de quem cadastra', () => {
    // `juridico_contratos` tem `contracts.edit` e é quem cria. Se ele pudesse
    // classificar, a autocertificação corrigida em 0.7 voltaria por outra porta.
    const gate = detailPage.slice(detailPage.indexOf('const canClassifyProvenance'));
    const line = gate.slice(0, gate.indexOf(';') + 1);
    expect(line).toContain("hasPermission('contracts.delete')");
    expect(line).toContain("hasPermission('admin.manage_organization')");
    expect(line).not.toContain("contracts.edit");
  });

  it('a reclassificação deixa origem e destino na auditoria', () => {
    const service = src('src/lib/contracts/contract-service.ts');
    const fn = service.slice(service.indexOf('export async function reclassifyContract'));
    expect(fn).toContain("action: 'contract.reclassified'");
    expect(fn).toContain('from: before?.data_class ?? null');
    expect(fn).toContain('to: dataClass');
    expect(fn).toContain('reason');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10 · só `live` entra na carteira oficial
// ═══════════════════════════════════════════════════════════════════════════

describe('0.7 · fronteira da carteira oficial', () => {
  it('a origem oficial é uma lista de permissão, não de negação', () => {
    expect(isOfficialOrigin('live')).toBe(true);
    expect(isOfficialOrigin('demo')).toBe(false);
    expect(isOfficialOrigin('unclassified')).toBe(false);
  });

  it('contrato recém-criado (unclassified) NÃO entra em métrica oficial', () => {
    const value = officialByOrigin(live(42, 'contracts'), 'unclassified');
    expect(hasOfficialValue(value)).toBe(false);
    // E a razão é nomeada — não vira zero silencioso.
    expect(JSON.stringify(value)).toContain('unclassified');
  });

  it('demo tem razão própria, distinta de "não classificado"', () => {
    expect(JSON.stringify(officialByOrigin(live(42, 'contracts'), 'demo'))).toContain('demo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8 · a aba "Análise IA" não existe mais
// ═══════════════════════════════════════════════════════════════════════════

describe('0.6 · o workspace "Análise IA" foi removido', () => {
  it('sai do vocabulário de seções da carteira', () => {
    const type = listPage.slice(listPage.indexOf('type SectionId'), listPage.indexOf('type ViewMode'));
    expect(type).not.toMatch(/'ai'/);
    expect(listPage).not.toContain("ai: 'Análise IA'");
  });

  it('sai das abas do dossiê, inclusive da ordem de renderização', () => {
    const type = listPage ? detailPage.slice(detailPage.indexOf('type DetailTab')) : '';
    const decl = type.slice(0, type.indexOf('const riskLabels'));
    expect(decl).not.toMatch(/'ai'/);
  });

  it('os painéis de mock foram removidos, e com eles o botão sem ação', () => {
    expect(listPage).not.toContain('function AiAnalysisSection');
    expect(listPage).not.toContain('Iniciar análise mock');
    expect(detailPage).not.toContain('function AiTab');
    expect(detailPage).not.toContain('mock pendente');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 0.5 · a camada fictícia saiu — a real ficou inteira
// ═══════════════════════════════════════════════════════════════════════════

describe('0.5 · remoção da IA fictícia', () => {
  it('os módulos de mock não existem mais no repositório', () => {
    for (const dead of [
      'src/lib/services/contract-ai.ts',
      'src/lib/stores/contract-ai-store.tsx',
      'src/components/contracts/ContractBriefPanel.tsx',
      'src/components/contracts/ContractsByCompanyModule.tsx',
    ]) {
      expect(existsSync(new URL(`../../${dead}`, import.meta.url))).toBe(false);
    }
  });

  it('o provider de IA mock não é mais montado no layout', () => {
    expect(src('src/app/(main)/layout.tsx')).not.toContain('ContractAIProvider');
  });

  it('nenhuma confiança fabricada sobrevive', () => {
    const live = src('src/components/contracts/contract-governance-live.ts');
    const data = src('src/components/contracts/contract-governance-data.ts');
    expect(data).not.toMatch(/confidenceScore:\s*58 \+/);
    expect(live).not.toMatch(/function extractConfidence/);
    expect(live).not.toMatch(/function mapAiStatus/);
    // O vocabulário de mock não pode reaparecer em nenhum dos dois.
    for (const file of [live, data]) {
      expect(file).not.toMatch(/'mock_pending'|'mock_ready'/);
    }
  });

  it('o ator de auditoria inventado não é mais fabricado', () => {
    const data = src('src/components/contracts/contract-governance-data.ts');
    expect(data).not.toMatch(/actor:\s*'INSIGHT AI'/);
  });

  it('"sem análise" passa a ser a pergunta real ao banco', () => {
    expect(listPage).toContain('r.hasAiAnalysis === false');
    expect(listPage).not.toContain("r.aiStatus === 'mock_pending'");
  });

  it('9 · a capacidade REAL de extração permanece intacta', () => {
    const extractor = src('src/lib/ai/contract-clause-extractor.ts');
    // portão de evidência
    expect(extractor).toContain('function assertEvidence');
    expect(extractor).toContain('source_excerpt');
    expect(extractor).toContain('source_page');
    // idempotência por fingerprint
    expect(extractor).toContain('proposalFingerprint');
    // supersessão de análise
    expect(extractor).toContain("'superseded'");
    // e a rota que a aciona continua existindo
    expect(existsSync(new URL('../../src/app/api/ai/clause-extraction/[contractId]/route.ts', import.meta.url))).toBe(true);
    // o CHECK de evidência da 093 segue no lugar
    expect(src('supabase/migrations/093_contract_clause_ai_provenance.sql'))
      .toContain('contract_clauses_ai_needs_evidence_check');
    // e a unicidade de fingerprint da 094 também
    expect(src('supabase/migrations/094_clause_analysis_lifecycle.sql'))
      .toContain('idx_contract_clauses_ai_fingerprint');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 0.3 · auditoria
// ═══════════════════════════════════════════════════════════════════════════

describe('0.3 · integridade da auditoria', () => {
  it('existe um escritor de servidor, e ele preenche IP e user-agent', () => {
    const server = src('src/lib/audit/log-audit-event-server.ts');
    expect(server).toContain("from '@/utils/supabase/server'");
    expect(server).toContain('ip_address');
    expect(server).toContain('user_agent');
    expect(server).toContain('x-forwarded-for');
  });

  it('nenhum dos dois escritores engole o erro', () => {
    for (const file of ['src/lib/audit/log-audit-event.ts', 'src/lib/audit/log-audit-event-server.ts']) {
      const s = src(file);
      expect(s).toContain("reason: 'write-failed'");
      expect(s).toContain('error.message');
    }
  });

  it('5 · a rota de extração audita pelo servidor, não pelo cliente de navegador', () => {
    const route = src('src/app/api/ai/clause-extraction/[contractId]/route.ts');
    expect(route).toContain('logAuditEventServer');
    expect(route).toContain('req.headers');
    expect(route).not.toMatch(/from '@\/lib\/audit\/log-audit-event'/);
    expect(route).toContain("action: 'contract.clauses_extracted'");
    // e a resposta não afirma ter auditado quando não auditou
    expect(route).toContain('audited');
  });

  it('nenhuma segunda tabela de auditoria foi criada', () => {
    for (const f of ['099_tenant_isolation_reference_tables', '100_contract_approval_safety', '101_contract_status_vocabulary']) {
      expect(src(`supabase/migrations/${f}.sql`)).not.toMatch(/CREATE TABLE[\s\S]{0,60}audit/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 0.4 · vocabulário de status
// ═══════════════════════════════════════════════════════════════════════════

describe('0.4 · vocabulário canônico de status', () => {
  it('a união deixou de ser aberta', () => {
    const service = src('src/lib/contracts/contract-service.ts');
    const decl = service.slice(service.indexOf('export type ContractStatus'), service.indexOf('/** O vocabulário como valor'));
    expect(decl).not.toContain('| string');
  });

  it('contém o que a produção tem e o que a aplicação oferece', () => {
    // observados em produção no preflight
    for (const seen of ['negotiation', 'active']) expect(CONTRACT_STATUS_VOCABULARY).toContain(seen);
    // oferecidos no cadastro (CONTRACT_STATUSES de contract-upload.tsx)
    const upload = src('src/components/contracts/contract-upload.tsx');
    const block = upload.slice(upload.indexOf('const CONTRACT_STATUSES'), upload.indexOf('const DOCUMENT_TYPES'));
    for (const [, value] of block.matchAll(/value: '([a-z_]+)'/g)) {
      expect(CONTRACT_STATUS_VOCABULARY).toContain(value as ContractStatus);
    }
  });

  it('o guarda de tipo recusa o que está fora', () => {
    expect(isContractStatus('active')).toBe(true);
    expect(isContractStatus('negotiation')).toBe(true);
    expect(isContractStatus('em_negociacao')).toBe(false);
    expect(isContractStatus(null)).toBe(false);
  });

  it('nenhum status foi renomeado nesta fase', () => {
    // `negotiation` é o valor com mais linhas em produção: se ele sumisse do
    // vocabulário, a migration 101 abortaria — e este teste diz por quê.
    expect(CONTRACT_STATUS_VOCABULARY).toContain('negotiation');
    expect(CONTRACT_STATUS_VOCABULARY).toContain('legal_review');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 0.2 · espelho de UX da regra de aprovação
// ═══════════════════════════════════════════════════════════════════════════

describe('0.2 · a interface deixou de oferecer o que a RLS nega', () => {
  it('`contracts.edit` não habilita mais a ação de aprovar', () => {
    expect(listPage).toContain("approve: hasPermission('contracts.approve'),");
    expect(listPage).not.toMatch(/approve:\s*hasPermission\('contracts\.approve'\)\s*\|\|\s*hasPermission\('contracts\.edit'\)/);
  });
});
