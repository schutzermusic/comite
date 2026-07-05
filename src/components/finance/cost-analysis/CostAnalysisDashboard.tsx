'use client';

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Coins, FolderKanban, FileText, Building2, Truck, Boxes,
  CalendarRange, Tag, Download, X, Plane, Users, ChevronRight,
  Receipt, Wallet, Home,
} from 'lucide-react';
import { HudPageLayout, HudHeader, HudButton, HudKpiStrip, type KpiItem } from '@/components/hud';
import {
  FinanceFilterBar, FinanceFilterChip, FinanceFilterRange,
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
  selectCostBySupplier,
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
  suppliers as supplierSeed,
} from '@/data/finance/seed-categories';
import { projects as projectRefs, contracts as contractRefs, collaborators } from '@/data/finance/reference';
import { generatePeriodOptions } from '@/components/finance/control-room/helpers';
import { cn } from '@/lib/utils';
import {
  RankPanel, DonutPanel, TrendPanel, EntryTable,
  SCurvePanel, WaterfallPanel, HeatmapPanel,
  type EntryRow,
} from './panels';
import { CategorySpecificDashboard } from './CategorySpecificDashboard';
import { quickCategories, resolveCategoryDashboard, type CategoryDashboardType } from './category-dashboards';
import { buildGlobalInsights } from './narrative';
import { monthAxis, previousWindow, alignToAxis, buildMoMWaterfall, buildHeatmap } from './transforms';
import { entriesToCsv, downloadCsv } from './cost-csv';
import { openCostReport, type CostReportPayload } from './cost-pdf';

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
  // Projeto é o filtro operacional principal. Centro de Custo NÃO é exposto aqui
  // (análise dedicada vive em Financeiro > Centros de Custo); fica em 'all' e o
  // cost_center_id segue disponível internamente para selectors/rankings/CSV.
  const costCenterId: string = 'all';
  const [projectId, setProjectId] = useState('all');
  const [contractId, setContractId] = useState('all');
  const [supplierId, setSupplierId] = useState('all');
  const [collaboratorId, setCollaboratorId] = useState('all');
  // The SELECTED CATEGORY drives which dashboard renders (no top-level tab).
  // null = global cost overview; otherwise the category-specific dashboard.
  const [drillCategory, setDrillCategory] = useState<string | null>(null);
  const [drillSub, setDrillSub] = useState<string | null>(null);
  // Drilldown por projeto → mostra categorias do projeto selecionado
  const [drillProject, setDrillProject] = useState<string | null>(null);

  // Sincroniza drillProject quando projectId muda via filtro superior (e vice-versa)
  useEffect(() => {
    if (projectId !== 'all' && projectId !== drillProject) {
      setDrillProject(projectId);
    } else if (projectId === 'all' && drillProject) {
      setDrillProject(null);
    }
  }, [projectId, drillProject]);

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
  const bySupplier = useMemo(() => selectCostBySupplier(scopedFilter).filter((s) => s.id), [scopedFilter]);
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
    const series: SCurveSeries[] = [{ name: 'Realizado — período atual', values: cur, tone: 'accent', emphasized: true }];
    if (prevVals.some((v) => v > 0)) series.push({ name: 'Período anterior (equivalente)', values: prevVals, tone: 'info', dashed: true });
    return series;
  }, [monthly, axis, periodFrom, periodTo, scopedFilter]);
  const waterfall = useMemo(() => buildMoMWaterfall(categoryTrend, 6), [categoryTrend]);
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
  const selectProject = useCallback((id: string) => {
    const next = (drillProject === id || id === 'all' || id === '_none') ? null : id;
    setDrillProject(next);
    // Atualiza o filtro de projeto no topo para manter sincronizado
    setProjectId(next ?? 'all');
    // Quando seleciona projeto, limpa categoria para mostrar categorias do projeto
    if (next) setDrillCategory(null);
  }, [drillProject]);
  const clearDrill = useCallback(() => { setDrillCategory(null); setDrillSub(null); setCollaboratorId('all'); setDrillProject(null); setProjectId('all'); }, []);

  const drillCategoryName = drillCategory ? (managementCategories.find((c) => c.id === drillCategory)?.name ?? dashboardConfig?.title) : undefined;
  const drillSubName = drillSub ? managementCategories.find((c) => c.id === drillSub)?.name : undefined;
  const drillProjectName = drillProject ? (byProject.find((p) => p.id === drillProject)?.name ?? drillProject) : undefined;

  // Categorias filtradas por projeto selecionado (drilldown)
  const categoriesByProject = useMemo(() => {
    if (!drillProject) return [];
    return selectCostByCategory({ ...baseFilter, projectId: drillProject });
  }, [baseFilter, drillProject]);

  // ── KPIs — strip facetada (padrão HUD dos demais módulos) ─────
  const kpis = useMemo<KpiItem[]>(() => {
    function costDelta(pct?: number): { deltaText?: string; deltaTone?: 'success' | 'danger' | 'neutral' } {
      if (pct === undefined) return {};
      return {
        deltaText: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
        deltaTone: pct === 0 ? 'neutral' : pct > 0 ? 'danger' : 'success',
      };
    }
    const topProj = byProject.find((r) => r.id);
    const topCat = categories[0];
    const topSub = subcategories[0];
    // KPIs clicáveis (padrão Contratos): drill direto na dimensão do KPI.
    return [
      {
        id: 'total', label: 'Custo total', value: fmtBRL(summary.total),
        deltaLabel: `${summary.entryCount} lançamentos`,
        ...costDelta(summary.momPct),
        variant: 'info',
        icon: <Coins className="w-5 h-5" />,
        onClick: clearDrill,
      },
      {
        id: 'mom', label: 'Variação m/m',
        value: summary.momPct === undefined ? '—' : `${summary.momPct > 0 ? '+' : ''}${summary.momPct.toFixed(1)}%`,
        deltaLabel: summary.lastPeriod ? `${fmtCompactBRL(summary.lastPeriodValue)} no último mês` : 'Sem série',
        variant: summary.momPct === undefined ? 'default' : summary.momPct > 0 ? 'danger' : 'success',
        tintValue: true,
        onClick: clearDrill,
      },
      {
        id: 'top-cat', label: 'Maior categoria', value: summary.topCategory?.name ?? '—',
        deltaLabel: summary.topCategory ? `${fmtCompactBRL(summary.topCategory.value)} · ${(summary.topCategory.share * 100).toFixed(0)}%` : undefined,
        onClick: topCat ? () => selectCategory(topCat.id) : clearDrill,
        active: !!topCat && drillCategory === topCat.id,
      },
      {
        id: 'top-sub', label: 'Maior subcategoria', value: summary.topSubcategory?.name ?? '—',
        deltaLabel: summary.topSubcategory ? `${fmtCompactBRL(summary.topSubcategory.value)} · ${(summary.topSubcategory.share * 100).toFixed(0)}%` : undefined,
        onClick: topSub ? () => selectSub(topSub.id) : clearDrill,
        active: !!topSub && drillSub === topSub.id,
      },
      {
        id: 'top-proj', label: 'Projeto que mais gastou', value: topProj?.name ?? '—',
        deltaLabel: topProj ? `${fmtCompactBRL(topProj.value)} · ${(topProj.share * 100).toFixed(0)}%` : 'Sem projeto',
        onClick: topProj ? () => selectProject(topProj.id) : clearDrill,
        active: !!topProj && drillProject === topProj.id,
      },
    ];
  }, [summary, byProject, categories, subcategories, drillCategory, drillSub, drillProject, selectCategory, selectSub, selectProject, clearDrill]);

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

  const handleExportPdf = useCallback(() => {
    const all = selectCostLedgerEntries(scopedFilter); // same scope as the CSV/table
    const payload: CostReportPayload = {
      title: 'Análise de Custos',
      scopeLabel: dashboardConfig ? dashboardConfig.title : 'Visão Geral',
      periodLabel: `${periodFrom} → ${periodTo}`,
      kpis: kpis.map((k) => ({ label: k.label ?? '', value: String(k.value), helper: k.deltaLabel })),
      rankings: [
        { title: 'Top categorias', rows: categories.slice(0, 10).map((c) => ({ label: c.name, value: c.value, share: c.share })) },
        { title: 'Top projetos', rows: byProject.filter((r) => r.id).slice(0, 10).map((r) => ({ label: r.name, value: r.value, share: r.share })) },
        { title: 'Top fornecedores', rows: bySupplier.slice(0, 10).map((r) => ({ label: r.name, value: r.value, share: r.share })) },
      ],
      entries: all,
    };
    const res = openCostReport(payload);
    if (!res.ok) window.alert(res.message);
  }, [scopedFilter, dashboardConfig, periodFrom, periodTo, kpis, categories, byProject, bySupplier]);

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
          <div className="flex items-center gap-2">
            <HudButton variant="glass" size="md" leftIcon={<Download className="h-4 w-4" />} onClick={handleExport}>
              Exportar CSV
            </HudButton>
            <HudButton variant="glass" size="md" leftIcon={<FileText className="h-4 w-4" />} onClick={handleExportPdf}>
              Exportar PDF
            </HudButton>
          </div>
        }
      />

      <FinanceFilterBar
        showPeriod={false}
        showScenario={false}
        extra={
          <>
            <FinanceFilterRange
              icon={<CalendarRange className="h-3.5 w-3.5" />}
              label="Período"
              fromValue={periodFrom}
              toValue={periodTo}
              options={PERIODS}
              onChange={(from, to) => {
                setPeriodFrom(from);
                setPeriodTo(to);
              }}
            />
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
            {supportsCollaborator && (
              <FinanceFilterChip icon={<Users className="h-3.5 w-3.5" />} label="Colaborador" value={collaboratorId}
                options={COLLABORATOR_OPTIONS} onChange={setCollaboratorId} />
            )}
          </>
        }
      />

      {/* Drilldown trail: shown only for category drilldown (not project drilldown) to avoid duplication with top filter */}
      {drillCategory && !drillProject && (
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
      <HudKpiStrip kpis={kpis} columns={5} />

      {/* Leitura executiva + Composição por categoria */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        {globalInsights.length > 0 ? (
          <FinanceInsightCard
            title="Leitura executiva"
            subtitle="Onde o custo está concentrado no recorte selecionado"
            insights={globalInsights}
          />
        ) : (
          <DonutPanel title="Composição por categoria" data={donutData} centerLabel="Total" centerValue={fmtCompactBRL(summary.total)} />
        )}
        {globalInsights.length > 0 && (
          <DonutPanel title="Composição por categoria" data={donutData} centerLabel="Total" centerValue={fmtCompactBRL(summary.total)} />
        )}
      </div>

      {/* Curva S + Tendência mensal */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <SCurvePanel title="Curva S — custo realizado acumulado" categories={axis} series={sCurveSeries} />
        <TrendPanel title="Tendência mensal de custo" points={monthly} />
      </div>

      {/* Waterfall + Heatmap */}
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <WaterfallPanel title="Variação m/m por categoria (ponte)" steps={waterfall} height={380} />
        <HeatmapPanel title="Mapa de calor — categoria × mês" data={heatmap} />
      </div>

      {/* Projetos / drilldown de projeto */}
      {drillProject ? (
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
          <RankPanel
            title={`Categorias do projeto · ${drillProjectName}`}
            rows={categoriesByProject.map((c) => ({ id: c.id, label: c.name, value: c.value, share: c.share }))}
            accent="#14B8A6"
            activeId={drillCategory}
            onSelect={selectCategory}
          />
          <RankPanel
            title={drillCategoryName ? `Subcategorias · ${drillCategoryName}` : 'Selecione uma categoria'}
            rows={subcategories.map((s) => ({ id: s.id, label: s.name, meta: s.categoryName, value: s.value, share: s.share }))}
            accent="#6366F1"
            activeId={drillSub}
            onSelect={selectSub}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
            <RankPanel
              title="Custo por projeto"
              rows={byProject.map((r) => ({ id: r.id || '_none', label: r.name, value: r.value, share: r.share }))}
              accent="#3B82F6"
              activeId={drillProject ?? undefined}
              onSelect={selectProject}
            />
            <RankPanel
              title="Custo por contrato"
              accent="#A78BFA"
              rows={byContract.map((r) => ({ id: r.id || '_none', label: r.name, value: r.value, share: r.share }))}
            />
          </div>

          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
            <RankPanel
              title="Top fornecedores"
              accent="#10B981"
              rows={bySupplier.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
              emptyLabel="Sem fornecedores no recorte."
            />
            <RankPanel
              title={<>Mobilização <span className="text-ig-text-tertiary">(Hotel, Passagens, Frota…)</span></>}
              accent="#F43F5E"
              rows={mobilization.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
              onSelect={selectSub}
              activeId={drillSub}
              emptyLabel="Sem custos de mobilização."
            />
          </div>
        </>
      )}

      {/* Entry drilldown — collapsible, closed by default to keep the screen short. */}
      <EntryTable
        collapsible
        defaultOpen={false}
        count={entries.length}
        title={drillSubName ? `Lançamentos · ${drillSubName}` : 'Lançamentos (maiores do recorte)'}
        rows={entryRows}
        emptyLabel="Sem lançamentos no recorte."
      />
      </>
      )}
    </HudPageLayout>
  );
}
