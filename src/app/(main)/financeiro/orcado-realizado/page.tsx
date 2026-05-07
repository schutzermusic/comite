'use client';

import { useMemo, useState } from 'react';
import { GitCompare, Download, FileCheck, MessageSquare, Wrench } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudKpiStrip, HudButton, HudSelect,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
  type KpiItem,
} from '@/components/hud';
import {
  FinanceFilterBar,
  FinanceInsightCard,
  FinanceStatusBadge, type FinanceStatus,
  FinanceDetailDrawer, FinanceDrawerSection, FinanceDrawerKeyValue,
  FinanceSCurveChart,
  FinanceDonutChart,
  FinanceTreemapChart,
  FinanceRankMatrix,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';

type Row = {
  id: string;
  category: string;
  area: 'Receita' | 'Custo' | 'OPEX' | 'Financeiro' | 'Impostos';
  project?: string;
  costCenter?: string;
  budget: number;
  actual: number;
  ytdBudget: number;
  ytdActual: number;
  status: FinanceStatus;
  reason?: string;
  transactions: { date: string; ref: string; description: string; value: number; user: string }[];
};

const ROWS: Row[] = [
  { id: 'r1', category: 'Receita Bruta',         area: 'Receita',    costCenter: 'CC-COM', budget: 18_000_000, actual: 18_540_000, ytdBudget: 70_000_000, ytdActual: 71_820_000, status: 'ok',
    transactions: [ { date: '2026-04-30', ref: 'NF-2148', description: 'Faturamento mensal — Grupo Aurora', value: 184_000, user: 'M. Costa' } ] },
  { id: 'r2', category: 'Custo Direto — Pessoal',     area: 'Custo',  project: 'PRJ-2026-002', costCenter: 'CC-001', budget: -3_120_000, actual: -3_410_000, ytdBudget: -12_200_000, ytdActual: -13_180_000, status: 'critical',
    reason: 'Mobilização de squad sênior antecipada para destravar entrega Q2 do projeto Banco Iguaçu.',
    transactions: [
      { date: '2026-04-12', ref: 'LOTE-FOL-04A', description: 'Folha mensal — Tecnologia', value: -1_240_000, user: 'RH/FOL' },
      { date: '2026-04-15', ref: 'NF-9912',      description: 'Subcontratação especialista', value: -180_000,  user: 'L. Pires' },
      { date: '2026-04-22', ref: 'AJ-44',        description: 'Hora extra mobilização',     value: -38_000,   user: 'RH/FOL' },
    ] },
  { id: 'r3', category: 'Custo Direto — Cloud/Infra',  area: 'Custo',  costCenter: 'CC-001', budget: -1_620_000, actual: -1_580_000, ytdBudget: -6_400_000, ytdActual: -6_280_000, status: 'ok',
    transactions: [ { date: '2026-04-05', ref: 'NF-CLD-04', description: 'AWS / GCP / Azure', value: -540_000, user: 'TI/CLD' } ] },
  { id: 'r4', category: 'OPEX — Pessoal',              area: 'OPEX',   costCenter: 'CC-001', budget: -1_980_000, actual: -2_040_000, ytdBudget: -7_700_000, ytdActual: -7_910_000, status: 'attention',
    reason: 'Contratação de 3 lideranças funcionais antecipada do Q3 para Q2.',
    transactions: [ { date: '2026-04-12', ref: 'LOTE-FOL-04B', description: 'Folha mensal — não alocados', value: -680_000, user: 'RH/FOL' } ] },
  { id: 'r5', category: 'OPEX — Estrutura',            area: 'OPEX',   costCenter: 'CC-005', budget: -640_000,   actual: -612_000,   ytdBudget: -2_500_000, ytdActual: -2_410_000, status: 'ok', transactions: [] },
  { id: 'r6', category: 'OPEX — G&A',                  area: 'OPEX',   costCenter: 'CC-005', budget: -500_000,   actual: -533_700,   ytdBudget: -1_950_000, ytdActual: -2_080_000, status: 'attention',
    reason: 'Honorários jurídicos extraordinários — disputa contratual com fornecedor de licenças.',
    transactions: [ { date: '2026-04-18', ref: 'NF-J-44', description: 'Escritório jurídico', value: -88_000, user: 'JUR' } ] },
  { id: 'r7', category: 'Resultado Financeiro',        area: 'Financeiro', budget: -580_000, actual: -612_400, ytdBudget: -2_260_000, ytdActual: -2_390_000, status: 'attention',
    reason: 'Exposição cambial em contratos USD — variação +5.6%.',
    transactions: [] },
  { id: 'r8', category: 'Impostos sobre o Lucro',      area: 'Impostos', budget: -940_000, actual: -985_300, ytdBudget: -3_650_000, ytdActual: -3_810_000, status: 'justified',
    reason: 'Rebenefício de Lei do Bem em apuração para Q2.',
    transactions: [] },
];

const variancePct = (actual: number, budget: number) => (budget === 0 ? 0 : ((actual - budget) / Math.abs(budget)) * 100);

export default function OrcadoRealizadoPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-04');
  const [scenario, setScenario] = useState<FinanceScenario>('budget');
  const [filterArea, setFilterArea] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterCC, setFilterCC] = useState<string>('');
  const [selected, setSelected] = useState<Row | null>(null);

  const filtered = useMemo(() => ROWS.filter((r) => {
    if (filterArea && r.area !== filterArea) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterCC && r.costCenter !== filterCC) return false;
    return true;
  }), [filterArea, filterStatus, filterCC]);

  const totalBudget = filtered.reduce((a, r) => a + r.budget, 0);
  const totalActual = filtered.reduce((a, r) => a + r.actual, 0);
  const overruns = filtered.filter((r) => r.status === 'critical' || r.status === 'attention').length;
  const justified = filtered.filter((r) => r.status === 'justified').length;

  const ranking = useMemo(() => [...ROWS]
    .map((r) => ({ ...r, vp: variancePct(r.actual, r.budget) }))
    .filter((r) => r.actual < 0)
    .sort((a, b) => a.vp - b.vp)
    .slice(0, 5), []);

  const variance = variancePct(totalActual, totalBudget);
  const kpis: KpiItem[] = [
    { id: 'b', label: 'Orçado (mês)', value: totalBudget, format: 'compactCurrency', variant: 'info', tintValue: true },
    { id: 'a', label: 'Realizado (mês)', value: totalActual, format: 'compactCurrency', variant: 'success', tintValue: true },
    { id: 'd', label: 'Δ Realizado vs Orçado', value: variance, format: 'percent', variant: variance >= 0 ? 'success' : 'danger', tintValue: true },
    { id: 'o', label: 'Linhas com overrun', value: overruns, variant: overruns > 0 ? 'warning' : 'success', tintValue: true },
    { id: 'j', label: 'Justificadas', value: justified, variant: 'info', tintValue: true },
  ];

  const heatmapAreas = (['Receita', 'Custo', 'OPEX', 'Financeiro', 'Impostos'] as Row['area'][]).map((area) => {
    const inArea = ROWS.filter((r) => r.area === area);
    const b = inArea.reduce((a, r) => a + r.budget, 0);
    const ac = inArea.reduce((a, r) => a + r.actual, 0);
    return { area, vp: variancePct(ac, b), count: inArea.length };
  });

  return (
    <HudPageLayout>
      <HudHeader
        title="Orçado x Realizado"
        subtitle="Controle de variância orçamentária com heatmap, ranking de overruns e workflow de justificativa"
        icon={<GitCompare className="w-5 h-5" />}
        iconTint="#F59E0B"
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Orçado x Realizado' }]}
      />

      <FinanceFilterBar
        period={period} onPeriodChange={setPeriod}
        scenario={scenario} onScenarioChange={setScenario}
        extra={
          <>
            <HudSelect label="Área" size="sm" value={filterArea} onChange={setFilterArea}
              options={[{ value: '', label: 'Todas' }, { value: 'Receita', label: 'Receita' }, { value: 'Custo', label: 'Custo Direto' }, { value: 'OPEX', label: 'OPEX' }, { value: 'Financeiro', label: 'Financeiro' }, { value: 'Impostos', label: 'Impostos' }]} />
            <HudSelect label="CC" size="sm" value={filterCC} onChange={setFilterCC}
              options={[{ value: '', label: 'Todos' }, { value: 'CC-001', label: 'CC-001 Tecnologia' }, { value: 'CC-005', label: 'CC-005 G&A' }, { value: 'CC-COM', label: 'CC-COM Comercial' }]} />
            <HudSelect label="Status" size="sm" value={filterStatus} onChange={setFilterStatus}
              options={[{ value: '', label: 'Todos' }, { value: 'ok', label: 'OK' }, { value: 'attention', label: 'Atenção' }, { value: 'critical', label: 'Crítico' }, { value: 'justified', label: 'Justificado' }]} />
          </>
        }
        rightSlot={<HudButton variant="primary" size="sm" leftIcon={<Download className="w-4 h-4" />}>Exportar variância</HudButton>}
      />

      <HudKpiStrip kpis={kpis} columns={5} connected align="center" />

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>S-Curve — Realizado vs Orçado (acumulado)</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceSCurveChart
              categories={['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']}
              series={[
                { name: 'Realizado', values: [3_910_000, 3_760_000, 4_020_000, 4_440_000, 0, 0, 0, 0, 0, 0, 0, 0], tone: 'accent', emphasized: true },
                { name: 'Orçado',    values: [3_780_000, 3_700_000, 3_910_000, 4_180_000, 4_220_000, 4_300_000, 4_350_000, 4_400_000, 4_450_000, 4_500_000, 4_550_000, 4_600_000], tone: 'budget', dashed: true },
                { name: 'Forecast',  values: [3_910_000, 3_760_000, 4_020_000, 4_440_000, 4_510_000, 4_620_000, 4_700_000, 4_780_000, 4_860_000, 4_940_000, 5_020_000, 5_100_000], tone: 'success' },
              ]}
              height={260}
            />
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Composição da variância</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceDonutChart
              data={[
                { name: 'Pessoal direto',     value: 290_000, tone: 'danger'  },
                { name: 'Pessoal não aloc.',   value: 60_000,  tone: 'warning' },
                { name: 'G&A',                value: 33_700,  tone: 'info'    },
                { name: 'Resultado fin.',     value: 32_400,  tone: 'budget'  },
                { name: 'Impostos',           value: 45_300,  tone: 'accent'  },
              ]}
              centerLabel="Δ Realizado vs Orçado"
              centerValue={fmtCompactBRL(461_400)}
              height={260}
            />
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Treemap — Categorias em overrun</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceTreemapChart
              data={[
                { name: 'Custo Direto — Pessoal', value: 290_000, tone: 'danger',  deltaPct: -9.3 },
                { name: 'OPEX — Pessoal',         value: 60_000,  tone: 'warning', deltaPct: -3.0 },
                { name: 'OPEX — G&A',             value: 33_700,  tone: 'warning', deltaPct: -6.7 },
                { name: 'Impostos lucro',         value: 45_300,  tone: 'accent',  deltaPct: -4.8 },
                { name: 'Resultado financeiro',   value: 32_400,  tone: 'info',    deltaPct: -5.6 },
                { name: 'Custo Cloud/Infra',      value: 40_000,  tone: 'success', deltaPct: 2.5 },
                { name: 'OPEX Estrutura',         value: 28_000,  tone: 'success', deltaPct: 4.4 },
              ]}
              height={260}
            />
          </HudCardContent>
        </HudCard>
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Ranking de variância por CC</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceRankMatrix
            mode="diverging"
            sort="asc"
            headers={{ rank: 'Rank', label: 'Centro de Custo', bar: 'Δ Realizado vs Orçado', secondary: 'Orçado / Realizado' }}
            valueFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
            axisFormatter={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}%`}
            rows={[
              { id: 'cc3', label: 'CC-003 Comercial',         meta: 'Renata Souza • Risco médio',   value: -5.6, tone: 'danger',  secondaryLabel: 'Orçado / Realizado', secondary: `${fmtCompactBRL(1_240_000)} / ${fmtCompactBRL(1_310_000)}` },
              { id: 'cc1', label: 'CC-001 Tecnologia',        meta: 'Carla Mendes • Risco alto',     value: -4.6, tone: 'danger',  secondaryLabel: 'Orçado / Realizado', secondary: `${fmtCompactBRL(2_400_000)} / ${fmtCompactBRL(2_510_000)}` },
              { id: 'cc5', label: 'CC-005 G&A',               meta: 'Beatriz Tavares • Risco médio', value: -2.2, tone: 'warning', secondaryLabel: 'Orçado / Realizado', secondary: `${fmtCompactBRL(540_000)} / ${fmtCompactBRL(552_000)}` },
              { id: 'cc2', label: 'CC-002 Operações',         meta: 'Felipe Araújo • Risco baixo',   value:  3.2, tone: 'success', secondaryLabel: 'Orçado / Realizado', secondary: `${fmtCompactBRL(1_850_000)} / ${fmtCompactBRL(1_790_000)}` },
              { id: 'cc7', label: 'CC-007 Risco/Compliance',  meta: 'Patrícia Lemos • Risco baixo',  value:  3.3, tone: 'success', secondaryLabel: 'Orçado / Realizado', secondary: `${fmtCompactBRL(360_000)} / ${fmtCompactBRL(348_000)}` },
              { id: 'cc4', label: 'CC-004 CS',                meta: 'Diego Lopes • Risco baixo',     value:  4.9, tone: 'success', secondaryLabel: 'Orçado / Realizado', secondary: `${fmtCompactBRL(780_000)} / ${fmtCompactBRL(742_000)}` },
              { id: 'cc6', label: 'CC-006 Marketing',         meta: 'Henrique Vidal • Risco baixo',  value:  5.7, tone: 'success', secondaryLabel: 'Orçado / Realizado', secondary: `${fmtCompactBRL(420_000)} / ${fmtCompactBRL(396_000)}` },
            ]}
          />
        </HudCardContent>
      </HudCard>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.6fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Heatmap de variância por área</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-4 space-y-2.5">
            {heatmapAreas.map((a) => {
              const intensity = Math.min(100, Math.abs(a.vp) * 5);
              const bg = a.vp <= 0
                ? `linear-gradient(90deg, color-mix(in oklab, var(--ig-success) ${intensity}%, transparent), transparent)`
                : `linear-gradient(90deg, color-mix(in oklab, var(--ig-danger) ${intensity}%, transparent), transparent)`;
              return (
                <button
                  key={a.area}
                  type="button"
                  onClick={() => setFilterArea(a.area)}
                  className="w-full text-left rounded-lg border border-ig-border-subtle px-3 py-2.5 hover:border-ig-border-focus transition-colors"
                  style={{ backgroundImage: bg }}
                >
                  <div className="flex items-center justify-between">
                    <div className="text-[12.5px] font-medium text-ig-text-primary">{a.area}</div>
                    <div className={'text-[12.5px] font-mono tabular-nums ' + (a.vp >= 0 ? 'text-ig-success' : 'text-ig-danger')}>{fmtPct(a.vp)}</div>
                  </div>
                  <div className="text-[10.5px] text-ig-text-tertiary mt-0.5">{a.count} linha{a.count !== 1 ? 's' : ''}</div>
                </button>
              );
            })}
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Top overruns do período</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-4">
            <ul className="divide-y divide-ig-border-subtle/60">
              {ranking.map((r, idx) => (
                <li key={r.id} className="py-2.5 flex items-center gap-3">
                  <span className="text-[11px] font-mono text-ig-text-tertiary w-6">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <button onClick={() => setSelected(r)} className="text-[13px] font-medium text-ig-text-primary hover:text-ig-accent text-left truncate w-full">
                      {r.category}
                    </button>
                    <div className="text-[10.5px] text-ig-text-tertiary truncate">{r.area} {r.costCenter ? `• ${r.costCenter}` : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12.5px] font-mono tabular-nums text-ig-danger">{fmtPct(r.vp)}</div>
                    <div className="text-[10.5px] text-ig-text-tertiary font-mono">{fmtBRL(r.actual - r.budget)}</div>
                  </div>
                  <FinanceStatusBadge status={r.status} size="xs" />
                </li>
              ))}
            </ul>
          </HudCardContent>
        </HudCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Variação por linha — Mês e YTD</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-ig-border-subtle">
                  <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                    <th className="text-left px-5 py-3 font-medium">Linha</th>
                    <th className="text-right px-5 py-3 font-medium">Orçado</th>
                    <th className="text-right px-5 py-3 font-medium">Realizado</th>
                    <th className="text-right px-5 py-3 font-medium">Δ %</th>
                    <th className="text-right px-5 py-3 font-medium">Δ % YTD</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-right px-5 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const dM = variancePct(r.actual, r.budget);
                    const dY = variancePct(r.ytdActual, r.ytdBudget);
                    return (
                      <tr key={r.id} onClick={() => setSelected(r)} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30 cursor-pointer">
                        <td className="px-5 py-2.5 text-ig-text-primary">
                          <div>{r.category}</div>
                          <div className="text-[10.5px] text-ig-text-tertiary">{r.area}{r.project ? ` • ${r.project}` : ''}{r.costCenter ? ` • ${r.costCenter}` : ''}</div>
                        </td>
                        <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary">{fmtBRL(r.budget)}</td>
                        <td className="text-right px-5 py-2.5 font-mono tabular-nums">{fmtBRL(r.actual)}</td>
                        <td className={'text-right px-5 py-2.5 font-mono tabular-nums ' + (dM >= 0 ? 'text-ig-success' : 'text-ig-danger')}>{fmtPct(dM)}</td>
                        <td className={'text-right px-5 py-2.5 font-mono tabular-nums ' + (dY >= 0 ? 'text-ig-success' : 'text-ig-danger')}>{fmtPct(dY)}</td>
                        <td className="px-5 py-2.5"><FinanceStatusBadge status={r.status} /></td>
                        <td className="text-right px-3 py-2.5 text-[11px] text-ig-accent">Detalhe →</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-5 py-6 text-center text-[12px] text-ig-text-tertiary">Nenhuma linha para os filtros aplicados.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="Variance Explanation"
          subtitle="Insights para próxima reunião de fechamento"
          insights={[
            { id: '1', tone: 'negative', title: 'Custo Direto crítico', detail: 'Pessoal alocado 9.3% acima do orçado por mobilização antecipada — verificar margem do PRJ-2026-002.', action: { label: 'Revisar projeto' } },
            { id: '2', tone: 'warning',  title: 'OPEX G&A em atenção', detail: 'Honorários jurídicos extraordinários puxam +6.7% no mês.' },
            { id: '3', tone: 'positive', title: 'Receita acima do plano', detail: 'Receita +3.0% vs orçado, compensando parcialmente overrun em custo direto.' },
            { id: '4', tone: 'neutral',  title: 'Justificativas pendentes', detail: '3 linhas em status Atenção/Crítico aguardam justificativa formal antes do fechamento.' },
          ]}
        />
      </div>

      <FinanceDetailDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.category || ''}
        subtitle={selected ? `${selected.area}${selected.costCenter ? ' • ' + selected.costCenter : ''}${selected.project ? ' • ' + selected.project : ''}` : ''}
        metaPills={selected ? [
          { label: `Δ ${fmtPct(variancePct(selected.actual, selected.budget))}`, tone: variancePct(selected.actual, selected.budget) >= 0 ? 'pos' : 'neg' },
          { label: `Status: ${selected.status}`, tone: selected.status === 'critical' ? 'neg' : selected.status === 'attention' ? 'warn' : 'info' },
        ] : []}
        primaryActions={
          <>
            <HudButton variant="ghost" size="sm" leftIcon={<MessageSquare className="w-4 h-4" />}>Justificar</HudButton>
            <HudButton variant="ghost" size="sm" leftIcon={<Wrench className="w-4 h-4" />}>Ação corretiva</HudButton>
            <HudButton variant="primary" size="sm" leftIcon={<FileCheck className="w-4 h-4" />}>Revisar</HudButton>
          </>
        }
      >
        {selected && (
          <>
            <FinanceDrawerSection title="Resumo financeiro">
              <FinanceDrawerKeyValue rows={[
                { label: 'Orçado (mês)',  value: fmtBRL(selected.budget) },
                { label: 'Realizado',     value: fmtBRL(selected.actual) },
                { label: 'Δ vs Orçado',   value: fmtPct(variancePct(selected.actual, selected.budget)), tone: variancePct(selected.actual, selected.budget) >= 0 ? 'pos' : 'neg' },
                { label: 'Orçado YTD',    value: fmtBRL(selected.ytdBudget) },
                { label: 'Realizado YTD', value: fmtBRL(selected.ytdActual) },
                { label: 'Δ YTD',         value: fmtPct(variancePct(selected.ytdActual, selected.ytdBudget)), tone: variancePct(selected.ytdActual, selected.ytdBudget) >= 0 ? 'pos' : 'neg' },
              ]} />
            </FinanceDrawerSection>

            {selected.reason && (
              <FinanceDrawerSection title="Justificativa registrada">
                <p className="text-[12.5px] leading-snug text-ig-text-secondary">{selected.reason}</p>
              </FinanceDrawerSection>
            )}

            <FinanceDrawerSection title="Lançamentos vinculados">
              {selected.transactions.length > 0 ? (
                <table className="w-full text-[12px]">
                  <thead><tr className="text-[10px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                    <th className="text-left py-1.5">Data</th><th className="text-left">Ref</th><th className="text-left">Descrição</th><th className="text-right">Valor</th>
                  </tr></thead>
                  <tbody>
                    {selected.transactions.map((t, idx) => (
                      <tr key={idx} className="border-t border-ig-border-subtle/50">
                        <td className="py-1.5 font-mono text-[11px] text-ig-text-secondary">{t.date}</td>
                        <td className="font-mono text-[11px] text-ig-text-secondary">{t.ref}</td>
                        <td className="text-ig-text-primary">{t.description}</td>
                        <td className="text-right font-mono tabular-nums">{fmtBRL(t.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="text-[12px] text-ig-text-tertiary">Sem lançamentos diretamente vinculados.</div>}
            </FinanceDrawerSection>
          </>
        )}
      </FinanceDetailDrawer>
    </HudPageLayout>
  );
}
