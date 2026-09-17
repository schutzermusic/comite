import type { InvestorPack } from '@/lib/finance/investor-pack/types';

export function labelQaPack(count = 12): InvestorPack {
  const months = Array.from({ length: count }, (_, index) => {
    const period = `${2026 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`;
    const realized = index < Math.min(7, count);
    return { id: period, period, revenueActualCents: realized ? 640_000_000 + index * 10_000_000 : 0,
      revenueForecastCents: realized ? 0 : 1_150_000_000, payrollActualCents: realized ? 130_000_000 : 0,
      payrollForecastCents: realized ? 0 : 131_000_000, note: '' };
  });
  return { id: 'label-qa', organizationId: null, parentPackId: null, title: 'Validação de rótulos PDF',
    company: 'Insight Energy', recipient: 'Validação técnica', periodStart: months[0].period,
    periodEnd: months.at(-1)!.period, currency: 'BRL', referenceDate: '2026-09-17',
    confidentiality: 'confidential', status: 'draft', version: 1, authorName: 'Financeiro',
    createdBy: null, createdAt: '', updatedAt: '', publishedAt: null, months,
    narrative: { executiveSummary: '', highlights: [], risks: [], assumptions: [], closingMessage: '',
      portfolio: [], projectionVersion: '', clientForecasts: months.filter((month) => month.revenueForecastCents > 0)
        .flatMap((month) => [['axia', 'Axia', .55], ['enel', 'Enel', .35], ['cemig', 'Cemig', .0999], ['tiny', 'Pequeno', .0001]]
          .map(([id, client, share]) => ({ period: month.period, clientId: String(id), client: String(client),
            amountCents: Math.round(month.revenueForecastCents * Number(share)), source: 'eventogram' as const, note: '' }))) } };
}

