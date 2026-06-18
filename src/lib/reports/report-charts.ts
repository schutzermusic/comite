/**
 * Inline-SVG chart primitives for print (vector — crisp at any DPI, never a
 * screenshot of the dark app UI). Every chart renders visible numeric labels,
 * callouts and legends because the PDF is static.
 *
 * Extracted from the original project-finance investor report and extended with
 * donut, horizontal-bar, 5×5 risk-matrix and stacked-bar primitives used by the
 * other modules. All value formatting defaults to compact BRL but accepts a
 * `fmtValue` override so count-based charts (tasks, risks…) read correctly.
 */

import { BRL, compactBRL, esc, periodLabel } from './report-formatters';
import { C, CATEGORICAL } from './report-theme';

type ValueFmt = (n: number) => string;

export interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  /** Draw the last non-null value as a label at the right edge. */
  endLabel?: boolean;
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
  return `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="${C.panel}" rx="4"/>`;
}

export function emptyChart(width: number, height: number): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#F8FAFC" rx="8"/>` +
    `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="${C.subtle}">Dados insuficientes para este gráfico</text></svg>`;
}

export function svgLineChart(
  periods: string[],
  series: LineSeries[],
  opts: { width: number; height: number; markers?: ChartMarker[]; fmtValue?: ValueFmt; xLabel?: (s: string) => string },
): string {
  const { width, height, markers = [] } = opts;
  const fv = opts.fmtValue ?? compactBRL;
  const xl = opts.xLabel ?? periodLabel;
  const hasEndLabels = series.some((s) => s.endLabel);
  const padL = 66, padR = hasEndLabels ? 92 : 18, padT = 30, padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = periods.length;
  if (n === 0) return emptyChart(width, height);

  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (min === max) max = min + 1;
  const xAt = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;

  const ticks = niceTicks(min, max, 4);
  const gridLines = ticks
    .map((t) => {
      const y = yAt(t).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="${C.subtle}">${esc(fv(t))}</text>`;
    })
    .join('');

  const zeroLine = min < 0 && max > 0
    ? `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${padL + plotW}" y2="${yAt(0).toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
    : '';

  const labelStep = Math.max(1, Math.ceil(n / 9));
  const xLabels = periods
    .map((p, i) => (i % labelStep === 0 || i === n - 1)
      ? `<text x="${xAt(i).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="9.5" fill="${C.subtle}">${esc(xl(p))}</text>`
      : '')
    .join('');

  const visibleMarkers = markers.filter((m) => m.index >= 0 && m.index < n);
  const markerEls = visibleMarkers
    .map((m, mi) => {
      const xNum = xAt(m.index);
      const x = xNum.toFixed(1);
      const ly = 9 + mi * 10;
      const anchor = xNum < padL + plotW * 0.12 ? 'start' : xNum > padL + plotW * 0.88 ? 'end' : 'middle';
      return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="${m.color}" stroke-width="1.2" stroke-dasharray="4 3"/>` +
        `<text x="${x}" y="${ly}" text-anchor="${anchor}" font-size="8.5" font-weight="700" fill="${m.color}">${esc(m.label)}${m.value ? ` · ${esc(m.value)}` : ''}</text>`;
    })
    .join('');

  const paths = series
    .map((s) => {
      let d = '';
      let pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const cmd = pen ? 'L' : 'M';
        d += `${cmd}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)} `;
        pen = true;
      });
      if (!d.trim()) return '';
      const dash = s.dashed ? ' stroke-dasharray="5 3"' : '';
      return `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"${dash}/>`;
    })
    .join('');

  let endLabels = '';
  if (hasEndLabels) {
    const entries = series
      .filter((s) => s.endLabel)
      .map((s) => {
        let lastIdx = -1;
        for (let i = s.values.length - 1; i >= 0; i--) {
          if (s.values[i] != null) { lastIdx = i; break; }
        }
        return lastIdx >= 0 ? { color: s.color, value: s.values[lastIdx] as number, x: xAt(lastIdx), y: yAt(s.values[lastIdx] as number) } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e != null)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].y - entries[i - 1].y < 12) entries[i].y = entries[i - 1].y + 12;
    }
    endLabels = entries
      .map((e) => `<circle cx="${e.x.toFixed(1)}" cy="${yAt(e.value).toFixed(1)}" r="2.4" fill="${e.color}"/>` +
        `<text x="${(padL + plotW + 8).toFixed(1)}" y="${e.y.toFixed(1)}" font-size="9" font-weight="700" dominant-baseline="middle" fill="${e.color}">${esc(fv(e.value))}</text>`)
      .join('');
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${chartFrame(width, height, padL, padT, plotW, plotH)}${gridLines}${zeroLine}${markerEls}${paths}${endLabels}${xLabels}</svg>`;
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
    .map((t) => {
      const y = yAt(t).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="${C.subtle}">${esc(fv(t))}</text>`;
    })
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
        return `<rect x="${barX(i, si).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${s.color}" rx="1"/>`;
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
  const xLabels = periods
    .map((p, i) => (i % labelStep === 0 || i === n - 1)
      ? `<text x="${xCenter(i).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="9.5" fill="${C.subtle}">${esc(xl(p))}</text>`
      : '')
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${chartFrame(width, height, padL, padT, plotW, plotH)}${gridLines}${highlights}${bars}${zeroLine}${lineEls}${barLabelEls}${xLabels}</svg>`;
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

  const bars = rows
    .map((r, i) => {
      const cy = 4 + i * rowH + rowH / 2;
      const x = xAt(Math.min(0, r.value));
      const w = Math.max(1.5, Math.abs(xAt(r.value) - x0));
      const labelX = r.value >= 0 ? xAt(r.value) + 7 : xAt(r.value) - 7;
      const anchor = r.value >= 0 ? 'start' : 'end';
      const sign = r.value > 0 ? '+' : '';
      return `<text x="${padL - 8}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="10" font-weight="600" fill="${C.body}">${esc(r.label)}</text>` +
        `<rect x="${x.toFixed(1)}" y="${(cy - rowH * 0.30).toFixed(1)}" width="${w.toFixed(1)}" height="${(rowH * 0.60).toFixed(1)}" fill="${r.color}" rx="3"/>` +
        `<text x="${labelX.toFixed(1)}" y="${(cy - 5).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="9.5" font-weight="700" fill="${r.color}">${sign}${esc(fv(r.value))}</text>` +
        `<text x="${labelX.toFixed(1)}" y="${(cy + 7).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="8.5" fill="${C.subtle}">margem ${esc(r.margin == null ? 'dados insuf.' : `${r.margin.toFixed(1)}%`)}</text>`;
    })
    .join('');

  const axis = `<line x1="${x0.toFixed(1)}" y1="2" x2="${x0.toFixed(1)}" y2="${height - 2}" stroke="${C.borderStrong}" stroke-width="1.2"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${axis}${bars}</svg>`;
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
  const padL = opts.labelW ?? 150, padR = 78;
  const plotW = width - padL - padR;
  const height = rows.length * rowH + 8;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const wAt = (v: number) => Math.max(1.5, (Math.abs(v) / max) * plotW);

  const bars = rows
    .map((r, i) => {
      const cy = 4 + i * rowH + rowH / 2;
      const w = wAt(r.value);
      const color = r.color ?? CATEGORICAL[i % CATEGORICAL.length];
      return `<text x="${padL - 8}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="9.5" font-weight="600" fill="${C.body}">${esc(r.label)}</text>` +
        `<rect x="${padL}" y="${(cy - rowH * 0.32).toFixed(1)}" width="${w.toFixed(1)}" height="${(rowH * 0.62).toFixed(1)}" fill="${color}" rx="3"/>` +
        `<text x="${(padL + w + 6).toFixed(1)}" y="${cy}" dominant-baseline="middle" font-size="9" font-weight="700" fill="${color}">${esc(fv(r.value))}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

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

  const cx = 92, cy = height / 2, rOuter = 72, rInner = 42;
  let acc = 0;
  const arcs = data
    .map((d, i) => {
      const color = d.color ?? CATEGORICAL[i % CATEGORICAL.length];
      const a0 = (acc / total) * Math.PI * 2 - Math.PI / 2;
      acc += d.value;
      const a1 = (acc / total) * Math.PI * 2 - Math.PI / 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const x0o = cx + rOuter * Math.cos(a0), y0o = cy + rOuter * Math.sin(a0);
      const x1o = cx + rOuter * Math.cos(a1), y1o = cy + rOuter * Math.sin(a1);
      const x0i = cx + rInner * Math.cos(a1), y0i = cy + rInner * Math.sin(a1);
      const x1i = cx + rInner * Math.cos(a0), y1i = cy + rInner * Math.sin(a0);
      return `<path d="M${x0o.toFixed(1)},${y0o.toFixed(1)} A${rOuter},${rOuter} 0 ${large} 1 ${x1o.toFixed(1)},${y1o.toFixed(1)} L${x0i.toFixed(1)},${y0i.toFixed(1)} A${rInner},${rInner} 0 ${large} 0 ${x1i.toFixed(1)},${y1i.toFixed(1)} Z" fill="${color}"/>`;
    })
    .join('');

  const center = opts.centerLabel
    ? `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="15" font-weight="800" fill="${C.ink}">${esc(opts.centerLabel)}</text>` +
      `<text x="${cx}" y="${cy + 11}" text-anchor="middle" font-size="8" fill="${C.subtle}">total</text>`
    : `<text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="15" font-weight="800" fill="${C.ink}">${esc(fv(total))}</text>`;

  const legendX = 184;
  const legend = data
    .map((d, i) => {
      const color = d.color ?? CATEGORICAL[i % CATEGORICAL.length];
      const ly = 22 + i * 18;
      const pct = ((d.value / total) * 100).toFixed(1);
      return `<rect x="${legendX}" y="${ly - 7}" width="9" height="9" rx="2" fill="${color}"/>` +
        `<text x="${legendX + 14}" y="${ly}" dominant-baseline="middle" font-size="9.5" fill="${C.body}">${esc(d.label)}</text>` +
        `<text x="${width - 6}" y="${ly}" text-anchor="end" dominant-baseline="middle" font-size="9.5" font-weight="700" fill="${color}">${esc(fv(d.value))} · ${pct}%</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${arcs}${center}${legend}</svg>`;
}

/**
 * 5×5 risk matrix (probability × impact) with the risk count per cell.
 * `cells[probIdx][impactIdx]` = count; probIdx/impactIdx are 0..4 (low→high).
 */
export function svgRiskMatrix(
  cells: number[][],
  opts: { width?: number; probLabels?: string[]; impactLabels?: string[] },
): string {
  const probLabels = opts.probLabels ?? ['Muito baixa', 'Baixa', 'Média', 'Alta', 'Muito alta'];
  const impactLabels = opts.impactLabels ?? ['Insignif.', 'Baixo', 'Moderado', 'Alto', 'Severo'];
  const width = opts.width ?? 420;
  const padL = 84, padB = 40, padT = 6, padR = 8;
  const grid = width - padL - padR;
  const cell = grid / 5;
  const height = padT + cell * 5 + padB;

  // Risk colour by severity score (prob+impact). Green → amber → red.
  const cellColor = (p: number, im: number): string => {
    const score = p + im; // 0..8
    if (score >= 6) return '#FEE2E2';
    if (score >= 4) return '#FEF3C7';
    if (score >= 2) return '#ECFDF5';
    return '#F0FDF4';
  };
  const textColor = (p: number, im: number): string => {
    const score = p + im;
    if (score >= 6) return C.critical;
    if (score >= 4) return C.warning;
    return C.success;
  };

  let rects = '';
  for (let pRow = 0; pRow < 5; pRow++) {
    // top row = highest probability (index 4)
    const p = 4 - pRow;
    for (let im = 0; im < 5; im++) {
      const x = padL + im * cell;
      const y = padT + pRow * cell;
      const count = cells[p]?.[im] ?? 0;
      rects += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell.toFixed(1)}" height="${cell.toFixed(1)}" fill="${cellColor(p, im)}" stroke="#fff" stroke-width="2"/>`;
      rects += `<text x="${(x + cell / 2).toFixed(1)}" y="${(y + cell / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="800" fill="${count ? textColor(p, im) : '#CBD5E1'}">${count || ''}</text>`;
    }
  }

  let axisLabels = '';
  for (let pRow = 0; pRow < 5; pRow++) {
    const p = 4 - pRow;
    const y = padT + pRow * cell + cell / 2;
    axisLabels += `<text x="${padL - 8}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="8" fill="${C.muted}">${esc(probLabels[p])}</text>`;
  }
  for (let im = 0; im < 5; im++) {
    const x = padL + im * cell + cell / 2;
    axisLabels += `<text x="${x.toFixed(1)}" y="${(padT + cell * 5 + 14).toFixed(1)}" text-anchor="middle" font-size="8" fill="${C.muted}">${esc(impactLabels[im])}</text>`;
  }
  axisLabels += `<text x="${(padL + grid / 2).toFixed(1)}" y="${(height - 4).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${C.subtle}">IMPACTO →</text>`;
  axisLabels += `<text x="12" y="${(padT + cell * 2.5).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${C.subtle}" transform="rotate(-90 12 ${(padT + cell * 2.5).toFixed(1)})">PROBABILIDADE →</text>`;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${rects}${axisLabels}</svg>`;
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
  const barH = 26, padX = 4, barY = 6;
  const plotW = width - padX * 2;

  let acc = 0;
  const segs = data
    .map((d, i) => {
      const color = d.color ?? CATEGORICAL[i % CATEGORICAL.length];
      const x = padX + (acc / total) * plotW;
      const w = (d.value / total) * plotW;
      acc += d.value;
      const pct = (d.value / total) * 100;
      const label = pct >= 9
        ? `<text x="${(x + w / 2).toFixed(1)}" y="${(barY + barH / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9.5" font-weight="800" fill="#fff">${pct.toFixed(0)}%</text>`
        : '';
      return `<rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(0.5, w).toFixed(1)}" height="${barH}" fill="${color}"/>${label}`;
    })
    .join('');

  const legendY = barY + barH + 18;
  const legend = data
    .map((d, i) => {
      const color = d.color ?? CATEGORICAL[i % CATEGORICAL.length];
      const lx = padX + i * (plotW / Math.max(1, data.length));
      return `<rect x="${lx.toFixed(1)}" y="${legendY - 8}" width="9" height="9" rx="2" fill="${color}"/>` +
        `<text x="${(lx + 14).toFixed(1)}" y="${legendY}" dominant-baseline="middle" font-size="9.5" fill="${C.body}">${esc(d.label)}: <tspan font-weight="700">${esc(fv(d.value))}</tspan></text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${legendY + 10}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${segs}${legend}</svg>`;
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
