'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useFinanceChartTokens } from './FinanceMiniChart';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const TOOLTIP = {
  backgroundColor: 'rgba(15,17,21,0.95)',
  borderColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
  textStyle: { color: '#E6E9EE', fontSize: 11 },
  extraCssText: 'border-radius:10px;backdrop-filter:blur(10px);box-shadow:0 18px 40px -20px rgba(0,0,0,0.5);',
};

const fmtCompact = (v: number) =>
  v >= 1_000_000_000 ? `${(v / 1_000_000_000).toFixed(1)}B`
  : v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
  : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k`
  : `${v}`;

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'budget' | 'textStrong';

/* ----------------------------------------------------------------- */
/* S-CURVE — cumulative line chart                                    */
/* ----------------------------------------------------------------- */
export interface SCurveSeries { name: string; values: number[]; tone?: Tone; dashed?: boolean; emphasized?: boolean }

export function FinanceSCurveChart({
  categories, series, height = 260, showArea = true,
}: { categories: string[]; series: SCurveSeries[]; height?: number; showArea?: boolean }) {
  const t = useFinanceChartTokens();
  const option = useMemo(() => ({
    grid: { top: 28, left: 52, right: 18, bottom: 28 },
    legend: { textStyle: { color: t.text, fontSize: 11 }, top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross', lineStyle: { color: 'rgba(255,255,255,0.18)' }, label: { backgroundColor: 'rgba(20,20,26,0.95)' } }, ...TOOLTIP, valueFormatter: (v: number) => fmtBRL(v) },
    xAxis: {
      type: 'category', boundaryGap: false, data: categories,
      axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 10 },
    },
    yAxis: {
      type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } },
      axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => fmtCompact(v) },
    },
    series: series.map((s, idx) => {
      const cumulative: number[] = [];
      let acc = 0;
      s.values.forEach((v) => { acc += v; cumulative.push(acc); });
      const color = (t as any)[s.tone || (['accent', 'info', 'success', 'warning', 'danger'][idx] as Tone)];
      return {
        name: s.name, type: 'line', smooth: 0.45, symbol: 'circle', symbolSize: 5,
        data: cumulative,
        lineStyle: { width: s.emphasized ? 2.4 : 1.6, color, type: s.dashed ? 'dashed' : 'solid' },
        itemStyle: { color, borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1 },
        areaStyle: showArea && idx === 0 ? {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(34,211,238,0.30)' }, { offset: 1, color: 'rgba(34,211,238,0)' }] },
        } : undefined,
        emphasis: { focus: 'series', lineStyle: { width: 2.6 } },
      };
    }),
  }), [categories, series, t, showArea]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* DONUT — premium ring                                               */
/* ----------------------------------------------------------------- */
export interface DonutSlice { name: string; value: number; tone?: Tone }

export function FinanceDonutChart({
  data, height = 240, centerLabel, centerValue,
}: { data: DonutSlice[]; height?: number; centerLabel?: string; centerValue?: string }) {
  const t = useFinanceChartTokens();
  const palette: Tone[] = ['accent', 'info', 'success', 'warning', 'danger', 'budget'];
  const total = data.reduce((a, d) => a + d.value, 0);

  const option = useMemo(() => ({
    tooltip: { trigger: 'item', ...TOOLTIP, valueFormatter: (v: number) => `${fmtBRL(v)} (${((v / total) * 100).toFixed(1)}%)` },
    legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: t.text, fontSize: 11 }, icon: 'circle', itemWidth: 8, itemHeight: 8, itemGap: 8 },
    title: centerLabel ? {
      text: centerValue || '',
      subtext: centerLabel,
      left: '32%', top: 'center', textAlign: 'center',
      textStyle: { color: t.textStrong, fontSize: 18, fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      subtextStyle: { color: t.text, fontSize: 10, fontFamily: 'inherit' },
    } : undefined,
    series: [{
      type: 'pie', radius: ['58%', '82%'], center: ['32%', '50%'],
      itemStyle: { borderColor: 'rgba(15,17,21,0.6)', borderWidth: 2, borderRadius: 6 },
      label: { show: false },
      labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 14, shadowColor: 'rgba(0,0,0,0.45)' } },
      data: data.map((d, i) => ({
        name: d.name, value: d.value,
        itemStyle: { color: (t as any)[d.tone || palette[i % palette.length]] },
      })),
    }],
  }), [data, centerLabel, centerValue, total, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* TREEMAP                                                            */
/* ----------------------------------------------------------------- */
export interface TreemapNode { name: string; value: number; tone?: Tone; deltaPct?: number; children?: TreemapNode[] }

export function FinanceTreemapChart({
  data, height = 320,
}: { data: TreemapNode[]; height?: number }) {
  const t = useFinanceChartTokens();

  const colorize = (node: TreemapNode, idx: number): any => {
    const palette: Tone[] = ['accent', 'info', 'success', 'warning', 'danger', 'budget'];
    const color = (t as any)[node.tone || palette[idx % palette.length]];
    return {
      name: node.name, value: node.value,
      itemStyle: { color, gapWidth: 2, borderColor: 'rgba(15,17,21,0.55)', borderWidth: 1, borderRadius: 6 },
      label: {
        formatter: (p: any) => {
          const d = node.deltaPct;
          return [
            `{title|${node.name}}`,
            `{value|${fmtCompact(node.value)}}` + (d !== undefined ? ` {delta|${d >= 0 ? '+' : ''}${d.toFixed(1)}%}` : ''),
          ].join('\n');
        },
        rich: {
          title: { color: t.textStrong, fontSize: 11, fontWeight: 600, lineHeight: 14 },
          value: { color: t.text, fontSize: 10, lineHeight: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          delta: { color: '#FFFFFF', fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
        },
      },
      children: node.children?.map((c, i) => colorize(c, i)),
    };
  };

  const option = useMemo(() => ({
    tooltip: { ...TOOLTIP, formatter: (p: any) => `<div style="font-weight:600">${p.name}</div><div style="font-family:ui-monospace,Menlo,monospace">${fmtBRL(p.value)}</div>` },
    series: [{
      type: 'treemap',
      roam: false,
      breadcrumb: { show: false },
      nodeClick: false,
      width: '100%', height: '100%',
      data: data.map((d, i) => colorize(d, i)),
      visibleMin: 0,
      upperLabel: { show: false },
      label: { show: true, position: 'insideTopLeft', padding: [6, 8] },
      itemStyle: { gapWidth: 4, borderRadius: 8, borderWidth: 2, borderColor: 'rgba(15,17,21,0.65)' },
      emphasis: { itemStyle: { shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.45)' } },
    }],
  }), [data, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* RADAR                                                              */
/* ----------------------------------------------------------------- */
export interface RadarSeries { name: string; values: number[]; tone?: Tone }

export function FinanceRadarChart({
  indicators, series, height = 280, max = 100,
}: { indicators: string[]; series: RadarSeries[]; height?: number; max?: number }) {
  const t = useFinanceChartTokens();
  const palette: Tone[] = ['accent', 'info', 'warning', 'danger', 'success'];

  const option = useMemo(() => ({
    tooltip: { ...TOOLTIP },
    legend: { textStyle: { color: t.text, fontSize: 11 }, top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4 },
    radar: {
      indicator: indicators.map((i) => ({ name: i, max })),
      shape: 'polygon',
      splitNumber: 4,
      axisName: { color: t.text, fontSize: 10 },
      splitLine: { lineStyle: { color: t.grid } },
      splitArea: { areaStyle: { color: ['rgba(255,255,255,0.015)', 'rgba(255,255,255,0.03)'] } },
      axisLine: { lineStyle: { color: t.axis } },
    },
    series: [{
      type: 'radar',
      data: series.map((s, idx) => {
        const color = (t as any)[s.tone || palette[idx % palette.length]];
        return {
          name: s.name, value: s.values,
          lineStyle: { width: 1.6, color },
          areaStyle: { color, opacity: 0.18 },
          itemStyle: { color, borderColor: 'rgba(255,255,255,0.6)', borderWidth: 1 },
          symbol: 'circle', symbolSize: 5,
        };
      }),
    }],
  }), [indicators, series, max, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* BUBBLE                                                             */
/* ----------------------------------------------------------------- */
export interface BubblePoint { id?: string; label: string; x: number; y: number; size: number; tone?: Tone; meta?: string }

export function FinanceBubbleChart({
  points, xAxisLabel, yAxisLabel, height = 320, xFormatter, yFormatter,
}: {
  points: BubblePoint[]; xAxisLabel: string; yAxisLabel: string; height?: number;
  xFormatter?: (v: number) => string; yFormatter?: (v: number) => string;
}) {
  const t = useFinanceChartTokens();
  const palette: Tone[] = ['accent', 'info', 'success', 'warning', 'danger'];
  const minSize = 18, maxSize = 56;
  const sizes = points.map((p) => p.size);
  const minS = Math.min(...sizes, 0), maxS = Math.max(...sizes, 1);

  const option = useMemo(() => ({
    grid: { top: 28, left: 56, right: 18, bottom: 36 },
    tooltip: {
      ...TOOLTIP,
      formatter: (p: any) => {
        const pt = points[p.dataIndex];
        return `<div style="font-weight:600">${pt.label}</div>
        <div>${xAxisLabel}: <span style="font-family:ui-monospace,Menlo,monospace">${xFormatter ? xFormatter(pt.x) : pt.x.toFixed(1)}</span></div>
        <div>${yAxisLabel}: <span style="font-family:ui-monospace,Menlo,monospace">${yFormatter ? yFormatter(pt.y) : pt.y.toFixed(1)}</span></div>
        <div>Size: <span style="font-family:ui-monospace,Menlo,monospace">${fmtCompact(pt.size)}</span></div>
        ${pt.meta ? `<div style="margin-top:2px;color:#A8B0BD">${pt.meta}</div>` : ''}`;
      },
    },
    xAxis: {
      type: 'value', name: xAxisLabel, nameTextStyle: { color: t.text, fontSize: 10 }, nameGap: 22, nameLocation: 'middle',
      axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
      splitLine: { lineStyle: { color: t.grid } },
      axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => xFormatter ? xFormatter(v) : `${v}` },
    },
    yAxis: {
      type: 'value', name: yAxisLabel, nameTextStyle: { color: t.text, fontSize: 10 },
      axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } },
      axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => yFormatter ? yFormatter(v) : fmtCompact(v) },
    },
    series: [{
      type: 'scatter',
      data: points.map((p) => [p.x, p.y]),
      symbolSize: (_v: any, params: any) => {
        const s = points[params.dataIndex].size;
        if (maxS === minS) return (minSize + maxSize) / 2;
        return minSize + ((s - minS) / (maxS - minS)) * (maxSize - minSize);
      },
      itemStyle: {
        color: (params: any) => {
          const pt = points[params.dataIndex];
          const tone = pt.tone || palette[params.dataIndex % palette.length];
          return {
            type: 'radial', x: 0.4, y: 0.35, r: 0.65,
            colorStops: [
              { offset: 0, color: `color-mix(in oklab, ${(t as any)[tone]} 92%, white)` },
              { offset: 1, color: (t as any)[tone] },
            ],
          };
        },
        borderColor: 'rgba(255,255,255,0.18)', borderWidth: 1,
        shadowColor: 'rgba(0,0,0,0.45)', shadowBlur: 12,
      },
      label: {
        show: true, formatter: (p: any) => points[p.dataIndex].label,
        color: t.textStrong, fontSize: 10, position: 'top', distance: 8,
      },
      emphasis: { focus: 'self', scale: 1.1 },
    }],
  }), [points, xAxisLabel, yAxisLabel, xFormatter, yFormatter, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* STACKED BAR                                                        */
/* ----------------------------------------------------------------- */
export interface StackedBarSeries { name: string; data: number[]; tone?: Tone }

export function FinanceStackedBarChart({
  categories, series, height = 260, horizontal = false, percent = false,
}: { categories: string[]; series: StackedBarSeries[]; height?: number; horizontal?: boolean; percent?: boolean }) {
  const t = useFinanceChartTokens();
  const palette: Tone[] = ['accent', 'info', 'success', 'warning', 'danger', 'budget'];

  const option = useMemo(() => ({
    grid: { top: 28, left: horizontal ? 110 : 52, right: 18, bottom: 28 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP, valueFormatter: (v: number) => percent ? `${v.toFixed(1)}%` : fmtBRL(v) },
    legend: { textStyle: { color: t.text, fontSize: 11 }, top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4 },
    xAxis: horizontal
      ? { type: 'value', max: percent ? 100 : undefined, axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => percent ? `${v}%` : fmtCompact(v) } }
      : { type: 'category', data: categories, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.text, fontSize: 10 } },
    yAxis: horizontal
      ? { type: 'category', data: categories, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.text, fontSize: 10 } }
      : { type: 'value', max: percent ? 100 : undefined, axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => percent ? `${v}%` : fmtCompact(v) } },
    series: series.map((s, idx) => {
      const color = (t as any)[s.tone || palette[idx % palette.length]];
      const isLast = idx === series.length - 1;
      const isFirst = idx === 0;
      const radius = horizontal
        ? (isLast ? [0, 5, 5, 0] : isFirst ? [5, 0, 0, 5] : [0, 0, 0, 0])
        : (isLast ? [5, 5, 0, 0] : [0, 0, 0, 0]);
      return {
        name: s.name, type: 'bar', stack: 'total',
        emphasis: { focus: 'series' },
        data: s.data, barMaxWidth: 22,
        itemStyle: { color, borderRadius: radius },
      };
    }),
  }), [categories, series, horizontal, percent, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* ADVANCED WATERFALL                                                 */
/* ----------------------------------------------------------------- */
export interface WaterfallStep { label: string; value: number; type?: 'start' | 'end' | 'delta' }

export function FinanceAdvancedWaterfallChart({
  steps, height = 320,
}: { steps: WaterfallStep[]; height?: number }) {
  const t = useFinanceChartTokens();

  // Compute placeholders / running total
  const cumulative: number[] = [];
  let acc = 0;
  steps.forEach((s, idx) => {
    if (s.type === 'start') { acc = s.value; cumulative.push(acc); }
    else if (s.type === 'end') { cumulative.push(acc); /* end equals current accumulator */ }
    else { acc += s.value; cumulative.push(acc); }
  });

  const placeholderData: number[] = steps.map((s, idx) => {
    if (s.type === 'start' || s.type === 'end' || idx === steps.length - 1) return 0;
    return s.value >= 0 ? cumulative[idx] - s.value : cumulative[idx];
  });
  const visibleData = steps.map((s) => Math.abs(s.value));
  const colors = steps.map((s) => {
    if (s.type === 'start') return t.info;
    if (s.type === 'end') return t.accent;
    return s.value >= 0 ? t.success : t.danger;
  });

  const option = useMemo(() => ({
    grid: { top: 32, left: 56, right: 18, bottom: 40 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP,
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex ?? 0;
        const s = steps[idx];
        return `<div style="font-weight:600">${s.label}</div>
        <div style="font-family:ui-monospace,Menlo,monospace">${fmtBRL(s.value)}</div>
        <div style="color:#A8B0BD;font-size:10px">Acumulado: ${fmtBRL(cumulative[idx])}</div>`;
      },
    },
    xAxis: {
      type: 'category', data: steps.map((s) => s.label),
      axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 10, interval: 0, rotate: steps.length > 6 ? 18 : 0 },
    },
    yAxis: {
      type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } },
      axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => fmtCompact(v) },
    },
    series: [
      {
        name: 'placeholder', type: 'bar', stack: 'wf', barMaxWidth: 30,
        itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } },
        data: placeholderData, silent: true,
      },
      {
        name: 'value', type: 'bar', stack: 'wf', barMaxWidth: 30,
        data: visibleData.map((v, i) => ({
          value: v,
          itemStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: `color-mix(in oklab, ${colors[i]} 92%, white)` },
                { offset: 1, color: colors[i] },
              ] },
            borderRadius: [4, 4, 0, 0],
            shadowColor: 'rgba(0,0,0,0.35)', shadowBlur: 8, shadowOffsetY: 2,
          },
        })),
        label: {
          show: true, position: 'top', color: t.textStrong, fontSize: 10,
          formatter: (p: any) => fmtCompact(steps[p.dataIndex].value),
        },
        markLine: {
          symbol: 'none', silent: true,
          lineStyle: { color: 'rgba(255,255,255,0.10)', type: 'dashed', width: 1 },
          data: cumulative.slice(0, -1).map((v, idx) => ({ yAxis: v })),
        },
        emphasis: { itemStyle: { shadowBlur: 14, shadowColor: 'rgba(0,0,0,0.55)' } },
      },
    ],
  }), [steps, placeholderData, visibleData, colors, cumulative, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* SPARKLINE — used inside report card thumbnails                     */
/* ----------------------------------------------------------------- */
export function FinanceSparkline({
  values, tone = 'accent', height = 40, area = true,
}: { values: number[]; tone?: Tone; height?: number; area?: boolean }) {
  const t = useFinanceChartTokens();
  const color = (t as any)[tone];
  const option = useMemo(() => ({
    grid: { top: 4, left: 0, right: 0, bottom: 0 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: values.map((_, i) => i) },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: { show: false },
    series: [{
      type: 'line', data: values, smooth: 0.5, showSymbol: false,
      lineStyle: { color, width: 1.6 },
      areaStyle: area ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [{ offset: 0, color: `color-mix(in oklab, ${color} 38%, transparent)` }, { offset: 1, color: 'transparent' }] } } : undefined,
    }],
  }), [values, color, area]);
  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* TORNADO — sensitivity bars                                         */
/* ----------------------------------------------------------------- */
export interface TornadoRow { label: string; low: number; high: number }

export function FinanceTornadoChart({
  rows, height = 240,
}: { rows: TornadoRow[]; height?: number }) {
  const t = useFinanceChartTokens();
  const cats = rows.map((r) => r.label);
  const negData = rows.map((r) => -Math.abs(r.low));
  const posData = rows.map((r) => Math.abs(r.high));

  const option = useMemo(() => ({
    grid: { top: 24, left: 110, right: 22, bottom: 28 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP, valueFormatter: (v: number) => `${v.toFixed(1)}%` },
    legend: { textStyle: { color: t.text, fontSize: 11 }, top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4 },
    xAxis: {
      type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } },
      axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => `${v}%` },
    },
    yAxis: {
      type: 'category', data: cats, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 11 },
    },
    series: [
      { name: 'Downside', type: 'bar', stack: 'tornado', barMaxWidth: 18, data: negData,
        itemStyle: { color: t.danger, borderRadius: [5, 0, 0, 5] } },
      { name: 'Upside',   type: 'bar', stack: 'tornado', barMaxWidth: 18, data: posData,
        itemStyle: { color: t.success, borderRadius: [0, 5, 5, 0] } },
    ],
  }), [cats, negData, posData, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} notMerge />;
}

/* ----------------------------------------------------------------- */
/* RADIAL PROGRESS                                                     */
/* ----------------------------------------------------------------- */
export function FinanceRadialProgress({
  value, max = 100, label, sublabel, tone = 'accent', height = 200,
}: { value: number; max?: number; label?: string; sublabel?: string; tone?: Tone; height?: number }) {
  const t = useFinanceChartTokens();
  const color = (t as any)[tone];
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  const option = useMemo(() => ({
    series: [{
      type: 'gauge', radius: '90%',
      startAngle: 220, endAngle: -40, min: 0, max: 100,
      progress: { show: true, width: 12, roundCap: true, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 1, colorStops: [{ offset: 0, color: `color-mix(in oklab, ${color} 60%, white)` }, { offset: 1, color }] } } },
      axisLine: { lineStyle: { width: 12, color: [[1, 'rgba(255,255,255,0.06)']] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
      anchor: { show: false },
      detail: {
        valueAnimation: true, formatter: () => `${pct.toFixed(0)}%`,
        offsetCenter: [0, '5%'], color: t.textStrong, fontSize: 24, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      },
      title: {
        offsetCenter: [0, '34%'], color: t.text, fontSize: 11,
      },
      data: [{ value: pct, name: sublabel || label || '' }],
    }],
  }), [pct, color, t, sublabel, label]);
  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />;
}
