'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Layers, ChevronRight, TrendingUp } from 'lucide-react';
import {
  selectCostByCategory,
  selectCostBySubcategory,
  type CategoryAnalysisFilter,
} from '@/lib/finance/selectors';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories } from '@/data/finance/seed-categories';
import type { ControlRoomFilters } from './types';

interface CategoryDrilldownPanelProps {
  filters: ControlRoomFilters;
}

const fmtReais = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

const fmtPct = (share: number): string => `${(share * 100).toFixed(1)}%`;

/**
 * Minimal Control Room drilldown: Top Categorias → Subcategorias → Lançamentos.
 * Reads only the shared category-analysis selectors (which already exclude
 * clearing/treasury), so it stays consistent with the managerial DRE.
 */
export function CategoryDrilldownPanel({ filters }: CategoryDrilldownPanelProps) {
  const baseFilter: CategoryAnalysisFilter = useMemo(
    () => ({
      periodFrom: filters.periodFrom,
      periodTo: filters.periodTo,
      projectId: filters.projectId,
      contractId: filters.contractId,
    }),
    [filters.periodFrom, filters.periodTo, filters.projectId, filters.contractId],
  );

  const categories = useMemo(() => selectCostByCategory(baseFilter), [baseFilter]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);

  const activeCategoryId = selectedCategoryId ?? categories[0]?.id ?? null;

  const subcategories = useMemo(
    () => (activeCategoryId ? selectCostBySubcategory({ ...baseFilter, categoryId: activeCategoryId }) : []),
    [baseFilter, activeCategoryId],
  );

  const drilldownEntries = useMemo(() => {
    if (!selectedSubId) return [];
    return mockLedgerEntries
      .filter((e) => {
        if (e.category_id !== selectedSubId || e.status === 'void' || e.entry_type !== 'actual') return false;
        if (baseFilter.periodFrom && e.period_key < baseFilter.periodFrom) return false;
        if (baseFilter.periodTo && e.period_key > baseFilter.periodTo) return false;
        if (baseFilter.projectId && baseFilter.projectId !== 'all' && e.project_id !== baseFilter.projectId) return false;
        if (baseFilter.contractId && baseFilter.contractId !== 'all' && e.contract_id !== baseFilter.contractId) return false;
        return true;
      })
      .sort((a, b) => b.amount_cents - a.amount_cents)
      .slice(0, 8);
  }, [selectedSubId, baseFilter]);

  const activeCategoryName = activeCategoryId
    ? managementCategories.find((c) => c.id === activeCategoryId)?.name ?? '—'
    : '—';
  const maxCat = Math.max(...categories.map((c) => c.value), 1);
  const maxSub = Math.max(...subcategories.map((s) => s.value), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative h-full w-full"
      data-elev={3}
      data-sweep
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="" className="flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-[color:var(--ig-border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklab, #14B8A6 14%, transparent)', color: '#14B8A6', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #14B8A6 28%, transparent)' }}
            >
              <Layers className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Custos por Categoria</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Categoria → Subcategoria → Lançamentos · exclui clearing/tesouraria</p>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-[color:var(--ig-border-subtle)] lg:grid-cols-3">
          {/* Categorias */}
          <div className="flex min-h-0 flex-col bg-[color:var(--ig-bg-raised)]/40 p-3">
            <p className="shrink-0 px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">Top Categorias</p>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5">
              {categories.length === 0 && <p className="flex flex-1 items-center justify-center px-2 text-center text-[11px] text-[color:var(--ig-fg-muted)]">Sem custos no período.</p>}
              {categories.slice(0, 8).map((c) => {
                const active = c.id === activeCategoryId;
                return (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedCategoryId(c.id); setSelectedSubId(null); }}
                    className={`relative flex min-h-[2rem] flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${active ? 'bg-[color-mix(in_oklab,#14B8A6_14%,transparent)]' : 'hover:bg-[color:var(--ig-bg-hover)]'}`}
                  >
                    <span className="absolute inset-y-1 left-2 rounded-sm opacity-[0.10]" style={{ width: `${(c.value / maxCat) * 100}%`, background: 'linear-gradient(90deg, #14B8A6, transparent)' }} />
                    <span className="relative min-w-0 truncate text-[12px] font-medium text-[color:var(--ig-fg-strong)]">{c.name}</span>
                    <span className="relative flex shrink-0 items-center gap-2">
                      <span className="text-[11px] tabular-nums text-[color:var(--ig-fg-default)]">{fmtReais(c.value)}</span>
                      <span className="text-[10px] tabular-nums text-[color:var(--ig-fg-muted)]">{fmtPct(c.share)}</span>
                      <ChevronRight className="h-3 w-3 text-[color:var(--ig-fg-subtle)]" />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subcategorias */}
          <div className="flex min-h-0 flex-col bg-[color:var(--ig-bg-raised)]/40 p-3">
            <p className="shrink-0 px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">
              Subcategorias · {activeCategoryName}
            </p>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5">
              {subcategories.length === 0 && <p className="flex flex-1 items-center justify-center px-2 text-center text-[11px] text-[color:var(--ig-fg-muted)]">Selecione uma categoria.</p>}
              {subcategories.slice(0, 10).map((s) => {
                const active = s.id === selectedSubId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSubId(s.id)}
                    className={`relative flex min-h-[2rem] flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${active ? 'bg-[color-mix(in_oklab,#14B8A6_14%,transparent)]' : 'hover:bg-[color:var(--ig-bg-hover)]'}`}
                  >
                    <span className="absolute inset-y-1 left-2 rounded-sm opacity-[0.10]" style={{ width: `${(s.value / maxSub) * 100}%`, background: 'linear-gradient(90deg, #6366F1, transparent)' }} />
                    <span className="relative min-w-0 truncate text-[12px] text-[color:var(--ig-fg-strong)]">{s.name}</span>
                    <span className="relative flex shrink-0 items-center gap-2">
                      <span className="text-[11px] tabular-nums text-[color:var(--ig-fg-default)]">{fmtReais(s.value)}</span>
                      <span className="text-[10px] tabular-nums text-[color:var(--ig-fg-muted)]">{fmtPct(s.share)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lançamentos */}
          <div className="flex min-h-0 flex-col bg-[color:var(--ig-bg-raised)]/40 p-3">
            <p className="shrink-0 px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">Lançamentos</p>
            <div className="flex min-h-0 flex-1 flex-col gap-0.5">
              {!selectedSubId && <p className="flex flex-1 items-center justify-center px-2 text-center text-[11px] text-[color:var(--ig-fg-muted)]">Selecione uma subcategoria.</p>}
              {selectedSubId && drilldownEntries.length === 0 && (
                <p className="flex flex-1 items-center justify-center px-2 text-center text-[11px] text-[color:var(--ig-fg-muted)]">Sem lançamentos no recorte.</p>
              )}
              {drilldownEntries.map((e) => (
                <div key={e.id} className="flex min-h-[2rem] flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5">
                  <div className="min-w-0">
                    <span className="block truncate text-[12px] text-[color:var(--ig-fg-strong)]">{e.description}</span>
                    <span className="text-[10px] text-[color:var(--ig-fg-muted)]">{e.period_key}{e.project_id ? ` · ${e.project_id}` : ''}</span>
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-[color:var(--ig-fg-default)]">{fmtReais(Math.abs(e.amount_cents) / 100)}</span>
                </div>
              ))}
              {selectedSubId && drilldownEntries.length > 0 && (
                <div className="mt-auto flex shrink-0 items-center gap-1 px-2 pt-1 text-[10px] text-[color:var(--ig-fg-muted)]">
                  <TrendingUp className="h-3 w-3" /> Top {drilldownEntries.length} lançamentos por valor
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
