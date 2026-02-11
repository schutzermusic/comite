'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';

interface AuditReadyMiniProps {
  value: number; // 0-100
  height?: number;
  width?: number;
  animated?: boolean;
  className?: string;
}

/**
 * Mini Audit Readiness Gauge
 * Circular gauge with semantic colors
 */
export function AuditReadyMini({
  value,
  height = 40,
  width = 80,
  animated = true,
  className,
}: AuditReadyMiniProps) {
  // Determine color based on value
  const getColor = (val: number) => {
    if (val >= 80) return orionGreenColors.semantic.success;
    if (val >= 60) return orionGreenColors.semantic.warning;
    return orionGreenColors.semantic.error;
  };

  const color = getColor(value);

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    
    series: [
      {
        type: 'gauge',
        center: ['50%', '55%'],
        radius: '85%',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        splitNumber: 0,
        axisLine: {
          lineStyle: {
            width: 4,
            color: [[value / 100, color], [1, orionGreenColors.bg.elevated]],
          },
        },
        pointer: {
          show: true,
          length: '60%',
          width: 3,
          itemStyle: {
            color: color,
            shadowBlur: 8,
            shadowColor: `${color}40`,
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: { show: false },
        title: { show: false },
        animationDuration: animated ? 1000 : 0,
        animationEasing: 'elasticOut',
      },
    ],
  }), [value, color, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default AuditReadyMini;





















