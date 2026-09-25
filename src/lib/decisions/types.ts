/**
 * DECISÕES — os contratos compartilhados por banco (240), servidor, fila de
 * avisos e tela.
 *
 * Nada aqui é estado de decisão. Um `DecisionItem` é uma LEITURA da decisão
 * canônica (etapa do Motor de Aprovação ou submissão de pedido de compra sob
 * alçada declarada), feita na hora. O ato volta ao mesmo lugar de onde a
 * decisão veio.
 */

/** De onde a decisão vem. Uma fonte nova entra aqui E como ramo em `decision_inbox` (SQL). */
export type DecisionSourceKind = 'APPROVAL_ENGINE' | 'PROCUREMENT_AUTHORITY';

/** Os atos que uma fonte pode oferecer. Cada fonte declara quais executa de verdade. */
export type DecisionAction = 'APPROVE' | 'REJECT' | 'REQUEST_ADJUSTMENT';

/**
 * PRIMARY    a decisão é desta pessoa;
 * ESCALATED  venceu na faixa primária e chegou a esta (faixa superior de alçada);
 * ELIGIBLE   pode decidir (tem a alçada), mas a decisão é de outra faixa.
 */
export type DecisionAssignment = 'PRIMARY' | 'ESCALATED' | 'ELIGIBLE';

/** Estados de decisão ABERTA, derivados de forma determinística do estado canônico. */
export type DecisionOpenState = 'PENDENTE' | 'EM_ANALISE' | 'ESCALADA' | 'SEM_DECISOR';

/** Desfecho canônico (lido de approval_decisions / purchase_order_history). */
export type DecisionOutcome = 'APPROVED' | 'REJECTED' | 'ADJUSTMENT_REQUESTED' | 'CANCELLED' | 'EXPIRED';

/** O estado normalizado que a tela mostra — projeção, nunca verdade. */
export type DecisionStatus =
  | 'PENDENTE' | 'EM_ANALISE' | 'ESCALADA' | 'SEM_DECISOR'
  | 'AJUSTE_SOLICITADO' | 'APROVADA' | 'REJEITADA' | 'CANCELADA' | 'EXPIRADA';

/** Em que qualidade a pessoa abre o detalhe (decision_access_for_viewer). */
export type DecisionAccess = 'DECIDER' | 'ELIGIBLE' | 'PARTICIPANT' | 'SOURCE_READER' | 'TEAM';

export type DecisionTone = 'danger' | 'warning' | 'success' | 'info' | 'accent' | 'neutral';

export interface PersonRef { id: string; name: string | null }

// ---------------------------------------------------------------------------
// Autoridade — "por que esta decisão chegou até mim?"
// ---------------------------------------------------------------------------

export interface ProcurementAuthorityView {
  kind: 'PROCUREMENT_AUTHORITY';
  authorityId: string;
  ceiling: number | null;          // null = sem teto declarado
  currency: string;
  tier: 'PRIMARY' | 'ELIGIBLE';
  granteeKind: 'ROLE' | 'USER';
  granteeLabel: string | null;     // "Financeiro" | nome da pessoa
  scopeProjectId: string | null;
  scopeCategory: string | null;
  sourceKind: string;              // BOARD_RESOLUTION …
  sourceKindLabel: string;
  sourceReference: string;
  sourceDocumentId: string | null;
  justification: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  declaredBy: PersonRef | null;
  leadDays: number | null;
}

export interface PolicyAuthorityView {
  kind: 'APPROVAL_POLICY';
  policyKey: string;
  policyVersionNo: number;
  stageNo: number;
  stageName: string;
  stageCount: number;
  quorumRequired: number | null;
  stepKey: string;
  stepName: string;
  eligibilityMode: 'PERMISSION' | 'ROLE' | 'NAMED';
  roleKey: string | null;
  roleLabel: string | null;
  permissionKey: string | null;
  authoritySource: string | null;  // PERMISSION | ROLE | NAMED | DELEGATED
  authorityBasis: string | null;   // "role:ceo_diretoria"
  authorityLimit: number | null;
  authorityCurrency: string | null;
}

export type DecisionAuthority = ProcurementAuthorityView | PolicyAuthorityView;

// ---------------------------------------------------------------------------
// Item da caixa
// ---------------------------------------------------------------------------

/** Linha crua de `decision_inbox_for_viewer()` (snake_case, como o PostgREST devolve). */
export interface DecisionInboxRow {
  decision_key: string;
  source_kind: DecisionSourceKind;
  category: string;
  subject_type: string;
  subject_id: string;
  action_type: string;
  request_id: string | null;
  step_id: string | null;
  stage_no: number | null;
  submission: number | null;
  title: string;
  amount: number | string | null;
  currency: string | null;
  project_id: string | null;
  requested_by: string | null;
  requested_at: string | null;
  due_at: string | null;
  need_by: string | null;
  decide_by: string | null;
  overdue: boolean;
  assignment: DecisionAssignment;
  state: DecisionOpenState;
  actions: DecisionAction[];
  reason_required: DecisionAction[];
  fingerprint: string | null;
  authority: Record<string, unknown>;
}

