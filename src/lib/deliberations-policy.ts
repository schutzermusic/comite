import { DeliberationStage, DeliberationStageType, DeliberationItem, VotingRuleSet, MajorityType } from '@/lib/types';

export type Committee = {
  id: string;
  name: string;
  code: 'BOARD' | 'HR' | 'FINANCE' | 'RND' | 'SALES' | 'RISK' | 'LEGAL' | 'OPS';
  /** Assentos com direito a voto — usado para estimar votantes esperados e quórum absoluto. */
  seats: number;
};

export type DeliberationTemplate = {
  id: string;
  name: string;
  ownerCommitteeId: string;
  requiredFields: string[];
  defaultVotingRule: VotingRuleSet;
};

export const COMMITTEES: Committee[] = [
  { id: 'board', name: 'Diretoria Executiva', code: 'BOARD', seats: 7 },
  { id: 'hr', name: 'Comitê de RH', code: 'HR', seats: 5 },
  { id: 'finance', name: 'Comitê Financeiro', code: 'FINANCE', seats: 6 },
  { id: 'rnd', name: 'Comitê de Engenharia / P&D', code: 'RND', seats: 5 },
  { id: 'sales', name: 'Comitê Comercial', code: 'SALES', seats: 5 },
  { id: 'risk', name: 'Comitê de Riscos', code: 'RISK', seats: 5 },
  { id: 'legal', name: 'Comitê Jurídico', code: 'LEGAL', seats: 4 },
  { id: 'operations', name: 'Comitê de Operações', code: 'OPS', seats: 6 },
];

export const MAJORITY_TYPE_LABELS: Record<MajorityType, string> = {
  simple_majority: 'Maioria simples',
  qualified_two_thirds: 'Qualificada (2/3)',
  unanimity: 'Unanimidade',
};

/**
 * Perfil de campos por template — controla quais campos financeiros/comerciais
 * aparecem no formulário. Decisões de RH/administrativas não expõem margem
 * nem condições comerciais.
 */
export type TemplateFieldProfile = {
  showFinancialImpact: boolean;
  showMargin: boolean;
  showCommercialRisk: boolean;
  showAdditionalBudget: boolean;
};

const DEFAULT_PROFILE: TemplateFieldProfile = {
  showFinancialImpact: true,
  showMargin: false,
  showCommercialRisk: false,
  showAdditionalBudget: true,
};

const TEMPLATE_PROFILES: Record<string, TemplateFieldProfile> = {
  HR_HIRING_APPROVAL: { showFinancialImpact: true, showMargin: false, showCommercialRisk: false, showAdditionalBudget: true },
  HR_TERMINATION_APPROVAL: { showFinancialImpact: true, showMargin: false, showCommercialRisk: false, showAdditionalBudget: false },
  FINANCE_CAPEX_APPROVAL: { showFinancialImpact: true, showMargin: false, showCommercialRisk: false, showAdditionalBudget: true },
  RND_INVESTMENT_APPROVAL: { showFinancialImpact: true, showMargin: false, showCommercialRisk: false, showAdditionalBudget: true },
  SALES_PROJECT_APPROVAL: { showFinancialImpact: true, showMargin: true, showCommercialRisk: true, showAdditionalBudget: true },
  RISK_EXCEPTION_APPROVAL: { showFinancialImpact: true, showMargin: false, showCommercialRisk: true, showAdditionalBudget: false },
  LEGAL_MATERIAL_DECISION: { showFinancialImpact: true, showMargin: false, showCommercialRisk: false, showAdditionalBudget: false },
  OPS_KICKOFF_CLOSURE: { showFinancialImpact: false, showMargin: false, showCommercialRisk: false, showAdditionalBudget: false },
};

export const getTemplateProfile = (templateId?: string): TemplateFieldProfile => {
  if (!templateId) return DEFAULT_PROFILE;
  return TEMPLATE_PROFILES[templateId] ?? DEFAULT_PROFILE;
};

