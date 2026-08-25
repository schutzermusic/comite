/**
 * Cadeia confiável: relações → proveniência → agregação.
 *
 * Prova que o read model produz APENAS o que as linhas reais sustentam, e que
 * os três casos que o sistema antes confundia — vazio, erro e sintético — agora
 * produzem resultados distintos e corretos.
 */

import { describe, it, expect } from 'vitest';
import { buildTrustedContract, buildTrustedPortfolio } from '@/lib/contracts/trust/read-model';
import { computeTrustedPortfolioStats } from '@/lib/contracts/trust/portfolio';
import {
  hasOfficialValue, isMissing, isError, isDerived, isLive, formatOfficial,
} from '@/lib/contracts/trust/trusted';
import type { ContractRelationsBatch, ContractRow } from '@/lib/contracts/contract-service';
import { PROJECT_CEMIG, FIXED_NOW } from './fixtures/contract-fixtures';

// ── helpers de batch ───────────────────────────────────────────────────────

const noErrors = () => ({
  obligations: null, billing: null, documents: null,
  approvals: null, projectLinks: null, risks: null, ai: null,
  milestones: null, clauses: null, penalties: null,
});

function emptyBatch(overrides: Partial<ContractRelationsBatch> = {}): ContractRelationsBatch {
  return {
    obligations: new Map(), billingEvents: new Map(), documents: new Map(),
    approvals: new Map(), projectLinks: new Map(), riskLinks: new Map(),
    aiAnalyses: new Map(), milestones: new Map(), clauses: new Map(), penalties: new Map(), riskDetails: new Map(),
    sectionsWithData: {
      obligations: false, billing: false, documents: false,
      approvals: false, projectLinks: false, risks: false, ai: false,
    },
    sectionErrors: noErrors(),
    ...overrides,
  } as ContractRelationsBatch;
}

const contractRow = (over: Partial<ContractRow> = {}): ContractRow => ({
  id: 'ctr-1', organization_id: 'org-1', project_id: null,
  client_id: null, supplier_id: null,
  title: 'Contrato de Serviços QA', contract_number: 'CTR-42ACE9',
  counterparty_name: 'QA Contract Services', contract_type: 'Ordem de serviço',
  status: 'active', lifecycle_stage: null,
  start_date: '2026-05-13', end_date: '2027-05-13',
  signed_date: '2026-05-13', renewal_date: null,
  currency: 'BRL', total_value: 1_200_000, monthly_value: null,
  payment_terms: null, scope_summary: null, risk_level: 'high',
  health_score: null, owner_user_id: 'u-1',
  created_by: 'u-1', updated_by: 'u-1',
  created_at: '2026-05-14T09:00:00Z', updated_at: '2026-05-14T09:00:00Z',
  deleted_at: null,
  // Estes testes medem a QUALIDADE DA MEDIÇÃO, não a origem da linha. As
  // fixtures são `live` para que a fronteira de origem (migration 091) não
  // mascare o que está sendo verificado aqui; a exclusão por origem tem suíte
  // própria em contract-data-class.test.ts.
  data_class: 'live',
  ...over,
} as ContractRow);

const billing = (id: string, amount: number, paid: boolean) => ({
  id, contract_id: 'ctr-1', milestone_id: null, title: `Evento ${id}`,
  amount, due_date: '2026-06-01', paid_at: paid ? '2026-06-02' : null,
  status: paid ? 'pago' : 'pendente',
} as never);

// ═══════════════════════════════════════════════════════════════════
// Sem linha nenhuma
// ═══════════════════════════════════════════════════════════════════

