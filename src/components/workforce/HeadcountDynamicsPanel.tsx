'use client';

/**
 * Dinâmica do quadro, no kit SVG compartilhado.
 *
 * Quatro leituras que costumam ser confundidas e aqui ficam separadas:
 * quem entrou e saiu (barras agrupadas + saldo), com que frequência isso se
 * repete (turnover), quem faltou (absenteísmo por lotação) e quanto se
 * trabalhou além (horas extras).
 *
 * Cada gráfico some por conta própria quando a fonte dele não existe. Antes o
 * painel desenhava os quatro sempre, e um eixo sem série é indistinguível de um
 * eixo cujo valor é zero.
 */

import { useMemo } from 'react';
import {
  FinanceBarChart,
  FinanceLineChart,
  PALETTE_DARK,
  PALETTE_LIGHT,
  useChartTheme,
} from '@/components/finance/shared';
import { cn } from '@/lib/utils';
import { WorkforceChartCard } from './overview/WorkforceChartCard';
import type {
  AbsenteeismPoint,
  AdmissionDismissalPoint,
  OvertimePoint,
  TurnoverPoint,
} from '@/lib/workforce/period';

interface HeadcountDynamicsPanelProps {
  admissions: AdmissionDismissalPoint[];
  turnover: TurnoverPoint[];
  absenteeism: AbsenteeismPoint[];
  overtime: OvertimePoint[];
  className?: string;
}

export function HeadcountDynamicsPanel({
  admissions,
  turnover,
  absenteeism,
  overtime,
  className,
}: HeadcountDynamicsPanelProps) {
  const { isLight } = useChartTheme();
  const palette = isLight ? PALETTE_LIGHT : PALETTE_DARK;

  const movementPeriods = useMemo(() => admissions.map((d) => d.period), [admissions]);

  /** Saldo líquido do quadro: o que as duas barras juntas significam. */
  const netTotal = admissions.reduce((sum, d) => sum + d.net, 0);

  return (
    <div className={cn('grid grid-cols-1 gap-4 xl:grid-cols-2', className)}>
      <WorkforceChartCard
        title="Admissões × Desligamentos"
        subtitle={
          admissions.length > 0
            ? `Saldo do período: ${netTotal > 0 ? '+' : ''}${netTotal} colaborador${Math.abs(netTotal) === 1 ? '' : 'es'}`
            : undefined
        }
        height={260}
        isEmpty={admissions.length === 0}
        emptyTitle="Movimentação não apurada"
        emptyDescription="Admissões e desligamentos vêm dos eventos S-2200 e S-2299 do eSocial. Nenhuma competência do período trouxe esses eventos."
        legend={[
          { label: 'Admissões', color: palette.success },
          { label: 'Desligamentos', color: palette.danger },
        ]}
      >
        <FinanceBarChart
          categories={movementPeriods}
          series={[
            { name: 'Admissões', data: admissions.map((d) => d.admissions), tone: 'success' },
            { name: 'Desligamentos', data: admissions.map((d) => d.dismissals), tone: 'danger' },
          ]}
          height={252}
        />
      </WorkforceChartCard>

      <WorkforceChartCard
        title="Turnover mensal"
        subtitle="Desligamentos sobre o quadro da competência"
        height={260}
        isEmpty={turnover.length === 0}
        emptyTitle="Turnover não apurado"
        emptyDescription="A rotatividade precisa de desligamentos declarados e de quadro apurado na mesma competência."
        legend={[{ label: '% do quadro', color: palette.warning }]}
      >
        <FinanceLineChart
          categories={turnover.map((d) => d.period)}
          series={[{ name: 'Turnover', data: turnover.map((d) => d.turnoverPct), tone: 'warning' }]}
          height={252}
        />
      </WorkforceChartCard>

      <WorkforceChartCard
        title="Absenteísmo por lotação"
        subtitle="Dias de afastamento sobre os dias úteis do período"
        height={Math.max(240, Math.min(absenteeism.length, 8) * 34 + 80)}
        isEmpty={absenteeism.length === 0}
        emptyTitle="Absenteísmo não apurado"
        emptyDescription="As faltas vêm dos afastamentos declarados no S-2230, abertos por lotação. Nenhuma competência do período trouxe esses eventos."
        legend={[{ label: '% de ausência', color: palette.danger }]}
      >
        <FinanceBarChart
          categories={absenteeism.map((d) => d.area)}
          series={[{ name: 'Absenteísmo', data: absenteeism.map((d) => d.pct), tone: 'danger' }]}
          horizontal
          height={Math.max(232, Math.min(absenteeism.length, 8) * 34 + 72)}
        />
      </WorkforceChartCard>

      <WorkforceChartCard
        title="Horas extras"
        subtitle="Participação das horas extras na massa salarial"
        height={260}
        isEmpty={overtime.length === 0}
        emptyTitle="Horas extras não classificadas"
        emptyDescription="Identificar a verba de hora extra depende da tabela de rubricas do eSocial (S-1010) classificando a folha. Sem ela, exibir 0% afirmaria que ninguém fez hora extra."
        legend={[{ label: '% da massa', color: palette.accent }]}
      >
        <FinanceLineChart
          categories={overtime.map((d) => d.period)}
          series={[{ name: 'Horas extras', data: overtime.map((d) => d.overtimePct), tone: 'accent' }]}
          height={252}
        />
      </WorkforceChartCard>
    </div>
  );
}
