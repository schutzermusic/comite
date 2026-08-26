/**
 * Cockpit de contrato — componentes de apresentação sobre o modelo confiável.
 *
 * Todos consomem `TrustedContract` / `Official<T>` e nenhum aceita `number`
 * cru para indicador: a tipagem impede que um valor sintético ou ausente entre
 * por um atalho de props.
 */

export { TrustedValue, TrustedProvenanceBadge, TrustedCoverage } from './TrustedValue';
export { ContractIdentity } from './ContractIdentity';
export { ProjectRelation } from './ProjectRelation';
export { FinancialPulse } from './FinancialPulse';
export { RequiresAttention } from './RequiresAttention';
export { ConnectedOperations, type ConnectedOperationKey } from './ConnectedOperations';
export { buildConnectedRows, type ConnectedRow } from '@/lib/contracts/trust/connected';
export { ContractHealthDrivers } from './ContractHealthDrivers';
export { RecommendedActionPanel } from './RecommendedAction';
export { RecentActivity, AUDIT_ACTION_LABELS } from './RecentActivity';
export {
  PortfolioScopeBar, PortfolioScopeNotice, DataClassBadge, matchesScope, PORTFOLIO_SCOPES,
  type PortfolioScopeKey,
} from './PortfolioScope';
export { PortfolioHero } from './PortfolioHero';
export { ModuleConnections } from './ModuleConnections';
export { PortfolioHorizon } from './PortfolioHorizon';
export { PortfolioAttention } from './PortfolioAttention';
export { ContractInstrumentCard } from './ContractInstrumentCard';
export { ContractSmartTable } from './ContractSmartTable';
export { OnboardingReadinessPanel } from './OnboardingReadiness';
export { PortfolioActivity } from './PortfolioActivity';
