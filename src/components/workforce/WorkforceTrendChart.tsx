'use client';

import { useMemo } from 'react';
import ReactEChartsCore from 'echarts-for-react/lib/core';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { TrendingUp } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { HoverCard } from '@/components/motion';
import { formatWorkforceCurrency } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';

// Register ECharts components
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

export function WorkforceTrendChart({
  data,
  currency = 'BRL',
  className,
}: WorkforceTrendChartProps) {
  const chartOptions = useMemo(() => {
    const periods = data.map(d => d.period);
    const payrollData = data.map(d => d.payroll);
    const headcountData = data.map(d => d.headcount);
    const avgCostData = data.map(d => d.avgCost);

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 24, 21, 0.95)',
        borderColor: 'rgba(16, 185, 129, 0.2)',
        borderWidth: 1,
        textStyle: {
          color: '#f0fdf8',
          fontSize: 12,
        },
        formatter: (params: { axisValue: string; seriesName: string; value: number; color: string }[]) => {
          let html = `<div style="font-weight: 600; margin-bottom: 8px;">${params[0].axisValue}</div>`;
          params.forEach(p => {
            const value = p.seriesName === 'Headcount' 
              ? p.value.toLocaleString('pt-BR')
              : formatWorkforceCurrency(p.value, currency);
            html += `
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="width: 8px; height: 8px; border-radius: 50%; background: ${p.color};"></span>
                <span style="color: #9abfaf; flex: 1;">${p.seriesName}:</span>
                <span style="font-weight: 500;">${value}</span>
              </div>
            `;
          });
          return html;
        },
      },
      legend: {
        show: true,
        bottom: 0,
        left: 'center',
        textStyle: {
          color: '#9abfaf',
          fontSize: 11,
        },
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 20,
      },
      grid: {
        left: '3%',
        right: '4%',
        top: '8%',
        bottom: '15%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: periods,
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: '#6a8b7c',
          fontSize: 10,
        },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Valor (R$)',
          nameTextStyle: {
            color: '#6a8b7c',
            fontSize: 10,
          },
          axisLine: {
            show: false,
          },
          axisTick: {
            show: false,
          },
          axisLabel: {
            show: false,
          },
          splitLine: {
            lineStyle: {
              color: 'rgba(255, 255, 255, 0.05)',
            },
          },
        },
        {
          type: 'value',
          name: 'Headcount',
          nameTextStyle: {
            color: '#6a8b7c',
            fontSize: 10,
          },
          axisLine: {
            show: false,
          },
          axisTick: {
            show: false,
          },
          axisLabel: {
            show: false,
          },
          splitLine: {
            show: false,
          },
        },
      ],
      series: [
        {
          name: 'Folha',
          type: 'line',
          yAxisIndex: 0,
          data: payrollData,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: {
            color: '#00FFB4',
            width: 2,
          },
          itemStyle: {
            color: '#00FFB4',
          },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(0, 255, 180, 0.2)' },
              { offset: 1, color: 'rgba(0, 255, 180, 0)' },
            ]),
          },
        },
        {
          name: 'Headcount',
          type: 'line',
          yAxisIndex: 1,
          data: headcountData,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: {
            color: '#00C8FF',
            width: 2,
          },
          itemStyle: {
            color: '#00C8FF',
          },
        },
        {
          name: 'Custo Médio',
          type: 'line',
          yAxisIndex: 0,
          data: avgCostData,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: {
            color: '#FFB04D',
            width: 2,
            type: 'dashed',
          },
          itemStyle: {
            color: '#FFB04D',
          },
        },
      ],
    };
  }, [data, currency]);

  // Calculate trend info
  const trendInfo = useMemo(() => {
    if (data.length < 2) return null;
    const first = data[0];
    const last = data[data.length - 1];
    const payrollChange = ((last.payroll - first.payroll) / first.payroll) * 100;
    const headcountChange = ((last.headcount - first.headcount) / first.headcount) * 100;
    return { payrollChange, headcountChange };
  }, [data]);

  return (
    <HoverCard preset="card" lightSweep>
      <OrionCard variant="elevated" className={className}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white orion-text-heading">
              Tendências 12 Meses
            </h3>
            <p className="text-xs text-orion-text-muted mt-0.5">
              Evolução de Folha, Headcount e Custo Médio
            </p>
          </div>
          <div className="p-2 rounded-lg bg-glass-light">
            <TrendingUp className="w-4 h-4 text-orion-text-secondary" />
          </div>
        </div>

        {/* Trend Summary */}
        {trendInfo && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-2 rounded-lg bg-orion-bg-elevated/50">
              <p className="text-xs text-orion-text-muted">Variação Folha</p>
              <p className={cn(
                'text-sm font-semibold',
                trendInfo.payrollChange > 0 ? 'text-semantic-warning-DEFAULT' : 'text-semantic-success-DEFAULT'
              )}>
                {trendInfo.payrollChange > 0 ? '+' : ''}{trendInfo.payrollChange.toFixed(1)}%
              </p>
            </div>
            <div className="p-2 rounded-lg bg-orion-bg-elevated/50">
              <p className="text-xs text-orion-text-muted">Variação Headcount</p>
              <p className={cn(
                'text-sm font-semibold',
                trendInfo.headcountChange > 0 ? 'text-semantic-info-DEFAULT' : 'text-semantic-success-DEFAULT'
              )}>
                {trendInfo.headcountChange > 0 ? '+' : ''}{trendInfo.headcountChange.toFixed(1)}%
              </p>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="h-[220px]">
          <ReactEChartsCore
            echarts={echarts}
            option={chartOptions}
            style={{ height: '100%', width: '100%' }}
            opts={{ renderer: 'canvas' }}
          />
        </div>
      </OrionCard>
    </HoverCard>
  );
}

// Generate mock trend data
export function generateMockTrendData(): TrendDataPoint[] {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const basePayroll = 10500000;
  const baseHeadcount = 780;
  
  return months.map((month, idx) => {
    const growthFactor = 1 + (idx * 0.018); // ~1.8% growth per month
    const headcountGrowth = 1 + (idx * 0.008); // ~0.8% headcount growth
    const payroll = Math.round(basePayroll * growthFactor);
    const headcount = Math.round(baseHeadcount * headcountGrowth);
    
    return {
      period: month,
      payroll,
      headcount,
      avgCost: Math.round(payroll / headcount),
    };
  });
}

