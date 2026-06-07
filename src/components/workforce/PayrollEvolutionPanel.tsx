'use client';

import { useMemo, useState } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import {
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { TrendingUp, BarChart2, Layers, Activity, Leaf } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { useTheme } from '@/contexts/ThemeContext';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import type {
  PayrollCompositionPoint,
  SCurvePoint,
  PayrollVsRevenuePoint,
  BenefitTypePoint,
} from '@/lib/workforce/period';

echarts.use([LineChart, BarChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);

type Tab = 'trend' | 'scurve' | 'composition' | 'vs-revenue' | 'benefits';

interface PayrollEvolutionPanelProps {
  composition: PayrollCompositionPoint[];
  scurve: SCurvePoint[];
  vsRevenue: PayrollVsRevenuePoint[];
  benefits: BenefitTypePoint[];
  currency?: string;
  className?: string;
}

const TABS: { id: Tab; label: string; icon: typeof TrendingUp }[] = [
  { id: 'trend', label: 'Folha Mensal', icon: TrendingUp },
  { id: 'scurve', label: 'Curva S', icon: Activity },
  { id: 'composition', label: 'Composição', icon: Layers },
  { id: 'vs-revenue', label: 'Folha vs Receita', icon: BarChart2 },
  { id: 'benefits', label: 'Benefícios', icon: Leaf },
];

function useChartColors(isLight: boolean) {
  return {
    muted: isLight ? 'rgba(51,65,85,0.72)' : 'rgba(242,245,247,0.60)',
    strong: isLight ? '#0f172a' : '#F2F5F7',
    axis: isLight ? 'rgba(51,65,85,0.45)' : 'rgba(242,245,247,0.32)',
    split: isLight ? 'rgba(15,118,110,0.10)' : 'rgba(170,200,190,0.06)',
    tooltip: {
      bg: isLight ? '#ffffff' : '#141B24',
      border: isLight ? 'rgba(15,118,110,0.2)' : 'rgba(170,200,190,0.18)',
    },
  };
}

export function PayrollEvolutionPanel({
  composition,
  scurve,
  vsRevenue,
  benefits,
  currency = 'BRL',
  className,
}: PayrollEvolutionPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const c = useChartColors(isLight);
  const [tab, setTab] = useState<Tab>('trend');

  // Trend chart — derived from composition (salary+benefits+charges = payroll)
  const trendOption = useMemo(() => {
    const periods = composition.map((d) => d.period);
    const payroll = composition.map((d) => d.salary + d.benefits + d.charges);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: c.tooltip.bg,
        borderColor: c.tooltip.border,
        borderWidth: 1,
        textStyle: { color: c.strong, fontSize: 12 },
        formatter: (params: { axisValue: string; value: number }[]) => {
          const p = params[0];
          return `<div style="font-weight:600;color:${c.strong}">${p.axisValue}</div><div style="color:${c.muted}">Folha: <b>${formatWorkforceCurrency(p.value, currency)}</b></div>`;
        },
      },
      grid: { left: '3%', right: '3%', top: '8%', bottom: '12%', containLabel: true },
      xAxis: { type: 'category', data: periods, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 10 } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
      series: [{
        type: 'line', data: payroll, smooth: true,
        lineStyle: { color: '#14B8A6', width: 2.5 },
        itemStyle: { color: '#14B8A6' },
        symbol: 'circle', symbolSize: 5,
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(20,184,166,0.28)' }, { offset: 1, color: 'rgba(20,184,166,0)' }]) },
      }],
    };
  }, [composition, c, currency]);

  const scurveOption = useMemo(() => {
    const periods = scurve.map((d) => d.period);
    const cur = scurve.map((d) => d.cumulative);
    const prev = scurve.map((d) => d.cumulativePrev);
    const hasPrev = prev.some((v) => v !== null);
    const series: object[] = [{
      name: 'Período atual', type: 'line', data: cur, smooth: true,
      lineStyle: { color: '#14B8A6', width: 2.5 },
      itemStyle: { color: '#14B8A6' }, symbol: 'circle', symbolSize: 5,
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(20,184,166,0.22)' }, { offset: 1, color: 'rgba(20,184,166,0)' }]) },
    }];
    if (hasPrev) {
      series.push({
        name: 'Período anterior', type: 'line', data: prev, smooth: true,
        lineStyle: { color: '#94A3B8', width: 1.5, type: 'dashed' },
        itemStyle: { color: '#94A3B8' }, symbol: 'circle', symbolSize: 4,
      });
    }
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: c.tooltip.bg,
        borderColor: c.tooltip.border,
        borderWidth: 1,
        textStyle: { color: c.strong, fontSize: 12 },
        formatter: (params: { axisValue: string; seriesName: string; value: number }[]) => {
          let html = `<div style="font-weight:600;color:${c.strong};margin-bottom:6px">${params[0].axisValue}</div>`;
          params.forEach((p) => {
            if (p.value != null) html += `<div style="color:${c.muted}">${p.seriesName}: <b>${formatWorkforceCurrency(p.value, currency)}</b></div>`;
          });
          return html;
        },
      },
      legend: hasPrev ? { show: true, bottom: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 } : { show: false },
      grid: { left: '3%', right: '3%', top: '8%', bottom: hasPrev ? '14%' : '8%', containLabel: true },
      xAxis: { type: 'category', data: periods, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 10 } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
      series,
    };
  }, [scurve, c, currency]);

  const compositionOption = useMemo(() => {
    const periods = composition.map((d) => d.period);
    const colorMap = { salary: '#14B8A6', benefits: '#3B82F6', charges: '#F59E0B' };
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: c.tooltip.bg, borderColor: c.tooltip.border, borderWidth: 1,
        textStyle: { color: c.strong, fontSize: 12 },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          let html = `<div style="font-weight:600;color:${c.strong};margin-bottom:6px">${params[0].axisValue}</div>`;
          params.forEach((p) => {
            html += `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:2px;background:${p.color};display:inline-block"></span><span style="color:${c.muted};flex:1">${p.seriesName}:</span><b style="color:${c.strong}">${formatWorkforceCurrency(p.value, currency)}</b></div>`;
          });
          return html;
        },
      },
      legend: { show: true, bottom: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: '3%', right: '3%', top: '8%', bottom: '16%', containLabel: true },
      xAxis: { type: 'category', data: periods, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 10 } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
      series: [
        { name: 'Salários', type: 'bar', stack: 'total', data: composition.map((d) => d.salary), itemStyle: { color: colorMap.salary } },
        { name: 'Benefícios', type: 'bar', stack: 'total', data: composition.map((d) => d.benefits), itemStyle: { color: colorMap.benefits } },
        { name: 'Encargos', type: 'bar', stack: 'total', data: composition.map((d) => d.charges), itemStyle: { color: colorMap.charges } },
      ],
    };
  }, [composition, c, currency]);

  const vsRevenueOption = useMemo(() => {
    const periods = vsRevenue.map((d) => d.period);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: c.tooltip.bg, borderColor: c.tooltip.border, borderWidth: 1,
        textStyle: { color: c.strong, fontSize: 12 },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          let html = `<div style="font-weight:600;color:${c.strong};margin-bottom:6px">${params[0].axisValue}</div>`;
          params.forEach((p) => {
            const val = p.seriesName === 'Folha/Receita %' ? `${p.value.toFixed(1)}%` : formatWorkforceCurrency(p.value, currency);
            html += `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:2px;background:${p.color};display:inline-block"></span><span style="color:${c.muted};flex:1">${p.seriesName}:</span><b style="color:${c.strong}">${val}</b></div>`;
          });
          return html;
        },
      },
      legend: { show: true, bottom: 0, textStyle: { color: c.muted, fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
      grid: { left: '3%', right: '4%', top: '8%', bottom: '16%', containLabel: true },
      xAxis: { type: 'category', data: periods, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 10 } },
      yAxis: [
        { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
        { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
      ],
      series: [
        { name: 'Folha', type: 'bar', yAxisIndex: 0, data: vsRevenue.map((d) => d.payroll), itemStyle: { color: 'rgba(20,184,166,0.75)', borderRadius: [3, 3, 0, 0] } },
        { name: 'Receita', type: 'bar', yAxisIndex: 0, data: vsRevenue.map((d) => d.revenue), itemStyle: { color: 'rgba(59,130,246,0.45)', borderRadius: [3, 3, 0, 0] } },
        {
          name: 'Folha/Receita %', type: 'line', yAxisIndex: 1, data: vsRevenue.map((d) => d.payrollPct),
          smooth: true, lineStyle: { color: '#F59E0B', width: 2 }, itemStyle: { color: '#F59E0B' },
          symbol: 'circle', symbolSize: 5,
        },
      ],
    };
  }, [vsRevenue, c, currency]);

  const benefitsOption = useMemo(() => {
    const periods = benefits.map((d) => d.period);
    const colors = ['#14B8A6', '#3B82F6', '#EC4899', '#8B5CF6', '#F59E0B', '#94A3B8'];
    const series = [
      { name: 'VA', key: 'va' as const },
      { name: 'VR', key: 'vr' as const },
      { name: 'Saúde', key: 'health' as const },
      { name: 'Odonto', key: 'dental' as const },
      { name: 'Transporte', key: 'transport' as const },
      { name: 'Outros', key: 'other' as const },
    ].map((s, i) => ({
      name: s.name, type: 'bar', stack: 'benefits',
      data: benefits.map((d) => d[s.key]),
      itemStyle: { color: colors[i] },
    }));
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: c.tooltip.bg, borderColor: c.tooltip.border, borderWidth: 1,
        textStyle: { color: c.strong, fontSize: 12 },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          let html = `<div style="font-weight:600;color:${c.strong};margin-bottom:6px">${params[0].axisValue}</div>`;
          params.forEach((p) => {
            html += `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:2px;background:${p.color};display:inline-block"></span><span style="color:${c.muted};flex:1">${p.seriesName}:</span><b style="color:${c.strong}">${formatWorkforceCurrency(p.value, currency)}</b></div>`;
          });
          return html;
        },
      },
      legend: { show: true, bottom: 0, textStyle: { color: c.muted, fontSize: 10 }, itemWidth: 10, itemHeight: 7, itemGap: 12 },
      grid: { left: '3%', right: '3%', top: '8%', bottom: '18%', containLabel: true },
      xAxis: { type: 'category', data: periods, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 10 } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
      series,
    };
  }, [benefits, c, currency]);

  const optionMap: Record<Tab, object> = {
    trend: trendOption,
    scurve: scurveOption,
    composition: compositionOption,
    'vs-revenue': vsRevenueOption,
    benefits: benefitsOption,
  };

  // Latest month summary stats from composition
  const latest = composition[composition.length - 1];
  const totalLatest = latest ? latest.salary + latest.benefits + latest.charges : 0;
  const salaryPct = totalLatest > 0 ? ((latest.salary / totalLatest) * 100).toFixed(0) : '–';
  const benefitsPct = totalLatest > 0 ? ((latest.benefits / totalLatest) * 100).toFixed(0) : '–';
  const chargesPct = totalLatest > 0 ? ((latest.charges / totalLatest) * 100).toFixed(0) : '–';

  return (
    <OrionCard variant="elevated" className={cn('', className)}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-ig-fg-strong tracking-tight">Evolução da Folha</h3>
          <p className="text-xs text-ig-fg-muted mt-0.5">Tendência, composição, curva acumulada e comparativo de receita</p>
        </div>
        {/* Quick stats */}
        <div className="hidden md:flex items-center gap-3">
          {[
            { label: 'Salários', value: `${salaryPct}%`, color: 'text-ig-accent' },
            { label: 'Benefícios', value: `${benefitsPct}%`, color: 'text-ig-info' },
            { label: 'Encargos', value: `${chargesPct}%`, color: 'text-ig-warning' },
          ].map((s) => (
            <div key={s.label} className="text-center px-2">
              <p className={cn('text-sm font-semibold ig-tabular', s.color)}>{s.value}</p>
              <p className="text-[10px] text-ig-fg-muted">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1 scrollbar-none">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                tab === t.id
                  ? 'bg-ig-accent/15 text-ig-accent border border-ig-accent/30'
                  : 'text-ig-fg-muted hover:text-ig-fg-default hover:bg-ig-panel border border-transparent',
              )}
            >
              <Icon className="w-3 h-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="h-[260px]">
        <ReactEChartsCore
          echarts={echarts}
          option={optionMap[tab]}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>

      {/* Composition legend (mobile) */}
      <div className="flex md:hidden items-center justify-center gap-4 mt-3">
        {[
          { label: 'Salários', value: `${salaryPct}%`, color: 'bg-ig-accent' },
          { label: 'Benefícios', value: `${benefitsPct}%`, color: 'bg-ig-info' },
          { label: 'Encargos', value: `${chargesPct}%`, color: 'bg-ig-warning' },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-sm', s.color)} />
            <span className="text-xs text-ig-fg-muted">{s.label} {s.value}</span>
          </div>
        ))}
      </div>
    </OrionCard>
  );
}
