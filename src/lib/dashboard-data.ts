/**
 * Dashboard Data Layer
 * BFF-friendly TypeScript interfaces for executive dashboard
 */

// ============================================
// HEALTH & GOVERNANCE METRICS
// ============================================

export interface HealthMetrics {
  overallHealth: number; // 0-100
  boardCycleHealth: number;
  packageReadiness: number;
  complianceScore: number;
  decisionVelocity: number; // days average
  trend: 'improving' | 'stable' | 'declining';
  sparklineData?: {
    boardHealth: number[];
    packageReadiness: number[];
    decisionsOpen: number[];
  };
}

// ============================================
// DECISION QUEUE
// ============================================

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';
export type SlaStatus = 'on_track' | 'at_risk' | 'breached';

export interface DecisionItem {
  id: string;
  title: string;
  description?: string;
  severity: SeverityLevel;
  daysOpen: number;
  slaStatus: SlaStatus;
  owner: {
    id: string;
    name: string;
    avatar?: string;
  };
  committee?: string;
  type: 'vote' | 'approval' | 'review' | 'resolution';
  dueDate?: Date;
  packageId?: string;
  minutesId?: string;
}

// ============================================
// VOTING STATUS
// ============================================

export interface VotingStatus {
  approved: number;
  rejected: number;
  pending: number;
  endingIn72h: number;
  averageParticipation: number; // percentage
}

// ============================================
// RISK SUMMARY
// ============================================

export interface RiskCategory {
  name: string;
  count: number;
  severity: SeverityLevel;
}

export interface RiskSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  newThisCycle: number;
  resolvedThisCycle: number;
  categories: RiskCategory[];
  riskDimensions: Array<{
    dimension: string;
    value: number;
  }>;
}

// ============================================
// CYCLE SUMMARY
// ============================================

export interface CycleSummary {
  currentCycle: string;
  startDate: Date;
  endDate: Date;
  daysRemaining: number;
  completionRate: number;
  meetingsHeld: number;
  meetingsScheduled: number;
  decisionsRequired: number;
  decisionsCompleted: number;
}

// ============================================
// STRATEGIC INITIATIVES
// ============================================

export interface StrategicInitiative {
  id: string;
  name: string;
  status: 'on_track' | 'at_risk' | 'delayed' | 'completed';
  progress: number;
  owner: string;
  dueDate: Date;
  budget?: {
    allocated: number;
    spent: number;
    currency: string;
  };
}

// ============================================
// PERFORMANCE METRICS (Right Rail)
// ============================================

export interface PerformanceMetrics {
  decisionsThisCycle: number;
  decisionsLastCycle: number;
  avgDecisionTime: number; // days
  avgDecisionTimeTrend: number; // percentage change
  memberEngagement: number; // percentage
  documentCompleteness: number; // percentage
  auditReadiness: number; // percentage
  sparklineData: {
    decisions: number[];
    engagement: number[];
    compliance: number[];
  };
}

// ============================================
// FINANCIAL OVERVIEW (Lite)
// ============================================

export interface FinancialOverview {
  portfolioValue: number;
  currency: string;
  monthlyChange: number;
  ytdChange: number;
  projectsUnderGovernance: number;
  budgetUtilization: number;
  trendData?: Array<{ month: string; value: number }>;
  portfolioTrend?: number[];
}

// ============================================
// CEO-LEVEL FINANCIAL METRICS
// ============================================

export interface FinancialPulse {
  revenue: {
    value: number;
    period: 'month' | 'quarter';
    trend: number; // percentage change
  };
  ebitda: {
    value: number;
    margin: number; // percentage
    trend: number;
  };
  cash: {
    forecast: number;
    actual: number;
    variance: number; // percentage
  };
}

export interface PortfolioMetrics {
  activeValue: number;
  activeValueTrend: number[]; // sparkline data
  activeValueDelta: number; // percentage change
  realizedValue: number;
  realizedValueTrend: number; // percentage change vs previous period
  currency: string;
}

// ============================================
// BRAZIL PROJECTS MAP
// ============================================

export interface ProjectNode {
  id: string;
  name: string;
  city: string;
  state: string;
  status: 'active' | 'at_risk' | 'completed';
  value: number;
  coordinates: {
    x: number; // percentage of map width
    y: number; // percentage of map height
  };
}

export interface BrazilProjectsMap {
  nodes: ProjectNode[];
  summary: {
    active: number;
    atRisk: number;
    completed: number;
  };
}

// ============================================
// BRAZIL STATES OPERATIONS
// ============================================

export type StateOpsStatus = 'active' | 'risk' | 'completed' | 'inactive';

export interface StateOps {
  uf: string;
  name: string;
  status: StateOpsStatus;
  activeProjects: number;
  portfolioValue?: number;
}

