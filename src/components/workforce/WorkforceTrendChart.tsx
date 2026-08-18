'use client';

/**
 * Tendência da folha e do custo médio, no kit SVG compartilhado.
 *
 * Duas séries em escalas muito diferentes (massa total × custo por pessoa)
 * dividiriam mal o mesmo eixo, então o custo médio vira uma sparkline própria
 * abaixo da linha principal — mesma janela, mesmos rótulos, sem o achatamento
 * que um eixo único produziria.
 */

import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import {
  FinanceLineChart,
  FinanceSparkline,
  PALETTE_DARK,
  PALETTE_LIGHT,
  useChartTheme,
} from '@/components/finance/shared';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { WorkforceChartCard } from './overview/WorkforceChartCard';

interface TrendDataPoint {
  period: string;
  payroll: number;
  headcount: number;
  avgCost: number;
}

interface WorkforceTrendChartProps {
  data: TrendDataPoint[];
  currency?: string;
  className?: string;
}

export function WorkforceTrendChart({
  data,
  currency = 'BRL',
  className,
}: WorkforceTrendChartProps) {
  const { isLight } = useChartTheme();
  const palette = isLight ? PALETTE_LIGHT : PALETTE_DARK;

  const trendInfo = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0];
    const last = data[data.length - 1];
    if (first.payroll === 0) return null;
    const pct = ((last.payroll - first.payroll) / first.payroll) * 100;
    return { pct, up: pct > 0, flat: Math.abs(pct) < 0.05 };
  }, [data]);

  const periods = data.map((d) => d.period);
  const TrendIcon = trendInfo?.flat ? Minus : trendInfo?.up ? ArrowUpRight : ArrowDownRight;

  return (
    <WorkforceChartCard
      title="Tendência da folha"
      subtitle={`Massa mensal e custo médio por colaborador — ${data.length} competência${data.length === 1 ? '' : 's'}`}
      height={230}
      className={className}
      isEmpty={data.length === 0}
      emptyTitle="Sem competência apurada"
      emptyDescription="A tendência precisa de ao menos uma competência com folha aprovada ou apurada pelo eSocial."
      legend={[
        { label: 'Folha mensal', color: palette.accent },
        { label: 'Custo médio / colaborador', color: palette.info },
      ]}
      actions={
        trendInfo && (
          <span
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold',
              trendInfo.flat
                ? 'border-ig-border-subtle text-ig-fg-muted'
                : trendInfo.up
                  ? 'border-ig-danger/25 text-ig-danger'
                  : 'border-ig-success/25 text-ig-success',
            )}
            title="Variação da folha entre a primeira e a última competência da janela"
          >
            <TrendIcon className="h-3 w-3" />
            {trendInfo.pct > 0 ? '+' : ''}
            {trendInfo.pct.toFixed(1).replace('.', ',')}%
          </span>
        )
      }
    >
      <div className="space-y-1">
        <FinanceLineChart
          categories={periods}
          series={[{ name: 'Folha mensal', data: data.map((d) => d.payroll), tone: 'accent' }]}
          height={168}
        />
        <div className="px-2">
          <p className="mb-0.5 flex items-center justify-between text-[10px] text-ig-fg-subtle">
            <span className="font-semibold uppercase tracking-[0.12em]">Custo médio</span>
            <span className="ig-tabular">
              {data.length > 0 && data[data.length - 1].avgCost > 0
                ? formatWorkforceCurrency(data[data.length - 1].avgCost, currency)
                : '–'}
            </span>
          </p>
          {data.length > 1 && (
            <FinanceSparkline values={data.map((d) => d.avgCost)} tone="info" height={34} />
          )}
        </div>
      </div>
    </WorkforceChartCard>
  );
}
