/**
 * Project finance / investor report → print-ready HTML (browser print → PDF).
 *
 * Premium investor-grade layout: centered Insight Energy logo, glass-inspired
 * light print theme, detailed static charts (callouts, end-of-series labels,
 * cut-off / break-even / peak markers) and compact supporting tables per chart.
 *
 * IMPORTANT — single source of truth:
 *   All monetary numbers come from the SAME investor view-model used by the
 *   on-screen Financeiro tab (`computeInvestorView`, `computeEventStats`,
 *   `computeSensitivityScenarios` from FinanceInvestorCockpit) and from the
 *   ledger-derived `ProjectFinanceView`. This module performs NO financial
 *   calculation of its own — only formatting, selection and layout for print.
 *
 * Charts are rendered as inline SVG (vector — crisp at any zoom/print DPI)
 * recreated from the same series data, never screenshots of the dark app UI.
 *
 * Pagination: CSS `counter(pages)` is not supported by Chromium print (it
 * renders "0"), so each report page is an explicit section and the footer
 * "Página N de TOTAL" is computed at build time. Tables are capped so each
 * section fits its physical page.
 */

import type { BillingEvent, ProjectV2 } from '@/lib/types/project-v2';
import type { ProjectFinanceView } from '@/lib/finance/selectors/project-finance';
import {
  computeInvestorView,
  computeEventStats,
  computeSensitivityScenarios,
  type InvestorView,
  type SensitivityRow,
} from '@/components/projects/FinanceInvestorCockpit';

// ── Formatting helpers (presentation only — no business rules) ──────

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function periodLabel(period?: string | null): string {
  if (!period) return '—';
  const [y, m] = period.split('-');
  return `${MONTHS_PT[parseInt(m, 10) - 1] || m}/${y?.slice(2) ?? ''}`;
}

const BRL = (n: number): string =>
  (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function compactBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n || 0);
}

const fmtPct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? 'dados insuf.' : `${v.toFixed(1)}%`;

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

const centsToReais = (cents?: number | null): number => (cents ?? 0) / 100;
const curveCentsToReais = (value: number | null | undefined): number | null =>
  value == null || Number.isNaN(value) ? null : value / 100;

function statusLabelPt(status: string): string {
  const map: Record<string, string> = {
    planned: 'Previsto',
    billed: 'Faturado',
    partial: 'Parcial',
    delayed: 'Atrasado',
    cancelled: 'Cancelado',
  };
  return map[status] ?? status;
}

function severityLabel(s: 'success' | 'warning' | 'critical' | 'neutral'): string {
  const map: Record<string, string> = { success: 'Baixo', warning: 'Atenção', critical: 'Crítico', neutral: 'Dados insuf.' };
  return map[s] ?? s;
}

// ── Print palette (light, brand-aligned: Insight orange + green) ────

const C = {
  ink: '#0F172A',
  body: '#1E293B',
  muted: '#475569',
  subtle: '#64748B',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  // Brand (from the Insight Energy wordmark)
  brandOrange: '#E87722',
  brandGreen: '#00984A',
  // Chart family (print-contrast variants of the cockpit palette)
  primary: '#0F766E',
  success: '#047857',
  successSoft: '#059669',
  info: '#1D4ED8',
  cyan: '#0E7490',
  cost: '#C2410C',
  costSoft: '#A16207',
  warning: '#B45309',
  critical: '#B91C1C',
  purple: '#7C3AED',
  grid: '#EDF2F7',
  panel: '#FBFDFE',
};

function sevColor(s: 'success' | 'warning' | 'critical' | 'neutral'): string {
  if (s === 'success') return C.success;
  if (s === 'warning') return C.warning;
  if (s === 'critical') return C.critical;
  return C.subtle;
}

// ── Inline SVG chart primitives (vector, print-safe) ────────────────

interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  /** Draw the last non-null value as a label at the right edge. */
  endLabel?: boolean;
}

interface ChartMarker {
  index: number;
  label: string;
  color: string;
  /** Optional value rendered under the marker label. */
  value?: string;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

function chartFrame(width: number, height: number, padL: number, padT: number, plotW: number, plotH: number): string {
  return `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="${C.panel}" rx="4"/>`;
}

function svgLineChart(
  periods: string[],
  series: LineSeries[],
  opts: { width: number; height: number; markers?: ChartMarker[] },
): string {
  const { width, height, markers = [] } = opts;
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
        `<text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="${C.subtle}">${esc(compactBRL(t))}</text>`;
    })
    .join('');

  const zeroLine = min < 0 && max > 0
    ? `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${padL + plotW}" y2="${yAt(0).toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
    : '';

  const labelStep = Math.max(1, Math.ceil(n / 9));
  const xLabels = periods
    .map((p, i) => (i % labelStep === 0 || i === n - 1)
      ? `<text x="${xAt(i).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="9.5" fill="${C.subtle}">${esc(periodLabel(p))}</text>`
      : '')
    .join('');

  // One label row per marker so close markers (e.g. corte/pico) never collide.
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

  // End-of-series value labels with simple vertical collision avoidance.
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
    // nudge labels apart (min 12px)
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].y - entries[i - 1].y < 12) entries[i].y = entries[i - 1].y + 12;
    }
    endLabels = entries
      .map((e) => `<circle cx="${e.x.toFixed(1)}" cy="${yAt(e.value).toFixed(1)}" r="2.4" fill="${e.color}"/>` +
        `<text x="${(padL + plotW + 8).toFixed(1)}" y="${e.y.toFixed(1)}" font-size="9" font-weight="700" dominant-baseline="middle" fill="${e.color}">${esc(compactBRL(e.value))}</text>`)
      .join('');
  }

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${chartFrame(width, height, padL, padT, plotW, plotH)}${gridLines}${zeroLine}${markerEls}${paths}${endLabels}${xLabels}</svg>`;
}

interface BarSeries { name: string; color: string; values: number[]; }

function svgGroupedBarChart(
  periods: string[],
  series: BarSeries[],
  opts: {
    width: number;
    height: number;
    highlightNegative?: (number | null)[];
    /** Line overlay (e.g. saldo líquido mensal). */
    line?: { name: string; color: string; values: (number | null)[] };
    /** Bar value labels: indices (per series) worth calling out. */
    barLabels?: { seriesIdx: number; index: number }[];
    /** Line point labels (e.g. most negative / most positive month). */
    lineLabels?: { index: number; text: string }[];
  },
): string {
  const { width, height, highlightNegative, line, barLabels = [], lineLabels = [] } = opts;
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
  // headroom for bar value labels
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
        `<text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="${C.subtle}">${esc(compactBRL(t))}</text>`;
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
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${s.color}">${esc(compactBRL(v))}</text>`;
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
      ? `<text x="${xCenter(i).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="9.5" fill="${C.subtle}">${esc(periodLabel(p))}</text>`
      : '')
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${chartFrame(width, height, padL, padT, plotW, plotH)}${gridLines}${highlights}${bars}${zeroLine}${lineEls}${barLabelEls}${xLabels}</svg>`;
}

/** Horizontal scenario bars with value + margin labels (supports negatives). */
function svgScenarioBars(
  rows: { label: string; value: number; margin: number | null; color: string }[],
  opts: { width: number; rowH?: number },
): string {
  const rowH = opts.rowH ?? 32;
  const width = opts.width;
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
        `<text x="${labelX.toFixed(1)}" y="${(cy - 5).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="9.5" font-weight="700" fill="${r.color}">${sign}${esc(BRL(r.value))}</text>` +
        `<text x="${labelX.toFixed(1)}" y="${(cy + 7).toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle" font-size="8.5" fill="${C.subtle}">margem ${esc(fmtPct(r.margin))}</text>`;
    })
    .join('');

  const axis = `<line x1="${x0.toFixed(1)}" y1="2" x2="${x0.toFixed(1)}" y2="${height - 2}" stroke="${C.borderStrong}" stroke-width="1.2"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${axis}${bars}</svg>`;
}

