/**
 * Finance reference (dimensional) data.
 *
 * These tables hold non-monetary attributes (names, contract terms,
 * scenario definitions, cost-center owners, headcount). They live next
 * to the canonical seed-categories so all dimensional joins resolve from
 * the same place.
 *
 * Money never lives here — all monetary aggregates derive from the
 * canonical ledger (mock-ledger.ts) via the selectors layer.
 */

import type { FinanceScenarioKey } from '@/lib/types/finance';

// ============================================================
// Projects
// ============================================================

export interface ProjectRef {
  id: string;
  code: string;
  name: string;
  client_id?: string;
  contract_id?: string;
  status: 'active' | 'at_risk' | 'completed' | 'paused';
}

export const projects: ProjectRef[] = [
  { id: 'proj-1', code: 'PRJ-2025-001', name: 'Petrobras FPSO P-80',     client_id: 'cli-1', contract_id: 'ctr-1', status: 'active'  },
  { id: 'proj-2', code: 'PRJ-2025-002', name: 'Shell FPSO Mero',         client_id: 'cli-2', contract_id: 'ctr-2', status: 'active'  },
  { id: 'proj-3', code: 'PRJ-2025-003', name: 'Equinor Bacalhau',        client_id: 'cli-3', contract_id: 'ctr-3', status: 'at_risk' },
  { id: 'proj-4', code: 'PRJ-2026-001', name: 'Eneva GNL Parnaíba',      client_id: 'cli-4', contract_id: 'ctr-4', status: 'active'  },
  { id: 'proj-5', code: 'PRJ-2026-002', name: 'Mineração Vale Sul',                                              contract_id: 'ctr-5', status: 'active'  },
  { id: 'proj-cemig', code: 'CEMIG-MOD-01', name: 'UHE São Clemente — CEMIG', client_id: 'cli-cemig', contract_id: 'ctr-cemig', status: 'at_risk' },
];

// ============================================================
// Contracts
// ============================================================

export type ContractType = 'recurring' | 'fixed' | 'usage';

export interface ContractRef {
  id: string;
  code: string;
  client_id: string;
  client_name: string;
  type: ContractType;
  /** Total contracted value (cents) — used as backlog ceiling. */
  total_value_cents: number;
  /** Monthly recurring revenue ceiling (cents). 0 for fixed/usage. */
  mrr_cents: number;
  start_date: string;
  end_date: string;
  status: 'active' | 'at_risk' | 'pending' | 'completed';
}

export const contracts: ContractRef[] = [
  { id: 'ctr-1', code: 'CT-2025-014', client_id: 'cli-1', client_name: 'Petrobras',       type: 'recurring', total_value_cents: 4_416_000_00, mrr_cents:   368_000_00, start_date: '2025-08-01', end_date: '2027-07-31', status: 'active'    },
  { id: 'ctr-2', code: 'CT-2025-021', client_id: 'cli-2', client_name: 'Shell Brasil',    type: 'fixed',     total_value_cents: 3_180_000_00, mrr_cents:           0, start_date: '2025-10-15', end_date: '2026-10-14', status: 'at_risk'   },
  { id: 'ctr-3', code: 'CT-2026-003', client_id: 'cli-3', client_name: 'Equinor Brasil',  type: 'recurring', total_value_cents: 1_104_000_00, mrr_cents:    92_000_00, start_date: '2026-01-01', end_date: '2028-12-31', status: 'active'    },
  { id: 'ctr-4', code: 'CT-2026-009', client_id: 'cli-4', client_name: 'Eneva',           type: 'usage',     total_value_cents:   462_000_00, mrr_cents:    38_500_00, start_date: '2026-02-01', end_date: '2027-01-31', status: 'pending'   },
  { id: 'ctr-5', code: 'CT-2025-098', client_id: 'cli-2', client_name: 'Mineração Vale Sul', type: 'fixed',  total_value_cents: 5_750_000_00, mrr_cents:           0, start_date: '2024-11-01', end_date: '2026-10-31', status: 'active'    },
  { id: 'ctr-6', code: 'CT-2024-122', client_id: 'cli-3', client_name: 'OrionTech',       type: 'recurring', total_value_cents:   324_000_00, mrr_cents:    27_000_00, start_date: '2024-04-01', end_date: '2025-03-31', status: 'completed' },
  { id: 'ctr-cemig', code: 'OS 201067.0', client_id: 'cli-cemig', client_name: 'CEMIG', type: 'fixed', total_value_cents: 198_827_691_78, mrr_cents: 0, start_date: '2024-07-01', end_date: '2030-03-31', status: 'at_risk' },
];

// ============================================================
// Cost Center display attributes
// ============================================================

