'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { orionGreenColors } from '@/theme/orionGreen';

interface TimelineItem {
  name: string;
  startDate: string;
  endDate: string;
  progress: number; // 0-100
  status: 'on_track' | 'at_risk' | 'delayed' | 'completed';
}

interface StrategyTimelineProps {
  items: TimelineItem[];
  height?: number | string;
  animated?: boolean;
  className?: string;
}

const statusColors = {
  on_track: orionGreenColors.semantic.success,
  at_risk: orionGreenColors.semantic.warning,
  delayed: orionGreenColors.semantic.error,
  completed: orionGreenColors.accent.secondary,
};

const statusGlows = {
  on_track: orionGreenColors.semantic.successGlow,
  at_risk: orionGreenColors.semantic.warningGlow,
  delayed: orionGreenColors.semantic.errorGlow,
  completed: orionGreenColors.accent.secondaryGlow,
};

/**
 * Strategy Timeline / Gantt-like Chart
 * Clean timeline view for strategic initiatives
 */
export function StrategyTimeline({
  items,
  height = 300,
  animated = true,
  className,
}: StrategyTimelineProps) {
  // Parse dates and calculate positions
  const { categories, series, minDate, maxDate } = useMemo(() => {
    const allDates = items.flatMap(item => [
      new Date(item.startDate).getTime(),
      new Date(item.endDate).getTime(),
    ]);
    const min = Math.min(...allDates);
    const max = Math.max(...allDates);
    const range = max - min;

    const cats = items.map(item => item.name);
    
    // Background bars (full range)
    const bgData = items.map((item, index) => {
      const start = new Date(item.startDate).getTime();
      const end = new Date(item.endDate).getTime();
      return {
        value: [index, start, end],
        itemStyle: {
          color: orionGreenColors.bg.elevated,
          borderRadius: 4,
        },
      };
    });

    // Progress bars
    const progressData = items.map((item, index) => {
      const start = new Date(item.startDate).getTime();
      const end = new Date(item.endDate).getTime();
      const duration = end - start;
      const progressEnd = start + (duration * item.progress / 100);
      const color = statusColors[item.status];
      const glow = statusGlows[item.status];
      
      return {
        value: [index, start, progressEnd],
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: color },
              { offset: 1, color: `${color}cc` },
            ],
          },
          borderRadius: 4,
          shadowBlur: 8,
          shadowColor: glow,
        },
      };
    });

    return {
      categories: cats,
      series: { bgData, progressData },
      minDate: min,
      maxDate: max,
    };
  }, [items]);

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
      formatter: (params: { dataIndex: number }) => {
        const item = items[params.dataIndex];
        const statusLabel = {
          on_track: 'On Track',
          at_risk: 'At Risk',
          delayed: 'Delayed',
          completed: 'Completed',
        }[item.status];
        
        return `
          <div style="font-weight: 600; margin-bottom: 8px; color: ${orionGreenColors.text.primary};">
            ${item.name}
          </div>
          <div style="font-size: 11px; color: ${orionGreenColors.text.tertiary}; margin-bottom: 4px;">
            ${item.startDate} → ${item.endDate}
          </div>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
            <div style="
              width: 8px; 
              height: 8px; 
              border-radius: 50%; 
              background: ${statusColors[item.status]};
              box-shadow: 0 0 6px ${statusGlows[item.status]};
            "></div>
            <span style="color: ${statusColors[item.status]}; font-weight: 500;">
              ${statusLabel} • ${item.progress}%
            </span>
          </div>
        `;
      },
    },
    
    grid: {
      left: '3%',
      right: '4%',
      top: '8%',
      bottom: '8%',
      containLabel: true,
    },
    
    xAxis: {
      type: 'time',
      min: minDate,
      max: maxDate,
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
        formatter: (value: number) => {
          const date = new Date(value);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        },
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: orionGreenColors.border.subtle,
          type: 'dashed',
        },
      },
    },
    
    yAxis: {
      type: 'category',
      data: categories,
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: orionGreenColors.text.secondary,
        fontSize: 11,
        fontWeight: 500,
      },
    },
    
    series: [
      // Background bars
      {
        type: 'custom',
        renderItem: (params: { coordSys: { x: number; y: number; width: number; height: number } }, api: { value: (dim: number) => number; coord: (val: [number, number]) => [number, number]; size: (val: [number, number]) => [number, number] }) => {
          const categoryIndex = api.value(0);
          const start = api.coord([api.value(1), categoryIndex]);
          const end = api.coord([api.value(2), categoryIndex]);
          const height = api.size([0, 1])[1] * 0.5;
          
          return {
            type: 'rect',
            shape: {
              x: start[0],
              y: start[1] - height / 2,
              width: end[0] - start[0],
              height: height,
              r: 4,
            },
            style: {
              fill: orionGreenColors.bg.elevated,
            },
          };
        },
        data: series.bgData,
        z: 1,
      },
      // Progress bars
      {
        type: 'custom',
        renderItem: (params: { coordSys: { x: number; y: number; width: number; height: number } }, api: { value: (dim: number) => number; coord: (val: [number, number]) => [number, number]; size: (val: [number, number]) => [number, number] }) => {
          const categoryIndex = api.value(0);
          const item = items[categoryIndex];
          const start = api.coord([api.value(1), categoryIndex]);
          const end = api.coord([api.value(2), categoryIndex]);
          const height = api.size([0, 1])[1] * 0.5;
          const color = statusColors[item.status];
          
          return {
            type: 'rect',
            shape: {
              x: start[0],
              y: start[1] - height / 2,
              width: Math.max(end[0] - start[0], 4),
              height: height,
              r: 4,
            },
            style: {
              fill: color,
              shadowBlur: 8,
              shadowColor: statusGlows[item.status],
            },
          };
        },
        data: series.progressData,
        z: 2,
        animationDuration: animated ? 1000 : 0,
        animationEasing: 'cubicOut',
      },
    ],
  }), [categories, series, items, minDate, maxDate, animated]);

  return (
    <ReactECharts
      option={option}
      style={{ height, width: '100%' }}
      className={className}
      opts={{ renderer: 'canvas' }}
    />
  );
}

export default StrategyTimeline;






















