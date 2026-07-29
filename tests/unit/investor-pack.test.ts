import { describe, expect, it } from 'vitest';
import { calculateInvestorPack, validateInvestorPack } from '@/lib/finance/investor-pack/calculations';
import { buildInvestorPackPresentationHtml } from '@/lib/finance/investor-pack/html-presentation';
import type { InvestorPack } from '@/lib/finance/investor-pack/types';

function pack(): InvestorPack {
  return {
    id: 'pack-1',
    organizationId: 'org-1',
    parentPackId: null,
    title: 'Pack Financeiro',
    company: 'Insight',
    recipient: 'Investidor',
    periodStart: '2026-01',
    periodEnd: '2026-03',
    currency: 'BRL',
    referenceDate: '2026-03-31',
    confidentiality: 'confidential',
    status: 'published',
    version: 1,
    authorName: 'Financeiro',
    createdBy: 'user-secret-id',
    createdAt: '2026-03-31T10:00:00Z',
    updatedAt: '2026-03-31T10:00:00Z',
    publishedAt: '2026-03-31T10:00:00Z',
    months: [
      { id: 'm1', period: '2026-01', revenueActualCents: 100_000_00, revenueForecastCents: 0, payrollActualCents: 40_000_00, payrollForecastCents: 0, note: '' },
      { id: 'm2', period: '2026-02', revenueActualCents: 120_000_00, revenueForecastCents: 10_000_00, payrollActualCents: 45_000_00, payrollForecastCents: 5_000_00, note: '' },
      { id: 'm3', period: '2026-03', revenueActualCents: 0, revenueForecastCents: 150_000_00, payrollActualCents: 0, payrollForecastCents: 50_000_00, note: '' },
    ],
    narrative: {
      executiveSummary: 'Crescimento com cobertura positiva.',
      highlights: ['Receita crescente'],
      risks: ['Concentração'],
      assumptions: ['Contratos mantidos'],
      closingMessage: 'Manter disciplina.',
    },
  };
}

describe('Pack do Investidor', () => {
  it('calcula mensal, acumulado e cobertura a partir do mesmo snapshot', () => {
    const snapshot = calculateInvestorPack(pack());
    expect(snapshot.metrics.revenueActualCents).toBe(220_000_00);
    expect(snapshot.metrics.revenueForecastCents).toBe(160_000_00);
    expect(snapshot.metrics.payrollTotalCents).toBe(140_000_00);
    expect(snapshot.metrics.balanceCents).toBe(240_000_00);
    expect(snapshot.metrics.coverageRatio).toBeCloseTo(380 / 140);
    expect(snapshot.points[2].revenueCumulativeCents).toBe(380_000_00);
    expect(snapshot.points[2].payrollCumulativeCents).toBe(140_000_00);
  });

  it('rejeita duplicidade, negativos e período invertido', () => {
    const invalid = pack();
    invalid.periodStart = '2026-04';
    invalid.periodEnd = '2026-03';
    invalid.months[1].period = '2026-01';
    invalid.months[2].payrollForecastCents = -1;
    const validation = validateInvestorPack(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join(' ')).toContain('período final');
    expect(validation.errors.join(' ')).toContain('duplicada');
    expect(validation.errors.join(' ')).toContain('valor inválido');
  });

  it('sinaliza lacuna mensal e previsão sem premissa', () => {
    const warningPack = pack();
    warningPack.months.splice(1, 1);
    warningPack.narrative.assumptions = [''];
    const validation = validateInvestorPack(warningPack);
    expect(validation.warnings.join(' ')).toContain('lacuna');
    expect(validation.warnings.join(' ')).toContain('premissa');
  });

  it('gera HTML autônomo sem autenticação, CDN ou identificadores internos', () => {
    const html = buildInvestorPackPresentationHtml(pack());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Curva S');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('user-secret-id');
    expect(html).not.toContain('org-1');
    expect(html).not.toContain('token');
  });
});
