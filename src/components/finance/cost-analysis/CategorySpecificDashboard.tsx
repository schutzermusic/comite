'use client';

import React, { useMemo, useCallback, useState } from 'react';
import {
  Download, Layers, FolderKanban, Truck, Users, Gauge, Building2, FileText,
  Fuel, Receipt, Briefcase, CalendarClock, Eye, EyeOff, Repeat,
} from 'lucide-react';
import { HudCard, HudCardContent, HudButton } from '@/components/hud';
import {
  FinanceInsightCard,
  fmtBRL, fmtCompactBRL, fmtPct,
  type DonutSlice,
  type TreemapNode,
  type StackedBarSeries,
  type SCurveSeries,
} from '@/components/finance/shared';
import type { LedgerEntry } from '@/lib/types/finance';
import {
  selectCostBySubcategory,
  selectCategoryByProject,
  selectCategoryByContract,
  selectCategoryByCostCenter,
  selectCostBySupplier,
  selectCostByCollaborator,
  selectCostByDepartment,
  selectMonthlyCostTotals,
  selectSubcategoryTrendByMonth,
  selectCostLedgerEntries,
  selectCostAnalysisSummary,
  selectSupplierVariation,
  selectTopCostDrivers,
  categoryIdsUnderCodes,
  type CategoryAnalysisFilter,
} from '@/lib/finance/selectors';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { demoEntriesForScope } from '@/data/finance/demo-fixtures';
import { managementCategories, resolveCategoryPath, suppliers as supplierSeed } from '@/data/finance/seed-categories';
import { projects as projectRefs } from '@/data/finance/reference';
import {
  RankPanel, DonutPanel, TreemapPanel, TrendPanel, StackedBarPanel, ListPanel, EntryTable, DemoBadge, MiniStat,
  KpiSparkGrid, SCurvePanel, WaterfallPanel, HeatmapPanel,
  type EntryRow, type ListRow, type SparkKpi,
} from './panels';
import { buildCategoryInsights } from './narrative';
import { monthAxis, previousWindow, alignToAxis, buildMoMWaterfall, buildHeatmap } from './transforms';
import { entriesToCsv, downloadCsv } from './cost-csv';
import type { CategoryDashboardConfig } from './category-dashboards';

const DONUT_TONES: DonutSlice['tone'][] = ['accent', 'info', 'success', 'warning', 'danger', 'budget'];
const TREE_TONES: NonNullable<TreemapNode['tone']>[] = ['accent', 'info', 'success', 'warning', 'danger', 'budget'];
const STACK_TONES: NonNullable<StackedBarSeries['tone']>[] = ['accent', 'info', 'success', 'warning', 'danger', 'budget'];
const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const monthLabel = (p: string) => `${MONTHS_PT[Number(p.split('-')[1]) - 1] ?? p}/${p.split('-')[0]?.slice(2) ?? ''}`;
const reais = (e: LedgerEntry) => Math.abs(e.amount_cents) / 100;

export interface CategorySpecificDashboardProps {
  /** Resolved dashboard configuration for the selected categoria. */
  config: CategoryDashboardConfig;
  /** Shared global filter (period/scenario/group/project/contract/cc/supplier/collaborator/status). */
  filter: CategoryAnalysisFilter;
  /** Active subcategoria drilldown (within this category), or null. */
  drillSub: string | null;
  onSelectSub: (id: string) => void;
  /** Toggle the corresponding parent filter (drilldown to entries). */
  onSelectProject: (id: string) => void;
  onSelectSupplier: (id: string) => void;
  onSelectCollaborator: (id: string) => void;
  periodFrom: string;
  periodTo: string;
}

/**
 * Category-specific cost dashboard. Driven entirely by the selected categoria
 * via the resolved {@link CategoryDashboardConfig}. It scopes the unified ledger
 * to the categoria subtree (config.scopeRootCodes) and renders a layout tailored
 * to the dashboardType (logistics / materials / fleet / services / admin / taxes
 * / payroll / generic).
 *
 * Data source: real ledger by default. When the subtree has NO real postings in
 * the period (e.g. Frota, Administrativo), it transparently falls back to the
 * isolated demo fixtures and surfaces a "dados demonstrativos" badge. All
 * aggregates still flow through the same category-analysis selectors, so demo
 * and real data use identical calculation logic and respect every filter.
 */
