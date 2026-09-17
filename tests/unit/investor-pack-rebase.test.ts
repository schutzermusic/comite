import { describe, expect, it } from 'vitest';
import { rebaseRevenueProjection, type ManagementPortfolioInput } from '@/lib/finance/investor-pack/rebase-projection';
import { hydratePortfolioProjection } from '@/lib/finance/investor-pack/portfolio-projection';
import type { InvestorPack } from '@/lib/finance/investor-pack/types';

function fixture(): InvestorPack {
  return {
    id: 'draft', organizationId: 'energy', status: 'draft', periodStart: '2026-07', periodEnd: '2028-12',
    title: 'Projeção', company: 'Insight Energy', recipient: '', currency: 'BRL', referenceDate: '2026-07-30',
    version: 1, confidentiality: 'confidential', parentPackId: null, authorName: 'Financeiro', createdBy: 'user',
    createdAt: '', updatedAt: '', publishedAt: null,
    months: ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2028-12'].map((period, i) => ({
      id: period, period, revenueActualCents: i === 0 ? 100 : 0,
      revenueForecastCents: i === 0 || period === '2026-11' ? 0 : 200,
      payrollActualCents: i === 0 ? 80 : 0, payrollForecastCents: i === 0 ? 0 : 90, note: '',
    })),
    narrative: {
      projectionVersion: 'old', executiveSummary: 'Preservar', highlights: [], risks: [], assumptions: [], closingMessage: '', portfolio: [],
      clientForecasts: ['2026-08', '2026-09', '2026-10', '2028-12'].map((period) => ({
        period, clientId: 'a', client: 'A', amountCents: 200, source: 'eventogram', note: 'Evento',
      })),
    },
  };
}

const management: ManagementPortfolioInput[] = [
  { id: 'a', client: 'A', contractsCount: 2, portfolioCents: 1000, billedCents: 500, backlogCents: 500, blockedCents: 0 },
  { id: 'new', client: 'Novo', contractsCount: 1, portfolioCents: 150, billedCents: 0, backlogCents: 150, blockedCents: 0 },
];
const actuals = { '2026-07': 587901875, '2026-08': 609120034 };

describe('Atualização dos faturamentos da Insight Energy', () => {
  it('desloca a receita, fecha julho/agosto e preserva folha e histórico', () => {
    const before = fixture();
    const next = rebaseRevenueProjection(before, actuals, management);
    expect(next.months[0]).toMatchObject({ revenueActualCents: actuals['2026-07'], revenueForecastCents: 0, payrollActualCents: 80 });
    expect(next.months[1]).toMatchObject({ revenueActualCents: actuals['2026-08'], revenueForecastCents: 0, payrollForecastCents: 90 });
    expect(next.months[2].revenueForecastCents).toBe(before.months[1].revenueForecastCents);
    expect(next.months[3].revenueForecastCents).toBe(before.months[2].revenueForecastCents);
    expect(next.months.map((m) => [m.payrollActualCents, m.payrollForecastCents])).toEqual(before.months.map((m) => [m.payrollActualCents, m.payrollForecastCents]));
    expect(next.narrative.executiveSummary).toBe('Preservar');
    expect(before.months[0].revenueActualCents).toBe(100);
  });

  it('limita cada cliente ao backlog e deixa saldos sem cronograma fora da projeção', () => {
    const next = rebaseRevenueProjection(fixture(), actuals, management);
    expect(next.narrative.clientForecasts.map((row) => [row.period, row.amountCents])).toEqual([
      ['2026-09', 200], ['2026-10', 200], ['2026-11', 100],
    ]);
    expect(next.narrative.portfolio[0]).toMatchObject({ projectedThrough2028Cents: 500, remainingAfter2028Cents: 0 });
    expect(next.narrative.portfolio[1]).toMatchObject({ projectedThrough2028Cents: 0, remainingAfter2028Cents: 150 });
    expect(next.periodEnd).toBe('2028-12');
  });

  it('preserva a importação ao hidratar ou reaplicar a atualização', () => {
    const next = rebaseRevenueProjection(fixture(), actuals, management);
    expect(hydratePortfolioProjection(next)).toBe(next);
    expect(rebaseRevenueProjection(next, actuals, management)).toBe(next);
  });

  it('recusa divergências na origem e relatórios publicados', () => {
    expect(() => rebaseRevenueProjection({ ...fixture(), status: 'published' }, actuals, management)).toThrow('rascunho');
    const invalid = fixture();
    invalid.months[1].revenueForecastCents = 201;
    expect(() => rebaseRevenueProjection(invalid, actuals, management)).toThrow('diverge');
    expect(() => rebaseRevenueProjection(fixture(), actuals, [{ ...management[0], backlogCents: 501 }])).toThrow('reconciliada');
  });
});
