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

// Register ECharts components
echarts.use([BarChart, TooltipComponent, GridComponent, CanvasRenderer]);

interface CostConcentrationPanelProps {
  data: CostConcentrationData;
  className?: string;
}

export function CostConcentrationPanel({ data, className }: CostConcentrationPanelProps) {
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

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        backgroundColor: 'rgba(15, 24, 21, 0.95)',
        borderColor: 'rgba(16, 185, 129, 0.2)',
        borderWidth: 1,
        textStyle: {
          color: '#f0fdf8',
          fontSize: 12,
        },
        formatter: (params: { dataIndex: number; name: string; value: number }[]) => {
          const idx = params[0].dataIndex;
          const center = sortedCenters[idx];
          return `
            <div style="font-weight: 600; margin-bottom: 4px;">${center.name}</div>
            <div style="color: #9abfaf; font-size: 11px;">
              Valor: ${formatWorkforceCurrency(center.payrollValue, data.currency)}<br/>
              Headcount: ${center.headcount}<br/>
              Crescimento: ${formatWorkforcePercentage(center.growthVsPrevious)}
              ${center.isAbnormal ? '<br/><span style="color: #FFB04D;">⚠ Crescimento anormal</span>' : ''}
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
          color: '#9abfaf',
          fontSize: 11,
          formatter: (value: string, idx: number) => {
            // Add rank indicator for top 3
            if (idx < 3) {
              return `{rank|#${idx + 1}} ${value}`;
            }
            return value;
          },
          rich: {
            rank: {
              color: '#00FFB4',
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
                { offset: 0, color: idx < 3 ? 'rgba(0, 255, 180, 0.8)' : 'rgba(0, 200, 255, 0.6)' },
                { offset: 1, color: idx < 3 ? 'rgba(0, 255, 180, 0.4)' : 'rgba(0, 200, 255, 0.3)' },
              ]),
              borderRadius: [0, 4, 4, 0],
            },
          })),
          barWidth: '60%',
          label: {
            show: true,
            position: 'right',
            color: '#d8f0e4',
            fontSize: 11,
            formatter: (params: { dataIndex: number; value: number }) => {
              return `${percentages[params.dataIndex]}%`;
            },
          },
        },
      ],
    };
  }, [sortedCenters, data.totalPayroll, data.currency]);

  return (
    <HoverCard preset="card" lightSweep>
      <OrionCard variant="elevated" className={cn('', className)}>
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-base font-semibold text-white orion-text-heading">
              Concentração de Custos
            </h3>
            <p className="text-xs text-orion-text-muted mt-1">
              Centros de custo ordenados por valor de folha
            </p>
          </div>
          <div className="flex items-center gap-3">
            {abnormalCount > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-semantic-warning-bg">
                <AlertTriangle className="w-3 h-3 text-semantic-warning-DEFAULT" />
                <span className="text-xs text-semantic-warning-DEFAULT">
                  {abnormalCount} anormal{abnormalCount > 1 ? 'is' : ''}
                </span>
              </div>
            )}
            <div className="p-2 rounded-lg bg-glass-light">
              <Building2 className="w-4 h-4 text-orion-text-secondary" />
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
            <p className="text-xs text-orion-text-muted mb-1">Total Folha</p>
            <p className="text-lg font-bold text-white">
              {formatWorkforceCurrency(data.totalPayroll, data.currency)}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
            <p className="text-xs text-orion-text-muted mb-1">Centros de Custo</p>
            <p className="text-lg font-bold text-white">{data.costCenters.length}</p>
          </div>
          <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
            <p className="text-xs text-orion-text-muted mb-1">Top 3 Concentração</p>
            <p className="text-lg font-bold text-semantic-success-DEFAULT">
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
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-orion-border-subtle">
          {top3.map((center, idx) => (
            <motion.div
              key={center.id}
              className={cn(
                'p-3 rounded-lg',
                'bg-gradient-to-br from-emerald-950/30 to-transparent',
                'border border-emerald-500/10',
                center.isAbnormal && 'border-semantic-warning-DEFAULT/30'
              )}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-semantic-success-DEFAULT">
                  #{idx + 1}
                </span>
                {center.isAbnormal && (
                  <AlertTriangle className="w-3 h-3 text-semantic-warning-DEFAULT" />
                )}
              </div>
              <p className="text-sm font-medium text-white truncate">{center.name}</p>
              <p className="text-lg font-bold text-white mt-1">
                {formatWorkforceCurrency(center.payrollValue, data.currency)}
              </p>
              <div className="flex items-center gap-1 mt-1">
                <TrendingUp className={cn(
                  'w-3 h-3',
                  center.growthVsPrevious > 15 
                    ? 'text-semantic-warning-DEFAULT' 
                    : 'text-semantic-success-DEFAULT'
                )} />
                <span className={cn(
                  'text-xs',
                  center.growthVsPrevious > 15 
                    ? 'text-semantic-warning-DEFAULT' 
                    : 'text-semantic-success-DEFAULT'
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

