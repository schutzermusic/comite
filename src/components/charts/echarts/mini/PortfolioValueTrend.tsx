'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';
import { getAreaGradient, getGlowEffect } from '@/theme/echartsOrionGreen';

interface PortfolioValueTrendProps {
  data: Array<{ month: string; value: number }>;
  height?: number;
  animated?: boolean;
  className?: string;
}

/**
 * Portfolio Value Trend Chart
 * Mini area trend for Portfolio Value card
 */
export function PortfolioValueTrend({
  data,
  height = 60,
  animated = true,
  className,
}: PortfolioValueTrendProps) {
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    
    grid: {
      left: '5%',
      right: '5%',
      top: '10%',
      bottom: '15%',
    },
    
    tooltip: {
      trigger: 'axis',
      backgroundColor: orionGreenColors.bg.overlay,
      borderColor: orionGreenColors.border.default,
      borderWidth: 1,
      borderRadius: 8,
      padding: [8, 12],
      textStyle: {
        color: orionGreenColors.text.primary,
        fontSize: 11,
      },
      axisPointer: {
        type: 'line',
        lineStyle: {
          color: orionGreenColors.accent.primary,
          width: 1,
          type: 'dashed',
        },
      },
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0];
        return `
          <div style="font-size: 10px; color: ${orionGreenColors.text.tertiary}; margin-bottom: 4px;">
            ${p.name}
          </div>
          <div style="font-size: 14px; font-weight: 600; color: ${orionGreenColors.text.primary};">
            R$ ${(p.value / 1000000).toFixed(1)} mi
          </div>
        `;
      },
    },
    
    xAxis: {
      type: 'category',
      data: data.map(d => d.month),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: orionGreenColors.text.muted,
        fontSize: 9,
        margin: 8,
      },
      boundaryGap: false,
    },
    
    yAxis: {
      type: 'value',
      show: false,
      min: Math.min(...data.map(d => d.value)) * 0.98,
      max: Math.max(...data.map(d => d.value)) * 1.02,
    },
    
    series: [
      {
        type: 'line',
        data: data.map(d => d.value),
        smooth: 0.4,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: {
          width: 2.5,
          color: orionGreenColors.accent.primary,
          ...getGlowEffect(orionGreenColors.accent.primary),
        },
        itemStyle: {
          color: orionGreenColors.accent.primary,
          borderColor: orionGreenColors.bg.primary,
          borderWidth: 2,
        },
        areaStyle: {
          color: getAreaGradient(
            'rgba(16, 185, 129, 0.3)',
            'rgba(16, 185, 129, 0.02)'
          ),
        },
        emphasis: {
          scale: 1.5,
          itemStyle: {
            shadowBlur: 15,
            shadowColor: orionGreenColors.accent.primaryGlow,
          },
        },
        animationDuration: animated ? 1000 : 0,
        animationEasing: 'cubicOut',
      },
    ],
  }), [data, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default PortfolioValueTrend;





















