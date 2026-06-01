'use client';

import { useMemo, useState } from 'react';
import { GitCompare, Download, FileCheck, MessageSquare, Wrench, Layers3, Building2, Activity } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudButton,
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
} from '@/components/hud';
import {
  FinanceFilterBar, FinanceFilterChip,
  FinanceInsightCard,
  FinanceStatusBadge,
  FinanceDetailDrawer, FinanceDrawerSection, FinanceDrawerKeyValue,
  FinanceSCurveChart,
  FinanceDonutChart,
  FinanceTreemapChart,
  FinanceRankMatrix,
  FinanceKpiGrid,
  FinanceChartContainer,
  fmtBRL, fmtPct, fmtCompactBRL,
  type FinancePeriod, type FinanceScenario,
} from '@/components/finance/shared';
import {
  BUDGET_ACTUAL_ROWS,
  buildBudgetActualKpis,
  buildHeatmapAreas,
  buildVarianceRanking,
  variancePct,
  type BudgetActualRow,
} from '@/lib/finance';

export default function OrcadoRealizadoPage() {
  const [period, setPeriod] = useState<FinancePeriod>('2026-04');
  const [scenario, setScenario] = useState<FinanceScenario>('budget');
  const [filterArea, setFilterArea] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterCC, setFilterCC] = useState<string>('');
  const [selected, setSelected] = useState<BudgetActualRow | null>(null);

  const filtered = useMemo(() => BUDGET_ACTUAL_ROWS.filter((r) => {
    if (filterArea && r.area !== filterArea) return false;
    if (filterStatus && r.status !== filterStatus) return false;
    if (filterCC && r.costCenter !== filterCC) return false;
    return true;
  }), [filterArea, filterStatus, filterCC]);

  const kpis = useMemo(() => buildBudgetActualKpis(filtered, '2026-04-30'), [filtered]);
  const heatmapAreas = useMemo(() => buildHeatmapAreas(BUDGET_ACTUAL_ROWS), []);
  const ranking = useMemo(() => buildVarianceRanking(BUDGET_ACTUAL_ROWS, 5), []);

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
            <FinanceFilterChip
              icon={<Layers3 className="h-3.5 w-3.5" />}
              label="Área" value={filterArea} onChange={setFilterArea}
              options={[{ value: '', label: 'Todas' }, { value: 'Receita', label: 'Receita' }, { value: 'Custo', label: 'Custo Direto' }, { value: 'OPEX', label: 'OPEX' }, { value: 'Financeiro', label: 'Financeiro' }, { value: 'Impostos', label: 'Impostos' }]}
            />
            <FinanceFilterChip
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="CC" value={filterCC} onChange={setFilterCC}
              options={[{ value: '', label: 'Todos' }, { value: 'CC-001', label: 'CC-001 Tecnologia' }, { value: 'CC-005', label: 'CC-005 G&A' }, { value: 'CC-COM', label: 'CC-COM Comercial' }]}
            />
            <FinanceFilterChip
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Status" value={filterStatus} onChange={setFilterStatus}
              options={[{ value: '', label: 'Todos' }, { value: 'ok', label: 'OK' }, { value: 'attention', label: 'Atenção' }, { value: 'critical', label: 'Crítico' }, { value: 'justified', label: 'Justificado' }]}
            />
          </>
        }
        rightSlot={<HudButton variant="primary" size="sm" leftIcon={<Download className="w-4 h-4" />}>Exportar variância</HudButton>}
      />

      <FinanceKpiGrid kpis={kpis} columns={5} />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>S-Curve — Realizado vs Orçado (acumulado)</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
              <FinanceSCurveChart
                categories={['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']}
                series={[
                  { name: 'Realizado', values: [3_910_000, 3_760_000, 4_020_000, 4_440_000, 0, 0, 0, 0, 0, 0, 0, 0], tone: 'accent', emphasized: true },
                  { name: 'Orçado',    values: [3_780_000, 3_700_000, 3_910_000, 4_180_000, 4_220_000, 4_300_000, 4_350_000, 4_400_000, 4_450_000, 4_500_000, 4_550_000, 4_600_000], tone: 'budget', dashed: true },
                  { name: 'Projeção',  values: [3_910_000, 3_760_000, 4_020_000, 4_440_000, 4_510_000, 4_620_000, 4_700_000, 4_780_000, 4_860_000, 4_940_000, 5_020_000, 5_100_000], tone: 'success' },
                ]}
                height={260}
              />
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard>
          <HudCardHeader><HudCardTitle>Composição da variância</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
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
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <HudCard className="md:col-span-2 xl:col-span-1">
          <HudCardHeader><HudCardTitle>Treemap — Categorias em overrun</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-3">
            <FinanceChartContainer>
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
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>
      </div>

      <HudCard>
        <HudCardHeader><HudCardTitle>Ranking de variância por CC</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-3">
          <FinanceChartContainer>
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
          </FinanceChartContainer>
        </HudCardContent>
      </HudCard>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-4">
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
                  className="w-full text-left rounded-lg border border-ig-border-subtle px-3 py-2.5 hover:border-ig-border-focus hover:-translate-y-px transition-all"
                  style={{ backgroundImage: bg }}
                >
                  <div className="flex items-center justify-between gap-3 min-w-0">
                    <div className="text-[12.5px] font-medium text-ig-text-primary truncate">{a.area}</div>
                    <div className={'text-[12.5px] font-mono tabular-nums shrink-0 ' + (a.vp >= 0 ? 'text-ig-success' : 'text-ig-danger')}>{fmtPct(a.vp)}</div>
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
                <li key={r.id} className="py-2.5 flex items-center gap-3 min-w-0">
                  <span className="text-[11px] font-mono text-ig-text-tertiary w-6 shrink-0">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <button onClick={() => setSelected(r)} className="text-[13px] font-medium text-ig-text-primary hover:text-ig-accent text-left truncate w-full">
                      {r.category}
                    </button>
                    <div className="text-[10.5px] text-ig-text-tertiary truncate">{r.area} {r.costCenter ? `• ${r.costCenter}` : ''}</div>
                  </div>
                  <div className="text-right shrink-0">
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

      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
        <HudCard>
          <HudCardHeader><HudCardTitle>Variação por linha — Mês e YTD</HudCardTitle></HudCardHeader>
          <HudCardContent className="p-0">
            <FinanceChartContainer scrollX>
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
                          <div className="truncate">{r.category}</div>
                          <div className="text-[10.5px] text-ig-text-tertiary truncate">{r.area}{r.project ? ` • ${r.project}` : ''}{r.costCenter ? ` • ${r.costCenter}` : ''}</div>
                        </td>
                        <td className="text-right px-5 py-2.5 font-mono tabular-nums text-ig-text-secondary whitespace-nowrap">{fmtBRL(r.budget)}</td>
                        <td className="text-right px-5 py-2.5 font-mono tabular-nums whitespace-nowrap">{fmtBRL(r.actual)}</td>
                        <td className={'text-right px-5 py-2.5 font-mono tabular-nums whitespace-nowrap ' + (dM >= 0 ? 'text-ig-success' : 'text-ig-danger')}>{fmtPct(dM)}</td>
                        <td className={'text-right px-5 py-2.5 font-mono tabular-nums whitespace-nowrap ' + (dY >= 0 ? 'text-ig-success' : 'text-ig-danger')}>{fmtPct(dY)}</td>
                        <td className="px-5 py-2.5"><FinanceStatusBadge status={r.status} /></td>
                        <td className="text-right px-3 py-2.5 text-[11px] text-ig-accent whitespace-nowrap">Detalhe →</td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-5 py-6 text-center text-[12px] text-ig-text-tertiary">Nenhuma linha para os filtros aplicados.</td></tr>
                  )}
                </tbody>
              </table>
            </FinanceChartContainer>
          </HudCardContent>
        </HudCard>

        <FinanceInsightCard
          title="Explicação da variância"
          subtitle="Insights para a próxima reunião de fechamento"
          insights={[
            { id: '1', tone: 'negative', title: 'Custo Direto crítico', detail: 'Pessoal alocado 9,3% acima do orçado por mobilização antecipada — verificar margem do PRJ-2026-002.', action: { label: 'Revisar projeto' } },
            { id: '2', tone: 'warning',  title: 'OPEX G&A em atenção', detail: 'Honorários jurídicos extraordinários puxam +6,7% no mês.' },
            { id: '3', tone: 'positive', title: 'Receita acima do plano', detail: 'Receita +3,0% vs orçado, compensando parcialmente overrun em custo direto.' },
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
                <FinanceChartContainer scrollX>
                  <table className="w-full text-[12px]">
                    <thead><tr className="text-[10px] uppercase tracking-[0.12em] text-ig-text-tertiary">
                      <th className="text-left py-1.5">Data</th><th className="text-left">Ref</th><th className="text-left">Descrição</th><th className="text-right">Valor</th>
                    </tr></thead>
                    <tbody>
                      {selected.transactions.map((t, idx) => (
                        <tr key={idx} className="border-t border-ig-border-subtle/50">
                          <td className="py-1.5 font-mono text-[11px] text-ig-text-secondary whitespace-nowrap">{t.date}</td>
                          <td className="font-mono text-[11px] text-ig-text-secondary whitespace-nowrap">{t.ref}</td>
                          <td className="text-ig-text-primary">{t.description}</td>
                          <td className="text-right font-mono tabular-nums whitespace-nowrap">{fmtBRL(t.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </FinanceChartContainer>
              ) : <div className="text-[12px] text-ig-text-tertiary">Sem lançamentos diretamente vinculados.</div>}
            </FinanceDrawerSection>
          </>
        )}
      </FinanceDetailDrawer>
    </HudPageLayout>
  );
}
