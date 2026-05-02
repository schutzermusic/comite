// ============================================================
// Finance Control Room — Types
// ============================================================

export type ScenarioKey =
  | 'actual'
  | 'budget'
  | 'forecast'
  | 'stress'
  | 'optimistic'
  | 'board';

export interface ScenarioOption {
  key: ScenarioKey;
  label: string;
  shortLabel: string;
  color: string;
  description?: string;
}

export const SCENARIOS: ScenarioOption[] = [
  { key: 'actual', label: 'Realizado', shortLabel: 'Real', color: '#14B8A6', description: 'Movimentações postadas no ERP' },
  { key: 'budget', label: 'Orçado', shortLabel: 'Bdg', color: '#6366F1', description: 'Plano financeiro vigente' },
  { key: 'forecast', label: 'Forecast', shortLabel: 'Fcst', color: '#F59E0B', description: 'Projeção rolling 12 meses' },
  { key: 'stress', label: 'Stress Case', shortLabel: 'Stress', color: '#F43F5E', description: 'Cenário adverso ‑10% receita' },
  { key: 'optimistic', label: 'Optimistic Case', shortLabel: 'Optm', color: '#10B981', description: 'Cenário favorável +8% receita' },
  { key: 'board', label: 'Board Approved', shortLabel: 'Board', color: '#A78BFA', description: 'Plano aprovado em Conselho' },
];

export interface DreLine {
  key: string;
  label: string;
  isSubtotal: boolean;
  emphasis?: 'positive' | 'negative' | 'neutral';
  actual: number;
  budget: number;
  forecast: number;
  variance_abs: number;
  variance_pct: number;
}

export interface CostCenterCell {
  category: string;
  cc: string;
  actual: number;
  budget: number;
  variance_pct: number;
}

export interface CostCenterHeatmapData {
  categories: string[];
  costCenters: string[];
  cells: CostCenterCell[];
}

export interface ContractRevenueRow {
  id: string;
  name: string;
  client: string;
  contractTotal: number;
  invoiced: number;
  toInvoice: number;
  forecastInvoicing: number;
  delayRisk: 'low' | 'medium' | 'high';
  endDate: string;
}

export interface ExecutiveDecisionItem {
  id: string;
  title: string;
  category: string;
  impact: number;
  sla_hours: number;
  aging_days: number;
  owner: string;
  priority: 'low' | 'medium' | 'high';
}

export interface FinancialRiskItem {
  id: string;
  domain: 'margin' | 'cash' | 'tax' | 'invoicing' | 'cost';
  label: string;
  detail: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  exposure: number;
  trend: 'up' | 'down' | 'stable';
}

export interface ForecastPoint {
  period: string;
  actual?: number;
  budget?: number;
  forecast?: number;
  board?: number;
}

export interface AiInsight {
  id: string;
  kind: 'margin' | 'revenue' | 'cost' | 'forecast' | 'operational';
  headline: string;
  detail: string;
  impact: number;
  confidence: number;
  suggestion: string;
}

export interface ProjectMarginRow {
  project_id: string;
  project_name: string;
  client?: string;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number;
  variance_pct: number;
  status: 'healthy' | 'watch' | 'critical';
}

export interface ControlRoomFilters {
  periodFrom: string;
  periodTo: string;
  scenario: ScenarioKey;
  projectId: string;
  contractId: string;
  costCenterId: string;
  consolidation: 'consolidated' | 'by_bu' | 'by_project';
}
