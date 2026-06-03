'use client';

import React, { useMemo, useState, useCallback } from 'react';
import {
  Coins, FolderKanban, FileText, Building2, Truck, Boxes,
  CalendarRange, Tag, Download, X, Plane, Users, ChevronRight,
  Receipt, Wallet, Home,
} from 'lucide-react';
import { HudPageLayout, HudHeader, HudButton } from '@/components/hud';
import {
  FinanceFilterBar, FinanceFilterChip,
  FinanceInsightCard,
  fmtBRL, fmtCompactBRL,
  type DonutSlice,
  type SCurveSeries,
} from '@/components/finance/shared';
import type { LedgerEntryStatus, LedgerEntryType, ManagementGroupKey } from '@/lib/types/finance';
import {
  selectCostByCategory,
  selectCostBySubcategory,
  selectCategoryByProject,
  selectCategoryByContract,
  selectCategoryByCostCenter,
  selectCostBySupplier,
  selectTopCostDrivers,
  selectMobilizationBreakdown,
  selectMonthlyCostTotals,
  selectCategoryTrendByMonth,
  selectCostLedgerEntries,
  selectCostAnalysisSummary,
  type CategoryAnalysisFilter,
} from '@/lib/finance/selectors';
import {
  managementCategories,
  resolveCategoryPath,
  costCenters as costCenterSeed,
  suppliers as supplierSeed,
} from '@/data/finance/seed-categories';
import { projects as projectRefs, contracts as contractRefs, collaborators } from '@/data/finance/reference';
import { generatePeriodOptions } from '@/components/finance/control-room/helpers';
import { cn } from '@/lib/utils';
import {
  RankPanel, DonutPanel, TrendPanel, EntryTable, KpiSparkGrid,
  SCurvePanel, WaterfallPanel, HeatmapPanel,
  type EntryRow, type SparkKpi,
} from './panels';
import { CategorySpecificDashboard } from './CategorySpecificDashboard';
import { quickCategories, resolveCategoryDashboard, type CategoryDashboardType } from './category-dashboards';
import { buildGlobalInsights } from './narrative';
import { monthAxis, previousWindow, alignToAxis, buildMoMWaterfall, buildHeatmap } from './transforms';
import { entriesToCsv, downloadCsv } from './cost-csv';

// ── Static option sets ──────────────────────────────────────────
const PERIODS = generatePeriodOptions();
const DONUT_TONES: DonutSlice['tone'][] = ['accent', 'info', 'success', 'warning', 'danger', 'budget'];

// Análise de Custos shows REALIZED costs only — there is no scenario selector.
// Budget/forecast planes still exist for other pages; here entryType is forced
// to 'actual' (posted/reconciled, clearing excluded) by the selectors.
//
// Note: Cenário, Grupo DRE, Status and Fornecedor are intentionally NOT exposed
// as top-level filters on this executive screen. The internal logic still applies
// and supplier/agency remains available inside the category dashboards as
// rankings/drilldowns.
const PROJECT_OPTIONS = [{ value: 'all', label: 'Todos os projetos' }, ...projectRefs.map((p) => ({ value: p.id, label: p.name }))];
const CONTRACT_OPTIONS = [{ value: 'all', label: 'Todos os contratos' }, ...contractRefs.map((c) => ({ value: c.id, label: `${c.code} — ${c.client_name}` }))];
const CC_OPTIONS = [{ value: 'all', label: 'Todos os CC' }, ...costCenterSeed.map((c) => ({ value: c.id, label: c.name }))];
const COLLABORATOR_OPTIONS = [{ value: 'all', label: 'Todos os colaboradores' }, ...collaborators.map((c) => ({ value: c.id, label: c.name }))];

// Curated quick-access categories (Viagens intentionally folded into B.2).
const QUICK_CATS = quickCategories();

