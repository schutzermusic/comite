'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Zap, TrendingUp, Percent } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { useTheme } from '@/contexts/ThemeContext';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import type { EfficiencyPoint } from '@/lib/workforce/period';

echarts.use([LineChart, BarChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);

interface WorkforceEfficiencyPanelProps {
  data: EfficiencyPoint[];
  currency?: string;
  className?: string;
}

export function WorkforceEfficiencyPanel({ data, currency = 'BRL', className }: WorkforceEfficiencyPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const muted = isLight ? 'rgba(51,65,85,0.72)' : 'rgba(242,245,247,0.60)';
  const strong = isLight ? '#0f172a' : '#F2F5F7';
  const axis = isLight ? 'rgba(51,65,85,0.45)' : 'rgba(242,245,247,0.32)';
  const split = isLight ? 'rgba(15,118,110,0.10)' : 'rgba(170,200,190,0.06)';
  const tooltipBg = isLight ? '#ffffff' : '#141B24';
  const tooltipBorder = isLight ? 'rgba(15,118,110,0.2)' : 'rgba(170,200,190,0.18)';

  const periods = data.map((d) => d.period);

  // Revenue per employee + cost per employee combo
  const revPerEmpOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 1,
      textStyle: { color: strong, fontSize: 12 },
      formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
        let html = `<div style="font-weight:600;color:${strong};margin-bottom:4px">${params[0].axisValue}</div>`;
        params.forEach((p) => {
          html += `<div style="display:flex;align-items:center;gap:6px"><span style="width:7px;height:7px;border-radius:50%;background:${p.color};display:inline-block"></span><span style="color:${muted};flex:1">${p.seriesName}:</span><b style="color:${strong}">${formatWorkforceCurrency(p.value, currency)}</b></div>`;
        });
        return html;
      },
    },
    legend: { show: true, bottom: 0, textStyle: { color: muted, fontSize: 10 }, itemWidth: 10, itemHeight: 7 },
    grid: { left: '2%', right: '2%', top: '8%', bottom: '16%', containLabel: true },
    xAxis: { type: 'category', data: periods, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: axis, fontSize: 9 } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: split } } },
    series: [
      {
        name: 'Receita/func.', type: 'line', data: data.map((d) => d.revenuePerEmployee),
        smooth: true, lineStyle: { color: '#22C55E', width: 2 }, itemStyle: { color: '#22C55E' },
        symbol: 'circle', symbolSize: 5,
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(34,197,94,0.16)' }, { offset: 1, color: 'rgba(34,197,94,0)' }]) },
      },
      {
        name: 'Custo/func.', type: 'line', data: data.map((d) => d.costPerEmployee),
        smooth: true, lineStyle: { color: '#F59E0B', width: 2 }, itemStyle: { color: '#F59E0B' },
        symbol: 'circle', symbolSize: 5,
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(245,158,11,0.12)' }, { offset: 1, color: 'rgba(245,158,11,0)' }]) },
      },
    ],
  }), [data, periods, strong, muted, axis, split, tooltipBg, tooltipBorder, currency]);

  // Payroll % of revenue line
  const payrollPctOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 1,
      textStyle: { color: strong, fontSize: 12 },
      formatter: (params: { axisValue: string; value: number }[]) => {
        const p = params[0];
        return `<div style="font-weight:600;color:${strong}">${p.axisValue}</div><div style="color:${muted}">Folha/Receita: <b>${p.value.toFixed(1)}%</b></div>`;
      },
    },
    grid: { left: '2%', right: '2%', top: '8%', bottom: '10%', containLabel: true },
    xAxis: { type: 'category', data: periods, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: axis, fontSize: 9 } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: split } } },
    visualMap: {
      show: false, type: 'continuous', seriesIndex: 0, min: 0, max: 40,
      color: ['#EF4444', '#F59E0B', '#14B8A6'],
    },
    series: [{
      type: 'line', data: data.map((d) => d.payrollAsRevenuePct), smooth: true,
      lineStyle: { width: 2.5 }, symbol: 'circle', symbolSize: 5,
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(20,184,166,0.15)' }, { offset: 1, color: 'rgba(20,184,166,0)' }]) },
      markLine: {
        silent: true,
        lineStyle: { color: '#EF4444', type: 'dashed', width: 1 },
        data: [{ yAxis: 30, label: { formatter: 'Limite 30%', color: '#EF4444', fontSize: 9 } }],
      },
    }],
  }), [data, periods, strong, muted, axis, split, tooltipBg, tooltipBorder]);

  // Latest period KPIs
  const latest = data[data.length - 1];
  const first = data[0];
  const revPerEmpDelta = first && latest && first.revenuePerEmployee > 0
    ? (((latest.revenuePerEmployee - first.revenuePerEmployee) / first.revenuePerEmployee) * 100).toFixed(1)
    : null;
  const costPerEmpDelta = first && latest && first.costPerEmployee > 0
    ? (((latest.costPerEmployee - first.costPerEmployee) / first.costPerEmployee) * 100).toFixed(1)
    : null;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Summary KPIs */}
      {latest && (
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              icon: TrendingUp,
              label: 'Receita por colaborador',
              value: formatWorkforceCurrency(latest.revenuePerEmployee, currency),
              delta: revPerEmpDelta ? `${Number(revPerEmpDelta) > 0 ? '+' : ''}${revPerEmpDelta}%` : undefined,
              positive: revPerEmpDelta ? Number(revPerEmpDelta) > 0 : undefined,
              color: 'text-ig-success',
            },
            {
              icon: Zap,
              label: 'Custo por colaborador',
              value: formatWorkforceCurrency(latest.costPerEmployee, currency),
              delta: costPerEmpDelta ? `${Number(costPerEmpDelta) > 0 ? '+' : ''}${costPerEmpDelta}%` : undefined,
              positive: costPerEmpDelta ? Number(costPerEmpDelta) <= 0 : undefined,
              color: 'text-ig-warning',
            },
            {
              icon: Percent,
              label: 'Folha / Receita',
              value: `${latest.payrollAsRevenuePct.toFixed(1)}%`,
              delta: `Limite 30%`,
              positive: latest.payrollAsRevenuePct < 30,
              color: latest.payrollAsRevenuePct >= 35 ? 'text-ig-danger' : latest.payrollAsRevenuePct >= 30 ? 'text-ig-warning' : 'text-ig-success',
            },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div key={kpi.label} className="p-3 rounded-xl bg-ig-panel border border-ig-border-subtle">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Icon className={cn('w-3.5 h-3.5', kpi.color)} />
                  <span className="text-[10px] text-ig-fg-muted truncate">{kpi.label}</span>
                </div>
                <p className={cn('text-lg font-semibold ig-tabular', kpi.color)}>{kpi.value}</p>
                {kpi.delta && (
                  <p className={cn(
                    'text-[10px] mt-0.5',
                    kpi.positive === true ? 'text-ig-success' : kpi.positive === false ? 'text-ig-danger' : 'text-ig-fg-subtle',
                  )}>{kpi.delta}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OrionCard variant="elevated">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-3.5 h-3.5 text-ig-success" />
            <span className="text-xs font-semibold text-ig-fg-strong">Receita vs Custo por Colaborador</span>
          </div>
          <div className="h-[200px]">
            <ReactEChartsCore echarts={echarts} option={revPerEmpOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </OrionCard>

        <OrionCard variant="elevated">
          <div className="flex items-center gap-2 mb-3">
            <Percent className="w-3.5 h-3.5 text-ig-info" />
            <span className="text-xs font-semibold text-ig-fg-strong">Folha / Receita (%)</span>
          </div>
          <div className="h-[200px]">
            <ReactEChartsCore echarts={echarts} option={payrollPctOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </OrionCard>
      </div>
    </div>
  );
}
