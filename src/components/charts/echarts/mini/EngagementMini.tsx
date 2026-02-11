'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';
import { getAreaGradient, getGlowEffect } from '@/theme/echartsOrionGreen';

interface EngagementMiniProps {
  data: number[];
  height?: number;
  width?: number;
  animated?: boolean;
  className?: string;
}

/**
 * Mini Engagement Sparkline
 * Micro area chart for member participation
 */
export function EngagementMini({
  data,
  height = 40,
  width = 80,
  animated = true,
  className,
}: EngagementMiniProps) {
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    
    grid: {
      left: 0,
      right: 0,
      top: 2,
      bottom: 2,
    },
    
    xAxis: {
      type: 'category',
      show: false,
      data: data.map((_, i) => i),
      boundaryGap: false,
    },
    
    yAxis: {
      type: 'value',
      show: false,
      min: Math.min(...data) * 0.95,
      max: Math.max(...data) * 1.05,
    },
    
    series: [
      {
        type: 'line',
        data,
        smooth: 0.4,
        symbol: 'none',
        lineStyle: {
          width: 2.5,
          color: orionGreenColors.accent.primary,
          ...getGlowEffect(orionGreenColors.accent.primary),
        },
        areaStyle: {
          color: getAreaGradient(
            'rgba(16, 185, 129, 0.35)',
            'rgba(16, 185, 129, 0.02)'
          ),
        },
        animationDuration: animated ? 800 : 0,
        animationEasing: 'cubicOut',
      },
    ],
  }), [data, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default EngagementMini;





















