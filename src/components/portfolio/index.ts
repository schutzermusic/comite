export { ConcentrationChart } from './ConcentrationChart';
export { FilterChips, FILTER_CHIPS } from './FilterChips';
export type { FilterId, FilterChip } from './FilterChips';
export { ProjectDetailDrawer } from './ProjectDetailDrawer';

// Premium Project module — redesigned
export { ProjectHeader } from './ProjectHeader';
export { ProjectClientLogo } from './ProjectClientLogo';
export { ClientLogoBanner } from './ClientLogoBanner';
export { ClientLogoUploadSlot } from './ClientLogoUploadSlot';
export { ProjectHealthIndicator } from './ProjectHealthIndicator';
export { ProjectKpiGrid } from './ProjectKpiGrid';
export type { ProjectKpiSummary } from './ProjectKpiGrid';
export { ProjectFilterBar } from './ProjectFilterBar';
export type { ProjectFilterGroup } from './ProjectFilterBar';
export { ProjectCard } from './ProjectCard';
export { ProjectTable } from './ProjectTable';
export { ProjectSummaryCard } from './ProjectSummaryCard';
export {
  buildProjectPortfolioReport,
  buildReportModel,
  renderReportToHtml,
  openProjectPortfolioReport,
} from './ProjectPdfExportTemplate';
export type {
  PdfExportMode,
  PdfExportResult,
  ProjectPdfFilters,
  ProjectPdfPayload,
  ReportModel,
  ReportRow,
  ReportKpis,
} from './ProjectPdfExportTemplate';
