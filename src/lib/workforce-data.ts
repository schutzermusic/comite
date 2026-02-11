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

export function getMockWorkforceData(): WorkforcePayload {
  const payrollGrowth = 8.5;
  const revenueGrowth = 6.2;
  const riskStatus = determinePayrollRiskStatus(payrollGrowth, revenueGrowth);
  const riskScore = calculatePayrollRiskScore(payrollGrowth, revenueGrowth);

  return {
    metrics: {
      headcount: {
        total: 847,
        trend: 3.2,
        delta: 26,
        sparkline: [795, 802, 810, 818, 825, 832, 847],
      },
      monthlyPayroll: {
        value: 12850000,
        currency: 'BRL',
        trend: 4.8,
        sparkline: [11200000, 11450000, 11800000, 12100000, 12350000, 12600000, 12850000],
      },
      avgCostPerEmployee: {
        value: 15171,
        trend: 1.5,
        currency: 'BRL',
      },
      payrollAsRevenuePercent: {
        value: 28.4,
        threshold: 30,
        status: 'healthy',
        previousValue: 27.8,
      },
      contractDistribution: {
        pj: 312,
        clt: 535,
        pjPercent: 36.8,
        cltPercent: 63.2,
        pjCost: 5460000,
        cltCost: 7390000,
      },
    },
    costConcentration: {
      costCenters: [
        {
          id: 'cc-001',
          name: 'Engenharia',
          payrollValue: 3850000,
          headcount: 185,
          growthVsPrevious: 12.5,
          isAbnormal: false,
          department: 'Tecnologia',
          manager: 'Carlos Silva',
        },
        {
          id: 'cc-002',
          name: 'Operações',
          payrollValue: 2950000,
          headcount: 245,
          growthVsPrevious: 8.2,
          isAbnormal: false,
          department: 'Operações',
          manager: 'Ana Costa',
        },
        {
          id: 'cc-003',
          name: 'Comercial',
          payrollValue: 2180000,
          headcount: 120,
          growthVsPrevious: 18.5,
          isAbnormal: true,
          department: 'Vendas',
          manager: 'Roberto Mendes',
        },
        {
          id: 'cc-004',
          name: 'Administrativo',
          payrollValue: 1420000,
          headcount: 95,
          growthVsPrevious: 3.2,
          isAbnormal: false,
          department: 'Corporativo',
          manager: 'Maria Santos',
        },
        {
          id: 'cc-005',
          name: 'P&D',
          payrollValue: 1250000,
          headcount: 65,
          growthVsPrevious: 22.8,
          isAbnormal: true,
          department: 'Inovação',
          manager: 'Paulo Lima',
        },
        {
          id: 'cc-006',
          name: 'Marketing',
          payrollValue: 720000,
          headcount: 42,
          growthVsPrevious: 5.5,
          isAbnormal: false,
          department: 'Marketing',
          manager: 'Fernanda Rocha',
        },
        {
          id: 'cc-007',
          name: 'RH',
          payrollValue: 480000,
          headcount: 35,
          growthVsPrevious: 2.1,
          isAbnormal: false,
          department: 'Pessoas',
          manager: 'Juliana Alves',
        },
      ],
      totalPayroll: 12850000,
      top3Concentration: 69.8,
      currency: 'BRL',
    },
    payrollRisk: {
      payrollGrowth,
      revenueGrowth,
      status: riskStatus,
      riskScore,
      message: riskStatus === 'healthy' 
        ? 'Crescimento da folha alinhado com receita'
        : riskStatus === 'attention'
        ? 'Folha crescendo ligeiramente acima da receita'
        : 'Alerta: Folha crescendo significativamente acima da receita',
    },
    lastUpdated: new Date(),
  };
}

// ============================================
// FORMAT HELPERS
// ============================================

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

