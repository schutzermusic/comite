'use client';

import { useMemo, useState } from 'react';
import { PieChart, Plus, MessageCircle } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
  type KpiItem,
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
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';

type CostCenter = {
  id: string;
  code: string;
  name: string;
  director: string;
  budget: number;
  actual: number;
  headcount: number;
  trend: number[]; // 6 last months
  composition: { category: string; value: number }[];
};

const CENTERS: CostCenter[] = [
  { id: 'cc1', code: 'CC-001', name: 'Tecnologia & Engenharia',     director: 'Carla Mendes',     budget: 2_400_000, actual: 2_510_000, headcount: 84, trend: [2_310, 2_360, 2_390, 2_440, 2_480, 2_510],
    composition: [ { category: 'Pessoal CLT', value: 1_840_000 }, { category: 'Cloud / Infra', value: 420_000 }, { category: 'Subcontratação', value: 180_000 }, { category: 'Treinamento', value: 70_000 } ] },
  { id: 'cc2', code: 'CC-002', name: 'Operações',                    director: 'Felipe Araújo',    budget: 1_850_000, actual: 1_790_000, headcount: 62, trend: [1_780, 1_810, 1_820, 1_790, 1_770, 1_790],
    composition: [ { category: 'Pessoal CLT', value: 1_410_000 }, { category: 'Estrutura', value: 220_000 }, { category: 'Materiais', value: 160_000 } ] },
  { id: 'cc3', code: 'CC-003', name: 'Comercial & Pré-Vendas',      director: 'Renata Souza',     budget: 1_240_000, actual: 1_310_000, headcount: 38, trend: [1_180, 1_210, 1_240, 1_280, 1_300, 1_310],
    composition: [ { category: 'Pessoal CLT', value: 880_000 }, { category: 'Comissões', value: 320_000 }, { category: 'Eventos', value: 110_000 } ] },
  { id: 'cc4', code: 'CC-004', name: 'Customer Success',             director: 'Diego Lopes',      budget: 780_000,   actual: 742_000,   headcount: 24, trend: [710, 720, 740, 750, 745, 742],
    composition: [ { category: 'Pessoal CLT', value: 590_000 }, { category: 'Ferramentas', value: 92_000 }, { category: 'Viagens', value: 60_000 } ] },
  { id: 'cc5', code: 'CC-005', name: 'G&A — Administrativo',         director: 'Beatriz Tavares',  budget: 540_000,   actual: 552_000,   headcount: 18, trend: [510, 520, 525, 540, 548, 552],
    composition: [ { category: 'Pessoal CLT', value: 380_000 }, { category: 'Jurídico', value: 88_000 }, { category: 'Auditoria', value: 84_000 } ] },
  { id: 'cc6', code: 'CC-006', name: 'Marketing & Branding',         director: 'Henrique Vidal',   budget: 420_000,   actual: 396_000,   headcount: 11, trend: [380, 390, 400, 405, 398, 396],
    composition: [ { category: 'Mídia paga', value: 220_000 }, { category: 'Conteúdo', value: 96_000 }, { category: 'Eventos', value: 80_000 } ] },
  { id: 'cc7', code: 'CC-007', name: 'Risco, Compliance & Auditoria', director: 'Patrícia Lemos', budget: 360_000,   actual: 348_000,   headcount: 9,  trend: [330, 335, 340, 345, 348, 348],
    composition: [ { category: 'Pessoal CLT', value: 268_000 }, { category: 'Auditoria externa', value: 80_000 } ] },
];

const MONTHS_REF = ['Nov', 'Dez', 'Jan', 'Fev', 'Mar', 'Abr'];

