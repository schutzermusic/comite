'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';

interface ComplianceGaugeProps {
  value: number; // 0-100
  label?: string;
  height?: number | string;
  animated?: boolean;
  className?: string;
}

/**
 * Compliance Gauge Chart
 * Circular gauge aligned with 3D Governance Core aesthetic
 */
export function ComplianceGauge({
  value,
  label = 'Compliance',
  height = 200,
  animated = true,
  className,
}: ComplianceGaugeProps) {
  // Determine color based on value
  const getColor = (val: number) => {
    if (val >= 80) return orionGreenColors.semantic.success;
    if (val >= 60) return orionGreenColors.semantic.warning;
    return orionGreenColors.semantic.error;
  };

  const getGlowColor = (val: number) => {
    if (val >= 80) return orionGreenColors.semantic.successGlow;
    if (val >= 60) return orionGreenColors.semantic.warningGlow;
    return orionGreenColors.semantic.errorGlow;
  };

  const mainColor = getColor(value);
  const glowColor = getGlowColor(value);

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    
    series: [
      // Background track
      {
        type: 'gauge',
        center: ['50%', '55%'],
        radius: '90%',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        splitNumber: 10,
        axisLine: {
          lineStyle: {
            width: 14,
            color: [[1, orionGreenColors.bg.elevated]],
          },
        },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: { show: false },
        title: { show: false },
      },
      // Progress arc
      {
        type: 'gauge',
        center: ['50%', '55%'],
        radius: '90%',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [value / 100, {
                type: 'linear',
                x: 0, y: 0, x2: 1, y2: 0,
                colorStops: [
                  { offset: 0, color: mainColor },
                  { offset: 1, color: mainColor },
                ],
              }],
              [1, 'transparent'],
            ],
          },
        },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: { show: false },
        title: { show: false },
        itemStyle: {
          shadowBlur: 20,
          shadowColor: glowColor,
        },
      },
      // Tick marks
      {
        type: 'gauge',
        center: ['50%', '55%'],
        radius: '78%',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        splitNumber: 10,
        axisLine: { show: false },
        pointer: { show: false },
        axisTick: {
          length: 4,
          lineStyle: {
            color: orionGreenColors.border.default,
            width: 1,
          },
        },
        splitLine: {
          length: 8,
          distance: -8,
          lineStyle: {
            color: orionGreenColors.border.strong,
            width: 2,
          },
        },
        axisLabel: {
          distance: -35,
          color: orionGreenColors.text.muted,
          fontSize: 9,
          formatter: (v: number) => {
            if (v === 0 || v === 50 || v === 100) return v.toString();
            return '';
          },
        },
        detail: { show: false },
        title: { show: false },
      },
      // Central pointer indicator
      {
        type: 'gauge',
        center: ['50%', '55%'],
        radius: '60%',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        axisLine: { show: false },
        pointer: {
          show: true,
          length: '50%',
          width: 4,
          offsetCenter: [0, 0],
          itemStyle: {
            color: mainColor,
            shadowBlur: 10,
            shadowColor: glowColor,
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: {
          show: true,
          size: 12,
          itemStyle: {
            color: mainColor,
            borderColor: orionGreenColors.bg.primary,
            borderWidth: 3,
            shadowBlur: 15,
            shadowColor: glowColor,
          },
        },
        detail: {
          valueAnimation: animated,
          offsetCenter: [0, '35%'],
          formatter: '{value}%',
          fontSize: 32,
          fontWeight: 700,
          color: orionGreenColors.text.primary,
          fontFamily: 'Inter, sans-serif',
        },
        title: {
          offsetCenter: [0, '65%'],
          fontSize: 11,
          color: orionGreenColors.text.muted,
          fontFamily: 'Inter, sans-serif',
        },
        data: [
          {
            value,
            name: label.toUpperCase(),
          },
        ],
        animationDuration: animated ? 1200 : 0,
        animationEasing: 'elasticOut',
      },
    ],
  }), [value, label, mainColor, glowColor, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default ComplianceGauge;






















