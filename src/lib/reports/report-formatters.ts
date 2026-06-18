/**
 * Presentation-only formatting helpers shared by every PDF report.
 * No business rules — formatting, escaping and label selection only.
 */

export const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

/** "2026-03" → "Mar/26". Accepts a YYYY-MM (or longer) string. */
export function periodLabel(period?: string | null): string {
  if (!period) return '—';
  const [y, m] = period.split('-');
  return `${MONTHS_PT[parseInt(m, 10) - 1] || m}/${y?.slice(2) ?? ''}`;
}

/** Full BRL, no decimals. */
export const BRL = (n: number): string =>
  (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Compact BRL (e.g. "R$ 1,2 mi"). */
export function compactBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n || 0);
}

/** Percentage with one decimal, or "dados insuf." when not finite. */
export const fmtPct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? 'dados insuf.' : `${v.toFixed(1)}%`;

/** Signed percentage ("+3.2%" / "-1.0%"). */
export const fmtSignedPct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

/** Plain integer with pt-BR grouping. */
export const fmtInt = (n: number | null | undefined): string =>
  (n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

/** HTML-escape any value for safe interpolation into report markup. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

export const centsToReais = (cents?: number | null): number => (cents ?? 0) / 100;

export const curveCentsToReais = (value: number | null | undefined): number | null =>
  value == null || Number.isNaN(value) ? null : value / 100;

/** Localized date "14/06/2026". */
export function fmtDate(date?: string | number | Date | null): string {
  if (date == null || date === '') return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

/** Localized date + time "14/06/2026 17:30". */
export function fmtDateTime(date?: string | number | Date | null): string {
  if (date == null || date === '') return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
