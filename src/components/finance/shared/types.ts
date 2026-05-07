export type FinanceScenario = 'realized' | 'budget' | 'forecast' | 'stress' | 'board';

export type FinancePeriod =
  | '2026-02'
  | '2026-03'
  | '2026-04'
  | '2026-Q1'
  | '2026-Q2'
  | '2026-YTD';

export type FinanceVarianceStatus = 'ok' | 'attention' | 'critical' | 'justified';

export type FinanceCloseStatus =
  | 'preparing'
  | 'reviewed'
  | 'approved'
  | 'closed'
  | 'reported'
  | 'blocked';

export const SCENARIO_LABEL: Record<FinanceScenario, string> = {
  realized: 'Realizado',
  budget: 'Orçado',
  forecast: 'Forecast',
  stress: 'Stress Case',
  board: 'Board Approved',
};

export const PERIOD_OPTIONS: { value: FinancePeriod; label: string }[] = [
  { value: '2026-02', label: 'Fev/2026' },
  { value: '2026-03', label: 'Mar/2026' },
  { value: '2026-04', label: 'Abr/2026' },
  { value: '2026-Q1', label: '1º Trimestre 2026' },
  { value: '2026-Q2', label: '2º Trimestre 2026' },
  { value: '2026-YTD', label: 'YTD 2026' },
];

export const SCENARIO_OPTIONS: { value: FinanceScenario; label: string }[] = [
  { value: 'realized', label: 'Realizado' },
  { value: 'budget', label: 'Orçado' },
  { value: 'forecast', label: 'Forecast' },
  { value: 'stress', label: 'Stress Case' },
  { value: 'board', label: 'Board Approved' },
];

// Finance number formatters — all delegate to the canonical pt-BR helpers
// in src/lib/i18n/format.ts so the entire SaaS renders numbers identically.
import { formatCurrency, formatPercent } from '@/lib/i18n/format';

/** R$ 1.234.567 (no decimals, accepts BRL units). */
export const fmtBRL = (n: number) => formatCurrency(n ?? 0, { maxFraction: 0 });

/** R$ 1,2 mi / R$ 1,5 mil — Intl pt-BR compact, accepts BRL units. */
export const fmtCompactBRL = (n: number) => formatCurrency(n ?? 0, { compact: true, maxFraction: 1 });

/** +12,3% — signed percentage, value already in percent units (e.g. 12.3 → "+12,3%"). */
export const fmtPct = (n: number, digits = 1) => {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${formatPercent(n, { minFraction: digits, maxFraction: digits })}`;
};
