/**
 * Portfolio-level KPI aggregation over enriched governance records — extracted
 * from the contratos page `stats` useMemo so the screen Executive Band and the
 * PDF report consume the exact same numbers and can never diverge.
 */

import { computeApprovalSla } from '@/lib/contracts/contract-service';
import type { ContractGovernanceRecord } from './contract-governance-data';

export interface ContractPortfolioStats {
  totalValue: number;
  billedValue: number;
  remainingValue: number;
  expiring: number;
  within30: number;
  highRisk: number;
  highRiskExposure: number;
  missingDocs: number;
  contractsWithMissing: number;
  contractsWithBalance: number;
  legalReview: number;
  semProjeto: number;
  semFaturamento: number;
  semIa: number;
  overdue: number;
  contractsWithOverdue: number;
  avgSla: number;
  slaLive: boolean;
  billedPct: number;
  backlogPct: number;
}

export function computeContractPortfolioStats(records: ContractGovernanceRecord[]): ContractPortfolioStats {
  const totalValue = records.reduce((sum, record) => sum + record.totalValue, 0);
  const billedValue = records.reduce((sum, record) => sum + record.billedValue, 0);
  const remainingValue = records.reduce((sum, record) => sum + record.remainingValue, 0);
  const expiring = records.filter((record) => record.daysUntilExpiration !== null && record.daysUntilExpiration >= 0 && record.daysUntilExpiration <= 90).length;
  const within30 = records.filter((record) => record.daysUntilExpiration !== null && record.daysUntilExpiration >= 0 && record.daysUntilExpiration <= 30).length;
  const highRisk = records.filter((record) => record.contract.riskClassification === 'high').length;
  const highRiskExposure = records
    .filter((record) => record.contract.riskClassification === 'high')
    .reduce((sum, record) => sum + record.totalValue, 0);
  const missingDocs = records.reduce((sum, record) => sum + record.missingDocuments.length, 0);
  const contractsWithMissing = records.filter((record) => record.missingDocuments.length > 0).length;
  const contractsWithBalance = records.filter((record) => record.remainingValue > 0).length;
  const legalReview = records.filter((record) => record.contract.status === 'legal_review' || record.legalStatus !== 'approved').length;
  const semProjeto = records.filter((record) => !record.project).length;
  const semFaturamento = records.filter((record) => record.billedValue === 0).length;
  const semIa = records.filter((record) => record.aiStatus === 'mock_pending').length;
  const obligations = records.flatMap((record) => record.obligations);
  const overdue = obligations.filter((obligation) => obligation.status === 'overdue').length;
  const contractsWithOverdue = records.filter((record) => record.obligations.some((o) => o.status === 'overdue')).length;
  const heuristicSla = Math.round(18 + records.reduce((sum, record) => sum + (record.riskScore > 70 ? 8 : 2), 0) / Math.max(records.length, 1));
  const approvalRows = records.flatMap((record) => record.liveApprovals ?? []);
  const liveSla = approvalRows.length ? computeApprovalSla(approvalRows) : null;
  const avgSla = liveSla?.avgHours ?? heuristicSla;
  const slaLive = liveSla?.avgHours != null;
  const billedPct = totalValue ? Math.round((billedValue / totalValue) * 100) : 0;
  const backlogPct = totalValue ? Math.round((remainingValue / totalValue) * 100) : 0;

  return {
    totalValue, billedValue, remainingValue, expiring, within30, highRisk, highRiskExposure,
    missingDocs, contractsWithMissing, contractsWithBalance, legalReview, semProjeto, semFaturamento, semIa,
    overdue, contractsWithOverdue, avgSla, slaLive, billedPct, backlogPct,
  };
}
