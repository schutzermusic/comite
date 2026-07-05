'use client';

import { useMemo, useState } from 'react';
import { PieChart, Plus, MessageCircle } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudButton,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
} from '@/components/hud';
import {
  FinanceFilterBar,
  FinanceInsightCard,
  FinanceDetailDrawer, FinanceDrawerSection, FinanceDrawerKeyValue,
  FinanceLineChart,
  FinanceTreemapChart,
  FinanceDonutChart,
  FinanceStackedBarChart,
  FinanceRankMatrix,
  FinanceKpiGrid,
  FinanceChartContainer,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';
import {
  COST_CENTERS,
  COST_CENTERS_MONTHS_REF,
  buildCostCentersKpis,
  buildTopCostCentersTrend,
  type CostCenterMock,
} from '@/lib/finance';
import { CostCenterLedgerSection } from '@/components/finance/cost-analysis';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';

export default function CentrosCustoPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-04');
  const [scenario, setScenario] = useState<FinanceScenario>('budget');
  const [selected, setSelected] = useState<CostCenterMock | null>(null);

  const kpis = useMemo(() => buildCostCentersKpis(COST_CENTERS, '2026-04-30'), []);
  const trendSeries = useMemo(() => buildTopCostCentersTrend(COST_CENTERS, 4), []);
  const totalActual = useMemo(() => COST_CENTERS.reduce((a, c) => a + c.actual, 0), []);

  return (
    <HudPageLayout>
      <HudHeader
        title="Centros de Custo"
        subtitle="Execução orçamentária por centro de custo, tendência e responsáveis"
        icon={<PieChart className="w-5 h-5" />}
        iconTint="#EC4899"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Centros de Custo' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        rightSlot={
          <>
            <ExportReportButton
              size="sm"
              variant="primary"
              label="Exportar PDF"
              permission="finance.export"
              fallbackPermission="finance.view"
              build={() => {
                const buckets = new Map<string, number>();
                COST_CENTERS.forEach((c) => c.composition.forEach((x) => buckets.set(x.category, (buckets.get(x.category) || 0) + x.value)));
                return openFinanceReport({
                  title: 'Centros de Custo',
                  fileContext: 'centros-custo',
                  context: 'Orçado x realizado e concentração de custos por centro',
                  kpis: kpis.map((k) => kpiFromHud(k)),
                  sections: [{
                    title: 'Centros de Custo',
                    charts: [{
                      title: 'Composição por categoria',
                      spec: { kind: 'donut', valueFmt: 'compactCurrency', slices: Array.from(buckets.entries()).map(([label, value]) => ({ label, value })) },
                    }],
                    tables: [{
                      columns: [
                        { key: 'code', label: 'CC' },
                        { key: 'name', label: 'Nome' },
                        { key: 'director', label: 'Diretor' },
                        { key: 'budget', label: 'Orçado', num: true },
                        { key: 'actual', label: 'Realizado', num: true },
                        { key: 'var', label: 'Variação', num: true },
                        { key: 'hc', label: 'Headcount', num: true },
                      ],
                      rows: [...COST_CENTERS].sort((a, b) => b.actual - a.actual).map((c) => ({
                        code: c.code,
                        name: c.name,
                        director: c.director,
                        budget: { html: `<span class="mono">${fmtBRL(c.budget)}</span>` },
                        actual: { html: `<span class="mono">${fmtBRL(c.actual)}</span>` },
                        var: { html: `<span class="mono">${fmtBRL(c.actual - c.budget)}</span>` },
                        hc: String(c.headcount),
                      })),
                    }],
                  }],
                });
              }}
            />
            <HudButton variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>Novo CC</HudButton>
          </>
        }
      />

      <FinanceKpiGrid kpis={kpis} columns={6} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Treemap — Distribuição de custo realizado</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
              <FinanceTreemapChart
                data={COST_CENTERS.map((c) => ({
                  name: `${c.code} ${c.name}`,
                  value: c.actual,
                  tone: c.actual > c.budget ? 'danger' : 'success',
                  deltaPct: ((c.actual - c.budget) / c.budget) * 100,
                }))}
                height={300}
              />
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Composição por categoria — consolidado</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
              <FinanceDonutChart
                data={(() => {
                  const buckets = new Map<string, number>();
                  COST_CENTERS.forEach((c) => c.composition.forEach((x) => buckets.set(x.category, (buckets.get(x.category) || 0) + x.value)));
                  return Array.from(buckets.entries()).map(([name, value], i) => ({
                    name, value,
                    tone: (['danger', 'warning', 'info', 'accent', 'success', 'budget'] as const)[i % 6],
                  }));
                })()}
                centerLabel="Total"
                centerValue={fmtCompactBRL(totalActual)}
                height={300}
              />
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Stacked — Orçado vs Realizado por CC (componentes do realizado)</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceChartContainer>
            <FinanceStackedBarChart
              categories={COST_CENTERS.map((c) => c.code)}
              series={(() => {
                const allCats = Array.from(new Set(COST_CENTERS.flatMap((c) => c.composition.map((x) => x.category))));
                const palette = ['accent', 'info', 'success', 'warning', 'danger', 'budget'] as const;
                return allCats.map((cat, idx) => ({
                  name: cat,
                  tone: palette[idx % palette.length],
                  data: COST_CENTERS.map((c) => c.composition.find((x) => x.category === cat)?.value ?? 0),
                }));
              })()}
              height={280}
            />
          </FinanceChartContainer>
        </HudCardContent>
      </HudCard>

      <HudCard>
        <HudCardHeader><HudCardTitle>Ranking de variância por CC</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceChartContainer>
            <FinanceRankMatrix
              mode="diverging"
              sort="asc"
              headers={{ rank: 'Rank', label: 'Centro de Custo', bar: 'Δ Realizado vs Orçado', secondary: 'Headcount / Orçado' }}
              valueFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
              axisFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
              rows={COST_CENTERS.map((c) => {
                const v = ((c.actual - c.budget) / c.budget) * 100;
                return {
                  id: c.id,
                  label: `${c.code} ${c.name}`,
                  meta: c.director,
                  value: Math.round(v * 10) / 10,
                  tone: (v > 5 ? 'danger' : v > 0 ? 'warning' : 'success') as 'danger' | 'warning' | 'success',
                  secondaryLabel: 'HC • Orçado',
                  secondary: `${c.headcount} • ${fmtCompactBRL(c.budget)}`,
                };
              })}
            />
          </FinanceChartContainer>
        </HudCardContent>
      </HudCard>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Heatmap de execução por CC</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {COST_CENTERS.map((c) => {
                const exec = (c.actual / c.budget) * 100;
                const delta = ((c.actual - c.budget) / c.budget) * 100;
                const tone = exec <= 100 ? 'var(--ig-success)' : exec <= 105 ? 'var(--ig-warning)' : 'var(--ig-danger)';
                const intensity = Math.min(100, Math.abs(delta) * 8);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className="text-left rounded-lg border border-ig-border-subtle p-3 hover:border-ig-border-focus hover:-translate-y-px transition-all min-w-0"
                    style={{ backgroundImage: `linear-gradient(135deg, color-mix(in oklab, ${tone} ${intensity}%, transparent), transparent 60%)` }}
                  >
                    <div className="flex items-center justify-between text-[10.5px] tabular-nums uppercase tracking-[0.12em] text-ig-text-tertiary">
                      <span>{c.code}</span>
                      <span>{c.headcount} HC</span>
                    </div>
                    <div className="mt-1 text-[12.5px] font-medium text-ig-text-primary truncate">{c.name}</div>
                    <div className="mt-1 flex items-center justify-between text-[11.5px] min-w-0">
                      <span className="text-ig-text-secondary tabular-nums truncate">{fmtBRL(c.actual)}</span>
                      <span className={'tabular-nums shrink-0 ' + (delta >= 0 ? 'text-ig-danger' : 'text-ig-success')}>{fmtPct(delta)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Tendência — top 4 centros</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
              <FinanceLineChart categories={COST_CENTERS_MONTHS_REF} series={trendSeries} height={280} />
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Execução por centro de custo</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-0">
            <FinanceChartContainer scrollX>
              <table className="w-full text-sm">
                <thead className="border-b border-ig-border-subtle">
                  <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                    <th className="text-left px-5 py-3 font-medium">Código</th>
                    <th className="text-left px-5 py-3 font-medium">Centro de Custo</th>
                    <th className="text-left px-5 py-3 font-medium">Diretor(a)</th>
                    <th className="text-right px-5 py-3 font-medium">Orçado</th>
                    <th className="text-right px-5 py-3 font-medium">Realizado</th>
                    <th className="text-right px-5 py-3 font-medium">Δ %</th>
                    <th className="text-right px-5 py-3 font-medium">Execução</th>
                    <th className="text-right px-5 py-3 font-medium">HC</th>
                  </tr>
                </thead>
                <tbody>
                  {COST_CENTERS.map((c) => {
                    const exec = (c.actual / c.budget) * 100;
                    const delta = ((c.actual - c.budget) / c.budget) * 100;
                    const tone = delta <= 0 ? 'text-ig-success' : delta <= 5 ? 'text-ig-warning' : 'text-ig-danger';
                    return (
                      <tr key={c.id} onClick={() => setSelected(c)} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer">
                        <td className="px-5 py-2.5 font-mono text-[12px] text-ig-text-secondary whitespace-nowrap">{c.code}</td>
                        <td className="px-5 py-2.5 text-ig-text-primary whitespace-nowrap">{c.name}</td>
                        <td className="px-5 py-2.5 text-ig-text-secondary whitespace-nowrap">{c.director}</td>
                        <td className="text-right px-5 py-2.5 tabular-nums whitespace-nowrap">{fmtBRL(c.budget)}</td>
                        <td className="text-right px-5 py-2.5 tabular-nums whitespace-nowrap">{fmtBRL(c.actual)}</td>
                        <td className={'text-right px-5 py-2.5 tabular-nums whitespace-nowrap ' + tone}>{fmtPct(delta)}</td>
                        <td className="text-right px-5 py-2.5 whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-ig-surface-subtle overflow-hidden">
                              <div className={'h-full ' + (exec <= 100 ? 'bg-ig-success' : exec <= 105 ? 'bg-ig-warning' : 'bg-ig-danger')} style={{ width: `${Math.min(exec, 130)}%` }} />
                            </div>
                            <span className="text-[11px] tabular-nums text-ig-text-secondary">{exec.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="text-right px-5 py-2.5 tabular-nums text-ig-text-secondary whitespace-nowrap">{c.headcount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="Insights de execução"
          subtitle="Sinais por centro de custo"
          insights={[
            { id: '1', tone: 'negative', title: 'Tecnologia em overrun', detail: 'CC-001 4,6% acima do orçado por crescimento de cloud e subcontratação.' },
            { id: '2', tone: 'warning',  title: 'Comercial pressionado', detail: 'CC-003 com comissões variáveis acima do plano em função de bookings.' },
            { id: '3', tone: 'positive', title: 'CS abaixo do orçado', detail: 'CC-004 economizando 4,9% — eficiência em ferramentas SaaS.' },
            { id: '4', tone: 'neutral',  title: 'G&A estável', detail: 'CC-005 dentro de range; honorários jurídicos extraordinários sob revisão.' },
          ]}
        />
      </div>

      <CostCenterLedgerSection />

      <FinanceDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || ''}
        subtitle={selected ? `${selected.code} • ${selected.director}` : ''}
        metaPills={selected ? [
          { label: `Δ ${fmtPct(((selected.actual - selected.budget) / selected.budget) * 100)}`, tone: selected.actual > selected.budget ? 'neg' : 'pos' },
          { label: `HC ${selected.headcount}`, tone: 'info' },
        ] : []}
        primaryActions={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<MessageCircle className="w-4 h-4" />}>Solicitar revisão</HudButton>
            <HudButton variant="primary" size="sm">Abrir lançamentos</HudButton>
          </>
        }
      >
        {selected && (
          <>
            <FinanceDrawerSection title="Resumo">
              <FinanceDrawerKeyValue rows={[
                { label: 'Orçado',     value: fmtBRL(selected.budget) },
                { label: 'Realizado',  value: fmtBRL(selected.actual) },
                { label: 'Δ vs Orç.',  value: fmtPct(((selected.actual - selected.budget) / selected.budget) * 100), tone: selected.actual > selected.budget ? 'neg' : 'pos' },
                { label: 'Execução',   value: `${((selected.actual / selected.budget) * 100).toFixed(1)}%` },
                { label: 'Headcount',  value: selected.headcount.toString() },
                { label: 'Custo / HC', value: fmtBRL(selected.actual / selected.headcount) },
              ]} />
            </FinanceDrawerSection>

            <FinanceDrawerSection title="Composição por categoria">
              <ul className="divide-y divide-ig-border-subtle/60">
                {selected.composition.map((c, idx) => {
                  const total = selected.composition.reduce((a, x) => a + x.value, 0);
                  const share = (c.value / total) * 100;
                  return (
                    <li key={idx} className="py-2 flex items-center justify-between gap-3 min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-ig-text-primary truncate">{c.category}</div>
                        <div className="mt-1 h-1 rounded-full bg-ig-surface-subtle overflow-hidden">
                          <div className="h-full bg-ig-accent" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[12.5px] tabular-nums">{fmtBRL(c.value)}</div>
                        <div className="text-[10.5px] text-ig-text-tertiary">{share.toFixed(1)}%</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </FinanceDrawerSection>
          </>
        )}
      </FinanceDetailDrawer>
    </HudPageLayout>
  );
}
