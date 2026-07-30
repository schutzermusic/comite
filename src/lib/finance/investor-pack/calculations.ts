import type {
  InvestorPack,
  InvestorPackCurvePoint,
  InvestorPackMetrics,
  InvestorPackSnapshot,
  InvestorPackValidation,
} from './types';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function nextPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function hasAnyValue(pack: InvestorPack): boolean {
  return pack.months.some((month) =>
    month.revenueActualCents > 0
    || month.revenueForecastCents > 0
    || month.payrollActualCents > 0
    || month.payrollForecastCents > 0,
  );
}

export function validateInvestorPack(pack: InvestorPack): InvestorPackValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!pack.title.trim()) errors.push('Informe o título do pack.');
  if (!PERIOD_RE.test(pack.periodStart) || !PERIOD_RE.test(pack.periodEnd)) {
    errors.push('Informe um período inicial e final válidos.');
  } else if (pack.periodEnd < pack.periodStart) {
    errors.push('O período final não pode ser anterior ao inicial.');
  }
  if (pack.months.length === 0 || !hasAnyValue(pack)) {
    errors.push('Informe pelo menos uma competência com valor.');
  }

  const seen = new Set<string>();
  const sorted = [...pack.months].sort((a, b) => a.period.localeCompare(b.period));
  for (const month of sorted) {
    if (!PERIOD_RE.test(month.period)) errors.push(`Competência inválida: ${month.period || 'em branco'}.`);
    if (seen.has(month.period)) errors.push(`Competência duplicada: ${month.period}.`);
    seen.add(month.period);
    const values = [
      month.revenueActualCents,
      month.revenueForecastCents,
      month.payrollActualCents,
      month.payrollForecastCents,
    ];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) {
      errors.push(`A competência ${month.period || 'sem período'} possui valor inválido.`);
    }
  }

  for (let index = 1; index < sorted.length; index += 1) {
    if (nextPeriod(sorted[index - 1].period) !== sorted[index].period) {
      warnings.push(`Há uma lacuna entre ${sorted[index - 1].period} e ${sorted[index].period}.`);
    }
  }

  const hasForecast = sorted.some((month) => month.revenueForecastCents > 0 || month.payrollForecastCents > 0);
  if (hasForecast && pack.narrative.assumptions.every((item) => !item.trim())) {
    warnings.push('Existem valores previstos sem premissa explicativa.');
  }

  return { valid: errors.length === 0, errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)) };
}

export function calculateInvestorPack(pack: InvestorPack): InvestorPackSnapshot {
  let revenueCumulativeCents = 0;
  let payrollCumulativeCents = 0;
  const points: InvestorPackCurvePoint[] = [...pack.months]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((month) => {
      const revenueTotalCents = month.revenueActualCents + month.revenueForecastCents;
      const payrollTotalCents = month.payrollActualCents + month.payrollForecastCents;
      revenueCumulativeCents += revenueTotalCents;
      payrollCumulativeCents += payrollTotalCents;
      return {
        ...month,
        revenueTotalCents,
        payrollTotalCents,
        revenueCumulativeCents,
        payrollCumulativeCents,
        balanceCents: revenueTotalCents - payrollTotalCents,
        balanceCumulativeCents: revenueCumulativeCents - payrollCumulativeCents,
      };
    });

  const metrics = points.reduce<InvestorPackMetrics>((acc, point) => ({
    revenueActualCents: acc.revenueActualCents + point.revenueActualCents,
    revenueForecastCents: acc.revenueForecastCents + point.revenueForecastCents,
    revenueTotalCents: acc.revenueTotalCents + point.revenueTotalCents,
    payrollActualCents: acc.payrollActualCents + point.payrollActualCents,
    payrollForecastCents: acc.payrollForecastCents + point.payrollForecastCents,
    payrollTotalCents: acc.payrollTotalCents + point.payrollTotalCents,
    balanceCents: acc.balanceCents + point.balanceCents,
    coverageRatio: null,
  }), {
    revenueActualCents: 0,
    revenueForecastCents: 0,
    revenueTotalCents: 0,
    payrollActualCents: 0,
    payrollForecastCents: 0,
    payrollTotalCents: 0,
    balanceCents: 0,
    coverageRatio: null,
  });
  metrics.coverageRatio = metrics.payrollTotalCents > 0 ? metrics.revenueTotalCents / metrics.payrollTotalCents : null;

  return {
    pack: { ...pack, months: points.map(({ revenueTotalCents: _r, payrollTotalCents: _p, revenueCumulativeCents: _rc, payrollCumulativeCents: _pc, balanceCents: _b, balanceCumulativeCents: _bc, ...month }) => month) },
    points,
    metrics,
    warnings: validateInvestorPack(pack).warnings,
    sourceLabel: 'Dados informados do sistema na Projeção Financeira',
  };
}

export function centsToReais(value: number): number {
  return value / 100;
}

export function reaisToCents(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

export function formatInvestorCurrency(cents: number, compact = false): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(cents / 100);
}

export function formatInvestorPeriod(period: string): string {
  if (!PERIOD_RE.test(period)) return period;
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
    .replace('.', '');
}
