/**
 * Declarative chart spec shared by the Finance report builders. A page passes a
 * `FinanceChartSpec` (donut / signed bars / trend / grouped) and the engine
 * renders it as print-safe inline SVG with the right value formatting.
 */

import { BRL, compactBRL, fmtInt } from './report-formatters';
import { C } from './report-theme';
import { svgDonut, svgHorizontalBar, svgLineChart, svgGroupedBarChart, legend } from './report-charts';

export type FinanceValueFmt = 'currency' | 'compactCurrency' | 'number' | 'percent';

export type FinanceChartSpec =
  | { kind: 'donut'; slices: { label: string; value: number; color?: string }[]; center?: string; valueFmt?: FinanceValueFmt }
  | { kind: 'bars'; rows: { label: string; value: number; color?: string }[]; valueFmt?: FinanceValueFmt; signed?: boolean }
  | { kind: 'trend'; labels: string[]; series: { name: string; values: number[]; color?: string; dashed?: boolean }[]; valueFmt?: FinanceValueFmt }
  | { kind: 'grouped'; labels: string[]; series: { name: string; values: number[]; color?: string }[]; valueFmt?: FinanceValueFmt };

const CATEGORICAL_3 = [C.primary, C.info, C.success];

export function financeValueFormatter(fmt?: FinanceValueFmt): (n: number) => string {
  switch (fmt) {
    case 'currency': return BRL;
    case 'number': return (n) => fmtInt(n);
    case 'percent': return (n) => `${n.toFixed(1)}%`;
    case 'compactCurrency':
    default: return compactBRL;
  }
}

export function renderFinanceChart(spec: FinanceChartSpec): string {
  const fv = financeValueFormatter(spec.valueFmt);
  if (spec.kind === 'donut') {
    return svgDonut(spec.slices, { width: 380, centerLabel: spec.center, fmtValue: fv });
  }
  if (spec.kind === 'bars') {
    return svgHorizontalBar(
      spec.rows.map((r) => ({
        label: r.label,
        value: r.value,
        color: r.color ?? (spec.signed ? (r.value >= 0 ? C.success : C.critical) : undefined),
      })),
      { width: 560, fmtValue: fv, labelW: 160 },
    );
  }
  if (spec.kind === 'trend') {
    return svgLineChart(
      spec.labels,
      spec.series.map((s, i) => ({ name: s.name, color: s.color ?? CATEGORICAL_3[i % 3], values: s.values, dashed: s.dashed, endLabel: true })),
      { width: 560, height: 230, xLabel: (x) => x, fmtValue: fv },
    );
  }
  return svgGroupedBarChart(
    spec.labels,
    spec.series.map((s, i) => ({ name: s.name, color: s.color ?? CATEGORICAL_3[i % 3], values: s.values })),
    { width: 560, height: 240, xLabel: (x) => x, fmtValue: fv },
  );
}

/** ViewBox dimensions of the SVG a spec renders — used by height estimators. */
export function financeChartDims(spec: FinanceChartSpec): { w: number; h: number } {
  if (spec.kind === 'donut') return { w: 380, h: 200 };
  if (spec.kind === 'bars') return { w: 560, h: spec.rows.length * 26 + 8 };
  if (spec.kind === 'trend') return { w: 560, h: 230 };
  return { w: 560, h: 240 };
}

export function financeChartLegend(spec: FinanceChartSpec): string {
  if (spec.kind === 'trend') {
    return legend(spec.series.map((s, i) => ({ name: s.name, color: s.color ?? CATEGORICAL_3[i % 3], dashed: s.dashed })));
  }
  if (spec.kind === 'grouped') {
    return legend(spec.series.map((s, i) => ({ name: s.name, color: s.color ?? CATEGORICAL_3[i % 3] })));
  }
  return '';
}