export interface BrazilStatesOps {
  states: StateOps[];
  summary: {
    active: number;
    risk: number;
    completed: number;
    inactive: number;
  };
}

// ============================================
// COMPLETE DASHBOARD PAYLOAD
// ============================================

// Import workforce types for integration
import type { WorkforcePayload } from './workforce-data';

export interface DashboardPayload {
  healthMetrics: HealthMetrics;
  decisionQueue: DecisionItem[];
  votingStatus: VotingStatus;
  riskSummary: RiskSummary;
  cycleSummary: CycleSummary;
  strategicInitiatives: StrategicInitiative[];
  performanceMetrics: PerformanceMetrics;
  financialOverview?: FinancialOverview;
  financialPulse?: FinancialPulse;
  portfolioMetrics?: PortfolioMetrics;
  brazilProjectsMap?: BrazilProjectsMap;
  brazilStatesOps?: BrazilStatesOps;
  workforceData?: WorkforcePayload;
  lastUpdated: Date;
}

// ============================================
// MOCK DATA SERVICE
// ============================================

export function getMockDashboardData(): DashboardPayload {
  return {
    healthMetrics: {
      overallHealth: 78,
      boardCycleHealth: 85,
      packageReadiness: 92,
      complianceScore: 74,
      decisionVelocity: 4.2,
      trend: 'improving',
      sparklineData: {
        boardHealth: [82, 83, 84, 84, 85, 85, 85],
        packageReadiness: [88, 89, 90, 91, 91, 92, 92],
        decisionsOpen: [12, 11, 10, 9, 9, 8, 8],
      },
    },
    decisionQueue: [
      {
        id: '1',
        title: 'Aprovação Orçamento Q1 2025',
        description: 'Revisão e aprovação do orçamento consolidado para o primeiro trimestre',
        severity: 'critical',
        daysOpen: 5,
        slaStatus: 'at_risk',
        owner: { id: '1', name: 'Maria Silva' },
        committee: 'Conselho Fiscal',
        type: 'approval',
      },
      {
        id: '2',
        title: 'Política de Compliance - Atualização',
        description: 'Votação sobre atualização das políticas de compliance corporativo',
        severity: 'high',
        daysOpen: 3,
        slaStatus: 'on_track',
        owner: { id: '2', name: 'João Santos' },
        committee: 'Comitê de Auditoria',
        type: 'vote',
      },
      {
        id: '3',
        title: 'Contrato Fornecedor Energia',
        description: 'Análise e aprovação de renovação contratual',
        severity: 'medium',
        daysOpen: 7,
        slaStatus: 'on_track',
        owner: { id: '3', name: 'Ana Costa' },
        committee: 'Diretoria',
        type: 'approval',
      },
      {
        id: '4',
        title: 'Relatório Trimestral',
        description: 'Revisão do relatório de desempenho Q4 2024',
        severity: 'low',
        daysOpen: 2,
        slaStatus: 'on_track',
        owner: { id: '4', name: 'Carlos Lima' },
        type: 'review',
      },
    ],
    votingStatus: {
      approved: 24,
      rejected: 3,
      pending: 8,
      endingIn72h: 3,
      averageParticipation: 87,
    },
    riskSummary: {
      total: 18,
      critical: 2,
      high: 5,
      medium: 7,
      low: 4,
      newThisCycle: 3,
      resolvedThisCycle: 5,
      categories: [
        { name: 'Operational', count: 6, severity: 'high' },
        { name: 'Financial', count: 4, severity: 'medium' },
        { name: 'Regulatory', count: 5, severity: 'critical' },
        { name: 'Strategic', count: 3, severity: 'low' },
      ],
      riskDimensions: [
        { dimension: 'Operational', value: 65 },
        { dimension: 'Financial', value: 45 },
        { dimension: 'Regulatory', value: 80 },
        { dimension: 'Strategic', value: 35 },
        { dimension: 'Reputational', value: 25 },
      ],
    },
    cycleSummary: {
      currentCycle: 'Q1 2025',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-03-31'),
      daysRemaining: 71,
      completionRate: 72,
      meetingsHeld: 8,
      meetingsScheduled: 12,
      decisionsRequired: 35,
      decisionsCompleted: 27,
    },
    strategicInitiatives: [
      {
        id: '1',
        name: 'Digital Transformation',
        status: 'on_track',
        progress: 68,
        owner: 'Tech Committee',
        dueDate: new Date('2025-06-30'),
        budget: { allocated: 2500000, spent: 1700000, currency: 'BRL' },
      },
      {
        id: '2',
        name: 'ESG Compliance Program',
        status: 'at_risk',
        progress: 45,
        owner: 'Sustainability Board',
        dueDate: new Date('2025-03-31'),
        budget: { allocated: 800000, spent: 520000, currency: 'BRL' },
      },
      {
        id: '3',
        name: 'Market Expansion LATAM',
        status: 'on_track',
        progress: 82,
        owner: 'Strategic Committee',
        dueDate: new Date('2025-12-31'),
        budget: { allocated: 5000000, spent: 4100000, currency: 'BRL' },
      },
    ],
    performanceMetrics: {
      decisionsThisCycle: 27,
      decisionsLastCycle: 24,
      avgDecisionTime: 4.2,
      avgDecisionTimeTrend: -8,
      memberEngagement: 87,
      documentCompleteness: 94,
      auditReadiness: 91,
      sparklineData: {
        decisions: [18, 22, 20, 25, 24, 27],
        engagement: [82, 85, 84, 88, 86, 87],
        compliance: [88, 90, 89, 92, 91, 94],
      },
    },
    financialOverview: {
      portfolioValue: 45800000,
      currency: 'BRL',
      monthlyChange: 3.2,
      ytdChange: 12.5,
      projectsUnderGovernance: 23,
      budgetUtilization: 78,
      trendData: [
        { month: 'Jan', value: 42000000 },
        { month: 'Fev', value: 42800000 },
        { month: 'Mar', value: 43200000 },
        { month: 'Abr', value: 43800000 },
        { month: 'Mai', value: 44200000 },
        { month: 'Jun', value: 44800000 },
        { month: 'Jul', value: 45000000 },
        { month: 'Ago', value: 45200000 },
        { month: 'Set', value: 45400000 },
        { month: 'Out', value: 45600000 },
        { month: 'Nov', value: 45700000 },
        { month: 'Dez', value: 45800000 },
      ],
      portfolioTrend: [40, 42, 41, 43, 45, 44, 45.8],
    },
    financialPulse: {
      revenue: {
        value: 125000000,
        period: 'quarter',
        trend: 8.5,
      },
      ebitda: {
        value: 28500000,
        margin: 22.8,
        trend: 2.3,
      },
      cash: {
        forecast: -15000000,
        actual: -3000000,
        variance: 80.0, // Melhoria: valor real melhor que previsto (menos negativo)
      },
    },
    portfolioMetrics: {
      activeValue: 438000000,
      activeValueTrend: [420, 425, 430, 432, 435, 436, 438],
      activeValueDelta: 3.2,
      realizedValue: 182000000,
      realizedValueTrend: 12.5,
      currency: 'BRL',
    },
    brazilProjectsMap: {
      nodes: [
        { id: '1', name: 'Projeto SP-1', city: 'São Paulo', state: 'SP', status: 'active', value: 8500000, coordinates: { x: 68, y: 75 } },
        { id: '2', name: 'Projeto RJ-1', city: 'Rio de Janeiro', state: 'RJ', status: 'active', value: 6200000, coordinates: { x: 72, y: 68 } },
        { id: '3', name: 'Projeto MG-1', city: 'Belo Horizonte', state: 'MG', status: 'active', value: 4800000, coordinates: { x: 70, y: 60 } },
        { id: '4', name: 'Projeto RS-1', city: 'Porto Alegre', state: 'RS', status: 'at_risk', value: 3200000, coordinates: { x: 55, y: 88 } },
        { id: '5', name: 'Projeto PR-1', city: 'Curitiba', state: 'PR', status: 'active', value: 4100000, coordinates: { x: 58, y: 75 } },
        { id: '6', name: 'Projeto BA-1', city: 'Salvador', state: 'BA', status: 'active', value: 3500000, coordinates: { x: 78, y: 50 } },
        { id: '7', name: 'Projeto CE-1', city: 'Fortaleza', state: 'CE', status: 'completed', value: 2800000, coordinates: { x: 85, y: 35 } },
        { id: '8', name: 'Projeto DF-1', city: 'Brasília', state: 'DF', status: 'active', value: 5500000, coordinates: { x: 65, y: 55 } },
        { id: '9', name: 'Projeto SC-1', city: 'Florianópolis', state: 'SC', status: 'active', value: 2900000, coordinates: { x: 60, y: 82 } },
        { id: '10', name: 'Projeto GO-1', city: 'Goiânia', state: 'GO', status: 'at_risk', value: 2400000, coordinates: { x: 62, y: 58 } },
      ],
      summary: {
        active: 7,
        atRisk: 2,
        completed: 1,
      },
    },
    brazilStatesOps: {
      states: [
        { uf: 'SP', name: 'São Paulo', status: 'active', activeProjects: 12, portfolioValue: 18500000 },
        { uf: 'RJ', name: 'Rio de Janeiro', status: 'active', activeProjects: 8, portfolioValue: 12000000 },
        { uf: 'MG', name: 'Minas Gerais', status: 'active', activeProjects: 6, portfolioValue: 9500000 },
        { uf: 'RS', name: 'Rio Grande do Sul', status: 'risk', activeProjects: 4, portfolioValue: 6500000 },
        { uf: 'PR', name: 'Paraná', status: 'active', activeProjects: 5, portfolioValue: 8200000 },
        { uf: 'BA', name: 'Bahia', status: 'active', activeProjects: 3, portfolioValue: 4800000 },
        { uf: 'CE', name: 'Ceará', status: 'completed', activeProjects: 2, portfolioValue: 3200000 },
        { uf: 'DF', name: 'Distrito Federal', status: 'active', activeProjects: 4, portfolioValue: 7500000 },
        { uf: 'SC', name: 'Santa Catarina', status: 'active', activeProjects: 3, portfolioValue: 4200000 },
        { uf: 'GO', name: 'Goiás', status: 'risk', activeProjects: 2, portfolioValue: 3800000 },
        { uf: 'PE', name: 'Pernambuco', status: 'active', activeProjects: 2, portfolioValue: 3500000 },
        { uf: 'ES', name: 'Espírito Santo', status: 'inactive', activeProjects: 0 },
        { uf: 'AM', name: 'Amazonas', status: 'inactive', activeProjects: 0 },
        { uf: 'PA', name: 'Pará', status: 'inactive', activeProjects: 0 },
        { uf: 'MT', name: 'Mato Grosso', status: 'inactive', activeProjects: 0 },
        { uf: 'MS', name: 'Mato Grosso do Sul', status: 'inactive', activeProjects: 0 },
        { uf: 'RN', name: 'Rio Grande do Norte', status: 'inactive', activeProjects: 0 },
        { uf: 'AL', name: 'Alagoas', status: 'inactive', activeProjects: 0 },
        { uf: 'PB', name: 'Paraíba', status: 'inactive', activeProjects: 0 },
        { uf: 'SE', name: 'Sergipe', status: 'inactive', activeProjects: 0 },
        { uf: 'TO', name: 'Tocantins', status: 'inactive', activeProjects: 0 },
        { uf: 'PI', name: 'Piauí', status: 'inactive', activeProjects: 0 },
        { uf: 'MA', name: 'Maranhão', status: 'inactive', activeProjects: 0 },
        { uf: 'AC', name: 'Acre', status: 'inactive', activeProjects: 0 },
        { uf: 'RO', name: 'Rondônia', status: 'inactive', activeProjects: 0 },
        { uf: 'RR', name: 'Roraima', status: 'inactive', activeProjects: 0 },
        { uf: 'AP', name: 'Amapá', status: 'inactive', activeProjects: 0 },
      ],
      summary: {
        active: 9,
        risk: 2,
        completed: 1,
        inactive: 15,
      },
    },
    workforceData: getWorkforceDataForDashboard(),
    lastUpdated: new Date(),
  };
}

