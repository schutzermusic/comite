'use client';

import { Users, DollarSign, TrendingUp, PieChart, Percent } from 'lucide-react';
import { KpiCard } from '@/components/orion';
import { KpiSparkline } from '@/components/charts/echarts';
import { OrionCard } from '@/components/orion';
import { PJvsCLTBar } from './PJvsCLTBar';
import { 
  WorkforceMetrics, 
  formatWorkforceCurrency 
} from '@/lib/workforce-data';
import { cn } from '@/lib/utils';

interface WorkforceOverviewCardsProps {
  data: WorkforceMetrics;
  className?: string;
}

export function WorkforceOverviewCards({ data, className }: WorkforceOverviewCardsProps) {
  // Determine status based on thresholds
  const getPayrollTrendStatus = (trend: number): 'success' | 'warning' | 'error' | 'neutral' => {
    if (trend > 8) return 'error';
    if (trend > 5) return 'warning';
    return 'neutral';
  };

  const getPayrollRevenueStatus = (value: number, threshold: number): 'success' | 'warning' | 'error' | 'neutral' => {
    if (value >= threshold + 5) return 'error';
    if (value >= threshold) return 'warning';
    return 'success';
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white orion-text-heading">
            Inteligência de Workforce
          </h2>
          <p className="text-sm text-orion-text-muted">
            Visão consolidada de custos e eficiência de pessoal
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-glass-light">
          <Users className="w-4 h-4 text-semantic-info-DEFAULT" />
          <span className="text-xs text-orion-text-secondary">Workforce Analytics</span>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Total Employees */}
        <KpiCard
          label="Total Funcionários"
          value={data.headcount.total.toLocaleString('pt-BR')}
          icon={Users}
          status="neutral"
          trend={{
            value: data.headcount.trend,
            label: `${data.headcount.delta > 0 ? '+' : ''}${data.headcount.delta} vs mês anterior`,
          }}
          sparkline={
            data.headcount.sparkline && (
              <KpiSparkline
                data={data.headcount.sparkline}
                height={32}
                width={100}
                color="primary"
              />
            )
          }
          size="sm"
        />

        {/* Monthly Payroll */}
        <KpiCard
          label="Folha Mensal"
          value={formatWorkforceCurrency(data.monthlyPayroll.value, data.monthlyPayroll.currency)}
          icon={DollarSign}
          status={getPayrollTrendStatus(data.monthlyPayroll.trend)}
          trend={{
            value: data.monthlyPayroll.trend,
            label: 'vs mês anterior',
          }}
          sparkline={
            data.monthlyPayroll.sparkline && (
              <KpiSparkline
                data={data.monthlyPayroll.sparkline}
                height={32}
                width={100}
                color={data.monthlyPayroll.trend > 5 ? 'warning' : 'success'}
              />
            )
          }
          size="sm"
        />

        {/* Average Cost per Employee */}
        <KpiCard
          label="Custo Médio/Func."
          value={formatWorkforceCurrency(data.avgCostPerEmployee.value, data.avgCostPerEmployee.currency)}
          icon={TrendingUp}
          status={data.avgCostPerEmployee.trend > 3 ? 'warning' : 'neutral'}
          trend={{
            value: data.avgCostPerEmployee.trend,
            label: 'variação mensal',
          }}
          size="sm"
        />

        {/* Payroll as % of Revenue */}
        <KpiCard
          label="Folha/Receita"
          value={`${data.payrollAsRevenuePercent.value.toFixed(1)}%`}
          subtitle={`Limite: ${data.payrollAsRevenuePercent.threshold}%`}
          icon={Percent}
          status={getPayrollRevenueStatus(
            data.payrollAsRevenuePercent.value,
            data.payrollAsRevenuePercent.threshold
          )}
          size="sm"
        />

        {/* PJ vs CLT Distribution - Custom Card */}
        <OrionCard variant="premium" className="p-4">
          <div className="flex items-start justify-between mb-3">
            <span className="text-xs font-medium uppercase tracking-wider text-orion-text-muted">
              PJ vs CLT
            </span>
            <div className="p-2 rounded-lg bg-glass-light">
              <PieChart className="w-4 h-4 text-orion-text-secondary" />
            </div>
          </div>
          
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-lg font-bold text-semantic-info-DEFAULT">
              {data.contractDistribution.pj}
            </span>
            <span className="text-orion-text-muted">/</span>
            <span className="text-lg font-bold text-semantic-success-DEFAULT">
              {data.contractDistribution.clt}
            </span>
          </div>

          <PJvsCLTBar
            pjPercent={data.contractDistribution.pjPercent}
            cltPercent={data.contractDistribution.cltPercent}
            pjCost={data.contractDistribution.pjCost}
            cltCost={data.contractDistribution.cltCost}
            showLabels={false}
          />

          <div className="flex items-center justify-between mt-2 text-[10px] text-orion-text-muted">
            <span>PJ {data.contractDistribution.pjPercent.toFixed(0)}%</span>
            <span>CLT {data.contractDistribution.cltPercent.toFixed(0)}%</span>
          </div>
        </OrionCard>
      </div>
    </div>
  );
}

