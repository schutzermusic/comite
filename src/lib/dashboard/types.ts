/**
 * CONTRATO do Dashboard V2 — "O que está acontecendo".
 *
 * Tipos compartilhados pelo servidor (`src/lib/dashboard/overview.ts`,
 * `explain.ts`) e pela tela (`src/components/dashboard-v2/*`). Só tipos: este
 * arquivo não importa nada de servidor nem de navegador.
 *
 * Regras que o contrato carrega:
 *  • "Restrito" nunca é 0: uma seção ou etapa que a pessoa não lê volta
 *    `restricted`; uma leitura que falhou volta `error`; o que não tem fonte
 *    canônica volta `unavailable`. Nenhum desses vira número.
 *  • Dinheiro só atravessa quando `current_user_can_view_project_financials()`
 *    é verdadeiro; senão o campo é `null` e a tela diz "Restrito".
 *  • Toda linha tem uma DEFINIÇÃO (`rule`) — por que ela é exceção — e a
 *    próxima ação aponta para o fluxo governado do domínio. Nada se executa no
 *    Dashboard.
 */

/* ── Seções ─────────────────────────────────────────────────────────────── */

export type SectionState<T> =
  | { state: 'ok'; data: T; truncated?: boolean; asOf?: string | null }
  | { state: 'restricted' }
  | { state: 'error'; message: string };

/** Domínios que o Dashboard lê — a mesma ordem do fluxo do negócio. */
export type Domain = 'comercial' | 'operacao' | 'supply' | 'medicao' | 'faturamento' | 'recebivel';

export const DOMAIN_LABEL: Record<Domain, string> = {
  comercial: 'Comercial',
  operacao: 'Operação',
  supply: 'Supply',
  medicao: 'Medição',
  faturamento: 'Faturamento',
  recebivel: 'Recebíveis',
};

/**
 * Gravidade ÚNICA do Dashboard (mapa das escalas de cada fonte):
 *  critical ← Operações `danger` · sinal Apex `critical` · recebível vencido · comercial `blocking`
 *  high     ← Operações `warning` · sinal Apex `high` · comercial `attention`
 *  medium   ← Operações `accent`  · sinal Apex `medium`
 */
export type Severity = 'critical' | 'high' | 'medium';

export interface Evidence { label: string; value: string; source?: string | null }

/** Um achado PERSISTIDO da Apex (`supply_signals`), anexado à linha que fala do mesmo objeto. */
export interface ApexNote {
  signalId: string;
  kind: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  /** "Apex identificou uma falta sem cobertura" — só para achados persistidos, com versão do motor. */
  lead: string;
  title: string;
  rationale: string;
  evidence: Evidence[];
  ranAt: string | null;
  engineVersion: string | null;
  /** O achado segue aberto, mas a leitura ao vivo já não mostra o problema. */
  stale: boolean;
}

/* ── Atenção agora (fila única, entre domínios) ─────────────────────────── */

export interface NextAction {
  label: string;
  href: string;
  /** true = o link abre o registro exato; false = abre a área (sem foco possível hoje). */
  focused: boolean;
}

export interface FeedRow {
  /**
   * Chave de DEDUPLICAÇÃO pelo objeto canônico:
   *  `req:<requirement_id>` (falta de material + sinais SHORTAGE/ALTERNATE_STOCK/ETA_RISK do mesmo requisito)
   *  `po:<purchase_order_id>` · `os:<service_order_id>` · `meas:<measurement_id>` · `dep:<requirement_id>`
   *  `risk:<risk_id>` · `proj-act:<project_id>` (atividades vencidas agrupadas por projeto)
   *  `bill:<billing_event_id>` · `rcv:<receivable_id>` · `com:<kind>:<id>`
   */
  key: string;
  domain: Domain;
  severity: Severity;
  /** Rótulo curto do tipo: "Material", "Cronograma", "OS", "Medição", "Risco", "Cliente", "Compra", "Faturamento", "Recebível", "Comercial". */
  kindLabel: string;
  /** ONDE — projeto, contrato ou fornecedor. */
  location: { kind: 'project' | 'contract' | 'supplier' | 'organization'; id: string | null; label: string | null };
  /** O QUÊ. */
  object: string;
  /** QUAL o problema. */
  problem: string;
  /** POR QUE importa: o primeiro elo canônico a jusante ("atividade X começa em 12/10"). `null` se não há elo. */
  consequence: string | null;
  due: string | null;
  /** Responsável por nome; `null` com `ownerApplicable` = "sem responsável". */
  owner: string | null;
  ownerApplicable: boolean;
  /** Quantos registros esta linha agrupa (≥ 1). */
  count: number;
  nextAction: NextAction;
  /** Referência para "Entender" (`/api/dashboard/explain?ref=`). `null` quando não há cadeia com ≥ 2 elos. */
  explainRef: string | null;
  apex: ApexNote | null;
  /** A definição da regra que tornou isto exceção (procedência das linhas que não são achado da Apex). */
  rule: string;
}

