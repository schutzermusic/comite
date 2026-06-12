'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, FlaskConical, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  HudCard, HudCardHeader, HudCardTitle, HudCardContent,
} from '@/components/hud';
import {
  FinanceChartContainer,
  FinanceLineChart,
  FinanceDonutChart,
  FinanceTreemapChart,
  FinanceStackedBarChart,
  FinanceSCurveChart,
  FinanceAdvancedWaterfallChart,
  FinanceSparkline,
  useFinanceChartTokens,
  fmtBRL, fmtCompactBRL, fmtPct,
  type DonutSlice,
  type TreemapNode,
  type StackedBarSeries,
  type SCurveSeries,
  type WaterfallStep,
} from '@/components/finance/shared';
import { cn } from '@/lib/utils';
import { monthLabel as fmtMonth, type HeatmapData } from './transforms';

type SparkTone = NonNullable<DonutSlice['tone']>;

// ─────────────────────────────────────────────────────────────────
// Presentational cost-analysis panels. They render data produced by
// the category-analysis selectors — they never aggregate the ledger
// themselves. Reused by the Análise de Custos page, the Control Room
// and the project / cost-center embeds.
// ─────────────────────────────────────────────────────────────────

export interface RankPanelRow {
  id: string;
  label: string;
  /** Optional second line (e.g. parent category, supplier UF). */
  meta?: string;
  value: number;
  share: number;
}

interface RankPanelProps {
  title: React.ReactNode;
  rows: RankPanelRow[];
  /** Accent color for the inline bars. */
  accent?: string;
  /** Highlighted row id. */
  activeId?: string | null;
  /** Click handler — when provided rows become buttons (drilldown). */
  onSelect?: (id: string) => void;
  /** Max rows to show. */
  limit?: number;
  emptyLabel?: string;
  /** Render running cumulative share (Pareto) instead of the per-row share. */
  pareto?: boolean;
  /** Optional right-aligned header action (e.g. a toggle). */
  action?: React.ReactNode;
}

/** A compact ranked list with inline share bars and optional drilldown / Pareto. */
export function RankPanel({
  title, rows, accent = '#14B8A6', activeId, onSelect, limit = 10,
  emptyLabel = 'Sem custos no período.', pareto = false, action,
}: RankPanelProps) {
  const shown = rows.slice(0, limit);
  const max = Math.max(...shown.map((r) => r.value), 1);
  // Pre-compute running cumulative share (Pareto) purely — no render-time mutation.
  const cumShares = shown.reduce<number[]>((acc, r) => {
    acc.push((acc.length ? acc[acc.length - 1] : 0) + r.share);
    return acc;
  }, []);
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader className="flex-row items-center justify-between gap-2">
        <HudCardTitle className="min-w-0 truncate">{title}</HudCardTitle>
        {action}
      </HudCardHeader>
      <HudCardContent className="flex flex-1 flex-col p-2.5">
        <div className="flex min-h-0 flex-1 flex-col gap-0.5">
          {shown.length === 0 && (
            <p className="flex flex-1 items-center justify-center px-2 text-center text-[11px] text-ig-text-tertiary">{emptyLabel}</p>
          )}
          {shown.map((r, i) => {
            const active = r.id === activeId;
            const cumPct = cumShares[i];
            const Inner = (
              <>
                <span
                  aria-hidden
                  className="absolute inset-y-1 left-2 rounded-sm opacity-[0.12]"
                  style={{ width: `${(r.value / max) * 100}%`, background: `linear-gradient(90deg, ${accent}, transparent)` }}
                />
                <span className="relative min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium leading-tight text-ig-text-primary" title={r.label}>{r.label}</span>
                  {r.meta && <span className="block truncate text-[10.5px] leading-tight text-ig-text-tertiary" title={r.meta}>{r.meta}</span>}
                </span>
                <span className="relative flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[11px] tabular-nums text-ig-text-secondary" title={fmtBRL(r.value)}>{fmtCompactBRL(r.value)}</span>
                  <span
                    className="w-12 text-right font-mono text-[10px] tabular-nums text-ig-text-tertiary"
                    title={pareto ? `${(r.share * 100).toFixed(1)}% · acum. ${(cumPct * 100).toFixed(0)}%` : `${(r.share * 100).toFixed(1)}%`}
                  >
                    {pareto ? `Σ${(cumPct * 100).toFixed(0)}%` : `${(r.share * 100).toFixed(1)}%`}
                  </span>
                  {onSelect && <ChevronRight className={cn('h-3 w-3 shrink-0 text-ig-text-tertiary transition-transform', active && 'rotate-90 text-ig-accent')} />}
                </span>
              </>
            );
            const baseCls = 'relative flex min-h-[2rem] flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors';
            return onSelect ? (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                className={cn(baseCls, active ? 'bg-ig-accent-weak' : 'hover:bg-ig-surface-subtle/40')}
              >
                {Inner}
              </button>
            ) : (
              <div key={r.id} className={baseCls}>{Inner}</div>
            );
          })}
        </div>
      </HudCardContent>
    </HudCard>
  );
}

