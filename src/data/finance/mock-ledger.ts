import type { LedgerEntry, PayrollBatch, PayrollAllocation, AllocationRule, AllocationResult, PeriodClose, APARTitle, TaxObligation } from '@/lib/types/finance';
import { cemigDirectCostLedgerEntries } from '@/data/finance/cemig-direct-costs';
import { cemigProjectedCostLedgerEntries } from '@/data/finance/cemig-cost-projection';

const CURRENT_USER = 'user-admin-001';

// ============================================================
// Backfill constants — declared BEFORE mockLedgerEntries because
// the array initializer calls generateBackfill() which reads them.
// (Function declarations hoist; `const` does not.)
// ============================================================

interface BackfillRecipe {
  category_id: string;
  cost_center_id: string;
  business_unit_id: string;
  project_id?: string;
  contract_id?: string;
  client_id?: string;
  supplier_id?: string;
  /** Cents per month, applied to each period in `periods`. */
  monthly_actual_cents: number;
  /** Budget per month (cents). Defaults to actual * 0.95 if omitted. */
  monthly_budget_cents?: number;
  /** Forecast per month (cents). Defaults to actual when omitted. */
  monthly_forecast_cents?: number;
  /** Override the descriptor used as entry description. */
  label: string;
  /**
   * Logistics-only: collaborators (employee ids) the spend rotates across,
   * one per period, so per-collaborator mobilization analytics has spread.
   * Resolved to a display name via LOGISTICS_CREW.
   */
  collaborator_pool?: string[];
}

/** id → display name for the logistics crew that incurs mobilization spend. */
const LOGISTICS_CREW: Record<string, string> = {
  'emp-006': 'Marcos Pereira',
  'emp-001': 'Carla Mendes',
  'emp-004': 'Diego Lopes',
  'emp-002': 'Felipe Araújo',
  'emp-101': 'João Batista',
  'emp-102': 'Sandra Lima',
  'emp-103': 'Rogério Alves',
};

const BACKFILL_PERIODS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'] as const;
const BACKFILL_LAST_DAY: Record<string, string> = {
  '2025-11': '30', '2025-12': '31',
  '2026-01': '31', '2026-02': '28', '2026-03': '31', '2026-04': '30',
};

// ============================================================
// Mock Ledger Entries — 6 months of realistic data
// ============================================================

