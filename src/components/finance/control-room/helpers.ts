import type { ScenarioKey } from './types';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

export function formatCompactBRL(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? '-' : '';
  if (abs >= 100_000_000_000) return `${sign}R$ ${(abs / 100_000_000_000).toFixed(1)}B`;
  if (abs >= 100_000_000) return `${sign}R$ ${(abs / 100_000_000).toFixed(1)}M`;
  if (abs >= 100_000) return `${sign}R$ ${(abs / 100_000).toFixed(0)}k`;
  return BRL.format(cents / 100);
}

export function formatPct(pct: number, fractionDigits = 1): string {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(fractionDigits)}%`;
}

export function formatSignedBRL(cents: number): string {
  const sign = cents > 0 ? '+' : '';
  return `${sign}${formatCompactBRL(cents)}`;
}

export interface ColorPalette {
  isLight: boolean;
  fgStrong: string;
  fgMuted: string;
  fgSubtle: string;
  panel: string;
  border: string;
  borderStrong: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  scenario: Record<ScenarioKey, string>;
}

export function getPalette(isLight: boolean): ColorPalette {
  return {
    isLight,
    fgStrong: isLight ? '#0F172A' : '#F2F5F7',
    fgMuted: isLight ? '#475569' : 'rgba(242,245,247,0.60)',
    fgSubtle: isLight ? '#64748B' : 'rgba(242,245,247,0.38)',
    panel: isLight ? 'rgba(255,255,255,0.92)' : 'rgba(20,32,40,0.86)',
    border: isLight ? 'rgba(15,23,42,0.08)' : 'rgba(170,200,190,0.10)',
    borderStrong: isLight ? 'rgba(15,23,42,0.14)' : 'rgba(170,200,190,0.18)',
    accent: isLight ? '#0F766E' : '#14B8A6',
    success: isLight ? '#047857' : '#10B981',
    warning: isLight ? '#B45309' : '#F5A524',
    danger: isLight ? '#B91C1C' : '#EF4B55',
    info: isLight ? '#1D4ED8' : '#3B82F6',
    scenario: {
      actual: isLight ? '#0F766E' : '#14B8A6',
      budget: isLight ? '#4F46E5' : '#818CF8',
      forecast: isLight ? '#B45309' : '#F59E0B',
      stress: isLight ? '#BE123C' : '#F43F5E',
      optimistic: isLight ? '#047857' : '#10B981',
      board: isLight ? '#7C3AED' : '#A78BFA',
    },
  };
}

export function varianceTone(varianceAbs: number, beneficial: 'positive' | 'negative'): 'success' | 'warning' | 'danger' | 'neutral' {
  if (Math.abs(varianceAbs) < 1) return 'neutral';
  const isPositive = varianceAbs > 0;
  const isFavorable = beneficial === 'positive' ? isPositive : !isPositive;
  if (isFavorable) return 'success';
  if (Math.abs(varianceAbs) > 1_000_000) return 'danger';
  return 'warning';
}

export function periodLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[Number(m) - 1] ?? m}/${y.slice(2)}`;
}

export function generatePeriodOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = 1; m <= 12; m++) {
    const v = `2026-${String(m).padStart(2, '0')}`;
    out.push({ value: v, label: periodLabel(v) });
  }
  return out;
}