/** Waterfall bridge (Caixa → Resultado) with signed value labels. */
function svgWaterfall(iv: InvestorView, opts: { width: number; height: number }): string {
  const { width, height } = opts;
  const padL = 66, padR = 18, padT = 30, padB = 46;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const start = iv.insightCashRevenue;
  const afterDisb = start - iv.insightDisbursement;
  const afterRisk = afterDisb - iv.riskExposure;
  const finalResult = iv.netResult - iv.riskExposure;

  const steps = [
    { name: 'Caixa Insight previsto', from: 0, to: start, color: C.primary, total: true, signed: BRL(start) },
    { name: 'Desembolso total', from: start, to: afterDisb, color: C.cost, total: false, signed: `−${BRL(iv.insightDisbursement)}` },
    { name: 'Contingências / riscos', from: afterDisb, to: afterRisk, color: iv.riskExposure ? C.critical : C.subtle, total: false, signed: iv.riskExposure ? `−${BRL(iv.riskExposure)}` : 'não informado' },
    { name: 'Resultado Insight', from: 0, to: finalResult, color: finalResult >= 0 ? C.success : C.critical, total: true, signed: `${finalResult > 0 ? '+' : ''}${BRL(finalResult)}` },
  ];

  const all = steps.flatMap((s) => [s.from, s.to]);
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (min === max) max = min + 1;
  max += (max - min) * 0.06;
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;
  const colW = plotW / steps.length;
  const barW = colW * 0.46;

  const ticks = niceTicks(min, max, 4);
  const gridLines = ticks
    .map((t) => {
      const y = yAt(t).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9.5" fill="${C.subtle}">${esc(compactBRL(t))}</text>`;
    })
    .join('');

  // connector lines between cumulative levels
  const connectors = steps
    .slice(0, -1)
    .map((s, i) => {
      const xEnd = padL + i * colW + (colW + barW) / 2;
      const xNext = padL + (i + 1) * colW + (colW - barW) / 2;
      const y = yAt(s.total ? s.to : s.to).toFixed(1);
      return `<line x1="${xEnd.toFixed(1)}" y1="${y}" x2="${xNext.toFixed(1)}" y2="${y}" stroke="${C.borderStrong}" stroke-width="1" stroke-dasharray="3 3"/>`;
    })
    .join('');

  const bars = steps
    .map((s, i) => {
      const x = padL + i * colW + (colW - barW) / 2;
      const top = Math.min(yAt(s.from), yAt(s.to));
      const h = Math.max(1.5, Math.abs(yAt(s.from) - yAt(s.to)));
      const cx = x + barW / 2;
      return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}" rx="3"/>` +
        `<text x="${cx.toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${s.color}">${esc(s.signed)}</text>` +
        `<text x="${cx.toFixed(1)}" y="${(height - 28).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="${C.body}">${esc(s.name)}</text>` +
        (s.total ? '' : `<text x="${cx.toFixed(1)}" y="${(height - 17).toFixed(1)}" text-anchor="middle" font-size="8" fill="${C.subtle}">acumulado ${esc(compactBRL(s.to))}</text>`);
    })
    .join('');

  const zeroLine = min < 0
    ? `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${padL + plotW}" y2="${yAt(0).toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
    : '';

  const note = iv.directPassThrough > 0
    ? `<text x="${padL}" y="${height - 4}" font-size="8.5" fill="${C.subtle}">Faturamento direto a terceiros (repasse, fora do caixa Insight): ${esc(BRL(iv.directPassThrough))}</text>`
    : '';

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${chartFrame(width, height, padL, padT, plotW, plotH)}${gridLines}${zeroLine}${connectors}${bars}${note}</svg>`;
}

function emptyChart(width: number, height: number): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#F8FAFC" rx="8"/>` +
    `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="${C.subtle}">Dados insuficientes para este gráfico</text></svg>`;
}

function legend(items: { name: string; color: string; dashed?: boolean }[]): string {
  return `<div class="legend">${items
    .map((i) => `<span class="lg"><span class="sw" style="background:${i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 4px, transparent 4px 7px)` : i.color}"></span>${esc(i.name)}</span>`)
    .join('')}</div>`;
}

/** Row of key-value callout chips above a chart. */
function callouts(items: { label: string; value: string; color: string }[]): string {
  return `<div class="chips">${items
    .map((c) => `<span class="chip" style="border-color:${c.color}40;background:${c.color}0D"><span class="dot" style="background:${c.color}"></span><span class="chip-l">${esc(c.label)}</span><span class="chip-v" style="color:${c.color}">${esc(c.value)}</span></span>`)
    .join('')}</div>`;
}

function sectionTitle(title: string, subtitle?: string): string {
  return `<div class="sec-head"><div class="sec-rule"></div><div><h2>${esc(title)}</h2>${subtitle ? `<p class="sec-sub">${esc(subtitle)}</p>` : ''}</div></div>`;
}

// ── Report section selector ─────────────────────────────────────────

/** Which sections to include in the generated PDF report. */
export type ReportSections = 'financeiro' | 'controle-interno' | 'all';

const SECTION_LABEL: Record<ReportSections, string> = {
  'financeiro': 'Relatório Financeiro',
  'controle-interno': 'Controle Interno',
  'all': 'Relatório Completo',
};

// ── Payload ─────────────────────────────────────────────────────────

export interface ProjectFinanceReportPayload {
  project: ProjectV2;
  ledgerView?: ProjectFinanceView;
  cutoffPeriod?: string;
  brandName?: string;
  dataSourceNote?: string;
  generatedBy?: string;
  /** Absolute or root-relative URL of the brand logo (PNG/SVG). */
  logoUrl?: string;
  /** Which sections to include. Defaults to 'all'. */
  sections?: ReportSections;
}

export function buildProjectFinanceFileName(project: ProjectV2, date = new Date(), sections: ReportSections = 'all'): string {
  const code = (project.codigo || project.id || 'projeto')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const ymd = date.toISOString().slice(0, 10);
  const suffix = sections === 'controle-interno' ? '-controle-interno' : sections === 'financeiro' ? '-financeiro' : '';
  return `project-finance-report-${code}${suffix}-${ymd}`;
}

// ── KPI / warning helpers (read from the shared iv — no new math) ──

interface KpiCard { label: string; value: string; color?: string; helper?: string; missing?: boolean; chip?: { label: string; cls: 'ok' | 'warn' | 'crit' } }

function buildKpis(iv: InvestorView): KpiCard[] {
  return [
    { label: 'Valor do contrato', value: BRL(iv.contractTotal), color: C.primary, helper: 'teto contratado' },
    { label: 'Caixa Insight previsto', value: BRL(iv.insightCashRevenue), color: C.success, helper: 'entra no caixa da Insight' },
    { label: 'Receita faturada', value: BRL(iv.billed), color: C.successSoft, helper: iv.contractTotal > 0 ? `${((iv.billed / iv.contractTotal) * 100).toFixed(0)}% do contrato` : 'sem contrato' },
    { label: 'Receita a faturar', value: BRL(iv.toBill), color: C.warning, helper: `${fmtPct(iv.pendingRevenuePct)} do contrato`, chip: iv.billingRisk === 'critical' ? { label: 'crítico', cls: 'crit' } : iv.billingRisk === 'warning' ? { label: 'atenção', cls: 'warn' } : undefined },
    { label: 'Desembolso previsto', value: BRL(iv.insightDisbursement), color: C.cost, helper: 'Curva S + projeção', chip: iv.insightDisbursement > iv.insightCashRevenue ? { label: 'crítico', cls: 'crit' } : undefined },
    { label: 'Resultado projetado', value: BRL(iv.netResult), color: iv.netResult >= 0 ? C.success : C.critical, helper: 'caixa Insight − desembolso' },
    { label: 'Margem estimada', value: fmtPct(iv.marginPct), missing: iv.marginPct == null, color: C.purple, helper: 'sobre caixa Insight', chip: iv.marginPct != null && iv.marginPct < 8 ? { label: iv.marginPct < 0 ? 'crítico' : 'atenção', cls: iv.marginPct < 0 ? 'crit' : 'warn' } : undefined },
    { label: 'Pico de necessidade de caixa', value: iv.peakGap ? BRL(iv.peakGap) : 'sem gap', color: iv.peakGap ? C.critical : C.success, helper: iv.peakGap ? `em ${periodLabel(iv.peakGapPeriod)}` : 'sem saldo negativo', chip: iv.peakGap > 0 ? { label: 'cash gap', cls: 'crit' } : undefined },
    { label: 'Break-even', value: iv.breakEvenPeriod ? periodLabel(iv.breakEvenPeriod) : 'não projetado', missing: !iv.breakEvenPeriod, color: C.info, helper: 'lucro acumulado sustentado' },
    { label: 'Risco financeiro', value: severityLabel(iv.financialRisk), color: sevColor(iv.financialRisk), helper: iv.openFinancialRisks.length ? `${iv.openFinancialRisks.length} risco(s) em aberto` : 'sem riscos abertos' },
  ];
}

/** Deterministic investor narrative — pure string composition over the shared iv. */
function buildNarrative(iv: InvestorView): string[] {
  const parts: string[] = [];
  parts.push(`Projeto com contrato de ${compactBRL(iv.contractTotal)}`);
  parts.push(`resultado projetado de ${compactBRL(iv.netResult)} (margem ${fmtPct(iv.marginPct)})`);
  if (iv.peakGap > 0) parts.push(`pico de necessidade de caixa de ${compactBRL(iv.peakGap)} em ${periodLabel(iv.peakGapPeriod)}`);
  parts.push(iv.breakEvenPeriod ? `break-even previsto em ${periodLabel(iv.breakEvenPeriod)}` : 'break-even ainda não projetado');
  const s1 = `${parts.join(', ')}.`;

  const warnings: string[] = [];
  if (iv.delayedEvents.length) warnings.push(`${iv.delayedEvents.length} evento(s) de faturamento atrasado(s)`);
  if (iv.disbursementRealized == null) warnings.push('dados insuficientes de desembolso realizado');
  if (iv.openFinancialRisks.length) warnings.push(`${iv.openFinancialRisks.length} risco(s) financeiro(s) em aberto${iv.riskExposure ? ` (exposição ${compactBRL(iv.riskExposure)})` : ''}`);
  const s2 = warnings.length ? `Atenção para ${warnings.join(', ')}.` : 'Sem alertas financeiros críticos no momento.';

  const s3 = iv.nextEvent
    ? `Próximo evento de faturamento: ${iv.nextEvent.title} — ${compactBRL(centsToReais(iv.nextEvent.amountPlannedCents))} em ${periodLabel(iv.nextEvent.datePlanned.slice(0, 7))}.`
    : 'Sem eventos de faturamento pendentes no eventograma.';

  return [s1, s2, s3];
}

