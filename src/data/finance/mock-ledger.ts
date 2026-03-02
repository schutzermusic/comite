import type { LedgerEntry, PayrollBatch, AllocationRule, AllocationResult, PeriodClose, APARTitle } from '@/lib/types/finance';

const CURRENT_USER = 'user-admin-001';

// ============================================================
// Mock Ledger Entries — 6 months of realistic data
// ============================================================

export const mockLedgerEntries: LedgerEntry[] = [
  // ── 2026-01 ──
  { id: 'le-001', entry_date: '2026-01-15', description: 'NF Serviços - Contrato Petrobras FPSO P-80', amount_cents: 285000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: undefined, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-20T10:00:00Z', created_at: '2026-01-15T08:00:00Z', updated_at: '2026-01-20T10:00:00Z' },
  { id: 'le-002', entry_date: '2026-01-10', description: 'Hotel Comfort Macaé - 5 técnicos x 20 diárias', amount_cents: 7500000, currency: 'BRL', category_id: 'cat-b21', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-1', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: 'hotel_per_diem', metadata: { city: 'Macaé', nights: 100, rate_per_night_cents: 75000 }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-12T10:00:00Z', created_at: '2026-01-10T08:00:00Z', updated_at: '2026-01-12T10:00:00Z' },
  { id: 'le-003', entry_date: '2026-01-08', description: 'Passagens aéreas GRU-MCE - Janeiro', amount_cents: 1850000, currency: 'BRL', category_id: 'cat-b22', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-2', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'flight', metadata: { route: 'GRU-MCE-GRU', passenger: 'Equipe técnica' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-10T10:00:00Z', created_at: '2026-01-08T08:00:00Z', updated_at: '2026-01-10T10:00:00Z' },
  { id: 'le-004', entry_date: '2026-01-20', description: 'NF TechServ - Soldagem especializada', amount_cents: 12000000, currency: 'BRL', category_id: 'cat-b41', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', supplier_id: 'sup-4', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: 'subcontractor_invoice', metadata: { nf_number: 'NF-2026-0142' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-22T10:00:00Z', created_at: '2026-01-20T08:00:00Z', updated_at: '2026-01-22T10:00:00Z' },
  { id: 'le-005', entry_date: '2026-01-31', description: 'Tarifa bancária Itaú - manutenção conta', amount_cents: 89000, currency: 'BRL', category_id: 'cat-d12', cost_center_id: 'cc-financeiro', business_unit_id: 'bu-sp', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'bank_fee', metadata: { bank: 'Itaú', fee_type: 'Manutenção conta' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-01T10:00:00Z', created_at: '2026-01-31T08:00:00Z', updated_at: '2026-02-01T10:00:00Z' },
  { id: 'le-006', entry_date: '2026-01-31', description: 'ISS sobre NF Janeiro - Petrobras', amount_cents: 14250000, currency: 'BRL', category_id: 'cat-e11', cost_center_id: 'cc-financeiro', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'tax_payment', metadata: { tax_type: 'ISS', reference_period: '2026-01' }, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-05T10:00:00Z', created_at: '2026-01-31T08:00:00Z', updated_at: '2026-02-05T10:00:00Z' },
  { id: 'le-007', entry_date: '2026-01-25', description: 'Aluguel escritório SP - Janeiro', amount_cents: 3500000, currency: 'BRL', category_id: 'cat-c21', cost_center_id: 'cc-admin-sp', business_unit_id: 'bu-sp', period_key: '2026-01', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-01-26T10:00:00Z', created_at: '2026-01-25T08:00:00Z', updated_at: '2026-01-26T10:00:00Z' },

  // ── 2026-02 ──
  { id: 'le-008', entry_date: '2026-02-15', description: 'NF Serviços - Contrato Petrobras FPSO P-80', amount_cents: 310000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-18T10:00:00Z', created_at: '2026-02-15T08:00:00Z', updated_at: '2026-02-18T10:00:00Z' },
  { id: 'le-009', entry_date: '2026-02-10', description: 'NF Serviços - Shell FPSO Mero', amount_cents: 180000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-2', contract_id: 'ctr-2', business_unit_id: 'bu-rj', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-12T10:00:00Z', created_at: '2026-02-10T08:00:00Z', updated_at: '2026-02-12T10:00:00Z' },
  { id: 'le-010', entry_date: '2026-02-05', description: 'Hotel Macaé - Fev técnicos', amount_cents: 6800000, currency: 'BRL', category_id: 'cat-b21', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-1', business_unit_id: 'bu-rj', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: 'hotel_per_diem', created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-02-07T10:00:00Z', created_at: '2026-02-05T08:00:00Z', updated_at: '2026-02-07T10:00:00Z' },
  { id: 'le-011', entry_date: '2026-02-28', description: 'Licenças software - Fevereiro', amount_cents: 1200000, currency: 'BRL', category_id: 'cat-c31', cost_center_id: 'cc-ti', business_unit_id: 'bu-sp', period_key: '2026-02', entry_type: 'actual', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2026-03-01T10:00:00Z', created_at: '2026-02-28T08:00:00Z', updated_at: '2026-03-01T10:00:00Z' },

  // ── 2026-03 (current — mixed statuses) ──
  { id: 'le-012', entry_date: '2026-03-01', description: 'NF Serviços - Contrato Petrobras FPSO P-80 Mar', amount_cents: 295000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', contract_id: 'ctr-1', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'actual', status: 'approved', source_system: 'manual', evidence_required: true, evidence_provided: true, created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-03-02T10:00:00Z', created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-02T10:00:00Z' },
  { id: 'le-013', entry_date: '2026-03-01', description: 'Hotel Comfort Macaé - Mar/26', amount_cents: 8200000, currency: 'BRL', category_id: 'cat-b21', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-1', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'actual', status: 'in_review', source_system: 'manual', evidence_required: true, evidence_provided: true, template_key: 'hotel_per_diem', created_by: CURRENT_USER, created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z' },
  { id: 'le-014', entry_date: '2026-03-01', description: 'Locação veículos Localiza - Mar', amount_cents: 4500000, currency: 'BRL', category_id: 'cat-b23', cost_center_id: 'cc-mob', project_id: 'proj-1', supplier_id: 'sup-3', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'actual', status: 'draft', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'vehicle_rental', created_by: CURRENT_USER, created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z' },
  { id: 'le-015', entry_date: '2026-03-01', description: 'EPIs e uniformes - equipe campo RJ', amount_cents: 1800000, currency: 'BRL', category_id: 'cat-b32', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', supplier_id: 'sup-6', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'actual', status: 'draft', source_system: 'manual', evidence_required: false, evidence_provided: false, template_key: 'material', created_by: CURRENT_USER, created_at: '2026-03-01T09:00:00Z', updated_at: '2026-03-01T09:00:00Z' },

  // ── Budget entries (2026-03) ──
  { id: 'le-b01', entry_date: '2026-03-01', description: 'Budget Receita Mar/26', amount_cents: 500000000, currency: 'BRL', category_id: 'cat-a11', cost_center_id: 'cc-eng-campo', project_id: 'proj-1', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'budget', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2025-12-15T10:00:00Z', created_at: '2025-12-15T10:00:00Z', updated_at: '2025-12-15T10:00:00Z' },
  { id: 'le-b02', entry_date: '2026-03-01', description: 'Budget COGS Mar/26', amount_cents: 320000000, currency: 'BRL', category_id: 'cat-b', cost_center_id: 'cc-eng-campo', business_unit_id: 'bu-rj', period_key: '2026-03', entry_type: 'budget', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2025-12-15T10:00:00Z', created_at: '2025-12-15T10:00:00Z', updated_at: '2025-12-15T10:00:00Z' },
  { id: 'le-b03', entry_date: '2026-03-01', description: 'Budget OPEX Mar/26', amount_cents: 85000000, currency: 'BRL', category_id: 'cat-c', cost_center_id: 'cc-admin-sp', business_unit_id: 'bu-sp', period_key: '2026-03', entry_type: 'budget', status: 'posted', source_system: 'manual', evidence_required: false, evidence_provided: false, created_by: CURRENT_USER, posted_by: CURRENT_USER, posted_at: '2025-12-15T10:00:00Z', created_at: '2025-12-15T10:00:00Z', updated_at: '2025-12-15T10:00:00Z' },
];

// ============================================================
// Mock Payroll Batches
// ============================================================

export const mockPayrollBatches: PayrollBatch[] = [
  { id: 'pb-2601-rj', period_key: '2026-01', business_unit_id: 'bu-rj', total_gross_cents: 42000000, total_charges_cents: 15120000, total_benefits_cents: 8400000, headcount: 35, status: 'posted', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-02-05T10:00:00Z', created_at: '2026-02-01T08:00:00Z', updated_at: '2026-02-05T10:00:00Z' },
  { id: 'pb-2601-sp', period_key: '2026-01', business_unit_id: 'bu-sp', total_gross_cents: 18000000, total_charges_cents: 6480000, total_benefits_cents: 3600000, headcount: 12, status: 'posted', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-02-05T10:00:00Z', created_at: '2026-02-01T08:00:00Z', updated_at: '2026-02-05T10:00:00Z' },
  { id: 'pb-2602-rj', period_key: '2026-02', business_unit_id: 'bu-rj', total_gross_cents: 44000000, total_charges_cents: 15840000, total_benefits_cents: 8800000, headcount: 37, status: 'posted', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-03-05T10:00:00Z', created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-05T10:00:00Z' },
  { id: 'pb-2602-sp', period_key: '2026-02', business_unit_id: 'bu-sp', total_gross_cents: 18500000, total_charges_cents: 6660000, total_benefits_cents: 3700000, headcount: 12, status: 'posted', source_system: 'manual', created_by: CURRENT_USER, approved_by: CURRENT_USER, approved_at: '2026-03-05T10:00:00Z', created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-05T10:00:00Z' },
  { id: 'pb-2603-rj', period_key: '2026-03', business_unit_id: 'bu-rj', total_gross_cents: 45000000, total_charges_cents: 16200000, total_benefits_cents: 9000000, headcount: 38, status: 'draft', source_system: 'manual', created_by: CURRENT_USER, created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z' },
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
