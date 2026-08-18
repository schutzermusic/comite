'use client';

/**
 * Faixa executiva de KPIs do cockpit.
 *
 * Consome `WorkforceKpi[]` — o MESMO array que alimenta as faixas do PDF, do
 * deck HTML e do PowerPoint. Antes este componente recebia três shapes de props
 * (`data`, `extended`, `compliance`), formatava cada indicador por conta
 * própria e decidia sozinho o que fazer com a ausência; o relatório fazia tudo
 * de novo, do seu jeito. Duas implementações da mesma leitura divergem — e a
 * divergência aparece justamente na reunião em que alguém compara a tela com o
 * documento impresso.
 *
 * Aqui não há mais decisão a tomar: o modelo já disse o que foi apurado, com
 * que tom e contra que base.
 */

import {
  Activity,
  Clock,
  DollarSign,
  HeartPulse,
  Percent,
  ShieldAlert,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudKpiStrip, type KpiItem } from '@/components/hud';
import { measuredText, unmeasuredNote } from './overview/WorkforceMeasuredValue';
import type { KpiGroup, WorkforceKpi } from '@/lib/workforce/overview/types';

interface WorkforceOverviewCardsProps {
  kpis: WorkforceKpi[];
  periodLabel?: string;
  /** Rótulo da base ativa ('vs mês anterior'), quando existe. */
  comparisonLabel?: string;
  className?: string;
  onKpiClick?: (kpi: WorkforceKpi) => void;
}

const KPI_ICON: Record<string, LucideIcon> = {
  headcount: Users,
  payroll: DollarSign,
  'avg-cost': TrendingUp,
  'payroll-rev': Percent,
  'rev-per-emp': TrendingUp,
  turnover: Activity,
  overtime: Clock,
  absenteeism: Activity,
  concentration: DollarSign,
  movement: Users,
  cats: ShieldAlert,
  aso: HeartPulse,
  raise: TrendingUp,
  compliance: Percent,
};

/**
 * Três níveis, não quinze cartões iguais.
 *
 * A faixa anterior tinha catorze células com o mesmo peso visual, e um cockpit
 * em que tudo é destaque não destaca nada. A hierarquia agora é explícita:
 * o que decide (custo e volume), o que explica (eficiência) e o que obriga
 * (conformidade).
 */
const TIERS: { group: KpiGroup[]; label: string; columns: 2 | 3 | 4 | 5 | 6; size: 'sm' | 'md' | 'lg' }[] = [
  { group: ['custo', 'volume'], label: 'Custo & Quadro', columns: 4, size: 'lg' },
  { group: ['eficiencia'], label: 'Eficiência', columns: 3, size: 'md' },
  { group: ['conformidade'], label: 'Conformidade & Pessoas', columns: 5, size: 'sm' },
];

const TONE_TO_VARIANT: Record<NonNullable<WorkforceKpi['tone']>, KpiItem['variant']> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'default',
};

function KpiGroupDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.16em] text-ig-fg-subtle">
        {label}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-ig-border-subtle to-transparent" />
    </div>
  );
}

/** Traduz um KPI do modelo para a célula da faixa. */
function toKpiItem(kpi: WorkforceKpi, onKpiClick?: (kpi: WorkforceKpi) => void): KpiItem {
  const Icon = KPI_ICON[kpi.id] ?? Activity;
  const isMeasured = kpi.display ? kpi.display.measured : kpi.value.measured;

  // Indicador ausente não recebe tom semântico. Verde por falta de dado
  // afirmaria "está bem" sobre algo que ninguém mediu.
  const variant = isMeasured && kpi.tone ? TONE_TO_VARIANT[kpi.tone] : 'default';

  const delta = kpi.delta.measured ? kpi.delta.value : null;

  return {
    id: kpi.id,
    label: kpi.label,
    value: measuredText(kpi.value, kpi.format, kpi.display),
    format: 'raw',
    variant,
    icon: <Icon className="h-5 w-5" />,
    ...(delta
      ? {
          deltaText: `${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1).replace('.', ',')}%`,
          deltaTone:
            delta.pct === 0
              ? ('neutral' as const)
              : delta.pct > 0 === delta.upIsGood
                ? ('success' as const)
                : ('danger' as const),
          deltaLabel: delta.label,
        }
      : {}),
    // Sem base, o rótulo auxiliar explica a ausência ou traz o acumulado —
    // que é exatamente para isso que `accumulatedLabels` existe.
    ...(delta ? {} : { deltaLabel: isMeasured ? kpi.helper : unmeasuredNote(kpi.display ?? kpi.value) }),
    ...(onKpiClick ? { onClick: () => onKpiClick(kpi) } : {}),
  };
}

export function WorkforceOverviewCards({
  kpis,
  periodLabel,
  comparisonLabel,
  className,
  onKpiClick,
}: WorkforceOverviewCardsProps) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="h-5 w-0.5 shrink-0 rounded-full bg-ig-accent/70" />
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-ig-fg-strong">
              Cockpit Executivo de Pessoas
            </h2>
            <p className="mt-0.5 text-[11px] leading-none text-ig-fg-muted">
              Indicadores-chave{periodLabel ? ` — ${periodLabel}` : ''}
            </p>
          </div>
        </div>
        {comparisonLabel && (
          <span className="rounded-full border border-ig-border-subtle bg-ig-panel px-2.5 py-1 text-[10px] text-ig-fg-subtle">
            △ Variações {comparisonLabel}
          </span>
        )}
      </div>

      {TIERS.map((tier) => {
        const tierKpis = kpis.filter((k) => tier.group.includes(k.group));
        if (tierKpis.length === 0) return null;

        return (
          <div key={tier.label} className="space-y-1.5">
            <KpiGroupDivider label={tier.label} />
            <HudKpiStrip
              kpis={tierKpis.map((k) => toKpiItem(k, onKpiClick))}
              columns={tier.columns}
              size={tier.size}
            />
          </div>
        );
      })}
    </div>
  );
}
