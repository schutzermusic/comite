'use client';

import { AlertTriangle, CircleDollarSign, Gauge, TrendingUp, Users } from 'lucide-react';
import {
  FinanceBarChart,
  FinanceChartContainer,
  FinanceLineChart,
  FinanceSCurveChart,
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
import type { InvestorPack } from '@/lib/finance/investor-pack/types';

export function InvestorPackPreview({ pack }: { pack: InvestorPack }) {
  const snapshot = calculateInvestorPack(pack);
  const { metrics, points } = snapshot;
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
            <HudCardDescription>Faturamento e folha fechados comparados às previsões mensais.</HudCardDescription>
          </HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer scrollX>
              <div style={{ minWidth: chartMinWidth }}>
                <FinanceBarChart
                  categories={labels}
                  series={[
                    { name: 'Receita realizada', data: points.map((point) => centsToReais(point.revenueActualCents)), tone: 'success' },
                    { name: 'Receita prevista', data: points.map((point) => centsToReais(point.revenueForecastCents)), tone: 'info' },
                    { name: 'Folha realizada', data: points.map((point) => centsToReais(point.payrollActualCents)), tone: 'danger' },
                    { name: 'Folha prevista', data: points.map((point) => centsToReais(point.payrollForecastCents)), tone: 'warning' },
                  ]}
                  height={320}
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
            <FinanceChartContainer scrollX>
              <div style={{ minWidth: chartMinWidth }}>
                <FinanceSCurveChart
                  categories={labels}
                  series={[
                    { name: 'Projeção receita', values: points.map((point) => centsToReais(point.revenueTotalCents)), tone: 'success', emphasized: true, startIndex: projectionStartIndex },
                    { name: 'Receita já faturada', values: points.map((point) => centsToReais(point.revenueActualCents)), tone: 'info' },
                    { name: 'Projeção folha', values: points.map((point) => centsToReais(point.payrollTotalCents)), tone: 'warning', dashed: true, startIndex: projectionStartIndex },
                    { name: 'Folha já fechada', values: points.map((point) => centsToReais(point.payrollActualCents)), tone: 'danger' },
                  ]}
                  height={320}
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
            <FinanceChartContainer scrollX>
              <div style={{ minWidth: chartMinWidth }}>
                <FinanceLineChart
                  categories={labels}
                  series={[
                    { name: 'Receita prevista', data: points.map((point) => centsToReais(point.revenueForecastCents)), tone: 'success', startIndex: forecastStartIndex },
                    { name: 'Receita já faturada', data: points.map((point) => centsToReais(point.revenueActualCents)), tone: 'info' },
                    { name: 'Folha prevista', data: points.map((point) => centsToReais(point.payrollForecastCents)), tone: 'warning', startIndex: forecastStartIndex },
                    { name: 'Folha já fechada', data: points.map((point) => centsToReais(point.payrollActualCents)), tone: 'danger' },
                  ]}
                  height={320}
                />
              </div>
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>
      </div>
    </div>
  );
}
