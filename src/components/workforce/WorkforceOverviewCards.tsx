'use client';

import {
  Users, DollarSign, TrendingUp, Percent,
  Activity, Clock, HeartPulse, ShieldAlert,
} from 'lucide-react';
import { formatWorkforceCurrency, WorkforceMetrics } from '@/lib/workforce-data';
import type { WorkforcePeriodMeta } from '@/lib/workforce/period';
import { cn } from '@/lib/utils';
import { HudKpiStrip, type KpiItem } from '@/components/hud';

interface ExtendedKpiProps {
  turnoverPct?: number;
  overtimePct?: number;
  benefitsTotal?: number;
  chargesTotal?: number;
  revenuePerEmployee?: number;
  directPayrollPct?: number;
  indirectPayrollPct?: number;
}

/**
 * Terceira linha — conformidade e pessoas.
 *
 * Cada campo é opcional porque cada um tem uma fonte diferente, com permissão
 * diferente, e qualquer uma pode faltar sozinha. `undefined` significa "sem
 * fonte" e sai como `–` sem tom semântico; um zero aqui afirmaria que não há
 * CAT, não há ASO vencido e ninguém está sem reajuste — três coisas que
 * ninguém mediu.
 */
export interface ComplianceKpiProps {
  admissions?: number;
  terminations?: number;
  activeAbsences?: number;
  catsInMonth?: number;
  asoExpired?: number;
  asoExpiring?: number;
  workersWithoutAso?: number;
  withoutRaise12m?: number;
  /** Estado da competência corrente: importada, parcial ou faltante. */
  competenceState?: 'complete' | 'partial' | 'missing';
  competenceLabel?: string;
}

interface WorkforceOverviewCardsProps {
  data: WorkforceMetrics;
  meta?: WorkforcePeriodMeta;
  extended?: ExtendedKpiProps;
  /** Linha 3 — omitida por inteiro quando não há nenhuma fonte de conformidade. */
  compliance?: ComplianceKpiProps;
  className?: string;
  /** Torna cada KPI clicável (padrão Contratos) — o pai decide a ação por id. */
  onKpiClick?: (id: string) => void;
}

