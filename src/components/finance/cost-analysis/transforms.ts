import type { WaterfallStep } from '@/components/finance/shared';
import type { CategoryTrendPoint, CategoryTrendSeries } from '@/lib/finance/selectors';

// ─────────────────────────────────────────────────────────────────
// Pure visual reshaping helpers for the cost-analysis charts.
//
// These functions ONLY reshape values already produced by the
// category-analysis selectors (cumulative sums, month axis alignment,
// month-over-month bridges, category×month matrices). They never apply
// the financial cost rule themselves — that stays in the selectors — so
// the official totals can never disagree with what is charted.
// ─────────────────────────────────────────────────────────────────

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** 'YYYY-MM' → 'Mmm/YY' (e.g. '2026-01' → 'Jan/26'). */
export function monthLabel(period: string): string {
  const [y, m] = period.split('-');
  return `${MONTHS_PT[Number(m) - 1] ?? m}/${y?.slice(2) ?? ''}`;
}

/** Add `delta` months to a 'YYYY-MM' key (delta may be negative). */
export function addMonths(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const idx = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Inclusive list of month keys between from..to ('YYYY-MM'). */
export function monthAxis(from?: string, to?: string): string[] {
  if (!from || !to) return [];
  const out: string[] = [];
  let cur = from;
  // Guard against inverted ranges / runaway loops.
  for (let i = 0; i < 120 && cur <= to; i++) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/** The equivalent window immediately preceding [from,to] (same length). */
export function previousWindow(from?: string, to?: string): { from?: string; to?: string } {
  const axis = monthAxis(from, to);
  if (axis.length === 0) return {};
  const len = axis.length;
  return { from: addMonths(from!, -len), to: addMonths(to!, -len) };
}

/** Project sparse monthly points onto a fixed axis (0 when a month is absent). */
export function alignToAxis(points: CategoryTrendPoint[], axis: string[]): number[] {
  const map = new Map(points.map((p) => [p.period, p.value]));
  return axis.map((p) => map.get(p) ?? 0);
}

/** Running cumulative of a numeric series. */
export function cumulative(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

export interface BridgeRow { id: string; name: string; value: number }

/**
 * Month-over-month bridge: explains why the total moved between the two latest
 * periods present in `series` (per-subcategoria deltas). Returns waterfall steps
 * start → top deltas (+ "Outros") → end, or [] when there is no prior period.
 */
export function buildMoMWaterfall(series: CategoryTrendSeries[], topN = 7): WaterfallStep[] {
  const periods = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.period)))).sort();
  if (periods.length < 2) return [];
  const last = periods[periods.length - 1];
  const prev = periods[periods.length - 2];
  const valAt = (s: CategoryTrendSeries, p: string) => s.points.find((pt) => pt.period === p)?.value ?? 0;

  const deltas = series
    .map((s) => ({ name: s.name, delta: valAt(s, last) - valAt(s, prev) }))
    .filter((d) => Math.abs(d.delta) > 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const prevTotal = series.reduce((t, s) => t + valAt(s, prev), 0);
  const lastTotal = series.reduce((t, s) => t + valAt(s, last), 0);

  const top = deltas.slice(0, topN);
  const restDelta = deltas.slice(topN).reduce((t, d) => t + d.delta, 0);

  const steps: WaterfallStep[] = [
    { label: monthLabel(prev), value: prevTotal, type: 'start' },
    ...top.map((d) => ({ label: d.name, value: d.delta, type: 'delta' as const })),
  ];
  if (Math.abs(restDelta) > 0.5) steps.push({ label: 'Outros', value: restDelta, type: 'delta' });
  steps.push({ label: monthLabel(last), value: lastTotal, type: 'end' });
  return steps;
}

export interface HeatmapData {
  rows: { id: string; label: string; total: number }[];
  cols: string[];
  /** rows.length × cols.length matrix of values. */
  matrix: number[][];
  max: number;
}

/** Build a {subcategoria × month} matrix for the heatmap (top N rows by total). */
export function buildHeatmap(series: CategoryTrendSeries[], axis: string[], topN = 10): HeatmapData {
  const top = [...series].sort((a, b) => b.total - a.total).slice(0, topN);
  const matrix = top.map((s) => alignToAxis(s.points, axis));
  const max = Math.max(1, ...matrix.flat());
  return {
    rows: top.map((s) => ({ id: s.id, label: s.name, total: s.total })),
    cols: axis,
    matrix,
    max,
  };
}
