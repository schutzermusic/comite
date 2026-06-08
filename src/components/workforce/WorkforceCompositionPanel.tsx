'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart2, Users, AlertTriangle } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import type { CostConcentrationData } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';

echarts.use([BarChart, TooltipComponent, GridComponent, CanvasRenderer]);

const PALETTE = [
  '#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B',
  '#EC4899', '#22C55E', '#94A3B8',
];

const SCROLL_H = 260; // viewport height for both chart containers

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
  className,
}: WorkforceCompositionPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const muted     = isLight ? 'rgba(51,65,85,0.72)'     : 'rgba(242,245,247,0.60)';
  const strong    = isLight ? '#0f172a'                  : '#F2F5F7';
  const axis      = isLight ? 'rgba(51,65,85,0.45)'     : 'rgba(242,245,247,0.32)';
  const split     = isLight ? 'rgba(15,118,110,0.10)'   : 'rgba(170,200,190,0.06)';
  const tipBg     = isLight ? '#ffffff'                  : '#141B24';
  const tipBd     = isLight ? 'rgba(15,118,110,0.2)'    : 'rgba(170,200,190,0.18)';
  const lblStrong = isLight ? 'rgba(15,23,42,0.82)'     : 'rgba(242,245,247,0.78)';
  const lblMuted  = isLight ? 'rgba(100,116,139,0.60)'  : 'rgba(148,163,184,0.52)';

  const sorted = useMemo(
    () => [...costConcentration.costCenters].sort((a, b) => b.payrollValue - a.payrollValue),
    [costConcentration],
  );

  const top3Pct        = costConcentration.top3Concentration;
  const totalHeadcount = sorted.reduce((s, c) => s + c.headcount, 0);
  const abnormalCount  = sorted.filter((c) => c.isAbnormal).length;

  const folhaChartH = Math.max(SCROLL_H, sorted.length * 38);
  const hcChartH    = Math.max(SCROLL_H, sorted.length * 32);

  // ── Folha por Área ────────────────────────────────────────────────────────
  const costBarOption = useMemo(() => {
    const items = sorted.slice().reverse();
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: tipBg, borderColor: tipBd, borderWidth: 1,
        textStyle: { color: strong, fontSize: 12 },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0];
          const share = costConcentration.totalPayroll > 0
            ? ((p.value / costConcentration.totalPayroll) * 100).toFixed(1) : '0';
          return [
            `<div style="font-weight:600;color:${strong}">${p.name}</div>`,
            `<div style="color:${muted}">Folha: <b>${formatWorkforceCurrency(p.value)}</b></div>`,
            `<div style="color:${muted}">Participação: <b>${share}%</b></div>`,
          ].join('');
        },
      },
      grid: { left: '2%', right: '20%', top: '3%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: split } },
      },
      yAxis: {
        type: 'category',
        data: items.map((c) => c.name),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axis, fontSize: 10, overflow: 'truncate', width: 90 },
      },
      series: [{
        type: 'bar', barWidth: 14, barCategoryGap: '38%',
        data: items.map((c, i) => ({
          value: c.payrollValue,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: PALETTE[i % PALETTE.length] },
              { offset: 1, color: PALETTE[i % PALETTE.length] + '50' },
            ]),
            borderRadius: [0, 4, 4, 0],
          },
        })),
        label: {
          show: true, position: 'right',
          formatter: ({ value }: { value: number }) => {
            const pct = costConcentration.totalPayroll > 0
              ? ((value / costConcentration.totalPayroll) * 100).toFixed(1) : '0';
            return `{v|${formatWorkforceCurrency(value)}}  {p|${pct}%}`;
          },
          rich: {
            v: { color: lblStrong, fontSize: 10, fontWeight: 600 },
            p: { color: lblMuted, fontSize: 9 },
          },
        },
      }],
    };
  }, [sorted, costConcentration, strong, muted, axis, split, tipBg, tipBd, lblStrong, lblMuted]);

  // ── Headcount por Área ────────────────────────────────────────────────────
  const headcountOption = useMemo(() => {
    const items = sorted.slice().reverse();
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: tipBg, borderColor: tipBd, borderWidth: 1,
        textStyle: { color: strong, fontSize: 12 },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0];
          const pct = totalHeadcount > 0 ? ((p.value / totalHeadcount) * 100).toFixed(1) : '0';
          return [
            `<div style="font-weight:600;color:${strong}">${p.name}</div>`,
            `<div style="color:${muted}">Headcount: <b>${p.value}</b> (${pct}%)</div>`,
          ].join('');
        },
      },
      grid: { left: '2%', right: '14%', top: '3%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: split } },
      },
      yAxis: {
        type: 'category',
        data: items.map((c) => c.name),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: axis, fontSize: 10, overflow: 'truncate', width: 80 },
      },
      series: [{
        type: 'bar', barWidth: 12, barCategoryGap: '42%',
        data: items.map((c, i) => ({
          value: c.headcount,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: PALETTE[i % PALETTE.length] },
              { offset: 1, color: PALETTE[i % PALETTE.length] + '55' },
            ]),
            borderRadius: [0, 4, 4, 0],
          },
        })),
        label: {
          show: true, position: 'right',
          formatter: ({ value }: { value: number }) => {
            const pct = totalHeadcount > 0 ? ((value / totalHeadcount) * 100).toFixed(0) : '0';
            return `{v|${value}}  {p|${pct}%}`;
          },
          rich: {
            v: { color: lblStrong, fontSize: 10, fontWeight: 600 },
            p: { color: lblMuted, fontSize: 9 },
          },
        },
      }],
    };
  }, [sorted, totalHeadcount, strong, muted, axis, split, tipBg, tipBd, lblStrong, lblMuted]);

  const scrollbarCls = `
    overflow-y-auto
    [&::-webkit-scrollbar]:w-1
    [&::-webkit-scrollbar-track]:bg-transparent
    [&::-webkit-scrollbar-thumb]:rounded-full
    [&::-webkit-scrollbar-thumb]:bg-ig-border-subtle
  `;

  return (
    <div className={cn('grid grid-cols-1 lg:grid-cols-3 gap-4', className)}>

      {/* ── Folha por Área — barra de rolagem ──────────────────────────────── */}
      <div className="lg:col-span-2 rounded-xl border border-ig-border-subtle bg-ig-panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ig-border-subtle/60">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-ig-accent/10 border border-ig-accent/20 shrink-0">
              <BarChart2 className="w-3 h-3 text-ig-accent" />
            </div>
            <div>
              <span className="text-xs font-semibold text-ig-fg-strong">Folha por Área</span>
              <p className="text-[10px] text-ig-fg-subtle leading-none mt-0.5">
                {sorted.length} centros · {formatWorkforceCurrency(costConcentration.totalPayroll, costConcentration.currency)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {abnormalCount > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-ig-warning/10 border border-ig-warning/20">
                <AlertTriangle className="w-2.5 h-2.5 text-ig-warning" />
                <span className="text-[10px] font-bold text-ig-warning">{abnormalCount} anormal{abnormalCount > 1 ? 'is' : ''}</span>
              </div>
            )}
            <div className={cn(
              'px-2 py-0.5 rounded-full border text-[10px] font-bold tabular-nums',
              top3Pct > 80 ? 'bg-ig-danger/10 border-ig-danger/20 text-ig-danger'
                : top3Pct > 70 ? 'bg-ig-warning/10 border-ig-warning/20 text-ig-warning'
                : 'bg-ig-success/10 border-ig-success/20 text-ig-success',
            )}>
              Top-3: {top3Pct.toFixed(1)}%
            </div>
          </div>
        </div>
        <div className={cn(scrollbarCls, 'px-3 py-3')} style={{ height: `${SCROLL_H}px` }}>
          <div style={{ height: `${folhaChartH}px` }}>
            <ReactEChartsCore
              echarts={echarts}
              option={costBarOption}
              style={{ height: '100%', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          </div>
        </div>
      </div>

      {/* ── Headcount por Área — barra de rolagem ──────────────────────────── */}
      <div className="rounded-xl border border-ig-border-subtle bg-ig-panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ig-border-subtle/60">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-ig-info/10 border border-ig-info/20 shrink-0">
              <Users className="w-3 h-3 text-ig-info" />
            </div>
            <div>
              <span className="text-xs font-semibold text-ig-fg-strong">Headcount por Área</span>
              <p className="text-[10px] text-ig-fg-subtle leading-none mt-0.5">
                {totalHeadcount} pessoas · {sorted.length} áreas
              </p>
            </div>
          </div>
        </div>
        <div className={cn(scrollbarCls, 'px-3 py-3')} style={{ height: `${SCROLL_H}px` }}>
          <div style={{ height: `${hcChartH}px` }}>
            <ReactEChartsCore
              echarts={echarts}
              option={headcountOption}
              style={{ height: '100%', width: '100%' }}
              opts={{ renderer: 'canvas' }}
            />
          </div>
        </div>
      </div>

    </div>
  );
}
