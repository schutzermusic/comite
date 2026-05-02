import type {
  ContractRevenueRow,
  CostCenterHeatmapData,
  ExecutiveDecisionItem,
  FinancialRiskItem,
  ForecastPoint,
  AiInsight,
  DreLine,
  ScenarioKey,
  ProjectMarginRow,
} from './types';

// ============================================================
// Forecast vs Realizado vs Orçado vs Board (12 meses)
// ============================================================

export const FORECAST_TIMESERIES: ForecastPoint[] = [
  { period: '2026-01', actual: 305_000_000, budget: 290_000_000, forecast: 298_000_000, board: 285_000_000 },
  { period: '2026-02', actual: 498_000_000, budget: 480_000_000, forecast: 492_000_000, board: 470_000_000 },
  { period: '2026-03', actual: 462_000_000, budget: 500_000_000, forecast: 478_000_000, board: 490_000_000 },
  { period: '2026-04', actual: undefined, budget: 510_000_000, forecast: 495_000_000, board: 500_000_000 },
  { period: '2026-05', actual: undefined, budget: 520_000_000, forecast: 512_000_000, board: 510_000_000 },
  { period: '2026-06', actual: undefined, budget: 530_000_000, forecast: 522_000_000, board: 520_000_000 },
  { period: '2026-07', actual: undefined, budget: 545_000_000, forecast: 540_000_000, board: 530_000_000 },
  { period: '2026-08', actual: undefined, budget: 560_000_000, forecast: 555_000_000, board: 545_000_000 },
  { period: '2026-09', actual: undefined, budget: 575_000_000, forecast: 568_000_000, board: 560_000_000 },
  { period: '2026-10', actual: undefined, budget: 590_000_000, forecast: 580_000_000, board: 575_000_000 },
  { period: '2026-11', actual: undefined, budget: 605_000_000, forecast: 595_000_000, board: 590_000_000 },
  { period: '2026-12', actual: undefined, budget: 620_000_000, forecast: 612_000_000, board: 605_000_000 },
];

// ============================================================
// Cost-Center Deviation Heatmap
// ============================================================

