export type User = {
  id: string;
  nome: string;
  email: string;
  avatarUrl: string;
  papelPrincipal: 'admin' | 'gerenteProjeto' | 'membroComite' | 'visualizador';
  full_name?: string;
  cargo?: string;
  ativo?: boolean;
  categoria?: string;
  role_global_id?: string;
};

export type Project = {
  id: string;
  nome: string;
  codigo: string;
  cliente?: string;
  status: 'planejamento' | 'em_andamento' | 'pausado' | 'concluido' | 'cancelado';
  comite_id?: string;
  comite_nome?: string;
  comite_status?: 'sem_supervisao' | 'ativo' | 'atencao_necessaria' | 'revisao_pendente';
  responsavel: User;
  impacto_financeiro: 'baixo' | 'medio' | 'alto' | 'critico';
  valor_total: number;
  valor_executado: number;
  progresso_percentual: number;
  sankhya_integrado?: boolean;
  sankhya_projeto_id?: string;
  codigoInterno: string; // from old type
  comiteResponsavel: string; // from old type;
  descricao?: string;
  roi_estimado?: number;
  risco_geral?: 'baixo' | 'medio' | 'alto';
  data_inicio?: string;
  created_date?: string;
  tipo?: string;
};

export type Meeting = {
  id: string;
  titulo: string;
  comite: string;
  dataHoraInicio: string;
  tipoReuniao: 'ordinaria' | 'extraordinaria' | 'presencial' | 'virtual' | 'hibrida';
  status: 'agendada' | 'em_andamento' | 'encerrada' | 'cancelada';
  participantes?: string[];
  participantes_nomes?: string[];
  transcricao?: string;
  ata_ia_gerada?: string;
  acoes_sugeridas?: ActionItem[];
  resumo_ia?: string;
};

export type AgendaItem = {
  id: string;
  titulo: string;
  descricao: string;
  responsavel: User;
  status: 'pendente' | 'em_discussao' | 'deliberada';
};

export type Vote = {
  id: string;
  titulo: string;
  comite: string;
  status: 'nao_iniciada' | 'em_andamento' | 'encerrada';
  prazoFim: string;
  usuario_email?: string;
  created_date?: string;
  updated_date?: string;
  resultado?: 'aprovado' | 'reprovado' | 'empate' | 'pendente';
  categoria?: string;
  sankhya_integrado?: boolean;
  sankhya_valor_projeto?: number;
  sankhya_projeto_nome?: string;
  sankhya_cliente?: string;
  sankhya_status?: string;
};

export type ActionItem = {
  tarefa: string;
  responsavel: string;
  prazo: string;
};

export type Notification = {
  id: string;
  usuario_email: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  tipo: 'reuniao_proxima' | 'nova_pauta' | 'votacao_iniciada' | 'votacao_encerrando' | 'votacao_encerrada' | 'reuniao_hoje' | 'ata_publicada' | 'membro_adicionado' | 'role_atualizada';
  link: string;
  cor: string;
  created_date: string;
};

export type Workflow = {
  id: string;
  nome: string;
  descricao?: string;
  tipo: 'notificacao_prazo' | 'atribuicao_tarefa' | 'aprovacao_orcamento' | 'mudanca_status' | 'lembrete_votacao' | 'alerta_risco' | 'custom';
  ativa: boolean;
  prioridade: number;
  frequencia_execucao: 'imediata' | 'diaria' | 'semanal' | 'mensal';
  total_execucoes: number;
  created_date: string;
};

export type WorkflowLog = {
  id: string;
  workflow_id: string;
  status: 'success' | 'failed' | 'partial';
  trigger_evento: string;
  erro_mensagem?: string;
  duracao_ms: number;
  created_date: string;
};

