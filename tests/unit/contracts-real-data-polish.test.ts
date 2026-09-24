/**
 * Os defeitos que a primeira caminhada por um contrato REAL (JA10182283)
 * expôs — e que nenhum deles é de domínio: são de apresentação, de read model
 * e de navegação.
 *
 * Cada bloco fixa a regra, não a tela: o que não pode voltar a acontecer é a
 * carteira afirmar algo falso sobre o contrato — que falta responsável quando
 * ele está registrado, que o valor é R$ 8.032.340 quando o documento diz
 * R$ 8.032.339,76, que uma pessoa cadastrou à mão o que o Apex leu do
 * documento, ou que a leitura falhou quando ela já foi refeita com sucesso.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import { buildTrustedContract } from '@/lib/contracts/trust/read-model';
import {
  buildOnboardingReadiness, identityGaps, hasInternalResponsible, responsibleLabel,
} from '@/lib/contracts/trust/onboarding';
import { attentionItems } from '@/lib/contracts/trust/attention';
import { documentAnalysisStates } from '@/lib/contracts/trust/clause-operations';
import {
  ANALYSIS_FAILURE_MESSAGE, FORBIDDEN_UI_TERMS, safeAnalysisFailureMessage,
} from '@/lib/contracts/trust/analysis-errors';
import { formatContractCurrency, officialCurrencyFull } from '@/lib/contracts/trust/format';
import { contractRiskLabel, CONTRACT_RISK_LABELS } from '@/lib/contracts/risk-labels';
import {
  clauseListProvenanceSubtitle, clauseProvenance, clauseProvenanceLabel,
} from '@/lib/contracts/clause-provenance';
import { live } from '@/lib/contracts/trust/trusted';
import type {
  ContractAiAnalysisRow, ContractClauseRow, ContractDocumentRow,
  ContractRelationsBatch, ContractRow,
} from '@/lib/contracts/contract-service';
import { PROJECT_CEMIG, FIXED_NOW } from './fixtures/contract-fixtures';

const source = (path: string) => readFileSync(path, 'utf8');

// ── fixtures mínimas ───────────────────────────────────────────────────────

const noErrors = () => ({
  obligations: null, billing: null, documents: null,
  approvals: null, projectLinks: null, risks: null, ai: null,
  milestones: null, clauses: null, penalties: null, obligationDefinitions: null,
});

function batch(overrides: Partial<ContractRelationsBatch> = {}): ContractRelationsBatch {
  return {
    obligations: new Map(), billingEvents: new Map(), documents: new Map(),
    approvals: new Map(), projectLinks: new Map(), riskLinks: new Map(),
    aiAnalyses: new Map(), milestones: new Map(), clauses: new Map(),
    penalties: new Map(), obligationDefinitions: new Map(), riskDetails: new Map(),
    sectionsWithData: {
      obligations: false, billing: false, documents: false,
      approvals: false, projectLinks: false, risks: false, ai: false,
    },
    sectionErrors: noErrors(),
    ...overrides,
  } as ContractRelationsBatch;
}

/** O contrato real, no que importa aqui: valor com centavos e Pessoa responsável. */
const contractRow = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: 'ctr-ja', organization_id: 'org-1', project_id: 'proj-cemig-01',
  title: 'Contrato JA10182283', contract_number: 'JA10182283',
  counterparty_name: 'Contraparte', contract_type: 'Prestação de serviços',
  status: 'active', lifecycle_stage: null,
  start_date: '2025-01-01', end_date: '2027-12-31',
  signed_date: '2025-01-01', renewal_date: null,
  currency: 'BRL', total_value: 8_032_339.76, monthly_value: null,
  payment_terms: null, scope_summary: null, risk_level: 'medium',
  health_score: null,
  owner_user_id: null, owner_person_id: 'psn-amanda',
  created_by: 'u-1', updated_by: 'u-1',
  created_at: '2025-01-02T09:00:00Z', updated_at: '2025-01-02T09:00:00Z',
  deleted_at: null, data_class: 'live',
  ...over,
} as ContractRow);

const AMANDA = new Map([['psn-amanda', { id: 'psn-amanda', full_name: 'AMANDA SANTOS', status: 'active' }]]);

