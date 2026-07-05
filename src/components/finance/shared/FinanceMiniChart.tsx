'use client';

import { FONT_FAMILY_SANS } from '@/lib/fonts';
import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from '@/contexts/ThemeContext';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

type FinanceChartTone = 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'budget';

const COLORS_DARK = {
  text: '#A8B0BD',
  textStrong: '#E6E9EE',
  axis: 'rgba(255,255,255,0.12)',
  grid: 'rgba(255,255,255,0.055)',
  panel: 'rgba(12,18,22,0.94)',
  panelBorder: 'rgba(255,255,255,0.12)',
  cursor: 'rgba(34,211,238,0.18)',
  accent: '#22D3EE',
  success: '#34D399',
  danger: '#F87171',
  warning: '#FBBF24',
  info: '#818CF8',
  budget: '#A78BFA',
};

const COLORS_LIGHT = {
  text: '#5B6473',
  textStrong: '#0F172A',
  axis: 'rgba(15,23,42,0.14)',
  grid: 'rgba(15,23,42,0.065)',
  panel: 'rgba(255,255,255,0.96)',
  panelBorder: 'rgba(15,23,42,0.10)',
  cursor: 'rgba(8,145,178,0.13)',
  accent: '#0891B2',
  success: '#059669',
  danger: '#DC2626',
  warning: '#D97706',
  info: '#4F46E5',
  budget: '#7C3AED',
};

export function useFinanceChartTokens() {
  const { theme } = useTheme();
  return theme === 'light' ? COLORS_LIGHT : COLORS_DARK;
}

const tones: FinanceChartTone[] = ['accent', 'info', 'success', 'warning', 'danger', 'budget'];

