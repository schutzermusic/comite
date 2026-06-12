/**
 * Project finance / investor report → print-ready HTML (browser print → PDF).
 *
 * Mirrors the established export pattern (portfolio / cost-analysis / workforce):
 * a pure `buildProjectFinanceReportHtml(payload)` renderer plus
 * `openProjectFinanceReport(payload)` that opens the print window.
 *
 * IMPORTANT — single source of truth:
 *   All monetary numbers come from the SAME investor view-model used by the
 *   on-screen Financeiro tab (`computeInvestorView`, `computeEventStats`,
 *   `computeSensitivityScenarios` from FinanceInvestorCockpit) and from the
 *   ledger-derived `ProjectFinanceView`. This module performs NO financial
 *   calculation of its own — it only formats and lays the data out for print.
 *
 * Charts are rendered as inline SVG recreated from the same series data (not a
 * screenshot of the page) so they print crisply on a light A4 landscape sheet
 * regardless of the app's dark/light theme.
 */

import type { ProjectV2 } from '@/lib/types/project-v2';
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

function severityLabel(s: InvestorView['financialRisk']): string {
  const map: Record<string, string> = { success: 'Baixo', warning: 'Atenção', critical: 'Crítico', neutral: 'Dados insuf.' };
  return map[s] ?? s;
}

// ── Light print palette ─────────────────────────────────────────────

const C = {
  ink: '#0F172A',
  body: '#1E293B',
  muted: '#475569',
  subtle: '#64748B',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  primary: '#0F766E',
  success: '#047857',
  successSoft: '#059669',
  info: '#1D4ED8',
  cost: '#C2410C',
  costSoft: '#A16207',
  warning: '#B45309',
  critical: '#B91C1C',
  purple: '#7C3AED',
  grid: '#EEF2F6',
};

function sevColor(s: InvestorView['financialRisk']): string {
  if (s === 'success') return C.success;
  if (s === 'warning') return C.warning;
  if (s === 'critical') return C.critical;
  return C.subtle;
}

// ── Inline SVG chart primitives (print-safe) ────────────────────────

interface LineSeries {
  name: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

interface ChartMarker {
  index: number;
  label: string;
  color: string;
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

function svgLineChart(
  periods: string[],
  series: LineSeries[],
  opts: { width: number; height: number; markers?: ChartMarker[] },
): string {
  const { width, height, markers = [] } = opts;
  const padL = 64, padR = 16, padT = 16, padB = 30;
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
        `<text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="${C.subtle}">${esc(compactBRL(t))}</text>`;
    })
    .join('');

