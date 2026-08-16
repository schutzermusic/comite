'use client';

/**
 * Concentração da folha por centro de custo — leitura de Pareto.
 *
 * O ranking usa `FinanceRankMatrix`, que já traz a barra proporcional, o valor
 * formatado e a coluna secundária. Ao lado, a curva acumulada responde a
 * pergunta que o ranking sozinho não responde: quantos centros são necessários
 * para explicar a maior parte da folha.
 *
 * Treemap ficou de fora de propósito — ele esconderia justamente a acumulada,
 * que é o que torna o Top-3 legível como risco de dependência.
 */

import { useMemo } from 'react';
import { AlertTriangle, Building2 } from 'lucide-react';
import {
  FinanceLineChart,
  FinanceRankMatrix,
  PALETTE_DARK,
  PALETTE_LIGHT,
  useChartTheme,
  type RankRow,
} from '@/components/finance/shared';
import { formatWorkforceCurrency, type CostConcentrationData } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { WorkforceChartCard } from './overview/WorkforceChartCard';

interface CostConcentrationPanelProps {
  data: CostConcentrationData;
  /**
   * Se o período tem janela anterior. Sem ela, `growthVsPrevious` vem `0` do
   * seletor, e exibir "0,0%" afirmaria estabilidade onde não houve comparação.
   */
  hasBaseline?: boolean;
  className?: string;
}

/** Acima disso a folha depende de poucos centros a ponto de virar risco. */
const TOP3_WARN = 70;
const TOP3_CRITICAL = 80;

export function CostConcentrationPanel({
  data,
  hasBaseline = true,
  className,
}: CostConcentrationPanelProps) {
  const { isLight } = useChartTheme();
  const palette = isLight ? PALETTE_LIGHT : PALETTE_DARK;

  const sorted = useMemo(
    () => [...data.costCenters].sort((a, b) => b.payrollValue - a.payrollValue),
    [data.costCenters],
  );

  const rows = useMemo<RankRow[]>(
    () =>
      sorted.map((c) => ({
        id: c.id,
        label: c.name,
        value: c.payrollValue,
        meta:
          c.headcount > 0
            ? `${c.headcount} colaborador${c.headcount === 1 ? '' : 'es'}`
            : 'quadro não apurado',
        secondaryLabel: 'variação',
        secondary: hasBaseline
          ? `${c.growthVsPrevious > 0 ? '+' : ''}${c.growthVsPrevious.toFixed(1).replace('.', ',')}%`
          : '–',
        tone: c.isAbnormal ? 'danger' : 'accent',
      })),
    [sorted, hasBaseline],
  );

  /** Curva acumulada: o eixo do Pareto. */
  const cumulative = useMemo(() => {
    const total = data.totalPayroll || 1;
    let acc = 0;
    return sorted.map((c) => {
      acc += c.payrollValue;
      return Number(((acc / total) * 100).toFixed(1));
    });
  }, [sorted, data.totalPayroll]);

  const abnormal = sorted.filter((c) => c.isAbnormal);
  const top3 = data.top3Concentration;
  const top3Tone =
    top3 >= TOP3_CRITICAL ? 'text-ig-danger' : top3 >= TOP3_WARN ? 'text-ig-warning' : 'text-ig-fg-strong';

  const isEmpty = sorted.length === 0;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-ig-border-subtle bg-ig-panel px-4 py-3">
          <span className="shrink-0 rounded-lg bg-ig-accent-weak p-2">
            <Building2 className="h-4 w-4 text-ig-accent" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">
              Centros de custo
            </p>
            <p className="ig-tabular text-lg font-semibold text-ig-fg-strong">{sorted.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-ig-border-subtle bg-ig-panel px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">
              Concentração Top-3
            </p>
            <p className={cn('ig-tabular text-lg font-semibold', top3Tone)}>
              {isEmpty ? '–' : `${top3.toFixed(1).replace('.', ',')}%`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-ig-border-subtle bg-ig-panel px-4 py-3">
          <span
            className={cn(
              'shrink-0 rounded-lg p-2',
              abnormal.length > 0 ? 'bg-ig-danger/10' : 'bg-ig-bg-raised',
            )}
          >
            <AlertTriangle
              className={cn(
                'h-4 w-4',
                abnormal.length > 0 ? 'text-ig-danger' : 'text-ig-fg-subtle',
              )}
            />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-subtle">
              Crescimento atípico
            </p>
            <p className="ig-tabular text-lg font-semibold text-ig-fg-strong">{abnormal.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <WorkforceChartCard
          title="Folha por centro de custo"
          subtitle={`Total de ${formatWorkforceCurrency(data.totalPayroll, data.currency)} no período`}
          height={Math.max(220, Math.min(sorted.length, 10) * 44)}
          isEmpty={isEmpty}
          emptyTitle="Sem abertura por centro de custo"
          emptyDescription="A concentração vem do rateio do lote de folha aprovado ou da lotação tributária apurada no eSocial. Nenhuma das duas trouxe abertura no período."
        >
          <FinanceRankMatrix
            rows={rows}
            mode="progress"
            valueFormatter={(v) => formatWorkforceCurrency(v, data.currency)}
            headers={{ label: 'Centro de custo', bar: 'Participação na folha', secondary: 'Variação' }}
            axisFormatter={(v) => formatWorkforceCurrency(v, data.currency)}
          />
        </WorkforceChartCard>

        <WorkforceChartCard
          title="Curva acumulada"
          subtitle="Quantos centros explicam a maior parte da folha"
          height={260}
          isEmpty={isEmpty}
          emptyTitle="Curva indisponível"
          emptyDescription="Sem centros de custo apurados não há concentração a acumular."
          legend={[{ label: '% acumulado da folha', color: palette.accent }]}
        >
          <FinanceLineChart
            categories={sorted.map((c) => c.name)}
            series={[{ name: '% acumulado', data: cumulative, tone: 'accent' }]}
            height={252}
          />
        </WorkforceChartCard>
      </div>
    </div>
  );
}
