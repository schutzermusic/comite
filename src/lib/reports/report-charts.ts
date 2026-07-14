/**
 * Inline-SVG chart primitives for print (vector — crisp at any DPI, never a
 * screenshot of the dark app UI). Every chart renders visible numeric labels,
 * callouts and legends because the PDF is static.
 *
 * Implementation lives in `./charts/*` (split by family, all with the shared
 * 2.5D depth treatment from `charts/core.ts`); this barrel preserves the
 * original import path for every module builder.
 */

export {
  niceTicks, chartFrame, emptyChart, legend, callouts, chartUid, depthDefs,
  type ValueFmt, type LineSeries, type ChartMarker, type BarSeries, type DepthDefs,
} from './charts/core';
export { svgLineChart, svgAreaChart, svgSparkline } from './charts/lines';
export {
  svgGroupedBarChart, svgScenarioBars, svgHorizontalBar, svgStackedBar,
  svgWaterfall, svgBullet, type WaterfallStep,
} from './charts/bars';
export { svgDonut, svgGauge, svgProgressRing } from './charts/radial';
export { svgRiskMatrix, svgHeatmapGrid, svgTimelineStrip, type TimelineMarker } from './charts/matrix';
