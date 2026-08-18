'use client';

/**
 * Eficiência & produtividade, no kit SVG compartilhado.
 *
 * Migrado de ECharts: o mesmo renderizador que desenha aqui desenha no PDF, no
 * deck e no PowerPoint, com a mesma paleta. Enquanto a tela usava canvas e o
 * relatório usava SVG-string, eram dois desenhos do mesmo número — e bastava
 * uma cor mudar de um lado para a comparação entre tela e documento denunciar
 * a divergência.
 */

import { useMemo } from 'react';
import { Percent, TrendingUp, Zap } from 'lucide-react';
import {
  FinanceLineChart,
  PALETTE_DARK,
  PALETTE_LIGHT,
  useChartTheme,
} from '@/components/finance/shared';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { WorkforceChartCard } from './overview/WorkforceChartCard';
import type { EfficiencyPoint } from '@/lib/workforce/period';

interface WorkforceEfficiencyPanelProps {
  data: EfficiencyPoint[];
  currency?: string;
  className?: string;
  /** Limite de política para a razão folha/receita. */
  threshold?: number;
}

export function WorkforceEfficiencyPanel({
  data,
  currency = 'BRL',
  className,
  threshold = 30,
}: WorkforceEfficiencyPanelProps) {
  const { isLight } = useChartTheme();
  const palette = isLight ? PALETTE_LIGHT : PALETTE_DARK;

  const periods = useMemo(() => data.map((d) => d.period), [data]);

  // Receita por colaborador só existe onde houve receita lançada. Um ponto em
  // zero afirmaria faturamento nulo, que é diferente de faturamento ausente.
  const hasRevenue = data.some((d) => d.revenuePerEmployee > 0);
  const latest = data[data.length - 1];

  const summary = [
    {
      icon: Zap,
      label: 'Receita / colaborador',
      value: latest && latest.revenuePerEmployee > 0
        ? formatWorkforceCurrency(latest.revenuePerEmployee, currency)
        : '–',
      tone: 'text-ig-success',
    },
    {
      icon: TrendingUp,
      label: 'Custo médio / colaborador',
      value: latest && latest.costPerEmployee > 0
        ? formatWorkforceCurrency(latest.costPerEmployee, currency)
        : '–',
      tone: 'text-ig-info',
    },
    {
      icon: Percent,
      label: 'Folha / receita',
      value: latest && latest.payrollAsRevenuePct > 0
        ? `${latest.payrollAsRevenuePct.toFixed(1).replace('.', ',')}%`
        : '–',
      tone:
        latest && latest.payrollAsRevenuePct >= threshold ? 'text-ig-warning' : 'text-ig-fg-strong',
    },
  ];

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {summary.map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className="flex items-center gap-3 rounded-xl border border-ig-border-subtle bg-ig-panel px-4 py-3"
            >
              <span className="shrink-0 rounded-lg bg-ig-accent-weak p-2">
                <Icon className="h-4 w-4 text-ig-accent" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">
                  {s.label}
                </p>
                <p className={cn('ig-tabular text-lg font-semibold', s.tone)}>{s.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <WorkforceChartCard
          title="Receita e custo por colaborador"
          subtitle="Quanto cada pessoa produz e quanto custa, mês a mês"
          height={260}
          isEmpty={!hasRevenue}
          emptyTitle="Receita não lançada no período"
          emptyDescription="A produtividade por colaborador precisa da receita do contas a receber. Sem ela, só o custo médio é apurável — e ele já aparece acima."
          legend={[
            { label: 'Receita / colaborador', color: palette.success },
            { label: 'Custo / colaborador', color: palette.info },
          ]}
        >
          <FinanceLineChart
            categories={periods}
            series={[
              {
                name: 'Receita / colaborador',
                data: data.map((d) => d.revenuePerEmployee),
                tone: 'success',
              },
              {
                name: 'Custo / colaborador',
                data: data.map((d) => d.costPerEmployee),
                tone: 'info',
              },
            ]}
            height={252}
          />
        </WorkforceChartCard>

        <WorkforceChartCard
          title="Folha sobre receita"
          subtitle={`Parcela da receita comprometida com a folha — limite de política em ${threshold}%`}
          height={260}
          isEmpty={!data.some((d) => d.payrollAsRevenuePct > 0)}
          emptyTitle="Razão não apurável"
          emptyDescription="A razão folha/receita precisa das duas pontas. Sem receita lançada, exibir 0% seria ler a folha como irrisória diante do faturamento — o oposto do que se sabe."
          legend={[
            { label: 'Folha / receita', color: palette.warning },
            { label: `Limite (${threshold}%)`, color: palette.danger },
          ]}
        >
          <FinanceLineChart
            categories={periods}
            series={[
              {
                name: 'Folha / receita',
                data: data.map((d) => d.payrollAsRevenuePct),
                tone: 'warning',
              },
              // A linha de limite é constante de propósito: ela é a régua, e ver
              // a série cruzá-la é a leitura inteira deste gráfico.
              {
                name: `Limite (${threshold}%)`,
                data: data.map(() => threshold),
                tone: 'danger',
              },
            ]}
            height={252}
          />
        </WorkforceChartCard>
      </div>
    </div>
  );
}
