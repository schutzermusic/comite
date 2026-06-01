/**
 * Finance KPI — single source of truth for the shape and behavior of every
 * financial KPI in the system.
 *
 * Goals:
 * 1. Standardize how each page declares its KPIs.
 * 2. Decouple presentation (HudKpiStrip / FinanceKpiGrid) from calculation
 *    (selectors in src/lib/finance/selectors/).
 * 3. Enable any future real data source (Supabase, ERP) to feed the same
 *    components by producing the same FinanceKpi[] shape.
 *
 * The visual mapping is handled by FinanceKpiGrid, which converts a
 * FinanceKpi[] into the legacy KpiItem[] consumed by HudKpiStrip and wires
 * the click → FinanceDetailDrawer behaviour.
 */

export type FinanceKpiTrend = 'up' | 'down' | 'flat';
export type FinanceKpiTone = 'default' | 'success' | 'warning' | 'danger' | 'info';
export type FinanceKpiFormat =
  | 'currency'
  | 'compactCurrency'
  | 'percent'
  | 'number'
  | 'raw';

export type FinanceKpiCategory =
  | 'revenue'
  | 'cost'
  | 'margin'
  | 'cash'
  | 'forecast'
  | 'budget'
  | 'variance'
  | 'contract'
  | 'risk'
  | 'operational'
  | 'composite';

export type FinanceKpiSource =
  | 'mock'
  | 'derived'
  | 'ledger'
  | 'supabase'
  | 'erp'
  | 'manual';

/** Optional row used by drill-down/details for a KPI. */
export interface FinanceKpiBreakdownRow {
  label: string;
  value: number;
  /** Pre-formatted value (overrides numeric formatting if provided). */
  formattedValue?: string;
  share?: number;
  tone?: FinanceKpiTone;
}

/** Optional time-series for the KPI mini-chart inside the drawer. */
export interface FinanceKpiSeriesPoint {
  label: string;
  value: number;
}

/**
 * The canonical KPI contract every Finance page must produce via selectors
 * (see src/lib/finance/selectors/*). It is intentionally view-agnostic.
 */
export interface FinanceKpi {
  /** Stable identifier inside a single page/strip. */
  id: string;
  /** Short label rendered on the strip (≤ 30 chars recommended). */
  title: string;
  /** Numeric value (preferred). Strings only when the value is intrinsically
   *  textual (e.g. count "12 ativos"). */
  value: number | string;
  /** Optional pre-formatted display value. When provided overrides format(). */
  formattedValue?: string;
  /** Numeric format hint for HudKpi. Defaults to 'compactCurrency' for money. */
  format?: FinanceKpiFormat;
  /** Fraction digits override. */
  fractionDigits?: number;
  /** Signed delta in percentage points (will render with up/down arrow). */
  delta?: number;
  /** Free-form delta label ("vs orçado", "12m rolling"). */
  deltaLabel?: string;
  /** Optional short helper text under the value. */
  helper?: string;
  /** Resolved trend, used for tinting and icon hints. */
  trend?: FinanceKpiTrend;
  /** Visual tone (drives variant in HudKpi). */
  tone?: FinanceKpiTone;
  /** Semantic category — drives icon and grouping logic. */
  category?: FinanceKpiCategory;
  /** Where the value came from. Used by drawer to badge data lineage. */
  source?: FinanceKpiSource;
  /** Long-form description shown in the drawer. */
  details?: string;
  /** Optional rows that decompose the value. */
  drilldown?: FinanceKpiBreakdownRow[];
  /** Optional mini timeseries. */
  trendSeries?: FinanceKpiSeriesPoint[];
  /** When the value was last refreshed (ISO). */
  asOf?: string;
  /** Deep link to a more detailed page/module. */
  deepLink?: { href: string; label: string };
  /** When false the KPI renders without click affordance. Default true. */
  clickable?: boolean;
  /** Optional custom click handler (overrides drawer-open behaviour). */
  onClick?: () => void;
}

// ─── Math helpers ──────────────────────────────────────────────────────────

export function variancePct(actual: number, baseline: number): number {
  if (!baseline) return 0;
  return ((actual - baseline) / Math.abs(baseline)) * 100;
}

export function deltaPct(current: number, previous: number): number {
  if (!previous) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function marginPct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return (numerator / denominator) * 100;
}

export function trendFromDelta(d: number | undefined): FinanceKpiTrend {
  if (d === undefined || d === 0) return 'flat';
  return d > 0 ? 'up' : 'down';
}

/** Default tone resolution based on category + sign of variance. */
export function toneFromVariance(
  variance: number,
  category: FinanceKpiCategory,
): FinanceKpiTone {
  // For cost categories, negative variance is favorable (under budget)
  const isCost = category === 'cost';
  if (variance === 0) return 'info';
  if (isCost) return variance > 0 ? 'danger' : 'success';
  return variance > 0 ? 'success' : 'danger';
}

// ─── Drawer helpers ────────────────────────────────────────────────────────

/**
 * Whether the KPI should open the generic drawer. By default any KPI that
 * exposes details, drilldown, helper or asOf is considered "explorable".
 */
export function isKpiExplorable(kpi: FinanceKpi): boolean {
  if (kpi.clickable === false) return false;
  if (kpi.clickable === true) return true;
  return Boolean(
    kpi.details ||
      (kpi.drilldown && kpi.drilldown.length > 0) ||
      (kpi.trendSeries && kpi.trendSeries.length > 0) ||
      kpi.helper ||
      kpi.deepLink,
  );
}
