/**
 * Bar-family print charts with the 2.5D depth treatment (gradient fills, soft
 * drop shadow, top-face highlight). Bar geometry is never altered — depth is
 * decoration only.
 */

import { BRL, compactBRL, esc, periodLabel } from '../report-formatters';
import { C, CATEGORICAL } from '../report-theme';
import { chartFrame, chartUid, depthDefs, emptyChart, gridLine, niceTicks, valuePill, type BarSeries, type ValueFmt } from './core';

/** 1.5px top-face highlight on a vertical bar (soft extrusion). */
function barTopFace(x: number, y: number, w: number): string {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="1.5" fill="#FFFFFF" opacity="0.35" rx="0.7"/>`;
}

export function svgGroupedBarChart(
  periods: string[],
  series: BarSeries[],
  opts: {
    width: number;
    height: number;
    highlightNegative?: (number | null)[];
    line?: { name: string; color: string; values: (number | null)[] };
    barLabels?: { seriesIdx: number; index: number }[];
    lineLabels?: { index: number; text: string }[];
    fmtValue?: ValueFmt;
    xLabel?: (s: string) => string;
  },
): string {
  const { width, height, highlightNegative, line, barLabels = [], lineLabels = [] } = opts;
  const fv = opts.fmtValue ?? compactBRL;
  const xl = opts.xLabel ?? periodLabel;
  const padL = 66, padR = 18, padT = 26, padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = periods.length;
  if (n === 0) return emptyChart(width, height);

  const depth = depthDefs(series.map((s) => s.color));

  const all = [
    ...series.flatMap((s) => s.values),
    ...(line ? line.values.filter((v): v is number => v != null) : []),
  ];
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (min === max) max = min + 1;
  max += (max - min) * 0.08;
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;
  const groupW = plotW / n;
  const barGap = 2;
  const barW = Math.max(2, (groupW * 0.62) / series.length - barGap);
  const xCenter = (i: number) => padL + i * groupW + groupW / 2;

  const ticks = niceTicks(min, max, 4);
  const gridLines = ticks
    .map((t) => gridLine(padL, yAt(t), padL + plotW) +
      `<text x="${padL - 8}" y="${yAt(t).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="${C.subtle}">${esc(fv(t))}</text>`)
    .join('');
  const y0 = yAt(0);

  const highlights = (highlightNegative ?? [])
    .map((v, i) => (v != null && v < 0)
      ? `<rect x="${(padL + i * groupW).toFixed(1)}" y="${padT}" width="${groupW.toFixed(1)}" height="${plotH}" fill="${C.critical}" opacity="0.06"/>`
      : '')
    .join('');

  const barX = (i: number, si: number) => {
    const groupStart = padL + i * groupW + (groupW - (barW + barGap) * series.length) / 2;
    return groupStart + si * (barW + barGap);
  };

  const bars = periods
    .map((_, i) => series
      .map((s, si) => {
        const v = s.values[i] ?? 0;
        const y = yAt(Math.max(0, v));
        const h = Math.abs(yAt(v) - y0);
        const x = barX(i, si);
        const top = v > 0 && h > 4 ? barTopFace(x + 0.4, y + 0.6, barW - 0.8) : '';
        const rx = Math.min(2.5, barW / 2);
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${depth.fill(s.color)}" rx="${rx}"${depth.shadow}/>${top}`;
      })
      .join(''))
    .join('');

  const barLabelEls = barLabels
    .filter((b) => b.index >= 0 && b.index < n && b.seriesIdx < series.length)
    .map((b) => {
      const s = series[b.seriesIdx];
      const v = s.values[b.index] ?? 0;
      const x = barX(b.index, b.seriesIdx) + barW / 2;
      const y = yAt(Math.max(0, v)) - 4;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${s.color}">${esc(fv(v))}</text>`;
    })
    .join('');

  let lineEls = '';
  if (line) {
    let d = '';
    let pen = false;
    line.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xCenter(i).toFixed(1)},${yAt(v).toFixed(1)} `;
      pen = true;
    });
    if (d.trim()) {
      lineEls = `<path d="${d.trim()}" fill="none" stroke="${line.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      lineEls += lineLabels
        .filter((l) => l.index >= 0 && l.index < n && line.values[l.index] != null)
        .map((l) => {
          const v = line.values[l.index] as number;
          const x = xCenter(l.index);
          const y = yAt(v);
          const above = v >= 0;
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${line.color}" stroke="#fff" stroke-width="1.2"/>` +
            `<text x="${x.toFixed(1)}" y="${(above ? y - 7 : y + 13).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${line.color}">${esc(l.text)}</text>`;
        })
        .join('');
    }
  }

  const zeroLine = `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${padL + plotW}" y2="${y0.toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`;

  const labelStep = Math.max(1, Math.ceil(n / 9));
  // Last label always shows; drop the stepped label right before it when
  // adjacent so the two never collide.
  const xLabels = periods
    .map((p, i) => (i === n - 1 || (i % labelStep === 0 && n - 1 - i >= labelStep))
      ? `<text x="${xCenter(i).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="9.5" fill="${C.subtle}">${esc(xl(p))}</text>`
      : '')
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${depth.defs}${chartFrame(width, height, padL, padT, plotW, plotH)}${gridLines}${highlights}${bars}${zeroLine}${lineEls}${barLabelEls}${xLabels}</svg>`;
}

/** Horizontal scenario bars with value + margin labels (supports negatives). */
export function svgScenarioBars(
  rows: { label: string; value: number; margin: number | null; color: string }[],
  opts: { width: number; rowH?: number; fmtValue?: ValueFmt },
): string {
  const rowH = opts.rowH ?? 32;
  const width = opts.width;
  const fv = opts.fmtValue ?? BRL;
  const padL = 116, padR = 110;
  const plotW = width - padL - padR;
  const height = rows.length * rowH + 8;
  const vals = rows.map((r) => r.value);
  let min = Math.min(0, ...vals);
  let max = Math.max(0, ...vals);
  if (min === max) max = min + 1;
  const xAt = (v: number) => padL + ((v - min) / (max - min)) * plotW;
  const x0 = xAt(0);
  const depth = depthDefs(rows.map((r) => r.color), { horizontal: true });

  const bars = rows
    .map((r, i) => {
      const cy = 4 + i * rowH + rowH / 2;
      const x = xAt(Math.min(0, r.value));
      const w = Math.max(1.5, Math.abs(xAt(r.value) - x0));
      const labelX = r.value >= 0 ? xAt(r.value) + 7 : xAt(r.value) - 7;
      const anchor = r.value >= 0 ? 'start' : 'end';
      const sign = r.value > 0 ? '+' : '';
      return `<text x="${padL - 8}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="10" font-weight="600" fill="${C.body}">${esc(r.label)}</text>` +
        `<rect x="${x.toFixed(1)}" y="${(cy - rowH * 0.30).toFixed(1)}" width="${w.toFixed(1)}" height="${(rowH * 0.60).toFixed(1)}" fill="${depth.fill(r.color)}" rx="3"${depth.shadow}/>` +
        `<text x="${labelX.toFixed(1)}" y="${(cy - 5).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="9.5" font-weight="700" fill="${r.color}">${sign}${esc(fv(r.value))}</text>` +
        `<text x="${labelX.toFixed(1)}" y="${(cy + 7).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="8.5" fill="${C.subtle}">margem ${esc(r.margin == null ? 'dados insuf.' : `${r.margin.toFixed(1)}%`)}</text>`;
    })
    .join('');

  const axis = `<line x1="${x0.toFixed(1)}" y1="2" x2="${x0.toFixed(1)}" y2="${height - 2}" stroke="${C.borderStrong}" stroke-width="1.2"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${depth.defs}${axis}${bars}</svg>`;
}