export type ProjetoAnalytics = {
  id: string;
  projeto_id: string;
  projeto_nome: string;
  data_analise: string;
  score_saude_projeto?: number;
  ia_insights?: string;
  avaliacao_risco?: {
    nivel_risco: 'baixo' | 'medio' | 'alto' | 'critico';
    score_risco: number;
    fatores_risco: {
      fator: string;
      impacto: string;
      descricao: string;
      mitigacao_sugerida: string;
    }[];
    riscos_identificados: string[];
  };
  previsao_roi?: {
    roi_estimado_percentual: number;
    roi_pessimista: number;
    roi_realista: number;
    roi_otimista: number;
    payback_meses: number;
    valor_presente_liquido: number;
    taxa_retorno_interna: number;
  };
  alocacao_recursos?: {
    eficiencia_alocacao: number;
    custo_total_recursos: number;
    recursos_subutilizados: string[];
    recursos_sobreutilizados: string[];
    recursos_humanos?: {
      role: string;
      horas_alocadas: number;
      custo_estimado: number;
      utilizacao_percentual: number;
    }[];
    recursos_materiais?: {
      item: string;
      quantidade: number;
      custo: number;
    }[];
  };
  recomendacoes?: {
    tipo: string;
    prioridade: 'urgente' | 'alta' | 'media' | 'baixa';
    descricao: string;
    impacto_esperado: string;
  }[];
};

export type AtividadeMembro = {
    id: string;
    usuario_email: string;
    usuario_nome: string;
    tipo_atividade: 'voto' | 'pauta_criada' | 'reuniao_participada' | 'comentario' | 'role_alterada' | 'adicionado_comite' | 'removido_comite';
    descricao: string;
    comite_id?: string;
    comite_nome?: string;
    referencia_id?: string;
    referencia_tipo?: 'pauta' | 'reuniao' | 'comite';
    created_date: string;
};

// ========================================
// 🆕 NEW MODULES - EXTENDED TYPES
// ========================================

// MODULE 1: Project Portfolio Extensions
export type ProjectTask = {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  status: 'not_started' | 'in_progress' | 'completed' | 'delayed';
  responsibleId?: string;
  responsibleName?: string;
  milestone?: boolean;
  dependencies?: string[];
  progress?: number;
};

export type ProjectAllocation = {
  id: string;
  projectId: string;
  memberId: string;
  memberName: string;
  role: string;
  allocationPercent: number;
  hoursPerWeek?: number;
  critical?: boolean; // computed: allocationPercent > 100
  startDate?: Date;
  endDate?: Date;
};

// MODULE 2: Agenda Backlog (Pautas Refactor)
export type AgendaBacklogItem = {
  id: string;
  title: string;
  description: string;
  status: 'draft' | 'under_review' | 'approved' | 'archived';
  committeeId?: string;
  committeeName?: string;
  type: 'Financial' | 'Legal' | 'Operational' | 'Risk' | 'Compliance' | string;
  legalOpinionText?: string;
  legalOpinionAttachmentUrl?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: Date;
  updatedAt: Date;
  priority: 'low' | 'medium' | 'high' | 'critical';
};

// ========================================
// DELIBERAÇÕES MODULE TYPES
// ========================================

export type DeliberationStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'in_voting'
  | 'awaiting_minutes'
  | 'resolved'
  | 'in_execution'
  | 'closed'
  | 'returned_for_revision'
  | 'withdrawn';

export type VoteOption = 'yes' | 'no' | 'abstain';

export type CommitteeRole = 'chair' | 'secretary' | 'voting_member' | 'guest';

export type MajorityType = 'simple_majority' | 'qualified_two_thirds' | 'unanimity';

export type TieBreakRule = 'chair_yes' | 'chair_no';

export type DeliberationStageType =
  | 'owner_review'
  | 'dependent_review'
  | 'final_approval'
  | 'publish_minutes'
  | 'execution';

export type DeliberationStageStatus = 'pending' | 'active' | 'completed' | 'rejected';

export type VotingRuleSet = {
  quorumPercent: number;
  majorityType: MajorityType;
  tieBreakRule: TieBreakRule;
  votingWindowHours: number;
};

export type DeliberationStage = {
  id: string;
  sequence: number;
  stageType: DeliberationStageType;
  committeeId: string;
  committeeName: string;
  status: DeliberationStageStatus;
  required: boolean;
  openedAt?: Date;
  dueAt?: Date;
  closedAt?: Date;
  votingRule: VotingRuleSet;
};

export type DeliberationMinutes = {
  status: 'draft' | 'published';
  agendaSummary: string;
  evidenceList: string[];
  votingResult: string;
  decisionText: string;
  actionItems: string[];
  publishedAt?: Date;
};

export type DeliberationActionItem = {
  id: string;
  title: string;
  ownerName: string;
  dueDate: Date;
  status: 'pending' | 'in_progress' | 'completed';
  linkedEntityType?: 'project' | 'contract' | 'risk';
  linkedEntityId?: string;
};