export function CategorySpecificDashboard({
  config, filter, drillSub,
  onSelectSub, onSelectProject, onSelectSupplier, onSelectCollaborator,
  periodFrom, periodTo,
}: CategorySpecificDashboardProps) {
  const categoryIds = useMemo(() => categoryIdsUnderCodes(config.scopeRootCodes), [config.scopeRootCodes]);

  // ── Demo fallback decision ────────────────────────────────────
  // Probe real data for the subtree using only period/plane scope (stable —
  // not affected by dimension drilldowns).
  //   • 0 real entries          → render demo fixtures automatically.
  //   • < 10 entries OR < 3 subs → expose a "Visualizar demo" toggle (opt-in).
  //   • otherwise               → real data only.
  const probe = useMemo<CategoryAnalysisFilter>(
    () => ({ periodFrom, periodTo, entryType: filter.entryType, categoryIds }),
    [periodFrom, periodTo, filter.entryType, categoryIds],
  );
  const realProbe = useMemo(() => {
    const rows = selectCostLedgerEntries(probe, undefined, mockLedgerEntries);
    const subs = new Set(rows.map((e) => e.category_id)).size;
    return { count: rows.length, subs };
  }, [probe]);
  const hasDemo = useMemo(() => demoEntriesForScope(config.scopeRootCodes).length > 0, [config.scopeRootCodes]);

  const autoDemo = realProbe.count === 0 && hasDemo;
  const isSparse = !autoDemo && hasDemo && (realProbe.count < 10 || realProbe.subs < 3);

  // Opt-in preview for sparse (but non-empty) categories. Resets per category
  // because the parent remounts this component with a key={config.key}.
  const [demoPreview, setDemoPreview] = useState(false);
  const isDemo = autoDemo || (isSparse && demoPreview);

  const source = useMemo<LedgerEntry[]>(
    () => (isDemo ? demoEntriesForScope(config.scopeRootCodes) : mockLedgerEntries),
    [isDemo, config.scopeRootCodes],
  );

  // Category-scoped global filter, then the active subcategoria drill.
  const base = useMemo<CategoryAnalysisFilter>(() => ({ ...filter, categoryIds }), [filter, categoryIds]);
  const scoped = useMemo<CategoryAnalysisFilter>(() => ({ ...base, subcategoryId: drillSub ?? undefined }), [base, drillSub]);

  // ── Selector outputs (all fed the resolved source) ────────────
  const summary = useMemo(() => selectCostAnalysisSummary(base, source), [base, source]);
  const subcategories = useMemo(() => selectCostBySubcategory(base, source), [base, source]);
  const monthly = useMemo(() => selectMonthlyCostTotals(scoped, source), [scoped, source]);
  const byProject = useMemo(() => selectCategoryByProject(scoped, source), [scoped, source]);
  const byContract = useMemo(() => selectCategoryByContract(scoped, source).filter((r) => r.id), [scoped, source]);
  const byCostCenter = useMemo(() => selectCategoryByCostCenter(scoped, source).filter((r) => r.id), [scoped, source]);
  const bySupplier = useMemo(() => selectCostBySupplier(scoped, source).filter((s) => s.id), [scoped, source]);
  const byCollaborator = useMemo(
    () => (config.supportsCollaborator ? selectCostByCollaborator(scoped, source) : []),
    [config.supportsCollaborator, scoped, source],
  );
  const byDepartment = useMemo(
    () => (config.dashboardType === 'payroll' ? selectCostByDepartment(scoped, source) : []),
    [config.dashboardType, scoped, source],
  );
  // Per-subcategoria monthly series — drives the stacked composition, the
  // m/m waterfall bridge and the subcategoria × month heatmap.
  const subTrend = useMemo(() => selectSubcategoryTrendByMonth(scoped, source), [scoped, source]);
  const topDrivers = useMemo(() => selectTopCostDrivers(scoped, 8, source), [scoped, source]);
  const supplierVar = useMemo(() => (config.supportsSupplier ? selectSupplierVariation(base, source) : new Map()), [config.supportsSupplier, base, source]);
  const allEntries = useMemo(() => selectCostLedgerEntries(scoped, undefined, source), [scoped, source]);
  const entries = useMemo(() => allEntries.slice(0, 120), [allEntries]);

  // ── Comparative / executive chart data (realized only) ────────
  const axis = useMemo(() => monthAxis(periodFrom, periodTo), [periodFrom, periodTo]);
  const sCurveSeries = useMemo<SCurveSeries[]>(() => {
    const cur = alignToAxis(monthly, axis);
    const prevW = previousWindow(periodFrom, periodTo);
    const prevMonthly = selectMonthlyCostTotals({ ...scoped, periodFrom: prevW.from, periodTo: prevW.to }, source);
    const prevVals = alignToAxis(prevMonthly, monthAxis(prevW.from, prevW.to));
    const series: SCurveSeries[] = [{ name: 'Realizado acumulado', values: cur, tone: 'accent', emphasized: true }];
    if (prevVals.some((v) => v > 0)) series.push({ name: 'Período anterior', values: prevVals, tone: 'info', dashed: true });
    return series;
  }, [monthly, axis, periodFrom, periodTo, scoped, source]);
  const waterfall = useMemo(() => buildMoMWaterfall(subTrend, 7), [subTrend]);
  const heatmap = useMemo(() => buildHeatmap(subTrend, axis, 10), [subTrend, axis]);

  // Recurring vs one-off composition per month (admin stacked bar).
  const recurringStacked = useMemo<{ categories: string[]; series: StackedBarSeries[] }>(() => {
    const rec = new Map<string, number>();
    const one = new Map<string, number>();
    for (const e of allEntries) {
      if (e.metadata?.recurring === undefined) continue;
      const m = e.metadata.recurring ? rec : one;
      m.set(e.period_key, (m.get(e.period_key) ?? 0) + reais(e));
    }
    return {
      categories: axis.map(monthLabel),
      series: [
        { name: 'Recorrente', tone: 'accent', data: axis.map((p) => rec.get(p) ?? 0) },
        { name: 'Pontual', tone: 'warning', data: axis.map((p) => one.get(p) ?? 0) },
      ],
    };
  }, [allEntries, axis]);

  // ── Derived metrics ───────────────────────────────────────────
  const collabTotal = byCollaborator.reduce((s, c) => s + c.value, 0);
  const avgPerCollaborator = byCollaborator.length ? collabTotal / byCollaborator.length : 0;
  const collabConcentration = collabTotal > 0
    ? byCollaborator.slice(0, 3).reduce((s, c) => s + c.value, 0) / collabTotal
    : 0;

  const agencyTotal = bySupplier.reduce((s, r) => s + r.value, 0);
  const topAgency = bySupplier[0];
  const topAgencyVar = topAgency ? (supplierVar.get(topAgency.id) as number | undefined) : undefined;
  const supplierEntryCount = allEntries.filter((e) => e.supplier_id).length;
  const avgTicket = supplierEntryCount > 0 ? agencyTotal / supplierEntryCount : 0;
  const ticketAll = summary.entryCount > 0 ? summary.total / summary.entryCount : 0;

  // Payroll allocation split (project-attributed vs structural/unallocated).
  const allocatedValue = useMemo(() => allEntries.filter((e) => e.project_id).reduce((s, e) => s + reais(e), 0), [allEntries]);
  const unallocatedValue = Math.max(0, summary.total - allocatedValue);
  const allocationRate = summary.total > 0 ? allocatedValue / summary.total : 0;

  // Recurring vs one-off split (services / admin demo carry this flag).
  const recurring = useMemo(() => {
    let rec = 0, one = 0, tagged = 0;
    for (const e of allEntries) {
      const flag = e.metadata?.recurring;
      if (flag === undefined) continue;
      tagged += 1;
      if (flag) rec += reais(e); else one += reais(e);
    }
    return { rec, one, tagged, recRate: rec + one > 0 ? rec / (rec + one) : 0 };
  }, [allEntries]);
  const showRecurring = (config.dashboardType === 'services' || config.dashboardType === 'admin') && recurring.tagged > 0;

  const subLabel = config.dashboardType === 'taxes' ? 'tipo de tributo'
    : config.dashboardType === 'payroll' ? 'rubrica' : 'subcategoria';

  // ── Premium KPI strip (type-aware sixth/extra metric) ─────────
  const dim = (r?: { name: string; value: number; share: number }, fallback = '—') =>
    ({ value: r?.name ?? fallback, helper: r ? `${fmtCompactBRL(r.value)} · ${(r.share * 100).toFixed(0)}%` : undefined });

  const kpis = useMemo<SparkKpi[]>(() => {
    const sparkVals = monthly.map((p) => p.value);
    const out: SparkKpi[] = [
      {
        id: 'cat-total', label: 'Custo total', value: fmtBRL(summary.total),
        helper: `${summary.entryCount} lançamentos`, delta: summary.momPct,
        spark: sparkVals, tone: 'accent',
      },
      {
        id: 'cat-mom', label: 'Variação m/m',
        value: summary.momPct === undefined ? '—' : `${summary.momPct > 0 ? '+' : ''}${summary.momPct.toFixed(1)}%`,
        helper: summary.lastPeriod ? `${fmtCompactBRL(summary.lastPeriodValue)} no último mês` : 'Sem série',
        delta: summary.momPct,
      },
      {
        id: 'cat-sub', label: 'Maior subcategoria', ...dim(summary.topSubcategory),
      },
    ];

    if (config.dashboardType === 'payroll') {
      const leader = config.payrollKind === 'indirect' ? byDepartment[0] : byProject[0];
      out.push(
        { id: 'cat-leader', label: config.payrollKind === 'indirect' ? 'Departamento líder' : 'Projeto líder', ...dim(leader) },
        { id: 'cat-cc', label: 'Centro de custo líder', ...dim(byCostCenter[0]) },
        {
          id: 'cat-alloc', label: 'Alocado a projeto', value: `${(allocationRate * 100).toFixed(0)}%`,
          helper: `${fmtCompactBRL(allocatedValue)} aloc. · ${fmtCompactBRL(unallocatedValue)} estrutural`,
        },
      );
    } else if (config.dashboardType === 'taxes') {
      const perMonth = monthly.length ? summary.total / monthly.length : 0;
      out.push(
        { id: 'cat-cc', label: 'Centro de custo líder', ...dim(byCostCenter[0]) },
        { id: 'cat-ticket', label: 'Tributo médio / mês', value: fmtBRL(perMonth), helper: `${monthly.length} competências`, spark: sparkVals, tone: 'warning' },
        { id: 'cat-count', label: 'Tipos de tributo', value: `${summary.subcategoryCount} tipos`, helper: `${summary.entryCount} lançamentos` },
      );
    } else {
      out.push({
        id: 'cat-proj', label: config.supportsProject ? 'Projeto líder' : 'Centro de custo líder',
        ...dim(config.supportsProject ? byProject[0] : byCostCenter[0]),
      });
      out.push(config.supportsSupplier
        ? { id: 'cat-sup', label: config.supplierLabel, ...dim(topAgency, 'Sem fornecedor') }
        : { id: 'cat-cc', label: 'Centro de custo líder', ...dim(byCostCenter[0]) });
      out.push(config.supportsCollaborator
        ? { id: 'cat-collab', label: 'Custo médio / colaborador', value: fmtBRL(avgPerCollaborator), helper: `${byCollaborator.length} colaboradores` }
        : { id: 'cat-ticket', label: 'Ticket médio', value: fmtBRL(ticketAll), helper: `${summary.entryCount} lançamentos` });
    }
    return out;
  }, [config, summary, monthly, byProject, byCostCenter, byDepartment, topAgency, avgPerCollaborator, byCollaborator.length, ticketAll, allocationRate, allocatedValue, unallocatedValue]);

  // ── Executive narrative ───────────────────────────────────────
  const insights = useMemo(
    () => buildCategoryInsights({
      summary, subcategories, byProject, bySupplier, byCollaborator,
      supplierLabel: config.supplierLabel, supportsProject: config.supportsProject, subLabel,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary, subcategories, byProject, bySupplier, byCollaborator, config],
  );

  // ── Chart data ────────────────────────────────────────────────
  const donutData = useMemo<DonutSlice[]>(
    () => subcategories.slice(0, 6).map((c, i) => ({ name: c.name, value: c.value, tone: DONUT_TONES[i % DONUT_TONES.length] })),
    [subcategories],
  );

  const projectTreemap = useMemo<TreemapNode[]>(() => {
    const top = byProject.slice(0, 10).map((r, i) => ({ name: r.name, value: r.value, tone: TREE_TONES[i % TREE_TONES.length] }));
    const rest = byProject.slice(10);
    if (rest.length) top.push({ name: `Outros (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0), tone: 'budget' });
    return top;
  }, [byProject]);

  const agencyDonut = useMemo<DonutSlice[]>(
    () => bySupplier.slice(0, 6).map((s, i) => ({ name: s.name, value: s.value, tone: DONUT_TONES[i % DONUT_TONES.length] })),
    [bySupplier],
  );

  // Fleet & Logistics: stacked composition by month (top subcategories as series).
  const showSubStack = config.dashboardType === 'fleet' || config.dashboardType === 'logistics';
  const fleetStacked = useMemo<{ categories: string[]; series: StackedBarSeries[] }>(() => {
    if (!showSubStack) return { categories: [], series: [] };
    const periods = Array.from(new Set(subTrend.flatMap((s) => s.points.map((p) => p.period)))).sort();
    const series = subTrend.slice(0, 6).map((s, i) => ({
      name: s.name,
      tone: STACK_TONES[i % STACK_TONES.length],
      data: periods.map((p) => s.points.find((pt) => pt.period === p)?.value ?? 0),
    }));
    return { categories: periods.map(monthLabel), series };
  }, [showSubStack, subTrend]);

  // Taxes: due list grouped by competence month.
  const taxDueList = useMemo<ListRow[]>(() => {
    if (config.dashboardType !== 'taxes') return [];
    const map = new Map<string, number>();
    for (const e of allEntries) map.set(e.period_key, (map.get(e.period_key) ?? 0) + reais(e));
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([period, value]) => ({ id: period, label: `Competência ${monthLabel(period)}`, meta: 'Reconhecimento P&L (exclui liquidação)', value, badge: period }));
  }, [config.dashboardType, allEntries]);

  // ── Entry rows ────────────────────────────────────────────────
  const entryRows = useMemo<EntryRow[]>(() => entries.map((e) => {
    const cat = managementCategories.find((c) => c.id === e.category_id);
    const path = cat ? resolveCategoryPath(cat) : undefined;
    const collaborator = e.metadata?.collaborator_name as string | undefined;
    return {
      id: e.id,
      date: e.entry_date,
      description: collaborator && config.supportsCollaborator ? `${e.description} · ${collaborator}` : e.description,
      categoryName: path?.categoryName ?? '—',
      subcategoryName: path?.subcategoryName ?? path?.categoryName ?? '—',
      projectName: projectRefs.find((p) => p.id === e.project_id)?.name,
      supplierName: supplierSeed.find((s) => s.id === e.supplier_id)?.name,
      value: reais(e),
    };
  }), [entries, config.supportsCollaborator]);

  const handleExport = useCallback(() => {
    const tag = isDemo ? 'demo' : 'real';
    downloadCsv(`analise-custos_${config.key}_${tag}_${periodFrom}_${periodTo}.csv`, entriesToCsv(allEntries));
  }, [allEntries, config.key, periodFrom, periodTo, isDemo]);

  // Toggle helpers — clicking an active row clears that filter.
  const toggleProject = useCallback((id: string) => onSelectProject(filter.projectId === id ? 'all' : id), [filter.projectId, onSelectProject]);
  const toggleSupplier = useCallback((id: string) => onSelectSupplier(filter.supplierId === id ? 'all' : id), [filter.supplierId, onSelectSupplier]);
  const toggleCollaborator = useCallback((id: string) => onSelectCollaborator(filter.collaboratorId === id ? 'all' : id), [filter.collaboratorId, onSelectCollaborator]);

  const drillSubName = drillSub ? managementCategories.find((c) => c.id === drillSub)?.name : undefined;

  return (
    <>
      {/* Demo state: auto banner when empty, opt-in toggle when sparse. */}
      {isDemo && (
        <HudCard>
          <HudCardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="text-[12px] text-ig-text-secondary">
              {autoDemo
                ? 'Esta categoria ainda não possui lançamentos reais no razão para o período. Exibindo uma amostra visual isolada — não afeta DRE, Control Room ou números oficiais.'
                : 'Pré-visualização com dados demonstrativos isolados. Os números reais do recorte são esparsos e não afetam DRE/Control Room.'}
            </span>
            <span className="inline-flex items-center gap-2">
              <DemoBadge />
              {isSparse && (
                <HudButton variant="glass" size="sm" leftIcon={<EyeOff className="h-3.5 w-3.5" />} onClick={() => setDemoPreview(false)}>
                  Ver dados reais
                </HudButton>
              )}
            </span>
          </HudCardContent>
        </HudCard>
      )}
      {isSparse && !demoPreview && (
        <HudCard>
          <HudCardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
            <span className="text-[12px] text-ig-text-secondary">
              Poucos lançamentos reais nesta categoria ({realProbe.count} no período). Visualize uma amostra demonstrativa para validar o dashboard.
            </span>
            <HudButton variant="glass" size="sm" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => setDemoPreview(true)}>
              Visualizar demo
            </HudButton>
          </HudCardContent>
        </HudCard>
      )}

      {/* Executive KPIs */}
      <KpiSparkGrid kpis={kpis} columns={6} />

      {/* Executive reading + composition */}
      {insights.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
          <FinanceInsightCard
            title={`Leitura executiva · ${config.title}`}
            subtitle="Principais drivers, variação e concentração do recorte"
            insights={insights}
          />
          <DonutPanel title={`Distribuição por ${subLabel}`} data={donutData} centerLabel={config.title} centerValue={fmtCompactBRL(summary.total)} />
        </div>
      ) : (
        <DonutPanel title={`Distribuição por ${subLabel}`} data={donutData} centerLabel={config.title} centerValue={fmtCompactBRL(summary.total)} />
      )}

      {/* Curva S (realizado acumulado) + tendência mensal */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SCurvePanel title={`Curva S — ${config.title} acumulado`} categories={axis} series={sCurveSeries} />
        <TrendPanel title={`Tendência mensal · ${config.title}`} points={monthly} />
      </div>

      {/* Ponte de variação m/m (não aplicável a folha/tributos no recorte único) */}
      {config.dashboardType !== 'payroll' && config.dashboardType !== 'taxes' && (
        <WaterfallPanel title={`Variação m/m por ${subLabel} (ponte)`} steps={waterfall} />
      )}

      {/* Recurring vs one-off (services / admin) */}
      {showRecurring && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MiniStat label="Gasto recorrente" value={fmtBRL(recurring.rec)} helper={`${(recurring.recRate * 100).toFixed(0)}% do gasto classificado`} tone="neutral" />
            <MiniStat label="Gasto pontual (one-off)" value={fmtBRL(recurring.one)} helper="contratos não recorrentes" tone={recurring.one > recurring.rec ? 'neg' : 'neutral'} />
            <MiniStat label="Mix recorrente" value={`${(recurring.recRate * 100).toFixed(0)}%`} helper="estabilidade do custo" />
            <MiniStat label="Itens classificados" value={`${recurring.tagged}`} helper="lançamentos com natureza" />
          </div>
          <StackedBarPanel
            title={<span className="inline-flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5 text-ig-text-tertiary" /> Recorrente vs pontual por mês</span>}
            categories={recurringStacked.categories}
            series={recurringStacked.series}
          />
        </>
      )}

      {/* Fleet & Logistics: stacked composition by month */}
      {showSubStack && (
        <StackedBarPanel
          title={
            <span className="inline-flex items-center gap-1.5">
              <Fuel className="h-3.5 w-3.5 text-ig-text-tertiary" />
              {config.dashboardType === 'fleet'
                ? 'Composição mensal (combustível · locação · manutenção · pedágio · …)'
                : 'Composição mensal (hotel · aéreo · carro · combustível · pedágio · …)'}
            </span>
          }
          categories={fleetStacked.categories}
          series={fleetStacked.series}
        />
      )}

      {/* Materiais / Tributos: heatmap subcategoria × mês */}
      {(config.dashboardType === 'materials' || config.dashboardType === 'taxes') && (
        <HeatmapPanel
          title={config.dashboardType === 'taxes' ? 'Mapa de calor — tipo de tributo × competência' : 'Mapa de calor — tipo de material × mês'}
          data={heatmap}
          accent={config.accent}
        />
      )}

      {/* Subcategory ranking (Pareto) */}
      <RankPanel
        title={<span className="inline-flex items-center gap-1.5"><Layers className="h-3.5 w-3.5 text-ig-text-tertiary" /> Custo por {subLabel} (Pareto)</span>}
        rows={subcategories.map((s) => ({ id: s.id, label: s.name, meta: s.categoryName, value: s.value, share: s.share }))}
        accent={config.accent} activeId={drillSub} onSelect={onSelectSub} pareto limit={20}
        emptyLabel={config.emptyState}
      />

      {/* Project analysis */}
      {config.supportsProject && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TreemapPanel
            title={<span className="inline-flex items-center gap-1.5"><FolderKanban className="h-3.5 w-3.5 text-ig-text-tertiary" /> Distribuição por projeto</span>}
            data={projectTreemap}
            emptyLabel="Sem custo por projeto."
          />
          <RankPanel
            title="Custo por projeto"
            rows={byProject.map((r) => ({ id: r.id || '_none', label: r.name, value: r.value, share: r.share }))}
            accent="#3B82F6" activeId={filter.projectId && filter.projectId !== 'all' ? filter.projectId : null}
            onSelect={(id) => toggleProject(id === '_none' ? 'all' : id)}
            emptyLabel="Sem custo por projeto."
          />
        </div>
      )}

      {/* Payroll-only: department + cost-center + allocation */}
      {config.dashboardType === 'payroll' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <MiniStat label="Alocado a projeto" value={fmtBRL(allocatedValue)} helper={`${(allocationRate * 100).toFixed(0)}% do total`} tone={allocationRate >= 0.7 ? 'pos' : 'neutral'} />
            <MiniStat label="Custo estrutural (não alocado)" value={fmtBRL(unallocatedValue)} helper="sem projeto" tone={unallocatedValue > 0 ? 'neg' : 'neutral'} />
            <MiniStat label="Departamentos" value={`${byDepartment.length}`} helper={byDepartment[0]?.name} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RankPanel
              title={<span className="inline-flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5 text-ig-text-tertiary" /> Folha por departamento</span>}
              rows={byDepartment.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
              accent={config.accent} emptyLabel="Sem departamentos no recorte."
            />
            <RankPanel
              title={<span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-ig-text-tertiary" /> Folha por centro de custo</span>}
              rows={byCostCenter.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
              accent="#EC4899" emptyLabel="Sem centros de custo no recorte."
            />
          </div>
        </>
      )}

      {/* Taxes-only: due list + cost-center */}
      {config.dashboardType === 'taxes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ListPanel
            title={<span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3.5 w-3.5 text-ig-text-tertiary" /> Tributos por competência</span>}
            rows={taxDueList} emptyLabel="Sem competências no recorte."
          />
          <RankPanel
            title={<span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-ig-text-tertiary" /> Tributos por centro de custo</span>}
            rows={byCostCenter.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
            accent="#EC4899" emptyLabel="Sem centros de custo no recorte."
          />
        </div>
      )}

      {/* Contract analysis (services / generic with contracts) */}
      {config.supportsContract && byContract.length > 0 && config.dashboardType !== 'payroll' && config.dashboardType !== 'taxes' && (
        <RankPanel
          title={<span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-ig-text-tertiary" /> Custo por contrato</span>}
          rows={byContract.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
          accent="#A78BFA" emptyLabel="Sem contratos no recorte."
        />
      )}

      {/* Cost-center ranking for non-payroll/non-tax types that support it */}
      {config.supportsCostCenter && byCostCenter.length > 0 && !['payroll', 'taxes'].includes(config.dashboardType) && (
        <RankPanel
          title={<span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-ig-text-tertiary" /> Custo por centro de custo</span>}
          rows={byCostCenter.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
          accent="#EC4899" emptyLabel="Sem centros de custo no recorte."
        />
      )}

      {/* Collaborator analysis (logistics) */}
      {config.supportsCollaborator && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <MiniStat label="Custo médio / colaborador" value={fmtBRL(avgPerCollaborator)} helper={`${byCollaborator.length} colaboradores com gasto`} />
            <MiniStat label="Concentração (Top 3)" value={`${(collabConcentration * 100).toFixed(0)}%`} helper="do gasto atribuído" tone={collabConcentration >= 0.6 ? 'neg' : 'neutral'} />
            <MiniStat label="Maior gasto individual" value={byCollaborator[0] ? fmtCompactBRL(byCollaborator[0].value) : '—'} helper={byCollaborator[0]?.name} />
          </div>
          <RankPanel
            title={<span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-ig-text-tertiary" /> Top 20 colaboradores por gasto</span>}
            rows={byCollaborator.slice(0, 20).map((c) => ({
              id: c.id, label: c.name,
              meta: [c.mainProject, c.mainCategory].filter(Boolean).join(' · ') || undefined,
              value: c.value, share: c.share,
            }))}
            accent="#A855F7" limit={20}
            activeId={filter.collaboratorId && filter.collaboratorId !== 'all' ? filter.collaboratorId : null}
            onSelect={toggleCollaborator}
            emptyLabel="Nenhum gasto atribuído a colaborador no recorte."
          />
        </>
      )}

      {/* Supplier / agency analysis */}
      {config.supportsSupplier && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MiniStat label={`Gasto total ${config.supplierLabel.toLowerCase()}`} value={fmtBRL(agencyTotal)} helper={`${bySupplier.length} fornecedores`} />
            <MiniStat label="Share do maior" value={topAgency ? `${(topAgency.share * 100).toFixed(0)}%` : '—'} helper={topAgency?.name} />
            <MiniStat label="Ticket médio" value={fmtBRL(avgTicket)} helper={`${supplierEntryCount} lançamentos`} />
            <MiniStat
              label="Variação do maior"
              value={topAgencyVar === undefined ? '—' : fmtPct(topAgencyVar)}
              helper="último mês vs anterior"
              tone={topAgencyVar === undefined ? 'neutral' : topAgencyVar > 0 ? 'neg' : 'pos'}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {bySupplier.length <= 6 ? (
              <DonutPanel title={`Distribuição por ${config.supplierLabel.toLowerCase()}`} data={agencyDonut} centerLabel="Fornec." centerValue={fmtCompactBRL(agencyTotal)} />
            ) : (
              <TreemapPanel
                title={<span className="inline-flex items-center gap-1.5"><Truck className="h-3.5 w-3.5 text-ig-text-tertiary" /> Distribuição por {config.supplierLabel.toLowerCase()}</span>}
                data={bySupplier.slice(0, 12).map((s, i) => ({ name: s.name, value: s.value, tone: TREE_TONES[i % TREE_TONES.length] }))}
              />
            )}
            <RankPanel
              title={<span className="inline-flex items-center gap-1.5"><Truck className="h-3.5 w-3.5 text-ig-text-tertiary" /> Gasto por {config.supplierLabel.toLowerCase()}</span>}
              rows={bySupplier.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
              accent="#10B981"
              activeId={filter.supplierId && filter.supplierId !== 'all' ? filter.supplierId : null}
              onSelect={toggleSupplier}
              emptyLabel="Sem fornecedores no recorte."
            />
          </div>
        </>
      )}

      {/* Top cost drivers */}
      <RankPanel
        title={<span className="inline-flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5 text-ig-text-tertiary" /> Top cost drivers ({subLabel})</span>}
        rows={topDrivers.map((d) => ({ id: d.subcategoryId, label: d.subcategoryName, meta: d.categoryName, value: d.value, share: d.share }))}
        accent="#F59E0B" onSelect={onSelectSub} activeId={drillSub} limit={8}
        emptyLabel={config.emptyState}
      />

      {/* Detail table */}
      <EntryTable
        title={
          <span className="inline-flex w-full items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5 text-ig-text-tertiary" /> Lançamentos {drillSubName ? `· ${drillSubName}` : `· ${config.title}`}
              {isDemo && <DemoBadge className="ml-1" />}
            </span>
            <HudButton variant="glass" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={handleExport}>CSV</HudButton>
          </span>
        }
        rows={entryRows}
        emptyLabel={config.emptyState}
      />
    </>
  );
}