// Header icon + tint per category dashboard type.
function headerVisual(type?: CategoryDashboardType): { icon: React.ReactNode; tint: string } {
  switch (type) {
    case 'logistics': return { icon: <Plane className="h-5 w-5" />, tint: '#F43F5E' };
    case 'materials': return { icon: <Boxes className="h-5 w-5" />, tint: '#F59E0B' };
    case 'fleet': return { icon: <Truck className="h-5 w-5" />, tint: '#3B82F6' };
    case 'admin': return { icon: <Building2 className="h-5 w-5" />, tint: '#8B5CF6' };
    case 'services': return { icon: <FileText className="h-5 w-5" />, tint: '#06B6D4' };
    case 'taxes': return { icon: <Receipt className="h-5 w-5" />, tint: '#EAB308' };
    case 'payroll': return { icon: <Wallet className="h-5 w-5" />, tint: '#22C55E' };
    case 'generic': return { icon: <Tag className="h-5 w-5" />, tint: '#14B8A6' };
    default: return { icon: <Coins className="h-5 w-5" />, tint: '#14B8A6' };
  }
}

export function CostAnalysisDashboard() {
  const [periodFrom, setPeriodFrom] = useState('2026-01');
  const [periodTo, setPeriodTo] = useState('2026-06');
  // Realized-only screen: Cenário, Grupo DRE and Status are not exposed. The
  // selectors still receive these dims — fixed to the safe realized defaults
  // (actual plane; no group restriction; official actuals are posted/reconciled).
  const entryType: LedgerEntryType = 'actual';
  const groupKey: ManagementGroupKey | 'all' = 'all';
  const status: LedgerEntryStatus | 'all' = 'all';
  const [projectId, setProjectId] = useState('all');
  const [contractId, setContractId] = useState('all');
  const [costCenterId, setCostCenterId] = useState('all');
  const [supplierId, setSupplierId] = useState('all');
  const [collaboratorId, setCollaboratorId] = useState('all');
  // The SELECTED CATEGORY drives which dashboard renders (no top-level tab).
  // null = global cost overview; otherwise the category-specific dashboard.
  const [drillCategory, setDrillCategory] = useState<string | null>(null);
  const [drillSub, setDrillSub] = useState<string | null>(null);

  // Resolve the dashboard configuration for the selected category (if any).
  const dashboardConfig = useMemo(() => resolveCategoryDashboard(drillCategory), [drillCategory]);

  // Hard, global filters (no category/subcategory drilldown layered in).
  const baseFilter = useMemo<CategoryAnalysisFilter>(() => ({
    periodFrom, periodTo,
    entryType,
    groupKey,
    projectId, contractId, costCenterId, supplierId,
    collaboratorId, status,
  }), [periodFrom, periodTo, entryType, groupKey, projectId, contractId, costCenterId, supplierId, collaboratorId, status]);

  // Scoped filter = global + active drilldown.
  const scopedFilter = useMemo<CategoryAnalysisFilter>(() => ({
    ...baseFilter,
    categoryId: drillCategory ?? undefined,
    subcategoryId: drillSub ?? undefined,
  }), [baseFilter, drillCategory, drillSub]);

  // ── Selector outputs ──────────────────────────────────────────
  const summary = useMemo(() => selectCostAnalysisSummary(baseFilter), [baseFilter]);
  const categories = useMemo(() => selectCostByCategory(baseFilter), [baseFilter]);
  const subcategories = useMemo(() => selectCostBySubcategory({ ...baseFilter, categoryId: drillCategory ?? undefined }), [baseFilter, drillCategory]);
  const monthly = useMemo(() => selectMonthlyCostTotals(scopedFilter), [scopedFilter]);
  const byProject = useMemo(() => selectCategoryByProject(scopedFilter), [scopedFilter]);
  const byContract = useMemo(() => selectCategoryByContract(scopedFilter), [scopedFilter]);
  const byCostCenter = useMemo(() => selectCategoryByCostCenter(scopedFilter), [scopedFilter]);
  const bySupplier = useMemo(() => selectCostBySupplier(scopedFilter).filter((s) => s.id), [scopedFilter]);
  const topDrivers = useMemo(() => selectTopCostDrivers(scopedFilter, 8), [scopedFilter]);
  const mobilization = useMemo(() => selectMobilizationBreakdown(baseFilter), [baseFilter]);
  const entries = useMemo(() => selectCostLedgerEntries(scopedFilter, 100), [scopedFilter]);
  const categoryTrend = useMemo(() => selectCategoryTrendByMonth(scopedFilter), [scopedFilter]);

  // ── Comparative / executive chart data (realized only) ────────
  const axis = useMemo(() => monthAxis(periodFrom, periodTo), [periodFrom, periodTo]);
  const sCurveSeries = useMemo<SCurveSeries[]>(() => {
    const cur = alignToAxis(monthly, axis);
    const prevW = previousWindow(periodFrom, periodTo);
    const prevMonthly = selectMonthlyCostTotals({ ...scopedFilter, periodFrom: prevW.from, periodTo: prevW.to });
    const prevVals = alignToAxis(prevMonthly, monthAxis(prevW.from, prevW.to));
    const series: SCurveSeries[] = [{ name: 'Realizado acumulado', values: cur, tone: 'accent', emphasized: true }];
    if (prevVals.some((v) => v > 0)) series.push({ name: 'Período anterior', values: prevVals, tone: 'info', dashed: true });
    return series;
  }, [monthly, axis, periodFrom, periodTo, scopedFilter]);
  const waterfall = useMemo(() => buildMoMWaterfall(categoryTrend, 7), [categoryTrend]);
  const heatmap = useMemo(() => buildHeatmap(categoryTrend, axis, 10), [categoryTrend, axis]);

  // ── Dependent chip option sets ────────────────────────────────
  const categoryOptions = useMemo(() => {
    const opts = managementCategories
      .filter((c) => c.level === 2 && c.group_key !== 'revenue' && c.group_key !== 'clearing'
        && (groupKey === 'all' || c.group_key === groupKey))
      .map((c) => ({ value: c.id, label: c.name }));
    // Append any quick category not represented as an L2 (e.g. Tributos, an L1).
    for (const q of QUICK_CATS) {
      if (!opts.some((o) => o.value === q.id)) opts.push({ value: q.id, label: q.label });
    }
    return [{ value: 'all', label: 'Todas as categorias' }, ...opts];
  }, [groupKey]);

  // Subcategories shown follow the selected category's dashboard scope (so the
  // logistics scope correctly surfaces both B.2 and historical C.6 subcats).
  const subcategoryOptions = useMemo(() => {
    const roots = dashboardConfig?.scopeRootCodes;
    const subs = managementCategories.filter(
      (c) => c.level === 3 && c.group_key !== 'revenue' && c.group_key !== 'clearing'
        && (roots
          ? roots.some((r) => c.code.startsWith(`${r}.`))
          : (groupKey === 'all' || c.group_key === groupKey)),
    );
    return [{ value: 'all', label: 'Todas as subcategorias' }, ...subs.map((c) => ({ value: c.id, label: c.name }))];
  }, [groupKey, dashboardConfig]);

  // ── Drilldown handlers ────────────────────────────────────────
  // Selecting a category switches the page to that category's dashboard.
  const selectCategory = useCallback((id: string) => {
    const next = (drillCategory === id || id === 'all') ? null : id;
    setDrillCategory(next);
    setDrillSub(null);
    // Reset the collaborator filter when leaving a collaborator-aware category.
    if (!resolveCategoryDashboard(next)?.supportsCollaborator) setCollaboratorId('all');
  }, [drillCategory]);
  const selectSub = useCallback((id: string) => {
    setDrillSub((cur) => (cur === id ? null : (id === 'all' ? null : id)));
  }, []);
  const clearDrill = useCallback(() => { setDrillCategory(null); setDrillSub(null); setCollaboratorId('all'); }, []);

  const drillCategoryName = drillCategory ? (managementCategories.find((c) => c.id === drillCategory)?.name ?? dashboardConfig?.title) : undefined;
  const drillSubName = drillSub ? managementCategories.find((c) => c.id === drillSub)?.name : undefined;

  // ── Premium KPIs (with mini sparkline on the headline) ────────
  const kpis = useMemo<SparkKpi[]>(() => [
    {
      id: 'total', label: 'Custo total', value: fmtBRL(summary.total),
      helper: `${summary.entryCount} lançamentos`, delta: summary.momPct,
      spark: monthly.map((p) => p.value), tone: 'accent',
    },
    {
      id: 'mom', label: 'Variação m/m',
      value: summary.momPct === undefined ? '—' : `${summary.momPct > 0 ? '+' : ''}${summary.momPct.toFixed(1)}%`,
      helper: summary.lastPeriod ? `${fmtCompactBRL(summary.lastPeriodValue)} no último mês` : 'Sem série',
      delta: summary.momPct,
    },
    {
      id: 'top-cat', label: 'Maior categoria', value: summary.topCategory?.name ?? '—',
      helper: summary.topCategory ? `${fmtCompactBRL(summary.topCategory.value)} · ${(summary.topCategory.share * 100).toFixed(0)}%` : undefined,
    },
    {
      id: 'top-sub', label: 'Maior subcategoria', value: summary.topSubcategory?.name ?? '—',
      helper: summary.topSubcategory ? `${fmtCompactBRL(summary.topSubcategory.value)} · ${(summary.topSubcategory.share * 100).toFixed(0)}%` : undefined,
    },
    {
      id: 'top-proj', label: 'Projeto que mais gastou', value: byProject.find((r) => r.id)?.name ?? '—',
      helper: byProject.find((r) => r.id)
        ? `${fmtCompactBRL(byProject.find((r) => r.id)!.value)} · ${(byProject.find((r) => r.id)!.share * 100).toFixed(0)}%`
        : 'Sem projeto',
    },
    {
      id: 'top-cc', label: 'Centro de custo que mais gastou', value: byCostCenter.find((r) => r.id)?.name ?? '—',
      helper: byCostCenter.find((r) => r.id)
        ? `${fmtCompactBRL(byCostCenter.find((r) => r.id)!.value)} · ${(byCostCenter.find((r) => r.id)!.share * 100).toFixed(0)}%`
        : 'Sem centro de custo',
    },
  ], [summary, monthly, byProject, byCostCenter]);

  const globalInsights = useMemo(
    () => buildGlobalInsights({ summary, categories, subcategories }),
    [summary, categories, subcategories],
  );

  // ── Donut data (by category) ──────────────────────────────────
  const donutData = useMemo<DonutSlice[]>(
    () => categories.slice(0, 6).map((c, i) => ({ name: c.name, value: c.value, tone: DONUT_TONES[i % DONUT_TONES.length] })),
    [categories],
  );

  // ── Entry rows ────────────────────────────────────────────────
  const entryRows = useMemo<EntryRow[]>(() => entries.map((e) => {
    const cat = managementCategories.find((c) => c.id === e.category_id);
    const path = cat ? resolveCategoryPath(cat) : undefined;
    return {
      id: e.id,
      date: e.entry_date,
      description: e.description,
      categoryName: path?.categoryName ?? '—',
      subcategoryName: path?.subcategoryName ?? path?.categoryName ?? '—',
      projectName: projectRefs.find((p) => p.id === e.project_id)?.name,
      supplierName: supplierSeed.find((s) => s.id === e.supplier_id)?.name,
      value: Math.abs(e.amount_cents) / 100,
    };
  }), [entries]);

  const handleExport = useCallback(() => {
    const all = selectCostLedgerEntries(scopedFilter);
    downloadCsv(`analise-custos_${periodFrom}_${periodTo}.csv`, entriesToCsv(all));
  }, [scopedFilter, periodFrom, periodTo]);

  const visual = headerVisual(dashboardConfig?.dashboardType);
  const supportsCollaborator = dashboardConfig?.supportsCollaborator ?? false;
  // Filter visibility follows the active category config (all shown on the
  // global overview). Keeps payroll/tax views from offering irrelevant dims.
  const showProjectFilter = !dashboardConfig || dashboardConfig.supportsProject;

  return (
    <HudPageLayout maxWidth="2xl">
      <HudHeader
        title={dashboardConfig ? `Análise de Custos — ${dashboardConfig.title}` : 'Análise de Custos'}
        subtitle={dashboardConfig
          ? dashboardConfig.description
          : 'Onde o dinheiro está sendo gasto — por categoria, subcategoria, projeto, contrato, CC e fornecedor'}
        icon={visual.icon}
        iconTint={visual.tint}
        breadcrumbs={[{ label: 'Financeiro', href: '/financeiro' }, { label: 'Análise de Custos' }]}
        statusChips={[
          { label: dashboardConfig ? dashboardConfig.title : 'Visão Geral', variant: dashboardConfig ? 'warning' : 'info' },
          { label: 'Realizado', variant: 'success' },
          { label: `${periodFrom} → ${periodTo}`, variant: 'neutral' },
          ...(summary.momPct !== undefined
            ? [{ label: `${summary.momPct > 0 ? '▲' : '▼'} ${Math.abs(summary.momPct).toFixed(1)}% m/m`, variant: (summary.momPct > 0 ? 'critical' : 'success') as 'critical' | 'success' }]
            : []),
        ]}
        actions={
          <HudButton variant="glass" size="md" leftIcon={<Download className="h-4 w-4" />} onClick={handleExport}>
            Exportar CSV
          </HudButton>
        }
      />

      <FinanceFilterBar
        showPeriod={false}
        showScenario={false}
        extra={
          <>
            <FinanceFilterChip icon={<CalendarRange className="h-3.5 w-3.5" />} label="De" value={periodFrom}
              options={PERIODS} onChange={(v) => setPeriodFrom(v > periodTo ? periodTo : v)} maxValueChars={8} />
            <FinanceFilterChip icon={<CalendarRange className="h-3.5 w-3.5" />} label="Até" value={periodTo}
              options={PERIODS} onChange={(v) => setPeriodTo(v < periodFrom ? periodFrom : v)} maxValueChars={8} />
            <FinanceFilterChip icon={<Tag className="h-3.5 w-3.5" />} label="Categoria" value={drillCategory ?? 'all'}
              options={categoryOptions} onChange={selectCategory} />
            <FinanceFilterChip icon={<Tag className="h-3.5 w-3.5" />} label="Subcategoria" value={drillSub ?? 'all'}
              options={subcategoryOptions} onChange={selectSub} />
            {showProjectFilter && (
              <FinanceFilterChip icon={<FolderKanban className="h-3.5 w-3.5" />} label="Projeto" value={projectId}
                options={PROJECT_OPTIONS} onChange={setProjectId} />
            )}
            <FinanceFilterChip icon={<FileText className="h-3.5 w-3.5" />} label="Contrato" value={contractId}
              options={CONTRACT_OPTIONS} onChange={setContractId} />
            <FinanceFilterChip icon={<Building2 className="h-3.5 w-3.5" />} label="CC" value={costCenterId}
              options={CC_OPTIONS} onChange={setCostCenterId} />
            {supportsCollaborator && (
              <FinanceFilterChip icon={<Users className="h-3.5 w-3.5" />} label="Colaborador" value={collaboratorId}
                options={COLLABORATOR_OPTIONS} onChange={setCollaboratorId} />
            )}
          </>
        }
      />

      {/* Quick category chips — selecting one drives the category dashboard. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ig-text-tertiary">Categorias</span>
        {QUICK_CATS.map((q) => {
          const active = drillCategory === q.id;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => selectCategory(q.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                active
                  ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
                  : 'border-ig-border-subtle text-ig-text-secondary hover:bg-ig-surface-subtle/40 hover:text-ig-text-primary',
              )}
            >
              {q.label}
            </button>
          );
        })}
        {drillCategory && (
          <button type="button" onClick={clearDrill}
            className="ml-1 inline-flex items-center gap-1 text-[11px] text-ig-text-tertiary hover:text-ig-text-primary">
            <X className="h-3 w-3" /> limpar
          </button>
        )}
      </div>

      {/* Drilldown trail: Geral → Categoria → Subcategoria → Lançamentos */}
      {drillCategory && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-ig-border-subtle bg-ig-surface-subtle/30 px-3 py-2 text-[12px] text-ig-text-secondary">
          <button type="button" onClick={clearDrill} className="inline-flex items-center gap-1 text-ig-text-tertiary hover:text-ig-text-primary">
            <Home className="h-3 w-3" /> Geral
          </button>
          <ChevronRight className="h-3 w-3 text-ig-text-tertiary" />
          {drillSub ? (
            <button type="button" onClick={() => setDrillSub(null)} className="text-ig-text-tertiary hover:text-ig-text-primary">{drillCategoryName}</button>
          ) : (
            <span className="rounded-md bg-ig-accent-weak px-2 py-0.5 font-medium text-ig-accent">{drillCategoryName}</span>
          )}
          {drillSubName && (
            <>
              <ChevronRight className="h-3 w-3 text-ig-text-tertiary" />
              <span className="rounded-md bg-ig-accent-weak px-2 py-0.5 font-medium text-ig-accent">{drillSubName}</span>
            </>
          )}
          <ChevronRight className="h-3 w-3 text-ig-text-tertiary" />
          <span className="text-ig-text-tertiary">Lançamentos</span>
          <button type="button" onClick={clearDrill}
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-ig-border-subtle px-2 py-0.5 text-[11px] text-ig-text-tertiary transition-colors hover:bg-ig-surface-subtle/60 hover:text-ig-text-primary">
            <X className="h-3 w-3" /> Limpar drilldown
          </button>
        </div>
      )}

      {dashboardConfig ? (
        <CategorySpecificDashboard
          key={dashboardConfig.key}
          config={dashboardConfig}
          filter={baseFilter}
          drillSub={drillSub}
          onSelectSub={selectSub}
          onSelectProject={setProjectId}
          onSelectSupplier={setSupplierId}
          onSelectCollaborator={setCollaboratorId}
          periodFrom={periodFrom}
          periodTo={periodTo}
        />
      ) : (
      <>
      <KpiSparkGrid kpis={kpis} columns={6} />

      {/* Executive reading + composition */}
      {globalInsights.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_1fr]">
          <FinanceInsightCard
            title="Leitura executiva"
            subtitle="Onde o custo está concentrado no recorte selecionado"
            insights={globalInsights}
          />
          <DonutPanel title="Composição por categoria" data={donutData} centerLabel="Total" centerValue={fmtCompactBRL(summary.total)} />
        </div>
      ) : (
        <DonutPanel title="Composição por categoria" data={donutData} centerLabel="Total" centerValue={fmtCompactBRL(summary.total)} />
      )}

      {/* Curva S (realizado acumulado) + tendência mensal */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SCurvePanel title="Curva S — custo realizado acumulado" categories={axis} series={sCurveSeries} />
        <TrendPanel title="Tendência mensal de custo" points={monthly} />
      </div>

      {/* Ponte de variação (waterfall) + mapa de calor categoria × mês */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WaterfallPanel title="Variação m/m por categoria (ponte)" steps={waterfall} />
        <HeatmapPanel title="Mapa de calor — categoria × mês" data={heatmap} />
      </div>

      {/* Category → Subcategory drilldown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RankPanel
          title="Custo por categoria"
          rows={categories.map((c) => ({ id: c.id, label: c.name, value: c.value, share: c.share }))}
          accent="#14B8A6"
          activeId={drillCategory}
          onSelect={selectCategory}
        />
        <RankPanel
          title={drillCategoryName ? `Subcategorias · ${drillCategoryName}` : 'Custo por subcategoria'}
          rows={subcategories.map((s) => ({ id: s.id, label: s.name, meta: s.categoryName, value: s.value, share: s.share }))}
          accent="#6366F1"
          activeId={drillSub}
          onSelect={selectSub}
        />
      </div>

      {/* Dimensional breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <RankPanel title="Custo por projeto" accent="#3B82F6"
          rows={byProject.map((r) => ({ id: r.id || '_none', label: r.name, value: r.value, share: r.share }))} />
        <RankPanel title="Custo por contrato" accent="#A78BFA"
          rows={byContract.map((r) => ({ id: r.id || '_none', label: r.name, value: r.value, share: r.share }))} />
        <RankPanel title="Custo por centro de custo" accent="#EC4899"
          rows={byCostCenter.map((r) => ({ id: r.id || '_none', label: r.name, value: r.value, share: r.share }))} />
      </div>

      {/* Drivers + suppliers + mobilization */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <RankPanel title="Top cost drivers (subcategoria)" accent="#F59E0B"
          rows={topDrivers.map((d) => ({ id: d.subcategoryId, label: d.subcategoryName, meta: d.categoryName, value: d.value, share: d.share }))}
          onSelect={selectSub} activeId={drillSub} />
        <RankPanel title="Top fornecedores" accent="#10B981"
          rows={bySupplier.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
          emptyLabel="Sem fornecedores no recorte." />
        <RankPanel title={<>Mobilização <span className="text-ig-text-tertiary">(Hotel, Passagens, Frota…)</span></>} accent="#F43F5E"
          rows={mobilization.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
          onSelect={selectSub} activeId={drillSub}
          emptyLabel="Sem custos de mobilização." />
      </div>

      {/* Entry drilldown */}
      <EntryTable
        title={drillSubName ? `Lançamentos · ${drillSubName}` : 'Lançamentos (maiores do recorte)'}
        rows={entryRows}
        emptyLabel="Sem lançamentos no recorte."
      />
      </>
      )}
    </HudPageLayout>
  );
}