  const zeroLine = min < 0 && max > 0
    ? `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${padL + plotW}" y2="${yAt(0).toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
    : '';

  // x labels (sample to avoid overlap)
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const xLabels = periods
    .map((p, i) => (i % labelStep === 0 || i === n - 1)
      ? `<text x="${xAt(i).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="9" fill="${C.subtle}">${esc(periodLabel(p))}</text>`
      : '')
    .join('');

  const markerEls = markers
    .filter((m) => m.index >= 0 && m.index < n)
    .map((m) => {
      const x = xAt(m.index).toFixed(1);
      return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="${m.color}" stroke-width="1.2" stroke-dasharray="4 3"/>` +
        `<text x="${x}" y="${padT - 4}" text-anchor="middle" font-size="8" font-weight="700" fill="${m.color}">${esc(m.label)}</text>`;
    })
    .join('');

  const paths = series
    .map((s) => {
      // break the line into segments on null gaps
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
      return `<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"${dash}/>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${gridLines}${zeroLine}${markerEls}${paths}${xLabels}</svg>`;
}

interface BarSeries { name: string; color: string; values: number[]; }

function svgGroupedBarChart(
  periods: string[],
  series: BarSeries[],
  opts: { width: number; height: number; highlightNegative?: (number | null)[] },
): string {
  const { width, height, highlightNegative } = opts;
  const padL = 64, padR = 16, padT = 16, padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = periods.length;
  if (n === 0) return emptyChart(width, height);

  const all = series.flatMap((s) => s.values);
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (min === max) max = min + 1;
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;
  const groupW = plotW / n;
  const barGap = 2;
  const barW = Math.max(2, (groupW * 0.62) / series.length - barGap);

  const ticks = niceTicks(min, max, 4);
  const gridLines = ticks
    .map((t) => {
      const y = yAt(t).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="${C.subtle}">${esc(compactBRL(t))}</text>`;
    })
    .join('');
  const y0 = yAt(0);

  const highlights = (highlightNegative ?? [])
    .map((v, i) => (v != null && v < 0)
      ? `<rect x="${(padL + i * groupW).toFixed(1)}" y="${padT}" width="${groupW.toFixed(1)}" height="${plotH}" fill="${C.critical}" opacity="0.06"/>`
      : '')
    .join('');

  const bars = periods
    .map((_, i) => {
      const groupStart = padL + i * groupW + (groupW - (barW + barGap) * series.length) / 2;
      return series
        .map((s, si) => {
          const v = s.values[i] ?? 0;
          const y = yAt(Math.max(0, v));
          const h = Math.abs(yAt(v) - y0);
          const x = groupStart + si * (barW + barGap);
          return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${s.color}" rx="1"/>`;
        })
        .join('');
    })
    .join('');

  const zeroLine = `<line x1="${padL}" y1="${y0.toFixed(1)}" x2="${padL + plotW}" y2="${y0.toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`;

  const labelStep = Math.max(1, Math.ceil(n / 8));
  const xLabels = periods
    .map((p, i) => (i % labelStep === 0 || i === n - 1)
      ? `<text x="${(padL + i * groupW + groupW / 2).toFixed(1)}" y="${height - 10}" text-anchor="middle" font-size="9" fill="${C.subtle}">${esc(periodLabel(p))}</text>`
      : '')
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${gridLines}${highlights}${bars}${zeroLine}${xLabels}</svg>`;
}

/** Horizontal sensitivity / generic value bar chart (supports negatives). */
function svgHBarChart(rows: { label: string; value: number; color: string }[], opts: { width: number; rowH?: number }): string {
  const rowH = opts.rowH ?? 26;
  const width = opts.width;
  const padL = 110, padR = 70;
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
      const w = Math.max(1, Math.abs(xAt(r.value) - x0));
      const labelX = r.value >= 0 ? xAt(r.value) + 6 : xAt(r.value) - 6;
      const anchor = r.value >= 0 ? 'start' : 'end';
      return `<text x="${padL - 8}" y="${cy}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="${C.body}">${esc(r.label)}</text>` +
        `<rect x="${x.toFixed(1)}" y="${(cy - rowH * 0.32).toFixed(1)}" width="${w.toFixed(1)}" height="${(rowH * 0.64).toFixed(1)}" fill="${r.color}" rx="2"/>` +
        `<text x="${labelX.toFixed(1)}" y="${cy}" text-anchor="${anchor}" dominant-baseline="middle" font-size="9.5" font-weight="600" fill="${C.body}">${esc(BRL(r.value))}</text>`;
    })
    .join('');

  const axis = `<line x1="${x0.toFixed(1)}" y1="2" x2="${x0.toFixed(1)}" y2="${height - 2}" stroke="${C.borderStrong}" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${axis}${bars}</svg>`;
}

