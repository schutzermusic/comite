/**
 * Vocabulário da MEDIÇÃO DE PROJETO — Fase 6.
 *
 * ─── A fronteira que estes tipos codificam ─────────────────────────────────
 *
 *   CONTRATO   define O QUE medir e QUE evidência/aceite exigir
 *   PROJETO    registra ONDE, QUANDO e O QUE aconteceu
 *
 * A instância é de Projetos; a regra é de Contratos. Nenhum tipo aqui copia
 * texto contratual como segunda fonte de verdade — o que viaja é o id da
 * regra e a proveniência que responde "por que o Apex está pedindo isso".
 *
 * ─── Três distinções que os tipos recusam apagar ───────────────────────────
 *
 *   · SUBMETIDO ≠ ACEITO. Estados diferentes, campos diferentes.
 *   · REJEITADO ≠ DEVOLVIDO PARA CORREÇÃO. Um é decisão negativa; o outro é
 *     pedido de correção, e o pacote volta.
 *   · EVIDÊNCIA ≠ ACEITE. `EvidenceClass` existe para que uma batida de ponto
 *     e um boletim assinado não caibam no mesmo campo.
 */

/** Ciclo de vida canônico. A ordem é a da máquina de estados da migration 130. */
export type MeasurementStatus =
  | 'PLANNED'
  | 'IN_PREPARATION'
  | 'READY_FOR_SUBMISSION'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  /**
   * Pacote interno APROVADO PARA ENVIO — e nada além disso.
   *
   * É o estado que mais se parece com aprovação e o que menos tem a ver com o
   * cliente. Antes da migration 192 ele não existia, e por isso "pronto para
   * sair" e "na mão do cliente há vinte dias" tinham a mesma cara.
   */
  | 'APPROVED_FOR_CUSTOMER'
  | 'AWAITING_CUSTOMER_ACCEPTANCE'
  | 'CUSTOMER_CORRECTION_REQUESTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RETURNED_FOR_CORRECTION'
  | 'CANCELLED'
  | 'SUPERSEDED';

export const MEASUREMENT_STATUS_LABEL: Record<MeasurementStatus, string> = {
  PLANNED: 'Planejada',
  IN_PREPARATION: 'Em preparação',
  READY_FOR_SUBMISSION: 'Pronta para submissão',
  SUBMITTED: 'Aguardando análise contratual',
  UNDER_REVIEW: 'Em análise contratual',
  APPROVED_FOR_CUSTOMER: 'Aprovada para envio ao cliente',
  AWAITING_CUSTOMER_ACCEPTANCE: 'Aguardando aceite da contratante',
  CUSTOMER_CORRECTION_REQUESTED: 'Correção solicitada pela contratante',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
  RETURNED_FOR_CORRECTION: 'Correção solicitada',
  CANCELLED: 'Cancelada',
  SUPERSEDED: 'Substituída',
};

/** Estados FINAIS. Medição finalizada não recebe evidência nem edição. */
export const FINALIZED_STATUSES: readonly MeasurementStatus[] =
  ['ACCEPTED', 'REJECTED', 'CANCELLED', 'SUPERSEDED'];

export type ReadinessState = 'READY' | 'BLOCKED' | 'INCOMPLETE' | 'NOT_APPLICABLE' | 'UNKNOWN';

/**
 * As dimensões da prontidão. Não existe booleano de prontidão neste módulo, e
 * a ausência é deliberada: "não está pronto" sem dizer POR QUE transfere ao
 * usuário o trabalho de descobrir o que falta.
 */
export type ReadinessDimension =
  | 'execution'
  | 'required_evidence'
  | 'technical_report'
  | 'contractual_documents'
  | 'measurement_completeness'
  | 'submission'
  | 'acceptance'
  | 'billing_prerequisite';

export const READINESS_DIMENSION_LABEL: Record<ReadinessDimension, string> = {
  execution: 'Execução',
  required_evidence: 'Evidência exigida',
  technical_report: 'Relatório técnico',
  contractual_documents: 'Documentos contratuais',
  measurement_completeness: 'Completude da medição',
  submission: 'Submissão',
  acceptance: 'Aceite',
  billing_prerequisite: 'Pré-requisito de faturamento',
};

