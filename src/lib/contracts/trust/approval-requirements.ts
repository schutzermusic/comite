/**
 * Requisitos de aprovação GOVERNADOS pelo contrato — não pedidos fabricados.
 *
 * A aba global de Aprovações lia só `contract_approvals` (rota de alçada do
 * instrumento). Em JA10182283/2025 isso produzia "nada pendente": zero rotas
 * legadas, enquanto o contrato exige aceite do cliente em cada medição e
 * aceite técnico como condição de pagamento.
 *
 * Este módulo lê as FONTES canônicas do requisito:
 *   · `contract_billing_conditions` com tipos de aprovação/aceite
 *   · `contract_measurement_requirements` com `customer_acceptance_required`
 *
 * e cruza com o que já foi INSTANCIADO:
 *   · rota legada (`contract_approvals`)
 *   · pedido no motor compartilhado (`approval_request_read_model`)
 *   · aceite já registrado no marco (via bancada, quando disponível)
 *
 * Sem rota e sem pedido → "Configuração pendente / aprovação requerida".
 * Nunca inventa um evento de aprovação.
 */

import type {
  ContractBillingConditionRow,
  ContractMeasurementRequirementRow,
} from '../structured-contract-types';
import type { MilestoneWorkbenchRow } from '../measurement/milestone-workbench-types';
import type { ContractApprovalRow } from '../contract-service';
import type { ApprovalRequestView } from '@/lib/platform/approvals/types';

/** Tipos de condição de faturamento que SÃO exigências de aprovação/aceite. */
export const APPROVAL_CONDITION_TYPES = [
  'customer_approval_required',
  'technical_acceptance_required',
  'measurement_accepted',
] as const;

export type ApprovalConditionType = (typeof APPROVAL_CONDITION_TYPES)[number];

export const APPROVAL_CONDITION_LABEL: Record<ApprovalConditionType, string> = {
  customer_approval_required: 'Aprovação do cliente',
  technical_acceptance_required: 'Aceite técnico',
  measurement_accepted: 'Aceite do boletim de medição',
};

export type ApprovalRequirementState =
  | 'pending_configuration'
  | 'awaiting_decision'
  | 'approved'
  | 'rejected'
  | 'satisfied';

export const APPROVAL_REQUIREMENT_STATE_LABEL: Record<ApprovalRequirementState, string> = {
  pending_configuration: 'Configuração pendente / aprovação requerida',
  awaiting_decision: 'Aguardando decisão humana',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  satisfied: 'Cumprido no marco',
};

export type ApprovalRequirementKind =
  | 'billing_condition'
  | 'measurement_acceptance'
  | 'contract_route';

export type PortfolioApprovalRequirement = {
  readonly id: string;
  readonly kind: ApprovalRequirementKind;
  readonly contractId: string;
  readonly contractCode: string;
  readonly title: string;
  readonly requirementLabel: string;
  readonly state: ApprovalRequirementState;
  readonly authority: string | null;
  readonly milestoneId: string | null;
  readonly milestoneTitle: string | null;
  readonly relatedObligation: string | null;
  readonly sourcePage: number | null;
  readonly sourceExcerpt: string | null;
  readonly provenance: string;
};

export type PortfolioApprovalRequirements = {
  readonly requirements: readonly PortfolioApprovalRequirement[];
  readonly pendingConfigurationCount: number;
  readonly awaitingDecisionCount: number;
  readonly coverage: { readonly contractsWithRequirements: number; readonly totalContracts: number };
};

const APPROVAL_TYPE_SET = new Set<string>(APPROVAL_CONDITION_TYPES);

function isApprovalConditionType(value: string | null): value is ApprovalConditionType {
  return value !== null && APPROVAL_TYPE_SET.has(value);
}

function routeState(rows: readonly ContractApprovalRow[]): ApprovalRequirementState | null {
  if (rows.length === 0) return null;
  if (rows.some((r) => r.status === 'rejected')) return 'rejected';
  if (rows.every((r) => r.status === 'approved')) return 'approved';
  if (rows.some((r) => r.status === 'pending' || r.status === 'under_review')) {
    return 'awaiting_decision';
  }
  return 'pending_configuration';
}

function sharedRequestState(
  requests: readonly ApprovalRequestView[],
): ApprovalRequirementState | null {
  if (requests.length === 0) return null;
  const open = requests.filter((r) =>
    r.status === 'PENDING' || r.status === 'RETURNED_FOR_CORRECTION');
  if (open.length > 0) return 'awaiting_decision';
  if (requests.some((r) => r.status === 'REJECTED')) return 'rejected';
  if (requests.some((r) => r.status === 'APPROVED')) return 'approved';
  return 'pending_configuration';
}