/** Waterfall bridge (Caixa → Resultado). */
function svgWaterfall(iv: InvestorView, opts: { width: number; height: number }): string {
  const { width, height } = opts;
  const padL = 64, padR = 16, padT = 18, padB = 40;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const start = iv.insightCashRevenue;
  const afterDisb = start - iv.insightDisbursement;
  const afterRisk = afterDisb - iv.riskExposure;
  const finalResult = iv.netResult - iv.riskExposure;

  const steps = [
    { name: 'Caixa Insight', from: 0, to: start, color: C.primary, total: true },
    { name: 'Desembolso total', from: start, to: afterDisb, color: C.cost },
    { name: 'Contingências', from: afterDisb, to: afterRisk, color: iv.riskExposure ? C.critical : C.subtle },
    { name: 'Resultado Insight', from: 0, to: finalResult, color: finalResult >= 0 ? C.success : C.critical, total: true },
  ];

  const all = steps.flatMap((s) => [s.from, s.to]);
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (min === max) max = min + 1;
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH;
  const colW = plotW / steps.length;
  const barW = colW * 0.5;

  const ticks = niceTicks(min, max, 4);
  const gridLines = ticks
    .map((t) => {
      const y = yAt(t).toFixed(1);
      return `<line x1="${padL}" y1="${y}" x2="${padL + plotW}" y2="${y}" stroke="${C.grid}" stroke-width="1"/>` +
        `<text x="${padL - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="${C.subtle}">${esc(compactBRL(t))}</text>`;
    })
    .join('');

  const bars = steps
    .map((s, i) => {
      const x = padL + i * colW + (colW - barW) / 2;
      const top = Math.min(yAt(s.from), yAt(s.to));
      const h = Math.max(1, Math.abs(yAt(s.from) - yAt(s.to)));
      const value = s.total ? s.to : s.to - s.from;
      const labelY = top - 4;
      return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}" rx="2"/>` +
        `<text x="${(x + barW / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${s.color}">${esc(BRL(value))}</text>` +
        `<text x="${(x + barW / 2).toFixed(1)}" y="${(height - 22).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${C.body}">${esc(s.name)}</text>`;
    })
    .join('');

  const zeroLine = min < 0
    ? `<line x1="${padL}" y1="${yAt(0).toFixed(1)}" x2="${padL + plotW}" y2="${yAt(0).toFixed(1)}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
    : '';

  const note = `<text x="${padL}" y="${height - 6}" font-size="8" fill="${C.subtle}">Faturamento direto (repasse a terceiros, fora do caixa): ${esc(BRL(iv.directPassThrough))}</text>`;

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${gridLines}${zeroLine}${bars}${note}</svg>`;
}

function emptyChart(width: number, height: number): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#F8FAFC" rx="6"/>` +
    `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="${C.subtle}">Dados insuficientes para este gráfico</text></svg>`;
}

function legend(items: { name: string; color: string; dashed?: boolean }[]): string {
  return `<div class="legend">${items
    .map((i) => `<span class="lg"><span class="sw" style="background:${i.color};${i.dashed ? 'background:repeating-linear-gradient(90deg,' + i.color + ' 0 4px,transparent 4px 7px);' : ''}"></span>${esc(i.name)}</span>`)
    .join('')}</div>`;
}

// ── Payload ─────────────────────────────────────────────────────────

export interface ProjectFinanceReportPayload {
  project: ProjectV2;
  ledgerView?: ProjectFinanceView;
  cutoffPeriod?: string;
  brandName?: string;
  dataSourceNote?: string;
  generatedBy?: string;
}

export function buildProjectFinanceFileName(project: ProjectV2, date = new Date()): string {
  const code = (project.codigo || project.id || 'projeto')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const ymd = date.toISOString().slice(0, 10);
  return `project-finance-report-${code}-${ymd}`;
}

// ── KPI / warning model helpers (read from the shared iv — no new math) ──

function buildKpis(iv: InvestorView): { label: string; value: string; color?: string; helper?: string; missing?: boolean }[] {
  return [
    { label: 'Valor do contrato', value: BRL(iv.contractTotal), helper: 'teto contratado' },
    { label: 'Caixa Insight previsto', value: BRL(iv.insightCashRevenue), color: C.success, helper: 'entra no caixa' },
    { label: 'Desembolso total', value: BRL(iv.insightDisbursement), color: C.cost, helper: 'Curva S + projeção' },
    { label: 'Resultado final Insight', value: BRL(iv.netResult), color: iv.netResult >= 0 ? C.success : C.critical, helper: 'caixa − desembolso' },
    { label: 'Margem estimada', value: fmtPct(iv.marginPct), missing: iv.marginPct == null, color: C.purple, helper: 'sobre caixa Insight' },
    { label: 'Pico de caixa', value: iv.peakGap ? BRL(iv.peakGap) : 'sem gap', color: iv.peakGap ? C.critical : C.success, helper: iv.peakGap ? `em ${periodLabel(iv.peakGapPeriod)}` : 'sem saldo negativo' },
    { label: 'Break-even', value: iv.breakEvenPeriod ? periodLabel(iv.breakEvenPeriod) : 'não projetado', missing: !iv.breakEvenPeriod, color: C.info, helper: 'lucro acumulado sustentado' },
    { label: 'Receita a faturar', value: BRL(iv.toBill), color: C.warning, helper: `${fmtPct(iv.pendingRevenuePct)} do contrato` },
    { label: 'Eventos atrasados', value: String(iv.delayedEvents.length), color: iv.delayedEvents.length ? C.critical : C.success, helper: 'no eventograma' },
    { label: 'Risco financeiro', value: severityLabel(iv.financialRisk), color: sevColor(iv.financialRisk), helper: iv.openFinancialRisks.length ? `${iv.openFinancialRisks.length} em aberto` : 'sem riscos abertos' },
  ];
}