function buildWarnings(project: ProjectV2, iv: InvestorView): string[] {
  const w: string[] = [];
  if (iv.disbursementRealized == null) w.push('Desembolso realizado não informado — a Curva S exibe apenas o previsto.');
  if (!iv.riskExposure) w.push('Contingências/riscos sem valor informado — o resultado projetado não considera contingências.');
  if (iv.delayedEvents.length) w.push(`${iv.delayedEvents.length} evento(s) de faturamento atrasado(s).`);
  if (!(project.billing_eventogram ?? []).length) w.push('Eventograma de faturamento vazio.');
  if (iv.openFinancialRisks.length) w.push(`${iv.openFinancialRisks.length} risco(s) financeiro(s) em aberto${iv.riskExposure ? ` (exposição ${BRL(iv.riskExposure)})` : ''}.`);
  return w;
}

// ── Key-row selection helpers (presentation-level filtering only) ──

function indexOfPeriod(periods: string[], period?: string | null): number {
  if (!period) return -1;
  return periods.indexOf(period);
}

/** Key months for the Curva S table: first, cut-off, peak, break-even, last. */
function selectKeyCurveIndices(iv: InvestorView, effectiveCutoff?: string): number[] {
  const periods = iv.curve.map((p) => p.period);
  const n = periods.length;
  if (!n) return [];
  const set = new Set<number>([0, n - 1]);
  const cut = indexOfPeriod(periods, effectiveCutoff);
  if (cut >= 0) set.add(cut);
  const be = indexOfPeriod(periods, iv.breakEvenPeriod);
  if (be >= 0) set.add(be);
  const peak = indexOfPeriod(periods, iv.peakGapPeriod);
  if (peak >= 0 && iv.peakGap > 0) set.add(peak);
  return Array.from(set).sort((a, b) => a - b);
}

/** Relevant months for the monthly-flow table (top pressure/revenue + cut-off window). */
function selectKeyMonthlyIndices(iv: InvestorView, effectiveCutoff?: string, cap = 12): number[] {
  const n = iv.curve.length;
  if (!n) return [];
  const byRevenue = iv.curve.map((p, i) => ({ i, v: p.receitaMensal })).sort((a, b) => b.v - a.v).slice(0, 3);
  const byCost = iv.curve.map((p, i) => ({ i, v: p.desembolsoMensal })).sort((a, b) => b.v - a.v).slice(0, 3);
  let minIdx = 0, maxIdx = 0;
  iv.curve.forEach((p, i) => {
    if (p.resultadoMensal < iv.curve[minIdx].resultadoMensal) minIdx = i;
    if (p.resultadoMensal > iv.curve[maxIdx].resultadoMensal) maxIdx = i;
  });
  const set = new Set<number>([...byRevenue.map((r) => r.i), ...byCost.map((r) => r.i), minIdx, maxIdx]);
  const cut = indexOfPeriod(iv.curve.map((p) => p.period), effectiveCutoff);
  if (cut >= 0) {
    for (let i = cut; i <= Math.min(n - 1, cut + 6); i++) set.add(i);
  }
  return Array.from(set).sort((a, b) => a - b).slice(0, cap);
}

interface EventGroup { title: string; cls: 'crit' | 'warn' | 'ok' | ''; events: BillingEvent[] }

/** Grouped, prioritized event selection: delayed → upcoming → largest → billed. */
function selectEventGroups(project: ProjectV2): EventGroup[] {
  const events = project.billing_eventogram ?? [];
  const todayIso = new Date().toISOString().slice(0, 10);

  const delayed = events
    .filter((e) => e.status === 'delayed')
    .sort((a, b) => a.datePlanned.localeCompare(b.datePlanned))
    .slice(0, 8);
  const upcoming = events
    .filter((e) => (e.status === 'planned' || e.status === 'partial') && e.datePlanned >= todayIso)
    .sort((a, b) => a.datePlanned.localeCompare(b.datePlanned))
    .slice(0, 6);
  const shown = new Set([...delayed, ...upcoming].map((e) => e.id));
  const largest = events
    .filter((e) => !shown.has(e.id) && e.status !== 'cancelled' && e.status !== 'billed')
    .sort((a, b) => b.amountPlannedCents - a.amountPlannedCents)
    .slice(0, 4);
  largest.forEach((e) => shown.add(e.id));
  const billed = events
    .filter((e) => (e.status === 'billed' || e.status === 'partial') && !shown.has(e.id))
    .sort((a, b) => b.amountPlannedCents - a.amountPlannedCents)
    .slice(0, 4);

  return [
    { title: 'Eventos atrasados', cls: 'crit', events: delayed },
    { title: 'Próximos eventos', cls: 'warn', events: upcoming },
    { title: 'Maiores eventos pendentes', cls: '', events: largest },
    { title: 'Faturados / parciais', cls: 'ok', events: billed },
  ].filter((g) => g.events.length > 0) as EventGroup[];
}

function delayLabel(e: BillingEvent): string {
  if (e.status !== 'delayed') return '—';
  const today = new Date();
  const planned = new Date(`${e.datePlanned}T00:00:00`);
  const days = Math.max(0, Math.floor((today.getTime() - planned.getTime()) / 86_400_000));
  return days > 0 ? `+${days}d` : '—';
}

// ── Section renderers ───────────────────────────────────────────────

function kpiCardHtml(k: KpiCard): string {
  return `<div class="kpi">
    <div class="bar" style="background:linear-gradient(90deg, transparent, ${k.color ?? C.ink}, transparent)"></div>
    <div class="kpi-l">${esc(k.label)}</div>
    <div class="kpi-v" style="color:${k.missing ? C.subtle : (k.color ?? C.ink)}">${k.missing ? 'dados insuficientes' : esc(k.value)}</div>
    <div class="kpi-foot">
      ${k.helper ? `<span class="kpi-h">${esc(k.helper)}</span>` : '<span></span>'}
      ${k.chip ? `<span class="pill ${k.chip.cls}">${esc(k.chip.label)}</span>` : ''}
    </div>
  </div>`;
}