/**
 * Razões ACIONÁVEIS. O plano é explícito: nunca devolver `BLOCKED` sem
 * explicação. Cada código abaixo diz a alguém o que fazer a seguir — ou, no
 * caso dos `UNKNOWN`, diz que a informação que falta é sobre a REGRA, e não
 * sobre o trabalho.
 */
export type ReadinessReason =
  | 'MISSING_REQUIRED_REPORT'
  | 'MISSING_REQUIRED_DOCUMENT'
  | 'MISSING_REQUIRED_EVIDENCE'
  | 'MISSING_PHOTOS'
  | 'EXECUTION_NOT_OBSERVED'
  | 'AWAITING_CONTRACT_REVIEW'
  | 'APPROVED_PENDING_DISPATCH'
  | 'WAITING_CUSTOMER_ACCEPTANCE'
  | 'CUSTOMER_CORRECTION_REQUESTED'
  | 'OPEN_CORRECTION_ITEMS'
  | 'RETURNED_FOR_CORRECTION'
  | 'MEASUREMENT_REJECTED'
  | 'RULE_UNRESOLVED'
  | 'TIMELINE_MAPPING_UNRESOLVED'
  | 'OCCURRENCE_UNRESOLVED'
  | 'OBLIGATION_BLOCKING'
  | 'MEASUREMENT_SEMANTICS_UNKNOWN'
  | 'MEASUREMENT_VALUE_MISSING'
  | 'REQUIREMENT_CERTAINTY_UNKNOWN'
  | 'MEASUREMENT_NOT_FOUND';

export const READINESS_REASON_LABEL: Record<ReadinessReason, string> = {
  MISSING_REQUIRED_REPORT: 'Falta o relatório exigido pelo contrato',
  MISSING_REQUIRED_DOCUMENT: 'Falta documento contratual exigido',
  MISSING_REQUIRED_EVIDENCE: 'Falta a evidência exigida pelo contrato',
  MISSING_PHOTOS: 'Faltam registros fotográficos exigidos',
  EXECUTION_NOT_OBSERVED: 'Nenhuma evidência de execução foi observada',
  AWAITING_CONTRACT_REVIEW: 'Aguardando a análise da Gestão de Contratos',
  APPROVED_PENDING_DISPATCH: 'Aprovada internamente — ainda não enviada à contratante',
  WAITING_CUSTOMER_ACCEPTANCE: 'Aguardando aceite da contratante',
  CUSTOMER_CORRECTION_REQUESTED: 'A contratante pediu correção',
  OPEN_CORRECTION_ITEMS: 'Há itens de correção em aberto',
  RETURNED_FOR_CORRECTION: 'Pacote devolvido para correção',
  MEASUREMENT_REJECTED: 'Medição rejeitada',
  RULE_UNRESOLVED: 'A regra contratual desta medição não foi resolvida',
  TIMELINE_MAPPING_UNRESOLVED: 'A regra não está mapeada a nenhuma etapa do cronograma',
  OCCURRENCE_UNRESOLVED: 'A ocorrência desta medição não pôde ser identificada',
  OBLIGATION_BLOCKING: 'Há obrigação contratual em aberto que trava o faturamento',
  MEASUREMENT_SEMANTICS_UNKNOWN: 'O contrato não declara se a medição é incremental ou cumulativa',
  MEASUREMENT_VALUE_MISSING: 'A medição ainda não tem quantidade ou valor apurado',
  REQUIREMENT_CERTAINTY_UNKNOWN: 'A regra não diz se estas exigências se aplicam',
  MEASUREMENT_NOT_FOUND: 'Medição não encontrada',
};

/**
 * Classe da evidência. A separação é a §21 do plano, e ela existe porque
 * misturar uma coordenada de GPS com um boletim assinado é como um sistema
 * passa a "provar" aceite com presença.
 */
export type EvidenceClass =
  | 'RAW_EVIDENCE'
  | 'DERIVED_EVIDENCE'
  | 'VALIDATED_EVIDENCE'
  | 'ACCEPTANCE_EVIDENCE';

export const EVIDENCE_CLASS_LABEL: Record<EvidenceClass, string> = {
  RAW_EVIDENCE: 'Evidência bruta',
  DERIVED_EVIDENCE: 'Evidência inferida',
  VALIDATED_EVIDENCE: 'Evidência validada',
  ACCEPTANCE_EVIDENCE: 'Evidência de aceite',
};