/** Deterministic investor narrative — pure string composition over the shared iv (no new math). */
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

// ── Section renderers ───────────────────────────────────────────────

function indexOfPeriod(periods: string[], period?: string | null): number {
  if (!period) return -1;
  return periods.indexOf(period);
}

function renderCurvaS(iv: InvestorView, effectiveCutoff?: string): string {
  const periods = iv.curve.map((p) => p.period);
  if (!periods.length) return emptyChart(900, 360);

  const series: LineSeries[] = [
    { name: 'Receita prevista', color: C.primary, values: iv.curve.map((p) => p.receitaPrevista) },
    { name: 'Receita realizada', color: C.successSoft, values: iv.curve.map((p) => p.receitaRealizada) },
    { name: 'Desembolso previsto', color: C.cost, values: iv.curve.map((p) => p.desembolsoPrevisto) },
    { name: 'Desembolso realizado', color: C.costSoft, values: iv.curve.map((p) => p.desembolsoRealizado) },
    { name: 'Projeção custos fixos', color: C.warning, dashed: true, values: iv.curve.map((p) => p.desembolsoProjetado) },
    { name: 'Saldo líquido', color: C.info, values: iv.curve.map((p) => p.saldoLiquido) },
  ].filter((s) => s.values.some((v) => v != null));

  const markers: ChartMarker[] = [];
  const cutIdx = indexOfPeriod(periods, effectiveCutoff);
  if (cutIdx >= 0) markers.push({ index: cutIdx, label: 'CUTOFF', color: C.subtle });
  const beIdx = indexOfPeriod(periods, iv.breakEvenPeriod);
  if (beIdx >= 0) markers.push({ index: beIdx, label: 'BREAK-EVEN', color: C.success });
  const peakIdx = indexOfPeriod(periods, iv.peakGapPeriod);
  if (peakIdx >= 0 && iv.peakGap > 0) markers.push({ index: peakIdx, label: 'PICO CAIXA', color: C.critical });

  return svgLineChart(periods, series, { width: 1040, height: 380, markers }) +
    legend(series.map((s) => ({ name: s.name, color: s.color, dashed: s.dashed })));
}

function renderMonthlyFlow(iv: InvestorView): string {
  const periods = iv.curve.map((p) => p.period);
  if (!periods.length) return emptyChart(900, 320);
  const bars: BarSeries[] = [
    { name: 'Receita mensal', color: C.successSoft, values: iv.curve.map((p) => p.receitaMensal) },
    { name: 'Desembolso mensal', color: C.cost, values: iv.curve.map((p) => p.desembolsoMensal) },
  ];
  const highlight = iv.curve.map((p) => p.resultadoMensal);
  return svgGroupedBarChart(periods, bars, { width: 1040, height: 320, highlightNegative: highlight }) +
    legend([...bars.map((b) => ({ name: b.name, color: b.color })), { name: 'Mês com saldo líquido negativo', color: C.critical }]);
}

