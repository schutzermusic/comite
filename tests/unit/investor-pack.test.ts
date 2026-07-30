import { describe, expect, it } from 'vitest';
import { calculateInvestorPack, validateInvestorPack } from '@/lib/finance/investor-pack/calculations';
import { buildApexInsights } from '@/lib/finance/investor-pack/apex-insights';
import { buildInvestorPackPdfHtml } from '@/lib/finance/investor-pack/apex-pdf';
import {
  APEX_LOGO_DATA_URI,
  APEX_LOGO_SMALL_DATA_URI,
} from '@/lib/finance/investor-pack/apex-logo';
import {
  APEX_CLOSING_CERTIFICATIONS,
  APEX_CLOSING_STATEMENT,
  APEX_CLOSING_TITLE,
  APEX_DARK,
  APEX_LIGHT,
  REPORT_FILE_SLUG,
  REPORT_NAME,
} from '@/lib/finance/investor-pack/apex-theme';
import {
  buildInvestorPackPresentationHtml,
  investorPackFileStem,
} from '@/lib/finance/investor-pack/html-presentation';
import {
  buildGrowingClientForecasts,
  buildInvestorPortfolio,
  clientForecastTotalsByPeriod,
  hydratePortfolioProjection,
  PAYROLL_FORECAST_CENTS,
  REVENUE_ACTUALS_CENTS,
} from '@/lib/finance/investor-pack/portfolio-projection';
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
      portfolio: [],
      clientForecasts: [],
      projectionVersion: '',
    },
  };
}

