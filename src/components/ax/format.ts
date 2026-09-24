/**
 * Um formato só para Operações e Supply. Antes: quatro formatos de dinheiro
 * (com e sem centavos), três de quantidade e cinco de data em fusos
 * diferentes — o mesmo pedido aparecia com dois valores.
 *
 * Regras:
 *  • dinheiro com centavos em compras (preço, pedido); compacto só em faixas
 *    de sinal, e dito ("R$ 1,2 mi");
 *  • quantidade sempre com a unidade do item;
 *  • data é o dia de São Paulo, não o do navegador;
 *  • número digitado no padrão brasileiro: "1.000" é mil, "1.000,5" é mil e meio.
 */
export const TZ = 'America/Sao_Paulo';

const isNil = (v: unknown) => v === null || v === undefined || v === '' || Number.isNaN(Number(v));

export function money(value: unknown, currency = 'BRL', opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (isNil(value)) return '—';
  const n = Number(value);
  if (opts.compact && Math.abs(n) >= 1000) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  const cents = opts.cents ?? true;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL',
    minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(n);
}

export function qty(value: unknown, unit?: string | null): string {
  if (isNil(value)) return '—';
  const s = Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unit ? `${s} ${unit}` : s;
}

export function pct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;
}

/** Hoje em São Paulo (YYYY-MM-DD). */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

function toDate(value: string): Date {
  return new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value);
}

export function date(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(toDate(value));
}

export function dateShort(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: 'short' }).format(toDate(value)).replace('.', '');
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .format(toDate(value));
}

/** Dias de `from` até `to` (datas de calendário). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

/** "hoje", "amanhã", "em 5 dias", "há 3 dias" — o prazo como a pessoa lê. */
export function relativeDue(value: string | null | undefined, today = todayIso()): { text: string; late: boolean; days: number | null } {
  if (!value) return { text: 'sem data', late: false, days: null };
  const d = daysBetween(today, value.slice(0, 10));
  if (d === 0) return { text: 'hoje', late: false, days: 0 };
  if (d === 1) return { text: 'amanhã', late: false, days: 1 };
  if (d === -1) return { text: 'ontem', late: true, days: -1 };
  if (d > 1) return { text: d <= 45 ? `em ${d} dias` : dateShort(value), late: false, days: d };
  return { text: `há ${-d} dias`, late: true, days: d };
}

/**
 * Número digitado no padrão brasileiro. Com vírgula: pontos são milhar e a
 * vírgula é decimal. Sem vírgula: "1.000" (grupos de três) é milhar; "12.5"
 * é decimal. Devolve null quando não é número — nunca um valor adivinhado.
 */
export function parseDecimalBR(input: string): number | null {
  const s = input.trim().replace(/\s/g, '');
  if (!s) return null;
  let normalized: string;
  if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) normalized = s.replace(/\./g, '');
  else normalized = s;
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
