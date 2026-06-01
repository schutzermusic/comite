/**
 * Finance Control Room — data layer.
 *
 * Monetary datasets are derived from the canonical ledger
 * (mockLedgerEntries) via the unified Finance selectors. Narrative items
 * (AI insights, decision queue, risk radar, sparklines) remain as mocks
 * because they belong to a separate analytics/AI surface, not the ledger.
 *
 * Source-of-truth map:
 *   FORECAST_TIMESERIES → ledger period_key × entry_type aggregations.
 *   COST_HEATMAP        → ledger grouped by (cost_center_id, category L2).
 *   CONTRACTS           → selectContracts() + contract refs.
 *   PROJECT_MARGINS     → computeMarginByProject() from finance-store.
 *   buildManagerialDre  → computePnL() from finance-store.
 */

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
import type { LedgerEntry } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories, costCenters as ccSeed } from '@/data/finance/seed-categories';
import { contracts as contractRefs, projects as projectRefs, findScenario } from '@/data/finance/reference';
import { selectContracts } from '@/lib/finance/selectors/contracts';
import { computePnL, computeMarginByProject } from '@/lib/finance/finance-store';

// ============================================================
// FORECAST_TIMESERIES — derived from ledger period_key × entry_type
// ============================================================

const FORECAST_PERIODS = [
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
  '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
];

function totalRevenue(entries: LedgerEntry[], period: string, type: LedgerEntry['entry_type']): number {
  let sum = 0;
  for (const e of entries) {
    if (e.period_key !== period || e.entry_type !== type || e.status === 'void') continue;
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat || cat.group_key !== 'revenue') continue;
    sum += e.amount_cents * cat.sign;
  }
  return sum;
}

function buildForecastTimeseries(entries: LedgerEntry[] = mockLedgerEntries): ForecastPoint[] {
  const boardMult = findScenario('board')?.multiplier ?? 0.985;
  return FORECAST_PERIODS.map(period => {
    const actual = totalRevenue(entries, period, 'actual');
    const budget = totalRevenue(entries, period, 'budget');
    const forecast = totalRevenue(entries, period, 'forecast');
    return {
      period,
      actual: actual > 0 ? actual : undefined,
      budget: budget > 0 ? budget : undefined,
      forecast: forecast > 0 ? forecast : undefined,
      board: forecast > 0 ? Math.round(forecast * boardMult) : undefined,
    };
  });
}

export const FORECAST_TIMESERIES: ForecastPoint[] = buildForecastTimeseries();

// ============================================================
// COST_HEATMAP — ledger grouped by (cost_center, L2 category)
// ============================================================

const HEATMAP_CC_IDS = ['cc-eng-campo', 'cc-mob', 'cc-manut', 'cc-ti', 'cc-financeiro', 'cc-admin-sp'];
const HEATMAP_CC_LABEL: Record<string, string> = {
  'cc-eng-campo': 'Eng. Campo',
  'cc-mob': 'Mobilização',
  'cc-manut': 'Logística',
  'cc-ti': 'TI',
  'cc-financeiro': 'Financeiro',
  'cc-admin-sp': 'Adm. SP',
};
const HEATMAP_L2_IDS = ['cat-b2', 'cat-b1', 'cat-b3', 'cat-b4', 'cat-c2', 'cat-c3', 'cat-e1', 'cat-c1'];
const HEATMAP_L2_LABEL: Record<string, string> = {
  'cat-b2': 'Mobilização',
  'cat-b1': 'Folha Direta',
  'cat-b3': 'Materiais',
  'cat-b4': 'Subcontratados',
  'cat-c2': 'Estrutura',
  'cat-c3': 'TI/SaaS',
  'cat-e1': 'Impostos',
  'cat-c1': 'Administrativo',
};

function buildCostHeatmap(entries: LedgerEntry[] = mockLedgerEntries, periodKey = '2026-04'): CostCenterHeatmapData {
  const cells = [] as CostCenterHeatmapData['cells'];
  for (const ccId of HEATMAP_CC_IDS) {
    for (const l2Id of HEATMAP_L2_IDS) {
      const childIds = managementCategories.filter(c => c.parent_id === l2Id || c.id === l2Id).map(c => c.id);
      let actual = 0, budget = 0;
      for (const e of entries) {
        if (e.cost_center_id !== ccId || e.period_key !== periodKey || e.status === 'void') continue;
        if (!childIds.includes(e.category_id)) continue;
        const amt = Math.abs(e.amount_cents);
        if (e.entry_type === 'actual') actual += amt;
        else if (e.entry_type === 'budget') budget += amt;
      }
      const variance_pct = budget !== 0 ? ((actual - budget) / budget) * 100 : 0;
      cells.push({
        cc: HEATMAP_CC_LABEL[ccId],
        category: HEATMAP_L2_LABEL[l2Id],
        actual, budget, variance_pct: Math.round(variance_pct * 10) / 10,
      });
    }
  }
  return {
    categories: HEATMAP_L2_IDS.map(id => HEATMAP_L2_LABEL[id]),
    costCenters: HEATMAP_CC_IDS.map(id => HEATMAP_CC_LABEL[id]),
    cells,
  };
}