interface DonutPanelProps {
  title: string;
  data: DonutSlice[];
  centerLabel?: string;
  centerValue?: string;
  height?: number;
}

export function DonutPanel({ title, data, centerLabel, centerValue, height = 280 }: DonutPanelProps) {
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader><HudCardTitle className="truncate">{title}</HudCardTitle></HudCardHeader>
      <HudCardContent className="flex flex-1 flex-col justify-center p-3">
        {data.length === 0 ? (
          <p className="w-full px-2 py-10 text-center text-[11px] text-ig-text-tertiary">Sem composição no recorte.</p>
        ) : (
          <FinanceChartContainer>
            <FinanceDonutChart data={data} centerLabel={centerLabel} centerValue={centerValue} height={height} />
          </FinanceChartContainer>
        )}
      </HudCardContent>
    </HudCard>
  );
}

interface TreemapPanelProps {
  title: React.ReactNode;
  data: TreemapNode[];
  height?: number;
  emptyLabel?: string;
}

/** Treemap panel — area-encoded composition for many-membered dimensions
 *  (projects, suppliers) where a donut/pie would be overloaded. */
export function TreemapPanel({ title, data, height = 300, emptyLabel = 'Sem dados no recorte.' }: TreemapPanelProps) {
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader><HudCardTitle className="truncate">{title}</HudCardTitle></HudCardHeader>
      <HudCardContent className="flex flex-1 flex-col justify-center p-3">
        <FinanceChartContainer>
          {data.length === 0 ? (
            <p className="w-full px-2 py-10 text-center text-[11px] text-ig-text-tertiary">{emptyLabel}</p>
          ) : (
            <FinanceTreemapChart data={data} height={height} />
          )}
        </FinanceChartContainer>
      </HudCardContent>
    </HudCard>
  );
}

interface TrendPanelProps {
  title: string;
  /** Sorted ascending monthly points. */
  points: { period: string; value: number }[];
  height?: number;
  /** Stretch the chart to fill the card body (matches sibling RankPanels in a grid row). */
  fillHeight?: boolean;
}

function useChartAreaHeight(enabled: boolean, fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(fallback);

  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setHeight(Math.max(200, Math.round(e.contentRect.height)));
      }
    });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [enabled]);

  return [ref, enabled ? height : fallback] as const;
}

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const monthLabel = (p: string) => {
  const [y, m] = p.split('-');
  return `${MONTHS_PT[Number(m) - 1] ?? m}/${y?.slice(2) ?? ''}`;
};

