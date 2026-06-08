'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';

echarts.use([LineChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);

interface TrendDataPoint {
  period: string;
  payroll: number;
  headcount: number;
  avgCost: number;
}

interface WorkforceTrendChartProps {
  data: TrendDataPoint[];
  currency?: string;
  className?: string;
}

export function WorkforceTrendChart({ data, currency = 'BRL', className }: WorkforceTrendChartProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const trendInfo = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0];
    const last = data[data.length - 1];
    return {
      payrollChange: ((last.payroll - first.payroll) / first.payroll) * 100,
      headcountChange: ((last.headcount - first.headcount) / first.headcount) * 100,
      avgCostChange: ((last.avgCost - first.avgCost) / first.avgCost) * 100,
    };
  }, [data]);

  const chartOptions = useMemo(() => {
    const muted    = isLight ? 'rgba(51,65,85,0.72)'    : 'rgba(242,245,247,0.60)';
    const strong   = isLight ? '#0f172a'                 : '#F2F5F7';
    const axisMut  = isLight ? 'rgba(51,65,85,0.40)'    : 'rgba(242,245,247,0.28)';
    const split    = isLight ? 'rgba(15,118,110,0.10)'  : 'rgba(170,200,190,0.06)';
    const tipBg    = isLight ? '#ffffff'                 : '#141B24';
    const tipBd    = isLight ? 'rgba(15,118,110,0.2)'   : 'rgba(170,200,190,0.18)';

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tipBg,
        borderColor: tipBd,
        borderWidth: 1,
        textStyle: { color: strong, fontSize: 12 },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          let html = `<div style="font-weight:600;margin-bottom:6px;color:${strong}">${params[0]?.axisValue}</div>`;
          params.forEach((p) => {
            const val = p.seriesName === 'Headcount'
              ? p.value.toLocaleString('pt-BR')
              : formatWorkforceCurrency(p.value, currency);
            html += `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
                <span style="width:7px;height:7px;border-radius:50%;background:${p.color};flex-shrink:0"></span>
                <span style="color:${muted};flex:1">${p.seriesName}:</span>
                <span style="font-weight:600;color:${strong}">${val}</span>
              </div>`;
          });
          return html;
        },
      },
      legend: {
        show: true,
        bottom: 0,
        left: 'center',
        textStyle: { color: axisMut, fontSize: 10 },
        itemWidth: 10,
        itemHeight: 6,
        itemGap: 20,
      },
      grid: { left: '2%', right: '3%', top: '5%', bottom: '14%', containLabel: true },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.period),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisMut, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { lineStyle: { color: split } },
        },
        {
          type: 'value',
          axisLine: { show: false }, axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Folha',
          type: 'line',
          yAxisIndex: 0,
          data: data.map((d) => d.payroll),
          smooth: true,
          symbol: 'circle', symbolSize: 5,
          lineStyle: { color: '#14B8A6', width: 2.5 },
          itemStyle: { color: '#14B8A6' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(20,184,166,0.24)' },
              { offset: 1, color: 'rgba(20,184,166,0.01)' },
            ]),
          },
        },
        {
          name: 'Headcount',
          type: 'line',
          yAxisIndex: 1,
          data: data.map((d) => d.headcount),
          smooth: true,
          symbol: 'circle', symbolSize: 5,
          lineStyle: { color: '#3B82F6', width: 2.5 },
          itemStyle: { color: '#3B82F6' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(59,130,246,0.14)' },
              { offset: 1, color: 'rgba(59,130,246,0.01)' },
            ]),
          },
        },
        {
          name: 'Custo Médio',
          type: 'line',
          yAxisIndex: 0,
          data: data.map((d) => d.avgCost),
          smooth: true,
          symbol: 'circle', symbolSize: 5,
          lineStyle: { color: '#F59E0B', width: 2, type: 'dashed' },
          itemStyle: { color: '#F59E0B' },
        },
      ],
    };
  }, [data, currency, isLight]);

  return (
    <div className={cn('rounded-2xl border border-ig-border-subtle overflow-hidden flex flex-col h-full', className)}>
      {/* Top gradient rail */}
      <div className="h-[3px] bg-gradient-to-r from-ig-accent via-ig-info/70 to-transparent" />

      {/* Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-ig-border-subtle/60 bg-gradient-to-r from-ig-accent/[0.07] to-transparent">
        <div className="p-1.5 rounded-lg bg-ig-accent/10 border border-ig-accent/20 shrink-0">
          <TrendingUp className="w-3.5 h-3.5 text-ig-accent" />
        </div>
        <div>
          <span className="text-xs font-semibold text-ig-fg-strong">Tendências 12 Meses</span>
          <p className="text-[10px] text-ig-fg-subtle leading-none mt-0.5">
            Evolução de Folha, Headcount e Custo Médio
          </p>
        </div>
      </div>

      {/* Trend KPI strip */}
      {trendInfo && (
        <div className="grid grid-cols-3 divide-x divide-ig-border-subtle/60 border-b border-ig-border-subtle/60 bg-ig-panel/60">
          {(
            [
              { label: 'Var. Folha',      value: trendInfo.payrollChange,   upIsBad: true  },
              { label: 'Var. Headcount',  value: trendInfo.headcountChange, upIsBad: false },
              { label: 'Custo Médio',     value: trendInfo.avgCostChange,   upIsBad: true  },
            ] as { label: string; value: number; upIsBad: boolean }[]
          ).map(({ label, value, upIsBad }) => {
            const isUp = value > 0;
            const tone = isUp
              ? (upIsBad ? 'text-ig-warning' : 'text-ig-info')
              : (upIsBad ? 'text-ig-success' : 'text-ig-danger');
            const Icon = isUp ? TrendingUp : TrendingDown;
            return (
              <div key={label} className="flex flex-col gap-0.5 px-4 py-2.5">
                <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">
                  {label}
                </span>
                <div className="flex items-center gap-1">
                  <Icon className={cn('w-3 h-3 shrink-0', tone)} />
                  <span className={cn('text-sm font-bold ig-tabular', tone)}>
                    {isUp ? '+' : ''}{value.toFixed(1)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Chart — expands to fill remaining card height */}
      <div className="relative flex-1 min-h-[200px] bg-ig-panel px-2 pt-2 pb-1">
        <div className="absolute inset-2 bottom-1">
          <ReactEChartsCore
            echarts={echarts}
            option={chartOptions}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      </div>
    </div>
  );
}

export function generateMockTrendData(): TrendDataPoint[] {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const basePayroll = 10500000;
  const baseHeadcount = 780;

  return months.map((month, idx) => {
    const payroll = Math.round(basePayroll * (1 + idx * 0.018));
    const headcount = Math.round(baseHeadcount * (1 + idx * 0.008));
    return { period: month, payroll, headcount, avgCost: Math.round(payroll / headcount) };
  });
}