/** Uma linha de contexto do cartão ("Fornecedor recomendado · Fornecedor B"). */
export interface ContextLine { label: string; value: string; emphasis?: boolean }

/** Por que o item está nesta posição da fila. */
export interface PriorityReason { code: 'OVERDUE' | 'CRITICAL' | 'DEADLINE' | 'MATERIAL' | 'NORMAL'; label: string; tone: DecisionTone }

export interface DecisionItem {
  key: string;
  source: DecisionSourceKind;
  category: string;
  subjectType: string;
  subjectId: string;
  actionType: string;
  requestId: string | null;
  stepId: string | null;
  stageNo: number | null;
  submission: number | null;
  kindLabel: string;               // "Compra" | "Liberação de faturamento"
  title: string;                   // "Pedido de compra OC-…"
  amount: number | null;
  currency: string | null;
  projectId: string | null;
  projectName: string | null;
  requestedBy: PersonRef | null;
  requestedAt: string | null;
  dueAt: string | null;
  needBy: string | null;
  decideBy: string | null;
  overdue: boolean;
  critical: boolean;               // impacto operacional crítico COM evidência (requisito crítico, sinal crítico)
  criticalReason: string | null;
  assignment: DecisionAssignment;
  state: DecisionOpenState;
  status: DecisionStatus;
  actions: DecisionAction[];
  reasonRequired: DecisionAction[];
  fingerprint: string | null;
  authority: DecisionAuthority;
  context: ContextLine[];
  priority: PriorityReason;
  sourceHref: string;
  sourceLabel: string;
}

// ---------------------------------------------------------------------------
// Equipe e Concluídas
// ---------------------------------------------------------------------------

export type TeamScope = 'ORGANIZATION' | 'DIRECT_REPORTS' | 'NONE';

export interface TeamItem {
  key: string;
  source: DecisionSourceKind;
  category: string;
  kindLabel: string;
  title: string;
  amount: number | null;
  amountRestricted: boolean;
  currency: string | null;
  projectId: string | null;
  projectName: string | null;
  requestedBy: PersonRef | null;
  requestedAt: string | null;
  waitingDays: number | null;
  dueAt: string | null;
  needBy: string | null;
  decideBy: string | null;
  overdue: boolean;
  state: DecisionOpenState;
  status: DecisionStatus;
  owners: Array<PersonRef & { assignment: DecisionAssignment }>;
}

/** Onde as decisões param: por dono, com espera e vencidas. */
export interface Bottleneck {
  owner: PersonRef | null;         // null = SEM decisor elegível
  open: number;
  overdue: number;
  oldestWaitingDays: number | null;
  amount: number | null;           // soma, só do que o espectador pode ver
}

export interface CompletedItem {
  key: string;
  source: DecisionSourceKind;
  category: string;
  kindLabel: string;
  title: string;
  amount: number | null;
  currency: string | null;
  projectId: string | null;
  projectName: string | null;
  viewerRole: 'DECIDER' | 'REQUESTER';
  outcome: DecisionOutcome;
  status: DecisionStatus;
  decidedBy: PersonRef | null;
  decidedAt: string | null;
  requestedBy: PersonRef | null;
  requestedAt: string | null;
  reason: string | null;
  authoritySummary: string | null; // "Alçada declarada — Ata ATA-QA-001 (até R$ 500.000,00)"
  recordId: string | null;
  sourceHref: string;
}

// ---------------------------------------------------------------------------
// Workspace (GET /api/decisions?tab=…)
// ---------------------------------------------------------------------------

export type DecisionsTab = 'minhas' | 'equipe' | 'concluidas';

export interface ChannelStatus {
  channel: 'in_app' | 'email' | 'whatsapp';
  status: 'ACTIVE' | 'SIMULATED' | 'DISABLED' | 'NOT_CONFIGURED';
  provider: string | null;
  detail: string;                   // frase para a tela
  viewerOptIn: boolean | null;      // null = não se aplica
}

export interface DecisionsWorkspace {
  generatedAt: string;
  today: string;
  viewerId: string;
  tab: DecisionsTab;
  mine: DecisionItem[];             // PRIMARY + ESCALATED, já na ordem da fila
  alsoEligible: DecisionItem[];     // ELIGIBLE
  team: { scope: TeamScope; items: TeamItem[]; bottlenecks: Bottleneck[] } | null;
  completed: CompletedItem[] | null;
  counts: { mine: number; overdue: number; alsoEligible: number };
  categories: Array<{ id: string; label: string; count: number }>;
  teamScope: TeamScope;
  /**
   * Só quando a caixa (Minhas) está VAZIA: o que está configurado para que
   * decisões cheguem aqui — políticas de aprovação ativas e alçadas de compra
   * vigentes na organização. Zero dos dois explica o vazio sem chamá-lo de falha.
   */
  setup: { policies: number; authorities: number } | null;
  /** Só com a caixa vazia: as últimas decisões concluídas (até 5), para o vazio ter contexto. */
  recent: CompletedItem[] | null;
}

