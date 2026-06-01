'use client';

import { Users, DollarSign, TrendingUp, PieChart, Percent } from 'lucide-react';
import { HudKpiStrip, type KpiItem, type HudKpiVariant } from '@/components/hud';
import { PJvsCLTBar } from './PJvsCLTBar';
import {
  WorkforceMetrics,
  formatWorkforceCurrency,
} from '@/lib/workforce-data';
import type { WorkforcePeriodMeta } from '@/lib/workforce/period';
import { cn } from '@/lib/utils';

interface WorkforceOverviewCardsProps {
  data: WorkforceMetrics;
  /**
   * Period context. Drives whether KPIs show a month-over-month variation or an
   * accumulated/average label (e.g. "Todo período" has no clear baseline).
   */
  meta?: WorkforcePeriodMeta;
  className?: string;
}

export function WorkforceOverviewCards({ data, meta, className }: WorkforceOverviewCardsProps) {
  // Default to month-over-month behavior when no period meta is supplied
  // (keeps the component backward compatible).
  const hasComparison = meta ? meta.hasComparison : true;
  const comparisonLabel = meta?.comparisonLabel || 'vs mês anterior';
  const accum = meta?.accumulatedLabels ?? {
    headcount: 'posição atual',
    payroll: 'acumulado histórico',
    avgCost: 'média histórica',
  };
  const getPayrollTrendVariant = (trend: number): HudKpiVariant => {
    if (trend > 8) return 'danger';
    if (trend > 5) return 'warning';
    return 'default';
  };

  const getPayrollRevenueVariant = (value: number, threshold: number): HudKpiVariant => {
    if (value >= threshold + 5) return 'danger';
    if (value >= threshold) return 'warning';
    return 'success';
  };

  const fmtTrend = (t: number) => `${t > 0 ? '+' : ''}${t.toFixed(1)}%`;
  const trendTone = (t: number): 'success' | 'danger' | 'neutral' => {
    if (t > 0) return 'danger';
    if (t < 0) return 'success';
    return 'neutral';
  };

  const kpis: KpiItem[] = [
    {
      id: 'headcount',
      label: 'Total Funcionários',
      value: data.headcount.total.toLocaleString('pt-BR'),
      icon: <Users className="w-full h-full" />,
      variant: 'info',
      deltaText: hasComparison ? `${data.headcount.delta > 0 ? '+' : ''}${data.headcount.delta}` : undefined,
      deltaTone: 'neutral',
      deltaLabel: hasComparison ? comparisonLabel : accum.headcount,
    },
    {
      id: 'monthly-payroll',
      label: 'Folha Mensal',
      value: formatWorkforceCurrency(data.monthlyPayroll.value, data.monthlyPayroll.currency),
      icon: <DollarSign className="w-full h-full" />,
      variant: getPayrollTrendVariant(data.monthlyPayroll.trend),
      tintValue: data.monthlyPayroll.trend > 5,
      deltaText: hasComparison ? fmtTrend(data.monthlyPayroll.trend) : undefined,
      deltaTone: trendTone(data.monthlyPayroll.trend),
      deltaLabel: hasComparison ? comparisonLabel : accum.payroll,
    },
    {
      id: 'avg-cost',
      label: 'Custo Médio/Func.',
      value: formatWorkforceCurrency(data.avgCostPerEmployee.value, data.avgCostPerEmployee.currency),
      icon: <TrendingUp className="w-full h-full" />,
      variant: data.avgCostPerEmployee.trend > 3 ? 'warning' : 'default',
      deltaText: hasComparison ? fmtTrend(data.avgCostPerEmployee.trend) : undefined,
      deltaTone: trendTone(data.avgCostPerEmployee.trend),
      deltaLabel: hasComparison ? comparisonLabel : accum.avgCost,
    },
    {
      id: 'payroll-revenue',
      label: 'Folha / Receita',
      value: `${data.payrollAsRevenuePercent.value.toFixed(1)}%`,
      icon: <Percent className="w-full h-full" />,
      variant: getPayrollRevenueVariant(
        data.payrollAsRevenuePercent.value,
        data.payrollAsRevenuePercent.threshold,
      ),
      tintValue: true,
      deltaLabel: `Limite: ${data.payrollAsRevenuePercent.threshold}%`,
    },
    {
      id: 'pj-vs-clt',
      label: 'PJ vs CLT',
      value: `${data.contractDistribution.pj} / ${data.contractDistribution.clt}`,
      icon: <PieChart className="w-full h-full" />,
      variant: 'default',
      deltaLabel: `PJ ${data.contractDistribution.pjPercent.toFixed(0)}% · CLT ${data.contractDistribution.cltPercent.toFixed(0)}%`,
    },
  ];

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ig-fg-strong">
            Inteligência de Workforce
          </h2>
          <p className="text-sm text-ig-fg-muted">
            Visão consolidada de custos e eficiência de pessoal
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-ig-panel border border-ig-border-subtle">
          <Users className="w-4 h-4 text-ig-info" />
          <span className="text-xs text-ig-fg-muted">Workforce Analytics</span>
        </div>
      </div>

      <HudKpiStrip kpis={kpis} columns={5} size="md" />

      <div className="ig-glass relative overflow-hidden rounded-xl" data-elev="2">
        <span data-ig-noise="" />
        <span data-ig-specular="" />
        <div data-ig-content="" className="p-4">
          <PJvsCLTBar
            pjPercent={data.contractDistribution.pjPercent}
            cltPercent={data.contractDistribution.cltPercent}
            pjCost={data.contractDistribution.pjCost}
            cltCost={data.contractDistribution.cltCost}
          />
        </div>
      </div>
    </div>
  );
}
