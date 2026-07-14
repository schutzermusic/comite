/**
 * Shared print palette for all enterprise PDF reports.
 *
 * Light, brand-aligned theme (Insight orange + green) used by every report
 * regardless of the app's dark/light mode. Extracted from the original
 * project-finance investor report so every module shares one visual standard.
 */

export const C = {
  ink: '#0F172A',
  body: '#1E293B',
  muted: '#475569',
  subtle: '#64748B',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  // Brand (from the Insight Energy wordmark)
  brandOrange: '#E87722',
  brandGreen: '#00984A',
  // Chart family (print-contrast variants of the cockpit palette)
  primary: '#0F766E',
  success: '#047857',
  successSoft: '#059669',
  info: '#1D4ED8',
  cyan: '#0E7490',
  cost: '#C2410C',
  costSoft: '#A16207',
  warning: '#B45309',
  critical: '#B91C1C',
  purple: '#7C3AED',
  grid: '#EDF2F7',
  panel: '#FBFDFE',
} as const;

/**
 * Default brand label for report covers/footers. Explicit `brandName` payloads
 * (org-level branding overrides) always win over this fallback.
 */
export const REPORT_BRAND_NAME = 'Insight Energy';

/** Layered print-safe shadows for the 2.5D card/band treatment. */
export const ELEV = {
  card: '0 1px 2px rgba(15, 23, 42, 0.05), 0 3px 8px rgba(15, 23, 42, 0.06)',
  band: '0 2px 6px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.85)',
} as const;

/** Insight-card accent colors by kind (see report-insights.ts). */
export const KIND_COLORS = {
  fact: C.info,
  alert: C.critical,
  recommendation: C.brandGreen,
  'data-quality': C.warning,
} as const;

/**
 * Mix a hex color towards white — used for the 2.5D gradient tops (light→base)
 * so gradients work for any chart color without a hardcoded pair table.
 */
export function lighten(hex: string, amount = 0.24): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}

/** Mix a hex color towards black — used for the 2.5D gradient bottom edge. */
export function darken(hex: string, amount = 0.14): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c * (1 - amount));
  const r = mix((n >> 16) & 0xff);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0').toUpperCase()}`;
}

export type Severity = 'success' | 'warning' | 'critical' | 'neutral';

export function sevColor(s: Severity): string {
  if (s === 'success') return C.success;
  if (s === 'warning') return C.warning;
  if (s === 'critical') return C.critical;
  return C.subtle;
}

/** Ordered categorical palette for distributions (donuts / multi-series bars). */
export const CATEGORICAL: string[] = [
  C.primary,
  C.info,
  C.purple,
  C.cost,
  C.success,
  C.cyan,
  C.warning,
  C.critical,
  C.costSoft,
  C.subtle,
];