const fmtCompact = (v: number) => {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${abs}`;
};

const fmtBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

function gradient(color: string, opacity = 0.92) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: `color-mix(in oklab, ${color} ${Math.round(opacity * 100)}%, white)` },
      { offset: 0.56, color },
      { offset: 1, color: `color-mix(in oklab, ${color} 54%, transparent)` },
    ],
  };
}

function tooltip(t: ReturnType<typeof useFinanceChartTokens>) {
  return {
    backgroundColor: t.panel,
    borderColor: t.panelBorder,
    borderWidth: 1,
    padding: [9, 11],
    textStyle: {
      color: t.textStrong,
      fontSize: 11,
      fontFamily: FONT_FAMILY_SANS,
    },
    extraCssText: [
      'border-radius:12px',
      'backdrop-filter:blur(16px)',
      'box-shadow:0 18px 42px -22px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
    ].join(';'),
  };
}

function grid(t: ReturnType<typeof useFinanceChartTokens>, horizontal = false) {
  return {
    top: 34,
    left: horizontal ? 126 : 58,
    right: 18,
    bottom: 34,
    containLabel: false,
  };
}

function axisLabel(t: ReturnType<typeof useFinanceChartTokens>) {
  return {
    color: t.text,
    fontSize: 10,
    fontFamily: FONT_FAMILY_SANS,
  };
}

export interface FinanceLineSeries {
  name: string;
  data: number[];
  tone?: FinanceChartTone;
}

export function FinanceLineChart({
  categories,
  series,
  height = 220,
}: { categories: string[]; series: FinanceLineSeries[]; height?: number }) {
  const t = useFinanceChartTokens();
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    color: tones.map((toneKey) => t[toneKey]),
    grid: grid(t),
    tooltip: {
      trigger: 'axis',
      ...tooltip(t),
      axisPointer: {
        type: 'cross',
        snap: true,
        lineStyle: { color: t.cursor, width: 1 },
        crossStyle: { color: t.cursor },
        label: { backgroundColor: t.panel, color: t.textStrong, borderColor: t.panelBorder },
      },
      valueFormatter: (value: number) => fmtBRL(value),
    },
    legend: {
      top: 2,
      right: 0,
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 4,
      itemGap: 12,
      textStyle: { color: t.text, fontSize: 11 },
    },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: axisLabel(t),
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: t.grid, type: 'dashed' as const, width: 1 } },
      axisLabel: { ...axisLabel(t), formatter: (v: number) => fmtCompact(v) },
    },
    series: series.map((s, index) => {
      const toneKey = s.tone || tones[index % tones.length];
      const color = t[toneKey];
      return {
        name: s.name,
        type: 'line',
        smooth: 0.42,
        data: s.data,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        lineStyle: {
          width: index === 0 ? 2.4 : 1.7,
          color,
          shadowColor: `color-mix(in oklab, ${color} 36%, transparent)`,
          shadowBlur: index === 0 ? 10 : 4,
        },
        itemStyle: { color, borderColor: t.panel, borderWidth: 1 },
        areaStyle: index === 0 ? {
          color: {
            type: 'linear' as const,
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `color-mix(in oklab, ${color} 30%, transparent)` },
              { offset: 1, color: `color-mix(in oklab, ${color} 0%, transparent)` },
            ],
          },
        } : undefined,
        emphasis: { focus: 'series', lineStyle: { width: 2.8 }, itemStyle: { shadowBlur: 12, shadowColor: color } },
      };
    }),
  }), [categories, series, t]);

  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />;
}

export function FinanceBarChart({
  categories,
  series,
  horizontal = false,
  height = 240,
}: { categories: string[]; series: FinanceLineSeries[]; horizontal?: boolean; height?: number }) {
  const t = useFinanceChartTokens();
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    color: tones.map((toneKey) => t[toneKey]),
    grid: grid(t, horizontal),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: t.cursor } },
      ...tooltip(t),
      valueFormatter: (value: number) => fmtBRL(value),
    },
    legend: {
      top: 2,
      right: 0,
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 5,
      itemGap: 12,
      textStyle: { color: t.text, fontSize: 11 },
    },
    xAxis: horizontal
      ? {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: t.grid, type: 'dashed' as const } },
          axisLabel: { ...axisLabel(t), formatter: (v: number) => fmtCompact(v) },
        }
      : {
          type: 'category',
          data: categories,
          axisLine: { lineStyle: { color: t.axis } },
          axisTick: { show: false },
          axisLabel: axisLabel(t),
        },
    yAxis: horizontal
      ? {
          type: 'category',
          data: categories,
          axisLine: { lineStyle: { color: t.axis } },
          axisTick: { show: false },
          axisLabel: { ...axisLabel(t), width: 108, overflow: 'truncate' as const },
        }
      : {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: t.grid, type: 'dashed' as const } },
          axisLabel: { ...axisLabel(t), formatter: (v: number) => fmtCompact(v) },
        },
    series: series.map((s, index) => {
      const toneKey = s.tone || tones[index % tones.length];
      const color = t[toneKey];
      return {
        name: s.name,
        type: 'bar',
        data: s.data,
        barMaxWidth: 24,
        itemStyle: {
          color: gradient(color),
          borderColor: `color-mix(in oklab, ${color} 58%, transparent)`,
          borderWidth: 0.7,
          borderRadius: horizontal ? [0, 6, 6, 0] : [6, 6, 0, 0],
          shadowColor: `color-mix(in oklab, ${color} 26%, transparent)`,
          shadowBlur: 8,
          shadowOffsetY: 2,
        },
        emphasis: {
          focus: 'series',
          itemStyle: { shadowBlur: 16, shadowColor: `color-mix(in oklab, ${color} 44%, transparent)` },
        },
      };
    }),
  }), [categories, series, horizontal, t]);

  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />;
}

export function FinanceWaterfallChart({
  categories,
  values,
  height = 280,
}: { categories: string[]; values: number[]; height?: number }) {
  const t = useFinanceChartTokens();
  const placeholder: number[] = [];
  const cumulative: number[] = [];
  let acc = 0;

  values.forEach((v, index) => {
    if (index === 0 || index === values.length - 1) {
      placeholder.push(0);
      acc = index === 0 ? v : acc;
      cumulative.push(index === 0 ? v : acc);
      return;
    }
    placeholder.push(v >= 0 ? acc : acc + v);
    acc += v;
    cumulative.push(acc);
  });

  const visible = values.map((value) => Math.abs(value));
  const colors = values.map((value, index) => {
    if (index === 0) return t.info;
    if (index === values.length - 1) return t.accent;
    return value >= 0 ? t.success : t.danger;
  });

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    grid: { top: 32, left: 58, right: 18, bottom: categories.length > 6 ? 54 : 36 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: t.cursor } },
      ...tooltip(t),
      formatter: (params: any[]) => {
        const idx = params[0]?.dataIndex ?? 0;
        const color = colors[idx];
        return `<div style="min-width:148px">
          <div style="font-size:11px;color:${t.text};text-transform:uppercase;letter-spacing:.08em">${categories[idx]}</div>
          <div style="margin-top:4px;font-family:inherit;font-size:13px;color:${color}">${fmtBRL(values[idx])}</div>
          <div style="margin-top:2px;font-size:10px;color:${t.text}">Acumulado ${fmtBRL(cumulative[idx] ?? 0)}</div>
        </div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { ...axisLabel(t), interval: 0, rotate: categories.length > 6 ? 18 : 0 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: t.grid, type: 'dashed' as const } },
      axisLabel: { ...axisLabel(t), formatter: (v: number) => fmtCompact(v) },
    },
    series: [
      {
        name: 'base',
        type: 'bar',
        stack: 'waterfall',
        silent: true,
        itemStyle: { color: 'transparent', borderColor: 'transparent' },
        emphasis: { itemStyle: { color: 'transparent', borderColor: 'transparent' } },
        data: placeholder,
        barMaxWidth: 30,
      },
      {
        name: 'valor',
        type: 'bar',
        stack: 'waterfall',
        barMaxWidth: 30,
        data: visible.map((value, index) => ({
          value,
          itemStyle: {
            color: gradient(colors[index]),
            borderRadius: [6, 6, 0, 0],
            borderColor: `color-mix(in oklab, ${colors[index]} 58%, transparent)`,
            borderWidth: 0.7,
            shadowColor: `color-mix(in oklab, ${colors[index]} 30%, transparent)`,
            shadowBlur: 10,
          },
        })),
        label: {
          show: true,
          position: 'top',
          color: t.textStrong,
          fontSize: 10,
          fontFamily: FONT_FAMILY_SANS,
          formatter: (p: any) => fmtCompact(values[p.dataIndex]),
        },
        markLine: {
          symbol: 'none',
          silent: true,
          lineStyle: { color: t.axis, type: 'dashed' as const, width: 1 },
          data: cumulative.slice(0, -1).map((value) => ({ yAxis: value })),
        },
        emphasis: { itemStyle: { shadowBlur: 18 } },
      },
    ],
    animationDuration: 850,
    animationEasing: 'cubicOut',
  }), [categories, placeholder, visible, colors, cumulative, values, t]);

  return <ReactECharts option={option} style={{ height, width: '100%' }} opts={{ renderer: 'svg' }} notMerge />;
}