export const COST_HEATMAP: CostCenterHeatmapData = buildCostHeatmap();

// ============================================================
// CONTRACTS — derived via selectContracts() + contract refs
// ============================================================

function buildContractRows(): ContractRevenueRow[] {
  const enriched = selectContracts();
  return enriched.map(c => {
    const ref = contractRefs.find(r => r.id === c.id);
    const contractTotal = ref ? ref.total_value_cents : c.contracted * 100;
    const invoiced = c.invoiced * 100;
    const toInvoice = contractTotal - invoiced;
    const forecastInvoicing = Math.round(toInvoice * 0.95);
    const delayRisk: ContractRevenueRow['delayRisk'] =
      c.delayedDays >= 14 ? 'high' : c.delayedDays > 0 ? 'medium' : 'low';
    return {
      id: c.id,
      name: `${c.code} — ${c.client}`,
      client: c.client,
      contractTotal,
      invoiced,
      toInvoice,
      forecastInvoicing,
      delayRisk,
      endDate: c.end,
    };
  });
}

export const CONTRACTS: ContractRevenueRow[] = buildContractRows();

// ============================================================
// PROJECT_MARGINS — derived from computeMarginByProject()
// ============================================================

function buildProjectMargins(): ProjectMarginRow[] {
  // Use full ledger range so margins reflect every actual entry
  const raw = computeMarginByProject('2025-01', '2026-12');
  return raw.map(p => {
    const ref = projectRefs.find(rp => rp.id === p.project_id);
    const clientName = ref?.client_id
      ? contractRefs.find(c => c.client_id === ref.client_id)?.client_name
      : undefined;
    const revenue = p.revenue;
    const cost = p.cogs; // negative
    const margin = revenue + cost;
    const variance_pct = revenue !== 0 ? (margin / Math.abs(revenue)) * 100 - 25 : 0; // 25% target margin baseline
    const status: ProjectMarginRow['status'] =
      p.margin_pct >= 25 ? 'healthy' : p.margin_pct >= 12 ? 'watch' : 'critical';
    return {
      project_id: p.project_id,
      project_name: ref?.name ?? p.project_name,
      client: clientName,
      revenue,
      cost: Math.abs(cost),
      margin,
      margin_pct: Math.round(p.margin_pct * 10) / 10,
      variance_pct: Math.round(variance_pct * 10) / 10,
      status,
    };
  });
}

export const PROJECT_MARGINS: ProjectMarginRow[] = buildProjectMargins();

// ============================================================
// Managerial DRE — derived from computePnL() over the ledger
// ============================================================

