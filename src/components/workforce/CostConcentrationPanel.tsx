'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  TooltipComponent,
  GridComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Building2, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import {
  CostConcentrationData,
  formatWorkforceCurrency,
  formatWorkforcePercentage,
} from '@/lib/workforce-data';

import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';

echarts.use([BarChart, TooltipComponent, GridComponent, CanvasRenderer]);

interface CostConcentrationPanelProps {
  data: CostConcentrationData;
  className?: string;
}

const PALETTE = ['#14B8A6', '#3B82F6', '#8B5CF6', '#F59E0B', '#EC4899', '#22C55E', '#94A3B8'];
const PALETTE_FADE = [
  'rgba(20,184,166,0.42)', 'rgba(59,130,246,0.42)', 'rgba(139,92,246,0.42)',
  'rgba(245,158,11,0.38)', 'rgba(236,72,153,0.38)', 'rgba(34,197,94,0.38)',
  'rgba(148,163,184,0.28)',
];

export function CostConcentrationPanel({ data, className }: CostConcentrationPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const sortedCenters = useMemo(
    () => [...data.costCenters].sort((a, b) => b.payrollValue - a.payrollValue),
    [data.costCenters],
  );

  const abnormalCount = sortedCenters.filter((c) => c.isAbnormal).length;
  const top1 = sortedCenters[0];

  // Cumulative percentages for Pareto labels
  const { values, cumulativePcts } = useMemo(() => {
    const vals = sortedCenters.map((c) => c.payrollValue);
    const cumPcts: number[] = [];
    let running = 0;
    for (const v of vals) {
      running += data.totalPayroll > 0 ? (v / data.totalPayroll) * 100 : 0;
      cumPcts.push(Math.min(Math.round(running), 100));
    }
    return { values: vals, cumulativePcts: cumPcts };
  }, [sortedCenters, data.totalPayroll]);

  const chartOptions = useMemo(() => {
    const maxVal = values[0] || 1;
    const axisColor = isLight ? 'rgba(51,65,85,0.45)' : 'rgba(242,245,247,0.32)';
    const splitColor = isLight ? 'rgba(15,118,110,0.08)' : 'rgba(170,200,190,0.05)';
    const tooltipBg = isLight ? '#ffffff' : '#141B24';
    const tooltipBorder = isLight ? 'rgba(15,118,110,0.2)' : 'rgba(170,200,190,0.18)';
    const strongColor = isLight ? '#0f172a' : '#F2F5F7';
    const mutedColor = isLight ? 'rgba(15,23,42,0.65)' : 'rgba(242,245,247,0.55)';
    const warnColor = isLight ? '#b45309' : '#F5A524';
    const labelStrong = isLight ? 'rgba(15,23,42,0.85)' : 'rgba(242,245,247,0.80)';
    const labelMuted = isLight ? 'rgba(100,116,139,0.65)' : 'rgba(148,163,184,0.55)';
    const ghostColor = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';

    const categories = [...sortedCenters].reverse().map((c) => c.name);
    const reversedValues = [...values].reverse();
    const reversedCumPcts = [...cumulativePcts].reverse();
    const reversedCenters = [...sortedCenters].reverse();

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: strongColor, fontSize: 12 },
        formatter: (params: { dataIndex: number; seriesName: string; value: number }) => {
          if (params.seriesName === '__ghost') return '';
          const idx = reversedCenters.length - 1 - params.dataIndex;
          const center = sortedCenters[idx];
          if (!center) return '';
          const pct = data.totalPayroll > 0 ? ((center.payrollValue / data.totalPayroll) * 100).toFixed(1) : '0';
          const cum = cumulativePcts[idx] ?? 0;
          return [
            `<div style="font-weight:700;margin-bottom:6px;color:${strongColor}">${center.name}</div>`,
            `<div style="color:${mutedColor};font-size:11px;line-height:1.7">`,
            `Folha: <b style="color:${strongColor}">${formatWorkforceCurrency(center.payrollValue, data.currency)}</b><br/>`,
            `Headcount: <b>${center.headcount}</b><br/>`,
            `Participação: <b>${pct}%</b> &nbsp;·&nbsp; Acumulado: <b>${cum}%</b><br/>`,
            `Crescimento: <b style="color:${center.growthVsPrevious > 15 ? warnColor : strongColor}">${formatWorkforcePercentage(center.growthVsPrevious)}</b>`,
            center.isAbnormal ? `<br/><span style="color:${warnColor}">⚠ Crescimento anormal</span>` : '',
            `</div>`,
          ].join('');
        },
      },
      grid: { left: '2%', right: '14%', top: '3%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: splitColor } },
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 10,
          formatter: (value: string, i: number) => {
            const rank = categories.length - i;
            return rank <= 3 ? `{top|#${rank}} ${value}` : value;
          },
          rich: {
            top: { color: isLight ? '#0d9488' : '#14B8A6', fontWeight: 700, fontSize: 10 },
          },
        },
      },
      series: [
        // Ghost background bar (full scale) — shows proportion visually
        {
          name: '__ghost',
          type: 'bar',
          silent: true,
          barWidth: 16,
          z: 0,
          data: reversedValues.map(() => ({
            value: maxVal,
            itemStyle: { color: ghostColor, borderRadius: [0, 4, 4, 0] },
          })),
          label: { show: false },
        },
        // Actual value bar
        {
          name: 'Folha',
          type: 'bar',
          barGap: '-100%',
          barWidth: 16,
          z: 1,
          data: reversedValues.map((v, i) => {
            const rank = categories.length - 1 - i;
            const colorIdx = rank < PALETTE.length ? rank : PALETTE.length - 1;
            return {
              value: v,
              itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                  { offset: 0, color: PALETTE[colorIdx] },
                  { offset: 1, color: PALETTE_FADE[colorIdx] },
                ]),
                borderRadius: [0, 4, 4, 0],
              },
            };
          }),
          label: {
            show: true,
            position: 'right',
            formatter: ({ dataIndex, value }: { dataIndex: number; value: number }) => {
              const pct = data.totalPayroll > 0
                ? ((value / data.totalPayroll) * 100).toFixed(1)
                : '0';
              const cum = reversedCumPcts[dataIndex] ?? 0;
              return `{pct|${pct}%}  {cum|∑${cum}%}`;
            },
            rich: {
              pct: { color: labelStrong, fontSize: 10, fontWeight: 700 },
              cum: { color: labelMuted, fontSize: 9 },
            },
          },
        },
      ],
    };
  }, [sortedCenters, values, cumulativePcts, data, isLight]);

  const chartHeight = Math.max(180, sortedCenters.length * 38);

  return (
    <OrionCard variant="elevated" className={cn('', className)}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-ig-fg-strong tracking-tight">Concentração de Custos</h3>
          <p className="text-xs text-ig-fg-muted mt-0.5">Centros de custo · ranking por folha com acumulado Pareto</p>
        </div>
        <div className="flex items-center gap-2">
          {abnormalCount > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-ig-warning/10 border border-ig-warning/25">
              <AlertTriangle className="w-3 h-3 text-ig-warning" />
              <span className="text-[11px] text-ig-warning font-semibold ig-tabular">
                {abnormalCount} anormal{abnormalCount > 1 ? 'is' : ''}
              </span>
            </div>
          )}
          <div className="p-1.5 rounded-lg bg-ig-panel border border-ig-border-subtle">
            <Building2 className="w-3.5 h-3.5 text-ig-fg-muted" />
          </div>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          {
            label: 'Total Folha',
            value: formatWorkforceCurrency(data.totalPayroll, data.currency),
            tone: 'text-ig-fg-strong',
          },
          {
            label: 'Centros de Custo',
            value: String(data.costCenters.length),
            tone: 'text-ig-fg-strong',
          },
          {
            label: 'Concentração Top-3',
            value: `${data.top3Concentration.toFixed(1)}%`,
            tone: data.top3Concentration > 80 ? 'text-ig-danger' : data.top3Concentration > 70 ? 'text-ig-warning' : 'text-ig-success',
          },
          ...(top1
            ? [{
                label: 'Maior centro',
                value: top1.name,
                tone: 'text-ig-accent',
              }]
            : []),
        ].map((chip) => (
          <div key={chip.label} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-ig-panel border border-ig-border-subtle">
            <span className="text-[10px] text-ig-fg-muted">{chip.label}:</span>
            <span className={cn('text-[11px] font-semibold ig-tabular', chip.tone)}>{chip.value}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ height: `${chartHeight}px` }}>
        <ReactEChartsCore
          echarts={echarts}
          option={chartOptions}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>

      {/* Inline top-3 strip */}
      {sortedCenters.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ig-border-subtle flex flex-wrap gap-2">
          {sortedCenters.slice(0, 3).map((center, idx) => {
            const colorIdx = idx < PALETTE.length ? idx : PALETTE.length - 1;
            const GrowthIcon = center.growthVsPrevious >= 0 ? TrendingUp : TrendingDown;
            return (
              <div
                key={center.id}
                className={cn(
                  'flex-1 min-w-[120px] p-3 rounded-xl border',
                  center.isAbnormal
                    ? 'bg-ig-warning/8 border-ig-warning/20'
                    : 'bg-ig-panel border-ig-border-subtle',
                )}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className="text-[11px] font-bold ig-tabular"
                    style={{ color: PALETTE[colorIdx] }}
                  >
                    #{idx + 1}
                  </span>
                  {center.isAbnormal && <AlertTriangle className="w-3 h-3 text-ig-warning" />}
                </div>
                <p className="text-xs font-medium text-ig-fg-strong truncate mb-1">{center.name}</p>
                <p className="text-sm font-bold text-ig-fg-strong ig-tabular leading-tight">
                  {formatWorkforceCurrency(center.payrollValue, data.currency)}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  <GrowthIcon
                    className={cn(
                      'w-3 h-3',
                      center.growthVsPrevious > 15 ? 'text-ig-warning' : center.growthVsPrevious > 0 ? 'text-ig-success' : 'text-ig-danger',
                    )}
                  />
                  <span
                    className={cn(
                      'text-[10px] ig-tabular font-semibold',
                      center.growthVsPrevious > 15 ? 'text-ig-warning' : center.growthVsPrevious > 0 ? 'text-ig-success' : 'text-ig-danger',
                    )}
                  >
                    {formatWorkforcePercentage(center.growthVsPrevious)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </OrionCard>
  );
}
