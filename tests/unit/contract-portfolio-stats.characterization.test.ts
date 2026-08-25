/**
 * CARACTERIZAÇÃO — pipeline de agregação de Contratos (pré-P0.3).
 *
 * Este arquivo NÃO afirma que os números abaixo estão corretos. Afirma que são
 * os números que o sistema produz HOJE. Existe para que o Trust Layer não mova
 * nenhum valor sem que a mudança apareça como teste vermelho, revisável.
 *
 * Vários destes valores são FABRICADOS pelo enricher a partir de
 * `hash(id + nome)`. Onde for o caso, o teste marca. São exatamente esses os
 * valores que P0.3 deve deixar de apresentar como apurados.
 */

import { describe, it, expect } from 'vitest';
import { enrichContractsForGovernance, DEMO_PREVIEW_INTENT } from '@/components/contracts/contract-governance-data';
import { computeContractPortfolioStats } from '@/components/contracts/contract-portfolio-stats';
import {
  CONTRACTS, PROJECTS, FIXED_NOW, CONTRACT_ZERO_VALUE,
} from './fixtures/contract-fixtures';

const records = () => enrichContractsForGovernance(CONTRACTS, PROJECTS, { intent: DEMO_PREVIEW_INTENT, now: FIXED_NOW });

describe('caracterização: enrichContractsForGovernance', () => {
  it('é determinístico para o mesmo input e o mesmo `now`', () => {
    expect(enrichContractsForGovernance(CONTRACTS, PROJECTS, { intent: DEMO_PREVIEW_INTENT, now: FIXED_NOW }))
      .toEqual(enrichContractsForGovernance(CONTRACTS, PROJECTS, { intent: DEMO_PREVIEW_INTENT, now: FIXED_NOW }));
  });

  it('FABRICA billedValue/remainingValue sem nenhuma linha de faturamento real', () => {
    // Saem de `0.18 + (seed % 58)/100`. Ficção apresentada como exposição.
    const [alto, medio, zero] = records();
    expect([alto.billedValue, alto.remainingValue]).toEqual([540_000, 660_000]);
    expect([medio.billedValue, medio.remainingValue]).toEqual([360_000, 120_000]);
    expect([zero.billedValue, zero.remainingValue]).toEqual([0, 0]);
  });

  it('FABRICA riskScore — nunca lê a coluna health_score', () => {
    expect(records().map((r) => r.riskScore)).toEqual([83, 71, 51]);
  });

  it('FABRICA 3 obrigações e a escada fixa de faturamento 10/40/50%', () => {
    for (const record of records()) {
      expect(record.obligations).toHaveLength(3);
      expect(record.billingEvents.map((e) => e.title)).toEqual([
        'Assinatura & Mobilização (10%)',
        'Medição Física Fase 1 (40%)',
        'Medição Final & Encerramento (50%)',
      ]);
    }
  });

  it('FABRICA cláusulas, auditoria, riscos, tarefas e deliberações', () => {
    const [alto] = records();
    expect(alto.clauses).toHaveLength(3);
    expect(alto.auditEvents.map((e) => e.actor)).toContain('INSIGHT AI');
    expect(alto.linkedTasks).toHaveLength(2);
    expect(alto.linkedDeliberations[0].committeeName).toBe('Comitê de Governança e Finanças');
  });

  it('sem o merge live, nenhum registro carrega proveniência', () => {
    for (const record of records()) {
      expect(record.dataQuality).toBeUndefined();
      expect(record.liveApprovals).toBeUndefined();
      expect(record.liveDocuments).toBeUndefined();
    }
  });

  it('o fallback de auto-match de projeto está DORMENTE — ambas as páginas o desligam', () => {
    // Com a flag (como o app faz), nenhum projeto é inventado.
    expect(records().every((r) => r.project === null)).toBe(true);

    // Sem a flag, `resolveProject` atribui `projects[seed % projects.length]`:
    // um projeto ARBITRÁRIO a contratos que não têm vínculo nenhum.
    const semFlag = enrichContractsForGovernance(
      CONTRACTS.map(({ disableProjectAutoMatch: _drop, ...rest }) => rest),
      PROJECTS,
      { intent: DEMO_PREVIEW_INTENT, now: FIXED_NOW },
    );
    expect(semFlag.every((r) => r.project?.codigo === 'CEMIG - 2450.07/2024')).toBe(true);
  });
});

describe('caracterização: computeContractPortfolioStats', () => {
  it('produz exatamente os agregados de hoje', () => {
    expect(computeContractPortfolioStats(records())).toStrictEqual({
      // ── Apurados de verdade: vêm da coluna `value` de `contracts` ──
      totalValue: 1_680_000,
      expiring: 1,
      within30: 0,
      highRisk: 1,
      highRiskExposure: 1_200_000,
      semProjeto: 3,

      // ── FABRICADOS pelo enricher — alvo de P0.3 ──
      billedValue: 900_000,
      remainingValue: 780_000,
      contractsWithBalance: 2,
      missingDocs: 6,
      contractsWithMissing: 3,
      legalReview: 2,
      semFaturamento: 1,
      semIa: 1,
      overdue: 1,
      contractsWithOverdue: 1,
      avgSla: 24,
      slaLive: false,
      billedPct: 54,
      backlogPct: 46,
    });
  });

  it('carteira vazia: avgSla ainda devolve a heurística 18, não "não apurado"', () => {
    const stats = computeContractPortfolioStats([]);
    expect(stats.totalValue).toBe(0);
    expect(stats.billedPct).toBe(0);
    // Sem um único contrato, a Executive Band ainda afirma "SLA médio 18h".
    expect(stats.avgSla).toBe(18);
    expect(stats.slaLive).toBe(false);
  });

  it('um contrato de valor 0 produz billedPct 0 — indistinguível de "não medido"', () => {
    // O ponto central de P0.3: hoje `0` apurado e ausência de dado colapsam no
    // mesmo pixel. `Trusted<T>` os separa em FORMAS diferentes.
    const stats = computeContractPortfolioStats(
      enrichContractsForGovernance([CONTRACT_ZERO_VALUE], PROJECTS, { intent: DEMO_PREVIEW_INTENT, now: FIXED_NOW }),
    );
    expect(stats.totalValue).toBe(0);
    expect(stats.billedValue).toBe(0);
    expect(stats.billedPct).toBe(0);
  });
});
