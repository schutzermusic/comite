'use client';

import { Fragment, useMemo, useState } from 'react';
import { LineChart, Download, ChevronRight, ExternalLink } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
  type KpiItem,
} from '@/components/hud';
import {
  FinanceFilterBar,
  FinanceInsightCard,
  FinanceDetailDrawer, FinanceDrawerSection, FinanceDrawerKeyValue,
  FinanceAdvancedWaterfallChart,
  FinanceDonutChart,
  FinanceSCurveChart,
  FinanceStackedBarChart,
  Finance3DMetricCard,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';

type DreLine = {
  key: string;
  label: string;
  level: 0 | 1 | 2;
  tone?: 'sub' | 'final';
  current: number;
  prior: number;
  budget: number;
  composition: { name: string; value: number }[];
};

const DATA: DreLine[] = [
  { key: 'rb', label: 'Receita Bruta', level: 0, current: 18_540_000, prior: 16_120_000, budget: 18_000_000, composition: [
    { name: 'Receita Recorrente (SaaS)', value: 11_240_000 },
    { name: 'Serviços Profissionais', value: 5_120_000 },
    { name: 'Consumo / Usage', value: 1_280_000 },
    { name: 'Receitas Diversas', value: 900_000 },
  ]},
  { key: 'ded', label: '(–) Deduções e Impostos sobre Receita', level: 1, current: -2_410_200, prior: -2_096_000, budget: -2_340_000, composition: [
    { name: 'PIS/COFINS', value: -1_390_500 },
    { name: 'ISS/ICMS', value: -740_000 },
    { name: 'Devoluções e Cancelamentos', value: -279_700 },
  ]},
  { key: 'rl', label: 'Receita Líquida', level: 0, tone: 'sub', current: 16_129_800, prior: 14_024_000, budget: 15_660_000, composition: [] },
  { key: 'cd', label: '(–) Custo Direto (CMV / CSP)', level: 1, current: -8_710_400, prior: -7_820_000, budget: -8_430_000, composition: [
    { name: 'Pessoal alocado em projetos', value: -5_840_000 },
    { name: 'Infra / Cloud / Licenças', value: -1_620_000 },
    { name: 'Subcontratação', value: -890_400 },
    { name: 'Materiais e insumos', value: -360_000 },
  ]},
  { key: 'mb', label: 'Margem Bruta', level: 0, tone: 'sub', current: 7_419_400, prior: 6_204_000, budget: 7_230_000, composition: [] },
  { key: 'opex', label: '(–) OPEX (Pessoal, Estrutura, G&A)', level: 1, current: -3_185_700, prior: -2_910_000, budget: -3_120_000, composition: [
    { name: 'Pessoal não alocado', value: -1_640_000 },
    { name: 'Estrutura e facilities', value: -612_000 },
    { name: 'G&A (jurídico, financeiro, TI)', value: -533_700 },
    { name: 'Marketing & Branding', value: -400_000 },
  ]},
  { key: 'ebitda', label: 'EBITDA', level: 0, tone: 'sub', current: 4_233_700, prior: 3_294_000, budget: 4_110_000, composition: [] },
  { key: 'fin', label: 'Resultado Financeiro', level: 1, current: -612_400, prior: -540_000, budget: -580_000, composition: [
    { name: 'Despesas financeiras', value: -780_000 },
    { name: 'Receitas financeiras', value: 167_600 },
  ]},
  { key: 'tax', label: 'Impostos sobre o Lucro (IR/CSLL)', level: 1, current: -985_300, prior: -760_000, budget: -940_000, composition: [
    { name: 'IRPJ', value: -680_000 },
    { name: 'CSLL', value: -305_300 },
  ]},
  { key: 'rl_final', label: 'Resultado Líquido', level: 0, tone: 'final', current: 2_636_000, prior: 1_994_000, budget: 2_590_000, composition: [] },
];

const variancePct = (a: number, b: number) => (b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100);

const VIEWS = [
  { value: 'consolidated', label: 'Consolidado' },
  { value: 'project',      label: 'Por Projeto' },
  { value: 'cost-center',  label: 'Por Centro de Custo' },
  { value: 'contract',     label: 'Por Contrato' },
] as const;
type ViewMode = typeof VIEWS[number]['value'];

export default function DreGerencialPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-04');
  const [scenario, setScenario] = useState<FinanceScenario>('realized');
  const [view, setView] = useState<ViewMode>('consolidated');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<DreLine | null>(null);

  const totals = useMemo(() => {
    const rl = DATA.find((l) => l.key === 'rl')!.current;
    const mb = DATA.find((l) => l.key === 'mb')!.current;
    const ebitda = DATA.find((l) => l.key === 'ebitda')!.current;
    const liq = DATA.find((l) => l.key === 'rl_final')!.current;
    const ebitdaBudget = DATA.find((l) => l.key === 'ebitda')!.budget;
    return { rl, mb, ebitda, liq, ebitdaVar: variancePct(ebitda, ebitdaBudget) };
  }, []);

  const kpis: KpiItem[] = [
    { id: 'rl', label: 'Receita Líquida', value: fmtBRL(totals.rl), delta: 15.0, deltaLabel: 'vs anterior', variant: 'info', tintValue: true },
    { id: 'mb', label: 'Margem Bruta', value: `${((totals.mb / totals.rl) * 100).toFixed(1)}%`, delta: 1.8, variant: 'success', tintValue: true },
    { id: 'ebitda', label: 'EBITDA', value: fmtBRL(totals.ebitda), delta: 28.5, variant: 'success', tintValue: true },
    { id: 'eb_m', label: 'Margem EBITDA', value: `${((totals.ebitda / totals.rl) * 100).toFixed(1)}%`, delta: 2.7, variant: 'success', tintValue: true },
    { id: 'liq', label: 'Resultado Líquido', value: fmtBRL(totals.liq), delta: 32.2, variant: 'success', tintValue: true },
    { id: 'eb_v', label: 'EBITDA vs Orçado', value: fmtPct(totals.ebitdaVar), variant: totals.ebitdaVar >= 0 ? 'success' : 'danger', tintValue: true },
  ];

  const waterfallSteps = useMemo(() => {
    const rl = DATA.find((l) => l.key === 'rl')!.current;
    const cd = DATA.find((l) => l.key === 'cd')!.current;
    const opex = DATA.find((l) => l.key === 'opex')!.current;
    const fin = DATA.find((l) => l.key === 'fin')!.current;
    const tax = DATA.find((l) => l.key === 'tax')!.current;
    const liq = DATA.find((l) => l.key === 'rl_final')!.current;
    return [
      { label: 'Receita Líquida', value: rl,   type: 'start' as const },
      { label: 'Custo Direto',    value: cd },
      { label: 'OPEX',            value: opex },
      { label: 'Resultado Fin.',  value: fin },
      { label: 'Impostos',        value: tax },
      { label: 'Lucro Líquido',   value: liq,  type: 'end' as const },
    ];
  }, []);

  const opexLine = DATA.find((l) => l.key === 'opex')!;
  const cdLine = DATA.find((l) => l.key === 'cd')!;
  const dedLine = DATA.find((l) => l.key === 'ded')!;
  const expenseDonut = useMemo(() => {
    const items = [
      ...cdLine.composition.map((c) => ({ name: c.name, value: Math.abs(c.value), tone: 'danger' as const })),
      ...opexLine.composition.map((c) => ({ name: c.name, value: Math.abs(c.value), tone: 'warning' as const })),
      ...dedLine.composition.map((c) => ({ name: c.name, value: Math.abs(c.value), tone: 'info' as const })),
    ];
    return items;
  }, [cdLine, opexLine, dedLine]);

  // Cumulative result S-Curve: synthetic monthly accumulation pattern from main aggregates
  const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const cumulativeSeries = useMemo(() => {
    const monthlyActual = [610_000, 580_000, 720_000, 726_000, 800_000, 780_000, 820_000, 840_000, 860_000, 880_000, 920_000, 960_000];
    const monthlyBudget = [620_000, 605_000, 650_000, 685_000, 705_000, 730_000, 755_000, 780_000, 805_000, 830_000, 855_000, 880_000];
    const monthlyForecast = monthlyActual.map((v, i) => v * 1.04 + (i > 3 ? 30_000 : 0));
    return [
      { name: 'Realizado', values: monthlyActual,  tone: 'accent' as const, emphasized: true },
      { name: 'Orçado',    values: monthlyBudget,  tone: 'budget' as const, dashed: true },
      { name: 'Forecast',  values: monthlyForecast, tone: 'success' as const },
    ];
  }, []);

  // Stacked bar — monthly P&L composition (last 6 months)
  const stackedCats = ['Nov', 'Dez', 'Jan', 'Fev', 'Mar', 'Abr'];
  const stackedSeries = [
    { name: 'Receita Líq.',  data: [13_900_000, 14_300_000, 14_650_000, 15_100_000, 15_540_000, 16_129_800], tone: 'accent' as const },
    { name: 'Custo Direto',  data: [-7_400_000, -7_550_000, -7_750_000, -8_010_000, -8_320_000, -8_710_400], tone: 'danger' as const },
    { name: 'OPEX',          data: [-2_700_000, -2_780_000, -2_840_000, -2_910_000, -3_040_000, -3_185_700], tone: 'warning' as const },
    { name: 'Impostos',      data: [-880_000,   -905_000,   -915_000,   -940_000,   -960_000,   -985_300], tone: 'info' as const },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title="DRE / P&L Gerencial"
        subtitle="Demonstração de Resultado consolidada com visão gerencial, drill-down e variação por cenário"
        icon={<LineChart className="w-5 h-5" />}
        iconTint="#6366F1"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'DRE / P&L Gerencial' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        extra={
          <div className="flex items-end gap-1.5">
            <div className="flex flex-col gap-1">
              <span className="text-[10.5px] uppercase tracking-wider text-ig-text-tertiary font-medium">Visão</span>
              <div className="flex rounded-lg border border-ig-border-subtle overflow-hidden bg-ig-surface-subtle/30">
                {VIEWS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    onClick={() => setView(v.value)}
                    className={
                      'px-2.5 h-8 text-[11px] font-medium transition-colors ' +
                      (view === v.value
                        ? 'bg-ig-accent-weak text-ig-accent border-r border-ig-border-focus last:border-r-0'
                        : 'text-ig-text-secondary hover:text-ig-text-primary hover:bg-ig-surface-subtle/60 border-r border-ig-border-subtle/60 last:border-r-0')
                    }
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        }
        rightSlot={
          <>
            <HudButton variant="ghost" size="sm">Comparar período</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<Download className="w-4 h-4" />}>Exportar</HudButton>
          </>
        }
      />

      <HudKpiStrip kpis={kpis} columns={6} connected align="center" />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Finance3DMetricCard label="Receita Líquida" value={fmtCompactBRL(totals.rl)} delta={{ value: '+15.0% vs anterior', tone: 'pos' }} caption="Recorrência + Serv. Prof." tone="info"    icon={<LineChart className="w-3.5 h-3.5" />} intensity="strong" />
        <Finance3DMetricCard label="EBITDA"          value={fmtCompactBRL(totals.ebitda)} delta={{ value: '+28.5% YoY',     tone: 'pos' }} caption={`Margem ${((totals.ebitda / totals.rl) * 100).toFixed(1)}%`} tone="success" intensity="strong" />
        <Finance3DMetricCard label="Lucro Líquido"   value={fmtCompactBRL(totals.liq)}    delta={{ value: '+32.2% YoY',     tone: 'pos' }} caption="Carga efetiva 27.3%" tone="accent"  intensity="strong" />
        <Finance3DMetricCard label="EBITDA vs Orç."  value={fmtPct(totals.ebitdaVar)}    delta={{ value: 'Acima do plano', tone: totals.ebitdaVar >= 0 ? 'pos' : 'neg' }} caption="Bridge: Receita +Δ −Custo −OPEX" tone={totals.ebitdaVar >= 0 ? 'success' : 'danger'} intensity="strong" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader>
            <HudCardTitle>
              Demonstração de Resultado — {VIEWS.find((v) => v.value === view)?.label}
            </HudCardTitle>
          </HudCardHeader>
          <HudCardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ig-border-subtle">
                  <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                    <th className="text-left px-5 py-3 font-medium w-[36%]">Conta</th>
                    <th className="text-right px-5 py-3 font-medium">Realizado</th>
                    <th className="text-right px-5 py-3 font-medium">Anterior</th>
                    <th className="text-right px-5 py-3 font-medium">Orçado</th>
                    <th className="text-right px-5 py-3 font-medium">Δ Orçado</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {DATA.map((row) => {
                    const dBudget = variancePct(row.current, row.budget);
                    const isSub = row.tone === 'sub';
                    const isFinal = row.tone === 'final';
                    const expandable = row.composition.length > 0;
                    const isOpen = expanded[row.key] ?? false;

                    return (
                      <Fragment key={row.key}>
                        <tr
                          className={
                            'group border-b border-ig-border-subtle/40 transition-colors cursor-pointer ' +
                            (isFinal
                              ? 'bg-ig-accent-weak/40 font-semibold '
                              : isSub
                              ? 'bg-ig-surface-subtle/40 font-medium '
                              : 'hover:bg-ig-surface-subtle/30 ')
                          }
                          onClick={() => expandable ? setExpanded((e) => ({ ...e, [row.key]: !isOpen })) : setSelected(row)}
                        >
                          <td className={'px-5 py-2.5 ' + (row.level === 1 ? 'pl-9 text-ig-text-secondary' : 'text-ig-text-primary')}>
                            <span className="inline-flex items-center gap-1.5">
                              {expandable && (
                                <ChevronRight
                                  className={'w-3.5 h-3.5 transition-transform ' + (isOpen ? 'rotate-90 text-ig-accent' : 'text-ig-text-tertiary')}
                                  strokeWidth={2}
                                />
                              )}
                              {row.label}
                            </span>
                          </td>
                          <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(row.current)}</td>
                          <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(row.prior)}</td>
                          <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(row.budget)}</td>
                          <td className={'text-right px-5 py-2.5 font-mono tabular-nums ' + (dBudget >= 0 ? 'text-ig-success' : 'text-ig-danger')}>
                            {fmtPct(dBudget)}
                          </td>
                          <td className="text-right px-3 py-2.5">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setSelected(row); }}
                              className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 text-[11px] text-ig-accent hover:underline"
                            >
                              Detalhe <ExternalLink className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                        {isOpen && expandable && row.composition.map((c, idx) => (
                          <tr key={`${row.key}-${idx}`} className="border-b border-ig-border-subtle/30 bg-ig-surface-subtle/20">
                            <td className="pl-14 pr-5 py-2 text-[12.5px] text-ig-text-secondary">↳ {c.name}</td>
                            <td className="text-right px-5 py-2 font-mono tabular-nums text-[12.5px]">{fmtBRL(c.value)}</td>
                            <td className="text-right px-5 py-2 font-mono tabular-nums text-[12.5px] text-ig-text-tertiary">—</td>
                            <td className="text-right px-5 py-2 font-mono tabular-nums text-[12.5px] text-ig-text-tertiary">—</td>
                            <td></td>
                            <td></td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </HudCardContent>
        </HudCard>

        <div className="flex flex-col gap-4">
          <HudCard>
            <HudCardHeader><HudCardTitle>DRE Bridge — Receita Líquida → Lucro Líquido</HudCardTitle></HudCardHeader>
            <HudCardContent className="p-3">
              <FinanceAdvancedWaterfallChart steps={waterfallSteps} height={300} />
            </HudCardContent>
          </HudCard>

          <FinanceInsightCard
            title="Variance Explanation"
            subtitle="Análise automatizada da DRE do período"
            insights={[
              { id: '1', tone: 'positive', title: 'EBITDA acima do orçado', detail: `Realizado de ${fmtBRL(totals.ebitda)}, ${fmtPct(totals.ebitdaVar)} vs orçado, puxado por receita recorrente e ganho de eficiência em CSP.` },
              { id: '2', tone: 'warning',  title: 'Custo direto pressionado', detail: 'Pessoal alocado em projetos cresceu 4.2% acima do orçado — investigar mobilização do projeto PRJ-2026-002.' },
              { id: '3', tone: 'negative', title: 'Resultado financeiro negativo', detail: 'Despesas financeiras +5.6% vs orçado por exposição cambial em contratos USD.', action: { label: 'Revisar exposição' } },
              { id: '4', tone: 'neutral',  title: 'Impostos sobre o lucro', detail: 'Carga efetiva 27.3%; benefício de Lei do Bem em apuração para Q2.' },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>S-Curve — Resultado acumulado vs Orçado vs Forecast</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceSCurveChart categories={monthLabels} series={cumulativeSeries} height={280} />
          </HudCardContent>
        </HudCard>
        <HudCard>
          <HudCardHeader><HudCardTitle>Composição de despesas — Período</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceDonutChart
              data={expenseDonut}
              centerLabel="Despesa total"
              centerValue={fmtCompactBRL(expenseDonut.reduce((a, d) => a + d.value, 0))}
              height={300}
            />
          </HudCardContent>
        </HudCard>
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Composição mensal de P&L (últimos 6 meses)</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceStackedBarChart categories={stackedCats} series={stackedSeries} height={280} />
        </HudCardContent>
      </HudCard>

      <FinanceDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.label || ''}
        subtitle={`Decomposição da linha — ${VIEWS.find((v) => v.value === view)?.label}`}
        metaPills={selected ? [
          { label: `Realizado ${fmtBRL(selected.current)}`, tone: 'info' },
          { label: `Orçado ${fmtBRL(selected.budget)}`, tone: 'neutral' },
          { label: `Δ ${fmtPct(variancePct(selected.current, selected.budget))}`, tone: variancePct(selected.current, selected.budget) >= 0 ? 'pos' : 'neg' },
        ] : []}
        primaryActions={
          <>
            <HudButton variant="ghost" size="sm">Comparar</HudButton>
            <HudButton variant="primary" size="sm">Abrir lançamentos</HudButton>
          </>
        }
      >
        {selected && (
          <>
            <FinanceDrawerSection title="Resumo">
              <FinanceDrawerKeyValue rows={[
                { label: 'Período', value: period },
                { label: 'Cenário', value: scenario },
                { label: 'Realizado', value: fmtBRL(selected.current) },
                { label: 'Anterior', value: fmtBRL(selected.prior) },
                { label: 'Orçado', value: fmtBRL(selected.budget) },
                { label: 'Δ vs Orçado', value: fmtPct(variancePct(selected.current, selected.budget)), tone: variancePct(selected.current, selected.budget) >= 0 ? 'pos' : 'neg' },
              ]} />
            </FinanceDrawerSection>

            {selected.composition.length > 0 && (
              <FinanceDrawerSection title="Composição">
                <ul className="divide-y divide-ig-border-subtle/60">
                  {selected.composition.map((c, idx) => {
                    const total = selected.composition.reduce((s, x) => s + Math.abs(x.value), 0);
                    const share = total > 0 ? (Math.abs(c.value) / total) * 100 : 0;
                    return (
                      <li key={idx} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12.5px] text-ig-text-primary truncate">{c.name}</div>
                          <div className="mt-1 h-1 rounded-full bg-ig-surface-subtle overflow-hidden">
                            <div className="h-full bg-ig-accent" style={{ width: `${share}%` }} />
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[13px] font-mono tabular-nums">{fmtBRL(c.value)}</div>
                          <div className="text-[10.5px] text-ig-text-tertiary">{share.toFixed(1)}%</div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </FinanceDrawerSection>
            )}

            <FinanceDrawerSection title="Ações sugeridas">
              <div className="grid grid-cols-1 gap-2 text-[12.5px] text-ig-text-secondary">
                <div>• Justificar variância e anexar racional ao fechamento mensal.</div>
                <div>• Abrir lançamentos contábeis vinculados a esta linha.</div>
                <div>• Comparar com Forecast vigente para projeção até dezembro.</div>
              </div>
            </FinanceDrawerSection>
          </>
        )}
      </FinanceDetailDrawer>
    </HudPageLayout>
  );
}
