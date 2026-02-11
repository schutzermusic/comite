'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';
import { getAreaGradient, getGlowEffect } from '@/theme/echartsOrionGreen';

interface DataPoint {
  x: string;
  y: number;
}

interface DecisionVelocityLineProps {
  data: DataPoint[];
  height?: number | string;
  showArea?: boolean;
  showPoints?: boolean;
  animated?: boolean;
  className?: string;
}

/**
 * Decision Velocity Line Chart
 * Smooth curve with gradient area fill - ECharts version
 */
export function DecisionVelocityLine({
  data,
  height = 200,
  showArea = true,
  showPoints = true,
  animated = true,
  className,
}: DecisionVelocityLineProps) {
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    
    grid: {
      left: '8%',
      right: '4%',
      top: '15%',
      bottom: '12%',
      containLabel: true,
    },
    
    tooltip: {
      trigger: 'axis',
      backgroundColor: orionGreenColors.bg.overlay,
      borderColor: orionGreenColors.border.default,
      borderWidth: 1,
      borderRadius: 8,
      padding: [10, 14],
      textStyle: {
        color: orionGreenColors.text.primary,
        fontSize: 12,
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
          <div style="font-size: 11px; color: ${orionGreenColors.text.tertiary}; margin-bottom: 4px;">
            ${p.name}
          </div>
          <div style="font-size: 16px; font-weight: 600; color: ${orionGreenColors.text.primary};">
            ${p.value} days
          </div>
        `;
      },
    },
    
    xAxis: {
      type: 'category',
      data: data.map(d => d.x),
      axisLine: {
        show: true,
        lineStyle: {
          color: orionGreenColors.border.subtle,
        },
      },
      axisTick: { show: false },
      axisLabel: {
        color: orionGreenColors.text.muted,
        fontSize: 10,
        margin: 12,
      },
      boundaryGap: false,
    },
    
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: orionGreenColors.text.muted,
        fontSize: 10,
        formatter: '{value}d',
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: orionGreenColors.border.subtle,
          type: 'dashed',
        },
      },
    },
    
    series: [
      {
        type: 'line',
        data: data.map(d => d.y),
        smooth: 0.4,
        symbol: showPoints ? 'circle' : 'none',
        symbolSize: 8,
        lineStyle: {
          width: 3,
          color: orionGreenColors.accent.primary,
          ...getGlowEffect(orionGreenColors.accent.primary),
        },
        itemStyle: {
          color: orionGreenColors.accent.primary,
          borderColor: orionGreenColors.bg.primary,
          borderWidth: 2,
        },
        emphasis: {
          scale: 1.3,
          itemStyle: {
            shadowBlur: 20,
            shadowColor: orionGreenColors.accent.primaryGlow,
          },
        },
        areaStyle: showArea ? {
          color: getAreaGradient(
            'rgba(16, 185, 129, 0.35)',
            'rgba(16, 185, 129, 0.02)'
          ),
        } : undefined,
        animationDuration: animated ? 1000 : 0,
        animationEasing: 'cubicOut',
      },
    ],
  }), [data, showArea, showPoints, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default DecisionVelocityLine;






