export type VoteRecord = {
  id: string;
  itemId: string;
  voterId: string;
  voterName: string;
  vote: VoteOption;
  justification?: string;
  hasConflictOfInterest: boolean;
  stageId?: string;
  votedAt: Date;
};

export type AuditTrailEntry = {
  id: string;
  itemId: string;
  action:
    | 'status_changed'
    | 'field_edited'
    | 'vote_cast'
    | 'voting_started'
    | 'voting_closed'
    | 'evidence_added'
    | 'review_requested'
    | 'stage_transitioned'
    | 'minutes_generated'
    | 'minutes_published'
    | 'decision_issued'
    | 'execution_task_created';
  description: string;
  userId: string;
  userName: string;
  previousValue?: string;
  newValue?: string;
  timestamp: Date;
};

export type ReviewStatus = {
  type: 'Legal' | 'Finance' | 'Compliance';
  status: 'pending' | 'approved' | 'rejected' | 'not_required';
  reviewerId?: string;
  reviewerName?: string;
  reviewedAt?: Date;
  notes?: string;
};

export type DeliberationItem = AgendaBacklogItem & {
  deliberationStatus: DeliberationStatus;
  ownerCommitteeId?: string;
  ownerCommitteeName?: string;
  dependentCommitteeIds?: string[];
  dependentCommitteeNames?: string[];
  strategicFlag?: boolean;
  outsideBudget?: boolean;
  marginPercent?: number;
  aggressivePaymentTerms?: boolean;
  highTicket?: boolean;
  roleStrategic?: boolean;
  policyException?: boolean;

  stages?: DeliberationStage[];
  currentStageId?: string;

  votingStartedAt?: Date;
  votingClosedAt?: Date;
  votes?: VoteRecord[];
  voteResult?: 'approved' | 'rejected' | 'pending' | 'no_quorum' | 'returned_for_revision';
  quorumRequired?: number;
  quorumPresent?: number;
  quorumAbsent?: number;

  financialImpact?: number;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  dueDate?: Date;

  evidenceComplete?: boolean;
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    type: 'document' | 'link' | 'other';
  }>;
  reviews?: ReviewStatus[];

  recommendation?: 'approve' | 'reject' | 'adjust';
  recommendationNotes?: string[];

  auditTrail?: AuditTrailEntry[];

  minutesSummary?: string;
  minutes?: DeliberationMinutes;

  executionItems?: DeliberationActionItem[];

  objectionsCount?: number;
  ownerId?: string;
  ownerName?: string;
  templateId?: string;
  templateName?: string;
  requestedDecision?: string;
  resolvedAt?: Date;
  submittedAt?: Date;
};

// MODULE 3: Risk Management
export type Risk = {
  id: string;
  title: string;
  description: string;
  category: 'Operational' | 'Financial' | 'Legal' | 'Contractual' | 'Compliance' | string;
  probability: number; // 1-5
  impact: number; // 1-5
  level: number; // computed = probability * impact
  severity: 'low' | 'medium' | 'high' | 'critical'; // computed
  origin: 'manual' | 'contract' | 'project';
  referenceId?: string;
  referenceName?: string;
  responsibleId?: string;
  responsibleName?: string;
  status: 'open' | 'mitigating' | 'resolved';
  mitigationPlan?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
};

// MODULE 4: Contract Management
export type Contract = {
  id: string;
  name: string;
  vendorOrParty: string;
  value: number;
  currency: string;
  signingDate?: Date;
  expirationDate?: Date;
  renewalDate?: Date;
  fileUrl: string;
  fileName?: string;
  riskClassification: 'low' | 'medium' | 'high';
  status: 'active' | 'expiring_soon' | 'expired';
  uploadedAt: Date;
  responsibleId?: string;
  responsibleName?: string;
  linkedRisks?: string[]; // risk IDs
  notes?: string;
  autoExtracted?: boolean; // AI simulation flag
};

// MODULE 5: Organization Chart
export type OrgMember = {
  id: string;
  name: string;
  role: string;
  department: string;
  email: string;
  avatarUrl?: string;
  managerId?: string; // null = CEO
  level?: number; // computed hierarchy level
  directReports?: OrgMember[];
};