function renderEventTable(iv: InvestorView): string {
  const events = iv.criticalEvents;
  if (!events.length) {
    return `<p class="empty">Sem eventos de faturamento relevantes (próximos, atrasados, maiores ou pendentes).</p>`;
  }
  const rows = events
    .map((e, i) => {
      const linked = e.contractId
        ? `Contrato ${esc(e.contractId)}`
        : (e.linked?.milestoneId ? `Marco ${esc(e.linked.milestoneId)}` : (e.linked?.taskId ? `Tarefa ${esc(e.linked.taskId)}` : '—'));
      const value = centsToReais(e.amountActualCents ?? e.amountPlannedCents);
      const sevCls = e.status === 'delayed' || e.status === 'cancelled' ? 'crit' : e.status === 'billed' ? 'ok' : e.status === 'partial' ? 'warn' : '';
      return `<tr>
        <td class="num">${i + 1}</td>
        <td>${esc(e.title)}</td>
        <td>${esc(periodLabel(e.datePlanned.slice(0, 7)))}</td>
        <td class="num mono">${esc(BRL(value))}</td>
        <td><span class="pill ${sevCls}">${esc(statusLabelPt(e.status))}</span></td>
        <td class="muted">${linked}</td>
      </tr>`;
    })
    .join('');
  return `<table class="data">
    <thead><tr><th class="num">#</th><th>Descrição</th><th>Mês</th><th class="num">Valor</th><th>Status</th><th>Vínculo</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderEventCards(iv: InvestorView, eventStats: ReturnType<typeof computeEventStats>): string {
  const next = iv.nextEvent;
  const cards = [
    { label: 'Próximo evento', value: next ? compactBRL(centsToReais(next.amountPlannedCents)) : 'sem pendência', helper: next ? `${esc(next.title)} · ${periodLabel(next.datePlanned.slice(0, 7))}` : '—', color: C.info },
    { label: 'Eventos atrasados', value: String(iv.delayedEvents.length), helper: iv.delayedEvents.length ? `valor ${compactBRL(eventStats.delayedValue)}` : 'nenhum', color: iv.delayedEvents.length ? C.critical : C.success },
    { label: 'Maior evento', value: eventStats.biggest ? compactBRL(centsToReais(eventStats.biggest.amountPlannedCents)) : '—', helper: eventStats.biggest ? esc(eventStats.biggest.title) : '—', color: C.purple },
    { label: 'Pendente de faturar', value: compactBRL(eventStats.pendingValue), helper: 'eventos não faturados', color: C.warning },
    { label: 'Faturado', value: compactBRL(eventStats.billedValue), helper: 'eventos faturados/parciais', color: C.success },
  ];
  return `<div class="mini-cards">${cards
    .map((c) => `<div class="mini-card"><div class="bar" style="background:${c.color}"></div><div class="mc-l">${esc(c.label)}</div><div class="mc-v" style="color:${c.color}">${c.value}</div><div class="mc-h">${c.helper}</div></div>`)
    .join('')}</div>`;
}

function renderSensitivity(rows: SensitivityRow[]): string {
  const bars = rows.map((r) => ({
    label: r.label,
    value: r.result,
    color: r.result < 0 ? C.critical : r.label === 'Base' ? C.primary : C.info,
  }));
  const table = `<table class="data compact">
    <thead><tr><th>Cenário</th><th class="num">Resultado</th><th class="num">Margem</th></tr></thead>
    <tbody>${rows
      .map((r) => `<tr><td>${esc(r.label)}</td><td class="num mono" style="color:${r.result < 0 ? C.critical : C.body}">${esc(BRL(r.result))}</td><td class="num mono">${esc(fmtPct(r.margin))}</td></tr>`)
      .join('')}</tbody></table>`;
  return svgHBarChart(bars, { width: 520 }) + table;
}

function renderInternalAppendix(view?: ProjectFinanceView): string {
  const hasData = view && (view.baf.bac > 0 || view.baf.ac > 0 || view.baf.eac > 0);
  if (!hasData) {
    return `<p class="empty">Dados de controle interno ainda não disponíveis.</p>`;
  }
  const baf = view!.baf;
  const kpis = [
    { label: 'Orçamento (BAC)', value: BRL(baf.bac), color: C.info },
    { label: 'Custo realizado (AC)', value: BRL(baf.ac), color: C.success },
    { label: 'Estimativa ao concluir (EAC)', value: BRL(baf.eac), color: C.cost },
    { label: 'Estimativa para concluir (ETC)', value: BRL(baf.etc), color: C.warning },
  ];
  const kpiHtml = `<div class="kpis cols-4">${kpis
    .map((k) => `<div class="kpi"><div class="bar" style="background:${k.color}"></div><div class="kpi-l">${esc(k.label)}</div><div class="kpi-v" style="color:${k.color}">${k.value}</div></div>`)
    .join('')}</div>`;

  const rows = view!.costBreakdown
    .map((r) => {
      const variance = r.eac - r.bac;
      const varPct = r.bac > 0 ? (variance / r.bac) * 100 : 0;
      const vc = variance > 0 ? C.critical : C.success;
      return `<tr><td>${esc(r.category)}</td><td class="num mono">${esc(BRL(r.bac))}</td><td class="num mono">${esc(BRL(r.ac))}</td><td class="num mono">${esc(BRL(r.eac))}</td><td class="num mono" style="color:${vc}">${variance > 0 ? '+' : ''}${esc(BRL(variance))}</td><td class="num mono" style="color:${vc}">${variance > 0 ? '+' : ''}${varPct.toFixed(1)}%</td></tr>`;
    })
    .join('');
  const table = rows
    ? `<table class="data compact"><thead><tr><th>Categoria</th><th class="num">BAC</th><th class="num">AC</th><th class="num">EAC</th><th class="num">Var (R$)</th><th class="num">Var (%)</th></tr></thead><tbody>${rows}</tbody></table>`
    : '';
  return kpiHtml + table;
}

// ── Main renderer ───────────────────────────────────────────────────

export function buildProjectFinanceReportHtml(payload: ProjectFinanceReportPayload): string {
  const { project, ledgerView, cutoffPeriod, dataSourceNote, generatedBy } = payload;
  const brand = payload.brandName ?? 'Insight Energy — Governança Corporativa';

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
  const title = 'Relatório Financeiro do Projeto';
  const fileName = buildProjectFinanceFileName(project);

  const kpiCards = kpis
    .map((k) => `<div class="kpi">
      <div class="bar" style="background:${k.color ?? C.ink}"></div>
      <div class="kpi-l">${esc(k.label)}</div>
      <div class="kpi-v" style="color:${k.missing ? C.subtle : (k.color ?? C.ink)}">${k.missing ? 'dados insuficientes' : esc(k.value)}</div>
      ${k.helper ? `<div class="kpi-h">${esc(k.helper)}</div>` : ''}
    </div>`)
    .join('');

  const summaryRows = [
    ['Valor do projeto', BRL(iv.contractTotal)],
    ['Faturado', BRL(iv.billed)],
    ['A faturar', BRL(iv.toBill)],
    ['Desembolso previsto', BRL(iv.insightDisbursement)],
    ['Resultado projetado', BRL(iv.netResult)],
    ['Margem estimada', fmtPct(iv.marginPct)],
    ['Pico de necessidade de caixa', iv.peakGap ? `${BRL(iv.peakGap)} (${periodLabel(iv.peakGapPeriod)})` : 'sem gap de caixa'],
    ['Break-even', iv.breakEvenPeriod ? periodLabel(iv.breakEvenPeriod) : 'não projetado'],
    ['Risco financeiro', severityLabel(iv.financialRisk)],
  ];

  const warningsHtml = warnings.length
    ? `<ul class="warn-list">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : `<p class="empty">Sem alertas de qualidade de dados ou riscos financeiros críticos no momento.</p>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>${esc(fileName)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 12mm 16mm; }
  @page :first { margin-top: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: ${C.ink};
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { padding: 0 2mm; }
  .page-break { page-break-before: always; }
  .section { margin: 0 0 14px; page-break-inside: avoid; }
  h1 { font-size: 22px; margin: 0 0 2px; line-height: 1.15; }
  h2 { font-size: 13px; margin: 0 0 10px; text-transform: uppercase; letter-spacing: .1em;
    color: ${C.ink}; border-bottom: 1px solid ${C.border}; padding-bottom: 5px; }
  h3 { font-size: 11px; margin: 0 0 6px; color: ${C.muted}; text-transform: uppercase; letter-spacing: .08em; }
  .sub { color: ${C.subtle}; font-size: 11px; }
  .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, Menlo, monospace; }
  .num { text-align: right; }
  .muted { color: ${C.subtle}; }
  .empty { color: ${C.subtle}; font-size: 11px; font-style: italic; padding: 8px 0; }

  /* Cover header */
  header.cover { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px;
    border-bottom: 2px solid ${C.primary}; padding-bottom: 14px; margin-bottom: 16px; }
  .brand-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .logo { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px;
    border-radius: 9px; background: linear-gradient(135deg, ${C.primary}, ${C.info}); color: #fff;
    font-weight: 800; font-size: 16px; letter-spacing: -0.5px; }
  .brand-name { font-weight: 700; font-size: 13px; color: ${C.ink}; }
  .brand-name small { display: block; font-weight: 600; color: ${C.primary}; font-size: 9px;
    letter-spacing: .14em; text-transform: uppercase; }
  .meta { text-align: right; font-size: 10.5px; color: ${C.muted}; line-height: 1.7; }
  .meta b { color: ${C.ink}; }
  .proj-line { font-size: 13px; color: ${C.body}; margin-top: 6px; }
  .proj-line b { color: ${C.ink}; }

  /* Executive summary + KPIs */
  .exec { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; align-items: start; }
  .narrative p { margin: 0 0 7px; font-size: 11.5px; color: ${C.body}; }
  table.summary { width: 100%; border-collapse: collapse; }
  table.summary td { padding: 4px 4px; border-bottom: 1px solid ${C.border}; font-size: 11px; }
  table.summary td:last-child { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }

  .kpis { display: grid; gap: 8px; margin-top: 4px; }
  .kpis.cols-5 { grid-template-columns: repeat(5, 1fr); }
  .kpis.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .kpi { position: relative; border: 1px solid ${C.border}; border-radius: 8px; padding: 9px 10px 8px;
    background: #FCFDFE; overflow: hidden; page-break-inside: avoid; }
  .kpi .bar { position: absolute; top: 0; left: 0; right: 0; height: 2.5px; }
  .kpi-l { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: ${C.subtle}; }
  .kpi-v { font-size: 15px; font-weight: 700; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .kpi-h { font-size: 8.5px; color: ${C.subtle}; margin-top: 2px; }

  /* Mini cards (eventogram) */
  .mini-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 12px; }
  .mini-card { position: relative; border: 1px solid ${C.border}; border-radius: 8px; padding: 8px 10px; overflow: hidden; }
  .mini-card .bar { position: absolute; top: 0; left: 0; right: 0; height: 2.5px; }
  .mc-l { font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: ${C.subtle}; }
  .mc-v { font-size: 15px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .mc-h { font-size: 8.5px; color: ${C.subtle}; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Charts */
  .chart { border: 1px solid ${C.border}; border-radius: 10px; padding: 10px 12px; background: #fff; page-break-inside: avoid; }
  .legend { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px; justify-content: center; }
  .legend .lg { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; color: ${C.muted}; }
  .legend .sw { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }

  /* Tables */
  table.data { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-top: 6px; }
  table.data thead th { text-align: left; background: #F8FAFC; border-bottom: 1.5px solid ${C.borderStrong};
    padding: 6px 7px; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: ${C.muted}; }
  table.data tbody td { padding: 5px 7px; border-bottom: 1px solid ${C.border}; }
  table.data tbody tr { page-break-inside: avoid; }
  table.data.compact { font-size: 10px; }
  table.data thead { display: table-header-group; }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 9px; font-weight: 600;
    background: #EEF2F6; color: ${C.muted}; }
  .pill.ok { background: #ECFDF5; color: ${C.success}; }
  .pill.warn { background: #FFFBEB; color: ${C.warning}; }
  .pill.crit { background: #FEF2F2; color: ${C.critical}; }

  .warn-list { margin: 4px 0 0; padding-left: 18px; }
  .warn-list li { font-size: 11px; color: ${C.body}; margin-bottom: 4px; }

  /* Running footer with page numbers */
  .footer { position: fixed; bottom: -12mm; left: 0; right: 0; display: flex; justify-content: space-between;
    align-items: center; font-size: 8.5px; color: ${C.subtle}; border-top: 1px solid ${C.border}; padding-top: 3px; }
  .page-num::before { content: counter(page); }
  .page-total::before { content: counter(pages); }

  /* Screen-only toolbar */
  .toolbar { position: fixed; top: 12px; right: 12px; z-index: 20; background: ${C.ink}; color: #fff;
    padding: 8px 12px; border-radius: 10px; display: flex; gap: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.18); }
  .toolbar button { background: ${C.primary}; color: #fff; border: 0; border-radius: 6px; padding: 6px 12px;
    font-weight: 600; cursor: pointer; font-size: 11px; }
  .toolbar button.alt { background: transparent; border: 1px solid rgba(255,255,255,.25); }

  @media print { .no-print { display: none !important; } .footer { display: flex; } }
  @media screen { .footer { display: none; } body { background: #f1f5f9; } .page { background: #fff; max-width: 1100px; margin: 16px auto; padding: 22px; box-shadow: 0 1px 6px rgba(0,0,0,.12); } }
</style></head>
<body>
  <div class="toolbar no-print">
    <button onclick="window.print()">Imprimir / Salvar PDF</button>
    <button class="alt" onclick="window.close()">Fechar</button>
  </div>

  <div class="footer">
    <span>${esc(brand)} · ${esc(project.nome)} · Confidencial</span>
    <span>Página <span class="page-num"></span> de <span class="page-total"></span></span>
  </div>

  <!-- PAGE 1 — Cover + Executive summary + KPIs -->
  <div class="page">
    <header class="cover">
      <div>
        <div class="brand-row">
          <span class="logo">IE</span>
          <span class="brand-name">${esc(brand)}<small>Project Finance Review</small></span>
        </div>
        <h1>${esc(title)}</h1>
        <div class="proj-line"><b>${esc(project.nome)}</b> · ${esc(project.codigo || '—')}${project.cliente ? ` · ${esc(project.cliente)}` : ''}</div>
      </div>
      <div class="meta">
        <div><b>Gerado em</b> ${esc(generated)}</div>
        ${generatedBy ? `<div><b>Por</b> ${esc(generatedBy)}</div>` : ''}
        <div><b>Período</b> ${esc(rangeLabel)}</div>
        ${effectiveCutoff ? `<div><b>Data de corte</b> ${esc(periodLabel(effectiveCutoff))}</div>` : ''}
        <div class="sub">${esc(dataSourceNote ?? 'Fonte: Financeiro (ledger oficial) + eventograma do projeto')}</div>
      </div>
    </header>

    <section class="section">
      <h2>Resumo Executivo</h2>
      <div class="exec">
        <div class="narrative">
          ${narrative.map((s) => `<p>${esc(s)}</p>`).join('')}
        </div>
        <table class="summary">
          ${summaryRows.map(([l, v]) => `<tr><td>${esc(l)}</td><td>${esc(v)}</td></tr>`).join('')}
        </table>
      </div>
    </section>

    <section class="section">
      <h2>Indicadores Financeiros</h2>
      <div class="kpis cols-5">${kpiCards}</div>
    </section>
  </div>

  <!-- PAGE 2 — Curva S -->
  <div class="page page-break">
    <section class="section">
      <h2>Curva S — Receita × Desembolso</h2>
      <div class="chart">${renderCurvaS(iv, effectiveCutoff)}</div>
    </section>
    <section class="section">
      <h2>Fluxo Mensal do Projeto</h2>
      <div class="chart">${renderMonthlyFlow(iv)}</div>
    </section>
  </div>

  <!-- PAGE 3 — Eventograma -->
  <div class="page page-break">
    <section class="section">
      <h2>Eventograma de Faturamento</h2>
      ${renderEventCards(iv, eventStats)}
      ${renderEventTable(iv)}
    </section>
  </div>

  <!-- PAGE 4 — Resultado projetado + Sensibilidade + Qualidade -->
  <div class="page page-break">
    <section class="section">
      <h2>Resultado Projetado</h2>
      <div class="chart">${svgWaterfall(iv, { width: 1040, height: 320 })}</div>
    </section>
    <div class="two-col">
      <section class="section">
        <h3>Sensibilidade / Riscos Financeiros</h3>
        ${renderSensitivity(sensitivity)}
      </section>
      <section class="section">
        <h3>Qualidade de Dados &amp; Alertas</h3>
        ${warningsHtml}
      </section>
    </div>
  </div>

  <!-- APPENDIX — Internal control -->
  <div class="page page-break">
    <section class="section">
      <h2>Apêndice — Controle Interno do Projeto</h2>
      <div class="sub" style="margin-bottom:8px">BAC / AC / EAC / ETC e detalhamento de custos · ledger oficial</div>
      ${renderInternalAppendix(ledgerView)}
    </section>
  </div>

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
    const html = buildProjectFinanceReportHtml(payload);
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
