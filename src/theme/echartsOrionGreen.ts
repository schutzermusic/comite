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



// =============================================================================
// LIGHT THEME VARIANT
// =============================================================================

/** Light-mode color tokens for ECharts */
const lightColors = {
  text: {
    primary: '#1a2520',
    secondary: '#3a4f46',
    tertiary: '#567066',
    muted: '#728c80',
  },
  bg: {
    primary: '#f4f5f3',
    secondary: '#edeee9',
    tertiary: '#e6e8e2',
    elevated: '#ffffff',
    overlay: 'rgba(255, 255, 255, 0.92)',
  },
  border: {
    subtle: 'rgba(0, 0, 0, 0.06)',
    default: 'rgba(0, 0, 0, 0.10)',
  },
  accent: {
    primary: '#4d7c0f',       // Lime-700 WCAG AA compliant
    primaryGlow: 'rgba(101, 163, 13, 0.15)',
  },
  chart: {
    primary: '#059669',       // Emerald-600 (darker for contrast)
    secondary: '#0891b2',     // Cyan-600
    tertiary: '#16a34a',      // Green-600
    quaternary: '#0d9488',    // Teal-600
    quinary: '#0284c7',      // Sky-600
    senary: '#7c3aed',       // Violet-600
  },
} as const;

/**
 * ECharts Light Theme — Executive Boardroom Mode
 * Muted palette, high contrast text, subtle shadows
 */
export const echartsOrionGreenLightTheme = {
  color: [
    lightColors.chart.primary,
    lightColors.chart.secondary,
    lightColors.chart.tertiary,
    lightColors.chart.quaternary,
    lightColors.chart.quinary,
    lightColors.chart.senary,
  ],

  backgroundColor: 'transparent',

  textStyle: {
    fontFamily: orionGreenTypography.fontFamily.body,
    color: lightColors.text.secondary,
    fontSize: 12,
  },

  title: {
    textStyle: {
      color: lightColors.text.primary,
      fontSize: 16,
      fontWeight: 600,
    },
    subtextStyle: {
      color: lightColors.text.tertiary,
      fontSize: 12,
    },
  },

  legend: {
    textStyle: {
      color: lightColors.text.secondary,
      fontSize: 11,
    },
    pageTextStyle: {
      color: lightColors.text.tertiary,
    },
    pageIconColor: lightColors.accent.primary,
    pageIconInactiveColor: lightColors.text.muted,
  },

  tooltip: {
    backgroundColor: lightColors.bg.overlay,
    borderColor: lightColors.border.default,
    borderWidth: 1,
    borderRadius: 8,
    padding: [12, 16],
    textStyle: {
      color: lightColors.text.primary,
      fontSize: 12,
    },
    extraCssText: `
      backdrop-filter: blur(12px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08), 0 0 1px rgba(0, 0, 0, 0.12);
    `,
  },

  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    top: '10%',
    containLabel: true,
  },

  categoryAxis: {
    axisLine: {
      show: true,
      lineStyle: {
        color: lightColors.border.subtle,
      },
    },
    axisTick: { show: false },
    axisLabel: {
      color: lightColors.text.tertiary,
      fontSize: 11,
    },
    splitLine: { show: false },
  },

  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: {
      color: lightColors.text.muted,
      fontSize: 11,
    },
    splitLine: {
      show: true,
      lineStyle: {
        color: lightColors.border.subtle,
        type: 'dashed',
      },
    },
  },

  timeAxis: {
    axisLine: {
      show: true,
      lineStyle: { color: lightColors.border.subtle },
    },
    axisTick: { show: false },
    axisLabel: {
      color: lightColors.text.tertiary,
      fontSize: 11,
    },
    splitLine: { show: false },
  },

  line: {
    smooth: true,
    symbol: 'circle',
    symbolSize: 6,
    lineStyle: { width: 2.5 },
    emphasis: {
      focus: 'series',
      lineStyle: { width: 3 },
    },
    itemStyle: {
      borderWidth: 2,
      borderColor: lightColors.bg.elevated,
    },
  },

  bar: {
    barMaxWidth: 40,
    itemStyle: { borderRadius: [4, 4, 0, 0] },
    emphasis: { focus: 'series' },
  },

  pie: {
    itemStyle: {
      borderWidth: 2,
      borderColor: lightColors.bg.elevated,
    },
    label: {
      color: lightColors.text.secondary,
      fontSize: 11,
    },
    emphasis: {
      scale: true,
      scaleSize: 5,
      itemStyle: {
        shadowBlur: 12,
        shadowColor: 'rgba(0, 0, 0, 0.15)',
      },
    },
  },

  gauge: {
    axisLine: {
      lineStyle: {
        width: 12,
        color: [
          [0.3, '#dc2626'],   // Red-600
          [0.7, '#d97706'],   // Amber-600
          [1, '#059669'],     // Emerald-600
        ],
      },
    },
    axisTick: { show: false },
    axisLabel: { show: false },
    splitLine: { show: false },
    pointer: {
      show: true,
      length: '70%',
      width: 4,
      itemStyle: { color: lightColors.text.primary },
    },
    detail: {
      fontSize: 24,
      fontWeight: 700,
      color: lightColors.text.primary,
      offsetCenter: [0, '40%'],
    },
    title: {
      offsetCenter: [0, '70%'],
      fontSize: 12,
      color: lightColors.text.tertiary,
    },
  },

  radar: {
    axisLine: {
      lineStyle: { color: lightColors.border.subtle },
    },
    splitLine: {
      lineStyle: { color: lightColors.border.subtle },
    },
    splitArea: { show: false },
    axisName: {
      color: lightColors.text.tertiary,
      fontSize: 11,
    },
  },

  dataZoom: [
    { type: 'inside', throttle: 50 },
    {
      type: 'slider',
      height: 20,
      bottom: 0,
      borderColor: 'transparent',
      backgroundColor: lightColors.bg.tertiary,
      fillerColor: lightColors.accent.primaryGlow,
      handleStyle: {
        color: lightColors.accent.primary,
        borderColor: lightColors.accent.primary,
      },
      textStyle: { color: lightColors.text.tertiary },
    },
  ],

  visualMap: {
    textStyle: { color: lightColors.text.secondary },
    inRange: {
      color: [
        lightColors.bg.tertiary,
        lightColors.chart.quaternary,
        lightColors.chart.primary,
      ],
    },
  },
} as const;

export type EChartsOrionGreenLightTheme = typeof echartsOrionGreenLightTheme;

/**
 * Returns the correct ECharts theme object based on the current theme.
 * Use with: echarts.registerTheme('orion', getEchartsTheme(theme))
 */
export function getEchartsTheme(theme: 'light' | 'dark') {
  return theme === 'light' ? echartsOrionGreenLightTheme : echartsOrionGreenTheme;
}

/**
 * Get area gradient for line charts — light mode variant
 */
export function getAreaGradientLight(
  colorStart: string = 'rgba(5, 150, 105, 0.25)',
  colorEnd: string = 'rgba(5, 150, 105, 0.02)'
) {
  return getAreaGradient(colorStart, colorEnd);
}

/**
 * Get glow effect for series — light mode (softer shadow)
 */
export function getGlowEffectLight(color: string = lightColors.accent.primary) {
  return {
    shadowBlur: 8,
    shadowColor: `${color}20`,
    shadowOffsetY: 2,
  };
}