function renderCurvaSPage(iv: InvestorView, effectiveCutoff?: string): string {
  const periods = iv.curve.map((p) => p.period);
  const last = iv.curve.at(-1);

  const chips = callouts([
    { label: 'Contrato total', value: compactBRL(iv.contractTotal), color: C.primary },
    { label: 'Receita acum. final', value: compactBRL(last?.receitaPrevista ?? 0), color: C.success },
    { label: 'Desembolso acum. final', value: compactBRL(last?.desembolsoTotal ?? 0), color: C.cost },
    { label: 'Resultado final projetado', value: compactBRL(iv.netResult), color: iv.netResult >= 0 ? C.success : C.critical },
    { label: 'Pico de caixa', value: iv.peakGap ? `${compactBRL(iv.peakGap)} (${periodLabel(iv.peakGapPeriod)})` : 'sem gap', color: iv.peakGap ? C.critical : C.success },
    { label: 'Break-even', value: iv.breakEvenPeriod ? periodLabel(iv.breakEvenPeriod) : 'não projetado', color: C.info },
  ]);

  if (!periods.length) {
    return chips + `<div class="chart">${emptyChart(1040, 330)}</div>`;
  }

  const series: LineSeries[] = [
    { name: 'Receita prevista acum.', color: C.primary, values: iv.curve.map((p) => p.receitaPrevista), endLabel: true },
    { name: 'Receita realizada acum.', color: C.successSoft, values: iv.curve.map((p) => p.receitaRealizada), endLabel: false },
    { name: 'Desembolso previsto acum.', color: C.cost, values: iv.curve.map((p) => p.desembolsoPrevisto), endLabel: true },
    { name: 'Desembolso realizado acum.', color: C.costSoft, values: iv.curve.map((p) => p.desembolsoRealizado), endLabel: false },
    { name: 'Projeção custos fixos', color: C.warning, dashed: true, values: iv.curve.map((p) => p.desembolsoProjetado), endLabel: false },
    { name: 'Saldo líquido acum.', color: C.info, values: iv.curve.map((p) => p.saldoLiquido), endLabel: true },
  ].filter((s) => s.values.some((v) => v != null));

  const markers: ChartMarker[] = [];
  const cutIdx = indexOfPeriod(periods, effectiveCutoff);
  if (cutIdx >= 0) markers.push({ index: cutIdx, label: 'CORTE', color: C.subtle, value: periodLabel(effectiveCutoff) });
  const beIdx = indexOfPeriod(periods, iv.breakEvenPeriod);
  if (beIdx >= 0) markers.push({ index: beIdx, label: 'BREAK-EVEN', color: C.success, value: periodLabel(iv.breakEvenPeriod) });
  const peakIdx = indexOfPeriod(periods, iv.peakGapPeriod);
  if (peakIdx >= 0 && iv.peakGap > 0) markers.push({ index: peakIdx, label: 'PICO CAIXA', color: C.critical, value: `−${compactBRL(iv.peakGap)}` });

  const chart = svgLineChart(periods, series, { width: 1040, height: 330, markers }) +
    legend(series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed })));

  // Key months supporting table
  const keyIdx = selectKeyCurveIndices(iv, effectiveCutoff);
  const tag = (i: number): string => {
    const tags: string[] = [];
    if (i === 0) tags.push('início');
    if (i === periods.length - 1) tags.push('final');
    if (i === cutIdx) tags.push('corte');
    if (i === beIdx) tags.push('break-even');
    if (i === peakIdx && iv.peakGap > 0) tags.push('pico de caixa');
    return tags.join(' · ');
  };
  const fmtCell = (v: number | null | undefined): string => (v == null ? '—' : BRL(v));
  const tableRows = keyIdx
    .map((i) => {
      const p = iv.curve[i];
      const neg = p.saldoLiquido < 0;
      return `<tr>
        <td><b>${esc(periodLabel(p.period))}</b> <span class="muted" style="font-size:8.5px">${esc(tag(i))}</span></td>
        <td class="num mono">${esc(fmtCell(p.receitaPrevista))}</td>
        <td class="num mono">${esc(fmtCell(p.receitaRealizada))}</td>
        <td class="num mono">${esc(fmtCell(p.desembolsoPrevisto))}</td>
        <td class="num mono">${esc(fmtCell(p.desembolsoRealizado))}</td>
        <td class="num mono" style="color:${neg ? C.critical : C.success};font-weight:700">${esc(fmtCell(p.saldoLiquido))}</td>
      </tr>`;
    })
    .join('');
  const table = `<table class="data compact">
    <thead><tr><th>Mês</th><th class="num">Receita prev. acum.</th><th class="num">Receita real. acum.</th><th class="num">Desemb. prev. acum.</th><th class="num">Desemb. real. acum.</th><th class="num">Saldo líquido acum.</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>`;

  return chips + `<div class="chart">${chart}</div><h3 style="margin-top:10px">Meses-chave</h3>` + table;
}

function renderMonthlyFlowPage(iv: InvestorView, effectiveCutoff?: string): string {
  const periods = iv.curve.map((p) => p.period);
  if (!periods.length) return `<div class="chart">${emptyChart(1040, 300)}</div>`;

  const bars: BarSeries[] = [
    { name: 'Receita mensal', color: C.successSoft, values: iv.curve.map((p) => p.receitaMensal) },
    { name: 'Desembolso mensal', color: C.cost, values: iv.curve.map((p) => p.desembolsoMensal) },
  ];
  const saldo = iv.curve.map((p) => p.resultadoMensal);

  // Extreme points (presentation selection)
  let topRevIdx = 0, topCostIdx = 0, minNetIdx = 0, maxNetIdx = 0;
  iv.curve.forEach((p, i) => {
    if (p.receitaMensal > iv.curve[topRevIdx].receitaMensal) topRevIdx = i;
    if (p.desembolsoMensal > iv.curve[topCostIdx].desembolsoMensal) topCostIdx = i;
    if (p.resultadoMensal < iv.curve[minNetIdx].resultadoMensal) minNetIdx = i;
    if (p.resultadoMensal > iv.curve[maxNetIdx].resultadoMensal) maxNetIdx = i;
  });

  const chips = callouts([
    { label: 'Maior receita', value: `${compactBRL(iv.curve[topRevIdx].receitaMensal)} (${periodLabel(periods[topRevIdx])})`, color: C.success },
    { label: 'Maior desembolso', value: `${compactBRL(iv.curve[topCostIdx].desembolsoMensal)} (${periodLabel(periods[topCostIdx])})`, color: C.cost },
    { label: 'Mês mais negativo', value: `${compactBRL(iv.curve[minNetIdx].resultadoMensal)} (${periodLabel(periods[minNetIdx])})`, color: C.critical },
    { label: 'Mês mais positivo', value: `${compactBRL(iv.curve[maxNetIdx].resultadoMensal)} (${periodLabel(periods[maxNetIdx])})`, color: C.successSoft },
    { label: 'Meses negativos', value: String(saldo.filter((v) => v < 0).length), color: C.warning },
  ]);

  const chart = svgGroupedBarChart(periods, bars, {
    width: 1040,
    height: 300,
    highlightNegative: saldo,
    line: { name: 'Saldo líquido mensal', color: C.info, values: saldo },
    barLabels: [
      { seriesIdx: 0, index: topRevIdx },
      { seriesIdx: 1, index: topCostIdx },
    ],
    lineLabels: [
      { index: minNetIdx, text: compactBRL(saldo[minNetIdx]) },
      ...(maxNetIdx !== minNetIdx ? [{ index: maxNetIdx, text: compactBRL(saldo[maxNetIdx]) }] : []),
    ],
  }) + legend([
    ...bars.map((b) => ({ name: b.name, color: b.color })),
    { name: 'Saldo líquido mensal', color: C.info },
    { name: 'Fundo destacado = mês negativo', color: '#F5D0D0' },
  ]);

  // Relevant months supporting table
  const keyIdx = selectKeyMonthlyIndices(iv, effectiveCutoff);
  const cutIdx = indexOfPeriod(periods, effectiveCutoff);
  const rows = keyIdx
    .map((i) => {
      const p = iv.curve[i];
      const st = p.resultadoMensal > 0 ? ['Positivo', 'ok'] : p.resultadoMensal < 0 ? ['Negativo', 'crit'] : ['Neutro', ''];
      const tags: string[] = [];
      if (i === cutIdx) tags.push('corte');
      if (i === topRevIdx) tags.push('maior receita');
      if (i === topCostIdx) tags.push('maior desembolso');
      if (i === minNetIdx) tags.push('mais negativo');
      if (i === maxNetIdx) tags.push('mais positivo');
      return `<tr>
        <td><b>${esc(periodLabel(p.period))}</b> <span class="muted" style="font-size:8.5px">${esc(tags.join(' · '))}</span></td>
        <td class="num mono">${esc(BRL(p.receitaMensal))}</td>
        <td class="num mono">${esc(BRL(p.desembolsoMensal))}</td>
        <td class="num mono" style="color:${p.resultadoMensal < 0 ? C.critical : C.success};font-weight:700">${esc(BRL(p.resultadoMensal))}</td>
        <td><span class="pill ${st[1]}">${esc(st[0])}</span></td>
      </tr>`;
    })
    .join('');
  const table = `<table class="data compact">
    <thead><tr><th>Mês</th><th class="num">Receita mensal</th><th class="num">Desembolso mensal</th><th class="num">Saldo mensal</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  return chips + `<div class="chart">${chart}</div><h3 style="margin-top:10px">Meses relevantes</h3>` + table;
}

function renderEventCards(iv: InvestorView, eventStats: ReturnType<typeof computeEventStats>): string {
  const next = iv.nextEvent;
  const totalValue = eventStats.billedValue + eventStats.pendingValue;
  const pctBilled = totalValue > 0 ? (eventStats.billedValue / totalValue) * 100 : null;
  const pctPending = totalValue > 0 ? (eventStats.pendingValue / totalValue) * 100 : null;
  const cards = [
    { label: 'Próximo evento', value: next ? compactBRL(centsToReais(next.amountPlannedCents)) : 'sem pendência', helper: next ? `${next.title} · ${periodLabel(next.datePlanned.slice(0, 7))}` : '—', color: C.info },
    { label: 'Eventos atrasados', value: String(iv.delayedEvents.length), helper: iv.delayedEvents.length ? `valor ${compactBRL(eventStats.delayedValue)}` : 'nenhum', color: iv.delayedEvents.length ? C.critical : C.success },
    { label: 'Maior evento', value: eventStats.biggest ? compactBRL(centsToReais(eventStats.biggest.amountPlannedCents)) : '—', helper: eventStats.biggest?.title ?? '—', color: C.purple },
    { label: 'Pendente de faturar', value: compactBRL(eventStats.pendingValue), helper: 'eventos não faturados', color: C.warning },
    { label: 'Faturado', value: compactBRL(eventStats.billedValue), helper: 'faturados / parciais', color: C.success },
    { label: 'Total de eventos', value: String(eventStats.total), helper: 'no eventograma', color: C.cyan },
    { label: '% faturado', value: fmtPct(pctBilled), helper: 'sobre valor de eventos', color: C.successSoft },
    { label: '% pendente', value: fmtPct(pctPending), helper: 'sobre valor de eventos', color: C.costSoft },
  ];
  return `<div class="mini-cards cols-8">${cards
    .map((c) => `<div class="mini-card"><div class="bar" style="background:linear-gradient(90deg, transparent, ${c.color}, transparent)"></div><div class="mc-l">${esc(c.label)}</div><div class="mc-v" style="color:${c.color}">${esc(c.value)}</div><div class="mc-h">${esc(c.helper)}</div></div>`)
    .join('')}</div>`;
}

function renderEventGroups(project: ProjectV2): string {
  const groups = selectEventGroups(project);
  if (!groups.length) {
    return `<p class="empty">Sem eventos de faturamento no eventograma deste projeto.</p>`;
  }
  let seq = 0;
  return groups
    .map((g) => {
      const rows = g.events
        .map((e) => {
          seq += 1;
          const linked = e.contractId
            ? `Contrato ${e.contractId}`
            : (e.linked?.milestoneId ? `Marco ${e.linked.milestoneId}` : (e.linked?.taskId ? `Tarefa ${e.linked.taskId}` : '—'));
          const value = centsToReais(e.amountActualCents ?? e.amountPlannedCents);
          const sevCls = e.status === 'delayed' || e.status === 'cancelled' ? 'crit' : e.status === 'billed' ? 'ok' : e.status === 'partial' ? 'warn' : '';
          const obs = e.status === 'partial' && e.amountActualCents != null
            ? `faturado ${compactBRL(centsToReais(e.amountActualCents))} de ${compactBRL(centsToReais(e.amountPlannedCents))}`
            : (e.dateActual ? `realizado em ${periodLabel(e.dateActual.slice(0, 7))}` : '—');
          return `<tr>
            <td class="num">${seq}</td>
            <td>${esc(e.title)}</td>
            <td>${esc(periodLabel(e.datePlanned.slice(0, 7)))}</td>
            <td class="num mono">${esc(BRL(value))}</td>
            <td><span class="pill ${sevCls}">${esc(statusLabelPt(e.status))}</span></td>
            <td class="num mono" style="color:${e.status === 'delayed' ? C.critical : C.subtle}">${esc(delayLabel(e))}</td>
            <td class="muted">${esc(linked)}</td>
            <td class="muted">${esc(obs)}</td>
          </tr>`;
        })
        .join('');
      return `<div class="event-group">
        <div class="group-title ${g.cls}">${esc(g.title)} <span class="muted">(${g.events.length})</span></div>
        <table class="data compact">
          <thead><tr><th class="num">#</th><th>Descrição</th><th>Mês previsto</th><th class="num">Valor</th><th>Status</th><th class="num">Atraso</th><th>Vínculo</th><th>Observação</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join('');
}