export default function CentrosCustoPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-04');
  const [scenario, setScenario] = useState<FinanceScenario>('budget');
  const [selected, setSelected] = useState<CostCenter | null>(null);

  const totalBudget = CENTERS.reduce((a, c) => a + c.budget, 0);
  const totalActual = CENTERS.reduce((a, c) => a + c.actual, 0);
  const totalHc = CENTERS.reduce((a, c) => a + c.headcount, 0);
  const overruns = CENTERS.filter((c) => c.actual > c.budget).length;

  const kpis: KpiItem[] = [
    { id: 'n', label: 'Centros de Custo', value: CENTERS.length.toString(), variant: 'info', tintValue: true },
    { id: 'b', label: 'Orçado total', value: fmtBRL(totalBudget), variant: 'info', tintValue: true },
    { id: 'a', label: 'Realizado total', value: fmtBRL(totalActual), variant: 'warning', tintValue: true },
    { id: 'd', label: 'Δ vs Orçado', value: fmtPct(((totalActual - totalBudget) / totalBudget) * 100), variant: totalActual > totalBudget ? 'danger' : 'success', tintValue: true },
    { id: 'h', label: 'Headcount', value: totalHc.toString(), variant: 'info', tintValue: true },
    { id: 'o', label: 'Em overrun', value: overruns.toString(), variant: overruns > 0 ? 'warning' : 'success', tintValue: true },
  ];

  const trendSeries = useMemo(() => {
    const top4 = [...CENTERS].sort((a, b) => b.actual - a.actual).slice(0, 4);
    return top4.map((c, idx) => ({
      name: c.name,
      data: c.trend.map((v) => v * 1000),
      tone: (['accent', 'info', 'success', 'warning'] as const)[idx],
    }));
  }, []);

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
        rightSlot={<HudButton variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>Novo CC</HudButton>}
      />

      <HudKpiStrip kpis={kpis} columns={6} connected align="center" />

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Treemap — Distribuição de custo realizado</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceTreemapChart
              data={CENTERS.map((c) => ({
                name: `${c.code} ${c.name}`,
                value: c.actual,
                tone: c.actual > c.budget ? 'danger' : 'success',
                deltaPct: ((c.actual - c.budget) / c.budget) * 100,
              }))}
              height={300}
            />
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Composição por categoria — consolidado</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceDonutChart
              data={(() => {
                const buckets = new Map<string, number>();
                CENTERS.forEach((c) => c.composition.forEach((x) => buckets.set(x.category, (buckets.get(x.category) || 0) + x.value)));
                return Array.from(buckets.entries()).map(([name, value], i) => ({
                  name, value,
                  tone: (['danger', 'warning', 'info', 'accent', 'success', 'budget'] as const)[i % 6],
                }));
              })()}
              centerLabel="Total"
              centerValue={fmtCompactBRL(totalActual)}
              height={300}
            />
          </HudCardContent>
        </HudCard>
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Stacked — Orçado vs Realizado por CC (componentes do realizado)</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceStackedBarChart
            categories={CENTERS.map((c) => c.code)}
            series={(() => {
              const allCats = Array.from(new Set(CENTERS.flatMap((c) => c.composition.map((x) => x.category))));
              const palette = ['accent', 'info', 'success', 'warning', 'danger', 'budget'] as const;
              return allCats.map((cat, idx) => ({
                name: cat,
                tone: palette[idx % palette.length],
                data: CENTERS.map((c) => c.composition.find((x) => x.category === cat)?.value ?? 0),
              }));
            })()}
            height={280}
          />
        </HudCardContent>
      </HudCard>

      <HudCard>
        <HudCardHeader><HudCardTitle>Ranking de variância por CC</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceRankMatrix
            mode="diverging"
            sort="asc"
            headers={{ rank: 'Rank', label: 'Centro de Custo', bar: 'Δ Realizado vs Orçado', secondary: 'Headcount / Orçado' }}
            valueFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
            axisFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
            rows={CENTERS.map((c) => {
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
        </HudCardContent>
      </HudCard>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Heatmap de execução por CC</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {CENTERS.map((c) => {
                const exec = (c.actual / c.budget) * 100;
                const delta = ((c.actual - c.budget) / c.budget) * 100;
                const tone = exec <= 100 ? 'var(--ig-success)' : exec <= 105 ? 'var(--ig-warning)' : 'var(--ig-danger)';
                const intensity = Math.min(100, Math.abs(delta) * 8);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className="text-left rounded-lg border border-ig-border-subtle p-3 hover:border-ig-border-focus transition-colors"
                    style={{ backgroundImage: `linear-gradient(135deg, color-mix(in oklab, ${tone} ${intensity}%, transparent), transparent 60%)` }}
                  >
                    <div className="flex items-center justify-between text-[10.5px] font-mono uppercase tracking-[0.12em] text-ig-text-tertiary">
                      <span>{c.code}</span>
                      <span>{c.headcount} HC</span>
                    </div>
                    <div className="mt-1 text-[12.5px] font-medium text-ig-text-primary truncate">{c.name}</div>
                    <div className="mt-1 flex items-center justify-between text-[11.5px]">
                      <span className="text-ig-text-secondary font-mono">{fmtBRL(c.actual)}</span>
                      <span className={'font-mono tabular-nums ' + (delta >= 0 ? 'text-ig-danger' : 'text-ig-success')}>{fmtPct(delta)}</span>
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
            <FinanceLineChart categories={MONTHS_REF} series={trendSeries} height={280} />
          </HudCardContent>
        </HudCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Execução por centro de custo</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-0">
            <div className="overflow-x-auto">
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
                  {CENTERS.map((c) => {
                    const exec = (c.actual / c.budget) * 100;
                    const delta = ((c.actual - c.budget) / c.budget) * 100;
                    const tone = delta <= 0 ? 'text-ig-success' : delta <= 5 ? 'text-ig-warning' : 'text-ig-danger';
                    return (
                      <tr key={c.id} onClick={() => setSelected(c)} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer">
                        <td className="px-5 py-2.5 font-mono text-[12px] text-ig-text-secondary">{c.code}</td>
                        <td className="px-5 py-2.5 text-ig-text-primary">{c.name}</td>
                        <td className="px-5 py-2.5 text-ig-text-secondary">{c.director}</td>
                        <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(c.budget)}</td>
                        <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(c.actual)}</td>
                        <td className={'text-right px-5 py-2.5 font-mono tabular-nums ' + tone}>{fmtPct(delta)}</td>
                        <td className="text-right px-5 py-2.5">
                          <div className="inline-flex items-center gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-ig-surface-subtle overflow-hidden">
                              <div className={'h-full ' + (exec <= 100 ? 'bg-ig-success' : exec <= 105 ? 'bg-ig-warning' : 'bg-ig-danger')} style={{ width: `${Math.min(exec, 130)}%` }} />
                            </div>
                            <span className="text-[11px] font-mono text-ig-text-secondary">{exec.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{c.headcount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="Insights de execução"
          subtitle="Sinais por centro de custo"
          insights={[
            { id: '1', tone: 'negative', title: 'Tecnologia em overrun', detail: 'CC-001 4.6% acima do orçado por crescimento de cloud e subcontratação.' },
            { id: '2', tone: 'warning',  title: 'Comercial pressionado', detail: 'CC-003 com comissões variáveis acima do plano em função de bookings.' },
            { id: '3', tone: 'positive', title: 'CS abaixo do orçado', detail: 'CC-004 economizando 4.9% — eficiência em ferramentas SaaS.' },
            { id: '4', tone: 'neutral',  title: 'G&A estável', detail: 'CC-005 dentro de range; honorários jurídicos extraordinários sob revisão.' },
          ]}
        />
      </div>

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
                    <li key={idx} className="py-2 flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] text-ig-text-primary truncate">{c.category}</div>
                        <div className="mt-1 h-1 rounded-full bg-ig-surface-subtle overflow-hidden">
                          <div className="h-full bg-ig-accent" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[12.5px] font-mono tabular-nums">{fmtBRL(c.value)}</div>
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
