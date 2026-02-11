'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';

interface RiskCategory {
  name: string;
  value?: number;
  count?: number; // Alternative field name
  severity: 'critical' | 'high' | 'medium' | 'low';
}

interface RiskHeatRingProps {
  categories: RiskCategory[];
  height?: number | string;
  showCenter?: boolean;
  animated?: boolean;
  className?: string;
}

const severityColors = {
  critical: orionGreenColors.semantic.error,
  high: orionGreenColors.semantic.warning,
  medium: orionGreenColors.accent.secondary,
  low: orionGreenColors.semantic.success,
};

const severityGlows = {
  critical: orionGreenColors.semantic.errorGlow,
  high: orionGreenColors.semantic.warningGlow,
  medium: orionGreenColors.accent.secondaryGlow,
  low: orionGreenColors.semantic.successGlow,
};

/**
 * Risk Heat Ring Chart
 * Distribution by severity with glow effects - ECharts version
 */
export function RiskHeatRing({
  categories,
  height = 200,
  showCenter = true,
  animated = true,
  className,
}: RiskHeatRingProps) {
  // Handle both value and count field names
  const getValue = (cat: RiskCategory) => cat.value ?? cat.count ?? 0;
  const total = categories.reduce((sum, cat) => sum + getValue(cat), 0);

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    
    tooltip: {
      trigger: 'item',
      backgroundColor: orionGreenColors.bg.overlay,
      borderColor: orionGreenColors.border.default,
      borderWidth: 1,
      borderRadius: 8,
      padding: [10, 14],
      textStyle: {
        color: orionGreenColors.text.primary,
        fontSize: 12,
      },
      formatter: (params: { name: string; value: number; percent: number; data: { severity: string } }) => {
        const severityLabel = params.data.severity.charAt(0).toUpperCase() + params.data.severity.slice(1);
        return `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <div style="
              width: 8px; 
              height: 8px; 
              border-radius: 50%; 
              background: ${severityColors[params.data.severity as keyof typeof severityColors]};
              box-shadow: 0 0 6px ${severityGlows[params.data.severity as keyof typeof severityGlows]};
            "></div>
            <span style="font-size: 11px; color: ${orionGreenColors.text.tertiary};">
              ${severityLabel}
            </span>
          </div>
          <div style="font-size: 11px; color: ${orionGreenColors.text.tertiary}; margin-bottom: 4px;">
            ${params.name}
          </div>
          <div style="font-size: 18px; font-weight: 600; color: ${orionGreenColors.text.primary};">
            ${params.value} <span style="font-size: 12px; color: ${orionGreenColors.text.muted};">(${params.percent.toFixed(0)}%)</span>
          </div>
        `;
      },
    },
    
    series: [
      // Outer glow ring
      {
        type: 'pie',
        radius: ['75%', '88%'],
        center: ['50%', '50%'],
        silent: true,
        label: { show: false },
        labelLine: { show: false },
        data: categories.map(cat => ({
          value: getValue(cat),
          name: cat.name,
          severity: cat.severity,
          itemStyle: {
            color: severityColors[cat.severity],
            opacity: 0.2,
          },
        })),
      },
      // Main ring
      {
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 6,
          borderColor: orionGreenColors.bg.primary,
          borderWidth: 3,
        },
        label: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 8,
          itemStyle: {
            shadowBlur: 30,
            shadowColor: 'rgba(16, 185, 129, 0.5)',
          },
        },
        labelLine: { show: false },
        data: categories.map(cat => ({
          value: getValue(cat),
          name: cat.name,
          severity: cat.severity,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 1, y2: 1,
              colorStops: [
                { offset: 0, color: severityColors[cat.severity] },
                { offset: 1, color: `${severityColors[cat.severity]}cc` },
              ],
            },
            shadowBlur: 12,
            shadowColor: severityGlows[cat.severity],
          },
        })),
        animationType: 'scale',
        animationEasing: 'elasticOut',
        animationDuration: animated ? 900 : 0,
      },
    ],
    
    // Center content
    graphic: showCenter ? [
      {
        type: 'group',
        left: 'center',
        top: 'center',
        children: [
          {
            type: 'text',
            style: {
              text: total.toString(),
              textAlign: 'center',
              fill: orionGreenColors.text.primary,
              fontSize: 28,
              fontWeight: 700,
              fontFamily: 'Inter, sans-serif',
            },
            left: 'center',
            top: -12,
          },
          {
            type: 'text',
            style: {
              text: 'Riscos Totais',
              textAlign: 'center',
              fill: orionGreenColors.text.muted,
              fontSize: 10,
              fontFamily: 'Inter, sans-serif',
            },
            left: 'center',
            top: 16,
          },
        ],
      },
    ] : [],
  }), [categories, total, showCenter, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default RiskHeatRing;

