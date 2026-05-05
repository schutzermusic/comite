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

export const fmtBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

export const fmtCompactBRL = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}R$ ${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toFixed(0)}k`;
  return fmtBRL(n);
};

export const fmtPct = (n: number, digits = 1) =>
  `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
