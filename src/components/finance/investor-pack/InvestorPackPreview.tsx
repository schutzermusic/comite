'use client';

import { AlertTriangle, CircleDollarSign, Gauge, TrendingUp, Users } from 'lucide-react';
import {
  FinanceBarChart,
  FinanceChartContainer,
  FinanceLineChart,
  FinanceSCurveChart,
  FinanceStackedBarChart,
} from '@/components/finance/shared';
import {
  HudCard,
  HudCardContent,
  HudCardDescription,
  HudCardHeader,
  HudCardTitle,
  HudKpiStrip,
  type KpiItem,
} from '@/components/hud';
import { calculateInvestorPack, centsToReais, formatInvestorPeriod } from '@/lib/finance/investor-pack/calculations';
import { clientForecastColor } from '@/lib/finance/investor-pack/apex-charts';
import { APEX_CLIENT_FORECAST_DESCRIPTION } from '@/lib/finance/investor-pack/apex-theme';
import type { InvestorPack } from '@/lib/finance/investor-pack/types';

export function InvestorPackPreview({ pack }: { pack: InvestorPack }) {
  const snapshot = calculateInvestorPack(pack);
  const { metrics, points } = snapshot;
  const chartHeight = 440;
  const kpis: KpiItem[] = [
    { id: 'actual', label: 'Faturamento realizado', value: centsToReais(metrics.revenueActualCents), format: 'compactCurrency', variant: 'success', icon: <CircleDollarSign className="h-4 w-4" /> },
    { id: 'forecast', label: 'Previsão de faturamento', value: centsToReais(metrics.revenueForecastCents), format: 'compactCurrency', variant: 'info', icon: <TrendingUp className="h-4 w-4" /> },
    { id: 'payroll', label: 'Folha total', value: centsToReais(metrics.payrollTotalCents), format: 'compactCurrency', variant: 'warning', icon: <Users className="h-4 w-4" /> },
    { id: 'balance', label: 'Diferença acumulada', value: centsToReais(metrics.balanceCents), format: 'compactCurrency', variant: metrics.balanceCents >= 0 ? 'success' : 'danger', icon: <Gauge className="h-4 w-4" /> },
    { id: 'coverage', label: 'Cobertura receita / folha', value: metrics.coverageRatio ?? 0, suffix: 'x', variant: (metrics.coverageRatio ?? 0) >= 1 ? 'success' : 'danger' },
  ];
  const labels = points.map((point) => formatInvestorPeriod(point.period).replace(' de ', '/'));
  const chartMinWidth = Math.max(960, points.length * 48);
  const firstForecastIndex = points.findIndex((point) => point.period > pack.referenceDate.slice(0, 7));
  const forecastStartIndex = firstForecastIndex >= 0 ? firstForecastIndex : points.length;
  const projectionStartIndex = forecastStartIndex > 0 ? forecastStartIndex - 1 : 0;
  const revenueForecastBridge = points.map((point, index) =>
    centsToReais(index === projectionStartIndex ? point.revenueActualCents : point.revenueForecastCents),
  );
  const payrollForecastBridge = points.map((point, index) =>
    centsToReais(index === projectionStartIndex ? point.payrollActualCents : point.payrollForecastCents),
  );
  const visiblePeriods = new Set(points.map((point) => point.period));
  const clientForecasts = pack.narrative.clientForecasts.filter(
    (forecast) => visiblePeriods.has(forecast.period) && forecast.amountCents > 0,
  );
  const firstClientForecastPeriod = clientForecasts.reduce<string | null>(
    (first, forecast) => first === null || forecast.period < first ? forecast.period : first,
    null,
  );
  const clientForecastPoints = firstClientForecastPeriod
    ? points.filter((point) => point.period >= firstClientForecastPeriod)
    : [];
  const clientForecastLabels = clientForecastPoints.map((point) => formatInvestorPeriod(point.period).replace(' de ', '/'));
  const forecastClients = [...new Map(clientForecasts.map((forecast) => [forecast.clientId, forecast.client])).entries()];
  const forecastByClient = new Map(
    forecastClients.map(([clientId]) => [
      clientId,
      clientForecasts
        .filter((forecast) => forecast.clientId === clientId)
        .reduce((totals, forecast) => {
          totals.set(forecast.period, (totals.get(forecast.period) ?? 0) + forecast.amountCents);
          return totals;
        }, new Map<string, number>()),
    ]),
  );

  return (
    <div className="space-y-4">
      <HudKpiStrip kpis={kpis} columns={3} />

      {snapshot.warnings.length > 0 && (
        <div className="flex gap-3 rounded-xl border border-ig-warning/30 bg-ig-warning/10 px-4 py-3 text-xs text-ig-fg-default">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ig-warning" />
          <div>
            <p className="font-semibold">Pontos para revisar</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ig-fg-muted">
              {snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <HudCard>
          <HudCardHeader>
            <HudCardTitle>Realizado x projeção por competência</HudCardTitle>
            <HudCardDescription>Faturamento e folha comparados à projeção sazonal, com vales no meio do ano e picos no início e no fim.</HudCardDescription>
          </HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer scrollX minHeight={chartHeight + 16} className="pb-4">
              <div style={{ minWidth: chartMinWidth }}>
                <FinanceBarChart
                  categories={labels}
                  series={[
                    { name: 'Receita realizada', data: points.map((point) => centsToReais(point.revenueActualCents)), tone: 'success' },
                    { name: 'Receita prevista', data: points.map((point) => centsToReais(point.revenueForecastCents)), tone: 'info' },
                    { name: 'Folha fechada + encargos', data: points.map((point) => centsToReais(point.payrollActualCents)), tone: 'danger' },
                    { name: 'Folha prevista', data: points.map((point) => centsToReais(point.payrollForecastCents)), tone: 'warning' },
                  ]}
                  height={chartHeight}
                />
              </div>
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader>
            <HudCardTitle>Curva S - receita e folha</HudCardTitle>
            <HudCardDescription>Valores fechados e trajetórias projetadas acumuladas no período.</HudCardDescription>
          </HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer scrollX minHeight={chartHeight + 16} className="pb-4">
              <div style={{ minWidth: chartMinWidth }}>
                <FinanceSCurveChart
                  categories={labels}
                  series={[
                    { name: 'Projeção receita', values: points.map((point) => centsToReais(point.revenueTotalCents)), tone: 'success', emphasized: true, startIndex: projectionStartIndex },
                    { name: 'Receita já faturada', values: points.map((point) => centsToReais(point.revenueActualCents)), tone: 'info' },
                    { name: 'Projeção folha', values: points.map((point) => centsToReais(point.payrollTotalCents)), tone: 'warning', dashed: true, startIndex: projectionStartIndex },
                    { name: 'Folha já fechada', values: points.map((point) => centsToReais(point.payrollActualCents)), tone: 'danger' },
                  ]}
                  height={chartHeight}
                />
              </div>
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader>
            <HudCardTitle>Curva mensal - receita e folha</HudCardTitle>
            <HudCardDescription>Valores de cada competência, sem acumulação entre os meses.</HudCardDescription>
          </HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer scrollX minHeight={chartHeight + 16} className="pb-4">
              <div style={{ minWidth: chartMinWidth }}>
                <FinanceLineChart
                  categories={labels}
                  series={[
                    { name: 'Receita prevista', data: revenueForecastBridge, tone: 'success', startIndex: projectionStartIndex },
                    { name: 'Receita já faturada', data: points.map((point) => centsToReais(point.revenueActualCents)), tone: 'info', endIndex: projectionStartIndex },
                    { name: 'Folha prevista', data: payrollForecastBridge, tone: 'warning', startIndex: projectionStartIndex },
                    { name: 'Folha já fechada', data: points.map((point) => centsToReais(point.payrollActualCents)), tone: 'danger', endIndex: projectionStartIndex },
                  ]}
                  height={chartHeight}
                />
              </div>
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        {clientForecasts.length > 0 && (
          <HudCard>
            <HudCardHeader>
              <HudCardTitle>Projeção de faturamento por cliente</HudCardTitle>
              <HudCardDescription>{APEX_CLIENT_FORECAST_DESCRIPTION}</HudCardDescription>
            </HudCardHeader>
            <HudCardContent className="p-3">
              <FinanceChartContainer scrollX minHeight={536} className="pb-4">
                <div style={{ minWidth: Math.max(960, clientForecastPoints.length * 54) }}>
                  <FinanceStackedBarChart
                    categories={clientForecastLabels}
                    series={forecastClients.map(([clientId, client], index) => ({
                      name: client,
                      data: clientForecastPoints.map((point) => centsToReais(forecastByClient.get(clientId)?.get(point.period) ?? 0)),
                      tone: (['accent', 'info', 'success', 'warning', 'danger', 'budget'][index % 6]) as 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'budget',
                      color: clientForecastColor(clientId, index),
                    }))}
                    height={520}
                  />
                </div>
              </FinanceChartContainer>
            </HudCardContent>
          </HudCard>
        )}
      </div>
    </div>
  );
}
