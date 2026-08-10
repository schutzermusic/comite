/* ── Risk Control Room — Component Index ── */

// Core components
export { RiskMatrix5x5 } from "./risk-matrix";
export { RiskMitigationFunnel } from "./RiskMitigationFunnel";
export { RiskMitigationPipeline } from "./RiskMitigationPipeline";
export { RiskStatusPipeline } from "./RiskStatusPipeline";
export { RiskActionQueue } from "./RiskActionQueue";
export { RiskTable } from "./RiskTable";
export { RiskDetailDrawer } from "./RiskDetailDrawer";
export { RiskDrawer } from "./RiskDrawer";
export { RiskDrilldownDrawer } from "./RiskDrilldownDrawer";
export { RiskFormModal } from "./RiskFormModal";
export type { RiskFormValues, RiskLink } from "./RiskFormModal";
export { RiskKpiGrid } from "./RiskKpiGrid";
export type { RiskKpiCardData, KpiTone } from "./RiskKpiGrid";
export { RiskInsightStrip } from "./RiskInsightStrip";
export { RiskAiAlerts } from "./RiskAiAlerts";
export { RiskMap, RISK_MAP_PLOT_HEIGHT, RISK_MAP_TOTAL_HEIGHT } from "./RiskMap";
export type { RiskMapPoint } from "./RiskMap";

// Charts
export {
  SeverityDistributionChart,
  SeverityDonutWithLegend,
  StatusBreakdownChart,
  RiskExposureTrendChart,
  CategoryDistributionChart,
  TopRiskOwnersChart,
  RiskAreaExposureChart,
  RiskWaterfallChart,
  RiskHeatmapChart,
  MitigationFunnelChart,
  RiskHeatByAreaChart,
} from "./risk-charts";

// Data & Types
export { MOCK_RISKS, TREND_DATA } from "./risk-mock-data";
export { DEMO_RISKS, DEMO_TREND } from "./risk-demo-data";
export type { TrendPoint } from "./risk-demo-data";
export type { ExtendedRisk, DrawerContext, FunnelStage } from "./risk-types";
export {
  FUNNEL_STAGE_LABELS,
  FUNNEL_STAGE_ORDER,
  SEVERITY_LABELS,
  STATUS_LABELS,
  CATEGORY_LABELS,
  RISK_DOMAINS,
  categoryToDomain,
} from "./risk-types";
export * from "./risk-utils";
export * from "./risk-analytics";
