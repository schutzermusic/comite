/**
 * Formatação pt-BR: datas, moeda e números.
 * Use em toda a UI para consistência.
 */

const ptBR = 'pt-BR';
const timeZone = 'America/Sao_Paulo';

export function formatCurrency(value: number, options?: { compact?: boolean; minFraction?: number; maxFraction?: number }): string {
  return new Intl.NumberFormat(ptBR, {
    style: 'currency',
    currency: 'BRL',
    notation: options?.compact ? 'compact' : 'standard',
    minimumFractionDigits: options?.minFraction ?? 0,
    maximumFractionDigits: options?.maxFraction ?? (options?.compact ? 1 : 2),
  }).format(value ?? 0);
}

export function formatDate(date: Date | string | number, style: 'short' | 'medium' | 'long' = 'short'): string {
  const d = typeof date === 'object' && 'getTime' in date ? date : new Date(date);
  const opts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : style === 'medium'
        ? { day: '2-digit', month: 'short', year: 'numeric' }
        : { dateStyle: 'long' };
  return new Intl.DateTimeFormat(ptBR, { ...opts, timeZone }).format(d);
}

export function formatDateTime(date: Date | string | number): string {
  const d = typeof date === 'object' && 'getTime' in date ? date : new Date(date);
  return new Intl.DateTimeFormat(ptBR, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(d);
}

export function formatNumber(value: number, options?: { minFraction?: number; maxFraction?: number }): string {
  return new Intl.NumberFormat(ptBR, {
    minimumFractionDigits: options?.minFraction ?? 0,
    maximumFractionDigits: options?.maxFraction ?? 2,
  }).format(value ?? 0);
}

export function formatPercent(value: number, options?: { minFraction?: number; maxFraction?: number }): string {
  return new Intl.NumberFormat(ptBR, {
    style: 'percent',
    minimumFractionDigits: options?.minFraction ?? 0,
    maximumFractionDigits: options?.maxFraction ?? 1,
  }).format((value ?? 0) / 100);
}