export interface CostCenterRef {
  id: string;
  director: string;
  headcount: number;
}

export const costCenterRefs: CostCenterRef[] = [
  { id: 'cc-eng-campo',  director: 'Carla Mendes',     headcount: 84 },
  { id: 'cc-manut',      director: 'Felipe Araújo',    headcount: 62 },
  { id: 'cc-mob',        director: 'Renata Souza',     headcount: 38 },
  { id: 'cc-admin-sp',   director: 'Beatriz Tavares',  headcount: 18 },
  { id: 'cc-ti',         director: 'Diego Lopes',      headcount: 24 },
  { id: 'cc-rh',         director: 'Patrícia Lemos',   headcount:  9 },
  { id: 'cc-comercial',  director: 'Henrique Vidal',   headcount: 11 },
  { id: 'cc-financeiro', director: 'Beatriz Tavares',  headcount:  6 },
];

// ============================================================
// Forecast scenarios — dimensional definition (names, owners,
// status). Monetary aggregates derive from ledger by scenario key.
// ============================================================

export interface ScenarioRef {
  id: string;
  key: FinanceScenarioKey;
  name: string;
  owner: string;
  status: 'closed' | 'approved' | 'review' | 'draft';
  /** Updated-at ISO string for display. */
  updated: string;
  /** Multiplier applied to baseline (forecast) numbers to project the scenario. */
  multiplier: number;
}

export const scenarios: ScenarioRef[] = [
  { id: 'real', key: 'realized',   name: 'Realizado YTD',           owner: 'CFO Office', status: 'closed',   updated: '2026-04-30', multiplier: 1     },
  { id: 'bud',  key: 'budget',     name: 'Orçado 2026',             owner: 'FP&A',       status: 'approved', updated: '2025-12-15', multiplier: 1     },
  { id: 'fcst', key: 'forecast',   name: 'Projeção Rolling 12m',    owner: 'FP&A',       status: 'review',   updated: '2026-04-28', multiplier: 1     },
  { id: 'str',  key: 'stress',     name: 'Cenário de Estresse (–12%)', owner: 'Risco',  status: 'draft',    updated: '2026-04-22', multiplier: 0.88  },
  { id: 'opt',  key: 'optimistic', name: 'Cenário Otimista (+8%)',  owner: 'CRO',        status: 'draft',    updated: '2026-04-22', multiplier: 1.08  },
  { id: 'brd',  key: 'board',      name: 'Aprovado pelo Conselho',  owner: 'Conselho',   status: 'approved', updated: '2025-12-20', multiplier: 0.985 },
];

// ============================================================
// Collaborators (people who incur logistics / mobilization cost)
// ----------------------------------------------------------------
// Dimensional master data only (no money). Logistics ledger entries
// attribute their spend to a collaborator via metadata.collaborator_id;
// the selectors resolve the display name from here (falling back to the
// name embedded on the entry). Ids reuse the payroll employee ids where
// the same person also appears in folha, plus field crew that only show
// up in mobilization spend.
// ============================================================

export interface CollaboratorRef {
  id: string;
  name: string;
  role?: string;
  /** Home department. */
  department?: string;
}

export const collaborators: CollaboratorRef[] = [
  { id: 'emp-006', name: 'Marcos Pereira',  role: 'Field Coordinator', department: 'Mobilização' },
  { id: 'emp-001', name: 'Carla Mendes',    role: 'Eng. Manager',      department: 'Engenharia'  },
  { id: 'emp-004', name: 'Diego Lopes',     role: 'Senior Engineer',   department: 'Manutenção'  },
  { id: 'emp-002', name: 'Felipe Araújo',   role: 'Tech Lead',         department: 'Engenharia'  },
  { id: 'emp-101', name: 'João Batista',    role: 'Field Technician',  department: 'Mobilização' },
  { id: 'emp-102', name: 'Sandra Lima',     role: 'Field Technician',  department: 'Mobilização' },
  { id: 'emp-103', name: 'Rogério Alves',   role: 'Logistics Analyst', department: 'Mobilização' },
];

export function findCollaborator(id: string | undefined) {
  return id ? collaborators.find(c => c.id === id) : undefined;
}

// Convenience lookups
export function findContract(id: string | undefined) {
  return id ? contracts.find(c => c.id === id) : undefined;
}
export function findProject(id: string | undefined) {
  return id ? projects.find(p => p.id === id) : undefined;
}
export function findCostCenterRef(id: string | undefined) {
  return id ? costCenterRefs.find(c => c.id === id) : undefined;
}
export function findScenario(idOrKey: string) {
  return scenarios.find(s => s.id === idOrKey || s.key === idOrKey);
}
