/**
 * Cockpit da Visão Geral de Pessoas & Custos.
 *
 * Todo componente daqui consome `WorkforceOverviewModel` — o mesmo payload que
 * alimenta o PDF, o deck HTML e o PowerPoint.
 */

export { WorkforceCommandBar } from './WorkforceCommandBar';
export { WorkforceUnitFilter } from './WorkforceUnitFilter';
export { WorkforceExportMenu } from './WorkforceExportMenu';
export { WorkforceScopeNotice } from './WorkforceScopeNotice';
export { WorkforceSectionHeader } from './WorkforceSectionHeader';
export { WorkforceEmptyPanel } from './WorkforceEmptyPanel';
export { SectionNavStrip } from './SectionNavStrip';
export {
  WorkforceMeasuredValue,
  measuredText,
  formatMeasuredNumber,
  unmeasuredNote,
} from './WorkforceMeasuredValue';

export { ExecutiveSummarySection } from './sections/ExecutiveSummarySection';
export { EfficiencySection } from './sections/EfficiencySection';
export { WorkforceDynamicsSection } from './sections/WorkforceDynamicsSection';
export { CostStructureSection } from './sections/CostStructureSection';
export { RiskConcentrationSection } from './sections/RiskConcentrationSection';
export { ComplianceSection } from './sections/ComplianceSection';
export { SimulatorSection } from './sections/SimulatorSection';
