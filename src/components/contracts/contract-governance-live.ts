'use client';

/**
 * Phase 2 — live governance merge layer.
 *
 * `enrichContractsForGovernance` (contract-governance-data.ts) fabricates a full
 * governance preview from each contract's own columns. This layer takes those
 * mock records plus a batched read of the real migration-034 relation tables
 * (see `fetchContractRelationsBatch`) and, per contract per section, overrides
 * the mock with live data when real rows exist. Sections without live rows keep
 * the mock preview and are flagged `estimated`, so the Control Room never goes
 * blank and never presents an estimate as official (each section carries its own
 * `dataQuality`). This is read-only wiring; mutations live in contract-service.
 */

import type { Project } from '@/lib/types';
import type {
  ContractRelationsBatch,
  ContractObligationRow,
  ContractBillingEventRow,
  ContractApprovalRow,
} from '@/lib/contracts/contract-service';
import type {
  ContractGovernanceRecord,
  ContractGovernanceDataQuality,
  ContractObligation,
  LinkedBillingEvent,
  LinkedRisk,
} from './contract-governance-data';

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const BILLED_STATUSES = new Set(['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado']);
function isBilled(row: ContractBillingEventRow): boolean {
  if (row.paid_at) return true;
  return BILLED_STATUSES.has((row.status ?? '').toLowerCase());
}

function mapObligation(row: ContractObligationRow, now: Date): ContractObligation {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner_user_id ? 'Responsável vinculado' : 'Não atribuído',
    dueDate: toDate(row.due_date) ?? now,
    status: row.status,
    evidence: row.evidence ?? '—',
  };
}

function mapBillingEvent(row: ContractBillingEventRow): LinkedBillingEvent {
  return {
    id: row.id,
    title: row.title,
    amount: toNumber(row.amount),
    due_date: toDate(row.due_date),
    status: row.status,
    paid_at: toDate(row.paid_at),
  };
}

const STEP_LABELS: Record<string, string> = {
  juridico: 'Jurídico',
  financeiro: 'Financeiro',
  comite: 'Comitê',
  diretoria: 'Diretoria',
};

function mapLegalStatus(status: ContractApprovalRow['status'] | undefined): ContractGovernanceRecord['legalStatus'] {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'pending';
  return 'review';
}

function mapFinancialStatus(status: ContractApprovalRow['status'] | undefined): ContractGovernanceRecord['financialStatus'] {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'blocked';
  return 'attention';
}

function mapRiskStatus(status: string | undefined): LinkedRisk['status'] {
  if (status === 'resolved') return 'resolved';
  if (status === 'mitigating') return 'mitigating';
  return 'open';
}

function mapAiStatus(status: string | undefined, fallback: ContractGovernanceRecord['aiStatus']): ContractGovernanceRecord['aiStatus'] {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
      return 'mock_ready';
    case 'manual_review':
    case 'failed':
      return 'manual_review';
    case 'pending':
    case 'processing':
    case 'not_started':
      return 'mock_pending';
    default:
      return fallback;
  }
}

function extractConfidence(extracted: Record<string, unknown> | null | undefined): number | null {
  if (!extracted) return null;
  const raw = extracted.confidence ?? extracted.confidence_score;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return null;
  // Accept either 0–1 or 0–100 and normalize to a percentage.
  return parsed <= 1 ? Math.round(parsed * 100) : Math.round(parsed);
}

/**
 * Merge live relation rows into mock governance records. Pure and defensive:
 * any contract with no live rows for a section is returned unchanged for that
 * section, flagged `estimated`.
 */