export type EvidenceSourceType =
  | 'attendance_punch' | 'location_evidence' | 'daily_allowance'
  | 'time_entry' | 'work_session' | 'project_file'
  | 'contract_document' | 'timeline_item' | 'task' | 'manual_record';

export type EvidenceLinkSource = 'deterministic' | 'manual' | 'system_inferred';

export type RequirementKind =
  | 'TECHNICAL_REPORT' | 'SERVICE_REPORT' | 'DOCUMENT'
  | 'PHOTOS' | 'TESTS_INSPECTION' | 'EVIDENCE' | 'CUSTOMER_ACCEPTANCE';

export const REQUIREMENT_KIND_LABEL: Record<RequirementKind, string> = {
  TECHNICAL_REPORT: 'Relatório técnico',
  SERVICE_REPORT: 'Relatório de serviço',
  DOCUMENT: 'Documento contratual',
  PHOTOS: 'Registros fotográficos',
  TESTS_INSPECTION: 'Ensaios e inspeções',
  EVIDENCE: 'Evidência de execução',
  CUSTOMER_ACCEPTANCE: 'Aceite do cliente',
};

/**
 * `MISSING` e `UNKNOWN` são estados DIFERENTES, e a diferença é a mais
 * importante do módulo: `MISSING` é trabalho que alguém sabe fazer;
 * `UNKNOWN` é a regra que não disse se exige. Colapsá-los num "pendente"
 * transformaria silêncio contratual em tarefa operacional.
 */
export type RequirementSatisfaction =
  | 'MISSING' | 'PROVIDED' | 'VALIDATED' | 'NOT_APPLICABLE' | 'UNKNOWN';

/** De onde veio o aceite. Fonte externa não é um usuário interno disfarçado. */
export type AcceptanceSource =
  | 'customer_portal' | 'signed_bulletin' | 'internal_reviewer'
  | 'external_document' | 'approval_engine' | 'integration';

export const ACCEPTANCE_SOURCE_LABEL: Record<AcceptanceSource, string> = {
  customer_portal: 'Portal do cliente',
  signed_bulletin: 'Boletim de medição assinado',
  internal_reviewer: 'Revisor interno autorizado',
  external_document: 'Documento externo de aceite',
  approval_engine: 'Decisão do Motor de Aprovação',
  integration: 'Integração / provedor',
};

/** Fontes que representam parte EXTERNA — exigem proveniência, não usuário. */
export const EXTERNAL_ACCEPTANCE_SOURCES: readonly AcceptanceSource[] =
  ['customer_portal', 'signed_bulletin', 'external_document', 'integration'];

export type MeasurementBasis = 'QUANTITY' | 'PERCENTAGE' | 'MILESTONE_FIXED' | 'MONETARY' | 'UNKNOWN';
export type AccumulationMode = 'INCREMENTAL' | 'CUMULATIVE' | 'MILESTONE_FIXED' | 'UNKNOWN';
export type OccurrenceState = 'resolved' | 'unresolved';

export interface MeasurementReadiness {
  readonly overall: ReadinessState;
  readonly dimensions: Readonly<Record<ReadinessDimension, ReadinessState>>;
  readonly reasons: readonly ReadinessReason[];
  readonly missingRequirements: readonly RequirementKind[];
  readonly unknownRequirements: readonly RequirementKind[];
  readonly evidenceCount: number;
  readonly validatedEvidenceCount: number;
  readonly blockingObligations: number;
  /** Itens de correção em aberto. Zero é zero; a ausência de rodada também. */
  readonly openCorrectionItems: number;
  readonly ruleResolved: boolean;
  readonly timelineMapped: boolean;
  readonly occurrenceState: OccurrenceState;
  readonly asOf: string;
  /**
   * Quando o CACHE foi calculado. `null` quando o valor veio do resolvedor ao
   * vivo. A tela mostra a marca para que uma leitura velha seja reconhecível
   * como velha, em vez de parecer o estado de agora.
   */
  readonly computedAt: string | null;
}