/**
 * Tipos de decisão que expõem campos comerciais/contratuais (comercial,
 * contrato, CAPEX/investimento, compras/fornecedor). Decisões de RH/
 * administrativas exibem apenas impacto financeiro — sem margem, condições
 * ou risco comercial.
 */
export const COMMERCIAL_TEMPLATE_IDS = new Set<string>([
  'SALES_PROJECT_APPROVAL',
  'FINANCE_CAPEX_APPROVAL',
  'RND_INVESTMENT_APPROVAL',
]);

export const isCommercialTemplate = (templateId?: string): boolean =>
  !!templateId && COMMERCIAL_TEMPLATE_IDS.has(templateId);

/**
 * Mapeia a `key` da tabela RBAC `committees` (organização) para o id do comitê
 * de governança usado neste módulo. Comitês sem equivalente direto são
 * associados ao comitê de governança mais próximo (compras→financeiro,
 * projetos→operações).
 */
export const DB_COMMITTEE_KEY_TO_POLICY_ID: Record<string, string> = {
  diretoria: 'board',
  financeiro: 'finance',
  juridico_contratos: 'legal',
  rh: 'hr',
  projetos: 'operations',
  engenharia_pcp: 'rnd',
  riscos: 'risk',
  comercial: 'sales',
  compras: 'finance',
};

/** Converte keys de comitês (tabela `committees`) em ids de comitês de governança. */
export const mapDbCommitteeKeysToPolicyIds = (keys: string[]): string[] => {
  const ids = new Set<string>();
  for (const key of keys) {
    const id = DB_COMMITTEE_KEY_TO_POLICY_ID[key];
    if (id) ids.add(id);
  }
  return Array.from(ids);
};

export const committeeSeats = (committeeId: string): number =>
  COMMITTEES.find((committee) => committee.id === committeeId)?.seats ?? 5;

/** Quórum absoluto (nº de votantes) a partir do percentual e dos assentos do comitê. */
export const quorumHeadcount = (committeeId: string, quorumPercent: number): number =>
  Math.max(1, Math.ceil((committeeSeats(committeeId) * quorumPercent) / 100));