function renderWaterfallPage(iv: InvestorView): string {
  const finalResult = iv.netResult - iv.riskExposure;
  const badge = `<div class="result-badge" style="border-color:${finalResult >= 0 ? C.success : C.critical}40;background:${finalResult >= 0 ? C.success : C.critical}0D">
    <span class="rb-l">Resultado final projetado</span>
    <span class="rb-v" style="color:${finalResult >= 0 ? C.success : C.critical}">${finalResult > 0 ? '+' : ''}${esc(BRL(finalResult))}</span>
    <span class="rb-m">margem ${esc(fmtPct(iv.marginPct))}</span>
  </div>`;

  const passThroughSentence = iv.directPassThrough > 0
    ? ` O faturamento direto a terceiros de ${compactBRL(iv.directPassThrough)} transita fora do caixa da Insight.`
    : '';
  const interp = iv.riskExposure
    ? `O caixa Insight previsto de ${compactBRL(iv.insightCashRevenue)} absorve ${compactBRL(iv.insightDisbursement)} de desembolso e ${compactBRL(iv.riskExposure)} de contingências, resultando em ${compactBRL(finalResult)} (${fmtPct(iv.marginPct)} de margem sobre o caixa Insight).${passThroughSentence}`
    : `O caixa Insight previsto de ${compactBRL(iv.insightCashRevenue)} absorve ${compactBRL(iv.insightDisbursement)} de desembolso, resultando em ${compactBRL(finalResult)} (${fmtPct(iv.marginPct)} de margem sobre o caixa Insight). Contingências ainda não informadas.${passThroughSentence}`;

  // Composition cards (from iv.costComposition — same data as the screen)
  const compTotal = iv.costComposition.reduce((s, c) => s + c.value, 0);
  const compCards = iv.costComposition.length
    ? `<h3 style="margin-top:12px">Composição do desembolso</h3><div class="mini-cards cols-5">${iv.costComposition
      .slice(0, 5)
      .map((c, i) => {
        const share = compTotal > 0 ? (c.value / compTotal) * 100 : null;
        const colors = [C.cost, C.costSoft, C.warning, C.cyan, C.purple];
        const color = colors[i % colors.length];
        return `<div class="mini-card"><div class="bar" style="background:linear-gradient(90deg, transparent, ${color}, transparent)"></div><div class="mc-l">${esc(c.category)}</div><div class="mc-v" style="color:${color}">${esc(compactBRL(c.value))}</div><div class="mc-h">${share != null ? `${share.toFixed(0)}% do desembolso` : '—'}</div></div>`;
      })
      .join('')}${iv.riskExposure ? `<div class="mini-card"><div class="bar" style="background:linear-gradient(90deg, transparent, ${C.critical}, transparent)"></div><div class="mc-l">Contingências / riscos</div><div class="mc-v" style="color:${C.critical}">${esc(compactBRL(iv.riskExposure))}</div><div class="mc-h">exposição de riscos abertos</div></div>` : ''}</div>`
    : `<p class="empty">Composição de custos não informada para este projeto.</p>`;

  return `<div class="wf-head">${badge}<p class="interp">${esc(interp)}</p></div>
    <div class="chart">${svgWaterfall(iv, { width: 1040, height: 310 })}</div>
    ${compCards}`;
}