/** Linha do modelo de leitura canônico (`project_measurement_read_model`). */
export interface ProjectMeasurementRow {
  readonly id: string;
  readonly organization_id: string;
  readonly project_id: string;
  readonly contract_id: string;
  readonly contract_measurement_rule_id: string;
  readonly timeline_item_id: string | null;
  readonly milestone_id: string | null;
  readonly occurrence_key: string;
  readonly occurrence_state: OccurrenceState;
  readonly measurement_period_start: string | null;
  readonly measurement_period_end: string | null;
  readonly expected_at: string | null;
  readonly status: MeasurementStatus;
  readonly revision: number;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly measurement_basis: MeasurementBasis;
  readonly accumulation_mode: AccumulationMode;
  readonly quantity: number | string | null;
  readonly unit: string | null;
  readonly measured_value: number | string | null;
  readonly currency: string | null;
  readonly accepted_quantity: number | string | null;
  readonly accepted_value: number | string | null;
  readonly accepted_currency: string | null;
  readonly acceptance_source: AcceptanceSource | null;
  readonly accepted_at: string | null;
  readonly submitted_at: string | null;
  readonly rejected_at: string | null;
  readonly returned_at: string | null;
  readonly review_started_at: string | null;
  readonly approved_for_customer_at: string | null;
  readonly sent_to_customer_at: string | null;
  readonly customer_correction_at: string | null;
  readonly customer_correction_reason: string | null;
  readonly customer_due_at: string | null;
  readonly return_reason: string | null;
  readonly rejection_reason: string | null;
  readonly open_correction_count: number;
  readonly dispatch_count: number;
  readonly last_dispatch_at: string | null;
  readonly origin: 'manual' | 'candidate_materialization' | 'event';
  readonly created_at: string;
  readonly updated_at: string;

  // ---- proveniência contratual (responde "por que isto é exigido") ----
  readonly rule_title: string | null;
  readonly rule_effective_from: string | null;
  readonly rule_effective_until: string | null;
  readonly rule_cadence: string | null;
  readonly rule_aggregation_mode: string | null;
  readonly source_clause_id: string | null;
  readonly source_document_id: string | null;
  readonly source_reference: string | null;
  readonly source_page: number | null;

  // ---- cronograma ----
  readonly timeline_title: string | null;
  readonly timeline_planned_start: string | null;
  readonly timeline_planned_finish: string | null;
  readonly timeline_percent_complete: number | string | null;

  // ---- prontidão (cache) ----
  readonly readiness_overall: ReadinessState | null;
  readonly readiness_dimensions: Record<string, ReadinessState> | null;
  readonly readiness_reasons: ReadinessReason[] | null;
  readonly readiness_computed_at: string | null;

  readonly evidence_count: number;
  readonly missing_requirement_count: number;
}

export interface MeasurementEvidenceRow {
  readonly id: string;
  readonly measurement_id: string;
  readonly project_id: string;
  readonly source_type: EvidenceSourceType;
  readonly source_id: string;
  readonly evidence_class: EvidenceClass;
  readonly link_source: EvidenceLinkSource;
  readonly confidence: number | string | null;
  readonly validation_state: 'unvalidated' | 'validated' | 'rejected';
  readonly requirement_kind: RequirementKind | null;
  readonly captured_at: string | null;
  readonly person_id: string | null;
  readonly provenance: Record<string, unknown>;
  readonly note: string | null;
  readonly linked_at: string;
  readonly revoked_at: string | null;
  readonly revocation_reason: string | null;
}

export interface MeasurementRequirementRow {
  readonly id: string;
  readonly measurement_id: string;
  readonly requirement_kind: RequirementKind;
  readonly required: boolean;
  readonly requirement_certainty: 'declared' | 'unknown';
  readonly document_type: string | null;
  readonly detail: string | null;
  readonly source_clause_id: string | null;
  readonly source_document_id: string | null;
  readonly source_reference: string | null;
  readonly source_page: number | null;
  readonly rule_effective_from: string | null;
  readonly rule_effective_until: string | null;
  readonly responsible_party_id: string | null;
  readonly satisfaction_state: RequirementSatisfaction;
  readonly satisfied_by_evidence_id: string | null;
}

export interface MeasurementHistoryRow {
  readonly id: string;
  readonly measurement_id: string;
  readonly from_state: MeasurementStatus | null;
  readonly to_state: MeasurementStatus;
  readonly transition: string;
  readonly reason: string | null;
  readonly actor_user_id: string | null;
  readonly actor_source: 'human' | 'system' | 'cron' | 'external' | 'integration';
  readonly actor_reference: string | null;
  readonly provenance: Record<string, unknown>;
  readonly domain_event_id: string | null;
  readonly occurred_at: string;
  readonly recorded_at: string;
}