// ---------------------------------------------------------------------------
// Detalhe (GET /api/decisions/[key])
// ---------------------------------------------------------------------------

/** Leitura de `decision_resolve` — a decisão aberta ou encerrada. */
export interface ResolvedDecision {
  key: string;
  source: DecisionSourceKind;
  category: string;
  subjectType: string;
  subjectId: string;
  title: string;
  amount: number | null;
  currency: string | null;
  projectId: string | null;
  open: boolean;
  outcome: DecisionOutcome | null;
  status: DecisionStatus;
  closedBy: PersonRef | null;
  closedAt: string | null;
  reason: string | null;
  requestedBy: PersonRef | null;
  requestedAt: string | null;
  requestNote: string | null;
  fingerprint: string | null;
  submission: number | null;
  requestId: string | null;
  stageNo: number | null;
}

export interface Fact { label: string; value: string; source?: string | null; href?: string | null }

/** Uma proposta na comparação (mesma avaliação de Compras: evaluateQuotes). */
export interface QuoteOption {
  quoteId: string;
  supplier: string;
  landed: number;
  currency: string;
  leadDays: number | null;
  eta: string | null;
  lateDays: number | null;
  chosen: boolean;
  recommended: boolean;
  cheapest: boolean;
  compliant: boolean;
  supplierOk: boolean;
  reliability: number | null;
  verdict: string;                  // "Atende o cronograma" | "Chega 9 dias após a necessidade"
}

export interface QuoteComparison {
  needBy: string | null;
  evaluatedOn: string;              // data da avaliação (hoje): a chegada depende do dia da aprovação
  options: QuoteOption[];
  rationale: string | null;         // justificativa registrada na decisão de compra
  followsRecommendation: boolean | null;
  decidedBy: PersonRef | null;
  decidedAt: string | null;
}

/** Fato de inteligência — SEMPRE com a evidência que o sustenta. */
export interface ImpactFact {
  statement: string;                // "Esta opção custa R$ 11.400 a mais, mas atende o cronograma."
  tone: DecisionTone;
  evidence: Fact[];
}

export interface ChainNode { label: string; detail?: string | null; href?: string | null; missing?: boolean }

export interface DecisionLine {
  item: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: number;
  subtotal: number;
  needBy: string | null;
  requirement: string | null;
}

export interface TimelineEntry { at: string; label: string; actor: PersonRef | null; detail: string | null }

export interface DeliverySummary {
  channel: 'in_app' | 'email' | 'whatsapp';
  noticeKind: string;
  state: string;
  stateLabel: string;
  at: string | null;
  detail: string | null;
}

export interface DecisionDetail {
  key: string;
  access: DecisionAccess;
  /** Equipe sem leitura da origem: valor e conteúdo omitidos — a tela diz "Restrito", nunca zero. */
  amountRestricted?: boolean;
  resolved: ResolvedDecision;
  item: DecisionItem | null;        // presente quando a pessoa decide (ou pode decidir) agora
  canAct: boolean;
  actions: DecisionAction[];
  reasonRequired: DecisionAction[];
  why: Fact[];                      // "Por que esta decisão chegou até mim?"
  facts: Fact[];                    // fatos do objeto de origem, com proveniência
  lines: DecisionLine[];
  comparison: QuoteComparison | null;
  impact: ImpactFact[];
  chain: ChainNode[];
  otherDeciders: { count: number; people: PersonRef[] };
  history: TimelineEntry[];
  notifications: DeliverySummary[];
  sourceHref: string;
  sourceLabel: string;
  today: string;
}

// ---------------------------------------------------------------------------
// Ato (POST /api/decisions/[key]/act)
// ---------------------------------------------------------------------------

export interface DecisionActRequest {
  action: DecisionAction;
  reason?: string | null;
  /** O que a tela ACHA que está decidindo. Divergiu → STALE, nada é escrito. */
  expectedFingerprint: string | null;
  /** Estável por intenção (abrir a confirmação), não por clique: a retentativa é a mesma intenção. */
  intentId: string;
}

export type DecisionActOutcome = 'RECORDED' | 'IDEMPOTENT_REPLAY' | 'STALE';

export interface DecisionActResponse {
  outcome: DecisionActOutcome;
  message: string;
  resolved: ResolvedDecision | null;
  /** Para o motor: a execução a jusante (pedido de compra) já refletiu? */
  downstream: { applied: boolean; status: string | null } | null;
}
