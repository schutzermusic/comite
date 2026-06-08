'use client';

import {
  Users, DollarSign, TrendingUp, Percent, UserMinus,
  Activity, Clock,
} from 'lucide-react';
import { formatWorkforceCurrency, WorkforceMetrics } from '@/lib/workforce-data';
import type { WorkforcePeriodMeta } from '@/lib/workforce/period';
import { cn } from '@/lib/utils';
import { HudKpiStrip, type KpiItem } from '@/components/hud';

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

function makeDelta(
  delta: number | undefined,
  upIsGood = false,
): { deltaText?: string; deltaTone?: 'success' | 'danger' | 'neutral' } {
  if (delta === undefined) return {};
  const text = delta > 0 ? `+${delta}%` : `${delta}%`;
  const tone: 'success' | 'danger' | 'neutral' =
    delta === 0 ? 'neutral' : (delta > 0) === upIsGood ? 'success' : 'danger';
  return { deltaText: text, deltaTone: tone };
}

function KpiGroupDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.16em] text-ig-fg-subtle">
        {label}
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-ig-border-subtle to-transparent" />
    </div>
  );
}

export function WorkforceOverviewCards({ data, meta, extended = {}, className }: WorkforceOverviewCardsProps) {
  const hasComparison = meta ? meta.hasComparison : true;
  const comparisonLabel = meta?.comparisonLabel || 'vs mês anterior';

  const payrollValue   = data.monthlyPayroll.value;
  const folhaRevPct    = data.payrollAsRevenuePercent.value;
  const turnover       = extended.turnoverPct ?? 0;
  const absenteeism    = extended.absenteeismPct ?? 0;
  const overtime       = extended.overtimePct ?? 0;
  const totalCost      = data.contractDistribution.cltCost + data.contractDistribution.pjCost;
  const headcountDelta = hasComparison && data.headcount.delta !== 0 ? data.headcount.delta : undefined;
  const payrollDelta   = hasComparison ? Math.round(data.monthlyPayroll.trend * 10) / 10 : undefined;
  const avgCostDelta   = hasComparison ? Math.round(data.avgCostPerEmployee.trend * 10) / 10 : undefined;

  // ── Row 1: Financial & Efficiency ─────────────────────────────────────
  const primaryKpis: KpiItem[] = [
    {
      id: 'headcount',
      label: 'Total Funcionários',
      value: data.headcount.total,
      format: 'number',
      variant: 'info',
      icon: <Users className="w-5 h-5" />,
      ...makeDelta(headcountDelta, true),
      deltaLabel: hasComparison ? comparisonLabel : undefined,
    },
    {
      id: 'payroll',
      label: 'Folha Mensal',
      value: formatWorkforceCurrency(payrollValue),
      variant: data.monthlyPayroll.trend > 8 ? 'danger' : data.monthlyPayroll.trend > 5 ? 'warning' : 'default',
      icon: <DollarSign className="w-5 h-5" />,
      ...makeDelta(payrollDelta, false),
    },
    {
      id: 'avg-cost',
      label: 'Custo Médio / Func.',
      value: formatWorkforceCurrency(data.avgCostPerEmployee.value),
      variant: 'default',
      icon: <TrendingUp className="w-5 h-5" />,
      ...makeDelta(avgCostDelta, false),
    },
    {
      id: 'rev-per-emp',
      label: 'Receita / Colaborador',
      value: extended.revenuePerEmployee ? formatWorkforceCurrency(extended.revenuePerEmployee) : '–',
      variant: 'success',
      icon: <TrendingUp className="w-5 h-5" />,
      deltaLabel: 'Eficiência produtiva',
    },
    {
      id: 'payroll-rev',
      label: 'Folha / Receita',
      value: `${folhaRevPct.toFixed(1)}%`,
      variant: folhaRevPct >= 35 ? 'danger' : folhaRevPct >= 30 ? 'warning' : 'success',
      icon: <Percent className="w-5 h-5" />,
      deltaLabel: `Meta: ≤ ${data.payrollAsRevenuePercent.threshold}%`,
    },
  ];

  // ── Row 2: Risk & Composition ─────────────────────────────────────────
  const riskKpis: KpiItem[] = [
    {
      id: 'clt-pj',
      label: 'CLT / PJ',
      value: `${data.contractDistribution.clt} · ${data.contractDistribution.pj}`,
      variant: 'default',
      icon: <Users className="w-5 h-5" />,
      deltaLabel: `CLT ${data.contractDistribution.cltPercent.toFixed(0)}% · PJ ${data.contractDistribution.pjPercent.toFixed(0)}%`,
    },
    {
      id: 'turnover',
      label: 'Turnover',
      value: extended.turnoverPct !== undefined ? `${extended.turnoverPct.toFixed(2)}%` : '–',
      variant: turnover > 3 ? 'danger' : turnover > 2 ? 'warning' : 'success',
      icon: <Activity className="w-5 h-5" />,
      deltaLabel: 'Rotatividade mensal',
    },
    {
      id: 'absenteeism',
      label: 'Absenteísmo',
      value: extended.absenteeismPct !== undefined ? `${extended.absenteeismPct.toFixed(1)}%` : '–',
      variant: absenteeism > 5 ? 'danger' : absenteeism > 4 ? 'warning' : 'success',
      icon: <UserMinus className="w-5 h-5" />,
      deltaLabel: 'Média por área',
    },
    {
      id: 'overtime',
      label: 'Horas Extras',
      value: extended.overtimePct !== undefined ? `${extended.overtimePct.toFixed(1)}%` : '–',
      variant: overtime > 12 ? 'warning' : 'info',
      icon: <Clock className="w-5 h-5" />,
      deltaLabel: '% do total trabalhado',
    },
    {
      id: 'clt-pj-cost',
      label: 'Custo CLT vs PJ',
      value: totalCost > 0
        ? `${((data.contractDistribution.cltCost / totalCost) * 100).toFixed(0)}% CLT`
        : '–',
      variant: 'info',
      icon: <DollarSign className="w-5 h-5" />,
      deltaLabel: totalCost > 0
        ? `PJ: ${((data.contractDistribution.pjCost / totalCost) * 100).toFixed(0)}% do custo`
        : undefined,
    },
  ];

  return (
    <div className={cn('space-y-4', className)}>
      {/* Section header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="h-5 w-0.5 rounded-full bg-ig-accent/70 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-ig-fg-strong tracking-tight">
              Cockpit Executivo de Pessoas
            </h2>
            <p className="text-[11px] text-ig-fg-muted leading-none mt-0.5">
              Indicadores-chave{meta?.periodLabel ? ` — ${meta.periodLabel}` : ''}
            </p>
          </div>
        </div>
        {hasComparison && (
          <span className="text-[10px] text-ig-fg-subtle px-2.5 py-1 rounded-full bg-ig-panel border border-ig-border-subtle">
            △ Variações {comparisonLabel}
          </span>
        )}
      </div>

      {/* Row 1 — Financial & Efficiency */}
      <div className="space-y-1.5">
        <KpiGroupDivider label="Financeiro & Eficiência" />
        <HudKpiStrip kpis={primaryKpis} columns={5} />
      </div>

      {/* Row 2 — Risk & Composition */}
      <div className="space-y-1.5">
        <KpiGroupDivider label="Risco & Composição" />
        <HudKpiStrip kpis={riskKpis} columns={5} />
      </div>
    </div>
  );
}
