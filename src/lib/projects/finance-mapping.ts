/**
 * ProjectV2 ↔ Finance ledger mapping.
 *
 * Project financial numbers come from the unified Finance ledger filtered by a
 * finance project id (proj-1…proj-5). ProjectV2 records use their own ids
 * (proj-001…) and contract ids (contract-…), so this resolver bridges them in
 * a deterministic, auditable order. Keeping the rule in one place means the
 * project detail FinanceView, data-quality scanner and any future Supabase
 * importer all resolve identically.
 */

import { projects as financeProjects } from '@/data/finance/reference';

/** Minimal shape needed to resolve a finance mapping (ProjectV2-compatible). */
export interface MappableProject {
  finance_project_id?: string;
  contract_id?: string;
  code?: string;
}

/**
 * Fallback map: ProjectV2 contract id → finance ledger project id. Used only
 * when a record has no explicit finance_project_id. Extend here when new
 * ProjectV2 contracts are onboarded before they carry an explicit link.
 */
export const CONTRACT_TO_FINANCE_PROJECT: Record<string, string> = {
  'contract-petrobras-p80': 'proj-1',
  'contract-enel-001': 'proj-4',
  // contract-cemig-001: investor data comes from the CEMIG totalizer overlay, not the ledger.
};

const financeProjectExists = (id: string | undefined): id is string =>
  !!id && financeProjects.some(p => p.id === id);

export type FinanceMappingSource = 'explicit' | 'contract_fallback' | 'code_match' | 'none';

export interface FinanceMappingResult {
  /** Resolved finance ledger project id, or undefined when unmapped. */
  financeProjectId?: string;
  /** Which rule resolved it (for audit / data quality). */
  source: FinanceMappingSource;
}

/**
 * Resolve the finance ledger project id for a ProjectV2 record, in priority:
 *   1. explicit project.finance_project_id (validated against the ledger)
 *   2. contract fallback table
 *   3. code match (project.code === finance project code, when present)
 * Returns source='none' when nothing resolves (caller shows "sem vínculo").
 */
export function resolveFinanceMapping(project: MappableProject): FinanceMappingResult {
  if (financeProjectExists(project.finance_project_id)) {
    return { financeProjectId: project.finance_project_id, source: 'explicit' };
  }
  const byContract = project.contract_id ? CONTRACT_TO_FINANCE_PROJECT[project.contract_id] : undefined;
  if (financeProjectExists(byContract)) {
    return { financeProjectId: byContract, source: 'contract_fallback' };
  }
  if (project.code) {
    const match = financeProjects.find(p => p.code === project.code);
    if (match) return { financeProjectId: match.id, source: 'code_match' };
  }
  return { source: 'none' };
}

/** Convenience: just the id (undefined when unmapped). */
export function resolveFinanceProjectId(project: MappableProject): string | undefined {
  return resolveFinanceMapping(project).financeProjectId;
}

/** Ids of project records that cannot be mapped to a finance project. */
export function selectProjectsWithoutFinanceMapping<T extends MappableProject & { id: string }>(projects: T[]): string[] {
  return projects.filter(p => resolveFinanceMapping(p).source === 'none').map(p => p.id);
}
