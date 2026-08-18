'use client';

/**
 * Evolução e composição da folha, no kit SVG compartilhado.
 *
 * Cinco leituras em abas, porque são cinco perguntas distintas sobre o mesmo
 * dinheiro: quanto no mês, quanto acumulado contra o período anterior, de que
 * é feito, como se compara à receita e o que os benefícios representam.
 *
 * A aba indisponível é DESABILITADA em vez de sumir. Uma aba que aparece e
 * desaparece conforme o filtro lê como bug; desabilitada com o motivo no
 * tooltip, ela ensina que a composição depende da classificação de rubricas.
 */

import { useMemo, useState } from 'react';
import { Activity, BarChart2, Layers, Leaf, TrendingUp } from 'lucide-react';
import {
  FinanceDonutChart,
  FinanceLineChart,
  FinanceSCurveChart,
  FinanceStackedBarChart,
  PALETTE_DARK,
  PALETTE_LIGHT,
  useChartTheme,
} from '@/components/finance/shared';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { WorkforceChartCard } from './overview/WorkforceChartCard';
import type {
  BenefitTypePoint,
  PayrollCompositionPoint,
  PayrollVsRevenuePoint,
  SCurvePoint,
} from '@/lib/workforce/period';

type Tab = 'trend' | 'scurve' | 'composition' | 'vs-revenue' | 'benefits';

interface PayrollEvolutionPanelProps {
  composition: PayrollCompositionPoint[];
  scurve: SCurvePoint[];
  vsRevenue: PayrollVsRevenuePoint[];
  benefits: BenefitTypePoint[];
  currency?: string;
  className?: string;
}

const BENEFIT_LABEL: Record<keyof Omit<BenefitTypePoint, 'period'>, string> = {
  va: 'Vale-alimentação',
  vr: 'Vale-refeição',
  health: 'Saúde',
  dental: 'Odontológico',
  transport: 'Transporte',
  other: 'Outros',
};

