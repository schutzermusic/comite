/**
 * Shared chart plumbing: axis math, empty state, legends and the 2.5D depth
 * defs (gradient fills + soft drop shadow) used by every print chart.
 *
 * Depth treatment is purely decorative — gradients and shadows never change a
 * bar length, arc angle or area, so values are never distorted.
 */

import { esc } from '../report-formatters';
import { C, darken, lighten } from '../report-theme';

export type ValueFmt = (n: number) => string;

export interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  /** Draw the last non-null value as a label at the right edge. */
  endLabel?: boolean;
  /** Fill a soft gradient area between the line and the zero axis. */
  area?: boolean;
}

export interface ChartMarker {
  index: number;
  label: string;
  color: string;
  /** Optional value rendered under the marker label. */
  value?: string;
}

export interface BarSeries {
  name: string;
  color: string;
  values: number[];
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

export function chartFrame(width: number, height: number, padL: number, padT: number, plotW: number, plotH: number): string {
  // Layered plot surface: subtle vertical tint + hairline border (Glass HUD,
  // adapted to the light print theme).
  const uid = chartUid();
  return `<defs><linearGradient id="${uid}-pf" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#FDFEFE"/><stop offset="1" stop-color="#F4F7F9"/></linearGradient></defs>` +
    `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="url(#${uid}-pf)" rx="6"/>` +
    `<rect x="${padL + 0.5}" y="${padT + 0.5}" width="${plotW - 1}" height="${plotH - 1}" fill="none" stroke="${C.border}" stroke-width="1" rx="5.5"/>`;
}

/** Dotted horizontal grid line (modern HUD look — lighter than a solid rule). */
export function gridLine(x1: number, y: number, x2: number): string {
  return `<line x1="${x1}" y1="${y.toFixed(1)}" x2="${x2}" y2="${y.toFixed(1)}" stroke="${C.grid}" stroke-width="1" stroke-dasharray="1.5 3" stroke-linecap="round"/>`;
}

/**
 * Pill-shaped value badge (white capsule, colored hairline + text) drawn at an
 * anchor point — the print adaptation of the HUD metric chips.
 */
export function valuePill(x: number, cy: number, text: string, color: string, anchor: 'start' | 'end' | 'middle' = 'start'): string {
  const w = text.length * 4.9 + 12;
  const h = 13;
  const rx = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return `<rect x="${rx.toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}"` +
    ` fill="#FFFFFF" stroke="${color}55" stroke-width="1"/>` +
    `<text x="${(rx + w / 2).toFixed(1)}" y="${(cy + 0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle"` +
    ` font-size="8.6" font-weight="700" fill="${color}" style="font-variant-numeric:tabular-nums">${esc(text)}</text>`;
}

/** Approximate rendered width of a valuePill — for layout math. */
export function valuePillWidth(text: string): number {
  return text.length * 4.9 + 12;
}

export function emptyChart(width: number, height: number): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#F8FAFC" rx="8"/>` +
    `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="${C.subtle}">Dados insuficientes para este gráfico</text></svg>`;
}

/* ── 2.5D depth defs ── */

// SVG ids are global to the whole report document, so every chart instance
// gets a unique prefix — otherwise all charts would resolve to the first
// chart's gradients.
let uidSeq = 0;

export function chartUid(): string {
  uidSeq += 1;
  return `rc${uidSeq.toString(36)}`;
}

const colorKey = (color: string) => color.replace(/[^a-zA-Z0-9]/g, '');

export interface DepthDefs {
  /** `<defs>…</defs>` markup — include once per SVG. */
  defs: string;
  /** Gradient fill reference for a color passed to the constructor. */
  fill: (color: string) => string;
  /** ` filter="…"` attribute applying the soft drop shadow. */
  shadow: string;
}

/**
 * Per-chart `<defs>`: one vertical light→base gradient per color plus a soft
 * drop-shadow filter. Colors not in the list fall back to flat fill.
 */
export function depthDefs(colors: string[], opts?: { horizontal?: boolean }): DepthDefs {
  const uid = chartUid();
  const unique = [...new Set(colors)];
  const dir = opts?.horizontal ? 'x1="0" y1="0" x2="1" y2="0"' : 'x1="0" y1="0" x2="0" y2="1"';
  // Three-stop gradient: lit face → base → shaded edge (soft extrusion).
  const grads = unique
    .map((c) => `<linearGradient id="${uid}-g-${colorKey(c)}" ${dir}>` +
      `<stop offset="0" stop-color="${lighten(c, 0.3)}"/><stop offset="0.55" stop-color="${c}"/>` +
      `<stop offset="1" stop-color="${darken(c, 0.12)}"/></linearGradient>`)
    .join('');
  const filter = `<filter id="${uid}-ds" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="1.2" stdDeviation="1.1" flood-color="#0F172A" flood-opacity="0.18"/></filter>`;
  return {
    defs: `<defs>${grads}${filter}</defs>`,
    fill: (c: string) => (unique.includes(c) ? `url(#${uid}-g-${colorKey(c)})` : c),
    shadow: ` filter="url(#${uid}-ds)"`,
  };
}

export function legend(items: { name: string; color: string; dashed?: boolean }[]): string {
  return `<div class="legend">${items
    .map((i) => `<span class="lg"><span class="sw" style="background:${i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color}"></span>${esc(i.name)}</span>`)
    .join('')}</div>`;
}

/** Row of key-value callout chips above a chart. */
export function callouts(items: { label: string; value: string; color: string }[]): string {
  return `<div class="chips">${items
    .map((c) => `<span class="chip" style="border-color:${c.color}40;background:${c.color}0D"><span class="dot" style="background:${c.color}"></span><span class="chip-l">${esc(c.label)}</span><span class="chip-v" style="color:${c.color}">${esc(c.value)}</span></span>`)
    .join('')}</div>`;
}