/** O PACOTE de medição — o que o gestor precisa ver de uma vez. */
export interface MeasurementPackage {
  readonly measurement: ProjectMeasurementRow;
  readonly requirements: readonly MeasurementRequirementRow[];
  readonly evidence: readonly MeasurementEvidenceRow[];
  readonly history: readonly MeasurementHistoryRow[];
  readonly readiness: MeasurementReadiness;
  /**
   * A lista EXATA do que corrigir, quando alguém pediu correção. Vazia é vazia;
   * não significa "nada a corrigir" quando a consulta falhou — o chamador
   * distingue os dois casos por erro, não por lista vazia.
   */
  readonly corrections: readonly MeasurementCorrectionItemRow[];
  /** Cada remessa à Contratante, da mais recente para a primeira. */
  readonly dispatches: readonly MeasurementCustomerDispatchRow[];
}

/**
 * Traduz o jsonb do resolvedor. Faz `overall` cair para `UNKNOWN` quando o
 * formato não é reconhecido: um estado desconhecido nunca vira `READY` só
 * porque a leitura falhou.
 */
export function parseReadiness(raw: unknown, computedAt: string | null = null): MeasurementReadiness {
  const r = (raw ?? {}) as Record<string, unknown>;
  const states: readonly ReadinessState[] = ['READY', 'BLOCKED', 'INCOMPLETE', 'NOT_APPLICABLE', 'UNKNOWN'];
  const asState = (v: unknown): ReadinessState =>
    states.includes(v as ReadinessState) ? (v as ReadinessState) : 'UNKNOWN';

  const dimsRaw = (r.dimensions ?? {}) as Record<string, unknown>;
  const dimensions = Object.fromEntries(
    (Object.keys(READINESS_DIMENSION_LABEL) as ReadinessDimension[])
      .map((k) => [k, asState(dimsRaw[k])]),
  ) as Record<ReadinessDimension, ReadinessState>;

  return {
    overall: asState(r.overall),
    dimensions,
    reasons: Array.isArray(r.reasons) ? (r.reasons as ReadinessReason[]) : [],
    missingRequirements: Array.isArray(r.missing_requirements) ? (r.missing_requirements as RequirementKind[]) : [],
    unknownRequirements: Array.isArray(r.unknown_requirements) ? (r.unknown_requirements as RequirementKind[]) : [],
    evidenceCount: Number(r.evidence_count ?? 0),
    validatedEvidenceCount: Number(r.validated_evidence_count ?? 0),
    blockingObligations: Number(r.blocking_obligations ?? 0),
    openCorrectionItems: Number(r.open_correction_items ?? 0),
    ruleResolved: r.rule_resolved === true,
    timelineMapped: r.timeline_mapped === true,
    occurrenceState: r.occurrence_state === 'unresolved' ? 'unresolved' : 'resolved',
    asOf: String(r.as_of ?? ''),
    computedAt,
  };
}

/** Rótulo humano de uma razão, sem inventar texto para código desconhecido. */
export function readinessReasonLabel(code: string): string {
  return READINESS_REASON_LABEL[code as ReadinessReason] ?? code;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANÁLISE CONTRATUAL, CORREÇÃO E ACEITE DA CONTRATANTE (migrations 192–194)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Os estados em que a medição espera alguém de CONTRATOS — ou espera o Projeto
 * corrigir algo que Contratos pediu.
 *
 * É esta lista, e não um campo novo, que define a fila de Aprovações. Um campo
 * `in_review boolean` ao lado do estado seria a segunda verdade que se
 * desencontra da primeira na primeira exceção.
 */
export const REVIEW_QUEUE_STATUSES: readonly MeasurementStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED_FOR_CUSTOMER',
  'AWAITING_CUSTOMER_ACCEPTANCE',
  'CUSTOMER_CORRECTION_REQUESTED',
  'RETURNED_FOR_CORRECTION',
];

/** Agrupamento da fila por QUEM tem o próximo passo. */
export type ReviewBucket =
  | 'AWAITING_CONTRACT_REVIEW'
  | 'IN_CONTRACT_REVIEW'
  | 'AWAITING_DISPATCH'
  | 'AWAITING_CUSTOMER'
  | 'AWAITING_PROJECT_CORRECTION';