describe('Pack do Investidor', () => {
  it('gera curva sazonal com baixa no meio do ano e alta no início e fim', () => {
    const forecasts = buildGrowingClientForecasts();
    const totals = clientForecastTotalsByPeriod(forecasts);
    const periods = [...totals.keys()].filter((period) => period >= '2026-10').sort();
    expect(periods).toHaveLength(27);
    const values = periods.map((period) => totals.get(period) ?? 0);
    values.filter((_, index) => index >= 3).forEach((value) => {
      expect(value).toBeGreaterThanOrEqual(920_000_000);
      expect(value).toBeLessThanOrEqual(1_500_000_000);
    });
    expect(new Set(values).size).toBeGreaterThan(20);
    for (const year of ['2027', '2028']) {
      const average = (months: string[]) =>
        months.reduce((sum, month) => sum + (totals.get(`${year}-${month}`) ?? 0), 0) / months.length;
      expect(average(['06', '07', '08'])).toBeLessThan(average(['01', '02']));
      expect(average(['06', '07', '08'])).toBeLessThan(average(['11', '12']));
    }
    for (let month = 1; month <= 12; month += 1) {
      const suffix = String(month).padStart(2, '0');
      expect(totals.get(`2028-${suffix}`)).toBeGreaterThan(totals.get(`2027-${suffix}`) ?? 0);
    }
  });

  it('classifica julho/2026 como realizado e inicia a previsão em agosto', () => {
    const hydrated = hydratePortfolioProjection(pack());
    const july = hydrated.months.find((month) => month.period === '2026-07');
    expect(july?.revenueActualCents).toBe(497_896_755);
    expect(july?.revenueForecastCents).toBe(0);
    expect(hydrated.months.find((month) => month.period === '2026-08')?.revenueForecastCents).toBeGreaterThan(0);
  });

  it('atualiza a folha fechada com benefícios e encargos de jan/25 a jun/26', () => {
    const hydrated = hydratePortfolioProjection(pack());
    expect(hydrated.months.find((month) => month.period === '2025-01')?.payrollActualCents).toBe(133_102_291);
    expect(hydrated.months.find((month) => month.period === '2025-12')?.payrollActualCents).toBe(196_468_162);
    expect(hydrated.months.find((month) => month.period === '2026-01')?.payrollActualCents).toBe(320_800_000);
    expect(hydrated.months.find((month) => month.period === '2026-06')?.payrollActualCents).toBe(310_800_000);
    expect(hydrated.months.find((month) => month.period === '2026-06')?.payrollForecastCents).toBe(0);
  });

  it('recupera o faturamento consolidado e gera identificadores aceitos pelo banco', () => {
    const hydrated = hydratePortfolioProjection({ ...pack(), months: [] });
    const revenueTotal = Object.values(REVENUE_ACTUALS_CENTS).reduce((sum, value) => sum + value, 0);
    const hydratedRevenueTotal = hydrated.months.reduce((sum, month) => sum + month.revenueActualCents, 0);

    expect(hydrated.periodStart).toBe('2024-01');
    expect(hydratedRevenueTotal).toBe(revenueTotal);
    expect(hydrated.months).toHaveLength(60);
    hydrated.months.forEach((month) => {
      expect(month.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  it('projeta a folha reduzida e variável somente a partir de agosto de 2026', () => {
    const hydrated = hydratePortfolioProjection(pack());
    const projected = hydrated.months.filter((month) => month.period >= '2026-08');
    const values = Object.values(PAYROLL_FORECAST_CENTS);

    expect(hydrated.months.find((month) => month.period === '2026-07')?.payrollForecastCents).toBe(0);
    expect(hydrated.months.find((month) => month.period === '2026-08')?.payrollForecastCents).toBe(151_243_000);
    expect(hydrated.months.find((month) => month.period === '2028-12')?.payrollForecastCents).toBe(174_218_000);
    expect(projected.every((month) =>
      month.payrollForecastCents >= 130_000_000 && month.payrollForecastCents <= 175_000_000,
    )).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it('limita a projeção ao backlog, preservada a divergência conhecida de Âmbar na planilha', () => {
    const forecasts = buildGrowingClientForecasts().filter((forecast) => forecast.period >= '2026-10');
    const portfolio = buildInvestorPortfolio();
    portfolio.filter((client) => client.id !== 'ambar').forEach((client) => {
      expect(client.projectedThrough2028Cents).toBeLessThanOrEqual(client.backlogCents);
    });
    const exactDecember = forecasts
      .filter((forecast) => forecast.period === '2026-12' && forecast.source === 'eventogram')
      .reduce((sum, forecast) => sum + forecast.amountCents, 0);
    expect(exactDecember).toBe(1_005_246_180);
  });

  it('soma eventos e recorrência por cliente sem zerar dezembro', () => {
    const forecasts = buildGrowingClientForecasts();
    const december = forecasts.filter((forecast) => forecast.period === '2026-12');
    const enel = december
      .filter((forecast) => forecast.clientId === 'enel')
      .reduce((sum, forecast) => sum + forecast.amountCents, 0);
    const petrobras = december
      .filter((forecast) => forecast.clientId === 'petrobras')
      .reduce((sum, forecast) => sum + forecast.amountCents, 0);
    const total = december.reduce((sum, forecast) => sum + forecast.amountCents, 0);

    expect(enel).toBeGreaterThanOrEqual(588_720_000);
    expect(petrobras).toBeGreaterThanOrEqual(407_693_008);
    expect(total).toBeGreaterThanOrEqual(1_000_000_000);
    expect(total).toBeLessThanOrEqual(1_500_000_000);
  });

  it('inclui as 11 empresas ativas e uma base mensal variável da ENEL', () => {
    const forecasts = buildGrowingClientForecasts();
    const activeClients = new Set(forecasts.map((forecast) => forecast.clientId));
    expect(activeClients).toEqual(new Set([
      'axia', 'petrobras', 'enel', 'belem', 'flessak', 'cemig',
      'harbin', 'arcelor', 'andritz', 'ambar', 'hydro',
    ]));

    const recurringPeriods = [
      '2026-09', '2026-10', '2026-11',
      '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09',
    ];
    const recurring = recurringPeriods.map((period) =>
      forecasts
        .filter((forecast) =>
          forecast.period === period
          && forecast.clientId === 'enel'
          && forecast.source === 'backlog_allocation')
        .reduce((sum, forecast) => sum + forecast.amountCents, 0),
    );
    expect(new Set(recurring).size).toBe(recurring.length);
    recurring.forEach((amount) => {
      expect(amount).toBeGreaterThanOrEqual(120_000_000);
      expect(amount).toBeLessThanOrEqual(190_000_000);
    });
    const enelTotal = forecasts
      .filter((forecast) => forecast.clientId === 'enel')
      .reduce((sum, forecast) => sum + forecast.amountCents, 0);
    expect(enelTotal).toBe(2_806_217_395);
    for (const period of ['2027-10', '2027-11', '2027-12']) {
      expect(forecasts.some((forecast) => forecast.clientId === 'enel' && forecast.period === period)).toBe(false);
    }
  });

  it('mantém somente clientes ativos e exclui a NEC da carteira atual', () => {
    const portfolio = buildInvestorPortfolio();
    expect(portfolio.every((client) => client.status === 'Ativo')).toBe(true);
    expect(portfolio.some((client) => client.id === 'nec')).toBe(false);
  });

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

  it('deriva a leitura Apex só a partir do snapshot, em pt-BR', () => {
    const snapshot = calculateInvestorPack(pack());
    const insights = buildApexInsights(snapshot);
    // 380/140 = 2,714... — formatado em pt-BR, nunca com ponto decimal.
    expect(insights.coverageLabel).toBe('2,71x');
    expect(insights.verdict).toBe('surplus');
    expect(insights.realizedMonths).toBe(2);
    expect(insights.forecastMonths).toBe(2);
    expect(insights.forecastShare).toBeCloseTo(160 / 380);
    expect(insights.closingBalanceCents).toBe(240_000_00);
    expect(insights.averageBalanceCents).toBe(80_000_00);
    expect(insights.peakRevenue?.period).toBe('2026-03');
    expect(insights.deficitMonths).toEqual([]);
    expect(insights.firstCumulativeDeficit).toBeNull();
  });

  it('marca déficit quando a folha supera a receita, sem inventar valores', () => {
    const deficit = pack();
    deficit.months = [
      { id: 'm1', period: '2026-01', revenueActualCents: 10_000_00, revenueForecastCents: 0, payrollActualCents: 30_000_00, payrollForecastCents: 0, note: '' },
    ];
    const insights = buildApexInsights(calculateInvestorPack(deficit));
    expect(insights.verdict).toBe('deficit');
    expect(insights.coverageLabel).toBe('0,33x');
    expect(insights.deficitMonths.map((month) => month.period)).toEqual(['2026-01']);
    expect(insights.firstCumulativeDeficit?.period).toBe('2026-01');
    expect(insights.cards.some((card) => card.kind === 'alert')).toBe(true);
  });

  it('não calcula cobertura quando não há folha informada', () => {
    const noPayroll = pack();
    noPayroll.months = noPayroll.months.map((month) => ({ ...month, payrollActualCents: 0, payrollForecastCents: 0 }));
    const insights = buildApexInsights(calculateInvestorPack(noPayroll));
    expect(insights.verdict).toBe('unknown');
    expect(insights.coverageLabel).toBe('N/D');
    expect(insights.coverageMarginPct).toBeNull();
    expect(insights.tightestCoverage).toBeNull();
  });

  it('gera o PDF dark premium paginado com fonte do dado em todas as páginas', () => {
    const html = buildInvestorPackPdfHtml(pack());
    const pages = html.match(/<section class="page/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(6);
    // Paginação resolvida em build time (Chromium renderiza counter(pages) como 0).
    expect(html).toContain(`Página 1 de ${pages.length}`);
    expect(html).toContain(`Página ${pages.length} de ${pages.length}`);
    const sources = html.match(/Dados informados do sistema na Projeção Financeira/g) ?? [];
    expect(sources.length).toBeGreaterThanOrEqual(pages.length);
    expect(html).toContain('Curva S');
    expect(html).toContain('2,71x');
    expect(html).not.toContain('<em>Destinatário</em>');
    expect(html).not.toContain('Peso do previsto na receita');
    expect(html).not.toContain('O que sustenta a projeção e o que merece acompanhamento');
    // Última página: só a marca centralizada, sem frase institucional nem selo ISO.
    expect(html).toContain('class="closing-logo"');
    expect(html).not.toContain(APEX_CLOSING_STATEMENT);
    expect(html).not.toContain(APEX_CLOSING_CERTIFICATIONS);
    expect(html).not.toContain('user-secret-id');
  });

  it('exporta o PDF nos dois temas, com a mesma estrutura e a marca embutida', () => {
    const dark = buildInvestorPackPdfHtml(pack());
    const light = buildInvestorPackPdfHtml(pack(), { theme: 'light' });

    // Tema é só paleta: mesma contagem de páginas e mesmos títulos de seção.
    const countPages = (html: string) => (html.match(/<section class="page/g) ?? []).length;
    expect(countPages(light)).toBe(countPages(dark));
    expect(light).toContain('Curva S');
    expect(dark).toContain('Curva S');

    expect(dark).toContain('content="dark"');
    expect(light).toContain('content="light"');
    // Fundo do documento: preto no escuro, branco no claro.
    expect(dark).toContain(APEX_DARK.void);
    expect(light).toContain(APEX_LIGHT.void);
    expect(light).not.toContain(APEX_DARK.void);

    // Marca Insight Energy embutida (uma vez por variante, via CSS).
    [dark, light].forEach((html) => {
      expect(html).toContain(APEX_LOGO_DATA_URI);
      expect(html).toContain(APEX_LOGO_SMALL_DATA_URI);
      expect(html.split(APEX_LOGO_SMALL_DATA_URI).length - 1).toBe(1);
      expect(html).toContain(REPORT_NAME);
      expect(html).not.toContain('Insight Apex');
    });
  });

  it('nomeia o relatório e o arquivo como Faturamento vs Folha de Pagamento', () => {
    expect(REPORT_NAME).toBe('Relatório de Faturamento vs Folha de Pagamento');
    expect(investorPackFileStem(pack())).toContain(REPORT_FILE_SLUG);
    expect(buildInvestorPackPdfHtml(pack())).toContain(REPORT_FILE_SLUG);
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
    // Marca embutida (data URI, não URL externa) e nome do relatório no material.
    expect(html).toContain(APEX_LOGO_DATA_URI);
    expect(html).toContain(REPORT_NAME);
    expect(html).not.toContain('Insight Apex');
    expect(html).not.toContain('<em>Destinatário</em>');
    expect(html).not.toContain('Peso do previsto na receita');
    expect(html).not.toContain('O que sustenta a projeção e o que merece acompanhamento');
    // O deck HTML mantém o fecho narrativo; só o PDF virou credencial institucional.
    expect(html).toContain(APEX_CLOSING_TITLE);
  });
});
