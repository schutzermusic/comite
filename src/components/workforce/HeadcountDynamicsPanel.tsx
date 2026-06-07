'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { UserCheck, UserMinus, Activity, Clock } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import type {
  AdmissionDismissalPoint,
  TurnoverPoint,
  AbsenteeismPoint,
  OvertimePoint,
} from '@/lib/workforce/period';

echarts.use([LineChart, BarChart, TooltipComponent, GridComponent, LegendComponent, CanvasRenderer]);

interface HeadcountDynamicsPanelProps {
  admissions: AdmissionDismissalPoint[];
  turnover: TurnoverPoint[];
  absenteeism: AbsenteeismPoint[];
  overtime: OvertimePoint[];
  className?: string;
}

function useColors(isLight: boolean) {
  return {
    muted: isLight ? 'rgba(51,65,85,0.72)' : 'rgba(242,245,247,0.60)',
    strong: isLight ? '#0f172a' : '#F2F5F7',
    axis: isLight ? 'rgba(51,65,85,0.45)' : 'rgba(242,245,247,0.32)',
    split: isLight ? 'rgba(15,118,110,0.10)' : 'rgba(170,200,190,0.06)',
    tooltipBg: isLight ? '#ffffff' : '#141B24',
    tooltipBorder: isLight ? 'rgba(15,118,110,0.2)' : 'rgba(170,200,190,0.18)',
  };
}

