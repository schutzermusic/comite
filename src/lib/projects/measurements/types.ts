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
  | 'ACCEPTED'
  | 'REJECTED'
  | 'RETURNED_FOR_CORRECTION'
  | 'CANCELLED'
  | 'SUPERSEDED';

export const MEASUREMENT_STATUS_LABEL: Record<MeasurementStatus, string> = {
  PLANNED: 'Planejada',
  IN_PREPARATION: 'Em preparação',
  READY_FOR_SUBMISSION: 'Pronta para submissão',
  SUBMITTED: 'Submetida',
  UNDER_REVIEW: 'Em análise',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
  RETURNED_FOR_CORRECTION: 'Devolvida para correção',
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
  | 'WAITING_CUSTOMER_ACCEPTANCE'
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
  WAITING_CUSTOMER_ACCEPTANCE: 'Aguardando aceite do cliente',
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