export function buildManagerialDre(scenario: ScenarioKey): DreLine[] {
  const pnl = computePnL('2025-01', '2026-12', 'all');

  function pick(group: 'revenue' | 'cogs' | 'opex' | 'financial' | 'taxes') {
    const r = pnl.find(p => p.group_key === group);
    return {
      actual: r?.actual ?? 0,
      budget: r?.budget ?? 0,
      forecast: r?.forecast ?? 0,
    };
  }

  const revenue = pick('revenue');
  const cogs = pick('cogs');
  const opex = pick('opex');
  const fin = pick('financial');
  const tax = pick('taxes');

  // Net revenue currently mirrors gross since we don't model deductions; expose deductions as 15% to stay visually consistent with the prior layout.
  const dedAct = -Math.round(revenue.actual * 0.15);
  const dedBud = -Math.round(revenue.budget * 0.15);
  const dedFcst = -Math.round(revenue.forecast * 0.15);

  const netAct = revenue.actual + dedAct;
  const netBud = revenue.budget + dedBud;
  const netFcst = revenue.forecast + dedFcst;

  const gmAct = netAct + cogs.actual;
  const gmBud = netBud + cogs.budget;
  const gmFcst = netFcst + cogs.forecast;

  const ebAct = gmAct + opex.actual;
  const ebBud = gmBud + opex.budget;
  const ebFcst = gmFcst + opex.forecast;

  const netResAct = ebAct + fin.actual + tax.actual;
  const netResBud = ebBud + fin.budget + tax.budget;
  const netResFcst = ebFcst + fin.forecast + tax.forecast;

  const scenarioMultiplier: Record<ScenarioKey, number> = {
    actual: 1,
    budget: revenue.actual !== 0 ? revenue.budget / revenue.actual : 1,
    forecast: revenue.actual !== 0 ? revenue.forecast / revenue.actual : 1,
    stress: findScenario('stress')?.multiplier ?? 0.88,
    optimistic: findScenario('optimistic')?.multiplier ?? 1.08,
    board: findScenario('board')?.multiplier ?? 0.985,
  };
  const m = scenarioMultiplier[scenario];

  const rows: Array<Omit<DreLine, 'variance_abs' | 'variance_pct'>> = [
    { key: 'gross_revenue', label: 'Receita Bruta',        isSubtotal: false, emphasis: 'positive', actual: revenue.actual * m, budget: revenue.budget, forecast: revenue.forecast },
    { key: 'deductions',    label: 'Deduções',             isSubtotal: false, emphasis: 'negative', actual: dedAct * m,         budget: dedBud,         forecast: dedFcst },
    { key: 'net_revenue',   label: 'Receita Líquida',      isSubtotal: true,  emphasis: 'positive', actual: netAct * m,         budget: netBud,         forecast: netFcst },
    { key: 'direct_cost',   label: 'Custo Direto',         isSubtotal: false, emphasis: 'negative', actual: cogs.actual * m,    budget: cogs.budget,    forecast: cogs.forecast },
    { key: 'gross_margin',  label: 'Margem Bruta',         isSubtotal: true,  emphasis: 'positive', actual: gmAct * m,          budget: gmBud,          forecast: gmFcst },
    { key: 'opex',          label: 'Despesas Operacionais', isSubtotal: false, emphasis: 'negative', actual: opex.actual * m,    budget: opex.budget,    forecast: opex.forecast },
    { key: 'ebitda',        label: 'EBITDA',               isSubtotal: true,  emphasis: 'positive', actual: ebAct * m,          budget: ebBud,          forecast: ebFcst },
    { key: 'financial',     label: 'Resultado Financeiro', isSubtotal: false, emphasis: 'negative', actual: fin.actual * m,     budget: fin.budget,     forecast: fin.forecast },
    { key: 'taxes',         label: 'Impostos',             isSubtotal: false, emphasis: 'negative', actual: tax.actual * m,     budget: tax.budget,     forecast: tax.forecast },
    { key: 'net_result',    label: 'Resultado Líquido',    isSubtotal: true,  emphasis: 'positive', actual: netResAct * m,      budget: netResBud,      forecast: netResFcst },
  ];

  return rows.map(r => {
    const variance_abs = r.actual - r.budget;
    const variance_pct = r.budget !== 0 ? (variance_abs / Math.abs(r.budget)) * 100 : 0;
    return { ...r, variance_abs, variance_pct };
  });
}

// ============================================================
// Narrative content — kept as mock (would come from a separate
// AI/analytics service, not the financial ledger).
// ============================================================

export const DECISION_QUEUE: ExecutiveDecisionItem[] = [
  { id: 'dq-1', title: 'Aprovar reclassificação OPEX → CAPEX FPSO P-80',  category: 'Reclassificação', impact: 124_000_000, sla_hours: 24, aging_days: 2, owner: 'CFO',                priority: 'high'   },
  { id: 'dq-2', title: 'Validar provisão de contingência fiscal Q1',       category: 'Provisão Fiscal', impact:  86_500_000, sla_hours: 48, aging_days: 4, owner: 'Diretor Tributário', priority: 'high'   },
  { id: 'dq-3', title: 'Aprovar adiantamento subcontratado TechServ',      category: 'Cash-out',        impact:  32_000_000, sla_hours: 12, aging_days: 1, owner: 'Tesouraria',         priority: 'medium' },
  { id: 'dq-4', title: 'Revisar forecast Bacalhau — gap de margem',        category: 'Forecast',        impact:  48_000_000, sla_hours: 72, aging_days: 6, owner: 'Controller Sr.',     priority: 'high'   },
  { id: 'dq-5', title: 'Aprovar repasse hospedagem Macaé Q2',              category: 'OPEX',            impact:  14_200_000, sla_hours: 24, aging_days: 1, owner: 'Diretor Operações',  priority: 'medium' },
];

