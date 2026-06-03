'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Flame, TrendingDown, TrendingUp } from 'lucide-react';
import {
  selectTopCostDrivers,
  selectCostAnalysisSummary,
  type CategoryAnalysisFilter,
} from '@/lib/finance/selectors';
import { fmtCompactBRL, fmtPct } from '@/components/finance/shared';
import type { LedgerEntryType } from '@/lib/types/finance';
import type { ControlRoomFilters } from './types';

interface CostDriversPanelProps {
  filters: ControlRoomFilters;
}

/** Map the Control Room scenario keys to a ledger plane the selectors accept. */
function planeFromScenario(scenario: ControlRoomFilters['scenario']): LedgerEntryType {
  if (scenario === 'budget') return 'budget';
  if (scenario === 'forecast') return 'forecast';
  return 'actual';
}

/**
 * Control Room companion to the category drilldown: the top cost drivers
 * (by subcategoria) plus the month-over-month headline. Reuses the shared
 * category-analysis selectors so it never disagrees with the DRE.
 */
export function CostDriversPanel({ filters }: CostDriversPanelProps) {
  const filter = useMemo<CategoryAnalysisFilter>(() => ({
    periodFrom: filters.periodFrom,
    periodTo: filters.periodTo,
    projectId: filters.projectId,
    contractId: filters.contractId,
    costCenterId: filters.costCenterId,
    entryType: planeFromScenario(filters.scenario),
  }), [filters]);

  const drivers = useMemo(() => selectTopCostDrivers(filter, 8), [filter]);
  const summary = useMemo(() => selectCostAnalysisSummary(filter), [filter]);
  const max = Math.max(...drivers.map((d) => d.value), 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative w-full"
      data-elev={3}
      data-sweep
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="" className="flex flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--ig-border-subtle)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-[10px]"
              style={{ background: 'color-mix(in oklab, #F59E0B 14%, transparent)', color: '#F59E0B', boxShadow: 'inset 0 0 0 1px color-mix(in oklab, #F59E0B 28%, transparent)' }}
            >
              <Flame className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Top Cost Drivers</h3>
              <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Maiores subcategorias · variação mês a mês</p>
            </div>
          </div>
          {summary.momPct !== undefined && (
            <span className={`inline-flex items-center gap-1 font-mono text-[12px] tabular-nums ${summary.momPct > 0 ? 'text-[color:var(--ig-danger)]' : 'text-[color:var(--ig-success)]'}`}>
              {summary.momPct > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {fmtPct(summary.momPct)} m/m
            </span>
          )}
        </header>

        <div className="flex flex-col gap-0.5 p-3">
          {drivers.length === 0 && (
            <p className="px-2 py-6 text-center text-[11px] text-[color:var(--ig-fg-muted)]">Sem custos no período.</p>
          )}
          {drivers.map((d, i) => (
            <div key={d.subcategoryId} className="relative flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
              <span className="absolute inset-y-1 left-2 rounded-sm opacity-[0.10]" style={{ width: `${(d.value / max) * 100}%`, background: 'linear-gradient(90deg, #F59E0B, transparent)' }} />
              <span className="relative flex min-w-0 items-center gap-2">
                <span className="font-mono text-[10px] tabular-nums text-[color:var(--ig-fg-subtle)]">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-[color:var(--ig-fg-strong)]">{d.subcategoryName}</span>
                  <span className="block truncate text-[10px] text-[color:var(--ig-fg-muted)]">{d.categoryName}</span>
                </span>
              </span>
              <span className="relative flex shrink-0 items-center gap-2">
                <span className="font-mono text-[11px] tabular-nums text-[color:var(--ig-fg-default)]">{fmtCompactBRL(d.value)}</span>
                <span className="w-10 text-right font-mono text-[10px] tabular-nums text-[color:var(--ig-fg-muted)]">{(d.share * 100).toFixed(1)}%</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
