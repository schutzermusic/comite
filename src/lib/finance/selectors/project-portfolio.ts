/**
 * Portfolio-level project margin selector.
 *
 * Source of truth: project reference (src/data/finance/reference.ts) +
 * canonical ledger (mockLedgerEntries). Revenue / cost / forecast cost
 * are aggregated from ledger entries keyed by project_id; contracted
 * value comes from the linked contract reference; client name resolves
 * via the contract → client mapping.
 *
 * Narrative fields (health, risks) are not modeled in the ledger and
 * stay as portfolio metadata until those become first-class entities.
 */

import type { LedgerEntry } from '@/lib/types/finance';
import { mockLedgerEntries } from '@/data/finance/mock-ledger';
import { managementCategories } from '@/data/finance/seed-categories';
import { projects, contracts as contractRefs, type ProjectRef } from '@/data/finance/reference';
import type { FinanceStatus } from '@/components/finance/shared';
import { isProjectCostEntry, isProjectActualCost, isProjectActualRevenue } from './project-allocation';

export interface ProjectPortfolioRow {
  id: string;
  code: string;
  name: string;
  client: string;
  status: FinanceStatus;
  health: number;
  contracted: number;
  invoiced: number;
  cost: number;
  forecastCost: number;
  risks: string[];
}

interface PortfolioMetadata {
  health: number;
  risks: string[];
}

/**
 * Per-project narrative metadata. Keyed by reference project id. Cannot be
 * derived from the ledger; would normally come from a project-mgmt system.
 */
const PROJECT_METADATA: Record<string, PortfolioMetadata> = {
  'proj-1': { health: 88, risks: ['Escopo aditivo em discussão'] },
  'proj-2': { health: 62, risks: ['Mobilização extra', 'Penalidade contratual', 'Schedule slip Q2'] },
  'proj-3': { health: 71, risks: ['Aguardando aprovação técnica'] },
  'proj-4': { health: 94, risks: [] },
  'proj-5': { health: 91, risks: [] },
};

function statusToFinanceStatus(s: ProjectRef['status']): FinanceStatus {
  return s === 'at_risk' ? 'at_risk'
       : s === 'paused' ? 'pending'
       : s === 'completed' ? 'completed'
       : 'active';
}

export function selectProjectsPortfolio(
  entries: LedgerEntry[] = mockLedgerEntries,
  refs: ProjectRef[] = projects,
): ProjectPortfolioRow[] {
  // Group revenue & cogs by project
  const revByProject = new Map<string, number>();
  const costByProject = new Map<string, number>();
  const fcstCostByProject = new Map<string, number>();
  const invoicedByProject = new Map<string, number>();

  for (const e of entries) {
    if (!e.project_id || e.status === 'void') continue;
    const cat = managementCategories.find(c => c.id === e.category_id);
    if (!cat) continue;
    const signedReais = (e.amount_cents * cat.sign) / 100;
    // Realized revenue: only posted/reconciled actual revenue (shared rule),
    // identical to FinanceView. Clearing cash-in is never counted here.
    if (isProjectActualRevenue(e)) {
      revByProject.set(e.project_id, (revByProject.get(e.project_id) ?? 0) + signedReais);
      invoicedByProject.set(e.project_id, (invoicedByProject.get(e.project_id) ?? 0) + signedReais);
    }
    // Unified project-cost rule: ALL project-attributable P&L cost (COGS +
    // payroll + OPEX + financial + taxes), never clearing. Shared with the
    // project detail FinanceView so both surfaces agree.
    if (isProjectActualCost(e)) {
      costByProject.set(e.project_id, (costByProject.get(e.project_id) ?? 0) + Math.abs(signedReais));
    }
    if (isProjectCostEntry(e) && e.entry_type === 'forecast') {
      fcstCostByProject.set(e.project_id, (fcstCostByProject.get(e.project_id) ?? 0) + Math.abs(signedReais));
    }
  }

  return refs.map(p => {
    const contract = p.contract_id ? contractRefs.find(c => c.id === p.contract_id) : undefined;
    const contracted = contract ? contract.total_value_cents / 100 : (revByProject.get(p.id) ?? 0) * 4;
    const meta = PROJECT_METADATA[p.id] ?? { health: 75, risks: [] };
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      client: contract?.client_name ?? '—',
      status: statusToFinanceStatus(p.status),
      health: meta.health,
      contracted,
      invoiced: invoicedByProject.get(p.id) ?? 0,
      cost: costByProject.get(p.id) ?? 0,
      forecastCost: fcstCostByProject.get(p.id) ?? costByProject.get(p.id) ?? 0,
      risks: meta.risks,
    } satisfies ProjectPortfolioRow;
  });
}

export const PROJECTS_PORTFOLIO: ProjectPortfolioRow[] = selectProjectsPortfolio();
