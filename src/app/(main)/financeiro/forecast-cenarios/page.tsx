'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal, Plus, BookmarkCheck, Sparkles } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudButton,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
} from '@/components/hud';
import {
  FinanceFilterBar,
  FinanceInsightCard,
  FinanceSCurveChart,
  FinanceRadarChart,
  FinanceTornadoChart,
  FinanceDonutChart,
  FinanceStatusBadge,
  FinanceKpiGrid,
  FinanceChartContainer,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';
import {
  FORECAST_SCENARIOS,
  FORECAST_ASSUMPTIONS,
  FORECAST_COST_DRIVERS,
  buildForecastKpis,
  buildForecastSCurveSeries,
  buildForecastRadarSeries,
  buildSensitivityTornado,
  RADAR_INDICATORS,
  simulateScenario,
} from '@/lib/finance';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { openFinanceReport, kpiFromHud } from '@/lib/reports/modules/finance-report';

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export default function ForecastCenariosPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-Q2');
  const [scenario, setScenario] = useState<FinanceScenario>('forecast');
  const [assumptions, setAssumptions] = useState(FORECAST_ASSUMPTIONS);
  const [active, setActive] = useState<string>('fcst');

  const baseline = useMemo(
    () => FORECAST_SCENARIOS.find((s) => s.id === active) || FORECAST_SCENARIOS[2],
    [active],
  );

  const simulated = useMemo(() => simulateScenario(baseline, assumptions), [baseline, assumptions]);

  const kpis = useMemo(
    () => buildForecastKpis({
      baseline,
      simulated,
      totalScenarios: FORECAST_SCENARIOS.length,
      asOf: '2026-04-30',
    }),
    [baseline, simulated],
  );

  const updateAssumption = (id: string, value: number) => {
    setAssumptions((prev) => prev.map((a) => (a.id === id ? { ...a, current: value } : a)));
  };

  const sCurveSeries = useMemo(() => buildForecastSCurveSeries(FORECAST_SCENARIOS), []);
  const radarSeries = useMemo(() => buildForecastRadarSeries(FORECAST_SCENARIOS), []);
  const tornado = useMemo(() => buildSensitivityTornado(FORECAST_ASSUMPTIONS), []);

  return (
    <HudPageLayout>
      <HudHeader
        title="Projeção & Cenários"
        subtitle="Planejamento dinâmico com cenários comparáveis, simulação por premissas e baseline aprovado pelo Conselho"
        icon={<SlidersHorizontal className="w-5 h-5" />}
        iconTint="#22D3EE"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Projeção & Cenários' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        rightSlot={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<Sparkles className="w-4 h-4" />}>Sugestão IA</HudButton>
            <ExportReportButton
              size="sm"
              variant="primary"
              label="Exportar PDF"
              permission="finance.export"
              fallbackPermission="finance.view"
              build={() => openFinanceReport({
                title: 'Projeção & Cenários',
                fileContext: 'forecast',
                periodLabel: period,
                scenarioLabel: scenario,
                context: 'Planejamento dinâmico, simulação de premissas e baseline',
                kpis: kpis.map((k) => kpiFromHud(k)),
                sections: [
                  {
                    title: 'Comparação de Cenários',
                    charts: [{ title: 'EBITDA por cenário', spec: { kind: 'bars', valueFmt: 'compactCurrency', rows: FORECAST_SCENARIOS.map((s) => ({ label: s.name, value: s.ebitda })) } }],
                    tables: [{
                      columns: [
                        { key: 'cen', label: 'Cenário' },
                        { key: 'rev', label: 'Receita', num: true },
                        { key: 'ebitda', label: 'EBITDA', num: true },
                        { key: 'mg', label: 'Margem', num: true },
                        { key: 'cash', label: 'Caixa', num: true },
                        { key: 'dr', label: 'Δ Real.', num: true },
                        { key: 'resp', label: 'Resp.' },
                        { key: 'status', label: 'Status' },
                      ],
                      rows: FORECAST_SCENARIOS.map((s) => ({
                        cen: s.name,
                        rev: { html: `<span class="mono">${fmtCompactBRL(s.revenue)}</span>` },
                        ebitda: { html: `<span class="mono">${fmtCompactBRL(s.ebitda)}</span>` },
                        mg: `${s.margin.toFixed(1)}%`,
                        cash: { html: `<span class="mono">${fmtCompactBRL(s.cash)}</span>` },
                        dr: fmtPct(s.variance),
                        resp: s.owner,
                        status: String(s.status),
                      })),
                    }],
                  },
                  {
                    title: 'Drivers de Custo (Projeção)',
                    charts: [{
                      title: 'Custo por driver',
                      spec: {
                        kind: 'donut',
                        valueFmt: 'compactCurrency',
                        center: fmtCompactBRL(FORECAST_COST_DRIVERS.reduce((a, d) => a + d.value, 0)),
                        slices: FORECAST_COST_DRIVERS.map((d) => ({ label: (d as { name?: string; label?: string }).name ?? (d as { label?: string }).label ?? '—', value: d.value })),
                      },
                    }],
                  },
                ],
              })}
            />
            <HudButton variant="primary" size="sm" leftIcon={<Plus className="w-4 h-4" />}>Novo cenário</HudButton>
          </>
        }
      />

      <FinanceKpiGrid kpis={kpis} columns={5} />

      <div className="grid grid-cols-1 lg:grid-cols-[2.4fr_1fr] gap-4 items-stretch">
        <HudCard className="flex flex-col h-full">
          <HudCardHeader>
            <HudCardTitle>S-Curve — Resultado acumulado por cenário</HudCardTitle>
          </HudCardHeader>
          <HudCardContent className="p-3 flex-1 flex flex-col">
            <FinanceChartContainer className="flex-1">
              <FinanceSCurveChart categories={MONTHS} series={sCurveSeries} height={460} />
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard className="flex flex-col">
          <HudCardHeader>
            <div className="flex items-center justify-between gap-3 w-full min-w-0">
              <HudCardTitle className="truncate">Premissas — Simulador</HudCardTitle>
              <select
                value={active}
                onChange={(e) => setActive(e.target.value)}
                className="h-7 text-[11px] rounded-md border border-ig-border-subtle bg-ig-surface-subtle/40 text-ig-text-primary px-2 max-w-[55%]"
              >
                {FORECAST_SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id} className="bg-ig-surface text-ig-text-primary">{s.name}</option>
                ))}
              </select>
            </div>
          </HudCardHeader>
          <HudCardContent className="p-4 space-y-3">
            {assumptions.map((a) => (
              <div key={a.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11.5px] text-ig-text-secondary truncate">{a.label}</span>
                  <span className={'text-[11.5px] font-mono tabular-nums shrink-0 ' + (a.current > 0 ? 'text-ig-success' : a.current < 0 ? 'text-ig-danger' : 'text-ig-text-tertiary')}>
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
              Salvar como aprovado pelo Conselho
            </HudButton>
          </HudCardContent>
        </HudCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2.4fr_1fr] gap-4">
        <HudCard className="min-h-[360px]">
          <HudCardHeader><HudCardTitle>Grid de comparação entre cenários</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-0">
            <div className="w-full min-w-0 overflow-hidden">
              <table className="w-full table-fixed text-[12px]">
                <colgroup>
                  <col className="w-[19%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                  <col className="w-[13%]" />
                  <col className="w-[12%]" />
                </colgroup>
                <thead className="border-b border-ig-border-subtle">
                  <tr className="text-[10px] uppercase tracking-[0.1em] text-ig-text-tertiary">
                    <th className="text-left px-3 py-2.5 font-medium">Cenário</th>
                    <th className="text-left px-3 py-2.5 font-medium">Receita</th>
                    <th className="text-left px-3 py-2.5 font-medium">EBITDA</th>
                    <th className="text-left px-3 py-2.5 font-medium">Margem</th>
                    <th className="text-left px-3 py-2.5 font-medium">Caixa</th>
                    <th className="text-left px-3 py-2.5 font-medium">Δ Real.</th>
                    <th className="text-left pl-6 pr-3 py-2.5 font-medium">Resp.</th>
                    <th className="text-left px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {FORECAST_SCENARIOS.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setActive(s.id)}
                      className={'border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer transition-colors ' + (active === s.id ? 'bg-ig-accent-weak/30' : '')}
                    >
                      <td className="px-3 py-2.5 text-ig-text-primary">{s.name}</td>
                      <td className="text-left px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">{fmtCompactBRL(s.revenue)}</td>
                      <td className="text-left px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">{fmtCompactBRL(s.ebitda)}</td>
                      <td className="text-left px-3 py-2.5 font-mono tabular-nums whitespace-nowrap">{s.margin.toFixed(1)}%</td>
                      <td className="text-left px-3 py-2.5 font-mono tabular-nums text-ig-text-secondary truncate">{fmtCompactBRL(s.cash)}</td>
                      <td className={'text-left px-3 py-2.5 font-mono tabular-nums whitespace-nowrap ' + (s.variance >= 0 ? 'text-ig-success' : 'text-ig-danger')}>{fmtPct(s.variance)}</td>
                      <td className="pl-6 pr-3 py-2.5 text-ig-text-secondary truncate">{s.owner}</td>
                      <td className="px-3 py-2.5"><FinanceStatusBadge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          className="min-h-[360px]"
          title="Sugestão de projeção (IA)"
          subtitle="Baseado em sazonalidade, pipeline comercial e mix de receita"
          insights={[
            { id: '1', tone: 'positive', title: 'Projeção +6,9% vs Orçado', detail: 'Pipeline qualificado de R$ 4,8M para Q2/Q3 sustenta upside; recomenda elevar baseline.' },
            { id: '2', tone: 'warning',  title: 'Custo direto pressionado', detail: 'Mobilização de PRJ-2026-002 acelera CSP em 4–6% — revisar margem-alvo do contrato.' },
            { id: '3', tone: 'neutral',  title: 'Cenário de estresse', detail: 'Drawdown de –9,3% sob receita –12% e OPEX flat, EBITDA permanece positivo (R$ 3,18M).' },
            { id: '4', tone: 'positive', title: 'Reprojeção quinzenal', detail: 'Frequência atual reduz desvio do realizado para <2,0%.', action: { label: 'Configurar cadência' } },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Radar de impacto entre cenários</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
              <FinanceRadarChart indicators={RADAR_INDICATORS} series={radarSeries} height={300} />
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Drivers de custo — Projeção</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
              <FinanceDonutChart
                data={FORECAST_COST_DRIVERS}
                centerLabel="Custo total"
                centerValue={fmtCompactBRL(FORECAST_COST_DRIVERS.reduce((a, d) => a + d.value, 0))}
                height={300}
              />
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard className="md:col-span-2 xl:col-span-1">
          <HudCardHeader><HudCardTitle>Sensibilidade — impacto % no EBITDA</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
              <FinanceTornadoChart rows={tornado} height={300} />
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>
      </div>
    </HudPageLayout>
  );
}