export function TrendPanel({ title, points, height = 280, fillHeight = false }: TrendPanelProps) {
  const series = [{ name: 'Custo', data: points.map((p) => p.value), tone: 'accent' as const }];
  const [chartAreaRef, chartHeight] = useChartAreaHeight(fillHeight, height);
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader><HudCardTitle className="truncate">{title}</HudCardTitle></HudCardHeader>
      <HudCardContent className={cn('flex flex-1 flex-col p-3', fillHeight ? 'min-h-0' : 'justify-center')}>
        {points.length === 0 ? (
          <p className="w-full px-2 py-10 text-center text-[11px] text-ig-text-tertiary">Sem série no período.</p>
        ) : (
          <>
            <div ref={fillHeight ? chartAreaRef : undefined} className={fillHeight ? 'min-h-0 flex-1' : undefined}>
              <FinanceChartContainer className={fillHeight ? 'h-full' : undefined}>
                <FinanceLineChart
                  categories={points.map((p) => monthLabel(p.period))}
                  series={series}
                  height={chartHeight}
                />
              </FinanceChartContainer>
            </div>
            <ChartLegend items={series.map((s) => ({ name: s.name, tone: s.tone }))} />
          </>
        )}
      </HudCardContent>
    </HudCard>
  );
}

export interface EntryRow {
  id: string;
  date: string;
  description: string;
  categoryName: string;
  subcategoryName: string;
  projectName?: string;
  supplierName?: string;
  value: number;
}

interface EntryTableProps {
  title: React.ReactNode;
  rows: EntryRow[];
  emptyLabel?: string;
  /** Render as a collapsible accordion (header toggles the table). */
  collapsible?: boolean;
  /** Initial open state when collapsible (defaults to closed). */
  defaultOpen?: boolean;
  /** Rows in the current scope — shown as a header badge even when truncated/closed. */
  count?: number;
  /** Right-aligned header actions (e.g. CSV/PDF). Not part of the toggle button. */
  action?: React.ReactNode;
}

/** Ledger drilldown table — the deepest level of the cost analysis. Optionally
 *  collapsible: the body is only mounted while open, keeping long screens short. */