/** Ranked horizontal bars (top owners / clients / cost centers). Value labels at bar end. */
export function svgHorizontalBar(
  rows: { label: string; value: number; color?: string }[],
  opts: { width: number; rowH?: number; fmtValue?: ValueFmt; labelW?: number },
): string {
  if (!rows.length) return emptyChart(opts.width, 120);
  const rowH = opts.rowH ?? 26;
  const width = opts.width;
  const fv = opts.fmtValue ?? compactBRL;
  const padL = opts.labelW ?? 150, padR = 84;
  const plotW = width - padL - padR;
  const height = rows.length * rowH + 8;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const wAt = (v: number) => Math.max(1.5, (Math.abs(v) / max) * plotW);
  const colors = rows.map((r, i) => r.color ?? CATEGORICAL[i % CATEGORICAL.length]);
  const depth = depthDefs(colors, { horizontal: true });
  const barH = rowH * 0.58;

  const bars = rows
    .map((r, i) => {
      const cy = 4 + i * rowH + rowH / 2;
      const w = wAt(r.value);
      const color = colors[i];
      const capsule = Math.min(barH / 2, 6);
      // HUD-style: full-length track + gradient capsule + value pill.
      return `<text x="${padL - 8}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="9.5" font-weight="600" fill="${C.body}">${esc(r.label)}</text>` +
        `<rect x="${padL}" y="${(cy - barH / 2).toFixed(1)}" width="${plotW}" height="${barH.toFixed(1)}" fill="${C.grid}" opacity="0.45" rx="${capsule}"/>` +
        `<rect x="${padL}" y="${(cy - barH / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${barH.toFixed(1)}" fill="${depth.fill(color)}" rx="${capsule}"${depth.shadow}/>` +
        `<rect x="${(padL + 1.5).toFixed(1)}" y="${(cy - barH / 2 + 1.2).toFixed(1)}" width="${Math.max(0, w - 3).toFixed(1)}" height="1.4" fill="#FFFFFF" opacity="0.4" rx="0.7"/>` +
        valuePill(padL + plotW + 6, cy, fv(r.value), color, 'start');
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${depth.defs}${bars}</svg>`;
}

/** Stacked horizontal bar (single 100% bar — e.g. CLT vs PJ, composition). */
export function svgStackedBar(
  parts: { label: string; value: number; color?: string }[],
  opts: { width?: number; fmtValue?: ValueFmt },
): string {
  const data = parts.filter((p) => p.value > 0);
  const width = opts.width ?? 520;
  const fv = opts.fmtValue ?? ((n: number) => String(n));
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return emptyChart(width, 70);
  const barH = 30, padX = 4, barY = 6;
  const plotW = width - padX * 2;
  const colors = data.map((d, i) => d.color ?? CATEGORICAL[i % CATEGORICAL.length]);
  const depth = depthDefs(colors);
  const uid = chartUid();

  let acc = 0;
  const segs = data
    .map((d, i) => {
      const color = colors[i];
      const x = padX + (acc / total) * plotW;
      const w = (d.value / total) * plotW;
      acc += d.value;
      const pct = (d.value / total) * 100;
      const label = pct >= 9
        ? `<text x="${(x + w / 2).toFixed(1)}" y="${(barY + barH / 2 - 3).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="700" fill="#fff">${pct.toFixed(0)}%</text>` +
          (pct >= 18 ? `<text x="${(x + w / 2).toFixed(1)}" y="${(barY + barH / 2 + 8).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="7.5" font-weight="600" fill="#FFFFFFDD">${esc(fv(d.value))}</text>` : '')
        : '';
      return `<rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(0.5, w).toFixed(1)}" height="${barH}" fill="${depth.fill(color)}"/>` +
        `<line x1="${(x + w).toFixed(1)}" y1="${barY}" x2="${(x + w).toFixed(1)}" y2="${barY + barH}" stroke="#fff" stroke-width="1.6"/>${label}`;
    })
    .join('');

  // Rounded outer capsule via clip + hairline border + top-face highlight.
  const clip = `<clipPath id="${uid}-c"><rect x="${padX}" y="${barY}" width="${plotW}" height="${barH}" rx="${barH / 2 > 10 ? 10 : barH / 2}"/></clipPath>`;
  const frame = `<rect x="${padX + 0.5}" y="${barY + 0.5}" width="${plotW - 1}" height="${barH - 1}" rx="9.5" fill="none" stroke="#0F172A22" stroke-width="1"/>`;
  const bar25d = `<rect x="${padX + 6}" y="${barY + 1.6}" width="${plotW - 12}" height="1.6" fill="#FFFFFF" opacity="0.4" rx="0.8" clip-path="url(#${uid}-c)"/>`;

  const legendY = barY + barH + 18;
  const legendEls = data
    .map((d, i) => {
      const color = colors[i];
      const lx = padX + i * (plotW / Math.max(1, data.length));
      return `<rect x="${lx.toFixed(1)}" y="${legendY - 8}" width="9" height="9" rx="3" fill="${color}"/>` +
        `<text x="${(lx + 14).toFixed(1)}" y="${legendY}" dominant-baseline="middle" font-size="9.5" fill="${C.body}">${esc(d.label)}: <tspan font-weight="700">${esc(fv(d.value))}</tspan></text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${legendY + 10}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${depth.defs}${clip}<g clip-path="url(#${uid}-c)"${depth.shadow}>${segs}</g>${bar25d}${frame}${legendEls}</svg>`;
}

export interface WaterfallStep {
  label: string;
  /** Delta value (positive or negative); ignored for `total` steps. */
  value: number;
  /** `total` renders a full column from zero (start / subtotal / end). */
  type?: 'delta' | 'total';
  color?: string;
}

/**
 * Waterfall (bridge) chart: start total → deltas → end total, with dashed
 * connectors and a value label on every column.
 */
export function svgWaterfall(
  steps: WaterfallStep[],
  opts: { width?: number; height?: number; fmtValue?: ValueFmt },
): string {
  const width = opts.width ?? 560;
  const height = opts.height ?? 190;
  const fv = opts.fmtValue ?? compactBRL;
  if (!steps.length) return emptyChart(width, height);

  // Resolve running totals so each column knows its base and top. A `total`
  // step with value 0 renders the current running total (subtotal column).
  let running = 0;
  const cols = steps.map((s) => {
    if (s.type === 'total') {
      if (s.value !== 0) running = s.value;
      return { ...s, from: 0, to: running };
    }
    const from = running;
    running += s.value;
    return { ...s, from, to: running };
  });

  const allVals = cols.flatMap((c) => [c.from, c.to]);
  let min = Math.min(0, ...allVals);
  let max = Math.max(0, ...allVals);
  if (min === max) max = min + 1;
  max += (max - min) * 0.12;

  const padL = 66, padR = 14, padT = 20, padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;
  const n = cols.length;
  const slotW = plotW / n;
  const barW = Math.min(56, slotW * 0.6);

  const colColor = (c: WaterfallStep & { from: number; to: number }): string => {
    if (c.color) return c.color;
    if (c.type === 'total') return C.primary;
    return c.to >= c.from ? C.success : C.cost;
  };
  const depth = depthDefs(cols.map(colColor));

  const ticks = niceTicks(min, max, 4);
  const gridLines = ticks
    .map((t) => gridLine(padL, yAt(t), padL + plotW) +
      `<text x="${padL - 8}" y="${yAt(t).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="${C.subtle}">${esc(fv(t))}</text>`)
    .join('');

  let bars = '';
  let connectors = '';
  cols.forEach((c, i) => {
    const x = padL + i * slotW + (slotW - barW) / 2;
    const yTop = yAt(Math.max(c.from, c.to));
    const h = Math.max(1, Math.abs(yAt(c.from) - yAt(c.to)));
    const color = colColor(c);
    bars += `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${depth.fill(color)}" rx="2.5"${depth.shadow}/>`;
    if (h > 4) bars += barTopFace(x + 0.4, yTop + 0.6, barW - 0.8);
    const labelVal = c.type === 'total' ? c.to : c.to - c.from;
    const sign = c.type !== 'total' && labelVal > 0 ? '+' : '';
    bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(yTop - 4).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${color}">${sign}${esc(fv(labelVal))}</text>`;
    bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="8.5" fill="${C.muted}">${esc(c.label)}</text>`;
    if (i < n - 1) {
      const yConn = yAt(c.to).toFixed(1);
      const xNext = padL + (i + 1) * slotW + (slotW - barW) / 2;
      connectors += `<line x1="${(x + barW).toFixed(1)}" y1="${yConn}" x2="${xNext.toFixed(1)}" y2="${yConn}" stroke="${C.borderStrong}" stroke-width="1" stroke-dasharray="3 2"/>`;
    }
  });

  const zeroLine = `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${padL + plotW}" y2="${yAt(0).toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${depth.defs}${chartFrame(width, height, padL, padT, plotW, plotH)}${gridLines}${connectors}${bars}${zeroLine}</svg>`;
}

/**
 * Bullet rows: actual bar vs target tick inside a max range — compact
 * orçado × realizado comparison.
 */
export function svgBullet(
  rows: { label: string; value: number; target?: number; max?: number; color?: string }[],
  opts: { width?: number; rowH?: number; fmtValue?: ValueFmt; labelW?: number },
): string {
  if (!rows.length) return emptyChart(opts.width ?? 520, 100);
  const width = opts.width ?? 520;
  const rowH = opts.rowH ?? 26;
  const fv = opts.fmtValue ?? compactBRL;
  const padL = opts.labelW ?? 140, padR = 118;
  const plotW = width - padL - padR;
  const height = rows.length * rowH + 8;
  // Magnitude comparison — negative values/targets (cost lines) compare by |v|.
  const rangeMax = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.value), Math.abs(r.target ?? 0), Math.abs(r.max ?? 0))));
  const wAt = (v: number) => Math.max(0, (Math.abs(v) / rangeMax) * plotW);
  const colors = rows.map((r) => r.color ?? C.primary);
  const depth = depthDefs(colors, { horizontal: true });

  const els = rows
    .map((r, i) => {
      const cy = 4 + i * rowH + rowH / 2;
      const color = colors[i];
      const trackH = rowH * 0.6;
      const barH2 = rowH * 0.36;
      const track = `<rect x="${padL}" y="${(cy - trackH / 2).toFixed(1)}" width="${plotW}" height="${trackH.toFixed(1)}" fill="${C.grid}" opacity="0.5" rx="${(trackH / 2).toFixed(1)}"/>`;
      const bar = `<rect x="${padL}" y="${(cy - barH2 / 2).toFixed(1)}" width="${wAt(r.value).toFixed(1)}" height="${barH2.toFixed(1)}" fill="${depth.fill(color)}" rx="${(barH2 / 2).toFixed(1)}"${depth.shadow}/>`;
      const target = r.target != null
        ? `<line x1="${(padL + wAt(r.target)).toFixed(1)}" y1="${(cy - rowH * 0.38).toFixed(1)}" x2="${(padL + wAt(r.target)).toFixed(1)}" y2="${(cy + rowH * 0.38).toFixed(1)}" stroke="${C.ink}" stroke-width="2" stroke-linecap="round"/>`
        : '';
      const pct = r.target ? ` · ${Math.round(Math.abs(r.value / r.target) * 100)}%` : '';
      return `<text x="${padL - 8}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="9.5" font-weight="600" fill="${C.body}">${esc(r.label)}</text>` +
        track + bar + target +
        valuePill(padL + plotW + 6, cy, `${fv(r.value)}${pct}`, color, 'start');
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${depth.defs}${els}</svg>`;
}