export interface FeedModel {
  /** Ordenadas (gravidade → prazo → domínio), deduplicadas, com diversidade de domínio no topo. */
  rows: FeedRow[];
  /** Total deduplicado e SEM corte (o número do cabeçalho). */
  total: number;
  critical: number;
  byDomain: Partial<Record<Domain, { total: number; critical: number }>>;
  /**
   * Fontes da fila que a pessoa LÊ mas cuja leitura FALHOU nesta montagem.
   * Com qualquer item aqui a fila é parcial: nunca "Nada fora do lugar" nem
   * "0 exceções" — a tela diz o que não carregou.
   */
  failed: Array<{ domain: Domain; label: string }>;
  /** Alguma fonte foi lida com corte (limite de linhas): `total` é piso, não exato. */
  partial: boolean;
}

/* ── Fluxo do negócio (mapa de gargalos) ────────────────────────────────── */

export type StageId =
  | 'comercial' | 'os' | 'projeto' | 'planejamento' | 'necessidades' | 'supply'
  | 'execucao' | 'medicao' | 'faturamento' | 'recebivel' | 'caixa';

export type StageState = 'ok' | 'restricted' | 'unavailable' | 'error';

export interface FlowStage {
  id: StageId;
  label: string;
  state: StageState;
  /** O que está PARADO nesta etapa, com substantivo: { value: 3, noun: 'aceitas sem OS' }. `null` fora de `ok`. */
  stuck: { value: number; noun: string } | null;
  /** Contexto curto do volume da etapa ("50 autorizadas", "345 ativos"). */
  context: string | null;
  tone: 'danger' | 'warning' | 'neutral' | 'success';
  href: string | null;
  /** Definição do número (tooltip / leitor de tela). */
  definition: string;
  /** Por que não há número (`restricted` / `unavailable` / `error`), ou por que o número falta numa etapa `ok`. */
  reason?: string | null;
  /** O número veio de uma leitura com corte — é piso ("≥"), não exato. */
  partial?: boolean;
  /**
   * Etapa `ok` SEM número (`stuck: null`): por quê, de forma estruturada —
   * `restricted` (a leitura do número é restrita ao perfil), `error` (a leitura
   * falhou) ou `incomplete` (a leitura veio cortada e o número não seria exato).
   * `reason` traz a frase; a tela decide pela chave, nunca pelo texto.
   */
  noNumber?: 'restricted' | 'error' | 'incomplete' | null;
}

/* ── Projetos ───────────────────────────────────────────────────────────── */

export type HealthLevel = 'critical' | 'attention' | 'healthy' | 'unknown';

export interface ProjectHealthRow {
  projectId: string;
  name: string;
  client: string | null;
  level: HealthLevel;
  reasons: string[];
  /** Próximo marco DO CRONOGRAMA (não é marco contratual). */
  nextMilestone: { date: string; title: string | null } | null;
  /** A linha mais grave da fila para este projeto, quando existe. */
  topIssue: { label: string; href: string; severity: Severity } | null;
  href: string;
  mapHref: string;
}

export interface ProjectsModel {
  rows: ProjectHealthRow[];
  total: number;
  counts: Record<HealthLevel, number>;
}

/* ── Decisões (superfície, nunca a caixa) ───────────────────────────────── */

export interface DecisionPreview {
  key: string;
  href: string;
  kindLabel: string;
  title: string;
  /** Já no formato da caixa; `null` quando restrito ou sem valor. */
  amountText: string | null;
  amountRestricted: boolean;
  project: string | null;
  priority: { label: string; tone: 'danger' | 'warning' | 'accent' | 'neutral' };
  due: string | null;
  overdue: boolean;
}

