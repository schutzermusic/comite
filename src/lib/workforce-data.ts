/**
 * Workforce Intelligence Data Layer
 * BFF-friendly TypeScript interfaces for executive workforce analytics
 */

// ============================================
// RISK STATUS TYPES
// ============================================

export type RiskStatus = 'healthy' | 'attention' | 'risk';

// ============================================
// WORKFORCE METRICS
// ============================================

export interface WorkforceHeadcount {
  total: number;
  trend: number; // percentage change vs previous month
  delta: number; // absolute change
  sparkline?: number[];
}

export interface MonthlyPayroll {
  value: number;
  currency: string;
  trend: number; // percentage change
  sparkline?: number[];
}

export interface AvgCostPerEmployee {
  value: number;
  trend: number; // percentage change
  currency: string;
}

export interface PayrollRevenueRatio {
  value: number; // current percentage
  threshold: number; // healthy threshold
  status: RiskStatus;
  previousValue?: number;
}

export interface ContractDistribution {
  pj: number; // headcount PJ
  clt: number; // headcount CLT
  pjPercent: number;
  cltPercent: number;
  pjCost: number;
  cltCost: number;
}

export interface WorkforceMetrics {
  headcount: WorkforceHeadcount;
  monthlyPayroll: MonthlyPayroll;
  avgCostPerEmployee: AvgCostPerEmployee;
  payrollAsRevenuePercent: PayrollRevenueRatio;
  contractDistribution: ContractDistribution;
}

// ============================================
// COST CENTER ANALYSIS
// ============================================

export interface CostCenter {
  id: string;
  name: string;
  payrollValue: number;
  headcount: number;
  growthVsPrevious: number; // percentage
  isAbnormal: boolean; // flagged if growth > 15%
  department?: string;
  manager?: string;
}

export interface CostConcentrationData {
  costCenters: CostCenter[];
  totalPayroll: number;
  top3Concentration: number; // percentage of total in top 3
  currency: string;
}

// ============================================
// HIRING IMPACT SIMULATION
// ============================================

export interface HiringSimulationInputs {
  avgEmployeeCost: number;
  targetEbitdaMargin: number;
  currentRevenue: number;
  currentEbitda: number;
}

export interface HiringSimulationResults {
  requiredRevenuePerHire: number;
  ebitdaImpactWithoutRevenue: number; // percentage points
  breakEvenMonths?: number;
  marginDilution: number;
}

export interface HiringSimulation extends HiringSimulationInputs, HiringSimulationResults {}

// ============================================
// PAYROLL RISK INDICATOR
// ============================================

export interface PayrollRiskData {
  payrollGrowth: number; // percentage
  revenueGrowth: number; // percentage
  status: RiskStatus;
  riskScore: number; // 0-100, feeds into Governance Health
  message: string;
  /**
   * O risco compara CRESCIMENTO DA FOLHA contra CRESCIMENTO DA RECEITA. Sem
   * receita lançada não existe o segundo termo, e o veredito ("Atenção 70/100")
   * seria apenas a folha comparada a zero. Falso desliga o diagnóstico.
   */
  comparable: boolean;
}

// ============================================
// COMPLETE WORKFORCE PAYLOAD
// ============================================

export interface WorkforcePayload {
  metrics: WorkforceMetrics;
  costConcentration: CostConcentrationData;
  payrollRisk: PayrollRiskData;
  lastUpdated: Date;
}

// ============================================
// CALCULATION HELPERS
// ============================================

export function calculateRequiredRevenue(
  employeeCost: number,
  targetMargin: number
): number {
  // Revenue needed = Cost / (1 - margin)
  // To maintain margin after adding cost, need revenue that covers cost at target margin
  return employeeCost / (targetMargin / 100);
}

export function calculateEbitdaImpact(
  employeeCost: number,
  currentRevenue: number,
  currentEbitdaMargin: number
): number {
  // Impact on EBITDA margin if revenue stays flat
  const currentEbitda = currentRevenue * (currentEbitdaMargin / 100);
  const newEbitda = currentEbitda - employeeCost;
  const newMargin = (newEbitda / currentRevenue) * 100;
  return newMargin - currentEbitdaMargin;
}

export function determinePayrollRiskStatus(
  payrollGrowth: number,
  revenueGrowth: number
): RiskStatus {
  const delta = payrollGrowth - revenueGrowth;
  
  if (delta <= 0) return 'healthy';
  if (delta <= 5) return 'attention';
  return 'risk';
}

export function calculatePayrollRiskScore(
  payrollGrowth: number,
  revenueGrowth: number
): number {
  const delta = payrollGrowth - revenueGrowth;
  
  // Score inversely related to risk (higher = healthier)
  if (delta <= 0) return 100;
  if (delta <= 2) return 85;
  if (delta <= 5) return 70;
  if (delta <= 10) return 50;
  if (delta <= 15) return 30;
  return 10;
}

// ============================================
// MOCK DATA SERVICE
// ============================================

/**
 * O payload de demonstração que existia aqui (847 funcionários, R$ 12,85 mi de
 * folha, centros de custo "Engenharia"/"Operações" com gerentes nomeados) foi
 * removido junto com a série sintética de `workforce/period`. Ele não tinha
 * mais nenhum consumidor, e manter dado fabricado exportado é convite para que
 * volte a ter.
 */

export function formatWorkforceCurrency(value: number, currency: string = 'BRL'): string {
  if (value >= 1000000) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatWorkforcePercentage(value: number, showSign: boolean = true): string {
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

