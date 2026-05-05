'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal, Plus, BookmarkCheck, Sparkles } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
  type KpiItem,
} from '@/components/hud';
import {
  FinanceFilterBar,
  FinanceInsightCard,
  FinanceSCurveChart,
  FinanceRadarChart,
  FinanceTornadoChart,
  FinanceDonutChart,
  Finance3DMetricCard,
  FinanceStatusBadge, type FinanceStatus,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';

type Scenario = {
  id: string;
  name: string;
  type: FinanceScenario | 'optimistic';
  revenue: number;
  ebitda: number;
  cash: number;
  margin: number;
  variance: number;
  status: FinanceStatus;
  owner: string;
  updated: string;
  trajectory: number[];
};

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const SCENARIOS: Scenario[] = [
  { id: 'real', name: 'Realizado YTD', type: 'realized', revenue: 18_540_000, ebitda: 4_233_700, cash: 6_120_000, margin: 22.8, variance: 0, status: 'closed', owner: 'CFO Office', updated: '2026-04-30',
    trajectory: [4_120, 4_290, 4_580, 5_550] as number[] },
  { id: 'bud', name: 'Orçado 2026', type: 'budget', revenue: 18_000_000, ebitda: 4_110_000, cash: 5_950_000, margin: 22.8, variance: 3.0, status: 'approved', owner: 'FP&A', updated: '2025-12-15',
    trajectory: [4_000, 4_200, 4_500, 5_300, 5_600, 5_900, 6_100, 6_400, 6_600, 6_900, 7_200, 7_500] },
  { id: 'fcst', name: 'Forecast Rolling 12m', type: 'forecast', revenue: 19_240_000, ebitda: 4_485_000, cash: 6_410_000, margin: 23.3, variance: 6.9, status: 'review', owner: 'FP&A', updated: '2026-04-28',
    trajectory: [4_120, 4_290, 4_580, 5_550, 5_780, 6_010, 6_240, 6_510, 6_730, 7_020, 7_360, 7_690] },
  { id: 'str', name: 'Stress Case (–12%)', type: 'stress', revenue: 16_315_000, ebitda: 3_182_000, cash: 4_780_000, margin: 19.5, variance: -9.3, status: 'draft', owner: 'Risk', updated: '2026-04-22',
    trajectory: [4_120, 4_290, 4_580, 5_550, 5_280, 5_010, 4_840, 4_710, 4_590, 4_510, 4_440, 4_390] },
  { id: 'opt', name: 'Optimistic Case (+8%)', type: 'optimistic', revenue: 20_790_000, ebitda: 5_105_000, cash: 7_240_000, margin: 24.6, variance: 15.5, status: 'draft', owner: 'CRO', updated: '2026-04-22',
    trajectory: [4_120, 4_290, 4_580, 5_550, 5_980, 6_410, 6_810, 7_240, 7_650, 8_080, 8_550, 9_020] },
  { id: 'brd', name: 'Board Approved Plan', type: 'board', revenue: 18_240_000, ebitda: 4_180_000, cash: 6_010_000, margin: 22.9, variance: 1.3, status: 'approved', owner: 'Conselho', updated: '2025-12-20',
    trajectory: [4_050, 4_240, 4_510, 5_320, 5_640, 5_950, 6_180, 6_460, 6_670, 6_960, 7_270, 7_580] },
];

interface Assumption { id: string; label: string; current: number; min: number; max: number; step: number; sensitivity: number; }

const ASSUMPTIONS: Assumption[] = [
  { id: 'rev',  label: 'Receita',         current: 0,   min: -20, max: 20, step: 1, sensitivity: 0.92 },
  { id: 'cd',   label: 'Custo Direto',    current: 0,   min: -15, max: 15, step: 1, sensitivity: -0.74 },
  { id: 'opex', label: 'OPEX',            current: 0,   min: -15, max: 15, step: 1, sensitivity: -0.41 },
  { id: 'mob',  label: 'Mobilização',     current: 0,   min: -10, max: 10, step: 1, sensitivity: -0.18 },
  { id: 'fol',  label: 'Folha',           current: 0,   min: -15, max: 15, step: 1, sensitivity: -0.62 },
  { id: 'tax',  label: 'Impostos',        current: 0,   min: -10, max: 10, step: 1, sensitivity: -0.34 },
];

export default function ForecastCenariosPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-Q2');
  const [scenario, setScenario] = useState<FinanceScenario>('forecast');
  const [assumptions, setAssumptions] = useState(ASSUMPTIONS);
  const [active, setActive] = useState<string>('fcst');

  const baseline = useMemo(() => SCENARIOS.find((s) => s.id === active) || SCENARIOS[2], [active]);

  const simulated = useMemo(() => {
    const compositeFactor = assumptions.reduce(
      (acc, a) => acc + (a.current / 100) * a.sensitivity, 0,
    );
    const ebitda = baseline.ebitda * (1 + compositeFactor);
    const revenue = baseline.revenue * (1 + assumptions[0].current / 100 * 0.92);
    const margin = (ebitda / revenue) * 100;
    const cash = baseline.cash * (1 + compositeFactor * 0.85);
    return { revenue, ebitda, margin, cash, delta: compositeFactor * 100 };
  }, [assumptions, baseline]);

  const kpis: KpiItem[] = [
    { id: 's', label: 'Cenários ativos', value: SCENARIOS.length.toString(), variant: 'info', tintValue: true },
    { id: 'rv', label: 'Receita simulada', value: fmtBRL(simulated.revenue), delta: ((simulated.revenue - baseline.revenue) / baseline.revenue) * 100, variant: 'success', tintValue: true },
    { id: 'eb', label: 'EBITDA simulado', value: fmtBRL(simulated.ebitda), delta: ((simulated.ebitda - baseline.ebitda) / baseline.ebitda) * 100, variant: simulated.ebitda >= baseline.ebitda ? 'success' : 'danger', tintValue: true },
    { id: 'mg', label: 'Margem simulada', value: `${simulated.margin.toFixed(1)}%`, delta: simulated.margin - baseline.margin, variant: 'success', tintValue: true },
    { id: 'cs', label: 'Caixa projetado', value: fmtBRL(simulated.cash), variant: 'info', tintValue: true },
  ];

  const updateAssumption = (id: string, value: number) => {
    setAssumptions((prev) => prev.map((a) => (a.id === id ? { ...a, current: value } : a)));
  };

  // Convert each scenario trajectory into a "monthly delta" feed for the S-Curve (cumulative).
  const sCurveScenarios = ['real', 'bud', 'fcst', 'str', 'brd'] as const;
  const sCurveSeries = sCurveScenarios.map((id) => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    const monthly = Array(12).fill(0).map((_, i) => {
      const ref = sc.trajectory[Math.min(i, sc.trajectory.length - 1)] * 1000;
      return ref / 12;
    });
    return {
      name: sc.name,
      values: monthly,
      tone: (id === 'bud' ? 'budget' : id === 'fcst' ? 'accent' : id === 'str' ? 'danger' : id === 'brd' ? 'info' : 'success') as 'budget' | 'accent' | 'danger' | 'info' | 'success',
      dashed: id === 'bud' || id === 'brd',
      emphasized: id === 'fcst',
    };
  });

  // Scenario impact radar: Receita / EBITDA / Margem / Caixa / Risco
  const radarIndicators = ['Receita', 'EBITDA', 'Margem', 'Caixa', 'Risco mitigado'];
  const radarSeries = ['fcst', 'str', 'brd'].map((id) => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    return {
      name: sc.name,
      values: [
        Math.round((sc.revenue / 22_000_000) * 100),
        Math.round((sc.ebitda / 5_500_000) * 100),
        Math.round((sc.margin / 28) * 100),
        Math.round((sc.cash / 7_500_000) * 100),
        id === 'str' ? 30 : id === 'fcst' ? 78 : 88,
      ],
      tone: (id === 'fcst' ? 'accent' : id === 'str' ? 'danger' : 'info') as 'accent' | 'danger' | 'info',
    };
  });

  // Forecast cost drivers donut
  const costDriversDonut = [
    { name: 'Pessoal alocado',  value: 5_840_000, tone: 'danger'  as const },
    { name: 'Pessoal não aloc.', value: 2_040_000, tone: 'warning' as const },
    { name: 'Cloud / Infra',    value: 1_620_000, tone: 'info'    as const },
    { name: 'Subcontratação',   value: 890_000,   tone: 'accent'  as const },
    { name: 'Estrutura + G&A',  value: 1_146_000, tone: 'budget'  as const },
  ];

  // Sensitivity tornado — % EBITDA impact at ±10%
  const tornado = ASSUMPTIONS.map((a) => ({
    label: a.label,
    low:  Math.abs(a.sensitivity * 10),  // % EBITDA at -10% downside in driver
    high: Math.abs(a.sensitivity * 10),
  }));

  return (
    <HudPageLayout>
      <HudHeader
        title="Forecast & Cenários"
        subtitle="Planejamento dinâmico com cenários comparáveis, simulação por premissas e baseline Board Approved"
        icon={<SlidersHorizontal className="w-5 h-5" />}
        iconTint="#22D3EE"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Forecast & Cenários' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        rightSlot={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<Sparkles className="w-4 h-4" />}>AI suggest</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>Novo cenário</HudButton>
          </>
        }
      />

      <HudKpiStrip kpis={kpis} columns={5} connected align="center" />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Finance3DMetricCard label="Receita simulada" value={fmtCompactBRL(simulated.revenue)} delta={{ value: fmtPct(((simulated.revenue - baseline.revenue) / baseline.revenue) * 100), tone: simulated.revenue >= baseline.revenue ? 'pos' : 'neg' }} caption={`Baseline: ${baseline.name}`} tone="info"    intensity="strong" />
        <Finance3DMetricCard label="EBITDA simulado"  value={fmtCompactBRL(simulated.ebitda)}  delta={{ value: fmtPct(((simulated.ebitda - baseline.ebitda) / baseline.ebitda) * 100), tone: simulated.ebitda >= baseline.ebitda ? 'pos' : 'neg' }} caption={`Margem ${simulated.margin.toFixed(1)}%`}     tone="success" intensity="strong" />
        <Finance3DMetricCard label="Caixa projetado"  value={fmtCompactBRL(simulated.cash)}    delta={{ value: '12m rolling', tone: 'neutral' }} caption="Pós OPEX e impostos" tone="accent"  intensity="strong" />
        <Finance3DMetricCard label="Δ composto"       value={fmtPct(simulated.delta)}          delta={{ value: simulated.delta >= 0 ? 'Upside' : 'Downside', tone: simulated.delta >= 0 ? 'pos' : 'neg' }} caption="Impacto agregado das premissas" tone={simulated.delta >= 0 ? 'success' : 'danger'} intensity="strong" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader>
            <HudCardTitle>S-Curve — Resultado acumulado por cenário</HudCardTitle>
          </HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceSCurveChart categories={MONTHS} series={sCurveSeries} height={300} />
          </HudCardContent>
        </HudCard>

        <HudCard className="flex flex-col">
          <HudCardHeader>
            <div className="flex items-center justify-between gap-3 w-full">
              <HudCardTitle>Premissas — Simulador</HudCardTitle>
              <select
                value={active}
                onChange={(e) => setActive(e.target.value)}
                className="h-7 text-[11px] rounded-md border border-ig-border-subtle bg-ig-surface-subtle/40 text-ig-text-primary px-2"
              >
                {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </HudCardHeader>
          <HudCardContent className="p-4 space-y-3">
            {assumptions.map((a) => (
              <div key={a.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11.5px] text-ig-text-secondary">{a.label}</span>
                  <span className={'text-[11.5px] font-mono tabular-nums ' + (a.current > 0 ? 'text-ig-success' : a.current < 0 ? 'text-ig-danger' : 'text-ig-text-tertiary')}>
                    {a.current > 0 ? '+' : ''}{a.current}%
                  </span>
                </div>
                <input
                  type="range"
                  min={a.min} max={a.max} step={a.step} value={a.current}
                  onChange={(e) => updateAssumption(a.id, Number(e.target.value))}
                  className="w-full accent-[var(--ig-accent)] cursor-pointer"
                />
              </div>
            ))}
            <div className="rounded-lg border border-ig-border-subtle bg-ig-surface-subtle/40 px-3 py-2.5 mt-2">
              <div className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">Impacto composto</div>
              <div className={'text-[16px] font-mono tabular-nums font-semibold ' + (simulated.delta >= 0 ? 'text-ig-success' : 'text-ig-danger')}>
                {fmtPct(simulated.delta)} EBITDA
              </div>
            </div>
            <HudButton variant="primary" size="sm" leftIcon={<BookmarkCheck className="w-4 h-4" />} className="w-full">
              Salvar como Board Approved
            </HudButton>
          </HudCardContent>
        </HudCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Grid de comparação entre cenários</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ig-border-subtle">
                  <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                    <th className="text-left px-5 py-3 font-medium">Cenário</th>
                    <th className="text-right px-5 py-3 font-medium">Receita</th>
                    <th className="text-right px-5 py-3 font-medium">EBITDA</th>
                    <th className="text-right px-5 py-3 font-medium">Margem</th>
                    <th className="text-right px-5 py-3 font-medium">Caixa</th>
                    <th className="text-right px-5 py-3 font-medium">Δ vs Real.</th>
                    <th className="text-left px-5 py-3 font-medium">Owner</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {SCENARIOS.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setActive(s.id)}
                      className={'border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer transition-colors ' + (active === s.id ? 'bg-ig-accent-weak/30' : '')}
                    >
                      <td className="px-5 py-2.5 text-ig-text-primary">{s.name}</td>
                      <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(s.revenue)}</td>
                      <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(s.ebitda)}</td>
                      <td className="text-right px-5 py-2.5 font-mono tabular-nums">{s.margin.toFixed(1)}%</td>
                      <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(s.cash)}</td>
                      <td className={'text-right px-5 py-2.5 font-mono tabular-nums ' + (s.variance >= 0 ? 'text-ig-success' : 'text-ig-danger')}>{fmtPct(s.variance)}</td>
                      <td className="px-5 py-2.5 text-ig-text-secondary">{s.owner}</td>
                      <td className="px-5 py-2.5"><FinanceStatusBadge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="AI Suggested Forecast"
          subtitle="Baseado em sazonalidade, pipeline comercial e mix de receita"
          insights={[
            { id: '1', tone: 'positive', title: 'Forecast +6.9% vs Orçado', detail: 'Pipeline qualificado de R$ 4.8M para Q2/Q3 sustenta upside; recomenda elevar baseline.' },
            { id: '2', tone: 'warning',  title: 'Custo direto pressionado', detail: 'Mobilização de PRJ-2026-002 acelera CSP em 4–6% — revisar margem-alvo do contrato.' },
            { id: '3', tone: 'neutral',  title: 'Cenário Stress', detail: 'Drawdown de –9.3% sob receita –12% e OPEX flat, EBITDA permanece positivo (R$ 3.18M).' },
            { id: '4', tone: 'positive', title: 'Reforecast quinzenal', detail: 'Frequência atual reduz desvio do realizado para <2.0%.', action: { label: 'Configurar cadência' } },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Radar de impacto entre cenários</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceRadarChart indicators={radarIndicators} series={radarSeries} height={300} />
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Drivers de custo — Forecast</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceDonutChart
              data={costDriversDonut}
              centerLabel="Custo total"
              centerValue={fmtCompactBRL(costDriversDonut.reduce((a, d) => a + d.value, 0))}
              height={300}
            />
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Sensibilidade — Tornado de premissas (impacto % no EBITDA)</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceTornadoChart rows={tornado} height={300} />
          </HudCardContent>
        </HudCard>
      </div>
    </HudPageLayout>
  );
}