export const REVIEW_BUCKET_LABEL: Record<ReviewBucket, string> = {
  AWAITING_CONTRACT_REVIEW: 'Aguardando análise',
  IN_CONTRACT_REVIEW: 'Em análise',
  AWAITING_DISPATCH: 'Aprovada para envio ao cliente',
  AWAITING_CUSTOMER: 'Aguardando aceite da contratante',
  AWAITING_PROJECT_CORRECTION: 'Correção solicitada',
};

/** Ordem de exibição: o que espera Contratos primeiro; o que espera terceiros depois. */
export const REVIEW_BUCKET_ORDER: readonly ReviewBucket[] = [
  'AWAITING_CONTRACT_REVIEW',
  'IN_CONTRACT_REVIEW',
  'AWAITING_PROJECT_CORRECTION',
  'AWAITING_DISPATCH',
  'AWAITING_CUSTOMER',
];

/**
 * O bucket de um estado. Total e explícito — sem ramo `default`, para que um
 * estado novo na máquina quebre a compilação em vez de cair num balde errado.
 */
export function reviewBucketOf(status: MeasurementStatus): ReviewBucket | null {
  switch (status) {
    case 'SUBMITTED': return 'AWAITING_CONTRACT_REVIEW';
    case 'UNDER_REVIEW': return 'IN_CONTRACT_REVIEW';
    case 'APPROVED_FOR_CUSTOMER': return 'AWAITING_DISPATCH';
    case 'AWAITING_CUSTOMER_ACCEPTANCE': return 'AWAITING_CUSTOMER';
    case 'CUSTOMER_CORRECTION_REQUESTED':
    case 'RETURNED_FOR_CORRECTION': return 'AWAITING_PROJECT_CORRECTION';
    case 'PLANNED':
    case 'IN_PREPARATION':
    case 'READY_FOR_SUBMISSION':
    case 'ACCEPTED':
    case 'REJECTED':
    case 'CANCELLED':
    case 'SUPERSEDED': return null;
  }
}

/** A natureza do trabalho que resolve um item de correção (§2 do plano). */
export type CorrectionCategory =
  | 'operacional' | 'documental' | 'medicao' | 'aprovacao_interna' | 'aceite_externo';

export const CORRECTION_CATEGORY_LABEL: Record<CorrectionCategory, string> = {
  operacional: 'Operacional',
  documental: 'Documental',
  medicao: 'Medição',
  aprovacao_interna: 'Aprovação interna',
  aceite_externo: 'Aceite externo',
};

/** Quem pediu a correção. A Contratante não escreve no Apex; alguém transcreve. */
export type CorrectionSide = 'contract_management' | 'customer';

export const CORRECTION_SIDE_LABEL: Record<CorrectionSide, string> = {
  contract_management: 'Gestão de Contratos',
  customer: 'Contratante',
};

export interface MeasurementCorrectionItemRow {
  readonly id: string;
  readonly measurement_id: string;
  readonly round: number;
  readonly requested_by_side: CorrectionSide;
  readonly requested_by_user_id: string | null;
  readonly requested_at: string;
  readonly item: string;
  readonly requirement_kind: RequirementKind | null;
  readonly category: CorrectionCategory;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
  readonly resolution_note: string | null;
}

export type DispatchChannel = 'email' | 'portal' | 'protocol' | 'courier' | 'meeting' | 'other';

export const DISPATCH_CHANNEL_LABEL: Record<DispatchChannel, string> = {
  email: 'E-mail',
  portal: 'Portal do cliente',
  protocol: 'Protocolo',
  courier: 'Portador',
  meeting: 'Reunião',
  other: 'Outro',
};

export interface MeasurementCustomerDispatchRow {
  readonly id: string;
  readonly measurement_id: string;
  readonly attempt: number;
  readonly sent_by_user_id: string | null;
  readonly customer_party_id: string | null;
  readonly customer_contact: string | null;
  readonly sent_at: string;
  readonly channel: DispatchChannel;
  readonly external_reference: string | null;
  readonly due_at: string | null;
  readonly note: string | null;
  readonly document_ids: readonly string[];
}

