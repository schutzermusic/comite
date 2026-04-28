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
import { Building2, AlertTriangle, TrendingUp } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { HoverCard } from '@/components/motion';
import { 
  CostConcentrationData, 
  CostCenter,
  formatWorkforceCurrency,
  formatWorkforcePercentage,
} from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';

// Register ECharts components
echarts.use([BarChart, TooltipComponent, GridComponent, CanvasRenderer]);

interface CostConcentrationPanelProps {
  data: CostConcentrationData;
  className?: string;
}

export function CostConcentrationPanel({ data, className }: CostConcentrationPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Sort cost centers by payroll value (descending)
  const sortedCenters = useMemo(() => 
    [...data.costCenters].sort((a, b) => b.payrollValue - a.payrollValue),
    [data.costCenters]
  );

  const top3 = sortedCenters.slice(0, 3);
  const abnormalCount = sortedCenters.filter(c => c.isAbnormal).length;

  // ECharts options for horizontal bar chart
  const chartOptions = useMemo(() => {
    const categories = sortedCenters.map(c => c.name);
    const values = sortedCenters.map(c => c.payrollValue);
    const percentages = sortedCenters.map(c => 
      ((c.payrollValue / data.totalPayroll) * 100).toFixed(1)
    );

    const axisLabelColor = isLight ? 'rgba(15, 23, 42, 0.72)' : 'rgba(242,245,247,0.60)';
    const barLabelColor = isLight ? 'rgba(15, 23, 42, 0.88)' : 'rgba(242,245,247,0.82)';
    const rankColor = isLight ? '#0d9488' : '#14B8A6';

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        backgroundColor: isLight ? '#ffffff' : '#141B24',
        borderColor: isLight ? 'rgba(15, 118, 110, 0.22)' : 'rgba(170, 200, 190, 0.18)',
        borderWidth: 1,
        textStyle: {
          color: isLight ? '#0f172a' : '#F2F5F7',
          fontSize: 12,
        },
        formatter: (params: { dataIndex: number; name: string; value: number }[]) => {
          const idx = params[0].dataIndex;
          const center = sortedCenters[idx];
          const titleColor = isLight ? '#0f172a' : '#F2F5F7';
          const bodyColor = isLight ? 'rgba(15,23,42,0.68)' : 'rgba(242,245,247,0.60)';
          const warnColor = isLight ? '#b45309' : '#F5A524';
          return `
            <div style="font-weight: 600; margin-bottom: 4px; color: ${titleColor};">${center.name}</div>
            <div style="color: ${bodyColor}; font-size: 11px;">
              Valor: ${formatWorkforceCurrency(center.payrollValue, data.currency)}<br/>
              Headcount: ${center.headcount}<br/>
              Crescimento: ${formatWorkforcePercentage(center.growthVsPrevious)}
              ${center.isAbnormal ? `<br/><span style="color: ${warnColor};">⚠ Crescimento anormal</span>` : ''}
            </div>
          `;
        },
      },
      grid: {
        left: '3%',
        right: '12%',
        top: '3%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        axisLabel: {
          show: false,
        },
        axisLine: {
          show: false,
        },
        splitLine: {
          show: false,
        },
      },
      yAxis: {
        type: 'category',
        data: categories,
        inverse: true,
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: axisLabelColor,
          fontSize: 11,
          formatter: (value: string, idx: number) => {
            if (idx < 3) {
              return `{rank|#${idx + 1}} ${value}`;
            }
            return value;
          },
          rich: {
            rank: {
              color: rankColor,
              fontWeight: 600,
              fontSize: 10,
            },
          },
        },
      },
      series: [
        {
          type: 'bar',
          data: values.map((value, idx) => ({
            value,
            itemStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
                {
                  offset: 0,
                  color: idx < 3
                    ? isLight
                      ? 'rgba(13, 148, 136, 0.92)'
                      : 'rgba(20, 184, 166, 0.85)'
                    : isLight
                      ? 'rgba(37, 99, 235, 0.78)'
                      : 'rgba(59, 130, 246, 0.65)',
                },
                {
                  offset: 1,
                  color: idx < 3
                    ? isLight
                      ? 'rgba(45, 212, 191, 0.52)'
                      : 'rgba(20, 184, 166, 0.40)'
                    : isLight
                      ? 'rgba(96, 165, 250, 0.42)'
                      : 'rgba(59, 130, 246, 0.30)',
                },
              ]),
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barWidth: '60%',
          label: {
            show: true,
            position: 'right',
            color: barLabelColor,
            fontSize: 11,
            formatter: (params: { dataIndex: number; value: number }) => {
              return `${percentages[params.dataIndex]}%`;
            },
          },
        },
      ],
    };
  }, [sortedCenters, data.totalPayroll, data.currency, isLight]);

  return (
    <HoverCard preset="card" lightSweep>
      <OrionCard variant="elevated" className={cn('', className)}>
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-base font-semibold text-ig-fg-strong tracking-tight">
              Concentração de Custos
            </h3>
            <p className="text-xs text-ig-fg-muted mt-1">
              Centros de custo ordenados por valor de folha
            </p>
          </div>
          <div className="flex items-center gap-3">
            {abnormalCount > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-ig-warning/10 border border-ig-warning/25">
                <AlertTriangle className="w-3 h-3 text-ig-warning" />
                <span className="text-xs text-ig-warning font-medium ig-tabular">
                  {abnormalCount} anormal{abnormalCount > 1 ? 'is' : ''}
                </span>
              </div>
            )}
            <div className="p-2 rounded-lg bg-ig-panel border border-ig-border-subtle">
              <Building2 className="w-4 h-4 text-ig-fg-muted" />
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
            <p className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle mb-1">Total Folha</p>
            <p className="text-lg font-semibold text-ig-fg-strong ig-tabular tracking-tight">
              {formatWorkforceCurrency(data.totalPayroll, data.currency)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
            <p className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle mb-1">Centros de Custo</p>
            <p className="text-lg font-semibold text-ig-fg-strong ig-tabular tracking-tight">{data.costCenters.length}</p>
          </div>
          <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
            <p className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle mb-1">Top 3 Concentração</p>
            <p className="text-lg font-semibold text-ig-success ig-tabular tracking-tight">
              {data.top3Concentration.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Chart */}
        <div className="h-[280px]">
          <ReactEChartsCore
            echarts={echarts}
            option={chartOptions}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>

        {/* Top 3 Detail Cards */}
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-ig-border-subtle">
          {top3.map((center, idx) => (
            <motion.div
              key={center.id}
              className={cn(
                'p-3 rounded-lg bg-ig-accent-weak border border-ig-accent/15',
                center.isAbnormal && 'border-ig-warning/30 bg-ig-warning/10'
              )}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-ig-accent ig-tabular">
                  #{idx + 1}
                </span>
                {center.isAbnormal && (
                  <AlertTriangle className="w-3 h-3 text-ig-warning" />
                )}
              </div>
              <p className="text-sm font-medium text-ig-fg-strong truncate">{center.name}</p>
              <p className="text-lg font-semibold text-ig-fg-strong ig-tabular tracking-tight mt-1">
                {formatWorkforceCurrency(center.payrollValue, data.currency)}
              </p>
              <div className="flex items-center gap-1 mt-1">
                <TrendingUp className={cn(
                  'w-3 h-3',
                  center.growthVsPrevious > 15 ? 'text-ig-warning' : 'text-ig-success'
                )} />
                <span className={cn(
                  'text-xs ig-tabular',
                  center.growthVsPrevious > 15 ? 'text-ig-warning' : 'text-ig-success'
                )}>
                  {formatWorkforcePercentage(center.growthVsPrevious)}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </OrionCard>
    </HoverCard>
  );
}

