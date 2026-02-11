/**
 * ECharts Orion Green Theme
 * Premium metallic green theme for ECharts
 */

import { orionGreenColors, orionGreenTypography } from './orionGreen';

// ECharts theme registration object
export const echartsOrionGreenTheme = {
  // Color palette for series
  color: [
    orionGreenColors.chart.primary,     // #10b981 - Emerald
    orionGreenColors.chart.secondary,   // #06b6d4 - Cyan
    orionGreenColors.chart.tertiary,    // #22c55e - Green
    orionGreenColors.chart.quaternary,  // #14b8a6 - Teal
    orionGreenColors.chart.quinary,     // #0ea5e9 - Sky
    orionGreenColors.chart.senary,      // #8b5cf6 - Violet
  ],

  // Background
  backgroundColor: 'transparent',

  // Text styles
  textStyle: {
    fontFamily: orionGreenTypography.fontFamily.body,
    color: orionGreenColors.text.secondary,
    fontSize: 12,
  },

  // Title
  title: {
    textStyle: {
      color: orionGreenColors.text.primary,
      fontSize: 16,
      fontWeight: 600,
    },
    subtextStyle: {
      color: orionGreenColors.text.tertiary,
      fontSize: 12,
    },
  },

  // Legend
  legend: {
    textStyle: {
      color: orionGreenColors.text.secondary,
      fontSize: 11,
    },
    pageTextStyle: {
      color: orionGreenColors.text.tertiary,
    },
    pageIconColor: orionGreenColors.accent.primary,
    pageIconInactiveColor: orionGreenColors.text.muted,
  },

  // Tooltip
  tooltip: {
    backgroundColor: orionGreenColors.bg.overlay,
    borderColor: orionGreenColors.border.default,
    borderWidth: 1,
    borderRadius: 8,
    padding: [12, 16],
    textStyle: {
      color: orionGreenColors.text.primary,
      fontSize: 12,
    },
    extraCssText: `
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 1px rgba(16, 185, 129, 0.3);
    `,
  },

  // Grid (chart area)
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    top: '10%',
    containLabel: true,
  },

  // Category Axis
  categoryAxis: {
    axisLine: {
      show: true,
      lineStyle: {
        color: orionGreenColors.border.subtle,
      },
    },
    axisTick: {
      show: false,
    },
    axisLabel: {
      color: orionGreenColors.text.tertiary,
      fontSize: 11,
    },
    splitLine: {
      show: false,
    },
  },

  // Value Axis
  valueAxis: {
    axisLine: {
      show: false,
    },
    axisTick: {
      show: false,
    },
    axisLabel: {
      color: orionGreenColors.text.muted,
      fontSize: 11,
    },
    splitLine: {
      show: true,
      lineStyle: {
        color: orionGreenColors.border.subtle,
        type: 'dashed',
      },
    },
  },

  // Time Axis
  timeAxis: {
    axisLine: {
      show: true,
      lineStyle: {
        color: orionGreenColors.border.subtle,
      },
    },
    axisTick: {
      show: false,
    },
    axisLabel: {
      color: orionGreenColors.text.tertiary,
      fontSize: 11,
    },
    splitLine: {
      show: false,
    },
  },

  // Line series
  line: {
    smooth: true,
    symbol: 'circle',
    symbolSize: 6,
    lineStyle: {
      width: 2.5,
    },
    emphasis: {
      focus: 'series',
      lineStyle: {
        width: 3,
      },
    },
    itemStyle: {
      borderWidth: 2,
      borderColor: orionGreenColors.bg.primary,
    },
  },

  // Bar series
  bar: {
    barMaxWidth: 40,
    itemStyle: {
      borderRadius: [4, 4, 0, 0],
    },
    emphasis: {
      focus: 'series',
    },
  },

  // Pie/Donut series
  pie: {
    itemStyle: {
      borderWidth: 2,
      borderColor: orionGreenColors.bg.primary,
    },
    label: {
      color: orionGreenColors.text.secondary,
      fontSize: 11,
    },
    emphasis: {
      scale: true,
      scaleSize: 5,
      itemStyle: {
        shadowBlur: 20,
        shadowColor: 'rgba(16, 185, 129, 0.3)',
      },
    },
  },

  // Gauge series
  gauge: {
    axisLine: {
      lineStyle: {
        width: 12,
        color: [
          [0.3, orionGreenColors.semantic.error],
          [0.7, orionGreenColors.semantic.warning],
          [1, orionGreenColors.semantic.success],
        ],
      },
    },
    axisTick: {
      show: false,
    },
    axisLabel: {
      show: false,
    },
    splitLine: {
      show: false,
    },
    pointer: {
      show: true,
      length: '70%',
      width: 4,
      itemStyle: {
        color: orionGreenColors.text.primary,
      },
    },
    detail: {
      fontSize: 24,
      fontWeight: 700,
      color: orionGreenColors.text.primary,
      offsetCenter: [0, '40%'],
    },
    title: {
      offsetCenter: [0, '70%'],
      fontSize: 12,
      color: orionGreenColors.text.tertiary,
    },
  },

  // Radar series
  radar: {
    axisLine: {
      lineStyle: {
        color: orionGreenColors.border.subtle,
      },
    },
    splitLine: {
      lineStyle: {
        color: orionGreenColors.border.subtle,
      },
    },
    splitArea: {
      show: false,
    },
    axisName: {
      color: orionGreenColors.text.tertiary,
      fontSize: 11,
    },
  },

  // Data zoom (for scrollable charts)
  dataZoom: [
    {
      type: 'inside',
      throttle: 50,
    },
    {
      type: 'slider',
      height: 20,
      bottom: 0,
      borderColor: 'transparent',
      backgroundColor: orionGreenColors.bg.tertiary,
      fillerColor: orionGreenColors.accent.primaryGlow,
      handleStyle: {
        color: orionGreenColors.accent.primary,
        borderColor: orionGreenColors.accent.primary,
      },
      textStyle: {
        color: orionGreenColors.text.tertiary,
      },
    },
  ],

  // Visual map
  visualMap: {
    textStyle: {
      color: orionGreenColors.text.secondary,
    },
    inRange: {
      color: [
        orionGreenColors.bg.elevated,
        orionGreenColors.chart.quaternary,
        orionGreenColors.chart.primary,
      ],
    },
  },
} as const;

/**
 * Get area gradient for line charts
 */
export function getAreaGradient(
  colorStart: string = 'rgba(16, 185, 129, 0.4)',
  colorEnd: string = 'rgba(16, 185, 129, 0.02)'
) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: colorStart },
      { offset: 1, color: colorEnd },
    ],
  };
}

/**
 * Get glow effect for series
 */
export function getGlowEffect(color: string = orionGreenColors.accent.primary) {
  return {
    shadowBlur: 15,
    shadowColor: `${color}40`,
    shadowOffsetY: 2,
  };
}

/**
 * Tooltip formatter for currency values
 */
export function currencyTooltipFormatter(value: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Tooltip formatter for percentages
 */
export function percentTooltipFormatter(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export type EChartsOrionGreenTheme = typeof echartsOrionGreenTheme;

/**
 * Get mini chart configuration for compact visualizations
 * Optimized for Performance & Trust card components
 */
export function getMiniChartConfig() {
  return {
    grid: {
      left: 0,
      right: 0,
      top: 2,
      bottom: 2,
    },
    animationDuration: 800,
    animationEasing: 'cubicOut' as const,
  };
}


