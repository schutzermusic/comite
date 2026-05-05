'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from '@/contexts/ThemeContext';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const COLORS_DARK = {
  text: '#A8B0BD',
  textStrong: '#E6E9EE',
  axis: 'rgba(255,255,255,0.08)',
  grid: 'rgba(255,255,255,0.04)',
  accent: '#22D3EE',
  success: '#34D399',
  danger: '#F87171',
  warning: '#FBBF24',
  info: '#818CF8',
  budget: 'rgba(129,140,248,0.55)',
};

const COLORS_LIGHT = {
  text: '#5B6473',
  textStrong: '#0F172A',
  axis: 'rgba(15,23,42,0.10)',
  grid: 'rgba(15,23,42,0.05)',
  accent: '#0891B2',
  success: '#059669',
  danger: '#DC2626',
  warning: '#D97706',
  info: '#4F46E5',
  budget: 'rgba(79,70,229,0.55)',
};

export function useFinanceChartTokens() {
  const { theme } = useTheme();
  return theme === 'light' ? COLORS_LIGHT : COLORS_DARK;
}

export interface FinanceLineSeries { name: string; data: number[]; tone?: 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'budget' }

export function FinanceLineChart({
  categories, series, height = 220,
}: { categories: string[]; series: FinanceLineSeries[]; height?: number }) {
  const t = useFinanceChartTokens();
  const option = useMemo(() => ({
    grid: { top: 24, left: 48, right: 16, bottom: 28 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(15,17,21,0.95)', borderColor: 'rgba(255,255,255,0.08)', textStyle: { color: t.textStrong, fontSize: 11 } },
    legend: { textStyle: { color: t.text, fontSize: 11 }, top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4 },
    xAxis: {
      type: 'category', data: categories,
      axisLine: { lineStyle: { color: t.axis } },
      axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: t.grid } },
      axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : `${v}` },
    },
    series: series.map((s) => {
      const color = t[s.tone || 'accent'];
      return {
        name: s.name, type: 'line', smooth: true, data: s.data,
        symbol: 'circle', symbolSize: 5, lineStyle: { width: 1.6, color },
        itemStyle: { color },
        areaStyle: s.tone === 'accent' ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: 'rgba(34,211,238,0.28)' }, { offset: 1, color: 'rgba(34,211,238,0)' }],
        } } : undefined,
      };
    }),
  }), [categories, series, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />;
}

export function FinanceBarChart({
  categories, series, horizontal = false, height = 240,
}: { categories: string[]; series: FinanceLineSeries[]; horizontal?: boolean; height?: number }) {
  const t = useFinanceChartTokens();
  const option = useMemo(() => ({
    grid: { top: 24, left: horizontal ? 120 : 48, right: 16, bottom: 28 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(15,17,21,0.95)', borderColor: 'rgba(255,255,255,0.08)', textStyle: { color: t.textStrong, fontSize: 11 } },
    legend: { textStyle: { color: t.text, fontSize: 11 }, top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 4 },
    xAxis: horizontal
      ? { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : `${v}` } }
      : { type: 'category', data: categories, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.text, fontSize: 10 } },
    yAxis: horizontal
      ? { type: 'category', data: categories, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.text, fontSize: 10 } }
      : { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : `${v}` } },
    series: series.map((s) => ({
      name: s.name, type: 'bar', data: s.data,
      barMaxWidth: 22, itemStyle: { color: t[s.tone || 'accent'], borderRadius: 4 },
    })),
  }), [categories, series, horizontal, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />;
}

export function FinanceWaterfallChart({
  categories, values, height = 280,
}: { categories: string[]; values: number[]; height?: number }) {
  const t = useFinanceChartTokens();
  const placeholder: number[] = [];
  let acc = 0;
  values.forEach((v, idx) => {
    if (idx === 0 || idx === values.length - 1) {
      placeholder.push(0);
    } else {
      placeholder.push(v >= 0 ? acc : acc + v);
    }
    acc = idx === 0 ? v : (idx === values.length - 1 ? acc : acc + v);
  });
  const visible = values.map((v, idx) => (idx === 0 || idx === values.length - 1) ? Math.abs(v) : Math.abs(v));
  const colors = values.map((v, idx) => {
    if (idx === 0 || idx === values.length - 1) return t.info;
    return v >= 0 ? t.success : t.danger;
  });

  const option = useMemo(() => ({
    grid: { top: 24, left: 48, right: 16, bottom: 28 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(15,17,21,0.95)', borderColor: 'rgba(255,255,255,0.08)', textStyle: { color: t.textStrong, fontSize: 11 } },
    xAxis: { type: 'category', data: categories, axisLine: { lineStyle: { color: t.axis } }, axisTick: { show: false }, axisLabel: { color: t.text, fontSize: 10, interval: 0, rotate: categories.length > 6 ? 20 : 0 } },
    yAxis: { type: 'value', axisLine: { show: false }, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.text, fontSize: 10, formatter: (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : `${v}` } },
    series: [
      { name: 'placeholder', type: 'bar', stack: 'wf', itemStyle: { color: 'transparent' }, emphasis: { itemStyle: { color: 'transparent' } }, data: placeholder, barMaxWidth: 28 },
      { name: 'value', type: 'bar', stack: 'wf', barMaxWidth: 28, data: visible.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [3, 3, 0, 0] } })) },
    ],
  }), [categories, placeholder, visible, colors, t]);
  return <ReactECharts option={option} style={{ height }} opts={{ renderer: 'svg' }} />;
}