export interface DecisionsModel {
  /** PRIMARY + ESCALATED — a MESMA definição do selo (`decision_inbox_count_for_viewer`). */
  count: number;
  overdue: number;
  escalated: number;
  alsoEligible: number;
  /** Até 3, na ordem da caixa (`prioritize`). */
  top: DecisionPreview[];
  /** Presente quando a caixa está vazia: diferencia "nada aguardando" de "nenhuma alçada declarada". */
  setup: { policies: number; authorities: number } | null;
}

/* ── Calendário da empresa (próximos 30 dias, por domínio) ──────────────── */

export type CalendarLane = 'operacao' | 'supply' | 'medicao' | 'faturamento' | 'recebivel';

export interface CalendarItem {
  id: string;
  date: string;
  title: string;
  lane: CalendarLane;
  kind: 'milestone' | 'activity' | 'need' | 'delivery' | 'due';
  tone: 'danger' | 'warning' | 'accent' | 'neutral' | 'success';
  href: string | null;
  project: string | null;
}

export interface CalendarModel {
  days: number;
  /** `unavailable` = a leitura falhou; `partial` = parte da faixa não carregou (o que aparece é incompleto). */
  lanes: Array<{ id: CalendarLane; label: string; state: 'ok' | 'restricted' | 'unavailable'; partial?: boolean }>;
  items: CalendarItem[];
}

/* ── Payload ────────────────────────────────────────────────────────────── */

export interface DashboardOverview {
  ok: true;
  generatedAt: string;
  /** Hoje em São Paulo (YYYY-MM-DD) — o mesmo `today` para todas as leituras. */
  today: string;
  /** Domínios que esta pessoa lê, e os que não lê (rótulos para a nota de rodapé). */
  readable: Domain[];
  notReadable: string[];
  feed: SectionState<FeedModel>;
  stages: FlowStage[];
  projects: SectionState<ProjectsModel>;
  decisions: SectionState<DecisionsModel>;
  calendar: SectionState<CalendarModel>;
  /** Última leitura da Apex (motor de sinais do Supply); `null` quando a pessoa não lê sinais. */
  apex: { lastRun: { ranAt: string; engineVersion: string } | null } | null;
  /**
   * Há alguma operação para acompanhar (projeto ativo, OS aberta ou oportunidade)? Decide o estado vazio.
   * `true`: alguma leitura mostrou operação. `false`: todas as leituras de operação que a pessoa faz
   * responderam, e responderam vazio. `null`: não dá para saber (restrito ou falhou) — nunca "não há operação".
   */
  hasOperation: boolean | null;
}

/* ── Entender (cadeia causal) ───────────────────────────────────────────── */

export type ExplainKind = 'mat' | 'act' | 'proj-act' | 'meas' | 'os' | 'dep' | 'risk' | 'po' | 'bill' | 'sig';

/**
 * Estado de cada elo:
 *  found       — o registro existe e foi lido
 *  none        — a pessoa lê a área e não há registro ("sem vínculo registrado")
 *  restricted  — a pessoa não lê esta parte ("Restrito")
 *  unconfirmed — há vínculo proposto/ambíguo/âncora perdida — confirmar em Contratos
 *  pending     — o elo ainda não nasceu por regra (ex.: faturamento só nasce do aceite do cliente)
 */
export type LinkState = 'found' | 'none' | 'restricted' | 'unconfirmed' | 'pending';

export interface ChainLink {
  stage: string;
  label: string;
  detail: string | null;
  state: LinkState;
  tone?: 'danger' | 'warning' | 'success' | 'neutral';
  href: string | null;
  note?: string | null;
}

export type ExplainResponse =
  | {
      ok: true;
      ref: string;
      title: string;
      /** `ownerApplicable: false` — o tipo não tem responsável (sinal, título, evento): a tela não diz "sem responsável". */
      detected: { object: string; problem: string; due: string | null; owner: string | null; ownerApplicable: boolean; location: string | null };
      chain: ChainLink[];
      /** Como ler a cadeia — contenção ("faz parte da etapa…") ou comparação de datas, nunca "atrasa". */
      relation: string | null;
      evidence: Evidence[];
      apex: ApexNote | null;
      nextAction: NextAction | null;
      rule: string | null;
      asOf: string;
    }
  /** `error`: a leitura falhou — nunca vira "não encontrado" nem "sem vínculo". */
  | { ok: false; reason: 'invalid' | 'not_found' | 'restricted' | 'error'; message: string };
