'use client';

import React, { useMemo, useState } from 'react';
import {
  selectCostByCategory,
  selectCostBySubcategory,
  selectMobilizationBreakdown,
  selectTopCostDrivers,
  selectMonthlyCostTotals,
  selectProjectsByCostCenter,
  selectCostAnalysisSummary,
  type CategoryAnalysisFilter,
} from '@/lib/finance/selectors';
import { managementCategories } from '@/data/finance/seed-categories';
import { fmtCompactBRL } from '@/components/finance/shared';
import { RankPanel, TrendPanel, MoMBadge } from './panels';

interface LedgerCostBreakdownProps {
  /** Locked dimension filter (e.g. { projectId } or { costCenterId, periodFrom, periodTo }). */
  filter: CategoryAnalysisFilter;
  /** Project embeds show mobilization + drivers; cost-center embeds show consuming projects. */
  variant: 'project' | 'cost_center';
}

/**
 * Ledger-backed cost analytics block, embeddable in the project Finance tab and
 * the Cost Center page. All numbers come from the shared category-analysis
 * selectors (single source of truth) — no page-level aggregation.
 */
export function LedgerCostBreakdown({ filter, variant }: LedgerCostBreakdownProps) {
  const [drillCategory, setDrillCategory] = useState<string | null>(null);

  const categories = useMemo(() => selectCostByCategory(filter), [filter]);
  const subcategories = useMemo(
    () => selectCostBySubcategory({ ...filter, categoryId: drillCategory ?? undefined }),
    [filter, drillCategory],
  );
  const monthly = useMemo(() => selectMonthlyCostTotals(filter), [filter]);
  const summary = useMemo(() => selectCostAnalysisSummary(filter), [filter]);
  const mobilization = useMemo(() => (variant === 'project' ? selectMobilizationBreakdown(filter) : []), [filter, variant]);
  const drivers = useMemo(() => selectTopCostDrivers(filter, 8), [filter]);
  const projectsConsuming = useMemo(
    () => (variant === 'cost_center' && filter.costCenterId
      ? selectProjectsByCostCenter(filter.costCenterId, filter).filter((p) => p.id)
      : []),
    [filter, variant],
  );

  const drillCategoryName = drillCategory
    ? managementCategories.find((c) => c.id === drillCategory)?.name
    : undefined;

  const selectCategory = (id: string) => setDrillCategory((cur) => (cur === id ? null : id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ig-text-primary">
          Análise de custos {variant === 'project' ? 'do projeto' : 'do centro de custo'}
        </h4>
        <div className="flex items-center gap-3 text-[12px] text-ig-text-secondary">
          <span className="tabular-nums">{fmtCompactBRL(summary.total)}</span>
          <MoMBadge momPct={summary.momPct} />
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch lg:grid-cols-2 gap-4">
        <RankPanel
          title="Custo por categoria"
          rows={categories.map((c) => ({ id: c.id, label: c.name, value: c.value, share: c.share }))}
          accent="#14B8A6"
          activeId={drillCategory}
          onSelect={selectCategory}
        />
        {variant === 'project' ? (
          <RankPanel
            title="Mobilização (Hotel, Passagens, Frota…)"
            rows={mobilization.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
            accent="#F43F5E"
            emptyLabel="Sem custos de mobilização."
          />
        ) : (
          <RankPanel
            title={drillCategoryName ? `Subcategorias · ${drillCategoryName}` : 'Custo por subcategoria'}
            rows={subcategories.map((s) => ({ id: s.id, label: s.name, meta: s.categoryName, value: s.value, share: s.share }))}
            accent="#6366F1"
          />
        )}
      </div>

      <div className="grid grid-cols-1 items-stretch lg:grid-cols-2 gap-4">
        <div className="flex h-full min-w-0 flex-col">
          <TrendPanel title="Tendência mensal de custo" points={monthly} fillHeight />
        </div>
        <div className="flex h-full min-w-0 flex-col">
          {variant === 'project' ? (
            <RankPanel
              title={drillCategoryName ? `Subcategorias · ${drillCategoryName}` : 'Custo por subcategoria'}
              rows={subcategories.map((s) => ({ id: s.id, label: s.name, meta: s.categoryName, value: s.value, share: s.share }))}
              accent="#6366F1"
            />
          ) : (
            <RankPanel
              title="Projetos que consomem este CC"
              rows={projectsConsuming.map((r) => ({ id: r.id, label: r.name, value: r.value, share: r.share }))}
              accent="#3B82F6"
              emptyLabel="Sem projetos no recorte."
            />
          )}
        </div>
      </div>

      <RankPanel
        title="Top cost drivers (subcategoria)"
        rows={drivers.map((d) => ({ id: d.subcategoryId, label: d.subcategoryName, meta: d.categoryName, value: d.value, share: d.share }))}
        accent="#F59E0B"
      />
    </div>
  );
}