export const VOTING_RULES_BY_COMMITTEE: Record<string, VotingRuleSet> = {
  board: { quorumPercent: 75, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_yes', votingWindowHours: 72 },
  hr: { quorumPercent: 60, majorityType: 'simple_majority', tieBreakRule: 'chair_yes', votingWindowHours: 48 },
  finance: { quorumPercent: 66, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_no', votingWindowHours: 72 },
  rnd: { quorumPercent: 60, majorityType: 'simple_majority', tieBreakRule: 'chair_yes', votingWindowHours: 72 },
  sales: { quorumPercent: 60, majorityType: 'simple_majority', tieBreakRule: 'chair_yes', votingWindowHours: 48 },
  risk: { quorumPercent: 66, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_no', votingWindowHours: 48 },
  legal: { quorumPercent: 66, majorityType: 'qualified_two_thirds', tieBreakRule: 'chair_no', votingWindowHours: 48 },
  operations: { quorumPercent: 60, majorityType: 'simple_majority', tieBreakRule: 'chair_yes', votingWindowHours: 48 },
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
    name: 'Aprovação Comercial / Projeto',
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
  {
    id: 'OPS_KICKOFF_CLOSURE',
    name: 'Kickoff / Encerramento Operacional',
    ownerCommitteeId: 'operations',
    requiredFields: ['scope', 'owners', 'go_live_plan', 'operational_risk', 'execution_controls'],
    defaultVotingRule: VOTING_RULES_BY_COMMITTEE.operations,
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

  if (input.ownerCommitteeId === 'operations') {
    if ((input.financialImpact ?? 0) > POLICY_THRESHOLDS.rndFinanceThreshold) deps.add('finance');
    if (input.riskLevel === 'high' || input.riskLevel === 'critical') deps.add('risk');
    if (input.atypicalContract || input.materialLegalSensitivity) deps.add('legal');
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

/* ─────────────────────────────────────────────────────────────
   Smart creation routing
   Decide o destino de uma nova deliberação: rascunho, revisão ou
   votação direta. Pedidos simples e completos (contratação, aprovação
   administrativa interna, decisão operacional de baixo risco) vão direto
   à votação — sem forçar parecer/jurídico/financeiro. Decisões de maior
   materialidade/risco (CAPEX, contrato, exceção de risco, jurídico) são
   recomendadas para revisão. Dados incompletos permanecem como rascunho.
   ───────────────────────────────────────────────────────────── */

export type CreationRoute = 'draft' | 'review' | 'voting';

/**
 * Tipos de decisão que, por política, pedem parecer/revisão antes da votação
 * (CAPEX, investimento, comercial/contrato, exceção de risco, decisão jurídica
 * material). Contratação (RH), operacional e administrativo NÃO estão aqui —
 * seguem direto à votação quando completos e de baixo risco.
 */
export const REVIEW_BY_DEFAULT_TEMPLATE_IDS = new Set<string>([
  'FINANCE_CAPEX_APPROVAL',
  'RND_INVESTMENT_APPROVAL',
  'SALES_PROJECT_APPROVAL',
  'RISK_EXCEPTION_APPROVAL',
  'LEGAL_MATERIAL_DECISION',
]);

/** Acima deste impacto financeiro, recomenda-se revisão antes da votação. */
const REVIEW_FINANCIAL_IMPACT_THRESHOLD = 1_000_000;

export type CreationRouteInput = {
  templateId?: string;
  title: string;
  description: string;
  businessArea: string;
  ownerCommitteeId: string;
  /** Nº de comitês que efetivamente votam (responsável + adicionais). */
  votingCommitteeCount: number;
  quorumPercent: number;
  votingWindowHours: number;
  deadline: string | null;
  riskLevel: DeliberationItem['riskLevel'];
  financialImpact: number;
  outsideBudget: boolean;
  aggressivePaymentTerms: boolean;
  strategicFlag: boolean;
  isCommercial: boolean;
};

export type CreationRouteResult = {
  /** Rota recomendada, calculada automaticamente. */
  recommended: CreationRoute;
  /** Por que a rota recomendada foi escolhida (texto curto para exibir). */
  reasons: string[];
  /** Gatilhos de política que exigem revisão antes de votar. */
  reviewTriggers: string[];
  /** Campos obrigatórios ainda ausentes para "Iniciar votação". */
  missingForVoting: string[];
  /** Campos obrigatórios ainda ausentes para "Enviar para revisão". */
  missingForReview: string[];
  /** Votação direta permitida (completo + sem gatilho de revisão). */
  canVote: boolean;
  /** Envio para revisão permitido (dados básicos presentes). */
  canReview: boolean;
};

export const computeCreationRoute = (input: CreationRouteInput): CreationRouteResult => {
  const hasTitle = input.title.trim().length > 0;
  const hasSummary = input.description.trim().length > 0;

  // Campos obrigatórios para votação direta.
  const missingForVoting: string[] = [];
  if (!hasTitle) missingForVoting.push('título');
  if (!hasSummary) missingForVoting.push('resumo/justificativa');
  if (!input.businessArea) missingForVoting.push('área de negócio');
  if (!input.ownerCommitteeId) missingForVoting.push('comitê responsável');
  if (input.votingCommitteeCount < 1) missingForVoting.push('comitê votante');
  if (!(input.quorumPercent >= 1 && input.quorumPercent <= 100)) missingForVoting.push('quórum');
  if (!(input.votingWindowHours >= 1)) missingForVoting.push('janela de votação');
  if (!input.deadline) missingForVoting.push('prazo');

  // Dados básicos para revisão.
  const missingForReview: string[] = [];
  if (!hasTitle) missingForReview.push('título');
  if (!hasSummary) missingForReview.push('resumo/justificativa');
  if (!input.ownerCommitteeId) missingForReview.push('comitê responsável');

  // Gatilhos de revisão por política (materialidade/risco). Contratação/
  // administrativo/operacional simples NÃO disparam nada aqui.
  const reviewTriggers: string[] = [];
  if (input.riskLevel === 'critical') reviewTriggers.push('Risco crítico exige revisão antes da votação.');
  else if (input.riskLevel === 'high') reviewTriggers.push('Alto risco exige revisão antes da votação.');
  if (input.outsideBudget) reviewTriggers.push('Orçamento adicional requer revisão.');
  if (input.isCommercial && input.aggressivePaymentTerms)
    reviewTriggers.push('Alto risco comercial/contratual requer revisão.');
  if (input.financialImpact > REVIEW_FINANCIAL_IMPACT_THRESHOLD)
    reviewTriggers.push('Alto impacto financeiro requer revisão.');
  if (input.templateId && REVIEW_BY_DEFAULT_TEMPLATE_IDS.has(input.templateId))
    reviewTriggers.push('Este tipo de decisão exige parecer/revisão por política.');

  const canReview = missingForReview.length === 0;
  const canVote = missingForVoting.length === 0 && reviewTriggers.length === 0;

  let recommended: CreationRoute;
  let reasons: string[];

  if (!canReview) {
    recommended = 'draft';
    reasons = [`Faltam dados obrigatórios: ${missingForReview.join(', ')}.`];
  } else if (reviewTriggers.length > 0) {
    recommended = 'review';
    reasons = reviewTriggers.slice(0, 2);
  } else if (canVote) {
    recommended = 'voting';
    reasons = ['Todos os campos de votação obrigatórios estão completos.'];
  } else {
    recommended = 'draft';
    reasons =
      missingForVoting.length > 0
        ? [`Faltam dados para votação: ${missingForVoting.join(', ')}.`]
        : ['Complete os dados para enviar.'];
  }

  return { recommended, reasons, reviewTriggers, missingForVoting, missingForReview, canVote, canReview };
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

/**
 * Constrói o plano de estágios a partir de uma seleção explícita de comitês
 * feita pelo usuário (comitê responsável + comitês votantes adicionais),
 * aplicando overrides de quórum / regra de aprovação / janela ao estágio do
 * comitê responsável. Deduplica comitês e trata a Diretoria como aprovação final.
 */
export type CustomStagePlanInput = {
  ownerCommitteeId: string;
  votingCommitteeIds: string[];
  includeBoard?: boolean;
  quorumPercent?: number;
  majorityType?: MajorityType;
  votingWindowHours?: number;
};

export const buildCustomStagePlan = (input: CustomStagePlanInput): DeliberationStage[] => {
  const baseRule = VOTING_RULES_BY_COMMITTEE[input.ownerCommitteeId] ?? VOTING_RULES_BY_COMMITTEE.board;
  const ownerRule: VotingRuleSet = {
    ...baseRule,
    ...(input.quorumPercent != null ? { quorumPercent: input.quorumPercent } : {}),
    ...(input.majorityType ? { majorityType: input.majorityType } : {}),
    ...(input.votingWindowHours != null ? { votingWindowHours: input.votingWindowHours } : {}),
  };

  const stagePlan: DeliberationStage[] = [];
  const seen = new Set<string>();
  let sequence = 1;

  const owner = makeStage(sequence, 'owner_review', input.ownerCommitteeId);
  owner.votingRule = ownerRule;
  stagePlan.push(owner);
  seen.add(input.ownerCommitteeId);
  sequence += 1;

  input.votingCommitteeIds.forEach((committeeId) => {
    if (seen.has(committeeId) || committeeId === 'board') return; // dedupe + board vira aprovação final
    seen.add(committeeId);
    stagePlan.push(makeStage(sequence, 'dependent_review', committeeId));
    sequence += 1;
  });

  const boardSelected = input.votingCommitteeIds.includes('board') && input.ownerCommitteeId !== 'board';
  if ((input.includeBoard || boardSelected) && !seen.has('board')) {
    seen.add('board');
    stagePlan.push(makeStage(sequence, 'final_approval', 'board'));
    sequence += 1;
  }

  stagePlan.push(makeStage(sequence, 'publish_minutes', input.ownerCommitteeId));
  stagePlan.push(makeStage(sequence + 1, 'execution', input.ownerCommitteeId));
  return stagePlan;
};