function milestoneAcceptanceState(
  milestone: MilestoneWorkbenchRow | undefined,
): ApprovalRequirementState | null {
  if (!milestone) return null;
  if (milestone.measurementStatus === 'ACCEPTED' || milestone.measurementAcceptedAt) {
    return 'satisfied';
  }
  if (milestone.measurementStatus === 'REJECTED') return 'rejected';
  if (milestone.measurementStatus === 'SUBMITTED' || milestone.measurementStatus === 'UNDER_REVIEW') {
    return 'awaiting_decision';
  }
  return null;
}

export type ApprovalRequirementsInput = {
  readonly contracts: readonly {
    readonly id: string;
    readonly code: string;
    readonly title: string;
  }[];
  readonly billingConditions: readonly ContractBillingConditionRow[];
  readonly measurementRequirements: readonly ContractMeasurementRequirementRow[];
  readonly legacyApprovalsByContract: ReadonlyMap<string, readonly ContractApprovalRow[]>;
  readonly sharedRequestsByContract: ReadonlyMap<string, readonly ApprovalRequestView[]>;
  readonly milestonesByContract: ReadonlyMap<string, readonly MilestoneWorkbenchRow[]>;
};

/**
 * Agrega requisitos governados do recorte.
 *
 * Contrato sem requisito de aprovação/aceite NÃO entra — ausência de exigência
 * não é "configuração pendente". Contrato COM exigência e SEM fluxo aparece
 * como configuração pendente.
 */
export function buildPortfolioApprovalRequirements(
  input: ApprovalRequirementsInput,
): PortfolioApprovalRequirements {
  const byId = new Map(input.contracts.map((c) => [c.id, c]));
  const requirements: PortfolioApprovalRequirement[] = [];
  const contractsWithRequirements = new Set<string>();

  for (const condition of input.billingConditions) {
    if (!isApprovalConditionType(condition.condition_type)) continue;
    const contract = byId.get(condition.contract_id);
    if (!contract) continue;
    contractsWithRequirements.add(contract.id);

    const legacy = input.legacyApprovalsByContract.get(contract.id) ?? [];
    const shared = input.sharedRequestsByContract.get(contract.id) ?? [];
    const milestones = input.milestonesByContract.get(contract.id) ?? [];
    const linkedMilestone = condition.milestone_id
      ? milestones.find((m) => m.id === condition.milestone_id)
      : undefined;

    const state =
      milestoneAcceptanceState(linkedMilestone)
      ?? sharedRequestState(shared)
      ?? routeState(legacy)
      ?? 'pending_configuration';

    requirements.push({
      id: `bc-${condition.id}`,
      kind: 'billing_condition',
      contractId: contract.id,
      contractCode: contract.code,
      title: condition.title,
      requirementLabel: APPROVAL_CONDITION_LABEL[condition.condition_type],
      state,
      authority: null,
      milestoneId: condition.milestone_id,
      milestoneTitle: linkedMilestone?.title ?? null,
      relatedObligation: condition.requirement_text,
      sourcePage: condition.source_page,
      sourceExcerpt: null,
      provenance: 'contract_billing_conditions',
    });
  }

  for (const requirement of input.measurementRequirements) {
    if (requirement.customer_acceptance_required !== true) continue;
    const contract = byId.get(requirement.contract_id);
    if (!contract) continue;
    contractsWithRequirements.add(contract.id);

    const milestones = input.milestonesByContract.get(contract.id) ?? [];
    const linkedMilestone = requirement.milestone_id
      ? milestones.find((m) => m.id === requirement.milestone_id)
      : undefined;
    const legacy = input.legacyApprovalsByContract.get(contract.id) ?? [];
    const shared = input.sharedRequestsByContract.get(contract.id) ?? [];

    const state =
      milestoneAcceptanceState(linkedMilestone)
      ?? sharedRequestState(shared)
      ?? routeState(legacy)
      ?? 'pending_configuration';

    requirements.push({
      id: `mr-${requirement.id}`,
      kind: 'measurement_acceptance',
      contractId: contract.id,
      contractCode: contract.code,
      title: requirement.title,
      requirementLabel: 'Aceite do cliente na medição',
      state,
      authority: null,
      milestoneId: requirement.milestone_id,
      milestoneTitle: linkedMilestone?.title ?? null,
      relatedObligation: requirement.required_document_type,
      sourcePage: requirement.source_page,
      sourceExcerpt: null,
      provenance: 'contract_measurement_requirements',
    });
  }

  const rank: Record<ApprovalRequirementState, number> = {
    pending_configuration: 0,
    awaiting_decision: 1,
    rejected: 2,
    satisfied: 3,
    approved: 4,
  };

  requirements.sort((a, b) =>
    rank[a.state] - rank[b.state]
    || a.contractCode.localeCompare(b.contractCode, 'pt-BR')
    || a.title.localeCompare(b.title, 'pt-BR'));

  return {
    requirements,
    pendingConfigurationCount: requirements.filter((r) => r.state === 'pending_configuration').length,
    awaitingDecisionCount: requirements.filter((r) => r.state === 'awaiting_decision').length,
    coverage: {
      contractsWithRequirements: contractsWithRequirements.size,
      totalContracts: input.contracts.length,
    },
  };
}