function renderSensitivityPage(iv: InvestorView, rows: SensitivityRow[], warnings: string[]): string {
  const base = rows[0]?.result ?? 0;
  const colorOf = (r: SensitivityRow): string =>
    r.result < 0 ? C.critical : (r.margin != null && r.margin < 8) ? C.warning : (r.label === 'Base' ? C.primary : C.info);

  const chart = svgScenarioBars(rows.map((r) => ({ label: r.label, value: r.result, margin: r.margin, color: colorOf(r) })), { width: 560 });

  const table = `<table class="data compact">
    <thead><tr><th>Cenário</th><th class="num">Resultado</th><th class="num">Margem</th><th class="num">Δ vs base</th><th>Status</th></tr></thead>
    <tbody>${rows
      .map((r) => {
        const delta = r.result - base;
        const st = r.result < 0 ? ['Negativo', 'crit'] : (r.margin != null && r.margin < 8) ? ['Atenção', 'warn'] : ['Positivo', 'ok'];
        return `<tr>
          <td><b>${esc(r.label)}</b></td>
          <td class="num mono" style="color:${r.result < 0 ? C.critical : C.body};font-weight:600">${esc(BRL(r.result))}</td>
          <td class="num mono">${esc(fmtPct(r.margin))}</td>
          <td class="num mono" style="color:${delta < 0 ? C.critical : C.subtle}">${r.label === 'Base' ? '—' : `${delta > 0 ? '+' : ''}${esc(BRL(delta))}`}</td>
          <td><span class="pill ${st[1]}">${esc(st[0])}</span></td>
        </tr>`;
      })
      .join('')}</tbody></table>`;

  const interp = (() => {
    const worst = rows.reduce((w, r) => (r.result < w.result ? r : w), rows[0]);
    return worst && worst.result < 0
      ? `No cenário mais adverso (${worst.label}), o resultado projetado fica em ${compactBRL(worst.result)} — o projeto não absorve esse estresse sem medidas de mitigação.`
      : `Mesmo no cenário mais adverso, o resultado projetado permanece positivo — o projeto demonstra resiliência aos estresses simulados.`;
  })();

  const warnBox = warnings.length
    ? `<div class="warn-box"><div class="warn-title">Alertas e qualidade de dados</div><ul class="warn-list">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : `<div class="warn-box ok"><div class="warn-title" style="color:${C.success}">Sem alertas críticos</div><p class="empty" style="padding:2px 0 0">Sem alertas de qualidade de dados ou riscos financeiros críticos no momento.</p></div>`;

  return `<div class="two-col">
    <div>
      <div class="chart">${chart}</div>
      <p class="interp" style="margin-top:8px">${esc(interp)}</p>
    </div>
    <div>${table}${warnBox}</div>
  </div>`;
}

function renderInternalAppendix(view: ProjectFinanceView, drivers: string[]): string {
  const baf = view.baf;
  const varColor = baf.variance > 0 ? C.critical : C.success;
  const cards = [
    { label: 'Orçamento ao concluir (BAC)', value: BRL(baf.bac), color: C.info },
    { label: 'Custo realizado (AC)', value: BRL(baf.ac), color: C.success },
    { label: 'Estimativa ao concluir (EAC)', value: BRL(baf.eac), color: C.cost },
    { label: 'Estimativa para concluir (ETC)', value: BRL(baf.etc), color: C.warning },
    { label: 'Variação EAC − BAC', value: `${baf.variance > 0 ? '+' : ''}${BRL(baf.variance)}`, color: varColor, helper: `${baf.variance > 0 ? '+' : ''}${baf.variancePct.toFixed(1)}%` },
  ];
  const cardsHtml = `<div class="mini-cards cols-5">${cards
    .map((k) => `<div class="mini-card"><div class="bar" style="background:linear-gradient(90deg, transparent, ${k.color}, transparent)"></div><div class="mc-l">${esc(k.label)}</div><div class="mc-v" style="color:${k.color}">${esc(k.value)}</div><div class="mc-h">${esc(k.helper ?? '')}</div></div>`)
    .join('')}</div>`;

  const breakdown = view.costBreakdown.slice(0, 8);
  const rows = breakdown
    .map((r) => {
      const variance = r.eac - r.bac;
      const varPct = r.bac > 0 ? (variance / r.bac) * 100 : 0;
      const vc = variance > 0 ? C.critical : C.success;
      const major = Math.abs(varPct) > 10;
      return `<tr${major ? ` style="background:${vc}08"` : ''}>
        <td${major ? ' style="font-weight:700"' : ''}>${esc(r.category)}${major ? ` <span class="pill ${variance > 0 ? 'crit' : 'ok'}">desvio</span>` : ''}</td>
        <td class="num mono">${esc(BRL(r.bac))}</td>
        <td class="num mono">${esc(BRL(r.ac))}</td>
        <td class="num mono">${esc(BRL(r.eac))}</td>
        <td class="num mono" style="color:${vc}">${variance > 0 ? '+' : ''}${esc(BRL(variance))}</td>
        <td class="num mono" style="color:${vc}">${variance > 0 ? '+' : ''}${varPct.toFixed(1)}%</td>
      </tr>`;
    })
    .join('');
  const table = rows
    ? `<h3 style="margin-top:12px">Principais categorias de custo</h3><table class="data compact"><thead><tr><th>Categoria</th><th class="num">BAC</th><th class="num">AC</th><th class="num">EAC</th><th class="num">Var (R$)</th><th class="num">Var (%)</th></tr></thead><tbody>${rows}</tbody></table>`
    : '';

  const driversHtml = drivers.length
    ? `<h3 style="margin-top:12px">Principais impulsores de custo</h3><ul class="warn-list">${drivers.slice(0, 4).map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`
    : '';

  return cardsHtml + table + driversHtml;
}

/** S-curve chart page specific to Internal Controls (cost BAC/AC/EAC + revenue planned/billed/received). */
function renderInternalSCurvePage(view: ProjectFinanceView, project: ProjectV2, effectiveCutoff?: string): string {
  const costPeriods = view.sCurve.cost.map((p) => p.period);
  const ledgerRevenueByPeriod = new Map(view.sCurve.revenue.map((p) => [p.period, p]));
  const projectRevenueByPeriod = new Map((project.revenueCurve ?? []).map((p) => [p.period, p]));
  const revenuePoints = Array.from(new Set([
    ...projectRevenueByPeriod.keys(),
    ...ledgerRevenueByPeriod.keys(),
  ]))
    .sort((a, b) => a.localeCompare(b))
    .map((period) => {
      const projectPoint = projectRevenueByPeriod.get(period);
      const ledgerPoint = ledgerRevenueByPeriod.get(period);
      return {
        period,
        planned: curveCentsToReais(projectPoint?.plannedCumulative) ?? ledgerPoint?.planned ?? null,
        billed: curveCentsToReais(projectPoint?.billedCumulative) ?? ledgerPoint?.billed ?? null,
        received: curveCentsToReais(projectPoint?.receivedCumulative) ?? ledgerPoint?.received ?? null,
      };
    });
  const revPeriods = revenuePoints.map((p) => p.period);

  // Cost S-curve
  let costChart = '';
  if (costPeriods.length > 0) {
    const costSeries: LineSeries[] = [
      { name: 'BAC (orçamento)', color: C.info, values: view.sCurve.cost.map((p) => p.BAC), endLabel: true },
      { name: 'AC (realizado)', color: C.success, values: view.sCurve.cost.map((p) => p.AC), endLabel: true },
      { name: 'EAC (estimativa)', color: C.cost, values: view.sCurve.cost.map((p) => p.EAC), dashed: true, endLabel: true },
    ].filter((s) => s.values.some((v) => v != null));

    const costMarkers: ChartMarker[] = [];
    const cutIdx = costPeriods.indexOf(effectiveCutoff ?? '');
    if (cutIdx >= 0) costMarkers.push({ index: cutIdx, label: 'CORTE', color: C.subtle, value: periodLabel(effectiveCutoff) });

    costChart = `<h3>Custo Acumulado — BAC × AC × EAC</h3>
      <div class="chart">${svgLineChart(costPeriods, costSeries, { width: 1040, height: 280, markers: costMarkers })}${legend(costSeries.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed })))}</div>`;
  }

  // Revenue S-curve
  let revenueChart = '';
  if (revPeriods.length > 0) {
    const revSeries: LineSeries[] = [
      { name: 'Receita planejada', color: C.info, values: revenuePoints.map((p) => p.planned), endLabel: true },
      { name: 'Receita faturada', color: C.success, values: revenuePoints.map((p) => p.billed), endLabel: true },
      { name: 'Receita recebida', color: C.warning, values: revenuePoints.map((p) => p.received), endLabel: true },
    ].filter((s) => s.values.some((v) => v != null));

    const revMarkers: ChartMarker[] = [];
    const cutIdx = revPeriods.indexOf(effectiveCutoff ?? '');
    if (cutIdx >= 0) revMarkers.push({ index: cutIdx, label: 'CORTE', color: C.subtle, value: periodLabel(effectiveCutoff) });

    revenueChart = `<h3 style="margin-top:14px">Receita Acumulada — Planejado × Faturado × Recebido</h3>
      <div class="chart">${svgLineChart(revPeriods, revSeries, { width: 1040, height: 280, markers: revMarkers })}${legend(revSeries.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed })))}</div>`;
  }

  // Revenue gap callouts
  const rev = view.revenue;
  const chips = callouts([
    { label: 'Contrato total', value: compactBRL(rev.contracted), color: C.primary },
    { label: 'Faturado', value: compactBRL(rev.billed), color: C.success },
    { label: 'A faturar', value: compactBRL(rev.toBill), color: C.warning },
    { label: 'Recebido', value: compactBRL(rev.received), color: C.info },
    { label: 'A receber', value: compactBRL(rev.toReceive), color: C.costSoft },
  ]);

  // Margin & variance summary
  const summary = view.summary;
  const marginColor = summary.margin >= 0 ? C.success : C.critical;
  const summaryCallouts = callouts([
    { label: 'Receita realizada', value: compactBRL(summary.revenue), color: C.success },
    { label: 'Custo realizado', value: compactBRL(view.baf.ac), color: C.cost },
    { label: 'Margem', value: `${BRL(summary.margin)} (${summary.marginPct.toFixed(1)}%)`, color: marginColor },
  ]);

  if (!costPeriods.length && !revPeriods.length) {
    return chips + `<div class="chart">${emptyChart(1040, 280)}</div>`;
  }

  return chips + summaryCallouts + costChart + revenueChart;
}

// ── Main renderer ───────────────────────────────────────────────────

export function buildProjectFinanceReportHtml(payload: ProjectFinanceReportPayload): string {
  const { project, ledgerView, cutoffPeriod, dataSourceNote, generatedBy } = payload;
  const brand = payload.brandName ?? 'Insight Energy';
  const logoUrl = payload.logoUrl ?? '/LOGO%20INSIGHT.png';
  const sections = payload.sections ?? 'all';

  const iv = computeInvestorView(project, ledgerView);
  const eventStats = computeEventStats(project, iv.delayedEvents);
  const sensitivity = computeSensitivityScenarios(iv);
  const kpis = buildKpis(iv);
  const warnings = buildWarnings(project, iv);
  const narrative = buildNarrative(iv);

  // Effective cutoff mirrors the on-screen cockpit logic (current month if in range).
  const currentPeriod = new Date().toISOString().slice(0, 7);
  const periods = iv.curve.map((p) => p.period);
  const effectiveCutoff = periods.includes(currentPeriod)
    ? currentPeriod
    : (cutoffPeriod || project.cutoffPeriod);

  const generated = new Date().toLocaleString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const rangeLabel = periods.length
    ? `${periodLabel(periods[0])} – ${periodLabel(periods[periods.length - 1])}`
    : 'sem período';
  const fileName = buildProjectFinanceFileName(project, new Date(), sections);
  const statusColor = sevColor(iv.generalStatus.severity);

  const hasInternalData = Boolean(ledgerView && (ledgerView.baf.bac > 0 || ledgerView.baf.ac > 0 || ledgerView.baf.eac > 0));

  const summaryRows: [string, string][] = [
    ['Valor do projeto', BRL(iv.contractTotal)],
    ['Receita faturada', BRL(iv.billed)],
    ['Receita a faturar', BRL(iv.toBill)],
    ['Desembolso previsto', BRL(iv.insightDisbursement)],
    ['Resultado projetado', BRL(iv.netResult)],
    ['Margem estimada', fmtPct(iv.marginPct)],
    ['Pico de necessidade de caixa', iv.peakGap ? `${BRL(iv.peakGap)} (${periodLabel(iv.peakGapPeriod)})` : 'sem gap de caixa'],
    ['Break-even', iv.breakEvenPeriod ? periodLabel(iv.breakEvenPeriod) : 'não projetado'],
    ['Risco financeiro', severityLabel(iv.financialRisk)],
  ];

  // ── Page bodies (footers are appended with computed page numbers) ──

  const reportTitle = SECTION_LABEL[sections];

  const coverPage = `
    <header class="cover-band">
      <img class="cover-logo" src="${esc(logoUrl)}" alt="${esc(brand)}" />
      <div class="cover-kicker">Project Finance Review</div>
      <h1 class="cover-title">${esc(reportTitle)}</h1>
      <div class="cover-proj">
        <b>${esc(project.nome)}</b>
        ${project.cliente ? `<span class="sep">·</span>${esc(project.cliente)}` : ''}
        <span class="status-chip" style="color:${statusColor};border-color:${statusColor}40;background:${statusColor}0D">${esc(iv.generalStatus.label)}</span>
      </div>
      <div class="cover-meta">
        <span><b>Gerado em</b> ${esc(generated)}</span>
        ${generatedBy ? `<span><b>Por</b> ${esc(generatedBy)}</span>` : ''}
        <span><b>Período</b> ${esc(rangeLabel)}</span>
        ${effectiveCutoff ? `<span><b>Data de corte</b> ${esc(periodLabel(effectiveCutoff))}</span>` : ''}
      </div>
      <div class="cover-note">${esc(dataSourceNote ?? 'Fonte: Financeiro (ledger oficial) + eventograma do projeto')} · Documento confidencial — uso restrito de diretoria, conselho e investidores.</div>
    </header>

    <section class="section">
      ${sectionTitle('Resumo Executivo')}
      <div class="exec">
        <div class="narrative">${narrative.map((s) => `<p>${esc(s)}</p>`).join('')}</div>
        <table class="summary">
          ${summaryRows.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${esc(v)}</td></tr>`).join('')}
        </table>
      </div>
    </section>

    <section class="section">
      ${sectionTitle('Indicadores Financeiros')}
      <div class="kpis cols-5">${kpis.map(kpiCardHtml).join('')}</div>
    </section>`;

  // ── Financial pages (investor view) ──
  const includeFinanceiro = sections === 'financeiro' || sections === 'all';
  const includeInternal = sections === 'controle-interno' || sections === 'all';

  const curvaSPage = `
    <section class="section">
      ${sectionTitle('Curva S — Receita × Desembolso', 'valores acumulados · previsto × realizado × projeção · marcadores de corte, break-even e pico de caixa')}
      ${renderCurvaSPage(iv, effectiveCutoff)}
    </section>`;

  const monthlyPage = `
    <section class="section">
      ${sectionTitle('Fluxo Mensal do Projeto', 'receita × desembolso mensais · saldo líquido · meses negativos destacados')}
      ${renderMonthlyFlowPage(iv, effectiveCutoff)}
    </section>`;

  const eventsPage = `
    <section class="section">
      ${sectionTitle('Eventograma de Faturamento', 'priorização: atrasados · próximos · maiores · faturados')}
      ${renderEventCards(iv, eventStats)}
      ${renderEventGroups(project)}
    </section>`;

  const waterfallPage = `
    <section class="section">
      ${sectionTitle('Resultado Projetado', 'ponte do caixa Insight ao resultado final · composição do desembolso')}
      ${renderWaterfallPage(iv)}
    </section>`;

  const internalNote = !hasInternalData
    ? `<p class="empty" style="margin-top:10px">Controle interno (BAC / AC / EAC / ETC): dados ainda insuficientes — apêndice omitido.</p>`
    : '';
  const sensitivityPage = `
    <section class="section">
      ${sectionTitle('Sensibilidade / Riscos Financeiros', 'estresse de custo e receita sobre o resultado projetado')}
      ${renderSensitivityPage(iv, sensitivity, warnings)}
      ${internalNote}
    </section>`;

  // ── Internal Controls pages (S-curves BAC/AC/EAC, cost breakdown, revenue gaps) ──
  const internalSCurvePage = hasInternalData && ledgerView
    ? `
    <section class="section">
      ${sectionTitle('Curva S — Controle Interno', 'BAC × AC × EAC acumulado · receita planejada × faturada × recebida · ledger oficial')}
      ${renderInternalSCurvePage(ledgerView, project, effectiveCutoff)}
    </section>`
    : null;

  const appendixPage = hasInternalData
    ? `
    <section class="section">
      ${sectionTitle('Detalhamento de Custos — Controle Interno', 'BAC / AC / EAC / ETC · variações e principais categorias · ledger oficial')}
      ${renderInternalAppendix(ledgerView!, project.finance?.drivers ?? [])}
    </section>`
    : null;

  // ── Assemble pages based on selected sections ──
  const pageBodies: string[] = [coverPage];

  if (includeFinanceiro) {
    pageBodies.push(curvaSPage, monthlyPage, eventsPage, waterfallPage, sensitivityPage);
  }

  if (includeInternal) {
    if (internalSCurvePage) pageBodies.push(internalSCurvePage);
    if (appendixPage) pageBodies.push(appendixPage);
    if (!hasInternalData && !includeFinanceiro) {
      // When only internal controls requested but no data exists
      pageBodies.push(`
        <section class="section">
          ${sectionTitle('Controle Interno do Projeto')}
          <p class="empty">Dados de controle interno (BAC / AC / EAC / ETC) ainda insuficientes. Vincule entradas do ledger financeiro a este projeto para gerar o relatório de controle interno.</p>
        </section>`);
    }
  }

  const totalPages = pageBodies.length;

  const pagesHtml = pageBodies
    .map((body, i) => `
  <div class="page${i > 0 ? ' page-break' : ''}">
    <div class="page-body">${body}</div>
    <div class="pfoot">
      <span class="pf-brand"><img class="pf-logo" src="${esc(logoUrl)}" alt="${esc(brand)}" /> · ${esc(project.nome)} · Confidencial</span>
      <span>Página ${i + 1} de ${totalPages}</span>
    </div>
  </div>`)
    .join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>${esc(fileName)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm 12mm 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: ${C.ink};
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Each .page is one explicit printed page; footer is laid out at its bottom. */
  .page { display: flex; flex-direction: column; min-height: 186mm; padding: 0 1mm; }
  .page-break { page-break-before: always; }
  .page-body { flex: 1 1 auto; }
  .pfoot { margin-top: auto; display: flex; justify-content: space-between; align-items: center;
    border-top: 1px solid ${C.border}; padding-top: 5px; font-size: 8.5px; color: ${C.subtle}; }
  .pf-brand { display: inline-flex; align-items: center; gap: 5px; }
  .pf-logo { height: 11px; width: auto; object-fit: contain; display: inline-block; }

  .section { margin: 0 0 12px; page-break-inside: avoid; }
  h2 { font-size: 14px; margin: 0; color: ${C.ink}; letter-spacing: .02em; }
  h3 { font-size: 10.5px; margin: 0 0 6px; color: ${C.muted}; text-transform: uppercase; letter-spacing: .08em; }
  .sec-head { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; padding-bottom: 6px;
    border-bottom: 1px solid ${C.border}; }
  .sec-rule { width: 4px; height: 26px; border-radius: 99px;
    background: linear-gradient(180deg, ${C.brandOrange}, ${C.brandGreen}); }
  .sec-sub { margin: 1px 0 0; font-size: 9.5px; color: ${C.subtle}; }

  .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, monospace; }
  .num { text-align: right; }
  .muted { color: ${C.subtle}; }
  .empty { color: ${C.subtle}; font-size: 11px; font-style: italic; padding: 6px 0; }
  .interp { font-size: 10.5px; color: ${C.body}; margin: 6px 0 0; max-width: 980px; }

  /* ── Cover band (glass-inspired, light) ── */
  .cover-band { position: relative; text-align: center; padding: 22px 28px 16px; margin-bottom: 14px;
    border: 1px solid ${C.border}; border-radius: 16px; overflow: hidden;
    background:
      radial-gradient(120% 140% at 0% 0%, ${C.brandOrange}14 0%, transparent 45%),
      radial-gradient(120% 140% at 100% 0%, ${C.brandGreen}14 0%, transparent 45%),
      linear-gradient(180deg, #FFFFFF 0%, #FAFCFB 100%); }
  .cover-band::after { content: ''; position: absolute; inset-inline: 0; bottom: 0; height: 3px;
    background: linear-gradient(90deg, ${C.brandOrange}, #F5C518, ${C.brandGreen}); }
  .cover-logo { height: 52px; max-width: 360px; object-fit: contain; margin: 0 auto 10px; display: block; }
  .cover-kicker { font-size: 9px; font-weight: 700; letter-spacing: .22em; text-transform: uppercase; color: ${C.subtle}; }
  .cover-title { font-size: 26px; font-weight: 800; margin: 6px 0 12px; color: ${C.ink}; letter-spacing: -0.01em; }
  .cover-proj { font-size: 13.5px; color: ${C.body}; }
  .cover-proj b { color: ${C.ink}; }
  .cover-proj .sep { margin: 0 7px; color: ${C.borderStrong}; }
  .status-chip { display: inline-block; margin-left: 10px; padding: 2px 10px; border: 1px solid; border-radius: 999px;
    font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; vertical-align: 2px; }
  .cover-meta { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px 22px; margin-top: 10px;
    font-size: 10px; color: ${C.muted}; }
  .cover-meta b { color: ${C.ink}; }
  .cover-note { margin-top: 9px; font-size: 8.5px; color: ${C.subtle}; }

  /* ── Executive summary ── */
  .exec { display: grid; grid-template-columns: 1.15fr 1fr; gap: 18px; align-items: start; }
  .narrative p { margin: 0 0 7px; font-size: 11.5px; color: ${C.body}; }
  table.summary { width: 100%; border-collapse: collapse; }
  table.summary td { padding: 4px 6px; border-bottom: 1px solid ${C.border}; font-size: 10.5px; }
  table.summary tr:nth-child(even) td { background: #FAFCFB; }
  table.summary td:last-child { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }

  /* ── KPI cards ── */
  .kpis { display: grid; gap: 8px; }
  .kpis.cols-5 { grid-template-columns: repeat(5, 1fr); }
  .kpi { position: relative; display: flex; flex-direction: column; min-height: 64px;
    border: 1px solid ${C.border}; border-radius: 10px; padding: 9px 11px 8px;
    background: linear-gradient(180deg, #FFFFFF 0%, #FBFDFC 100%); overflow: hidden; page-break-inside: avoid;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
  .kpi .bar { position: absolute; top: 0; left: 10%; right: 10%; height: 2px; }
  .kpi-l { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; color: ${C.subtle}; font-weight: 700; }
  .kpi-v { font-size: 15.5px; font-weight: 800; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .kpi-foot { margin-top: auto; display: flex; justify-content: space-between; align-items: center; gap: 4px; padding-top: 2px; }
  .kpi-h { font-size: 8.5px; color: ${C.subtle}; }

  /* ── Mini cards ── */
  .mini-cards { display: grid; gap: 8px; margin-bottom: 10px; }
  .mini-cards.cols-5 { grid-template-columns: repeat(5, 1fr); }
  .mini-cards.cols-8 { grid-template-columns: repeat(8, 1fr); }
  .mini-card { position: relative; border: 1px solid ${C.border}; border-radius: 10px; padding: 8px 10px; overflow: hidden;
    background: linear-gradient(180deg, #FFFFFF 0%, #FBFDFC 100%); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
  .mini-card .bar { position: absolute; top: 0; left: 10%; right: 10%; height: 2px; }
  .mc-l { font-size: 7.5px; text-transform: uppercase; letter-spacing: .09em; color: ${C.subtle}; font-weight: 700;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mc-v { font-size: 13.5px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .mc-h { font-size: 8px; color: ${C.subtle}; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* ── Callout chips ── */
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1px solid; border-radius: 999px; }
  .chip .dot { width: 6px; height: 6px; border-radius: 99px; }
  .chip-l { font-size: 8.5px; text-transform: uppercase; letter-spacing: .08em; color: ${C.muted}; }
  .chip-v { font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums; }

  /* ── Charts ── */
  .chart { border: 1px solid ${C.border}; border-radius: 12px; padding: 10px 12px 8px; background: #fff;
    page-break-inside: avoid; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
  .legend { display: flex; flex-wrap: wrap; gap: 5px 14px; margin-top: 6px; justify-content: center; }
  .legend .lg { display: inline-flex; align-items: center; gap: 5px; font-size: 9px; color: ${C.muted}; }
  .legend .sw { width: 16px; height: 3px; border-radius: 2px; display: inline-block; }

  .two-col { display: grid; grid-template-columns: 1.05fr 1fr; gap: 16px; align-items: start; }

  /* ── Tables ── */
  table.data { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 4px; }
  table.data thead th { text-align: left; background: #F6F9F8; border-bottom: 1.5px solid ${C.borderStrong};
    padding: 5px 7px; font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: ${C.muted}; }
  table.data thead th.num { text-align: right; }
  table.data tbody td { padding: 4.5px 7px; border-bottom: 1px solid ${C.border}; }
  table.data tbody tr { page-break-inside: avoid; }
  table.data tbody tr:nth-child(even) { background: #FBFDFC; }
  table.data thead { display: table-header-group; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 8.5px; font-weight: 700;
    background: #EEF2F6; color: ${C.muted}; }
  .pill.ok { background: #ECFDF5; color: ${C.success}; }
  .pill.warn { background: #FFFBEB; color: ${C.warning}; }
  .pill.crit { background: #FEF2F2; color: ${C.critical}; }

  .event-group { margin-bottom: 10px; page-break-inside: avoid; }
  .group-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: ${C.body};
    padding: 3px 0 3px 9px; border-left: 3px solid ${C.borderStrong}; }
  .group-title.crit { border-left-color: ${C.critical}; color: ${C.critical}; }
  .group-title.warn { border-left-color: ${C.warning}; color: ${C.warning}; }
  .group-title.ok { border-left-color: ${C.success}; color: ${C.success}; }

  /* ── Waterfall extras ── */
  .wf-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 8px; }
  .result-badge { display: flex; flex-direction: column; gap: 1px; border: 1px solid; border-radius: 12px;
    padding: 8px 14px; flex-shrink: 0; }
  .rb-l { font-size: 8px; text-transform: uppercase; letter-spacing: .1em; color: ${C.subtle}; font-weight: 700; }
  .rb-v { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .rb-m { font-size: 9px; color: ${C.muted}; }

  /* ── Warning box ── */
  .warn-box { margin-top: 10px; border: 1px solid ${C.warning}40; background: ${C.warning}0A;
    border-radius: 12px; padding: 10px 14px; page-break-inside: avoid; }
  .warn-box.ok { border-color: ${C.success}40; background: ${C.success}0A; }
  .warn-title { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: ${C.warning}; margin-bottom: 4px; }
  .warn-list { margin: 2px 0 0; padding-left: 16px; }
  .warn-list li { font-size: 10px; color: ${C.body}; margin-bottom: 3px; }

  /* ── Screen-only toolbar & preview ── */
  .toolbar { position: fixed; top: 12px; right: 12px; z-index: 20; background: ${C.ink}; color: #fff;
    padding: 8px 12px; border-radius: 10px; display: flex; gap: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.18); }
  .toolbar button { background: ${C.brandGreen}; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px;
    font-weight: 600; cursor: pointer; font-size: 11px; }
  .toolbar button.alt { background: transparent; border: 1px solid rgba(255,255,255,.25); }

  @media print { .no-print { display: none !important; } }
  @media screen {
    body { background: #E9EEF2; }
    .page { background: #fff; width: 297mm; min-height: 190mm; margin: 16px auto; padding: 10mm 12mm 8mm;
      box-shadow: 0 2px 14px rgba(15, 23, 42, .14); border-radius: 4px; }
  }
</style></head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">Imprimir / Salvar PDF</button>
    <button class="alt" onclick="window.close()">Fechar</button>
  </div>
${pagesHtml}
  <script>
    document.title = ${JSON.stringify(fileName)};
  </script>
</body></html>`;
}

export type ProjectFinanceExportResult =
  | { ok: true }
  | { ok: false; reason: 'popup_blocked' | 'error'; message: string };

/** Open the print-ready investor report in a new window (user prints / saves as PDF). */
export function openProjectFinanceReport(payload: ProjectFinanceReportPayload): ProjectFinanceExportResult {
  try {
    // Absolute logo URL so the asset resolves regardless of the new window's base URI.
    const logoUrl = payload.logoUrl
      ?? (typeof window !== 'undefined' ? `${window.location.origin}/LOGO%20INSIGHT.png` : '/LOGO%20INSIGHT.png');
    const html = buildProjectFinanceReportHtml({ ...payload, logoUrl });
    const w = window.open('', '_blank', 'width=1280,height=860');
    if (!w) {
      return { ok: false, reason: 'popup_blocked', message: 'O navegador bloqueou a janela. Habilite pop-ups para este site.' };
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