const trusted = (row: Partial<ContractRow> = {}, over: Partial<ContractRelationsBatch> = {}) =>
  buildTrustedContract(
    contractRow(row),
    batch({ ownerPeople: AMANDA, ...over } as Partial<ContractRelationsBatch>),
    [PROJECT_CEMIG],
    FIXED_NOW,
  );

const clause = (over: Partial<ContractClauseRow> = {}): ContractClauseRow => ({
  id: 'cl-1', organization_id: 'org-1', contract_id: 'ctr-ja',
  clause_type: 'pagamento', title: 'Valor Total do Contrato', content: null,
  risk_level: 'medium', ai_flagged: false,
  source_document_id: 'doc-1', source_page: 3, source_excerpt: null,
  amount: 8_032_339.76, percentage: null, term_days: null,
  review_status: 'draft', reviewed_by: null, reviewed_at: null,
  ai_confidence: null, ai_model: null, ai_analysis_id: null, ai_proposed_at: null,
  ai_proposed_title: null, ai_proposed_content: null, superseded_by_clause_id: null,
  created_by: 'u-1', updated_by: 'u-1',
  created_at: '2025-01-02T09:00:00Z', updated_at: '2025-01-02T09:00:00Z',
  interpretation_state: null, attention_reasons: null, attention_exposure: null,
  attention_resolved_at: null, attention_resolved_by: null,
  attention_resolution_note: null, attention_policy_version: null,
  ...over,
} as ContractClauseRow);

const doc = (over: Partial<ContractDocumentRow> = {}): ContractDocumentRow => ({
  id: 'doc-1', organization_id: 'org-1', contract_id: 'ctr-ja',
  title: 'Contrato assinado', version: 1, superseded_by_document_id: null,
  ...over,
} as ContractDocumentRow);

const analysis = (over: Partial<ContractAiAnalysisRow> = {}): ContractAiAnalysisRow => ({
  id: 'an-1', organization_id: 'org-1', contract_id: 'ctr-ja',
  status: 'completed', summary: null, risk_summary: null,
  extracted_data: {}, findings: [], created_by: 'u-1',
  created_at: '2025-01-02T09:00:00Z', completed_at: '2025-01-02T09:05:00Z',
  document_id: 'doc-1', started_at: null, error_message: null,
  model: null, extractor_version: null, superseded_by_analysis_id: null,
  ...over,
} as ContractAiAnalysisRow);

// ═══════════════════════════════════════════════════════════════════════════
// 1 · Navegação de Projetos
// ═══════════════════════════════════════════════════════════════════════════

