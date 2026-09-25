/**
 * Geometria dos instrumentos do HUD — pura e FINITA por construção.
 *
 * Todo número que vira atributo de SVG (cx, cy, stroke-dashoffset, points)
 * passa por aqui. Denominador zero, série vazia, série de um ponto ou valor
 * não finito viram um estado vazio honesto — nunca NaN no DOM, nunca progresso
 * inventado.
 */

export const finite = (n: unknown, fallback = 0): number => {
  const x = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(x) ? x : fallback;
};

export interface RingGeometry {
  radius: number;
  circumference: number;
  /** 0..1 — 0 quando não há denominador. */
  progress: number;
  dashOffset: number;
  /** Ponto final do arco (o marcador). */
  endX: number;
  endY: number;
  /** Sem denominador: desenhe só a trilha, sem arco nem marcador. */
  empty: boolean;
}

export function ringGeometry(size: number, strokeWidth: number, value: unknown, max: unknown): RingGeometry {
  const s = Math.max(finite(size), 0);
  const radius = Math.max((s - finite(strokeWidth)) / 2, 0);
  const circumference = 2 * Math.PI * radius;
  const m = finite(max);
  const v = Math.max(finite(value), 0);
  const empty = m <= 0;
  const progress = empty ? 0 : Math.min(v / m, 1);
  const angle = (-90 + progress * 360) * (Math.PI / 180);
  return {
    radius,
    circumference,
    progress,
    dashOffset: circumference * (1 - progress),
    endX: s / 2 + Math.cos(angle) * radius,
    endY: s / 2 + Math.sin(angle) * radius,
    empty,
  };
}

export interface SparklineInput {
  values: unknown[];
  forecast?: unknown[];
  bandLower?: unknown[];
  bandUpper?: unknown[];
  width: number;
  height: number;
  padding?: number;
}

export interface SparklineGeometry {
  points: string[];
  forecast: string[] | null;
  bandTop: string[] | null;
  bandBottom: string[] | null;
}

/**
 * Pontos da linha. Menos de dois valores finitos não é tendência: devolve
 * null (o chamador não desenha nada). Valores não finitos saem da série.
 */
export function sparklineGeometry(input: SparklineInput): SparklineGeometry | null {
  const clean = (xs?: unknown[]) => (xs ?? []).map((x) => (typeof x === 'number' ? x : Number(x))).filter(Number.isFinite);
  const values = clean(input.values);
  if (values.length < 2) return null;
  const forecast = input.forecast ? clean(input.forecast) : null;
  const lower = input.bandLower ? clean(input.bandLower) : null;
  const upper = input.bandUpper ? clean(input.bandUpper) : null;
  const domain = [...values, ...(forecast ?? []), ...(lower ?? []), ...(upper ?? [])];
  const max = Math.max(...domain);
  const min = Math.min(...domain);
  const range = max - min || 1;
  const pad = finite(input.padding, 2);
  const w = Math.max(finite(input.width), pad * 2 + 1);
  const h = Math.max(finite(input.height), pad * 2 + 1);
  const span = values.length - 1;
  const at = (v: number, i: number) => {
    const x = pad + (i / span) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  };
  const map = (xs: number[] | null) => (xs && xs.length > 0 ? xs.map(at) : null);
  return { points: values.map(at), forecast: map(forecast), bandTop: map(upper), bandBottom: map(lower) };
}

/** Altura relativa de barra (%), finita; série toda zero vira barras mínimas. */
export function barHeightPct(v: unknown, max: unknown, floor = 8): number {
  const m = finite(max);
  const x = Math.max(finite(v), 0);
  return m > 0 ? Math.max(Math.min((x / m) * 100, 100), floor) : floor;
}

/** Id estável e seguro para `url(#…)` a partir de `React.useId()` (que traz `:` / `«»`). */
export const svgSafeId = (prefix: string, reactId: string) => `${prefix}-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