export function EntryTable({
  title, rows, emptyLabel = 'Selecione uma subcategoria para ver os lançamentos.',
  collapsible = false, defaultOpen = !collapsible, count, action,
}: EntryTableProps) {
  const [open, setOpen] = useState(defaultOpen);
  const total = count ?? rows.length;

  const tableBody = (
    <FinanceChartContainer scrollX>
      <table className="w-full text-sm">
        <thead className="border-b border-ig-border-subtle">
          <tr className="text-[10.5px] uppercase tracking-[0.12em] text-ig-text-tertiary">
            <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium">Data</th>
            <th className="px-4 py-2.5 text-left font-medium">Descrição</th>
            <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium">Categoria</th>
            <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium">Subcategoria</th>
            <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium">Projeto</th>
            <th className="whitespace-nowrap px-4 py-2.5 text-left font-medium">Fornecedor</th>
            <th className="whitespace-nowrap px-4 py-2.5 text-right font-medium">Valor</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-10 text-center text-[11px] text-ig-text-tertiary">{emptyLabel}</td></tr>
          )}
          {rows.map((e) => (
            <tr key={e.id} className="border-b border-ig-border-subtle/40 hover:bg-ig-surface-subtle/30">
              <td className="whitespace-nowrap px-4 py-2 font-mono text-[11px] text-ig-text-secondary">{e.date}</td>
              <td className="max-w-[280px] truncate px-4 py-2 text-ig-text-primary" title={e.description}>{e.description}</td>
              <td className="max-w-[160px] truncate px-4 py-2 text-ig-text-secondary" title={e.categoryName}>{e.categoryName}</td>
              <td className="max-w-[160px] truncate px-4 py-2 text-ig-text-secondary" title={e.subcategoryName}>{e.subcategoryName}</td>
              <td className="max-w-[160px] truncate px-4 py-2 text-ig-text-secondary" title={e.projectName || undefined}>{e.projectName || '—'}</td>
              <td className="max-w-[160px] truncate px-4 py-2 text-ig-text-secondary" title={e.supplierName || undefined}>{e.supplierName || '—'}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums text-ig-text-primary">{fmtBRL(e.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </FinanceChartContainer>
  );

  if (!collapsible) {
    return (
      <HudCard className="min-w-0">
        <HudCardHeader><HudCardTitle>{title}</HudCardTitle></HudCardHeader>
        <HudCardContent className="p-0">{tableBody}</HudCardContent>
      </HudCard>
    );
  }

  return (
    <HudCard className="min-w-0">
      <HudCardHeader className="flex-row items-center justify-between gap-2 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight className={cn('h-4 w-4 shrink-0 text-ig-text-tertiary transition-transform', open && 'rotate-90 text-ig-accent')} />
          <HudCardTitle className="min-w-0 truncate">{title}</HudCardTitle>
          <span className="shrink-0 rounded-full bg-ig-surface-subtle/60 px-2 py-0.5 font-mono text-[10px] tabular-nums text-ig-text-secondary">
            {total} {total === 1 ? 'linha' : 'linhas'}
          </span>
          <span className="shrink-0 text-[10.5px] text-ig-text-tertiary transition-colors group-hover:text-ig-text-secondary">
            {open ? 'recolher' : 'expandir'}
          </span>
        </button>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </HudCardHeader>
      {open && <HudCardContent className="p-0">{tableBody}</HudCardContent>}
    </HudCard>
  );
}

/** Subtle "dados demonstrativos" badge shown when a dashboard is rendering
 *  isolated demo fixtures instead of real ledger data. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-ig-warning/40 bg-ig-warning/10 px-2 py-0.5 text-[10px] font-medium text-ig-warning',
        className,
      )}
      title="Esta categoria ainda não possui lançamentos reais no razão. Os números abaixo são uma amostra visual isolada (não afetam DRE/Control Room)."
    >
      <FlaskConical className="h-3 w-3" />
      dados demonstrativos
    </span>
  );
}

/** Compact executive stat card used across the category sub-strips. */
export function MiniStat({
  label, value, helper, tone,
}: { label: string; value: string; helper?: string; tone?: 'pos' | 'neg' | 'neutral' }) {
  const toneCls = tone === 'pos' ? 'text-ig-success' : tone === 'neg' ? 'text-ig-danger' : 'text-ig-text-primary';
  return (
    <HudCard className="h-full min-w-0">
      <HudCardContent className="p-3">
        <p className="truncate text-[10px] uppercase tracking-[0.12em] text-ig-text-tertiary" title={label}>{label}</p>
        <p className={`mt-1 truncate font-mono text-[15px] tabular-nums ${toneCls}`} title={value}>{value}</p>
        {helper && <p className="mt-0.5 truncate text-[10px] text-ig-text-tertiary" title={helper}>{helper}</p>}
      </HudCardContent>
    </HudCard>
  );
}

export interface LegendItem { name: string; tone?: SparkTone; dashed?: boolean; value?: string }

/** Mode-aware legend swatches matching the chart palette (used by stacked/S-curve). */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  const palette = useFinanceChartTokens();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 pt-1">
      {items.map((it) => {
        const color = palette[it.tone ?? 'accent'];
        return (
          <span key={it.name} className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
            {it.dashed ? (
              <span aria-hidden className="inline-block h-0 w-4 shrink-0 border-t-2 border-dashed" style={{ borderColor: color }} />
            ) : (
              <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color, boxShadow: `0 0 6px ${color}66` }} />
            )}
            <span className="truncate text-ig-text-secondary" title={it.name}>{it.name}</span>
            {it.value && <span className="font-mono tabular-nums text-ig-text-tertiary">{it.value}</span>}
          </span>
        );
      })}
    </div>
  );
}

interface StackedBarPanelProps {
  title: React.ReactNode;
  categories: string[];
  series: StackedBarSeries[];
  height?: number;
  emptyLabel?: string;
}

