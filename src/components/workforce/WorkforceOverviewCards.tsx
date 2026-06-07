'use client';

import {
  Users, DollarSign, TrendingUp, Percent, UserMinus,
  Activity, Clock,
} from 'lucide-react';
import { formatWorkforceCurrency, WorkforceMetrics } from '@/lib/workforce-data';
import type { WorkforcePeriodMeta } from '@/lib/workforce/period';
import { cn } from '@/lib/utils';
import { RiskKpiGrid, type RiskKpiCardData } from '@/components/risks/RiskKpiGrid';

interface ExtendedKpiProps {
  turnoverPct?: number;
  absenteeismPct?: number;
  overtimePct?: number;
  benefitsTotal?: number;
  chargesTotal?: number;
  revenuePerEmployee?: number;
  directPayrollPct?: number;
  indirectPayrollPct?: number;
}

interface WorkforceOverviewCardsProps {
  data: WorkforceMetrics;
  meta?: WorkforcePeriodMeta;
  extended?: ExtendedKpiProps;
  className?: string;
}

export function WorkforceOverviewCards({ data, meta, extended = {}, className }: WorkforceOverviewCardsProps) {
  const hasComparison = meta ? meta.hasComparison : true;
  const comparisonLabel = meta?.comparisonLabel || 'vs mês anterior';

  const payrollValue = data.monthlyPayroll.value;
  const folhaRevPct = data.payrollAsRevenuePercent.value;
  const turnover = extended.turnoverPct ?? 0;
  const absenteeism = extended.absenteeismPct ?? 0;
  const overtime = extended.overtimePct ?? 0;
  const totalCost = data.contractDistribution.cltCost + data.contractDistribution.pjCost;

  const ic = (I: typeof Users) => <I className="h-4 w-4" />;

  const kpis: RiskKpiCardData[] = [
    // ── Row 1: Headcount & Payroll ────────────────────────────────────
    {
      id: 'headcount',
      label: 'Total Funcionários',
      value: data.headcount.total,
      icon: ic(Users),
      tone: 'info',
      delta: hasComparison && data.headcount.delta !== 0 ? data.headcount.delta : undefined,
      upIsGood: true,
      help: hasComparison ? comparisonLabel : undefined,
    },
    {
      id: 'payroll',
      label: 'Folha Mensal',
      value: formatWorkforceCurrency(payrollValue),
      icon: ic(DollarSign),
      tone: data.monthlyPayroll.trend > 8 ? 'danger' : data.monthlyPayroll.trend > 5 ? 'warning' : 'default',
      delta: hasComparison ? Math.round(data.monthlyPayroll.trend * 10) / 10 : undefined,
      upIsGood: false,
    },
    {
      id: 'avg-cost',
      label: 'Custo Médio / Func.',
      value: formatWorkforceCurrency(data.avgCostPerEmployee.value),
      icon: ic(TrendingUp),
      tone: 'default',
      delta: hasComparison ? Math.round(data.avgCostPerEmployee.trend * 10) / 10 : undefined,
      upIsGood: false,
    },
    {
      id: 'rev-per-emp',
      label: 'Receita / Colaborador',
      value: extended.revenuePerEmployee ? formatWorkforceCurrency(extended.revenuePerEmployee) : '–',
      icon: ic(TrendingUp),
      tone: 'success',
      help: 'Eficiência produtiva por colaborador',
    },
    {
      id: 'payroll-rev',
      label: 'Folha / Receita',
      value: `${folhaRevPct.toFixed(1)}%`,
      icon: ic(Percent),
      tone: folhaRevPct >= 35 ? 'danger' : folhaRevPct >= 30 ? 'warning' : 'success',
      help: `Meta: ≤ ${data.payrollAsRevenuePercent.threshold}%`,
    },

    // ── Row 2: Composition & Risk ─────────────────────────────────────
    {
      id: 'clt-pj',
      label: 'CLT / PJ',
      value: `${data.contractDistribution.clt} · ${data.contractDistribution.pj}`,
      suffix: ` CLT ${data.contractDistribution.cltPercent.toFixed(0)}%`,
      icon: ic(Users),
      tone: 'accent',
      help: `PJ: ${data.contractDistribution.pjPercent.toFixed(0)}% do headcount`,
    },
    {
      id: 'turnover',
      label: 'Turnover',
      value: extended.turnoverPct !== undefined ? `${extended.turnoverPct.toFixed(2)}%` : '–',
      icon: ic(Activity),
      tone: turnover > 3 ? 'danger' : turnover > 2 ? 'warning' : 'success',
      help: 'Rotatividade mensal',
    },
    {
      id: 'absenteeism',
      label: 'Absenteísmo',
      value: extended.absenteeismPct !== undefined ? `${extended.absenteeismPct.toFixed(1)}%` : '–',
      icon: ic(UserMinus),
      tone: absenteeism > 5 ? 'danger' : absenteeism > 4 ? 'warning' : 'success',
      help: 'Média por área',
    },
    {
      id: 'overtime',
      label: 'Horas Extras',
      value: extended.overtimePct !== undefined ? `${extended.overtimePct.toFixed(1)}%` : '–',
      icon: ic(Clock),
      tone: overtime > 12 ? 'warning' : 'info',
      help: 'Do total de horas trabalhadas',
    },
    {
      id: 'clt-pj-cost',
      label: 'Custo CLT vs PJ',
      value: totalCost > 0
        ? `${((data.contractDistribution.cltCost / totalCost) * 100).toFixed(0)}% CLT`
        : '–',
      icon: ic(DollarSign),
      tone: 'info',
      help: totalCost > 0
        ? `PJ: ${((data.contractDistribution.pjCost / totalCost) * 100).toFixed(0)}% do custo total`
        : undefined,
    },
  ];

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-ig-fg-strong tracking-tight">Cockpit Executivo de Pessoas</h2>
          <p className="text-xs text-ig-fg-muted">
            Indicadores-chave{meta?.periodLabel ? ` — ${meta.periodLabel}` : ''}
          </p>
        </div>
        {hasComparison && (
          <span className="text-[10px] text-ig-fg-subtle px-2 py-1 rounded-full bg-ig-panel border border-ig-border-subtle">
            Variações {comparisonLabel}
          </span>
        )}
      </div>
      <RiskKpiGrid cards={kpis} />
    </div>
  );
}