export const FINANCIAL_RISKS: FinancialRiskItem[] = [
  { id: 'fr-1', domain: 'margin',    label: 'Margem Bacalhau abaixo do limiar',     detail: '6,8% vs piso contratual 12%. Exposição ao final do contrato.',         severity: 'critical', exposure: 145_000_000, trend: 'down'   },
  { id: 'fr-2', domain: 'cash',      label: 'Concentração de recebíveis Petrobras', detail: '74% da AR vinculada a 1 cliente. Atrasos de 8 dias na média.',          severity: 'high',     exposure: 320_000_000, trend: 'stable' },
  { id: 'fr-3', domain: 'tax',       label: 'Provisão tributária subdimensionada',  detail: 'ISS retido divergente em 3 NF — exposição a auto de infração.',         severity: 'high',     exposure:  38_500_000, trend: 'up'     },
  { id: 'fr-4', domain: 'invoicing', label: 'NF Mero atrasada 12 dias',             detail: 'Faturamento Shell pendente de aceite técnico no portal.',                severity: 'medium',   exposure: 180_000_000, trend: 'up'     },
  { id: 'fr-5', domain: 'cost',      label: 'Horas extras 54% acima do plano',      detail: 'Engenharia de Campo — sobrecarga em mob. P-80.',                         severity: 'medium',   exposure:   6_500_000, trend: 'up'     },
  { id: 'fr-6', domain: 'cash',      label: 'Burn de caixa operacional',             detail: '21 dias de runway projetado — abaixo do mínimo (30d).',                 severity: 'high',     exposure:  92_000_000, trend: 'down'   },
];

export const AI_INSIGHTS: AiInsight[] = [
  { id: 'ai-1', kind: 'margin',      headline: 'Margem EBITDA 220bps abaixo do orçado',     detail: 'Compressão concentrada em Bacalhau (subcontratados +24% vs plano) e Mero (hospedagem +25%). Excluindo esses dois, margem fica acima do board.', impact: -38_000_000, confidence: 0.87, suggestion: 'Renegociar SLA TechServ (Bacalhau) e migrar 60% da hospedagem Macaé para corporativo.' },
  { id: 'ai-2', kind: 'forecast',    headline: 'Gap de Forecast vs Board: −R$ 28M no Q1',   detail: 'Forecast rolling 12m converge ao Board até Jul/26 se margem Bacalhau retornar a 12%. Caso contrário, gap acumulado de R$ 84M no exercício.',      impact: -28_000_000, confidence: 0.78, suggestion: 'Acionar gatilho contratual de revisão de preço Bacalhau até 2026-05-31.' },
  { id: 'ai-3', kind: 'cost',        headline: 'Horas extras explicam 31% do desvio de OPEX', detail: 'R$ 18,5M em HE no Q1 — concentradas em Eng. Campo (P-80). Padrão sazonal sugere repique em Mai/Jun.',                                          impact:  -6_500_000, confidence: 0.92, suggestion: 'Aprovar ramp-up de 6 técnicos contratados em vez de HE — payback 4 meses.' },
  { id: 'ai-4', kind: 'revenue',     headline: 'Receita líquida 2,4% acima do board',         detail: 'Outperformance puxada por Búzios (+R$ 14M) e P-80 (+R$ 9M). Mero abaixo em −R$ 12M por atraso de NF.',                                            impact:  11_000_000, confidence: 0.95, suggestion: 'Acelerar aceite técnico Mero junto à Shell — desbloqueia R$ 180M em A/R.' },
  { id: 'ai-5', kind: 'operational', headline: 'Caixa operacional em 21d de runway',           detail: 'AR concentrada em Petrobras (74%) com aging médio de 8d. Cenário stress puxa runway para 14d.',                                                  impact: -92_000_000, confidence: 0.83, suggestion: 'Antecipação seletiva de R$ 220M em recebíveis Petrobras a 1,2% a.m.' },
];

export const SPARKLINES: Record<string, number[]> = {
  health:         [72, 74, 71, 73, 76, 78, 75, 77, 79, 78, 80, 82],
  revenue:        [220, 245, 268, 290, 305, 318, 330, 345, 362, 378, 395, 410],
  ebitda:         [54, 58, 62, 60, 65, 68, 72, 70, 74, 78, 76, 80],
  margin:         [22.1, 22.4, 22.8, 23.1, 23.4, 23.6, 23.5, 23.8, 24.0, 24.1, 24.3, 24.5],
  operating:      [48, 52, 56, 54, 58, 61, 64, 62, 66, 69, 67, 71],
  forecastGap:    [-12, -10, -8, -14, -18, -22, -26, -28, -24, -22, -20, -18],
  cashRisk:       [85, 80, 78, 72, 68, 65, 60, 58, 52, 48, 42, 38],
  pendingActions: [8, 9, 7, 10, 12, 11, 13, 14, 15, 13, 12, 11],
};