/** Anexa o clique do KPI (padrão Contratos) quando o pai fornece o handler. */
function withKpiClick(kpis: KpiItem[], onKpiClick?: (id: string) => void): KpiItem[] {
  if (!onKpiClick) return kpis;
  return kpis.map((kpi) => ({ ...kpi, onClick: () => onKpiClick(kpi.id) }));
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

export function WorkforceOverviewCards({ data, meta, extended = {}, compliance, className, onKpiClick }: WorkforceOverviewCardsProps) {
  const hasComparison = meta ? meta.hasComparison : true;
  const comparisonLabel = meta?.comparisonLabel || 'vs mês anterior';

  const payrollValue   = data.monthlyPayroll.value;
  const folhaRevPct    = data.payrollAsRevenuePercent.value;
  // Indicador ausente não recebe tom semântico: verde por falta de dado
  // afirma "está bem" sobre algo que não foi medido.
  const turnover       = extended.turnoverPct;
  const overtime       = extended.overtimePct;
  const hasRevenueRatio = folhaRevPct > 0;
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
      variant: extended.revenuePerEmployee ? 'success' : 'default',
      icon: <TrendingUp className="w-5 h-5" />,
      deltaLabel: extended.revenuePerEmployee ? 'Eficiência produtiva' : 'Sem receita lançada no período',
    },
  ];

  // ── Row 2: Risk & Composition ─────────────────────────────────────────
  const riskKpis: KpiItem[] = [
    {
      id: 'payroll-rev',
      // Razão só existe com as duas pontas. Sem receita lançada no contas a
      // receber, "0,0%" seria lido como folha irrisória diante do faturamento.
      label: 'Folha / Receita',
      value: hasRevenueRatio ? `${folhaRevPct.toFixed(1)}%` : '–',
      variant: !hasRevenueRatio
        ? 'default'
        : folhaRevPct >= 35 ? 'danger' : folhaRevPct >= 30 ? 'warning' : 'success',
      icon: <Percent className="w-5 h-5" />,
      deltaLabel: hasRevenueRatio
        ? `Meta: ≤ ${data.payrollAsRevenuePercent.threshold}%`
        : 'Sem receita lançada no período',
    },
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
      value: turnover !== undefined ? `${turnover.toFixed(2)}%` : '–',
      variant: turnover === undefined
        ? 'default'
        : turnover > 3 ? 'danger' : turnover > 2 ? 'warning' : 'success',
      icon: <Activity className="w-5 h-5" />,
      deltaLabel: 'Rotatividade mensal',
    },
    {
      id: 'overtime',
      label: 'Horas Extras',
      value: overtime !== undefined ? `${overtime.toFixed(1)}%` : '–',
      variant: overtime === undefined ? 'default' : overtime > 12 ? 'warning' : 'info',
      icon: <Clock className="w-5 h-5" />,
      deltaLabel: '% do total trabalhado',
    },
  ];

  // ── Row 3: Conformidade & Pessoas ─────────────────────────────────────
  //
  // A linha inteira some quando NENHUMA das fontes respondeu. Meia dúzia de
  // traços não é informação: é ruído que ensina a ignorar a faixa.
  const c = compliance ?? {};
  const hasCompliance = Object.entries(c).some(
    ([key, value]) => key !== 'competenceLabel' && value !== undefined,
  );

  /** `–` sem tom semântico quando a fonte não respondeu. */
  const abs = (value: number | undefined) => (value === undefined ? '–' : value);
  const tone = (value: number | undefined, threshold = 0): KpiItem['variant'] =>
    value === undefined ? 'default' : value > threshold ? 'warning' : 'default';

  const COMPETENCE_META: Record<
    NonNullable<ComplianceKpiProps['competenceState']>,
    { label: string; variant: KpiItem['variant'] }
  > = {
    complete: { label: 'Importada', variant: 'success' },
    partial: { label: 'Parcial', variant: 'warning' },
    missing: { label: 'Faltante', variant: 'danger' },
  };

  const complianceKpis: KpiItem[] = [
    {
      id: 'movement',
      label: 'Admissões · Desligamentos',
      value:
        c.admissions === undefined && c.terminations === undefined
          ? '–'
          : `${abs(c.admissions)} · ${abs(c.terminations)}`,
      variant: 'default',
      icon: <Users className="w-5 h-5" />,
      deltaLabel: 'Na competência apurada',
    },
    {
      id: 'absences',
      label: 'Afastamentos no mês',
      value: abs(c.activeAbsences),
      variant: 'default',
      icon: <Activity className="w-5 h-5" />,
      deltaLabel: c.activeAbsences === undefined ? 'Sem apuração de afastamento' : 'Eventos S-2230',
    },
    {
      id: 'cats',
      label: 'CATs no mês',
      value: abs(c.catsInMonth),
      variant: c.catsInMonth === undefined ? 'default' : c.catsInMonth > 0 ? 'danger' : 'default',
      icon: <ShieldAlert className="w-5 h-5" />,
      deltaLabel: c.catsInMonth === undefined ? 'Sem eventos de SST no acervo' : 'Acidentes comunicados',
    },
    {
      id: 'aso',
      label: 'ASOs vencidos · a vencer',
      value:
        c.asoExpired === undefined && c.asoExpiring === undefined
          ? '–'
          : `${abs(c.asoExpired)} · ${abs(c.asoExpiring)}`,
      variant: tone(c.asoExpired),
      icon: <HeartPulse className="w-5 h-5" />,
      deltaLabel:
        c.workersWithoutAso !== undefined && c.workersWithoutAso > 0
          ? `${c.workersWithoutAso} sem ASO no acervo`
          : 'Vencimento apurável apenas no periódico',
    },
    {
      id: 'raise',
      label: 'Sem reajuste há +12 meses',
      value: abs(c.withoutRaise12m),
      variant: tone(c.withoutRaise12m),
      icon: <TrendingUp className="w-5 h-5" />,
      deltaLabel:
        c.withoutRaise12m === undefined
          ? 'Série salarial indisponível'
          : 'Comprovado pela série de folha',
    },
    {
      id: 'competence',
      label: 'Competência eSocial',
      value: c.competenceState ? COMPETENCE_META[c.competenceState].label : '–',
      variant: c.competenceState ? COMPETENCE_META[c.competenceState].variant : 'default',
      icon: <Percent className="w-5 h-5" />,
      deltaLabel: c.competenceLabel ?? 'Sem competência apurada',
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
        <HudKpiStrip kpis={withKpiClick(primaryKpis, onKpiClick)} columns={4} />
      </div>

      {/* Row 2 — Risk & Composition */}
      <div className="space-y-1.5">
        <KpiGroupDivider label="Risco & Composição" />
        <HudKpiStrip kpis={withKpiClick(riskKpis, onKpiClick)} columns={4} />
      </div>

      {/* Row 3 — Compliance & People. Ausente quando nenhuma fonte respondeu. */}
      {hasCompliance && (
        <div className="space-y-1.5">
          <KpiGroupDivider label="Conformidade & Pessoas" />
          <HudKpiStrip kpis={withKpiClick(complianceKpis, onKpiClick)} columns={3} />
        </div>
      )}
    </div>
  );
}