export function HeadcountDynamicsPanel({
  admissions,
  turnover,
  absenteeism,
  overtime,
  className,
}: HeadcountDynamicsPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const c = useColors(isLight);

  const admOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
      textStyle: { color: c.strong, fontSize: 12 },
      formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
        let html = `<div style="font-weight:600;color:${c.strong};margin-bottom:4px">${params[0].axisValue}</div>`;
        params.forEach((p) => {
          html += `<div style="display:flex;align-items:center;gap:6px"><span style="width:7px;height:7px;border-radius:2px;background:${p.color};display:inline-block"></span><span style="color:${c.muted};flex:1">${p.seriesName}:</span><b style="color:${c.strong}">${p.value}</b></div>`;
        });
        return html;
      },
    },
    legend: { show: true, bottom: 0, textStyle: { color: c.muted, fontSize: 10 }, itemWidth: 10, itemHeight: 7, itemGap: 14 },
    grid: { left: '2%', right: '2%', top: '8%', bottom: '18%', containLabel: true },
    xAxis: { type: 'category', data: admissions.map((d) => d.period), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 9 } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
    series: [
      { name: 'Admissões', type: 'bar', data: admissions.map((d) => d.admissions), itemStyle: { color: '#22C55E', borderRadius: [3, 3, 0, 0] } },
      { name: 'Desligamentos', type: 'bar', data: admissions.map((d) => d.dismissals), itemStyle: { color: '#EF4444', borderRadius: [3, 3, 0, 0] } },
    ],
  }), [admissions, c]);

  const turnoverOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
      textStyle: { color: c.strong, fontSize: 12 },
      formatter: (params: { axisValue: string; value: number }[]) => {
        const p = params[0];
        return `<div style="font-weight:600;color:${c.strong}">${p.axisValue}</div><div style="color:${c.muted}">Turnover: <b>${p.value.toFixed(2)}%</b></div>`;
      },
    },
    grid: { left: '2%', right: '2%', top: '8%', bottom: '10%', containLabel: true },
    xAxis: { type: 'category', data: turnover.map((d) => d.period), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 9 } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
    series: [{
      type: 'line', data: turnover.map((d) => d.turnoverPct), smooth: true,
      lineStyle: { color: '#F59E0B', width: 2 }, itemStyle: { color: '#F59E0B' },
      symbol: 'circle', symbolSize: 5,
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(245,158,11,0.2)' }, { offset: 1, color: 'rgba(245,158,11,0)' }]) },
    }],
  }), [turnover, c]);

  const absentOption = useMemo(() => {
    const sorted = [...absenteeism].sort((a, b) => b.pct - a.pct);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
        textStyle: { color: c.strong, fontSize: 12 },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0];
          return `<div style="font-weight:600;color:${c.strong}">${p.name}</div><div style="color:${c.muted}">Absenteísmo: <b>${p.value.toFixed(1)}%</b></div>`;
        },
      },
      grid: { left: '2%', right: '8%', top: '4%', bottom: '4%', containLabel: true },
      xAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
      yAxis: { type: 'category', data: sorted.map((d) => d.area), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 10 } },
      series: [{
        type: 'bar', data: sorted.map((d) => ({
          value: d.pct,
          itemStyle: { color: d.pct >= 5 ? '#EF4444' : d.pct >= 4 ? '#F59E0B' : '#22C55E', borderRadius: [0, 3, 3, 0] },
        })),
        label: { show: true, position: 'right', formatter: ({ value }: { value: number }) => `${value.toFixed(1)}%`, color: c.muted, fontSize: 10 },
      }],
    };
  }, [absenteeism, c]);

  const overtimeOption = useMemo(() => ({
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder, borderWidth: 1,
      textStyle: { color: c.strong, fontSize: 12 },
      formatter: (params: { axisValue: string; value: number }[]) => {
        const p = params[0];
        return `<div style="font-weight:600;color:${c.strong}">${p.axisValue}</div><div style="color:${c.muted}">Horas extras: <b>${p.value.toFixed(1)}%</b></div>`;
      },
    },
    grid: { left: '2%', right: '2%', top: '8%', bottom: '10%', containLabel: true },
    xAxis: { type: 'category', data: overtime.map((d) => d.period), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: c.axis, fontSize: 9 } },
    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { lineStyle: { color: c.split } } },
    series: [{
      type: 'line', data: overtime.map((d) => d.overtimePct), smooth: true,
      lineStyle: { color: '#8B5CF6', width: 2 }, itemStyle: { color: '#8B5CF6' },
      symbol: 'circle', symbolSize: 5,
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(139,92,246,0.18)' }, { offset: 1, color: 'rgba(139,92,246,0)' }]) },
    }],
  }), [overtime, c]);

  // KPI summary chips
  const finitePoints = turnover.filter((d) => isFinite(d.turnoverPct) && d.turnoverPct > 0);
  const avgTurnover = finitePoints.length > 0
    ? (finitePoints.reduce((s, d) => s + d.turnoverPct, 0) / finitePoints.length).toFixed(2)
    : '–';
  const avgOvertime = overtime.length > 0 ? (overtime.reduce((s, d) => s + d.overtimePct, 0) / overtime.length).toFixed(1) : '–';
  const maxAbsent = absenteeism.length > 0 ? absenteeism[0] : null;
  const lastAdm = admissions[admissions.length - 1];
  const netHires = lastAdm ? lastAdm.net : 0;

  const chips = [
    { icon: UserCheck, label: 'Saldo contratações', value: `${netHires >= 0 ? '+' : ''}${netHires}`, color: netHires >= 0 ? 'text-ig-success' : 'text-ig-danger' },
    { icon: Activity, label: 'Turnover médio', value: `${avgTurnover}%`, color: 'text-ig-warning' },
    { icon: UserMinus, label: 'Maior absenteísmo', value: maxAbsent ? `${maxAbsent.area} ${maxAbsent.pct.toFixed(1)}%` : '–', color: maxAbsent && maxAbsent.pct >= 5 ? 'text-ig-danger' : 'text-ig-fg-default' },
    { icon: Clock, label: 'H.extras médio', value: `${avgOvertime}%`, color: 'text-ig-info' },
  ];

  return (
    <div className={cn('space-y-4', className)}>
      {/* Summary chips */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {chips.map((ch) => {
          const Icon = ch.icon;
          return (
            <div key={ch.label} className="flex items-center gap-2.5 p-3 rounded-xl bg-ig-panel border border-ig-border-subtle">
              <div className="p-1.5 rounded-lg bg-ig-panel-hover">
                <Icon className={cn('w-3.5 h-3.5', ch.color)} />
              </div>
              <div className="min-w-0">
                <p className={cn('text-sm font-semibold ig-tabular truncate', ch.color)}>{ch.value}</p>
                <p className="text-[10px] text-ig-fg-muted truncate">{ch.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts 2×2 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Admissions vs Dismissals */}
        <OrionCard variant="elevated">
          <div className="flex items-center gap-2 mb-3">
            <UserCheck className="w-3.5 h-3.5 text-ig-success" />
            <span className="text-xs font-semibold text-ig-fg-strong">Admissões vs Desligamentos</span>
          </div>
          <div className="h-[190px]">
            <ReactEChartsCore echarts={echarts} option={admOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </OrionCard>

        {/* Turnover Trend */}
        <OrionCard variant="elevated">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-3.5 h-3.5 text-ig-warning" />
            <span className="text-xs font-semibold text-ig-fg-strong">Tendência de Turnover (%)</span>
          </div>
          <div className="h-[190px]">
            <ReactEChartsCore echarts={echarts} option={turnoverOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </OrionCard>

        {/* Absenteeism by Area */}
        <OrionCard variant="elevated">
          <div className="flex items-center gap-2 mb-3">
            <UserMinus className="w-3.5 h-3.5 text-ig-danger" />
            <span className="text-xs font-semibold text-ig-fg-strong">Absenteísmo por Área (%)</span>
          </div>
          <div className="h-[190px]">
            <ReactEChartsCore echarts={echarts} option={absentOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </OrionCard>

        {/* Overtime Trend */}
        <OrionCard variant="elevated">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-3.5 h-3.5 text-ig-info" />
            <span className="text-xs font-semibold text-ig-fg-strong">Horas Extras (%)</span>
          </div>
          <div className="h-[190px]">
            <ReactEChartsCore echarts={echarts} option={overtimeOption} style={{ height: '100%', width: '100%' }} opts={{ renderer: 'canvas' }} />
          </div>
        </OrionCard>
      </div>
    </div>
  );
}
