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
