'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';

interface DocumentsMiniProps {
  value: number; // 0-100
  height?: number;
  width?: number;
  animated?: boolean;
  className?: string;
}

/**
 * Mini Documents Completeness Indicator
 * Micro donut/radial chart for compact display
 */
export function DocumentsMini({
  value,
  height = 40,
  width = 80,
  animated = true,
  className,
}: DocumentsMiniProps) {
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    
    series: [
      {
        type: 'pie',
        radius: ['65%', '85%'],
        center: ['50%', '50%'],
        startAngle: 90,
        clockwise: true,
        data: [
          {
            value,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: orionGreenColors.accent.primary },
                  { offset: 1, color: orionGreenColors.accent.primaryLight },
                ],
              },
              shadowBlur: 10,
              shadowColor: orionGreenColors.accent.primaryGlow,
            },
          },
          {
            value: 100 - value,
            itemStyle: {
              color: orionGreenColors.bg.elevated,
            },
          },
        ],
        label: {
          show: false,
        },
        labelLine: {
          show: false,
        },
        emphasis: {
          disabled: true,
        },
        animationDuration: animated ? 1000 : 0,
        animationEasing: 'cubicOut',
      },
    ],
  }), [value, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default DocumentsMini;

