import { DeliberationStage, DeliberationStageType, DeliberationItem, VotingRuleSet } from '@/lib/types';

export type Committee = {
  id: string;
  name: string;
  code: 'BOARD' | 'HR' | 'FINANCE' | 'RND' | 'SALES' | 'RISK' | 'LEGAL';
};

export type DeliberationTemplate = {
  id: string;
  name: string;
  ownerCommitteeId: string;
  requiredFields: string[];
  defaultVotingRule: VotingRuleSet;
};

export const COMMITTEES: Committee[] = [
  { id: 'board', name: 'Conselho Executivo', code: 'BOARD' },
  { id: 'hr', name: 'Comitê de RH', code: 'HR' },
  { id: 'finance', name: 'Comitê Financeiro', code: 'FINANCE' },
  { id: 'rnd', name: 'Comitê de P&D', code: 'RND' },
  { id: 'sales', name: 'Comitê de Vendas', code: 'SALES' },
  { id: 'risk', name: 'Comitê de Riscos', code: 'RISK' },
  { id: 'legal', name: 'Comitê Jurídico', code: 'LEGAL' },
];

export const VOTING_RULES_BY_COMMITTEE: Record<string, VotingRuleSet> = {
  board: { quorumPercent: 75, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_yes', votingWindowHours: 72 },
  hr: { quorumPercent: 60, majorityType: 'simple_majority', tieBreakRule: 'chair_yes', votingWindowHours: 48 },
  finance: { quorumPercent: 66, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_no', votingWindowHours: 72 },
  rnd: { quorumPercent: 60, majorityType: 'simple_majority', tieBreakRule: 'chair_yes', votingWindowHours: 72 },
  sales: { quorumPercent: 60, majorityType: 'simple_majority', tieBreakRule: 'chair_yes', votingWindowHours: 48 },
  risk: { quorumPercent: 66, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_no', votingWindowHours: 48 },
  legal: { quorumPercent: 66, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_no', votingWindowHours: 48 },
};

export const DELIBERATION_TEMPLATES: DeliberationTemplate[] = [
  {
    id: 'HR_HIRING_APPROVAL',
    name: 'Aprovação de Contratação (RH)',
    ownerCommitteeId: 'hr',
    requiredFields: ['candidate_name', 'role', 'grade', 'compensation_package', 'budget_source', 'strategic_role'],
    defaultVotingRule: VOTING_RULES_BY_COMMITTEE.hr,
  },
  {
    id: 'HR_TERMINATION_APPROVAL',
    name: 'Aprovação de Desligamento (RH)',
    ownerCommitteeId: 'hr',
    requiredFields: ['employee_name', 'termination_reason', 'legal_risk_level', 'severance_impact', 'termination_sensitive'],
    defaultVotingRule: { quorumPercent: 70, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_yes', votingWindowHours: 24 },
  },
  {
    id: 'FINANCE_CAPEX_APPROVAL',
    name: 'Aprovação de CAPEX (Financeiro)',
    ownerCommitteeId: 'finance',
    requiredFields: ['investment_description', 'capex_value', 'roi_npv', 'funding_source', 'strategic_exception'],
    defaultVotingRule: VOTING_RULES_BY_COMMITTEE.finance,
  },
  {
    id: 'RND_INVESTMENT_APPROVAL',
    name: 'Aprovação de Investimento (P&D)',
    ownerCommitteeId: 'rnd',
    requiredFields: ['initiative', 'technical_rationale', 'capex_opex', 'security_criticality', 'ip_license_impact'],
    defaultVotingRule: VOTING_RULES_BY_COMMITTEE.rnd,
  },
  {
    id: 'SALES_PROJECT_APPROVAL',
    name: 'Aprovação de Projeto (Vendas)',
    ownerCommitteeId: 'sales',
    requiredFields: ['client_name', 'deal_value', 'margin_percent', 'payment_terms', 'special_clauses', 'client_risk'],
    defaultVotingRule: VOTING_RULES_BY_COMMITTEE.sales,
  },
  {
    id: 'RISK_EXCEPTION_APPROVAL',
    name: 'Aprovação de Exceção de Risco',
    ownerCommitteeId: 'risk',
    requiredFields: ['risk_statement', 'residual_risk', 'controls', 'regulatory_exposure', 'reputational_impact'],
    defaultVotingRule: VOTING_RULES_BY_COMMITTEE.risk,
  },
  {
    id: 'LEGAL_MATERIAL_DECISION',
    name: 'Decisão Jurídica Material',
    ownerCommitteeId: 'legal',
    requiredFields: ['matter_summary', 'legal_basis', 'regulatory_impact', 'financial_materiality', 'urgency'],
    defaultVotingRule: VOTING_RULES_BY_COMMITTEE.legal,
  },
];

export type RoutingInput = {
  ownerCommitteeId: string;
  financialImpact?: number;
  riskLevel?: DeliberationItem['riskLevel'];
  strategicFlag?: boolean;
  outsideBudget?: boolean;
  roleStrategic?: boolean;
  policyException?: boolean;
  atypicalContract?: boolean;
  technicalInvestment?: boolean;
  securityCriticality?: boolean;
  ipLicenseCriticality?: boolean;
  marginPercent?: number;
  aggressivePaymentTerms?: boolean;
  specialClauses?: boolean;
  penaltyExposure?: boolean;
  strategicClient?: boolean;
  highTicket?: boolean;
  regulatoryExposure?: boolean;
  materialFinancialImpact?: boolean;
  materialLegalSensitivity?: boolean;
};

const POLICY_THRESHOLDS = {
  hrFinanceThreshold: 500000,
  financeBoardCapexThreshold: 5000000,
  rndFinanceThreshold: 1000000,
  salesMarginThreshold: 20,
  salesBoardTicketThreshold: 4000000,
};

const committeeById = (committeeId: string): Committee => {
  return COMMITTEES.find((committee) => committee.id === committeeId) ?? COMMITTEES[0];
};

const makeStage = (
  sequence: number,
  stageType: DeliberationStageType,
  committeeId: string,
  required = true
): DeliberationStage => {
  const committee = committeeById(committeeId);
  return {
    id: `stage-${sequence}-${committeeId}`,
    sequence,
    stageType,
    committeeId: committee.id,
    committeeName: committee.name,
    status: sequence === 1 ? 'active' : 'pending',
    required,
    votingRule: VOTING_RULES_BY_COMMITTEE[committeeId] ?? VOTING_RULES_BY_COMMITTEE.board,
  };
};

export const resolveTemplate = (templateId?: string): DeliberationTemplate | undefined => {
  return DELIBERATION_TEMPLATES.find((template) => template.id === templateId);
};

export const computeDependentCommittees = (input: RoutingInput): string[] => {
  const deps = new Set<string>();

  if (input.ownerCommitteeId === 'hr') {
    if ((input.financialImpact ?? 0) > POLICY_THRESHOLDS.hrFinanceThreshold || input.outsideBudget) deps.add('finance');
    if (input.riskLevel === 'high' || input.riskLevel === 'critical') deps.add('legal');
  }

  if (input.ownerCommitteeId === 'finance') {
    if (input.atypicalContract) deps.add('legal');
    if (input.riskLevel === 'high' || input.riskLevel === 'critical') deps.add('risk');
    if (input.technicalInvestment) deps.add('rnd');
  }

  if (input.ownerCommitteeId === 'rnd') {
    if ((input.financialImpact ?? 0) > POLICY_THRESHOLDS.rndFinanceThreshold) deps.add('finance');
    if (input.securityCriticality || input.riskLevel === 'high' || input.riskLevel === 'critical') deps.add('risk');
    if (input.ipLicenseCriticality) deps.add('legal');
  }

  if (input.ownerCommitteeId === 'sales') {
    if ((input.marginPercent ?? 100) < POLICY_THRESHOLDS.salesMarginThreshold || input.aggressivePaymentTerms) deps.add('finance');
    if (input.specialClauses || input.penaltyExposure) deps.add('legal');
    if (input.riskLevel === 'high' || input.riskLevel === 'critical') deps.add('risk');
  }

  if (input.ownerCommitteeId === 'risk') {
    if (input.regulatoryExposure) deps.add('legal');
  }

  if (input.ownerCommitteeId === 'legal') {
    if (input.materialFinancialImpact) deps.add('finance');
  }

  return Array.from(deps);
};

export const boardRequired = (input: RoutingInput): boolean => {
  if (input.strategicFlag || input.roleStrategic || input.policyException || input.materialLegalSensitivity) return true;
  if (input.ownerCommitteeId === 'finance' && (input.financialImpact ?? 0) > POLICY_THRESHOLDS.financeBoardCapexThreshold) return true;
  if (input.ownerCommitteeId === 'sales' && (input.highTicket || input.strategicClient || (input.financialImpact ?? 0) > POLICY_THRESHOLDS.salesBoardTicketThreshold)) return true;
  if (input.ownerCommitteeId === 'risk' && input.riskLevel === 'critical') return true;
  return false;
};

export const buildStagePlan = (input: RoutingInput): DeliberationStage[] => {
  const dependent = computeDependentCommittees(input);
  const stagePlan: DeliberationStage[] = [makeStage(1, 'owner_review', input.ownerCommitteeId)];
  let sequence = 2;

  dependent.forEach((committeeId) => {
    stagePlan.push(makeStage(sequence, 'dependent_review', committeeId));
    sequence += 1;
  });

  if (boardRequired(input)) {
    stagePlan.push(makeStage(sequence, 'final_approval', 'board'));
    sequence += 1;
  }

  stagePlan.push(makeStage(sequence, 'publish_minutes', input.ownerCommitteeId));
  stagePlan.push(makeStage(sequence + 1, 'execution', input.ownerCommitteeId));
  return stagePlan;
};