// Import workforce mock data for dashboard integration
function getWorkforceDataForDashboard() {
  // Inline the workforce data to avoid circular dependency
  const payrollGrowth = 8.5;
  const revenueGrowth = 6.2;
  const delta = payrollGrowth - revenueGrowth;
  
  const determineStatus = (d: number): 'healthy' | 'attention' | 'risk' => {
    if (d <= 0) return 'healthy';
    if (d <= 5) return 'attention';
    return 'risk';
  };
  
  const calculateScore = (d: number): number => {
    if (d <= 0) return 100;
    if (d <= 2) return 85;
    if (d <= 5) return 70;
    if (d <= 10) return 50;
    if (d <= 15) return 30;
    return 10;
  };
  
  const riskStatus = determineStatus(delta);
  const riskScore = calculateScore(delta);

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
        status: 'healthy' as const,
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
        { id: 'cc-001', name: 'Engenharia', payrollValue: 3850000, headcount: 185, growthVsPrevious: 12.5, isAbnormal: false },
        { id: 'cc-002', name: 'Operações', payrollValue: 2950000, headcount: 245, growthVsPrevious: 8.2, isAbnormal: false },
        { id: 'cc-003', name: 'Comercial', payrollValue: 2180000, headcount: 120, growthVsPrevious: 18.5, isAbnormal: true },
        { id: 'cc-004', name: 'Administrativo', payrollValue: 1420000, headcount: 95, growthVsPrevious: 3.2, isAbnormal: false },
        { id: 'cc-005', name: 'P&D', payrollValue: 1250000, headcount: 65, growthVsPrevious: 22.8, isAbnormal: true },
        { id: 'cc-006', name: 'Marketing', payrollValue: 720000, headcount: 42, growthVsPrevious: 5.5, isAbnormal: false },
        { id: 'cc-007', name: 'RH', payrollValue: 480000, headcount: 35, growthVsPrevious: 2.1, isAbnormal: false },
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

// Helper functions
export function formatCurrency(value: number, currency: string = 'BRL'): string {
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
  }).format(value);
}

export function formatPercentage(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}