/** Stacked composition by month (e.g. Frota: combustível vs locação vs manutenção). */
export function StackedBarPanel({ title, categories, series, height = 280, emptyLabel = 'Sem série no recorte.' }: StackedBarPanelProps) {
  const hasData = categories.length > 0 && series.some((s) => s.data.some((v) => v > 0));
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader><HudCardTitle className="truncate">{title}</HudCardTitle></HudCardHeader>
      <HudCardContent className="flex flex-1 flex-col justify-center p-3">
        {!hasData ? (
          <p className="w-full px-2 py-10 text-center text-[11px] text-ig-text-tertiary">{emptyLabel}</p>
        ) : (
          <>
            <FinanceChartContainer>
              <FinanceStackedBarChart categories={categories} series={series} height={height} />
            </FinanceChartContainer>
            <ChartLegend items={series.map((s) => ({ name: s.name, tone: s.tone }))} />
          </>
        )}
      </HudCardContent>
    </HudCard>
  );
}

interface SCurvePanelProps {
  title: React.ReactNode;
  /** Month keys for the x-axis (e.g. ['2026-01', ...]). */
  categories: string[];
  /** Series of RAW monthly values — the chart cumulates them internally. */
  series: SCurveSeries[];
  height?: number;
  emptyLabel?: string;
}

/** Cumulative S-Curve (realized cost accumulating over the period). */
export function SCurvePanel({ title, categories, series, height = 280, emptyLabel = 'Sem série acumulada no período.' }: SCurvePanelProps) {
  const hasData = categories.length > 0 && series.some((s) => s.values.some((v) => v > 0));
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader><HudCardTitle className="truncate">{title}</HudCardTitle></HudCardHeader>
      <HudCardContent className="flex flex-1 flex-col justify-center p-3">
        {!hasData ? (
          <p className="w-full px-2 py-10 text-center text-[11px] text-ig-text-tertiary">{emptyLabel}</p>
        ) : (
          <>
            <FinanceChartContainer>
              <FinanceSCurveChart categories={categories.map(fmtMonth)} series={series} height={height} />
            </FinanceChartContainer>
            <ChartLegend items={series.map((s) => ({ name: s.name, tone: s.tone, dashed: s.dashed }))} />
          </>
        )}
      </HudCardContent>
    </HudCard>
  );
}

interface WaterfallPanelProps {
  title: React.ReactNode;
  steps: WaterfallStep[];
  height?: number;
  emptyLabel?: string;
}

