'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';
import { getAreaGradient } from '@/theme/echartsOrionGreen';

interface KpiSparklineProps {
  data: number[];
  height?: number;
  width?: number;
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error';
  showArea?: boolean;
  animated?: boolean;
  className?: string;
}

const colorMap = {
  primary: orionGreenColors.accent.primary,
  secondary: orionGreenColors.accent.secondary,
  success: orionGreenColors.semantic.success,
  warning: orionGreenColors.semantic.warning,
  error: orionGreenColors.semantic.error,
};

const glowMap = {
  primary: orionGreenColors.accent.primaryGlow,
  secondary: orionGreenColors.accent.secondaryGlow,
  success: orionGreenColors.semantic.successGlow,
  warning: orionGreenColors.semantic.warningGlow,
  error: orionGreenColors.semantic.errorGlow,
};

/**
 * Minimal KPI Sparkline Chart
 * Small sparkline for KPI cards - ECharts version
 */
export function KpiSparkline({
  data,
  height = 32,
  width = 80,
  color = 'primary',
  showArea = true,
  animated = true,
  className,
}: KpiSparklineProps) {
  const lineColor = colorMap[color];
  const glowColor = glowMap[color];

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
      min: Math.min(...data) * 0.9,
      max: Math.max(...data) * 1.1,
    },
    
    series: [
      {
        type: 'line',
        data,
        smooth: 0.6, // Smoother curves
        symbol: 'none',
        lineStyle: {
          width: 2.5,
          // Gradient stroke using linear gradient
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: lineColor },
              { offset: 0.5, color: lineColor },
              { offset: 1, color: lineColor },
            ],
            global: false,
          },
          shadowBlur: 12, // Stronger glow
          shadowColor: glowColor || `${lineColor}60`,
          shadowOffsetY: 0,
        },
        areaStyle: showArea ? {
          color: getAreaGradient(
            `${lineColor}50`,
            `${lineColor}08`
          ),
        } : undefined,
        emphasis: {
          lineStyle: {
            width: 3,
            shadowBlur: 16,
          },
        },
        animationDuration: animated ? 800 : 0,
        animationEasing: 'cubicOut',
      },
    ],
  }), [data, lineColor, glowColor, showArea, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default KpiSparkline;