export const mockLedgerEntries: LedgerEntry[] = [
  ...cemigDirectCostLedgerEntries,
  ...cemigProjectedCostLedgerEntries,

  // ── 2026-01 ──
  { id: 'le-001', entry_date: '2026-01-15', description: 'NF Serviços - Contrato Petrobras FPSO P-80', amount_cents: 285000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: undefined, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-20T10:00:00Z', created_at: '2026-01-15T08:00:00Z', updated_at: '2026-01-20T10:00:00Z' },
  { id: 'le-002', entry_date: '2026-01-10', description: 'Hotel Comfort Macaé - 5 técnicos x 20 diárias', amount_cents: 7500000, currency: 'BRL', category_id: 'cat-b21', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-1', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: 'hotel_per_diem', metadata: { city: 'Macaé', nights: 100, rate_per_night_cents: 75000, collaborator_id: 'emp-006', collaborator_name: 'Marcos Pereira' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-12T10:00:00Z', created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-12T10:00:00Z' },
  { id: 'le-003', entry_date: '2026-01-08', description: 'Passagens aéreas GRU-MCE - Janeiro', amount_cents: 1850000, currency: 'BRL', category_id: 'cat-b22', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-2', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'flight', metadata: { route: 'GRU-MCE-GRU', passenger: 'Carla Mendes', collaborator_id: 'emp-001', collaborator_name: 'Carla Mendes' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-10T10:00:00Z', created_at: '2026-01-08T08:00:00Z', updated_at: '2026-01-10T10:00:00Z' },
  { id: 'le-004', entry_date: '2026-01-20', description: 'NF TechServ - Soldagem especializada', amount_cents: 12000000, currency: 'BRL', category_id: 'cat-b41', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', supplier_id: 'sup-4', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: 'subcontractor_invoice', metadata: { nf_number: 'NF-2026-0142' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-22T10:00:00Z', created_at: '2026-01-20T08:00:00Z', updated_at: '2026-01-22T10:00:00Z' },
  { id: 'le-005', entry_date: '2026-01-31', description: 'Tarifa bancária Itaú - manutenção conta', amount_cents: 89000, currency: 'BRL', category_id: 'cat-d12', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-sp', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'bank_fee', metadata: { bank: 'Itaú', fee_type: 'Manutenção conta' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-01T10:00:00Z', created_at: '2026-01-31T08:00:00Z', updated_at: '2026-02-01T10:00:00Z' },
  { id: 'le-006', entry_date: '2026-01-31', description: 'ISS sobre NF Janeiro - Petrobras', amount_cents: 14250000, currency: 'BRL', category_id: 'cat-e11', cost_center_id: 'cc-financeiro', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'tax_payment', metadata: { tax_type: 'ISS', reference_period: '2026-01' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-05T10:00:00Z', created_at: '2026-01-31T08:00:00Z', updated_at: '2026-02-05T10:00:00Z' },
  { id: 'le-007', entry_date: '2026-01-25', description: 'Aluguel escritório SP - Janeiro', amount_cents: 3500000, currency: 'BRL', category_id: 'cat-c21', cost_center_id: 'cc-admin-sp', business_unit_id: 'bu-sp', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-26T10:00:00Z', created_at: '2026-01-25T08:00:00Z', updated_at: '2026-01-26T10:00:00Z' },

  // ── 2026-02 ──
  { id: 'le-008', entry_date: '2026-02-15', description: 'NF Serviços - Contrato Petrobras FPSO P-80', amount_cents: 310000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-18T10:00:00Z', created_at: '2026-02-15T08:00:00Z', updated_at: '2026-02-18T10:00:00Z' },
  { id: 'le-009', entry_date: '2026-02-10', description: 'NF Serviços - Shell FPSO Mero', amount_cents: 180000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-2', contract_id: 'ctr-2', business_unit_id: 'bu-rj', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-12T10:00:00Z', created_at: '2026-02-10T08:00:00Z', updated_at: '2026-02-12T10:00:00Z' },
  { id: 'le-010', entry_date: '2026-02-05', description: 'Hotel Macaé - Fev técnicos', amount_cents: 6800000, currency: 'BRL', category_id: 'cat-b21', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-1', business_unit_id: 'bu-rj', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: 'hotel_per_diem', metadata: { collaborator_id: 'emp-101', collaborator_name: 'João Batista' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-07T10:00:00Z', created_at: '2026-02-05T08:00:00Z', updated_at: '2026-02-07T10:00:00Z' },
  { id: 'le-011', entry_date: '2026-02-28', description: 'Licenças software - Fevereiro', amount_cents: 1200000, currency: 'BRL', category_id: 'cat-c31', cost_center_id: 'cc-ti', business_unit_id: 'bu-sp', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-03-01T10:00:00Z', created_at: '2026-02-28T08:00:00Z', updated_at: '2026-03-01T10:00:00Z' },

  // ── 2026-03 (current — mixed statuses) ──
  { id: 'le-012', entry_date: '2026-03-01', description: 'NF Serviços - Contrato Petrobras FPSO P-80 Mar', amount_cents: 295000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'actual', status: 'approved', source_system: 'manual', evidence_required: true, evidence_provided: true, created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-03-02T10:00:00Z', created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-02T10:00:00Z' },
  { id: 'le-013', entry_date: '2026-03-01', description: 'Hotel Comfort Macaé - Mar/26', amount_cents: 8200000, currency: 'BRL', category_id: 'cat-b21', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-1', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'actual', status: 'in_review', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: 'hotel_per_diem', metadata: { collaborator_id: 'emp-102', collaborator_name: 'Sandra Lima' }, created_by: CURRENT_USER, created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z' },
  { id: 'le-014', entry_date: '2026-03-01', description: 'Locação veículos Localiza - Mar', amount_cents: 4500000, currency: 'BRL', category_id: 'cat-b23', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-3', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'actual', status: 'draft', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'vehicle_rental', metadata: { collaborator_id: 'emp-103', collaborator_name: 'Rogério Alves' }, created_by: CURRENT_USER, created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z' },
  { id: 'le-015', entry_date: '2026-03-01', description: 'EPIs e uniformes - equipe campo RJ', amount_cents: 1800000, currency: 'BRL', category_id: 'cat-b32', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', supplier_id: 'sup-6', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'actual', status: 'draft', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'material', created_by: CURRENT_USER, created_at: '2026-03-01T09:00:00Z', updated_at: '2026-03-01T09:00:00Z' },

  // ── Pre-project costs (pending project allocation) ──
  // Booked against a contract before the project setup is complete: contract_id
  // is set but project_id is null. They must NOT count in official project AC
  // until linked via linkEntriesToProject. le-pending-002 is dated in a
  // soft-closed period to exercise closed-period dimension reclassification.
  { id: 'le-pending-001', entry_date: '2026-04-10', competence_month: '2026-04', description: 'Subcontratação mobilização inicial — Equinor (pré-projeto)', amount_cents: 3200000, currency: 'BRL', category_id: 'cat-b41', cost_center_id: 'cc-eng-campo', contract_id: 'ctr-3', supplier_id: 'sup-4', business_unit_id: 'bu-rj', period_key: '2026-04', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: true, notes: 'Custo anterior à criação do projeto Equinor', created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-04-11T10:00:00Z', created_at: '2026-04-10T08:00:00Z', updated_at: '2026-04-11T10:00:00Z' },
  { id: 'le-pending-002', entry_date: '2026-02-10', competence_month: '2026-02', description: 'Hospedagem visita técnica — Equinor (pré-projeto)', amount_cents: 1500000, currency: 'BRL', category_id: 'cat-b21', cost_center_id: 'cc-mob', contract_id: 'ctr-3', supplier_id: 'sup-1', business_unit_id: 'bu-rj', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: true, notes: 'Custo de prospecção anterior ao projeto', metadata: { collaborator_id: 'emp-002', collaborator_name: 'Felipe Araújo' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-11T10:00:00Z', created_at: '2026-02-10T08:00:00Z', updated_at: '2026-02-11T10:00:00Z' },

  // ── Payroll allocation postings (P&L cost by competence — see mockPayrollAllocations) ──
  // Generated by posting a PayrollAllocation. Recognized in the managerial DRE
  // under a P&L folha category (NOT clearing). Each is referenced back by its
  // allocation via linked_entry_id so the cost is counted exactly once.
  { id: 'le-payroll-001', entry_date: '2026-04-30', competence_month: '2026-04', description: 'Folha alocada — Carla Mendes → Petrobras FPSO P-80', amount_cents: 5928000, currency: 'BRL', category_id: 'cat-b11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-04', entry_type: 'actual', status: 'posted', source_system: 'payroll_alloc', source_ref: 'pa-2604-001', payroll_batch_id: 'pb-2604-rj', evidence_required: false, evidence_provided: true, metadata: { payroll_allocation_id: 'pa-2604-001', employee_id: 'emp-001' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-04-30T12:00:00Z', created_at: '2026-04-30T12:00:00Z', updated_at: '2026-04-30T12:00:00Z' },
  { id: 'le-payroll-002', entry_date: '2026-04-30', competence_month: '2026-04', description: 'Folha alocada — Diego Lopes → Petrobras FPSO P-80', amount_cents: 4056000, currency: 'BRL', category_id: 'cat-b11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-04', entry_type: 'actual', status: 'posted', source_system: 'payroll_alloc', source_ref: 'pa-2604-004', payroll_batch_id: 'pb-2604-rj', evidence_required: false, evidence_provided: true, metadata: { payroll_allocation_id: 'pa-2604-004', employee_id: 'emp-004' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-04-30T12:00:00Z', created_at: '2026-04-30T12:00:00Z', updated_at: '2026-04-30T12:00:00Z' },

  // ── Budget entries (2026-03) ──
  { id: 'le-b01', entry_date: '2026-03-01', description: 'Budget Receita Mar/26', amount_cents: 500000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'budget', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2025-12-15T10:00:00Z', created_at: '2025-12-15T10:00:00Z', updated_at: '2025-12-15T10:00:00Z' },
  { id: 'le-b02', entry_date: '2026-03-01', description: 'Budget COGS Mar/26', amount_cents: 320000000, currency: 'BRL', category_id: 'cat-b', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'budget', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2025-12-15T10:00:00Z', created_at: '2025-12-15T10:00:00Z', updated_at: '2025-12-15T10:00:00Z' },
  { id: 'le-b03', entry_date: '2026-03-01', description: 'Budget OPEX Mar/26', amount_cents: 85000000, currency: 'BRL', category_id: 'cat-c', cost_center_id: 'cc-admin-sp', business_unit_id: 'bu-sp', period_key: '2026-03', entry_type: 'budget', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2025-12-15T10:00:00Z', created_at: '2025-12-15T10:00:00Z', updated_at: '2025-12-15T10:00:00Z' },

  // ============================================================
  // BACKFILL — Generates 6 months of actuals/budget/forecast covering
  // all DRE groups, contracts, projects and cost centers so every
  // dashboard can derive its numbers from this ledger alone.
  // ============================================================
  ...generateBackfill(),
];

// ============================================================
// Backfill helpers — programmatic so we cover the full DRE shape
// without 200+ hand-written rows. (Constants are hoisted above the
// mockLedgerEntries array; only the function declarations live here.)
// ============================================================

function bf(
  prefix: string, period: string, type: 'actual' | 'budget' | 'forecast',
  recipe: BackfillRecipe, scenario?: 'realized' | 'budget' | 'forecast' | 'stress' | 'optimistic' | 'board',
): LedgerEntry {
  const amount = type === 'actual'
    ? recipe.monthly_actual_cents
    : type === 'budget'
      ? (recipe.monthly_budget_cents ?? Math.round(recipe.monthly_actual_cents * 0.95))
      : (recipe.monthly_forecast_cents ?? recipe.monthly_actual_cents);
  const day = BACKFILL_LAST_DAY[period] ?? '15';
  const date = `${period}-${type === 'actual' ? day : '01'}`;
  return {
    id: `${prefix}-${period}-${type}`,
    entry_date: date,
    competence_month: period,
    description: `${recipe.label} — ${period}`,
    amount_cents: amount,
    currency: 'BRL',
    category_id: recipe.category_id,
    cost_center_id: recipe.cost_center_id,
    project_id: recipe.project_id,
    contract_id: recipe.contract_id,
    client_id: recipe.client_id,
    supplier_id: recipe.supplier_id,
    business_unit_id: recipe.business_unit_id,
    period_key: period,
    entry_type: type,
    scenario: scenario ?? (type === 'actual' ? 'realized' : type === 'budget' ? 'budget' : 'forecast'),
    status: 'posted',
    source_system: 'manual',
    evidence_required: false,
    evidence_provided: type !== 'actual',
    created_by: CURRENT_USER,
    posted_by: CURRENT_USER,
    posted_at: `${date}T10:00:00Z`,
    created_at: `${date}T08:00:00Z`,
    updated_at: `${date}T10:00:00Z`,
  };
}

function generateBackfill(): LedgerEntry[] {
  // Recipes capture monthly run-rate per (category, cost center, project/contract).
  // Numbers tuned to roughly match the prior hard-coded dashboard totals so
  // visual consistency is preserved across the legacy pages.
  const recipes: BackfillRecipe[] = [
    // ── A. Revenue (contracts → revenue per cost center) ───────
    { label: 'Receita Petrobras P-80',     category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-1', contract_id: 'ctr-1', client_id: 'cli-1', monthly_actual_cents: 184_000_00, monthly_budget_cents: 180_000_00 },
    { label: 'Receita Shell Mero (Marco)', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-2', contract_id: 'ctr-2', client_id: 'cli-2', monthly_actual_cents: 265_000_00, monthly_budget_cents: 280_000_00 },
    { label: 'Receita Equinor Recorrente', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-3', contract_id: 'ctr-3', client_id: 'cli-3', monthly_actual_cents:  92_000_00, monthly_budget_cents:  92_000_00 },
    { label: 'Receita Eneva (Consumo)',    category_id: 'cat-a12', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-4', contract_id: 'ctr-4', client_id: 'cli-4', monthly_actual_cents:  38_500_00, monthly_budget_cents:  40_000_00 },
    { label: 'Receita Vale Sul (Marco)',   category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-5', contract_id: 'ctr-5',                     monthly_actual_cents: 478_000_00, monthly_budget_cents: 470_000_00 },
    { label: 'Receita Locação Equipamentos', category_id: 'cat-a21', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj',                                                              monthly_actual_cents:  62_000_00, monthly_budget_cents:  60_000_00 },

    // ── B. COGS — direct costs ─────────────────────────────────
    { label: 'Folha Direta Engenharia',    category_id: 'cat-b11', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-1', monthly_actual_cents: 341_000_00, monthly_budget_cents: 312_000_00 },
    { label: 'Encargos Trabalhistas',      category_id: 'cat-b12', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-1', monthly_actual_cents: 122_000_00, monthly_budget_cents: 112_000_00 },
    { label: 'Benefícios CLT campo',       category_id: 'cat-b13', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-2', monthly_actual_cents:  68_000_00, monthly_budget_cents:  64_000_00 },
    { label: 'Hospedagem Macaé',           category_id: 'cat-b21', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-1', supplier_id: 'sup-1', monthly_actual_cents:  74_000_00, monthly_budget_cents:  70_000_00, collaborator_pool: ['emp-006', 'emp-101', 'emp-001', 'emp-102', 'emp-004', 'emp-103'] },
    { label: 'Passagens aéreas',           category_id: 'cat-b22', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-1', supplier_id: 'sup-2', monthly_actual_cents:  18_000_00, monthly_budget_cents:  20_000_00, collaborator_pool: ['emp-001', 'emp-002', 'emp-006', 'emp-004', 'emp-103', 'emp-101'] },
    { label: 'Locação veículos',           category_id: 'cat-b23', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-2', supplier_id: 'sup-3', monthly_actual_cents:  21_000_00, monthly_budget_cents:  18_000_00, collaborator_pool: ['emp-103', 'emp-006', 'emp-102', 'emp-101', 'emp-002', 'emp-004'] },
    { label: 'Passagens de ônibus',        category_id: 'cat-b29', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-1', supplier_id: 'sup-7', monthly_actual_cents:   6_500_00, monthly_budget_cents:   6_000_00, collaborator_pool: ['emp-101', 'emp-102', 'emp-103', 'emp-006'] },
    { label: 'Combustível frota',          category_id: 'cat-b24', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-2', supplier_id: 'sup-5', monthly_actual_cents:   9_000_00, monthly_budget_cents:   8_500_00, collaborator_pool: ['emp-103', 'emp-006', 'emp-004', 'emp-101'] },
    { label: 'Pedágios frota',             category_id: 'cat-b2a', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-2', supplier_id: 'sup-8', monthly_actual_cents:   3_200_00, monthly_budget_cents:   3_000_00, collaborator_pool: ['emp-006', 'emp-103', 'emp-102', 'emp-004'] },
    { label: 'Alimentação em campo',       category_id: 'cat-b25', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-1', supplier_id: 'sup-9', monthly_actual_cents:  13_000_00, monthly_budget_cents:  12_000_00, collaborator_pool: ['emp-006', 'emp-101', 'emp-102', 'emp-001', 'emp-004', 'emp-103'] },
    { label: 'Diárias de equipe',          category_id: 'cat-b27', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-1',                       monthly_actual_cents:  16_500_00, monthly_budget_cents:  15_000_00, collaborator_pool: ['emp-101', 'emp-102', 'emp-006', 'emp-103', 'emp-004', 'emp-002'] },
    { label: 'Transporte de material',     category_id: 'cat-b28', cost_center_id: 'cc-mob',       business_unit_id: 'bu-rj', project_id: 'proj-2', supplier_id: 'sup-10', monthly_actual_cents:  11_500_00, monthly_budget_cents:  11_000_00, collaborator_pool: ['emp-103', 'emp-006', 'emp-101'] },
    { label: 'Subcontratação serviços',    category_id: 'cat-b41', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-1', supplier_id: 'sup-4', monthly_actual_cents:  89_000_00, monthly_budget_cents:  85_000_00 },
    { label: 'Cloud / Infra',              category_id: 'cat-c32', cost_center_id: 'cc-ti',        business_unit_id: 'bu-sp',                                          monthly_actual_cents: 158_000_00, monthly_budget_cents: 162_000_00 },
    { label: 'EPIs e materiais',           category_id: 'cat-b32', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', project_id: 'proj-1', supplier_id: 'sup-6', monthly_actual_cents:  16_000_00, monthly_budget_cents:  18_000_00 },

    // ── C. OPEX (indirect) ─────────────────────────────────────
    { label: 'Folha Indireta Admin',       category_id: 'cat-c11', cost_center_id: 'cc-admin-sp',  business_unit_id: 'bu-sp', monthly_actual_cents: 198_000_00, monthly_budget_cents: 198_000_00 },
    { label: 'Aluguel escritório SP',      category_id: 'cat-c21', cost_center_id: 'cc-admin-sp',  business_unit_id: 'bu-sp', monthly_actual_cents:  35_000_00, monthly_budget_cents:  35_000_00 },
    { label: 'Energia / Telecom',          category_id: 'cat-c22', cost_center_id: 'cc-admin-sp',  business_unit_id: 'bu-sp', monthly_actual_cents:  12_000_00, monthly_budget_cents:  12_000_00 },
    { label: 'Licenças SaaS',              category_id: 'cat-c31', cost_center_id: 'cc-ti',        business_unit_id: 'bu-sp', monthly_actual_cents:  28_000_00, monthly_budget_cents:  30_000_00 },
    { label: 'Honorários jurídicos',       category_id: 'cat-c41', cost_center_id: 'cc-admin-sp',  business_unit_id: 'bu-sp', monthly_actual_cents:  18_000_00, monthly_budget_cents:  12_000_00 },
    { label: 'Contabilidade / Auditoria',  category_id: 'cat-c42', cost_center_id: 'cc-admin-sp',  business_unit_id: 'bu-sp', monthly_actual_cents:   9_000_00, monthly_budget_cents:   9_000_00 },
    { label: 'Comissões comerciais',       category_id: 'cat-c51', cost_center_id: 'cc-comercial', business_unit_id: 'bu-sp', monthly_actual_cents:  32_000_00, monthly_budget_cents:  30_000_00 },
    { label: 'Eventos / Feiras',           category_id: 'cat-c52', cost_center_id: 'cc-comercial', business_unit_id: 'bu-sp', monthly_actual_cents:  11_000_00, monthly_budget_cents:  10_000_00 },

    // ── D. Financial result ────────────────────────────────────
    { label: 'Tarifas bancárias',          category_id: 'cat-d12', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-sp', monthly_actual_cents:   3_500_00, monthly_budget_cents:   3_000_00 },
    { label: 'Juros empréstimo',           category_id: 'cat-d11', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-sp', monthly_actual_cents:  42_000_00, monthly_budget_cents:  40_000_00 },
    { label: 'Variação cambial USD',       category_id: 'cat-d31', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-sp', monthly_actual_cents:  15_500_00, monthly_budget_cents:  10_000_00 },
    { label: 'Rendimento aplicações',      category_id: 'cat-d41', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-sp', monthly_actual_cents:   8_000_00, monthly_budget_cents:   7_000_00 },

    // ── E. Taxes ───────────────────────────────────────────────
    { label: 'ISS',                        category_id: 'cat-e11', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-rj', contract_id: 'ctr-1', monthly_actual_cents: 28_000_00, monthly_budget_cents: 27_000_00 },
    { label: 'PIS / COFINS',               category_id: 'cat-e12', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-rj',                       monthly_actual_cents: 41_000_00, monthly_budget_cents: 40_000_00 },
    { label: 'IRPJ / CSLL (provisão)',     category_id: 'cat-e13', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-sp',                       monthly_actual_cents: 56_000_00, monthly_budget_cents: 52_000_00 },
    { label: 'Impostos Retidos na Fonte',  category_id: 'cat-e22', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-sp',                       monthly_actual_cents: 18_000_00, monthly_budget_cents: 18_000_00 },
  ];

  const out: LedgerEntry[] = [];
  for (const [periodIdx, period] of BACKFILL_PERIODS.entries()) {
    for (const recipe of recipes) {
      const prefix = `bf-${recipe.category_id}-${recipe.cost_center_id}-${recipe.project_id ?? 'corp'}`;
      out.push(bf(prefix, period, 'budget',   recipe));
      out.push(bf(prefix, period, 'forecast', recipe));
      // Only emit actuals for periods up to current. The page treats 2026-04 as the most recent month.
      if (period <= '2026-04') {
        const actual = bf(prefix, period, 'actual', recipe);
        // Logistics recipes rotate spend across a small crew so the
        // per-collaborator mobilization analytics has real spread.
        if (recipe.collaborator_pool?.length) {
          const id = recipe.collaborator_pool[periodIdx % recipe.collaborator_pool.length];
          actual.metadata = { ...actual.metadata, collaborator_id: id, collaborator_name: LOGISTICS_CREW[id] ?? id };
        }
        out.push(actual);
      }
    }
  }
  return out;
}

// ============================================================
// Mock Payroll Batches
// ============================================================

export const mockPayrollBatches: PayrollBatch[] = [
  { id: 'pb-2601-rj', period_key: '2026-01', business_unit_id: 'bu-rj', total_gross_cents: 42000000, total_charges_cents: 15120000, total_benefits_cents: 8400000, headcount: 35, status: 'posted', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-02-05T10:00:00Z', created_at: '2026-02-01T08:00:00Z', updated_at: '2026-02-05T10:00:00Z' },
  { id: 'pb-2601-sp', period_key: '2026-01', business_unit_id: 'bu-sp', total_gross_cents: 18000000, total_charges_cents: 6480000, total_benefits_cents: 3600000, headcount: 12, status: 'posted', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-02-05T10:00:00Z', created_at: '2026-02-01T08:00:00Z', updated_at: '2026-02-05T10:00:00Z' },
  { id: 'pb-2602-rj', period_key: '2026-02', business_unit_id: 'bu-rj', total_gross_cents: 44000000, total_charges_cents: 15840000, total_benefits_cents: 8800000, headcount: 37, status: 'posted', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-03-05T10:00:00Z', created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-05T10:00:00Z' },
  { id: 'pb-2602-sp', period_key: '2026-02', business_unit_id: 'bu-sp', total_gross_cents: 18500000, total_charges_cents: 6660000, total_benefits_cents: 3700000, headcount: 12, status: 'posted', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-03-05T10:00:00Z', created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-05T10:00:00Z' },
  { id: 'pb-2603-rj', period_key: '2026-03', business_unit_id: 'bu-rj', total_gross_cents: 45000000, total_charges_cents: 16200000, total_benefits_cents: 9000000, headcount: 38, status: 'draft', source_system: 'manual', created_by: CURRENT_USER, created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z' },
  { id: 'pb-2604-rj', period_key: '2026-04', business_unit_id: 'bu-rj', total_gross_cents: 46000000, total_charges_cents: 16560000, total_benefits_cents: 9200000, headcount: 39, status: 'approved', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-05-05T10:00:00Z', created_at: '2026-05-01T08:00:00Z', updated_at: '2026-05-05T10:00:00Z' },
  { id: 'pb-2604-sp', period_key: '2026-04', business_unit_id: 'bu-sp', total_gross_cents: 19000000, total_charges_cents: 6840000, total_benefits_cents: 3800000, headcount: 13, status: 'approved', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-05-05T10:00:00Z', created_at: '2026-05-01T08:00:00Z', updated_at: '2026-05-05T10:00:00Z' },
];

// ============================================================
// Mock Payroll Allocations
// ----------------------------------------------------------------
// One row per (employee, competence) directing the employee's fully-loaded
// payroll cost onto a project / cost center. total_cost = gross + taxes +
// benefits; allocated = total_cost * pct/100; the unallocated remainder is
// structural/idle cost. Posting recognizes the allocated amount in the DRE
// under a P&L folha category (cat-b11 direct / cat-c11 indirect) — never
// clearing. The two 'posted' 2026-04 rows already carry their linked DRE
// entry (le-payroll-001/002) so the cost is counted exactly once.
// ============================================================

export const mockPayrollAllocations: PayrollAllocation[] = [
  // ── 2026-04 competence (current cycle) ──
  { id: 'pa-2604-001', employee_id: 'emp-001', employee_name: 'Carla Mendes',    department_id: 'dept-eng',   department_name: 'Engenharia',     role: 'Eng. Manager',   competence_month: '2026-04', payroll_batch_id: 'pb-2604-rj', gross_amount_cents: 3800000, taxes_amount_cents: 1368000, benefits_amount_cents: 760000, total_cost_cents: 5928000, allocated_amount_cents: 5928000, allocation_percentage: 100, project_id: 'proj-1', contract_id: 'ctr-1', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', status: 'posted',    linked_entry_id: 'le-payroll-001', source_system: 'payroll_alloc', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-04-29T10:00:00Z', posted_at: '2026-04-30T12:00:00Z', created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-30T12:00:00Z' },
  { id: 'pa-2604-002', employee_id: 'emp-002', employee_name: 'Felipe Araújo',   department_id: 'dept-eng',   department_name: 'Engenharia',     role: 'Tech Lead',      competence_month: '2026-04', payroll_batch_id: 'pb-2604-rj', gross_amount_cents: 3200000, taxes_amount_cents: 1152000, benefits_amount_cents: 640000, total_cost_cents: 4992000, allocated_amount_cents: 4992000, allocation_percentage: 100, project_id: 'proj-2', contract_id: 'ctr-2', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', status: 'approved',  source_system: 'payroll_alloc', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-04-29T10:00:00Z', created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-29T10:00:00Z' },
  { id: 'pa-2604-003', employee_id: 'emp-003', employee_name: 'Renata Souza',    department_id: 'dept-eng',   department_name: 'Engenharia',     role: 'Senior Engineer', competence_month: '2026-04', payroll_batch_id: 'pb-2604-rj', gross_amount_cents: 2600000, taxes_amount_cents: 936000, benefits_amount_cents: 520000, total_cost_cents: 4056000, allocated_amount_cents: 3042000, allocation_percentage: 75, project_id: 'proj-3', contract_id: 'ctr-3', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', status: 'allocated', source_system: 'payroll_alloc', created_by: CURRENT_USER, created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-26T08:00:00Z' },
  { id: 'pa-2604-004', employee_id: 'emp-004', employee_name: 'Diego Lopes',     department_id: 'dept-manut', department_name: 'Manutenção',     role: 'Senior Engineer', competence_month: '2026-04', payroll_batch_id: 'pb-2604-rj', gross_amount_cents: 2600000, taxes_amount_cents: 936000, benefits_amount_cents: 520000, total_cost_cents: 4056000, allocated_amount_cents: 4056000, allocation_percentage: 100, project_id: 'proj-1', contract_id: 'ctr-1', cost_center_id: 'cc-manut', business_unit_id: 'bu-rj', status: 'posted',    linked_entry_id: 'le-payroll-002', source_system: 'payroll_alloc', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-04-29T10:00:00Z', posted_at: '2026-04-30T12:00:00Z', created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-30T12:00:00Z' },
  { id: 'pa-2604-005', employee_id: 'emp-005', employee_name: 'Beatriz Tavares', department_id: 'dept-manut', department_name: 'Manutenção',     role: 'Data Engineer',  competence_month: '2026-04', payroll_batch_id: 'pb-2604-rj', gross_amount_cents: 2200000, taxes_amount_cents: 792000, benefits_amount_cents: 440000, total_cost_cents: 3432000, allocated_amount_cents: 2745600, allocation_percentage: 80, project_id: 'proj-3', contract_id: 'ctr-3', cost_center_id: 'cc-manut', business_unit_id: 'bu-rj', status: 'allocated', source_system: 'payroll_alloc', created_by: CURRENT_USER, created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-26T08:00:00Z' },
  { id: 'pa-2604-006', employee_id: 'emp-006', employee_name: 'Marcos Pereira',  department_id: 'dept-mob',   department_name: 'Mobilização',    role: 'Field Coordinator', competence_month: '2026-04', payroll_batch_id: 'pb-2604-rj', gross_amount_cents: 1800000, taxes_amount_cents: 648000, benefits_amount_cents: 360000, total_cost_cents: 2808000, allocated_amount_cents: 2808000, allocation_percentage: 100, project_id: 'proj-2', contract_id: 'ctr-2', cost_center_id: 'cc-mob', business_unit_id: 'bu-rj', status: 'approved',  source_system: 'payroll_alloc', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-04-29T10:00:00Z', created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-29T10:00:00Z' },
  { id: 'pa-2604-007', employee_id: 'emp-007', employee_name: 'Patrícia Lemos',  department_id: 'dept-adm',   department_name: 'Administrativo', role: 'RH Lead',        competence_month: '2026-04', payroll_batch_id: 'pb-2604-sp', gross_amount_cents: 1600000, taxes_amount_cents: 576000, benefits_amount_cents: 320000, total_cost_cents: 2496000, allocated_amount_cents: 0, allocation_percentage: 0, cost_center_id: 'cc-admin-sp', business_unit_id: 'bu-sp', status: 'draft', source_system: 'payroll_alloc', notes: 'Custo estrutural — não alocado a projeto.', created_by: CURRENT_USER, created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-25T08:00:00Z' },
  { id: 'pa-2604-008', employee_id: 'emp-008', employee_name: 'Henrique Vidal',  department_id: 'dept-adm',   department_name: 'Administrativo', role: 'Controller',     competence_month: '2026-04', payroll_batch_id: 'pb-2604-sp', gross_amount_cents: 2000000, taxes_amount_cents: 720000, benefits_amount_cents: 400000, total_cost_cents: 3120000, allocated_amount_cents: 0, allocation_percentage: 0, cost_center_id: 'cc-admin-sp', business_unit_id: 'bu-sp', status: 'draft', source_system: 'payroll_alloc', notes: 'Custo estrutural — não alocado a projeto.', created_by: CURRENT_USER, created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-25T08:00:00Z' },
  { id: 'pa-2604-009', employee_id: 'emp-009', employee_name: 'Aline Costa',     department_id: 'dept-ti',    department_name: 'TI',             role: 'DevOps Engineer', competence_month: '2026-04', payroll_batch_id: 'pb-2604-sp', gross_amount_cents: 2400000, taxes_amount_cents: 864000, benefits_amount_cents: 480000, total_cost_cents: 3744000, allocated_amount_cents: 1872000, allocation_percentage: 50, project_id: 'proj-4', contract_id: 'ctr-4', cost_center_id: 'cc-ti', business_unit_id: 'bu-sp', status: 'allocated', source_system: 'payroll_alloc', created_by: CURRENT_USER, created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-26T08:00:00Z' },
  { id: 'pa-2604-010', employee_id: 'emp-010', employee_name: 'Rafael Nunes',    department_id: 'dept-com',   department_name: 'Comercial',      role: 'Account Executive', competence_month: '2026-04', payroll_batch_id: 'pb-2604-sp', gross_amount_cents: 1900000, taxes_amount_cents: 684000, benefits_amount_cents: 380000, total_cost_cents: 2964000, allocated_amount_cents: 1778400, allocation_percentage: 60, project_id: 'proj-5', contract_id: 'ctr-5', cost_center_id: 'cc-comercial', business_unit_id: 'bu-sp', status: 'approved', source_system: 'payroll_alloc', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-04-29T10:00:00Z', created_at: '2026-04-25T08:00:00Z', updated_at: '2026-04-29T10:00:00Z' },

  // ── 2026-03 competence (history) ──
  { id: 'pa-2603-001', employee_id: 'emp-001', employee_name: 'Carla Mendes',    department_id: 'dept-eng',   department_name: 'Engenharia',     role: 'Eng. Manager',   competence_month: '2026-03', payroll_batch_id: 'pb-2603-rj', gross_amount_cents: 3700000, taxes_amount_cents: 1332000, benefits_amount_cents: 740000, total_cost_cents: 5772000, allocated_amount_cents: 5772000, allocation_percentage: 100, project_id: 'proj-1', contract_id: 'ctr-1', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', status: 'approved', source_system: 'payroll_alloc', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-03-29T10:00:00Z', created_at: '2026-03-25T08:00:00Z', updated_at: '2026-03-29T10:00:00Z' },
  { id: 'pa-2603-002', employee_id: 'emp-002', employee_name: 'Felipe Araújo',   department_id: 'dept-eng',   department_name: 'Engenharia',     role: 'Tech Lead',      competence_month: '2026-03', payroll_batch_id: 'pb-2603-rj', gross_amount_cents: 3100000, taxes_amount_cents: 1116000, benefits_amount_cents: 620000, total_cost_cents: 4836000, allocated_amount_cents: 3627000, allocation_percentage: 75, project_id: 'proj-2', contract_id: 'ctr-2', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', status: 'allocated', source_system: 'payroll_alloc', created_by: CURRENT_USER, created_at: '2026-03-25T08:00:00Z', updated_at: '2026-03-26T08:00:00Z' },
];

// ============================================================
// Mock Allocation Rules
// ============================================================

export const mockAllocationRules: AllocationRule[] = [
  {
    id: 'ar-001',
    name: 'Rateio Engenharia de Campo',
    version: 1,
    cost_center_id: 'cc-eng-campo',
    method: 'fixed_pct',
    rules_json: [
      { target_project_id: 'proj-1', target_project_name: 'Petrobras FPSO P-80', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', weight: 60 },
      { target_project_id: 'proj-2', target_project_name: 'Shell FPSO Mero', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', weight: 30 },
      { target_project_id: 'proj-3', target_project_name: 'Equinor Bacalhau', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', weight: 10 },
    ],
    effective_from: '2026-01-01',
    status: 'active',
    created_by: CURRENT_USER,
    created_at: '2025-12-20T10:00:00Z',
    updated_at: '2025-12-20T10:00:00Z',
  },
  {
    id: 'ar-002',
    name: 'Rateio Administrativo SP',
    version: 1,
    cost_center_id: 'cc-admin-sp',
    method: 'revenue',
    rules_json: [],
    effective_from: '2026-01-01',
    status: 'active',
    created_by: CURRENT_USER,
    created_at: '2025-12-20T10:00:00Z',
    updated_at: '2025-12-20T10:00:00Z',
  },
];

// ============================================================
// Mock Allocation Results
// ============================================================

export const mockAllocationResults: AllocationResult[] = [
  {
    id: 'alloc-r-001',
    rule_id: 'ar-001',
    period_key: '2026-01',
    payroll_batch_id: 'pb-2601-rj',
    source_amount_cents: 42000000,
    result_entries: [
      { target_project_id: 'proj-1', target_project_name: 'Petrobras FPSO P-80', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', amount_cents: 25200000, weight_pct: 60 },
      { target_project_id: 'proj-2', target_project_name: 'Shell FPSO Mero', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', amount_cents: 12600000, weight_pct: 30 },
      { target_project_id: 'proj-3', target_project_name: 'Equinor Bacalhau', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', amount_cents: 4200000, weight_pct: 10 },
    ],
    status: 'posted',
    posted_at: '2026-02-06T10:00:00Z',
    created_by: CURRENT_USER,
    created_at: '2026-02-05T10:00:00Z',
  },
];

// ============================================================
// Mock Period Closes
// ============================================================

export const mockPeriodCloses: PeriodClose[] = [
  { id: 'pc-2601', period_key: '2026-01', status: 'closed', soft_closed_at: '2026-02-05T00:00:00Z', closed_at: '2026-02-10T00:00:00Z', closed_by: CURRENT_USER },
  { id: 'pc-2602', period_key: '2026-02', status: 'soft_close', soft_closed_at: '2026-03-05T00:00:00Z' },
  { id: 'pc-2603', period_key: '2026-03', status: 'open' },
];

// ============================================================
// Mock AP/AR Titles
// ============================================================

export const mockAPARTitles: APARTitle[] = [
  { id: 'apar-001', type: 'receivable', title_number: 'NF-2026-001', client_id: 'cli-1', contract_id: 'ctr-1', project_id: 'proj-1', issue_date: '2026-01-15', due_date: '2026-02-14', amount_cents: 285000000, paid_amount_cents: 285000000, status: 'paid', source_system: 'manual', created_by: CURRENT_USER, created_at: '2026-01-15T08:00:00Z', updated_at: '2026-02-14T10:00:00Z' },
  { id: 'apar-002', type: 'receivable', title_number: 'NF-2026-002', client_id: 'cli-1', contract_id: 'ctr-1', project_id: 'proj-1', issue_date: '2026-02-15', due_date: '2026-03-17', amount_cents: 310000000, paid_amount_cents: 0, status: 'open', source_system: 'manual', created_by: CURRENT_USER, created_at: '2026-02-15T08:00:00Z', updated_at: '2026-02-15T08:00:00Z' },
  { id: 'apar-003', type: 'receivable', title_number: 'NF-2026-003', client_id: 'cli-2', contract_id: 'ctr-2', project_id: 'proj-2', issue_date: '2026-02-10', due_date: '2026-03-12', amount_cents: 180000000, paid_amount_cents: 0, status: 'open', source_system: 'manual', created_by: CURRENT_USER, created_at: '2026-02-10T08:00:00Z', updated_at: '2026-02-10T08:00:00Z' },
  { id: 'apar-004', type: 'payable', title_number: 'NF-SUP-001', supplier_id: 'sup-4', project_id: 'proj-1', issue_date: '2026-01-20', due_date: '2026-02-19', amount_cents: 12000000, paid_amount_cents: 12000000, status: 'paid', source_system: 'manual', created_by: CURRENT_USER, created_at: '2026-01-20T08:00:00Z', updated_at: '2026-02-19T10:00:00Z' },
  { id: 'apar-005', type: 'payable', title_number: 'NF-SUP-002', supplier_id: 'sup-1', project_id: 'proj-1', issue_date: '2026-02-05', due_date: '2026-03-07', amount_cents: 6800000, paid_amount_cents: 0, status: 'open', source_system: 'manual', created_by: CURRENT_USER, created_at: '2026-02-05T08:00:00Z', updated_at: '2026-02-05T08:00:00Z' },
  { id: 'apar-006', type: 'payable', title_number: 'NF-SUP-003', supplier_id: 'sup-3', project_id: 'proj-1', issue_date: '2026-01-10', due_date: '2026-02-09', amount_cents: 4500000, paid_amount_cents: 0, status: 'overdue', source_system: 'manual', created_by: CURRENT_USER, created_at: '2026-01-10T08:00:00Z', updated_at: '2026-03-01T08:00:00Z' },
];

// ============================================================
// Mock Tax Obligations
// ----------------------------------------------------------------
// Each entry is an accrued/scheduled tax with its own settlement cycle.
// The competence accrual (P&L) is already in mockLedgerEntries (group_key
// 'taxes'); cash settlement is posted on payment via the clearing group
// (cat-f31) so the DRE is never double-counted. See recordTaxPayment.
// ============================================================

export const mockTaxObligations: TaxObligation[] = [
  // 2026-04 competence — current cycle (today = 2026-04-30 in mock world)
  { id: 'tax-001', tax_type: 'PIS', title: 'PIS sobre faturamento', description: 'Apuração mensal sobre receita 2026-04', competence_month: '2026-04', due_date: '2026-05-25', paid_date: '2026-05-25', status: 'paid', amount_cents: 30_500_00, paid_amount_cents: 30_500_00, cost_center_id: 'cc-financeiro', accrual_entry_id: 'bf-cat-e12-cc-financeiro-corp-2026-04-actual', created_by: CURRENT_USER, created_at: '2026-04-30T08:00:00Z', updated_at: '2026-05-25T10:00:00Z' },
  { id: 'tax-002', tax_type: 'COFINS', title: 'COFINS sobre faturamento', description: 'Apuração mensal sobre receita 2026-04', competence_month: '2026-04', due_date: '2026-05-25', paid_date: '2026-05-25', status: 'paid', amount_cents: 108_550_00, paid_amount_cents: 108_550_00, cost_center_id: 'cc-financeiro', created_by: CURRENT_USER, created_at: '2026-04-30T08:00:00Z', updated_at: '2026-05-25T10:00:00Z' },
  { id: 'tax-003', tax_type: 'ISS', title: 'ISS — São Paulo', description: 'ISS sobre prestação de serviços', competence_month: '2026-04', due_date: '2026-05-15', status: 'open', amount_cents: 46_200_00, paid_amount_cents: 0, cost_center_id: 'cc-financeiro', accrual_entry_id: 'bf-cat-e11-cc-financeiro-corp-2026-04-actual', created_by: CURRENT_USER, created_at: '2026-04-30T08:00:00Z', updated_at: '2026-04-30T08:00:00Z' },
  { id: 'tax-004', tax_type: 'IRPJ', title: 'IRPJ — apuração mensal', description: 'Apuração estimativa mensal', competence_month: '2026-04', due_date: '2026-05-31', status: 'scheduled', amount_cents: 68_000_00, paid_amount_cents: 0, cost_center_id: 'cc-financeiro', accrual_entry_id: 'bf-cat-e13-cc-financeiro-corp-2026-04-actual', created_by: CURRENT_USER, created_at: '2026-04-30T08:00:00Z', updated_at: '2026-04-30T08:00:00Z' },
  { id: 'tax-005', tax_type: 'CSLL', title: 'CSLL — apuração mensal', description: 'CSLL estimativa mensal', competence_month: '2026-04', due_date: '2026-05-31', status: 'scheduled', amount_cents: 30_530_00, paid_amount_cents: 0, cost_center_id: 'cc-financeiro', created_by: CURRENT_USER, created_at: '2026-04-30T08:00:00Z', updated_at: '2026-04-30T08:00:00Z' },
  { id: 'tax-006', tax_type: 'IRRF', title: 'IRRF — Banco Iguaçu', description: 'Retenção sobre serviços prestados', competence_month: '2026-04', due_date: '2026-04-20', paid_date: '2026-04-20', status: 'paid', amount_cents: 7_950_00, paid_amount_cents: 7_950_00, client_id: 'cli-1', contract_id: 'ctr-1', cost_center_id: 'cc-financeiro', created_by: CURRENT_USER, created_at: '2026-04-01T08:00:00Z', updated_at: '2026-04-20T10:00:00Z' },
  { id: 'tax-007', tax_type: 'CSRF', title: 'CSRF — Mineração Vale Sul', description: 'Retenção sobre serviços — atrasada', competence_month: '2026-04', due_date: '2026-04-20', status: 'open', amount_cents: 21_562_50, paid_amount_cents: 0, client_id: 'cli-2', contract_id: 'ctr-2', cost_center_id: 'cc-financeiro', invoice_number: 'NF-2026-002', created_by: CURRENT_USER, created_at: '2026-04-01T08:00:00Z', updated_at: '2026-04-30T08:00:00Z' },
  { id: 'tax-008', tax_type: 'INSS', title: 'INSS sobre folha', description: 'GPS — competência 2026-04', competence_month: '2026-04', due_date: '2026-05-20', paid_date: '2026-05-19', status: 'paid', amount_cents: 55_800_00, paid_amount_cents: 55_800_00, cost_center_id: 'cc-financeiro', created_by: CURRENT_USER, created_at: '2026-04-30T08:00:00Z', updated_at: '2026-05-19T10:00:00Z' },
  { id: 'tax-009', tax_type: 'ICMS', title: 'ICMS — produtos digitais', description: 'Em revisão fiscal — classificação', competence_month: '2026-04', due_date: '2026-05-22', status: 'open', amount_cents: 14_200_00, paid_amount_cents: 0, cost_center_id: 'cc-financeiro', notes: 'Aguardando parecer fiscal', created_by: CURRENT_USER, created_at: '2026-04-30T08:00:00Z', updated_at: '2026-04-30T08:00:00Z' },
  { id: 'tax-010', tax_type: 'FGTS', title: 'FGTS — competência 2026-04', description: 'GRF — depósito mensal', competence_month: '2026-04', due_date: '2026-05-07', paid_date: '2026-05-07', status: 'paid', amount_cents: 18_400_00, paid_amount_cents: 18_400_00, cost_center_id: 'cc-financeiro', created_by: CURRENT_USER, created_at: '2026-04-30T08:00:00Z', updated_at: '2026-05-07T10:00:00Z' },
  // 2026-03 competence — already settled (history)
  { id: 'tax-011', tax_type: 'PIS', title: 'PIS sobre faturamento', competence_month: '2026-03', due_date: '2026-04-25', paid_date: '2026-04-25', status: 'paid', amount_cents: 29_800_00, paid_amount_cents: 29_800_00, cost_center_id: 'cc-financeiro', created_by: CURRENT_USER, created_at: '2026-03-31T08:00:00Z', updated_at: '2026-04-25T10:00:00Z' },
  { id: 'tax-012', tax_type: 'COFINS', title: 'COFINS sobre faturamento', competence_month: '2026-03', due_date: '2026-04-25', paid_date: '2026-04-25', status: 'paid', amount_cents: 105_200_00, paid_amount_cents: 105_200_00, cost_center_id: 'cc-financeiro', created_by: CURRENT_USER, created_at: '2026-03-31T08:00:00Z', updated_at: '2026-04-25T10:00:00Z' },
];