export function applyLiveGovernanceData(
  records: ContractGovernanceRecord[],
  batch: ContractRelationsBatch,
  projects: Project[],
  now: Date = new Date(),
): ContractGovernanceRecord[] {
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  return records.map((record) => {
    const id = record.contract.id;

    // Obligations
    const oblRows = batch.obligations.get(id) ?? [];
    const obligationsLive = oblRows.length > 0;
    const obligations = obligationsLive ? oblRows.map((row) => mapObligation(row, now)) : record.obligations;

    // Billing events + recomputed financials
    const billRows = batch.billingEvents.get(id) ?? [];
    const billingLive = billRows.length > 0;
    const billingEvents = billingLive ? billRows.map(mapBillingEvent) : record.billingEvents;
    let billedValue = record.billedValue;
    let remainingValue = record.remainingValue;
    if (billingLive) {
      billedValue = billRows.reduce((sum, row) => sum + (isBilled(row) ? toNumber(row.amount) : 0), 0);
      remainingValue = Math.max(record.totalValue - billedValue, 0);
    }

    // Documents → missing set
    const docRows = batch.documents.get(id) ?? [];
    const documentsLive = docRows.length > 0;
    const missingDocuments = documentsLive
      ? docRows.filter((doc) => doc.status === 'missing' || doc.status === 'expired' || doc.status === 'rejected').map((doc) => doc.title)
      : record.missingDocuments;

    // Approvals → legal/financial status + route
    const aprRows = batch.approvals.get(id) ?? [];
    const approvalsLive = aprRows.length > 0;
    let legalStatus = record.legalStatus;
    let financialStatus = record.financialStatus;
    let approvalRoute = record.approvalRoute;
    if (approvalsLive) {
      const juridico = aprRows.find((step) => step.step_name === 'juridico');
      const financeiro = aprRows.find((step) => step.step_name === 'financeiro');
      if (juridico) legalStatus = mapLegalStatus(juridico.status);
      if (financeiro) financialStatus = mapFinancialStatus(financeiro.status);
      const order = ['juridico', 'financeiro', 'comite', 'diretoria'];
      approvalRoute = aprRows
        .slice()
        .sort((a, b) => order.indexOf(a.step_name) - order.indexOf(b.step_name))
        .map((step) => STEP_LABELS[step.step_name] ?? step.step_name)
        .join(' + ') || record.approvalRoute;
    }

    // Project links
    const linkRows = batch.projectLinks.get(id) ?? [];
    let project = record.project;
    let linkedProjects = record.linkedProjects;
    let projectReference = record.projectReference;
    let financialAllocationsPending = record.financialAllocationsPending;
    const resolvedLinks = linkRows.map((link) => projectMap.get(link.project_id)).filter((value): value is Project => Boolean(value));
    const projectLinkLive = resolvedLinks.length > 0;
    if (projectLinkLive) {
      linkedProjects = resolvedLinks;
      project = record.project ?? resolvedLinks[0];
      projectReference = project ? `${project.codigo} · ${project.nome}` : record.projectReference;
      financialAllocationsPending = false;
    }

    // Risk links
    const rlkRows = batch.riskLinks.get(id) ?? [];
    const risksLive = rlkRows.length > 0;
    const linkedRisks: LinkedRisk[] = risksLive
      ? rlkRows.map((link) => {
          const detail = batch.riskDetails.get(link.risk_id);
          return {
            id: link.risk_id,
            title: detail?.title ?? 'Risco vinculado',
            category: detail?.category ?? 'Geral',
            riskScore: detail ? Math.round((detail.level / 25) * 100) : record.riskScore,
            status: mapRiskStatus(detail?.status),
            severity: detail?.severity ?? 'medium',
            mitigationPlan: detail?.mitigationPlan ?? null,
          };
        })
      : record.linkedRisks;

    // AI analysis
    const aiRows = batch.aiAnalyses.get(id) ?? [];
    const aiLive = aiRows.length > 0;
    let aiStatus = record.aiStatus;
    let confidenceScore = record.confidenceScore;
    if (aiLive) {
      const active = aiRows.find((row) => row.status === 'completed') ?? aiRows[0];
      aiStatus = mapAiStatus(active.status, record.aiStatus);
      const conf = extractConfidence(active.extracted_data);
      if (conf != null) confidenceScore = conf;
    }

    const dataQuality: ContractGovernanceDataQuality = {
      obligations: obligationsLive ? 'live' : 'estimated',
      billing: billingLive ? 'live' : 'estimated',
      documents: documentsLive ? 'live' : 'estimated',
      approvals: approvalsLive ? 'live' : 'estimated',
      projectLink: projectLinkLive ? 'live' : 'estimated',
      risks: risksLive ? 'live' : 'estimated',
      ai: aiLive ? 'live' : 'estimated',
    };

    return {
      ...record,
      project,
      projectReference,
      linkedProjects,
      billedValue,
      remainingValue,
      missingDocuments,
      obligations,
      billingEvents,
      linkedRisks,
      legalStatus,
      financialStatus,
      approvalRoute,
      aiStatus,
      confidenceScore,
      financialAllocationsPending,
      dataQuality,
      liveApprovals: approvalsLive ? aprRows : undefined,
      liveDocuments: documentsLive ? docRows : undefined,
    };
  });
}

/** Count of relation sections that returned at least one live row (for the page-level source indicator). */
export function countLiveSections(batch: ContractRelationsBatch): { live: number; total: number } {
  const flags = Object.values(batch.sectionsWithData);
  return { live: flags.filter(Boolean).length, total: flags.length };
}
