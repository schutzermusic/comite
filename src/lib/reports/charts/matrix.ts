/**
 * Grid/temporal print charts: 5×5 risk matrix, generic heatmap grid and the
 * 12-month timeline strip with dated markers (renewals, deadlines, events).
 */

import { esc } from '../report-formatters';
import { C, lighten } from '../report-theme';
import { emptyChart } from './core';

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
      rects += `<text x="${(x + cell / 2).toFixed(1)}" y="${(y + cell / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="700" fill="${count ? textColor(p, im) : '#CBD5E1'}">${count || ''}</text>`;
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

/**
 * Generic heatmap grid (rows × cols) with per-cell counts. Cell intensity
 * scales with value relative to the grid max; zero cells stay neutral.
 */
export function svgHeatmapGrid(
  rowLabels: string[],
  colLabels: string[],
  values: number[][],
  opts: { width?: number; color?: string; labelW?: number; cellH?: number; title?: { rows?: string; cols?: string } } = {},
): string {
  if (!rowLabels.length || !colLabels.length) return emptyChart(opts.width ?? 420, 120);
  const width = opts.width ?? 420;
  const color = opts.color ?? C.primary;
  const padL = opts.labelW ?? 110, padT = 20, padR = 8;
  const cellH = opts.cellH ?? 26;
  const gridW = width - padL - padR;
  const cellW = gridW / colLabels.length;
  const height = padT + rowLabels.length * cellH + 20;
  const max = Math.max(1, ...values.flatMap((r) => r).filter((v) => v != null));

  const shade = (v: number): string => {
    if (!v) return '#F8FAFC';
    const t = Math.min(1, v / max);
    // interpolate light→base of the accent color via opacity band
    return `${color}${Math.round(18 + t * 200).toString(16).padStart(2, '0').toUpperCase()}`;
  };

  let cellsEls = '';
  rowLabels.forEach((rl, ri) => {
    const y = padT + ri * cellH;
    cellsEls += `<text x="${padL - 8}" y="${(y + cellH / 2).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="8.5" font-weight="600" fill="${C.body}">${esc(rl)}</text>`;
    colLabels.forEach((_, ci) => {
      const v = values[ri]?.[ci] ?? 0;
      const x = padL + ci * cellW;
      const fg = v && v / max > 0.55 ? '#fff' : v ? C.ink : '#CBD5E1';
      cellsEls += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellW.toFixed(1)}" height="${cellH}" fill="${shade(v)}" stroke="#fff" stroke-width="1.5" rx="2"/>`;
      cellsEls += `<text x="${(x + cellW / 2).toFixed(1)}" y="${(y + cellH / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9.5" font-weight="700" fill="${fg}">${v || ''}</text>`;
    });
  });

  const colHeads = colLabels
    .map((cl, ci) => `<text x="${(padL + ci * cellW + cellW / 2).toFixed(1)}" y="${padT - 7}" text-anchor="middle" font-size="7.5" font-weight="700" fill="${C.muted}" letter-spacing="0.04em">${esc(cl.toUpperCase())}</text>`)
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${colHeads}${cellsEls}</svg>`;
}

export interface TimelineMarker {
  /** 0-based month slot (0 = first month of the strip). */
  monthIdx: number;
  label: string;
  color: string;
  /** Optional value under the label (e.g. contract value). */
  value?: string;
}

/**
 * Horizontal 12-month timeline strip with month cells (count badges) and up to
 * ~8 dated markers laid out on alternating lanes below the band.
 */
export function svgTimelineStrip(
  months: string[],
  markers: TimelineMarker[],
  opts: { width?: number; counts?: number[]; accent?: string } = {},
): string {
  if (!months.length) return emptyChart(opts.width ?? 560, 90);
  const width = opts.width ?? 560;
  const accent = opts.accent ?? C.primary;
  const padL = 10, padR = 10, bandY = 18, bandH = 30;
  const plotW = width - padL - padR;
  const cellW = plotW / months.length;
  // Sort by month so lane cycling separates neighbours (labels never collide).
  const visible = markers
    .filter((m) => m.monthIdx >= 0 && m.monthIdx < months.length)
    .slice(0, 9)
    .sort((a, b) => a.monthIdx - b.monthIdx);
  const lanes = visible.length ? Math.min(3, visible.length) : 0;
  const height = bandY + bandH + 14 + lanes * 20 + 6;
  const counts = opts.counts ?? [];
  const maxCount = Math.max(1, ...counts);

  const cellsEls = months
    .map((m, i) => {
      const x = padL + i * cellW;
      const count = counts[i] ?? 0;
      const t = count / maxCount;
      const fill = count ? `${accent}${Math.round(20 + t * 190).toString(16).padStart(2, '0').toUpperCase()}` : '#F8FAFC';
      const fg = count && t > 0.55 ? '#fff' : count ? C.ink : '#CBD5E1';
      return `<rect x="${x.toFixed(1)}" y="${bandY}" width="${(cellW - 2).toFixed(1)}" height="${bandH}" fill="${fill}" rx="4" stroke="${lighten(accent, 0.5)}" stroke-width="0.6"/>` +
        (count ? `<text x="${(x + cellW / 2 - 1).toFixed(1)}" y="${bandY + bandH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="${fg}">${count}</text>` : '') +
        `<text x="${(x + cellW / 2 - 1).toFixed(1)}" y="${bandY - 6}" text-anchor="middle" font-size="7.5" font-weight="700" fill="${C.muted}">${esc(m.toUpperCase())}</text>`;
    })
    .join('');

  const markerEls = visible
    .map((m, i) => {
      const x = padL + m.monthIdx * cellW + cellW / 2 - 1;
      const lane = i % lanes;
      const yLine = bandY + bandH;
      const yDot = yLine + 8 + lane * 20;
      const anchor = x < width * 0.12 ? 'start' : x > width * 0.88 ? 'end' : 'middle';
      return `<line x1="${x.toFixed(1)}" y1="${yLine}" x2="${x.toFixed(1)}" y2="${yDot - 3}" stroke="${m.color}" stroke-width="1" stroke-dasharray="2 2"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${yDot}" r="2.6" fill="${m.color}" stroke="#fff" stroke-width="1"/>` +
        `<text x="${x.toFixed(1)}" y="${yDot + 9}" text-anchor="${anchor}" font-size="7.5" font-weight="700" fill="${m.color}">${esc(m.label)}${m.value ? ` · ${esc(m.value)}` : ''}</text>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${cellsEls}${markerEls}</svg>`;
}
