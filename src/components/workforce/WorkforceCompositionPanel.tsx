'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart as PieIcon, BarChart2 } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { useTheme } from '@/contexts/ThemeContext';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import type { CostConcentrationData } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';

echarts.use([BarChart, PieChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);

interface WorkforceCompositionPanelProps {
  costConcentration: CostConcentrationData;
  pjPercent: number;
  cltPercent: number;
  pjCount: number;
  cltCount: number;
  pjCost: number;
  cltCost: number;
  className?: string;
}

export function WorkforceCompositionPanel({
  costConcentration,
  pjPercent,
  cltPercent,
  pjCount,
  cltCount,
  pjCost,
  cltCost,
  className,
}: WorkforceCompositionPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const muted = isLight ? 'rgba(51,65,85,0.72)' : 'rgba(242,245,247,0.60)';
  const strong = isLight ? '#0f172a' : '#F2F5F7';
  const axis = isLight ? 'rgba(51,65,85,0.45)' : 'rgba(242,245,247,0.32)';
  const split = isLight ? 'rgba(15,118,110,0.10)' : 'rgba(170,200,190,0.06)';
  const tooltipBg = isLight ? '#ffffff' : '#141B24';
  const tooltipBorder = isLight ? 'rgba(15,118,110,0.2)' : 'rgba(170,200,190,0.18)';

  const sorted = useMemo(
    () => [...costConcentration.costCenters].sort((a, b) => b.payrollValue - a.payrollValue),
    [costConcentration],
  );

  // Ranked horizontal bars — cost by area
  const costBarOption = useMemo(() => {
    const items = sorted.slice().reverse();
    const PALETTE = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#22C55E', '#94A3B8'];
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 1,
        textStyle: { color: strong, fontSize: 12 },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0];
          const share = costConcentration.totalPayroll > 0 ? ((p.value / costConcentration.totalPayroll) * 100).toFixed(1) : '0';
          return `<div style="font-weight:600;color:${strong}">${p.name}</div><div style="color:${muted}">Folha: <b>${formatWorkforceCurrency(p.value)}</b></div><div style="color:${muted}">Part.: <b>${share}%</b></div>`;
        },
      },
      grid: { left: '2%', right: '8%', top: '4%', bottom: '4%', containLabel: true },
      xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: split } } },
      yAxis: {
        type: 'category',
        data: items.map((c) => c.name),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axis, fontSize: 10 },
      },
      series: [{
        type: 'bar',
        barWidth: 14,
        barCategoryGap: '38%',
        data: items.map((c, i) => ({
          value: c.payrollValue,
          itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [0, 4, 4, 0] },
        })),
        label: {
          show: true, position: 'right',
          formatter: ({ value }: { value: number }) => formatWorkforceCurrency(value),
          color: muted, fontSize: 10,
        },
      }],
    };
  }, [sorted, costConcentration, strong, muted, axis, split, tooltipBg, tooltipBorder]);

  // Headcount by cost center
  const headcountOption = useMemo(() => {
    const items = sorted.slice().reverse();
    const PALETTE = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#22C55E', '#94A3B8'];
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 1,
        textStyle: { color: strong, fontSize: 12 },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0];
          return `<div style="font-weight:600;color:${strong}">${p.name}</div><div style="color:${muted}">Headcount: <b>${p.value}</b></div>`;
        },
      },
      grid: { left: '2%', right: '8%', top: '4%', bottom: '4%', containLabel: true },
      xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: split } } },
      yAxis: {
        type: 'category',
        data: items.map((c) => c.name),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axis, fontSize: 10 },
      },
      series: [{
        type: 'bar',
        barWidth: 12,
        barCategoryGap: '40%',
        data: items.map((c, i) => ({
          value: c.headcount,
          itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [0, 4, 4, 0] },
        })),
        label: { show: true, position: 'right', formatter: ({ value }: { value: number }) => `${value}`, color: muted, fontSize: 10 },
      }],
    };
  }, [sorted, strong, muted, axis, split, tooltipBg, tooltipBorder]);

  // CLT vs PJ donut
  const donutOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 1,
      textStyle: { color: strong, fontSize: 12 },
      formatter: ({ name, value, percent }: { name: string; value: number; percent: number }) =>
        `<div style="font-weight:600;color:${strong}">${name}</div><div style="color:${muted}">${value} pessoas · ${percent.toFixed(1)}%</div>`,
    },
    legend: { show: false },
    series: [{
      type: 'pie', radius: ['52%', '75%'], center: ['50%', '50%'],
      data: [
        { name: 'CLT', value: cltCount, itemStyle: { color: '#14B8A6' } },
        { name: 'PJ', value: pjCount, itemStyle: { color: '#3B82F6' } },
      ],
      label: { show: false },
      emphasis: { scale: true, scaleSize: 6 },
    }],
  }), [pjCount, cltCount, strong, muted, tooltipBg, tooltipBorder]);

  const top3Pct = costConcentration.top3Concentration;
  const top1 = sorted[0];

  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cost by area — 2 cols */}
        <OrionCard variant="elevated" className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5 text-ig-accent" />
              <span className="text-xs font-semibold text-ig-fg-strong">Folha por Área</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-ig-fg-muted">Top-3 concentra</span>
              <span className={cn('font-semibold ig-tabular', top3Pct > 80 ? 'text-ig-danger' : top3Pct > 70 ? 'text-ig-warning' : 'text-ig-success')}>{top3Pct.toFixed(1)}%</span>
            </div>
          </div>
          <div className="h-[200px]">
            <ReactEChartsCore echarts={echarts} option={costBarOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </OrionCard>

        {/* CLT vs PJ donut */}
        <OrionCard variant="elevated">
          <div className="flex items-center gap-2 mb-2">
            <PieIcon className="w-3.5 h-3.5 text-ig-info" />
            <span className="text-xs font-semibold text-ig-fg-strong">CLT vs PJ</span>
          </div>
          <div className="h-[120px]">
            <ReactEChartsCore echarts={echarts} option={donutOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
          <div className="mt-2 space-y-1.5">
            {[
              { label: 'CLT', count: cltCount, pct: cltPercent, cost: cltCost, color: 'bg-ig-accent' },
              { label: 'PJ', count: pjCount, pct: pjPercent, cost: pjCost, color: 'bg-ig-info' },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <span className={cn('w-2 h-2 rounded-sm shrink-0', s.color)} />
                <span className="text-ig-fg-muted flex-1">{s.label}</span>
                <span className="font-semibold text-ig-fg-strong ig-tabular">{s.count}</span>
                <span className="text-ig-fg-subtle ig-tabular">{s.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
          {top1 && (
            <div className="mt-3 pt-3 border-t border-ig-border-subtle">
              <p className="text-[10px] text-ig-fg-muted">Maior área</p>
              <p className="text-xs font-semibold text-ig-fg-strong truncate">{top1.name}</p>
              <p className="text-xs text-ig-fg-muted">{formatWorkforceCurrency(top1.payrollValue)} · {top1.headcount} pessoas</p>
            </div>
          )}
        </OrionCard>
      </div>

      {/* Headcount by area */}
      <OrionCard variant="elevated">
        <div className="flex items-center gap-2 mb-3">
          <BarChart2 className="w-3.5 h-3.5 text-ig-accent" />
          <span className="text-xs font-semibold text-ig-fg-strong">Headcount por Área</span>
        </div>
        <div className="h-[160px]">
          <ReactEChartsCore echarts={echarts} option={headcountOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
        </div>
      </OrionCard>
    </div>
  );
}
