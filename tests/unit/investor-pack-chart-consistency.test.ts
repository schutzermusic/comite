import { describe, expect, it } from 'vitest';
import {
  calculateInvestorPack, filterInvestorPackPeriod, investorForecastStartPeriod, investorMonthlyForecastSeries,
} from '@/lib/finance/investor-pack/calculations';
import type { InvestorPack } from '@/lib/finance/investor-pack/types';

function projection(): InvestorPack {
  return {
    id: 'energy', organizationId: 'energy', parentPackId: null, title: 'Projeção', company: 'Insight Energy', recipient: '',
    periodStart: '2026-07', periodEnd: '2026-12', referenceDate: '2026-09-17', currency: 'BRL', confidentiality: 'confidential',
    status: 'draft', version: 1, authorName: 'Financeiro', createdBy: null, createdAt: '', updatedAt: '', publishedAt: null,
    months: [
      ['2026-07', 587901875, 0, 201505080, 0],
      ['2026-08', 609120034, 0, 0, 151243000],
      ['2026-09', 0, 1145933009, 0, 138785000],
      ['2026-10', 0, 561781024, 0, 163472000],
      ['2026-11', 0, 0, 0, 172894000],
      ['2026-12', 0, 1041583898, 0, 159638000],
    ].map(([period, actual, forecast, payrollActual, payrollForecast]) => ({
      id: String(period), period: String(period), revenueActualCents: Number(actual), revenueForecastCents: Number(forecast),
      payrollActualCents: Number(payrollActual), payrollForecastCents: Number(payrollForecast), note: '',
    })),
    narrative: {
      executiveSummary: '', highlights: [], risks: [], closingMessage: '', assumptions: ['Curva deslocada em um mês.'],
      portfolio: [], projectionVersion: 'faturamentos-2026-julho-agosto-v1',
      clientForecasts: [
        ['2026-09', 'a', 600000000], ['2026-09', 'b', 545933009],
        ['2026-10', 'a', 561781024], ['2026-12', 'b', 1041583898],
      ].map(([period, client, amount]) => ({ period: String(period), clientId: String(client), client: String(client), amountCents: Number(amount), source: 'eventogram', note: '' })),
    },
  };
}

describe('Consistência dos gráficos de receita e folha', () => {
  it('usa o fechamento de cada métrica e mantém previsões anteriores à data-base', () => {
    const pack = projection();
    expect(investorForecastStartPeriod(pack, 'revenue')).toBe('2026-09');
    expect(investorForecastStartPeriod(pack, 'payroll')).toBe('2026-08');
    const visible = filterInvestorPackPeriod(pack, '2026-07', '2026-12');
    expect(visible.months[2].revenueForecastCents).toBe(1145933009);
    expect(visible.months[1].payrollForecastCents).toBe(151243000);
    expect(visible.months).toEqual(pack.months);
  });

  it('mantém a curva mensal, a curva S e o comparativo iguais à soma por cliente', () => {
    const pack = filterInvestorPackPeriod(projection(), '2026-07', '2026-12');
    const { points } = calculateInvestorPack(pack);
    const monthly = investorMonthlyForecastSeries(points, 'revenueActualCents', 'revenueForecastCents', 1);
    points.slice(2).forEach((point, index) => {
      const byClient = pack.narrative.clientForecasts.filter((row) => row.period === point.period).reduce((sum, row) => sum + row.amountCents, 0);
      expect(point.revenueForecastCents).toBe(byClient);
      expect(monthly[index + 2]).toBe(byClient / 100);
      expect(point.revenueCumulativeCents - points[index + 1].revenueCumulativeCents).toBe(byClient);
    });
    expect(points[0].revenueActualCents).toBe(587901875);
    expect(points[1].revenueActualCents).toBe(609120034);
    expect(points[2].payrollCumulativeCents).toBe(201505080 + 151243000 + 138785000);
  });

  it('preserva meses zerados e o primeiro mês quando o filtro mostra somente projeções', () => {
    const { points } = calculateInvestorPack(filterInvestorPackPeriod(projection(), '2026-09', '2026-12'));
    const monthly = investorMonthlyForecastSeries(points, 'revenueActualCents', 'revenueForecastCents', 0);
    expect(monthly).toEqual([11459330.09, 5617810.24, 0, 10415838.98]);
    expect(points[0].revenueCumulativeCents).toBe(1145933009);
  });

  it('a alteração da data-base não muda os valores exibidos', () => {
    const before = projection();
    const after = { ...before, referenceDate: '2026-12-17' };
    expect(calculateInvestorPack(filterInvestorPackPeriod(after, '2026-07', '2026-12')).points)
      .toEqual(calculateInvestorPack(filterInvestorPackPeriod(before, '2026-07', '2026-12')).points);
  });
});