// ─── Responsáveis ──────────────────────────────────────────────────────────

export type StakeholderRole =
  | 'project_manager' | 'contract_manager' | 'milestone_owner'
  | 'measurement_responsible' | 'billing_owner' | 'finance_owner';

export const STAKEHOLDER_ROLE_LABEL: Record<StakeholderRole, string> = {
  project_manager: 'Gestor do Projeto',
  contract_manager: 'Gestor de Contratos',
  milestone_owner: 'Responsável pelo marco',
  measurement_responsible: 'Responsável pela medição',
  billing_owner: 'Responsável pelo faturamento',
  finance_owner: 'Responsável financeiro',
};

/**
 * `RESPONSIBLE_UNDEFINED` é resposta de primeira classe, e aparece na tela com
 * essas palavras. Um destinatário "mais ou menos certo" é pior que um
 * responsável ausente e declarado: o primeiro parece resolvido.
 */
export type StakeholderResolution = 'RESOLVED' | 'RESPONSIBLE_UNDEFINED';

export interface MeasurementStakeholder {
  readonly role: StakeholderRole;
  readonly userId: string | null;
  readonly resolution: StakeholderResolution;
  /** De onde o responsável sairia. Presente mesmo quando não saiu. */
  readonly source: string;
}

export const RESPONSIBLE_UNDEFINED_LABEL = 'Responsável não definido';

// ─── SLA ───────────────────────────────────────────────────────────────────

export type SlaStage =
  | 'CONTRACT_REVIEW' | 'CUSTOMER_DISPATCH' | 'CUSTOMER_ACCEPTANCE' | 'PROJECT_CORRECTION';

export const SLA_STAGE_LABEL: Record<SlaStage, string> = {
  CONTRACT_REVIEW: 'Análise contratual',
  CUSTOMER_DISPATCH: 'Envio à contratante',
  CUSTOMER_ACCEPTANCE: 'Aceite da contratante',
  PROJECT_CORRECTION: 'Correção pelo projeto',
};

/**
 * `NOT_ASSESSED` NÃO é "no prazo": é "ninguém declarou o prazo". A diferença é
 * a mesma de `UNKNOWN` na prontidão, e por isso o vocabulário é o mesmo.
 */
export type SlaState = 'ON_TIME' | 'WARNING' | 'OVERDUE' | 'NOT_ASSESSED' | 'NOT_APPLICABLE';

export const SLA_STATE_LABEL: Record<SlaState, string> = {
  ON_TIME: 'No prazo',
  WARNING: 'Perto do prazo',
  OVERDUE: 'Vencido',
  NOT_ASSESSED: 'Prazo não declarado',
  NOT_APPLICABLE: 'Sem prazo nesta etapa',
};

export interface MeasurementSla {
  readonly stage: SlaStage | null;
  readonly state: SlaState;
  readonly since: string | null;
  readonly dueAt: string | null;
  readonly daysRemaining: number | null;
  readonly escalated: boolean;
  readonly escalationTargetUserId: string | null;
  /** Por que não há prazo: `NO_POLICY` ou `NO_DECLARED_TERM`. */
  readonly reason: string | null;
}

export function parseSla(raw: unknown): MeasurementSla {
  const r = (raw ?? {}) as Record<string, unknown>;
  const states: readonly SlaState[] = ['ON_TIME', 'WARNING', 'OVERDUE', 'NOT_ASSESSED', 'NOT_APPLICABLE'];
  const stages: readonly SlaStage[] =
    ['CONTRACT_REVIEW', 'CUSTOMER_DISPATCH', 'CUSTOMER_ACCEPTANCE', 'PROJECT_CORRECTION'];
  return {
    stage: stages.includes(r.stage as SlaStage) ? (r.stage as SlaStage) : null,
    // Estado irreconhecível cai para NOT_ASSESSED, nunca para ON_TIME: um
    // parse que falhou não pode afirmar que está tudo em ordem.
    state: states.includes(r.state as SlaState) ? (r.state as SlaState) : 'NOT_ASSESSED',
    since: (r.since as string | null) ?? null,
    dueAt: (r.due_at as string | null) ?? null,
    daysRemaining: r.days_remaining == null ? null : Number(r.days_remaining),
    escalated: r.escalated === true,
    escalationTargetUserId: (r.escalation_target_user_id as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
  };
}
