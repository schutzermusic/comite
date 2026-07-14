/**
 * Line-family print charts: multi-series line (with optional gradient area
 * fills — S-curves), area-chart convenience wrapper and mini sparkline.
 */

import { compactBRL, esc, periodLabel } from '../report-formatters';
import { C, lighten } from '../report-theme';
import { chartFrame, chartUid, emptyChart, gridLine, niceTicks, type ChartMarker, type LineSeries, type ValueFmt } from './core';

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
    .map((t) => gridLine(padL, yAt(t), padL + plotW) +
      `<text x="${padL - 8}" y="${yAt(t).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="${C.subtle}">${esc(fv(t))}</text>`)
    .join('');

  const zeroLine = min < 0 && max > 0
    ? `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${padL + plotW}" y2="${yAt(0).toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
    : '';

  const labelStep = Math.max(1, Math.ceil(n / 9));
  // Last label always shows; the stepped label right before it is dropped when
  // adjacent so the two never collide.
  const showLabel = (i: number) => i === n - 1 || (i % labelStep === 0 && n - 1 - i >= labelStep);
  const xLabels = periods
    .map((p, i) => showLabel(i)
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

  // 2.5D: gradient area fills under `area` series + soft shadow on strokes.
  const uid = chartUid();
  const areaSeries = series.filter((s) => s.area);
  const areaDefs = areaSeries
    .map((s, i) => `<linearGradient id="${uid}-a${i}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${s.color}" stop-opacity="0.22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0.02"/></linearGradient>`)
    .join('');
  const strokeShadow = `<filter id="${uid}-ls" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="1" stdDeviation="0.9" flood-color="#0F172A" flood-opacity="0.15"/></filter>`;
  const glowFilter = `<filter id="${uid}-gl" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feGaussianBlur stdDeviation="2.2"/></filter>`;
  const defs = `<defs>${areaDefs}${strokeShadow}${glowFilter}</defs>`;
  const yBase = yAt(Math.max(min, 0));

  const areas = areaSeries
    .map((s, ai) => {
      const pts: string[] = [];
      s.values.forEach((v, i) => {
        if (v != null) pts.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
      });
      if (pts.length < 2) return '';
      const firstX = xAt(s.values.findIndex((v) => v != null)).toFixed(1);
      let lastIdx = -1;
      for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) { lastIdx = i; break; }
      const lastX = xAt(lastIdx).toFixed(1);
      return `<polygon points="${firstX},${yBase.toFixed(1)} ${pts.join(' ')} ${lastX},${yBase.toFixed(1)}" fill="url(#${uid}-a${ai})"/>`;
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
      // HUD glow: wide blurred halo under the crisp stroke (skipped for dashed
      // reference series so they stay visually secondary).
      const glow = s.dashed ? '' : `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.22" filter="url(#${uid}-gl)"/>`;
      return `${glow}<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"${dash} filter="url(#${uid}-ls)"/>`;
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
      .map((e) => `<circle cx="${e.x.toFixed(1)}" cy="${yAt(e.value).toFixed(1)}" r="4.4" fill="${e.color}" opacity="0.18"/>` +
        `<circle cx="${e.x.toFixed(1)}" cy="${yAt(e.value).toFixed(1)}" r="2.6" fill="${e.color}" stroke="#fff" stroke-width="1.1"/>` +
        `<text x="${(padL + plotW + 8).toFixed(1)}" y="${e.y.toFixed(1)}" font-size="9" font-weight="700" dominant-baseline="middle" fill="${e.color}">${esc(fv(e.value))}</text>`)
      .join('');
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${defs}${chartFrame(width, height, padL, padT, plotW, plotH)}${gridLines}${zeroLine}${areas}${markerEls}${paths}${endLabels}${xLabels}</svg>`;
}

/**
 * Area chart (S-curve / cumulative trends): line chart with gradient area
 * fill enabled for every series.
 */
export function svgAreaChart(
  periods: string[],
  series: LineSeries[],
  opts: { width: number; height: number; markers?: ChartMarker[]; fmtValue?: ValueFmt; xLabel?: (s: string) => string },
): string {
  return svgLineChart(periods, series.map((s) => ({ ...s, area: s.area ?? !s.dashed })), opts);
}

/**
 * Mini sparkline (KPI card / table inline): single series, no axes, gradient
 * area + end dot with the last value.
 */
export function svgSparkline(
  values: (number | null)[],
  opts: { width?: number; height?: number; color?: string; fmtValue?: ValueFmt; showLastValue?: boolean },
): string {
  const width = opts.width ?? 120;
  const height = opts.height ?? 30;
  const color = opts.color ?? C.primary;
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return '';
  const showLast = opts.showLastValue ?? true;
  const fv = opts.fmtValue ?? compactBRL;
  const padR = showLast ? 44 : 6;
  const padL = 3, padY = 4;
  const plotW = width - padL - padR;
  const plotH = height - padY * 2;
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) { min -= 1; max += 1; }
  const n = values.length;
  const xAt = (i: number) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => padY + (1 - (v - min) / (max - min)) * plotH;

  const uid = chartUid();
  const pts: string[] = [];
  let d = '';
  let pen = false;
  let lastIdx = -1;
  values.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)} `;
    pts.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    pen = true;
    lastIdx = i;
  });
  const firstX = xAt(values.findIndex((v) => v != null)).toFixed(1);
  const lastV = values[lastIdx] as number;
  const area = `<polygon points="${firstX},${(padY + plotH).toFixed(1)} ${pts.join(' ')} ${xAt(lastIdx).toFixed(1)},${(padY + plotH).toFixed(1)}" fill="url(#${uid}-sa)"/>`;
  const dot = `<circle cx="${xAt(lastIdx).toFixed(1)}" cy="${yAt(lastV).toFixed(1)}" r="2.2" fill="${color}" stroke="#fff" stroke-width="1"/>`;
  const lastLabel = showLast
    ? `<text x="${(xAt(lastIdx) + 6).toFixed(1)}" y="${yAt(lastV).toFixed(1)}" dominant-baseline="middle" font-size="8.5" font-weight="700" fill="${color}">${esc(fv(lastV))}</text>`
    : '';

  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="${uid}-sa" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${lighten(color, 0.1)}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>` +
    `${area}<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>${dot}${lastLabel}</svg>`;
}
