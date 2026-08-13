/**
 * Cobertura da competência.
 *
 * Os cenários abaixo são os três que a base real produziu depois da primeira
 * importação do histórico completo, e cada um levava a uma leitura errada da
 * Visão Geral se exibido sem ressalva.
 */
import { describe, expect, it } from 'vitest';
import { competenceCoverage, summarizeCoverage } from '@/lib/workforce/esocial-coverage';

/** Abril/2026: folha detalhada + totalizadores, tabela de rubricas completa. */
const completa = {
  competence: '2026-04',
  gross_payroll_cents: 158_529_279,
  rubric_total_cents: 271_939_615,
  rubric_mapped_cents: 271_939_615,
  cp_base_cents: 158_529_279,
  fgts_base_cents: 160_731_182,
  headcount: 251,
};

/** Janeiro/2025: os totalizadores sobreviveram; o S-1200 já tinha expirado. */
const soTotalizadores = {
  competence: '2025-01',
  gross_payroll_cents: 0,
  rubric_total_cents: 0,
  rubric_mapped_cents: 0,
  cp_base_cents: 90_000_000,
  fgts_base_cents: 87_904_775,
  headcount: 1,
};

/** O caso real de hoje: tabela de rubricas quase inexistente no pacote. */
const semTabelaDeRubricas = {
  competence: '2026-05',
  gross_payroll_cents: 652_906,
  rubric_total_cents: 271_939_615,
  rubric_mapped_cents: 652_906,
  cp_base_cents: 158_529_279,
  fgts_base_cents: 160_731_182,
  headcount: 251,
};

describe('competenceCoverage', () => {
  it('competência completa usa as rubricas e libera a composição', () => {
    const c = competenceCoverage(completa);
    expect(c.detail).toBe('complete');
    expect(c.payrollSource).toBe('rubricas');
    expect(c.payroll).toBe(1_585_292.79);
    expect(c.compositionReliable).toBe(true);
    expect(c.note).toBeUndefined();
  });

  it('mês só com totalizadores mostra a base apurada, nunca o resíduo do S-1200', () => {
    // Sem isto, janeiro/2025 aparecia com R$ 5.820 de folha ao lado de
    // R$ 83.027 de INSS — os dois verdadeiros, a leitura conjunta absurda.
    const c = competenceCoverage(soTotalizadores);
    expect(c.detail).toBe('missing');
    expect(c.payrollSource).toBe('base_esocial');
    expect(c.payroll).toBe(900_000);
    expect(c.compositionReliable).toBe(false);
    expect(c.note).toContain('janela de retenção');
  });

  it('sem tabela de rubricas, a massa cai para a base e a composição fica indisponível', () => {
    const c = competenceCoverage(semTabelaDeRubricas);
    // O detalhe existe e representa o mês; o que falta é o dicionário.
    expect(c.detail).toBe('complete');
    expect(c.compositionReliable).toBe(false);
    expect(c.payrollSource).toBe('base_esocial');
    expect(c.payroll).toBe(1_585_292.79);
    expect(c.rubricCoverage).toBeLessThan(0.01);
    expect(c.note).toContain('S-1010');
  });

  it('competência sem nada não inventa massa', () => {
    const c = competenceCoverage({
      competence: '2024-01',
      gross_payroll_cents: 0,
      rubric_total_cents: 0,
      rubric_mapped_cents: 0,
      cp_base_cents: null,
      fgts_base_cents: null,
      headcount: 0,
    });
    expect(c.payroll).toBe(0);
    expect(c.payrollSource).toBe('indisponivel');
  });

  it('base ainda não migrada (sem as colunas da 081) não quebra', () => {
    const c = competenceCoverage({
      competence: '2026-06',
      gross_payroll_cents: 100_000_000,
      headcount: 250,
    });
    expect(c.detail).toBe('missing');
    expect(c.payrollSource).toBe('indisponivel');
  });
});

describe('summarizeCoverage', () => {
  it('conta as competências por nível de cobertura', () => {
    const s = summarizeCoverage([completa, soTotalizadores, semTabelaDeRubricas]);
    expect(s).toEqual({ total: 3, complete: 2, partial: 0, missing: 1, withComposition: 1 });
  });
});