export const COST_HEATMAP: CostCenterHeatmapData = {
  categories: [
    'Hospedagem',
    'Mobilização',
    'Horas Extras',
    'Materiais',
    'Subcontratados',
    'Combustível',
    'Impostos',
    'Administrativo',
  ],
  costCenters: ['Eng. Campo', 'Mobilização', 'Logística', 'TI', 'Financeiro', 'Adm. SP'],
  cells: [
    // Eng. Campo
    { cc: 'Eng. Campo', category: 'Hospedagem', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Eng. Campo', category: 'Mobilização', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Eng. Campo', category: 'Horas Extras', actual: 18_500_000, budget: 12_000_000, variance_pct: 54.2 },
    { cc: 'Eng. Campo', category: 'Materiais', actual: 24_300_000, budget: 22_000_000, variance_pct: 10.5 },
    { cc: 'Eng. Campo', category: 'Subcontratados', actual: 41_200_000, budget: 36_000_000, variance_pct: 14.4 },
    { cc: 'Eng. Campo', category: 'Combustível', actual: 8_600_000, budget: 8_000_000, variance_pct: 7.5 },
    { cc: 'Eng. Campo', category: 'Impostos', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Eng. Campo', category: 'Administrativo', actual: 0, budget: 0, variance_pct: 0 },
    // Mobilização
    { cc: 'Mobilização', category: 'Hospedagem', actual: 22_500_000, budget: 18_000_000, variance_pct: 25.0 },
    { cc: 'Mobilização', category: 'Mobilização', actual: 14_200_000, budget: 13_500_000, variance_pct: 5.2 },
    { cc: 'Mobilização', category: 'Horas Extras', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Mobilização', category: 'Materiais', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Mobilização', category: 'Subcontratados', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Mobilização', category: 'Combustível', actual: 6_400_000, budget: 7_200_000, variance_pct: -11.1 },
    { cc: 'Mobilização', category: 'Impostos', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Mobilização', category: 'Administrativo', actual: 0, budget: 0, variance_pct: 0 },
    // Logística
    { cc: 'Logística', category: 'Hospedagem', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Logística', category: 'Mobilização', actual: 4_500_000, budget: 5_000_000, variance_pct: -10.0 },
    { cc: 'Logística', category: 'Horas Extras', actual: 3_200_000, budget: 2_800_000, variance_pct: 14.3 },
    { cc: 'Logística', category: 'Materiais', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Logística', category: 'Subcontratados', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Logística', category: 'Combustível', actual: 12_400_000, budget: 9_500_000, variance_pct: 30.5 },
    { cc: 'Logística', category: 'Impostos', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Logística', category: 'Administrativo', actual: 0, budget: 0, variance_pct: 0 },
    // TI
    { cc: 'TI', category: 'Hospedagem', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'TI', category: 'Mobilização', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'TI', category: 'Horas Extras', actual: 1_400_000, budget: 1_000_000, variance_pct: 40.0 },
    { cc: 'TI', category: 'Materiais', actual: 4_800_000, budget: 4_200_000, variance_pct: 14.3 },
    { cc: 'TI', category: 'Subcontratados', actual: 6_200_000, budget: 5_000_000, variance_pct: 24.0 },
    { cc: 'TI', category: 'Combustível', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'TI', category: 'Impostos', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'TI', category: 'Administrativo', actual: 8_400_000, budget: 8_500_000, variance_pct: -1.2 },
    // Financeiro
    { cc: 'Financeiro', category: 'Hospedagem', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Financeiro', category: 'Mobilização', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Financeiro', category: 'Horas Extras', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Financeiro', category: 'Materiais', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Financeiro', category: 'Subcontratados', actual: 2_100_000, budget: 2_500_000, variance_pct: -16.0 },
    { cc: 'Financeiro', category: 'Combustível', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Financeiro', category: 'Impostos', actual: 38_400_000, budget: 32_000_000, variance_pct: 20.0 },
    { cc: 'Financeiro', category: 'Administrativo', actual: 5_200_000, budget: 5_500_000, variance_pct: -5.5 },
    // Adm. SP
    { cc: 'Adm. SP', category: 'Hospedagem', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Adm. SP', category: 'Mobilização', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Adm. SP', category: 'Horas Extras', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Adm. SP', category: 'Materiais', actual: 1_800_000, budget: 2_000_000, variance_pct: -10.0 },
    { cc: 'Adm. SP', category: 'Subcontratados', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Adm. SP', category: 'Combustível', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Adm. SP', category: 'Impostos', actual: 0, budget: 0, variance_pct: 0 },
    { cc: 'Adm. SP', category: 'Administrativo', actual: 14_200_000, budget: 13_500_000, variance_pct: 5.2 },
  ],
};

// ============================================================
// Contracts
// ============================================================

export const CONTRACTS: ContractRevenueRow[] = [
  {
    id: 'ctr-1',
    name: 'FPSO P-80 — Manutenção Integrada',
    client: 'Petrobras',
    contractTotal: 4_800_000_000,
    invoiced: 1_270_000_000,
    toInvoice: 3_530_000_000,
    forecastInvoicing: 3_410_000_000,
    delayRisk: 'low',
    endDate: '2027-12-31',
  },
  {
    id: 'ctr-2',
    name: 'FPSO Mero — Comissionamento',
    client: 'Shell Brasil',
    contractTotal: 2_100_000_000,
    invoiced: 540_000_000,
    toInvoice: 1_560_000_000,
    forecastInvoicing: 1_490_000_000,
    delayRisk: 'medium',
    endDate: '2027-06-30',
  },
  {
    id: 'ctr-3',
    name: 'Bacalhau — Engenharia Submarina',
    client: 'Equinor',
    contractTotal: 1_650_000_000,
    invoiced: 285_000_000,
    toInvoice: 1_365_000_000,
    forecastInvoicing: 1_220_000_000,
    delayRisk: 'high',
    endDate: '2028-03-31',
  },
  {
    id: 'ctr-4',
    name: 'Búzios — Inspeção e Reparos',
    client: 'Petrobras',
    contractTotal: 920_000_000,
    invoiced: 410_000_000,
    toInvoice: 510_000_000,
    forecastInvoicing: 510_000_000,
    delayRisk: 'low',
    endDate: '2026-12-31',
  },
];

// ============================================================
// Project Margin (mocked, augmenting real data)
// ============================================================

export const PROJECT_MARGINS: ProjectMarginRow[] = [
  {
    project_id: 'proj-1',
    project_name: 'FPSO P-80',
    client: 'Petrobras',
    revenue: 890_000_000,
    cost: 612_000_000,
    margin: 278_000_000,
    margin_pct: 31.2,
    variance_pct: -2.4,
    status: 'healthy',
  },
  {
    project_id: 'proj-2',
    project_name: 'FPSO Mero',
    client: 'Shell',
    revenue: 180_000_000,
    cost: 142_000_000,
    margin: 38_000_000,
    margin_pct: 21.1,
    variance_pct: -8.6,
    status: 'watch',
  },
  {
    project_id: 'proj-3',
    project_name: 'Bacalhau Submarina',
    client: 'Equinor',
    revenue: 95_000_000,
    cost: 88_500_000,
    margin: 6_500_000,
    margin_pct: 6.8,
    variance_pct: -18.2,
    status: 'critical',
  },
  {
    project_id: 'proj-4',
    project_name: 'Búzios Inspeção',
    client: 'Petrobras',
    revenue: 205_000_000,
    cost: 138_000_000,
    margin: 67_000_000,
    margin_pct: 32.7,
    variance_pct: 4.1,
    status: 'healthy',
  },
  {
    project_id: 'proj-5',
    project_name: 'Mero — Topside',
    client: 'TotalEnergies',
    revenue: 142_000_000,
    cost: 118_000_000,
    margin: 24_000_000,
    margin_pct: 16.9,
    variance_pct: -5.4,
    status: 'watch',
  },
  {
    project_id: 'proj-6',
    project_name: 'Sépia — Operação',
    client: 'Petrobras',
    revenue: 78_000_000,
    cost: 49_000_000,
    margin: 29_000_000,
    margin_pct: 37.2,
    variance_pct: 6.8,
    status: 'healthy',
  },
];

// ============================================================
// Executive Decision Queue
// ============================================================

export const DECISION_QUEUE: ExecutiveDecisionItem[] = [
  {
    id: 'dq-1',
    title: 'Aprovar reclassificação OPEX → CAPEX FPSO P-80',
    category: 'Reclassificação',
    impact: 124_000_000,
    sla_hours: 24,
    aging_days: 2,
    owner: 'CFO',
    priority: 'high',
  },
  {
    id: 'dq-2',
    title: 'Validar provisão de contingência fiscal Q1',
    category: 'Provisão Fiscal',
    impact: 86_500_000,
    sla_hours: 48,
    aging_days: 4,
    owner: 'Diretor Tributário',
    priority: 'high',
  },
  {
    id: 'dq-3',
    title: 'Aprovar adiantamento subcontratado TechServ',
    category: 'Cash-out',
    impact: 32_000_000,
    sla_hours: 12,
    aging_days: 1,
    owner: 'Tesouraria',
    priority: 'medium',
  },
  {
    id: 'dq-4',
    title: 'Revisar forecast Bacalhau — gap de margem',
    category: 'Forecast',
    impact: 48_000_000,
    sla_hours: 72,
    aging_days: 6,
    owner: 'Controller Sr.',
    priority: 'high',
  },
  {
    id: 'dq-5',
    title: 'Aprovar repasse hospedagem Macaé Q2',
    category: 'OPEX',
    impact: 14_200_000,
    sla_hours: 24,
    aging_days: 1,
    owner: 'Diretor Operações',
    priority: 'medium',
  },
];

// ============================================================
// Financial Risk Radar
// ============================================================

export const FINANCIAL_RISKS: FinancialRiskItem[] = [
  {
    id: 'fr-1',
    domain: 'margin',
    label: 'Margem Bacalhau abaixo do limiar',
    detail: '6,8% vs piso contratual 12%. Exposição ao final do contrato.',
    severity: 'critical',
    exposure: 145_000_000,
    trend: 'down',
  },
  {
    id: 'fr-2',
    domain: 'cash',
    label: 'Concentração de recebíveis Petrobras',
    detail: '74% da AR vinculada a 1 cliente. Atrasos de 8 dias na média.',
    severity: 'high',
    exposure: 320_000_000,
    trend: 'stable',
  },
  {
    id: 'fr-3',
    domain: 'tax',
    label: 'Provisão tributária subdimensionada',
    detail: 'ISS retido divergente em 3 NF — exposição a auto de infração.',
    severity: 'high',
    exposure: 38_500_000,
    trend: 'up',
  },
  {
    id: 'fr-4',
    domain: 'invoicing',
    label: 'NF Mero atrasada 12 dias',
    detail: 'Faturamento Shell pendente de aceite técnico no portal.',
    severity: 'medium',
    exposure: 180_000_000,
    trend: 'up',
  },
  {
    id: 'fr-5',
    domain: 'cost',
    label: 'Horas extras 54% acima do plano',
    detail: 'Engenharia de Campo — sobrecarga em mob. P-80.',
    severity: 'medium',
    exposure: 6_500_000,
    trend: 'up',
  },
  {
    id: 'fr-6',
    domain: 'cash',
    label: 'Burn de caixa operacional',
    detail: '21 dias de runway projetado — abaixo do mínimo (30d).',
    severity: 'high',
    exposure: 92_000_000,
    trend: 'down',
  },
];

// ============================================================
// AI Insights
// ============================================================

export const AI_INSIGHTS: AiInsight[] = [
  {
    id: 'ai-1',
    kind: 'margin',
    headline: 'Margem EBITDA 220bps abaixo do orçado',
    detail:
      'Compressão concentrada em Bacalhau (subcontratados +24% vs plano) e Mero (hospedagem +25%). Excluindo esses dois, margem fica acima do board.',
    impact: -38_000_000,
    confidence: 0.87,
    suggestion: 'Renegociar SLA TechServ (Bacalhau) e migrar 60% da hospedagem Macaé para corporativo.',
  },
  {
    id: 'ai-2',
    kind: 'forecast',
    headline: 'Gap de Forecast vs Board: −R$ 28M no Q1',
    detail:
      'Forecast rolling 12m converge ao Board até Jul/26 se margem Bacalhau retornar a 12%. Caso contrário, gap acumulado de R$ 84M no exercício.',
    impact: -28_000_000,
    confidence: 0.78,
    suggestion: 'Acionar gatilho contratual de revisão de preço Bacalhau até 2026-05-31.',
  },
  {
    id: 'ai-3',
    kind: 'cost',
    headline: 'Horas extras explicam 31% do desvio de OPEX',
    detail:
      'R$ 18,5M em HE no Q1 — concentradas em Eng. Campo (P-80). Padrão sazonal sugere repique em Mai/Jun.',
    impact: -6_500_000,
    confidence: 0.92,
    suggestion: 'Aprovar ramp-up de 6 técnicos contratados em vez de HE — payback 4 meses.',
  },
  {
    id: 'ai-4',
    kind: 'revenue',
    headline: 'Receita líquida 2,4% acima do board',
    detail:
      'Outperformance puxada por Búzios (+R$ 14M) e P-80 (+R$ 9M). Mero abaixo em −R$ 12M por atraso de NF.',
    impact: 11_000_000,
    confidence: 0.95,
    suggestion: 'Acelerar aceite técnico Mero junto à Shell — desbloqueia R$ 180M em A/R.',
  },
  {
    id: 'ai-5',
    kind: 'operational',
    headline: 'Caixa operacional em 21d de runway',
    detail:
      'AR concentrada em Petrobras (74%) com aging médio de 8d. Cenário stress puxa runway para 14d.',
    impact: -92_000_000,
    confidence: 0.83,
    suggestion: 'Antecipação seletiva de R$ 220M em recebíveis Petrobras a 1,2% a.m.',
  },
];

// ============================================================
// Managerial DRE — derived rows (mock)
// ============================================================

export function buildManagerialDre(scenario: ScenarioKey): DreLine[] {
  const grossRevenue = 1_320_000_000;
  const deductions = -198_000_000;
  const netRevenue = grossRevenue + deductions;
  const directCost = -612_000_000;
  const grossMargin = netRevenue + directCost;
  const opex = -184_000_000;
  const ebitda = grossMargin + opex;
  const financial = -28_000_000;
  const taxes = -98_000_000;
  const netResult = ebitda + financial + taxes;

  const budget = {
    grossRevenue: 1_290_000_000,
    deductions: -192_000_000,
    netRevenue: 1_098_000_000,
    directCost: -594_000_000,
    grossMargin: 504_000_000,
    opex: -178_000_000,
    ebitda: 326_000_000,
    financial: -24_000_000,
    taxes: -94_000_000,
    netResult: 208_000_000,
  };

  const forecast = {
    grossRevenue: 1_310_000_000,
    deductions: -196_000_000,
    netRevenue: 1_114_000_000,
    directCost: -608_000_000,
    grossMargin: 506_000_000,
    opex: -182_000_000,
    ebitda: 324_000_000,
    financial: -27_000_000,
    taxes: -97_000_000,
    netResult: 200_000_000,
  };

  const scenarioMultiplier: Record<ScenarioKey, number> = {
    actual: 1,
    budget: budget.grossRevenue / grossRevenue,
    forecast: forecast.grossRevenue / grossRevenue,
    stress: 0.9,
    optimistic: 1.08,
    board: 0.97,
  };
  const m = scenarioMultiplier[scenario];

  const rows: Array<Omit<DreLine, 'variance_abs' | 'variance_pct'>> = [
    {
      key: 'gross_revenue',
      label: 'Receita Bruta',
      isSubtotal: false,
      emphasis: 'positive',
      actual: grossRevenue * m,
      budget: budget.grossRevenue,
      forecast: forecast.grossRevenue,
    },
    {
      key: 'deductions',
      label: 'Deduções',
      isSubtotal: false,
      emphasis: 'negative',
      actual: deductions * m,
      budget: budget.deductions,
      forecast: forecast.deductions,
    },
    {
      key: 'net_revenue',
      label: 'Receita Líquida',
      isSubtotal: true,
      emphasis: 'positive',
      actual: netRevenue * m,
      budget: budget.netRevenue,
      forecast: forecast.netRevenue,
    },
    {
      key: 'direct_cost',
      label: 'Custo Direto',
      isSubtotal: false,
      emphasis: 'negative',
      actual: directCost * m,
      budget: budget.directCost,
      forecast: forecast.directCost,
    },
    {
      key: 'gross_margin',
      label: 'Margem Bruta',
      isSubtotal: true,
      emphasis: 'positive',
      actual: grossMargin * m,
      budget: budget.grossMargin,
      forecast: forecast.grossMargin,
    },
    {
      key: 'opex',
      label: 'Despesas Operacionais',
      isSubtotal: false,
      emphasis: 'negative',
      actual: opex * m,
      budget: budget.opex,
      forecast: forecast.opex,
    },
    {
      key: 'ebitda',
      label: 'EBITDA',
      isSubtotal: true,
      emphasis: 'positive',
      actual: ebitda * m,
      budget: budget.ebitda,
      forecast: forecast.ebitda,
    },
    {
      key: 'financial',
      label: 'Resultado Financeiro',
      isSubtotal: false,
      emphasis: 'negative',
      actual: financial * m,
      budget: budget.financial,
      forecast: forecast.financial,
    },
    {
      key: 'taxes',
      label: 'Impostos',
      isSubtotal: false,
      emphasis: 'negative',
      actual: taxes * m,
      budget: budget.taxes,
      forecast: forecast.taxes,
    },
    {
      key: 'net_result',
      label: 'Resultado Líquido',
      isSubtotal: true,
      emphasis: 'positive',
      actual: netResult * m,
      budget: budget.netResult,
      forecast: forecast.netResult,
    },
  ];

  return rows.map((r) => {
    const variance_abs = r.actual - r.budget;
    const variance_pct = r.budget !== 0 ? (variance_abs / Math.abs(r.budget)) * 100 : 0;
    return { ...r, variance_abs, variance_pct };
  });
}

// ============================================================
// KPI sparklines (mocked 12pt micro-trends)
// ============================================================

export const SPARKLINES: Record<string, number[]> = {
  health: [72, 74, 71, 73, 76, 78, 75, 77, 79, 78, 80, 82],
  revenue: [220, 245, 268, 290, 305, 318, 330, 345, 362, 378, 395, 410],
  ebitda: [54, 58, 62, 60, 65, 68, 72, 70, 74, 78, 76, 80],
  margin: [22.1, 22.4, 22.8, 23.1, 23.4, 23.6, 23.5, 23.8, 24.0, 24.1, 24.3, 24.5],
  operating: [48, 52, 56, 54, 58, 61, 64, 62, 66, 69, 67, 71],
  forecastGap: [-12, -10, -8, -14, -18, -22, -26, -28, -24, -22, -20, -18],
  cashRisk: [85, 80, 78, 72, 68, 65, 60, 58, 52, 48, 42, 38],
  pendingActions: [8, 9, 7, 10, 12, 11, 13, 14, 15, 13, 12, 11],
};
