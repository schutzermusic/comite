'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';

interface VotingStatusDonutProps {
  approved: number;
  rejected: number;
  pending: number;
  height?: number | string;
  showCenter?: boolean;
  animated?: boolean;
  className?: string;
}

/**
 * Voting Status Donut Chart
 * Ultra clean donut with subtle glow edge - ECharts version
 */
export function VotingStatusDonut({
  approved,
  rejected,
  pending,
  height = 200,
  showCenter = true,
  animated = true,
  className,
}: VotingStatusDonutProps) {
  const total = approved + rejected + pending;
  
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
      formatter: (params: { name: string; value: number; percent: number }) => {
        return `
          <div style="font-size: 11px; color: ${orionGreenColors.text.tertiary}; margin-bottom: 4px;">
            ${params.name}
          </div>
          <div style="font-size: 16px; font-weight: 600; color: ${orionGreenColors.text.primary};">
            ${params.value} <span style="font-size: 12px; color: ${orionGreenColors.text.muted};">(${params.percent.toFixed(0)}%)</span>
          </div>
        `;
      },
    },
    
    series: [
      {
        type: 'pie',
        radius: ['62%', '85%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 6,
          borderColor: orionGreenColors.bg.primary,
          borderWidth: 3,
        },
        label: {
          show: false,
        },
        emphasis: {
          scale: true,
          scaleSize: 6,
          itemStyle: {
            shadowBlur: 25,
            shadowColor: 'rgba(16, 185, 129, 0.4)',
          },
        },
        labelLine: {
          show: false,
        },
        data: [
          {
            value: approved,
            name: 'Aprovadas',
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 1, y2: 1,
                colorStops: [
                  { offset: 0, color: orionGreenColors.semantic.success },
                  { offset: 1, color: '#059669' },
                ],
              },
              shadowBlur: 12,
              shadowColor: orionGreenColors.semantic.successGlow,
            },
          },
          {
            value: rejected,
            name: 'Rejeitadas',
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 1, y2: 1,
                colorStops: [
                  { offset: 0, color: orionGreenColors.semantic.error },
                  { offset: 1, color: '#dc2626' },
                ],
              },
              shadowBlur: 10,
              shadowColor: orionGreenColors.semantic.errorGlow,
            },
          },
          {
            value: pending,
            name: 'Pendentes',
            itemStyle: {
              color: {
                type: 'linear',
                x: 0, y: 0, x2: 1, y2: 1,
                colorStops: [
                  { offset: 0, color: orionGreenColors.text.muted },
                  { offset: 1, color: '#3d5a4c' },
                ],
              },
            },
          },
        ],
        animationType: 'scale',
        animationEasing: 'elasticOut',
        animationDuration: animated ? 800 : 0,
      },
    ],
    
    // Center label
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
            top: -10,
          },
          {
            type: 'text',
            style: {
              text: 'Total',
              textAlign: 'center',
              fill: orionGreenColors.text.muted,
              fontSize: 11,
              fontFamily: 'Inter, sans-serif',
            },
            left: 'center',
            top: 18,
          },
        ],
      },
    ] : [],
  }), [approved, rejected, pending, total, showCenter, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default VotingStatusDonut;

