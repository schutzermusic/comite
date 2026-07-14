/**
 * Radial print charts: donut with side legend, 180° radial gauge and compact
 * progress ring. Depth = gradient fills, white slice separators and an inner
 * shadow ring; arc angles always equal the underlying percentages.
 */

import { esc } from '../report-formatters';
import { C, CATEGORICAL, lighten } from '../report-theme';
import { chartUid, depthDefs, emptyChart, type ValueFmt } from './core';

/** Donut with center total and a side legend listing value + percentage. */
export function svgDonut(
  slices: { label: string; value: number; color?: string }[],
  opts: { width?: number; height?: number; centerLabel?: string; fmtValue?: ValueFmt },
): string {
  const data = slices.filter((s) => s.value > 0);
  const width = opts.width ?? 360;
  const height = opts.height ?? 200;
  const fv = opts.fmtValue ?? ((n: number) => String(n));
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return emptyChart(width, height);

  // Radius adapts to short charts so the ring never clips the viewBox.
  const rOuter = Math.min(72, height / 2 - 4);
  const rInner = Math.round(rOuter * 0.62);
  const cx = rOuter + 20, cy = height / 2;
  const colors = data.map((d, i) => d.color ?? CATEGORICAL[i % CATEGORICAL.length]);
  const depth = depthDefs(colors);
  const rMid = (rOuter + rInner) / 2;
  let acc = 0;
  const arcs = data
    .map((d, i) => {
      const color = colors[i];
      const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2;
      acc += d.value;
      const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0o = cx + rOuter * Math.cos(a0), y0o = cy + rOuter * Math.sin(a0);
      const x1o = cx + rOuter * Math.cos(a1), y1o = cy + rOuter * Math.sin(a1);
      const x0i = cx + rInner * Math.cos(a1), y0i = cy + rInner * Math.sin(a1);
      const x1i = cx + rInner * Math.cos(a0), y1i = cy + rInner * Math.sin(a0);
      const pct = (d.value / total) * 100;
      // In-slice percentage when the slice is wide enough to hold it.
      const aMid = (a0 + a1) / 2;
      const sliceLabel = pct >= 11
        ? `<text x="${(cx + rMid * Math.cos(aMid)).toFixed(1)}" y="${(cy + rMid * Math.sin(aMid)).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="8.6" font-weight="700" fill="#fff">${pct.toFixed(0)}%</text>`
        : '';
      return `<path d="M${x0o.toFixed(1)},${y0o.toFixed(1)} A${rOuter},${rOuter} 0 ${large} 1 ${x1o.toFixed(1)},${y1o.toFixed(1)} L${x0i.toFixed(1)},${y0i.toFixed(1)} A${rInner},${rInner} 0 ${large} 0 ${x1i.toFixed(1)},${y1i.toFixed(1)} Z" fill="${depth.fill(color)}" stroke="#fff" stroke-width="2"/>${sliceLabel}`;
    })
    .join('');

  // Depth: soft halo behind the ring + inner shadow inside the hole.
  const halo = `<circle cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="#0F172A" stroke-opacity="0.06" stroke-width="${rOuter - rInner + 5}"/>`;
  const innerRing = `<circle cx="${cx}" cy="${cy}" r="${rInner + 1.5}" fill="none" stroke="#0F172A" stroke-opacity="0.08" stroke-width="3"/>`;

  const center = opts.centerLabel
    ? `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="15" font-weight="700" fill="${C.ink}" style="font-variant-numeric:tabular-nums">${esc(opts.centerLabel)}</text>` +
      `<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="7.5" font-weight="700" letter-spacing="0.08em" fill="${C.subtle}">TOTAL</text>`
    : `<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="15" font-weight="700" fill="${C.ink}" style="font-variant-numeric:tabular-nums">${esc(fv(total))}</text>`;

  const legendX = cx + rOuter + 20;
  const legendEls = data
    .map((d, i) => {
      const color = colors[i];
      const ly = 22 + i * 18;
      const pct = ((d.value / total) * 100).toFixed(1);
      return `<rect x="${legendX}" y="${ly - 7}" width="9" height="9" rx="2" fill="${color}"/>` +
        `<text x="${legendX + 14}" y="${ly}" dominant-baseline="middle" font-size="9.5" fill="${C.body}">${esc(d.label)}</text>` +
        `<text x="${width - 6}" y="${ly}" text-anchor="end" dominant-baseline="middle" font-size="9.5" font-weight="700" fill="${color}">${esc(fv(d.value))} · ${pct}%</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${depth.defs}${halo}${arcs}${innerRing}${center}${legendEls}</svg>`;
}

/**
 * 180° radial gauge: percentage arc over a track, big center value. Optional
 * colored threshold bands under the track for context (e.g. meta zones).
 */
export function svgGauge(
  pct: number,
  opts: {
    width?: number;
    height?: number;
    label?: string;
    sublabel?: string;
    color?: string;
    /** Threshold bands [fromPct, toPct, color] rendered under the arc. */
    bands?: [number, number, string][];
    /** Center text override (defaults to `NN%`). */
    valueText?: string;
  } = {},
): string {
  const width = opts.width ?? 260;
  const height = opts.height ?? 150;
  const clamped = Math.max(0, Math.min(100, pct));
  const color = opts.color ?? (clamped >= 70 ? C.success : clamped >= 40 ? C.primary : C.warning);
  const cx = width / 2, cy = height - 34, r = Math.min(width / 2 - 22, cy - 14);
  const thick = 15;
  const uid = chartUid();

  const angleAt = (p: number) => Math.PI + (p / 100) * Math.PI; // 180°→360°
  const arcPath = (from: number, to: number, radius: number): string => {
    const a0 = angleAt(from), a1 = angleAt(to);
    const x0 = cx + radius * Math.cos(a0), y0 = cy + radius * Math.sin(a0);
    const x1 = cx + radius * Math.cos(a1), y1 = cy + radius * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0.toFixed(1)},${y0.toFixed(1)} A${radius},${radius} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`;
  };

  const bandEls = (opts.bands ?? [])
    .map(([from, to, c]) => `<path d="${arcPath(from, to, r + thick / 2 + 4)}" fill="none" stroke="${c}" stroke-opacity="0.35" stroke-width="3.5" stroke-linecap="butt"/>`)
    .join('');

  // Minor tick marks along the arc (every 10%) — instrument-panel look.
  const tickEls = Array.from({ length: 11 }, (_, i) => {
    const a = angleAt(i * 10);
    const rT0 = r - thick / 2 - 3, rT1 = r - thick / 2 - (i % 5 === 0 ? 8 : 5.5);
    return `<line x1="${(cx + rT0 * Math.cos(a)).toFixed(1)}" y1="${(cy + rT0 * Math.sin(a)).toFixed(1)}"` +
      ` x2="${(cx + rT1 * Math.cos(a)).toFixed(1)}" y2="${(cy + rT1 * Math.sin(a)).toFixed(1)}"` +
      ` stroke="${i % 5 === 0 ? C.subtle : C.grid}" stroke-width="${i % 5 === 0 ? 1.4 : 1}" stroke-linecap="round"/>`;
  }).join('');

  const track = `<path d="${arcPath(0, 100, r)}" fill="none" stroke="#0F172A" stroke-opacity="0.05" stroke-width="${thick + 4}" stroke-linecap="round"/>` +
    `<path d="${arcPath(0, 100, r)}" fill="none" stroke="${C.grid}" stroke-width="${thick}" stroke-linecap="round"/>`;
  const arc = clamped > 0
    ? `<path d="${arcPath(0, clamped, r)}" fill="none" stroke="url(#${uid}-gg)" stroke-width="${thick}" stroke-linecap="round" filter="url(#${uid}-gs)"/>`
    : '';
  // Value dot at the arc tip.
  const tipA = angleAt(clamped);
  const tip = clamped > 0
    ? `<circle cx="${(cx + r * Math.cos(tipA)).toFixed(1)}" cy="${(cy + r * Math.sin(tipA)).toFixed(1)}" r="4" fill="#fff" stroke="${color}" stroke-width="2.2"/>`
    : '';

  const valueText = opts.valueText ?? `${Math.round(clamped)}%`;
  const label = opts.label ? `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="9" font-weight="700" fill="${C.muted}" letter-spacing="0.08em">${esc(opts.label.toUpperCase())}</text>` : '';
  const sublabel = opts.sublabel ? `<text x="${cx}" y="${cy + 30}" text-anchor="middle" font-size="8.5" fill="${C.subtle}">${esc(opts.sublabel)}</text>` : '';
  const minMax = `<text x="${(cx - r).toFixed(1)}" y="${cy + 14}" text-anchor="middle" font-size="8" fill="${C.subtle}">0%</text>` +
    `<text x="${(cx + r).toFixed(1)}" y="${cy + 14}" text-anchor="middle" font-size="8" fill="${C.subtle}">100%</text>`;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="${uid}-gg" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${lighten(color, 0.28)}"/><stop offset="1" stop-color="${color}"/></linearGradient>` +
    `<filter id="${uid}-gs" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#0F172A" flood-opacity="0.18"/></filter></defs>` +
    `${bandEls}${track}${tickEls}${arc}${tip}` +
    `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-size="24" font-weight="700" fill="${C.ink}" style="font-variant-numeric:tabular-nums">${esc(valueText)}</text>` +
    `${label}${sublabel}${minMax}</svg>`;
}

/** Compact circular progress ring with center percentage. */
export function svgProgressRing(
  pct: number,
  opts: { size?: number; color?: string; label?: string; valueText?: string } = {},
): string {
  const size = opts.size ?? 84;
  const clamped = Math.max(0, Math.min(100, pct));
  const color = opts.color ?? C.primary;
  const cx = size / 2, cy = size / 2;
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const uid = chartUid();
  const dash = (clamped / 100) * circ;
  const label = opts.label
    ? `<text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="6.5" font-weight="700" fill="${C.subtle}" letter-spacing="0.06em">${esc(opts.label.toUpperCase())}</text>`
    : '';

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="${uid}-pr" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${lighten(color, 0.28)}"/><stop offset="1" stop-color="${color}"/></linearGradient></defs>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.grid}" stroke-width="7"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#${uid}-pr)" stroke-width="7" stroke-linecap="round"` +
    ` stroke-dasharray="${dash.toFixed(1)} ${(circ - dash).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` +
    `<text x="${cx}" y="${cy + (opts.label ? 1 : 4)}" text-anchor="middle" font-size="15" font-weight="700" fill="${C.ink}" style="font-variant-numeric:tabular-nums">${esc(opts.valueText ?? `${Math.round(clamped)}%`)}</text>` +
    `${label}</svg>`;
}