describe('navegação — o módulo Projetos abre ao ser clicado', () => {
  const sidebar = source('src/components/layout/app-sidebar.tsx');

  it('a landing canônica de Projetos é /projetos e ela existe como rota', () => {
    // Projetos mora DENTRO de Operações (230): o destino continua sendo a
    // mesma rota, declarado uma vez em `lib/operations/navigation.ts`.
    const nav = source('src/lib/operations/navigation.ts');
    expect(nav).toMatch(/id:\s*'projects',\s*label:\s*'Projetos',\s*href:\s*'\/projetos'/);
    expect(() => source('src/app/(main)/projetos/page.tsx')).not.toThrow();
    expect(sidebar).toContain('subItems: OPERATIONS_NAV.map((item) => ({');
  });

  it('o rótulo do módulo é um LINK, não um botão que só expande', () => {
    // A regressão original: a linha inteira era `onClick={onToggle}` e clicar
    // em "Projetos" não navegava a lugar nenhum.
    expect(sidebar).toContain('<Link href={item.href} data-nav-parent={item.href}>');
    expect(sidebar).not.toMatch(/<SidebarMenuButton\s+type="button"\s+onClick=\{onToggle\}/);
  });

  it('expandir e navegar são alvos IRMÃOS — um não engole o outro', () => {
    // A seta é um elemento à parte, fora do link: sem aninhamento não há
    // propagação de clique entre as duas ações.
    const action = sidebar.slice(sidebar.indexOf('<SidebarMenuAction'));
    expect(action).toContain('onClick={onToggle}');
    expect(action).toContain('aria-expanded={isOpen}');
    const linkBlock = sidebar.slice(
      sidebar.indexOf('<Link href={item.href} data-nav-parent'),
      sidebar.indexOf('</SidebarMenuButton>', sidebar.indexOf('data-nav-parent')),
    );
    expect(linkBlock).not.toContain('onToggle');
    expect(linkBlock).not.toContain('ChevronDown');
  });

  it('o alvo da seta tem espaço próprio, e o recuo do dossiê continua valendo', () => {
    const css = source('src/app/globals.css');
    expect(css).toContain('.hud-nav-chevron-action');
    expect(css).toMatch(/\.hud-nav-item-parent\s*\{[^}]*padding-right:/);
    expect(css).toContain('.hud-nav-submenu-receded');
  });

  it('nenhuma permissão bloqueia Projetos além da já declarada', () => {
    // Quem vê projetos continua vendo Projetos sem precisar de `operations.view`.
    const nav = source('src/lib/operations/navigation.ts');
    expect(nav).toMatch(/href:\s*'\/projetos',\s*anyPermission:\s*\['projects\.view', 'projects\.view_all'\]/);
    expect(sidebar).toContain('anyPermission: OPERATIONS_GROUP_PERMISSIONS');
  });

  it('o projeto vinculado do dossiê abre o projeto canônico', () => {
    const dossier = source('src/app/(main)/contratos/[id]/page.tsx');
    expect(dossier).toContain('href={`/projetos/${trusted.project.value.id}`}');
    expect(() => source('src/app/(main)/projetos/[id]/page.tsx')).not.toThrow();
    // O vínculo vem da leitura, nunca de auto-match por nome.
    const contract = trusted();
    expect(contract.project).toMatchObject({ trust: 'live' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2 · Responsável pelo contrato
// ═══════════════════════════════════════════════════════════════════════════

describe('responsável pelo contrato — a Pessoa é a identidade de negócio', () => {
  it('owner_person_id válido basta: a prontidão diz REGISTRADO', () => {
    const contract = trusted();
    expect(hasInternalResponsible(contract)).toBe(true);
    expect(identityGaps(contract).map((g) => g.label)).not.toContain('Responsável pelo contrato');

    const readiness = buildOnboardingReadiness(contract);
    const identity = readiness.steps.find((s) => s.key === 'identity');
    expect(identity?.state).toBe('complete');
    expect(identity?.detail).not.toContain('Falta registrar');
  });

  it('o nome canônico da Pessoa aparece, em vez do campo ser tratado como ausente', () => {
    const contract = trusted();
    expect(responsibleLabel(contract)).toBe('AMANDA SANTOS');
    expect(buildOnboardingReadiness(contract).steps.find((s) => s.key === 'identity')?.detail)
      .toContain('AMANDA SANTOS');
  });

  it('owner_person_id NÃO exige owner_user_id', () => {
    const contract = trusted({ owner_user_id: null });
    expect(contract.ownerUserId).toMatchObject({ trust: 'missing' });
    expect(hasInternalResponsible(contract)).toBe(true);
    expect(buildOnboardingReadiness(contract).steps.find((s) => s.key === 'identity')?.state)
      .toBe('complete');
  });

  it('contrato legado com apenas owner_user_id continua compatível', () => {
    const contract = trusted({ owner_person_id: null, owner_user_id: 'u-legado' });
    expect(hasInternalResponsible(contract)).toBe(true);
    expect(identityGaps(contract).map((g) => g.label)).not.toContain('Responsável pelo contrato');
    // Sem Pessoa não há nome de negócio a exibir — e nada é inventado.
    expect(responsibleLabel(contract)).toBe('Responsável registrado');
  });

  it('sem nenhum dos dois, a lacuna continua sendo relatada', () => {
    const contract = trusted({ owner_person_id: null, owner_user_id: null });
    expect(hasInternalResponsible(contract)).toBe(false);
    expect(identityGaps(contract).map((g) => g.label)).toContain('Responsável pelo contrato');
    expect(responsibleLabel(contract)).toBeNull();
  });

  it('a Pessoa não é copiada para o caminho de usuário autenticado', () => {
    const contract = trusted();
    expect(contract.ownerUserId).toMatchObject({ trust: 'missing' });
    expect(contract.ownerPersonId).toMatchObject({ trust: 'live', value: 'psn-amanda' });
    // Nome lido de `people`, e o selo de proveniência diz isso.
    expect(contract.ownerPersonName).toMatchObject({ trust: 'live', source: 'people' });
  });

  it('nome não resolvido nesta leitura não rebaixa o vínculo', () => {
    const contract = trusted({}, { ownerPeople: new Map() } as Partial<ContractRelationsBatch>);
    expect(hasInternalResponsible(contract)).toBe(true);
    expect(responsibleLabel(contract)).toBe('Pessoa responsável registrada');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3 · Rótulo de risco em PT-BR
// ═══════════════════════════════════════════════════════════════════════════

describe('risco — a carteira não fala o enum do banco', () => {
  it('traduz os três níveis', () => {
    expect(contractRiskLabel('low')).toBe('Baixo');
    expect(contractRiskLabel('medium')).toBe('Médio');
    expect(contractRiskLabel('high')).toBe('Alto');
    expect(CONTRACT_RISK_LABELS).toEqual({ low: 'Baixo', medium: 'Médio', high: 'Alto' });
  });

  it('não classifica: valor desconhecido volta como veio', () => {
    expect(contractRiskLabel('critical')).toBe('critical');
    expect(contractRiskLabel(null)).toBe('');
  });

  it('um formatador só — a Inteligência Contratual usa ele, não substituição inline', () => {
    const panel = source('src/components/contracts/intelligence/ClauseRiskIntelligencePanel.tsx');
    expect(panel).toContain("from '@/lib/contracts/risk-labels'");
    expect(panel).toContain('risco {contractRiskLabel(clause.risk_level)}');
    expect(panel).not.toContain('risco {clause.risk_level}');
  });

  it('o valor persistido não muda', () => {
    expect(trusted({ risk_level: 'high' }).riskLevel).toBe('high');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4 · Dinheiro exato nas superfícies detalhadas
// ═══════════════════════════════════════════════════════════════════════════

describe('valor — o detalhe documental mostra os centavos', () => {
  const EXACT = 'R$ 8.032.339,76';
  const norm = (s: string) => s.replace(/ /g, ' ');

  it('8032339.76 vira R$ 8.032.339,76 e nunca R$ 8.032.340', () => {
    expect(norm(formatContractCurrency(8_032_339.76))).toBe(EXACT);
    expect(norm(formatContractCurrency(8_032_339.76))).not.toContain('8.032.340');
  });

  it('o valor por extenso do dossiê é exato', () => {
    expect(norm(officialCurrencyFull(live(8_032_339.76, 'contracts')))).toBe(EXACT);
    expect(norm(officialCurrencyFull(trusted().totalValue))).toBe(EXACT);
  });

  it('aceita string numérica e não afirma nada sobre ausência', () => {
    expect(norm(formatContractCurrency('8032339.76'))).toBe(EXACT);
    expect(formatContractCurrency(null)).toBe('');
    expect(formatContractCurrency('')).toBe('');
  });

  it('o número subjacente permanece intacto', () => {
    expect(trusted().totalValue).toMatchObject({ value: 8_032_339.76 });
  });

  it('as telas detalhadas não têm mais formatador arredondado próprio', () => {
    for (const file of [
      'src/components/contracts/intelligence/ClauseRiskIntelligencePanel.tsx',
      'src/components/contracts/intelligence/ContractInterpretationPanel.tsx',
      'src/components/contracts/intelligence/ContractIntelligenceTab.tsx',
      'src/components/contracts/intelligence/ContractInstrumentsPanel.tsx',
      'src/components/contracts/measurement/MilestoneCard.tsx',
      'src/components/contracts/measurement/MilestoneBoard.tsx',
      'src/components/contracts/billing/ExposureRail.tsx',
    ]) {
      const text = source(file);
      expect(text, file).toContain('formatContractCurrency');
      expect(text, file).not.toMatch(/currency:\s*'BRL',\s*maximumFractionDigits:\s*0/);
    }
  });

  it('o KPI executivo compacto continua compacto — de propósito', () => {
    const format = source('src/lib/contracts/trust/format.ts');
    expect(format).toContain("notation: 'compact'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5 · Proveniência da cláusula
// ═══════════════════════════════════════════════════════════════════════════

describe('proveniência — quem estruturou a cláusula', () => {
  it('cláusula lida pelo Apex NÃO é registro manual', () => {
    const apex = clause({ ai_flagged: true });
    expect(clauseProvenance(apex)).toBe('apex');
    expect(clauseProvenanceLabel(apex)).toBe('Estruturado pelo Apex · origem documental');
    expect(clauseProvenanceLabel(apex)).not.toContain('Registro manual');
  });

  it('qualquer sinal de linhagem automática basta', () => {
    expect(clauseProvenance(clause({ ai_analysis_id: 'an-1' }))).toBe('apex');
    expect(clauseProvenance(clause({ ai_proposed_at: '2025-01-02T09:00:00Z' }))).toBe('apex');
    expect(clauseProvenance(clause({ interpretation_state: 'requires_attention' }))).toBe('apex');
  });

  it('registro genuinamente manual continua manual', () => {
    const manual = clause();
    expect(clauseProvenance(manual)).toBe('manual');
    expect(clauseProvenanceLabel(manual)).toBe('Registro manual estruturado');
  });

  it('o subtítulo do painel não generaliza sobre uma lista mista', () => {
    expect(clauseListProvenanceSubtitle([clause({ ai_flagged: true })]))
      .toContain('estruturada pelo Apex');
    expect(clauseListProvenanceSubtitle([clause()])).toContain('Registro manual estruturado');
    const mixed = clauseListProvenanceSubtitle([clause({ ai_flagged: true }), clause()]);
    expect(mixed).toContain('Apex');
    expect(mixed).toContain('manual');
  });

  it('o painel deixou de afirmar autoria manual sobre tudo', () => {
    const panel = source('src/components/contracts/intelligence/ClauseRiskIntelligencePanel.tsx');
    expect(panel).toContain('subtitle={clauseListProvenanceSubtitle(intelligence.clauses)}');
    expect(panel).not.toContain('subtitle="Registro manual estruturado');
    expect(panel).toContain('clauseProvenanceLabel(clause)');
  });

  it('o vocabulário de produto é Apex — provedor e modelo não aparecem', () => {
    const rendered = [
      clauseProvenanceLabel(clause({ ai_flagged: true })),
      clauseProvenanceLabel(clause()),
      clauseListProvenanceSubtitle([clause({ ai_flagged: true })]),
      clauseListProvenanceSubtitle([clause()]),
      clauseListProvenanceSubtitle([clause({ ai_flagged: true }), clause()]),
    ].join(' | ').toLowerCase();
    for (const term of FORBIDDEN_UI_TERMS) expect(rendered, term).not.toContain(term);
    expect(rendered).toContain('apex');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6 · O erro técnico não chega à interface
// ═══════════════════════════════════════════════════════════════════════════

const PROVIDER_ERROR =
  'Streaming is required for operations that may take longer than 10 minutes. '
  + 'See https://github.com/anthropics/anthropic-sdk-typescript#long-requests '
  + 'for more details (src/client.ts)';

describe('falha de leitura — mensagem de negócio, diagnóstico preservado', () => {
  it('o texto do provedor nunca vira a mensagem exibida', () => {
    const safe = safeAnalysisFailureMessage(PROVIDER_ERROR, { withRetry: true });
    expect(safe).toBe('A leitura do documento não foi concluída. Tente novamente.');
    const lowered = (safe ?? '').toLowerCase();
    for (const term of FORBIDDEN_UI_TERMS) expect(lowered, term).not.toContain(term);
  });

  it('sem erro não há mensagem — ausência não vira falha', () => {
    expect(safeAnalysisFailureMessage(null)).toBeNull();
    expect(safeAnalysisFailureMessage('   ')).toBeNull();
  });

  it('o estado do documento apresenta o seguro e guarda o cru', () => {
    const [state] = documentAnalysisStates(
      [doc()],
      [analysis({ status: 'failed', error_message: PROVIDER_ERROR, completed_at: null })],
      [],
    );
    expect(state.lifecycle).toBe('failed');
    expect(state.errorMessage).toContain(ANALYSIS_FAILURE_MESSAGE);
    expect(state.errorMessage).not.toContain('Streaming');
    // O diagnóstico segue inteiro: sanitizar a tela não custa informação.
    expect(state.errorDiagnostic).toBe(PROVIDER_ERROR);
  });

  it('uma releitura bem-sucedida encerra a falha anterior', () => {
    const [state] = documentAnalysisStates(
      [doc()],
      [
        analysis({
          id: 'an-fail', status: 'failed', error_message: PROVIDER_ERROR,
          created_at: '2025-01-02T09:00:00Z', completed_at: '2025-01-02T09:01:00Z',
        }),
        analysis({
          id: 'an-ok', status: 'completed',
          created_at: '2025-01-02T10:00:00Z', completed_at: '2025-01-02T10:07:00Z',
        }),
      ],
      [],
    );
    expect(state.lifecycle).not.toBe('failed');
    expect(state.errorMessage).toBeNull();
  });

  it('a atenção da carteira não ecoa o erro nem revive falha já superada', () => {
    const failedOnly = buildTrustedContract(
      contractRow(),
      batch({
        ownerPeople: AMANDA,
        documents: new Map([['ctr-ja', [doc()]]]),
        aiAnalyses: new Map([['ctr-ja', [analysis({ status: 'failed', error_message: PROVIDER_ERROR, completed_at: null })]]]),
      } as Partial<ContractRelationsBatch>),
      [PROJECT_CEMIG],
      FIXED_NOW,
    );
    const item = attentionItems(failedOnly, FIXED_NOW).find((i) => i.id === 'clause-analysis-failed');
    expect(item?.reason).toContain(ANALYSIS_FAILURE_MESSAGE);
    expect(item?.reason).not.toContain('Streaming');
    expect(item?.reason).not.toContain('anthropic');

    const retried = buildTrustedContract(
      contractRow(),
      batch({
        ownerPeople: AMANDA,
        documents: new Map([['ctr-ja', [doc()]]]),
        aiAnalyses: new Map([['ctr-ja', [
          analysis({ id: 'an-fail', status: 'failed', error_message: PROVIDER_ERROR, created_at: '2025-01-02T09:00:00Z', completed_at: '2025-01-02T09:01:00Z' }),
          analysis({ id: 'an-ok', status: 'completed', created_at: '2025-01-02T10:00:00Z', completed_at: '2025-01-02T10:07:00Z' }),
        ]]]),
      } as Partial<ContractRelationsBatch>),
      [PROJECT_CEMIG],
      FIXED_NOW,
    );
    expect(attentionItems(retried, FIXED_NOW).find((i) => i.id === 'clause-analysis-failed')).toBeUndefined();
  });

  it('a tela não renderiza o diagnóstico — nem no title do elemento', () => {
    const panel = source('src/components/contracts/intelligence/ClauseOpsPanel.tsx');
    expect(panel).toContain('{state.errorMessage}');
    expect(panel).not.toContain('title={state.errorMessage}');
    expect(panel).not.toContain('{state.errorDiagnostic}');
    expect(panel).not.toContain('title={state.errorDiagnostic}');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7-8 · O que este patch NÃO fez
// ═══════════════════════════════════════════════════════════════════════════

describe('fronteiras preservadas', () => {
  it('nenhuma migration foi adicionada', () => {
    const { readdirSync, readFileSync: read } = require('node:fs') as typeof import('node:fs');
    /*
      A intenção aqui é "ESTA fase não criou migration", e fixar a PONTA global
      só exprimia isso enquanto esta fase fosse a mais nova — qualquer migration
      posterior, de qualquer outro assunto, quebrava um teste que não fala sobre
      ela. O que se afirma agora é o que de fato importa: nenhuma migration
      acima da 167 toca as tabelas desta fase.
    */
    const later = readdirSync('supabase/migrations')
      .filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 167);
    for (const file of later) {
      const sql = read(`supabase/migrations/${file}`, 'utf8');
      // Mencionar a tabela não é mexer nela — uma migration pode declarar por
      // escrito que PRESERVA as cláusulas. O que não pode é alterá-las.
      expect(sql).not.toMatch(/(ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM)\s+(public\.)?contract_clauses\b/i);
      expect(sql).not.toContain('attention_policy');
    }
  });

  it('a política de atenção humana não foi tocada', () => {
    const policy = source('src/lib/contracts/intelligence/attention-policy.ts');
    expect(policy).not.toContain('formatContractCurrency');
    expect(policy).not.toContain('clauseProvenance');
  });

  it('nada aqui materializa fato de domínio novo', () => {
    for (const file of [
      'src/lib/contracts/clause-provenance.ts',
      'src/lib/contracts/risk-labels.ts',
      'src/lib/contracts/trust/analysis-errors.ts',
    ]) {
      const text = source(file);
      expect(text, file).not.toMatch(/INSERT INTO|\.insert\(|\.upsert\(|\.update\(/);
    }
  });
});
