export * from './types';
export {
  FinanceFilterBar,
  FinanceFilterChip,
  FinanceFilterRange,
  FinanceFilterDateField,
  FinanceFilterSegment,
  FILTER_CHIP_SHELL,
  FILTER_CHIP_LABEL,
  CHIP_DIVIDER,
  FILTER_CHIP_LAYOUT,
  type FinanceFilterBarProps,
  type FinanceFilterChipProps,
  type FinanceFilterChipLayout,
  type FinanceFilterRangeProps,
  type FinanceFilterDateFieldProps,
  type FinanceFilterSegmentProps,
} from './FinanceFilterBar';
export { FinanceInsightCard, type FinanceInsight, type FinanceInsightTone } from './FinanceInsightCard';
export {
  FinanceDetailDrawer,
  FinanceDrawerSection,
  FinanceDrawerKeyValue,
} from './FinanceDetailDrawer';
export { FinanceStatusBadge, type FinanceStatus } from './FinanceStatusBadge';

// Theme tokens come from the existing FinanceMiniChart module (kept for back-compat).
export { useFinanceChartTokens } from './FinanceMiniChart';

// All chart components are now the futuristic SVG implementations — same public API.
export {
  FinanceLineChart,
  FinanceBarChart,
  FinanceWaterfallChart,
  FinanceSCurveChart, type SCurveSeries,
  FinanceDonutChart, type DonutSlice,
  FinanceTreemapChart, type TreemapNode,
  FinanceRadarChart, type RadarSeries,
  FinanceBubbleChart, type BubblePoint,
  FinanceStackedBarChart, type StackedBarSeries,
  FinanceAdvancedWaterfallChart, type WaterfallStep,
  FinanceTornadoChart, type TornadoRow,
  FinanceSparkline,
  FinanceRadialProgress,
  FinanceRankMatrix, type RankRow, type FinanceRankMatrixProps,
  // Paleta e hook de tema: a camada de relatório desenha a mesma série em
  // SVG-string e precisa das mesmas cores da tela.
  PALETTE_DARK, PALETTE_LIGHT, useChartTheme, type Tone,
} from './FuturisticCharts';

export { Finance3DMetricCard, type Finance3DMetricCardProps, type Finance3DTone } from './Finance3DMetricCard';

// Standardized KPI grid — converts a FinanceKpi[] (canonical contract) into
// the HudKpiStrip layout and wires the click-to-drawer affordance.
export { FinanceKpiGrid, type FinanceKpiGridProps } from './FinanceKpiGrid';

// Generic chart container that scopes any horizontal overflow to itself.
export { FinanceChartContainer, type FinanceChartContainerProps } from './FinanceChartContainer';