/** Waterfall bridge explaining the month-over-month cost variation. */
export function WaterfallPanel({ title, steps, height = 300, emptyLabel = 'Sem variação a explicar (período único).' }: WaterfallPanelProps) {
  const deltas = steps.filter((s) => s.type === 'delta' || s.type === undefined);
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader><HudCardTitle className="truncate">{title}</HudCardTitle></HudCardHeader>
      <HudCardContent className="flex flex-1 flex-col p-3">
        {steps.length < 3 ? (
          <p className="w-full px-2 py-10 text-center text-[11px] text-ig-text-tertiary">{emptyLabel}</p>
        ) : (
          <>
            <FinanceChartContainer className="flex-1">
              <FinanceAdvancedWaterfallChart steps={steps} height={height} />
            </FinanceChartContainer>
            {/* Full-name legend — the chart x-axis is abbreviated, so the driver
                names + signed deltas are listed here to keep it legible. */}
            {deltas.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1">
                {deltas.map((d, i) => {
                  const up = d.value >= 0;
                  return (
                    <span key={`${d.label}-${i}`} className="inline-flex min-w-0 items-center gap-1.5 text-[11px]">
                      <span aria-hidden className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]', up ? 'bg-ig-danger' : 'bg-ig-success')} />
                      <span className="truncate text-ig-text-secondary" title={d.label}>{d.label}</span>
                      <span className={cn('font-mono tabular-nums', up ? 'text-ig-danger' : 'text-ig-success')}>
                        {up ? '+' : '−'}{fmtCompactBRL(Math.abs(d.value))}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </>
        )}
      </HudCardContent>
    </HudCard>
  );
}

interface HeatmapPanelProps {
  title: React.ReactNode;
  data: HeatmapData;
  /** Accent color for cell intensity. */
  accent?: string;
  emptyLabel?: string;
}

/** Lightweight {row × month} heatmap. Cell opacity encodes value / max. */
export function HeatmapPanel({ title, data, accent = '#14B8A6', emptyLabel = 'Sem dados para o mapa de calor.' }: HeatmapPanelProps) {
  const { rows, cols, matrix, max } = data;
  const empty = rows.length === 0 || cols.length === 0;
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader><HudCardTitle className="truncate">{title}</HudCardTitle></HudCardHeader>
      <HudCardContent className="flex flex-1 flex-col p-3">
        {empty ? (
          <p className="px-2 py-10 text-center text-[11px] text-ig-text-tertiary">{emptyLabel}</p>
        ) : (
          <>
            <FinanceChartContainer scrollX className="flex-1">
              <table className="w-full border-separate" style={{ borderSpacing: '3px' }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-ig-panel px-1 py-1 text-left text-[10px] font-medium uppercase tracking-[0.1em] text-ig-text-tertiary" />
                    {cols.map((c) => (
                      <th key={c} className="px-1 py-1 text-center text-[10px] font-medium tabular-nums text-ig-text-tertiary">{fmtMonth(c)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={r.id}>
                      <td className="sticky left-0 z-10 max-w-[160px] truncate bg-ig-panel py-1 pr-2 text-[11px] font-medium text-ig-text-primary" title={r.label}>{r.label}</td>
                      {matrix[ri].map((v, ci) => {
                        const intensity = max > 0 ? v / max : 0;
                        const fill = v > 0 ? Math.round(18 + intensity * 72) : 0;
                        return (
                          <td
                            key={ci}
                            className="h-8 min-w-[52px] rounded border text-center align-middle font-mono text-[10px] tabular-nums"
                            style={{
                              background: v > 0 ? `color-mix(in oklab, ${accent} ${fill}%, transparent)` : 'transparent',
                              borderColor: v > 0 ? `color-mix(in oklab, ${accent} ${Math.min(100, fill + 16)}%, transparent)` : 'var(--ig-border-subtle)',
                              color: intensity >= 0.5 ? '#fff' : 'var(--ig-text-primary)',
                            }}
                            title={`${r.label} · ${fmtMonth(cols[ci])} · ${fmtBRL(v)}`}
                          >
                            {v > 0 ? fmtCompactBRL(v) : '·'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </FinanceChartContainer>
            {/* Intensity scale */}
            <div className="mt-2 flex shrink-0 items-center gap-2 px-1 text-[10px] text-ig-text-tertiary">
              <span>menor</span>
              <span className="inline-flex h-2.5 w-24 rounded" style={{ background: `linear-gradient(90deg, color-mix(in oklab, ${accent} 18%, transparent), ${accent})` }} />
              <span>maior</span>
              <span className="ml-auto font-mono tabular-nums">máx {fmtCompactBRL(max)}</span>
            </div>
          </>
        )}
      </HudCardContent>
    </HudCard>
  );
}

export interface ListRow {
  id: string;
  label: string;
  meta?: string;
  value: number;
  /** Optional right-aligned secondary text (e.g. due date). */
  badge?: string;
}

interface ListPanelProps {
  title: React.ReactNode;
  rows: ListRow[];
  emptyLabel?: string;
  limit?: number;
}

/** Simple value list with an optional badge — used for the tax due-date list. */
export function ListPanel({ title, rows, emptyLabel = 'Sem registros no recorte.', limit = 12 }: ListPanelProps) {
  const shown = rows.slice(0, limit);
  return (
    <HudCard className="flex h-full min-w-0 flex-col">
      <HudCardHeader><HudCardTitle className="truncate">{title}</HudCardTitle></HudCardHeader>
      <HudCardContent className="flex flex-1 flex-col p-2.5">
        <div className="flex flex-col gap-0.5">
          {shown.length === 0 && <p className="flex flex-1 items-center justify-center px-2 py-8 text-center text-[11px] text-ig-text-tertiary">{emptyLabel}</p>}
          {shown.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium leading-tight text-ig-text-primary" title={r.label}>{r.label}</span>
                {r.meta && <span className="block truncate text-[10.5px] leading-tight text-ig-text-tertiary" title={r.meta}>{r.meta}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {r.badge && <span className="rounded bg-ig-surface-subtle/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ig-text-tertiary">{r.badge}</span>}
                <span className="font-mono text-[11px] tabular-nums text-ig-text-secondary" title={fmtBRL(r.value)}>{fmtCompactBRL(r.value)}</span>
              </span>
            </div>
          ))}
        </div>
      </HudCardContent>
    </HudCard>
  );
}

/**
 * Signed variation pill. By convention a rising cost is bad → danger; set
 * `invert` for metrics where up is good (e.g. allocation rate).
 */
export function DeltaPill({ value, invert = false }: { value?: number; invert?: boolean }) {
  if (value === undefined || Number.isNaN(value)) return null;
  const up = value > 0;
  const good = value === 0 ? false : invert ? up : !up;
  const cls = value === 0 ? 'text-ig-text-tertiary' : good ? 'text-ig-success' : 'text-ig-danger';
  const Icon = value === 0 ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full bg-ig-surface-subtle/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums', cls)}>
      <Icon className="h-3 w-3" /> {fmtPct(value)}
    </span>
  );
}

export interface SparkKpi {
  id: string;
  label: string;
  /** Pre-formatted display value. */
  value: string;
  helper?: string;
  /** Signed % variation rendered as a pill (cost convention: up = danger). */
  delta?: number;
  /** When the delta should treat "up" as good (allocation rate, coverage…). */
  invertDelta?: boolean;
  /** Optional sparkline series (raw values). */
  spark?: number[];
  /** Sparkline / accent tone. */
  tone?: SparkTone;
}

/** Premium executive KPI card: label, value, variation pill and a mini sparkline. */
export function KpiSparkCard({ kpi }: { kpi: SparkKpi }) {
  const hasSpark = !!kpi.spark && kpi.spark.length > 1 && kpi.spark.some((v) => v !== 0);
  return (
    <HudCard className="h-full min-w-0">
      <HudCardContent className="flex h-full min-h-[96px] flex-col gap-1 p-3.5">
        <div className="flex min-w-0 items-start justify-between gap-1">
          <p className="min-w-0 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-ig-text-tertiary" title={kpi.label}>{kpi.label}</p>
          <DeltaPill value={kpi.delta} invert={kpi.invertDelta} />
        </div>
        <p className="min-w-0 truncate font-mono text-[16px] leading-tight tabular-nums text-ig-text-primary" title={kpi.value}>{kpi.value}</p>
        {kpi.helper && <p className="min-w-0 truncate text-[10px] text-ig-text-tertiary" title={kpi.helper}>{kpi.helper}</p>}
        {hasSpark && (
          <div className="mt-auto h-8 pt-2">
            <FinanceSparkline values={kpi.spark!} tone={kpi.tone ?? 'accent'} height={28} />
          </div>
        )}
      </HudCardContent>
    </HudCard>
  );
}

/** Responsive grid of premium KPI cards (no horizontal overflow). */
export function KpiSparkGrid({ kpis, columns = 6 }: { kpis: SparkKpi[]; columns?: 4 | 5 | 6 }) {
  const colCls = columns === 6 ? 'lg:grid-cols-3 xl:grid-cols-6' : columns === 5 ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-2 xl:grid-cols-4';
  return (
    <div className={cn('grid grid-cols-2 items-stretch gap-4', colCls)}>
      {kpis.map((k) => <KpiSparkCard key={k.id} kpi={k} />)}
    </div>
  );
}

/** Small inline MoM badge used in headers. */
export function MoMBadge({ momPct }: { momPct?: number }) {
  if (momPct === undefined) return null;
  const up = momPct >= 0;
  return (
    <span className={cn('font-mono text-[11px] tabular-nums', up ? 'text-ig-danger' : 'text-ig-success')}>
      {fmtPct(momPct)} m/m
    </span>
  );
}
