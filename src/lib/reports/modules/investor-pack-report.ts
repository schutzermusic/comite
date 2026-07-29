import { calculateInvestorPack, centsToReais, formatInvestorCurrency, formatInvestorPeriod } from '@/lib/finance/investor-pack/calculations';
import type { InvestorPack } from '@/lib/finance/investor-pack/types';
import { buildFinanceReportHtml, openFinanceReport, type FinanceReportPayload } from './finance-report';
import type { ReportExportResult } from '@/lib/reports/report-types';

function items(values: string[], fallback: string): string[] {
  const filtered = values.map((value) => value.trim()).filter(Boolean);
  return filtered.length ? filtered : [fallback];
}

function cumulative(values: number[]): number[] {
  let total = 0;
  return values.map((value) => {
    total += value;
    return total;
  });
}

function investorPackReportPayload(pack: InvestorPack): FinanceReportPayload {
  const snapshot = calculateInvestorPack(pack);
  const { metrics, points } = snapshot;
  const labels = points.map((point) => formatInvestorPeriod(point.period));
  const coverage = metrics.coverageRatio == null ? 'N/D' : `${metrics.coverageRatio.toFixed(2)}x`;
  return {
    title: pack.title,
    kicker: 'Projeção Financeira Executiva',
    fileContext: `projecao-financeira-v${pack.version}`,
    periodLabel: `${formatInvestorPeriod(pack.periodStart)} - ${formatInvestorPeriod(pack.periodEnd)}`,
    scenarioLabel: `Versão ${pack.version} · ${pack.status === 'published' ? 'Publicado' : 'Rascunho'}`,
    context: `${pack.company || 'Visão financeira executiva'} · Destinatário: <b>${pack.recipient || 'Investidor'}</b> · ${pack.confidentiality === 'confidential' ? 'CONFIDENCIAL' : pack.confidentiality === 'restricted' ? 'USO RESTRITO' : 'PÚBLICO'}`,
    source: snapshot.sourceLabel,
    generatedBy: pack.authorName,
    kpis: [
      { label: 'Receita realizada', value: formatInvestorCurrency(metrics.revenueActualCents, true), color: '#047857' },
      { label: 'Receita prevista', value: formatInvestorCurrency(metrics.revenueForecastCents, true), color: '#1D4ED8' },
      { label: 'Folha total', value: formatInvestorCurrency(metrics.payrollTotalCents, true), color: '#B45309' },
      { label: 'Diferença acumulada', value: formatInvestorCurrency(metrics.balanceCents, true), color: metrics.balanceCents >= 0 ? '#047857' : '#B91C1C' },
      { label: 'Cobertura receita / folha', value: coverage, color: metrics.balanceCents >= 0 ? '#047857' : '#B91C1C' },
    ],
    sections: [
      {
        title: 'Síntese Executiva',
        note: {
          title: 'Leitura do período',
          items: [pack.narrative.executiveSummary || 'Resumo executivo não informado.'],
          tone: 'info',
        },
      },
      {
        title: 'Receita e Folha Mês a Mês',
        sub: 'Valores realizados e previstos permanecem identificados separadamente.',
        charts: [{
          title: 'Evolução mensal',
          spec: {
            kind: 'grouped',
            labels,
            valueFmt: 'compactCurrency',
            series: [
              { name: 'Receita realizada', values: points.map((point) => centsToReais(point.revenueActualCents)), color: '#047857' },
              { name: 'Receita prevista', values: points.map((point) => centsToReais(point.revenueForecastCents)), color: '#1D4ED8' },
              { name: 'Folha realizada', values: points.map((point) => centsToReais(point.payrollActualCents)), color: '#B91C1C' },
              { name: 'Folha prevista', values: points.map((point) => centsToReais(point.payrollForecastCents)), color: '#B45309' },
            ],
          },
        }],
        tables: [{
          title: 'Base mensal informada',
          columns: [
            { key: 'period', label: 'Competência' },
            { key: 'revenueActual', label: 'Receita Real', num: true },
            { key: 'revenueForecast', label: 'Receita Prevista', num: true },
            { key: 'payrollActual', label: 'Folha Real', num: true },
            { key: 'payrollForecast', label: 'Folha Prevista', num: true },
          ],
          rows: points.map((point) => ({
            period: formatInvestorPeriod(point.period),
            revenueActual: formatInvestorCurrency(point.revenueActualCents),
            revenueForecast: formatInvestorCurrency(point.revenueForecastCents),
            payrollActual: formatInvestorCurrency(point.payrollActualCents),
            payrollForecast: formatInvestorCurrency(point.payrollForecastCents),
          })),
        }],
      },
      {
        title: 'Curva S Acumulada',
        sub: 'Trajetória acumulada de receita e folha.',
        charts: [{
          title: 'Receita acumulada × folha acumulada',
          spec: {
            kind: 'trend',
            labels,
            valueFmt: 'compactCurrency',
            series: [
              { name: 'Projeção receita', values: points.map((point) => centsToReais(point.revenueCumulativeCents)), color: '#047857' },
              { name: 'Receita já faturada', values: cumulative(points.map((point) => centsToReais(point.revenueActualCents))), color: '#1D4ED8' },
              { name: 'Projeção folha', values: points.map((point) => centsToReais(point.payrollCumulativeCents)), color: '#B45309', dashed: true },
              { name: 'Folha já fechada', values: cumulative(points.map((point) => centsToReais(point.payrollActualCents))), color: '#B91C1C' },
            ],
          },
        }],
      },
      {
        title: 'Premissas, Riscos e Observações',
        note: { title: 'Destaques', items: items(pack.narrative.highlights, 'Nenhum destaque informado.'), tone: 'ok' },
      },
      {
        title: 'Riscos e Premissas',
        note: {
          title: 'Riscos',
          items: items(pack.narrative.risks, 'Nenhum risco informado.'),
          tone: 'warn',
        },
      },
      {
        title: 'Premissas da Projeção',
        note: {
          title: 'Premissas',
          items: items(pack.narrative.assumptions, 'Nenhuma premissa informada.'),
          tone: 'info',
        },
      },
      {
        title: 'Perspectiva e Próximos Passos',
        note: {
          title: 'Mensagem final',
          items: [pack.narrative.closingMessage || 'Atualizar os valores e premissas à medida que novas informações forem consolidadas.'],
          tone: 'info',
        },
      },
    ],
    dataQuality: snapshot.warnings,
  };
}

export function buildInvestorPackPdfHtml(pack: InvestorPack): string {
  return buildFinanceReportHtml(investorPackReportPayload(pack));
}

export function openInvestorPackPdf(pack: InvestorPack): ReportExportResult {
  return openFinanceReport(investorPackReportPayload(pack));
}