describe('contrato sem relações registradas', () => {
  const c = () => buildTrustedContract(contractRow(), emptyBatch(), [PROJECT_CEMIG], FIXED_NOW);

  it('valor total É apurado — vem da coluna', () => {
    const t = c().totalValue;
    expect(isLive(t)).toBe(true);
    if (hasOfficialValue(t)) expect(t.value).toBe(1_200_000);
  });

  it('faturado é "não apurado" — NUNCA R$ 0', () => {
    // A regra central: ausência de evento registrado não significa nada faturado.
    const t = c().billedValue;
    expect(isMissing(t)).toBe(true);
    expect('value' in t).toBe(false);
    expect(formatOfficial(t, (v) => `R$ ${v}`)).toBe('Não apurado');
    if (isMissing(t)) expect(t.note).toContain('nenhum evento de faturamento');
  });

  it('saldo também não é apurado, por falta de uma das pontas', () => {
    const t = c().remainingValue;
    expect(isMissing(t)).toBe(true);
    if (isMissing(t)) expect(t.reason).toBe('not-comparable');
  });

  it('contagens operacionais SÃO apuradas em zero — consulta rodou, não há linha', () => {
    // Distinção deliberada: "0 obrigações atrasadas" é conhecimento;
    // "R$ 0 faturado" não seria.
    const t = c().overdueObligations;
    expect(isDerived(t)).toBe(true);
    if (hasOfficialValue(t)) expect(t.value).toBe(0);
  });

  it('projeto ausente é declarado, não inventado', () => {
    const t = c().project;
    expect(isMissing(t)).toBe(true);
    if (isMissing(t)) expect(t.note).toContain('sem vínculo de projeto');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Com linhas reais
// ═══════════════════════════════════════════════════════════════════

describe('contrato com faturamento real', () => {
  const batch = () => emptyBatch({
    billingEvents: new Map([['ctr-1', [
      billing('b1', 120_000, true),
      billing('b2', 480_000, false),
      billing('b3', 600_000, false),
    ]]]),
  });

  it('faturado é derivado da soma dos eventos realizados, com proveniência', () => {
    const t = buildTrustedContract(contractRow(), batch(), [], FIXED_NOW).billedValue;
    expect(isDerived(t)).toBe(true);
    if (isDerived(t)) {
      expect(t.value).toBe(120_000);
      expect(t.derivation.from).toEqual(['contract_billing_events']);
      expect(t.derivation.rule).toContain('realizados');
    }
  });

  it('saldo é derivado das duas pontas apuradas', () => {
    const t = buildTrustedContract(contractRow(), batch(), [], FIXED_NOW).remainingValue;
    expect(isDerived(t)).toBe(true);
    if (isDerived(t)) expect(t.value).toBe(1_080_000);
  });

  it('eventos registrados sem nenhum realizado É um zero APURADO, não ausência', () => {
    // A distinção que o read model precisa acertar: aqui sabemos que nada foi
    // pago. Isso é conhecimento — diferente de não haver evento nenhum, que é
    // ignorância. As duas coisas pareciam iguais na tela antiga.
    const semRealizado = emptyBatch({
      billingEvents: new Map([['ctr-1', [billing('b1', 500_000, false)]]]),
    });
    const t = buildTrustedContract(contractRow(), semRealizado, [], FIXED_NOW).billedValue;
    expect(isDerived(t)).toBe(true);
    if (isDerived(t)) {
      expect(t.value).toBe(0);
      expect(t.derivation.rule).toContain('nenhum dos eventos');
    }
  });

  it('e o saldo, nesse caso, é o valor total inteiro', () => {
    const semRealizado = emptyBatch({
      billingEvents: new Map([['ctr-1', [billing('b1', 500_000, false)]]]),
    });
    const t = buildTrustedContract(contractRow(), semRealizado, [], FIXED_NOW).remainingValue;
    expect(isDerived(t)).toBe(true);
    if (isDerived(t)) expect(t.value).toBe(1_200_000);
  });
});

describe('vínculo de projeto', () => {
  it('resolve por contracts.project_id', () => {
    const t = buildTrustedContract(
      contractRow({ project_id: PROJECT_CEMIG.id }), emptyBatch(), [PROJECT_CEMIG], FIXED_NOW,
    ).project;
    expect(isLive(t)).toBe(true);
    if (hasOfficialValue(t)) expect(t.value.codigo).toBe('CEMIG - 2450.07/2024');
  });

  it('resolve por contract_project_links', () => {
    const batch = emptyBatch({
      projectLinks: new Map([['ctr-1', [{ id: 'l1', contract_id: 'ctr-1', project_id: PROJECT_CEMIG.id } as never]]]),
    });
    const t = buildTrustedContract(contractRow(), batch, [PROJECT_CEMIG], FIXED_NOW).project;
    expect(isLive(t)).toBe(true);
  });

  it('NUNCA atribui projeto arbitrário — o auto-match por hash morreu aqui', () => {
    const t = buildTrustedContract(contractRow(), emptyBatch(), [PROJECT_CEMIG], FIXED_NOW).project;
    expect(hasOfficialValue(t)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Erro de leitura
// ═══════════════════════════════════════════════════════════════════

describe('falha de leitura', () => {
  const comErro = () => emptyBatch({
    sectionErrors: { ...noErrors(), billing: 'permission denied for table contract_billing_events' },
  });

  it('faturado vira error, não ausência nem zero', () => {
    const t = buildTrustedContract(contractRow(), comErro(), [], FIXED_NOW).billedValue;
    expect(isError(t)).toBe(true);
    expect(isMissing(t)).toBe(false);
    if (isError(t)) expect(t.source).toBe('contract_billing_events');
  });

  it('o erro se propaga para o saldo derivado', () => {
    const t = buildTrustedContract(contractRow(), comErro(), [], FIXED_NOW).remainingValue;
    expect(isError(t)).toBe(true);
  });

  it('renderiza "Dados indisponíveis" — jamais "estimado"', () => {
    const t = buildTrustedContract(contractRow(), comErro(), [], FIXED_NOW).billedValue;
    const label = formatOfficial(t, (v) => `R$ ${v}`);
    expect(label).toBe('Dados indisponíveis');
    expect(label.toLowerCase()).not.toContain('estimad');
  });

  it('seções sem erro seguem apuradas — a falha não contamina o que leu bem', () => {
    const c = buildTrustedContract(contractRow(), comErro(), [], FIXED_NOW);
    expect(isLive(c.totalValue)).toBe(true);
    expect(isDerived(c.overdueObligations)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Agregação de carteira
// ═══════════════════════════════════════════════════════════════════

describe('computeTrustedPortfolioStats', () => {
  const rows = [
    contractRow({ id: 'ctr-1', total_value: 1_200_000, risk_level: 'high' }),
    contractRow({ id: 'ctr-2', total_value: 480_000, risk_level: 'medium', contract_number: 'CTR-58021B' }),
    contractRow({ id: 'ctr-3', total_value: 0, risk_level: 'low', contract_number: 'OS-1042' }),
  ];

  it('soma apenas o que foi apurado, e registra a cobertura', () => {
    const stats = computeTrustedPortfolioStats(buildTrustedPortfolio(rows, emptyBatch(), [], FIXED_NOW));
    expect(isDerived(stats.totalValue)).toBe(true);
    if (isDerived(stats.totalValue)) {
      expect(stats.totalValue.value).toBe(1_680_000);
      expect(stats.totalValue.derivation.coverage).toEqual({ counted: 3, total: 3 });
    }
  });

  it('um contrato de valor 0 CONTA como apurado — zero é medição', () => {
    const stats = computeTrustedPortfolioStats(
      buildTrustedPortfolio([contractRow({ total_value: 0 })], emptyBatch(), [], FIXED_NOW),
    );
    expect(isDerived(stats.totalValue)).toBe(true);
    if (isDerived(stats.totalValue)) {
      expect(stats.totalValue.value).toBe(0);
      expect(stats.totalValue.derivation.coverage).toEqual({ counted: 1, total: 1 });
    }
  });

  it('carteira sem faturamento registrado NÃO afirma R$ 0 faturado', () => {
    const stats = computeTrustedPortfolioStats(buildTrustedPortfolio(rows, emptyBatch(), [], FIXED_NOW));
    expect(isMissing(stats.billedValue)).toBe(true);
    expect(formatOfficial(stats.billedValue, (v) => `R$ ${v}`)).toBe('Não apurado');
  });

  it('percentual faturado é "não comparável" sem faturado apurado — não 0%', () => {
    const stats = computeTrustedPortfolioStats(buildTrustedPortfolio(rows, emptyBatch(), [], FIXED_NOW));
    expect(isMissing(stats.billedPct)).toBe(true);
    if (isMissing(stats.billedPct)) expect(stats.billedPct.reason).toBe('not-comparable');
  });

  it('erro numa seção contamina o agregado dependente, mas não os independentes', () => {
    const batch = emptyBatch({ sectionErrors: { ...noErrors(), billing: 'timeout' } });
    const stats = computeTrustedPortfolioStats(buildTrustedPortfolio(rows, batch, [], FIXED_NOW));
    expect(isError(stats.billedValue)).toBe(true);
    expect(isError(stats.remainingValue)).toBe(true);
    expect(isDerived(stats.totalValue)).toBe(true);       // independente, segue apurado
    expect(isLive(stats.highRisk)).toBe(true);
  });

  it('carteira vazia: contagens são zero apurado, somas são não apuradas', () => {
    const stats = computeTrustedPortfolioStats([]);
    expect(stats.contractCount).toBe(0);
    // Não há o que somar → missing, não R$ 0.
    expect(isMissing(stats.totalValue)).toBe(true);
    // Não há contrato de risco alto → 0 apurado, verdadeiro.
    expect(isLive(stats.highRisk)).toBe(true);
    if (hasOfficialValue(stats.highRisk)) expect(stats.highRisk.value).toBe(0);
  });

  it('contratos sem projeto são contados a partir de vínculo real', () => {
    const stats = computeTrustedPortfolioStats(buildTrustedPortfolio(rows, emptyBatch(), [], FIXED_NOW));
    expect(isDerived(stats.contractsWithoutProject)).toBe(true);
    if (isDerived(stats.contractsWithoutProject)) expect(stats.contractsWithoutProject.value).toBe(3);
  });
});
