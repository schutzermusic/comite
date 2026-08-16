'use client';

/**
 * Distribuição por lotação, no kit SVG compartilhado.
 *
 * Duas perguntas: onde a rotatividade se concentra (ranking por participação
 * nos desligamentos) e como as faltas se distribuem ao longo dos meses
 * (barras empilhadas por área).
 *
 * O ranking usa participação, não só a taxa: uma área de três pessoas com um
 * desligamento tem turnover de 33% e pesa pouco no total; a leitura de risco
 * precisa das duas coisas lado a lado.
 */

import { useMemo } from 'react';
import {
  FinanceRankMatrix,
  FinanceStackedBarChart,
  PALETTE_DARK,
  PALETTE_LIGHT,
  useChartTheme,
  type RankRow,
  type StackedBarSeries,
} from '@/components/finance/shared';
import { cn } from '@/lib/utils';
import { WorkforceChartCard } from './overview/WorkforceChartCard';
import type { AbsenteeismMonthlyPoint, AreaTurnoverPoint } from '@/lib/workforce/period';

interface TurnoverByAreaPanelProps {
  turnoverByArea: AreaTurnoverPoint[];
  absenteeismMonthly: AbsenteeismMonthlyPoint[];
  className?: string;
}

const STACK_TONES = ['accent', 'success', 'info', 'budget', 'warning', 'danger'] as const;

export function TurnoverByAreaPanel({
  turnoverByArea,
  absenteeismMonthly,
  className,
}: TurnoverByAreaPanelProps) {
  const { isLight } = useChartTheme();
  const palette = isLight ? PALETTE_LIGHT : PALETTE_DARK;

  const rows = useMemo<RankRow[]>(
    () =>
      turnoverByArea.map((a) => ({
        id: a.id,
        label: a.area,
        value: a.sharePct,
        meta: `${a.headcount} colaborador${a.headcount === 1 ? '' : 'es'} · ${a.dismissals} desligamento${a.dismissals === 1 ? '' : 's'}`,
        secondaryLabel: 'turnover',
        secondary: `${a.turnoverPct.toFixed(2).replace('.', ',')}%`,
        tone: a.turnoverPct > 3 ? 'danger' : a.turnoverPct > 2 ? 'warning' : 'accent',
      })),
    [turnoverByArea],
  );

  /** Áreas presentes em qualquer mês — definem as séries empilhadas. */
  const absenteeismSeries = useMemo<StackedBarSeries[]>(() => {
    const areaNames = [...new Set(absenteeismMonthly.flatMap((m) => m.areas.map((a) => a.area)))];
    return areaNames.map((name, i) => ({
      name,
      tone: STACK_TONES[i % STACK_TONES.length],
      data: absenteeismMonthly.map(
        (m) => m.areas.find((a) => a.area === name)?.days ?? 0,
      ),
    }));
  }, [absenteeismMonthly]);

  return (
    <div className={cn('grid grid-cols-1 gap-4 xl:grid-cols-2', className)}>
      <WorkforceChartCard
        title="Rotatividade por lotação"
        subtitle="Participação nos desligamentos do período e taxa de cada área"
        height={Math.max(240, Math.min(turnoverByArea.length, 8) * 44)}
        isEmpty={turnoverByArea.length === 0}
        emptyTitle="Rotatividade por área não apurada"
        emptyDescription="A abertura por lotação precisa de desligamentos declarados (S-2299) com a área do trabalhador resolvida na competência."
      >
        <FinanceRankMatrix
          rows={rows}
          mode="progress"
          valueFormatter={(v) => `${v.toFixed(1).replace('.', ',')}%`}
          headers={{ label: 'Lotação', bar: 'Participação nos desligamentos', secondary: 'Taxa' }}
          axisFormatter={(v) => `${Math.round(v)}%`}
        />
      </WorkforceChartCard>

      <WorkforceChartCard
        title="Faltas por lotação, mês a mês"
        subtitle="Dias-homem de afastamento declarados no S-2230"
        height={300}
        scrollX
        isEmpty={absenteeismMonthly.length === 0 || absenteeismSeries.length === 0}
        emptyTitle="Faltas não apuradas"
        emptyDescription="Os afastamentos vêm do evento S-2230 do eSocial, abertos por lotação. Nenhuma competência do período trouxe esses eventos."
        legend={absenteeismSeries.slice(0, 6).map((s, i) => ({
          label: s.name,
          color: palette[STACK_TONES[i % STACK_TONES.length]],
        }))}
      >
        <FinanceStackedBarChart
          categories={absenteeismMonthly.map((m) => m.period)}
          series={absenteeismSeries}
          height={292}
        />
      </WorkforceChartCard>
    </div>
  );
}