export function PayrollEvolutionPanel({
  composition,
  scurve,
  vsRevenue,
  benefits,
  currency = 'BRL',
  className,
}: PayrollEvolutionPanelProps) {
  const { isLight } = useChartTheme();
  const palette = isLight ? PALETTE_LIGHT : PALETTE_DARK;

  const availability: Record<Tab, boolean> = {
    trend: composition.length > 0,
    scurve: scurve.length > 0,
    composition: composition.length > 0,
    'vs-revenue': vsRevenue.some((d) => d.revenue > 0),
    benefits: benefits.length > 0,
  };

  const TABS: { id: Tab; label: string; icon: typeof TrendingUp; unavailable: string }[] = [
    { id: 'trend', label: 'Folha mensal', icon: TrendingUp, unavailable: 'Sem competência com folha classificada' },
    { id: 'scurve', label: 'Curva S', icon: Activity, unavailable: 'Sem competência apurada para acumular' },
    { id: 'composition', label: 'Composição', icon: Layers, unavailable: 'Rubricas não classificadas pelo S-1010' },
    { id: 'vs-revenue', label: 'Folha vs Receita', icon: BarChart2, unavailable: 'Sem receita lançada no período' },
    { id: 'benefits', label: 'Benefícios', icon: Leaf, unavailable: 'Benefícios não classificados por natureza' },
  ];

  const firstAvailable = TABS.find((t) => availability[t.id])?.id ?? 'trend';
  const [tab, setTab] = useState<Tab>(firstAvailable);
  const activeTab = availability[tab] ? tab : firstAvailable;

  const periods = useMemo(() => composition.map((d) => d.period), [composition]);
  const payrollTotals = useMemo(
    () => composition.map((d) => d.salary + d.benefits + d.charges),
    [composition],
  );

  /** Benefícios somados no período — o donut lê o acumulado, não o último mês. */
  const benefitSlices = useMemo(() => {
    const keys = Object.keys(BENEFIT_LABEL) as (keyof typeof BENEFIT_LABEL)[];
    const tones = ['accent', 'success', 'info', 'budget', 'warning', 'danger'] as const;
    return keys
      .map((key, i) => ({
        name: BENEFIT_LABEL[key],
        value: benefits.reduce((sum, b) => sum + b[key], 0),
        tone: tones[i % tones.length],
      }))
      .filter((s) => s.value > 0);
  }, [benefits]);

  const benefitsTotal = benefitSlices.reduce((s, b) => s + b.value, 0);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const enabled = availability[t.id];
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!enabled}
              title={enabled ? undefined : t.unavailable}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                !enabled
                  ? 'cursor-not-allowed border-ig-border-subtle/50 text-ig-fg-disabled opacity-60'
                  : active
                    ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
                    : 'border-ig-border-subtle text-ig-fg-muted hover:text-ig-fg-strong',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'trend' && (
        <WorkforceChartCard
          title="Folha mensal"
          subtitle="Massa total por competência"
          height={300}
          isEmpty={!availability.trend}
          emptyTitle="Folha não classificada"
          emptyDescription="A evolução mensal usa a folha com verbas classificadas. Nenhuma competência do período trouxe essa classificação."
          legend={[{ label: 'Folha total', color: palette.accent }]}
        >
          <FinanceLineChart
            categories={periods}
            series={[{ name: 'Folha', data: payrollTotals, tone: 'accent' }]}
            height={292}
          />
        </WorkforceChartCard>
      )}

      {activeTab === 'scurve' && (
        <WorkforceChartCard
          title="Curva S acumulada"
          subtitle="Folha acumulada no período contra a janela anterior de mesmo tamanho"
          height={300}
          isEmpty={!availability.scurve}
          emptyTitle="Sem competência para acumular"
          emptyDescription="A Curva S precisa de competências apuradas no período selecionado."
          legend={[
            { label: 'Período atual', color: palette.accent },
            { label: 'Período anterior', color: palette.info },
          ]}
        >
          <FinanceSCurveChart
            categories={scurve.map((d) => d.period)}
            series={[
              {
                name: 'Período atual',
                // A série já vem acumulada do seletor; o componente acumula de
                // novo, então entra a diferença entre pontos.
                values: scurve.map((d, i) => d.cumulative - (i > 0 ? scurve[i - 1].cumulative : 0)),
                tone: 'accent',
                emphasized: true,
              },
              ...(scurve.some((d) => d.cumulativePrev !== null)
                ? [
                    {
                      name: 'Período anterior',
                      values: scurve.map((d, i) => {
                        const cur = d.cumulativePrev ?? 0;
                        const prev = i > 0 ? (scurve[i - 1].cumulativePrev ?? 0) : 0;
                        return cur - prev;
                      }),
                      tone: 'info' as const,
                      dashed: true,
                    },
                  ]
                : []),
            ]}
            height={292}
          />
        </WorkforceChartCard>
      )}

      {activeTab === 'composition' && (
        <WorkforceChartCard
          title="Composição da folha"
          subtitle="Salário, benefícios e encargos por competência"
          height={300}
          isEmpty={!availability.composition}
          emptyTitle="Rubricas não classificadas"
          emptyDescription="Separar salário, benefícios e encargos depende da tabela de rubricas do eSocial (S-1010). Sem ela, distribuir por percentual seria inventar a composição."
          legend={[
            { label: 'Salário', color: palette.accent },
            { label: 'Benefícios', color: palette.success },
            { label: 'Encargos', color: palette.warning },
          ]}
        >
          <FinanceStackedBarChart
            categories={periods}
            series={[
              { name: 'Salário', data: composition.map((d) => d.salary), tone: 'accent' },
              { name: 'Benefícios', data: composition.map((d) => d.benefits), tone: 'success' },
              { name: 'Encargos', data: composition.map((d) => d.charges), tone: 'warning' },
            ]}
            height={292}
          />
        </WorkforceChartCard>
      )}

      {activeTab === 'vs-revenue' && (
        <WorkforceChartCard
          title="Folha vs Receita"
          subtitle="As duas massas na mesma escala, mês a mês"
          height={300}
          isEmpty={!availability['vs-revenue']}
          emptyTitle="Receita não lançada"
          emptyDescription="O comparativo precisa da receita do contas a receber nas competências do período. Sem ela, o gráfico mostraria a folha contra uma linha em zero."
          legend={[
            { label: 'Folha', color: palette.danger },
            { label: 'Receita', color: palette.success },
          ]}
        >
          <FinanceLineChart
            categories={vsRevenue.map((d) => d.period)}
            series={[
              { name: 'Receita', data: vsRevenue.map((d) => d.revenue), tone: 'success' },
              { name: 'Folha', data: vsRevenue.map((d) => d.payroll), tone: 'danger' },
            ]}
            height={292}
          />
        </WorkforceChartCard>
      )}

      {activeTab === 'benefits' && (
        <WorkforceChartCard
          title="Benefícios por natureza"
          subtitle={`Acumulado do período — ${formatWorkforceCurrency(benefitsTotal, currency)}`}
          height={300}
          isEmpty={!availability.benefits || benefitSlices.length === 0}
          emptyTitle="Benefícios não classificados"
          emptyDescription="A abertura por natureza depende de as rubricas de benefício estarem declaradas no S-1010. Sem isso, o total existe mas não se reparte."
        >
          <FinanceDonutChart
            data={benefitSlices}
            height={292}
            centerLabel="Total"
            centerValue={formatWorkforceCurrency(benefitsTotal, currency)}
          />
        </WorkforceChartCard>
      )}
    </div>
  );
}
