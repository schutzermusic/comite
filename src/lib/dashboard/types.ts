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
  /** Projeto da decisão quando a origem o carrega (pedido de compra); `null` para faturamento. */
  projectId?: string | null;
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
  /** As operações no globo: posição de cada projeto (oficial ou canteiro), saúde e exceções por local. */
  sites: SectionState<SitesModel>;
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

/* ══════════════════════════════════════════════════════════════════════════
   GLOBO — as operações no mapa (Dashboard no estilo do protótipo APEX FILM)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * De onde vem a posição. `canonical`: localização oficial (`project_globe_marker`,
 * com proveniência documental). `project_site`: coordenada do CANTEIRO cadastrada
 * no Supply (`inventory_locations` kind PROJECT_SITE, ativo, com lat/lng) — usada
 * só quando não há a oficial, e só quando o projeto tem UM canteiro com
 * coordenada (mais de um = ambíguo = sem ponto). Nunca centróide de UF, nunca
 * posição estimada.
 */
export type SiteSource = 'canonical' | 'project_site';

export interface SitePosition {
  lat: number;
  lng: number;
  precision: 'site' | 'municipality';
  /** Nome do local ("Canteiro CANT-TUCURUI", "UG-05 — casa de força"). */
  label: string | null;
  municipality: string | null;
  uf: string | null;
  source: SiteSource;
  /** Proveniência: documento/contrato (oficial) ou o cadastro do canteiro (Supply). */
  evidence: {
    kind: 'contract_scope' | 'contract_clause' | 'manual' | 'supply_site';
    contractId: string | null;
    documentId: string | null;
    page: number | null;
    /** Quando a posição foi apurada (oficial) ou atualizada (canteiro). */
    at: string | null;
  };
}

export interface SiteMarker {
  projectId: string;
  name: string;
  client: string | null;
  code: string | null;
  position: SitePosition;
  /** Saúde pela MESMA derivação do projeto e de Operações (a pior trava decide); `null` = não ativo. */
  level: HealthLevel | null;
  reasons: string[];
  nextMilestone: { date: string; title: string | null } | null;
  /** Exceções da fila neste projeto, contadas ANTES do corte da fila; `partial` = alguma fonte cortada/falhou. */
  exceptions: { total: number; critical: number; partial: boolean };
  topIssue: { label: string; href: string; severity: Severity } | null;
  href: string;
}

export interface SitesModel {
  markers: SiteMarker[];
  /** Projetos ATIVOS sem nenhuma posição (nem oficial, nem canteiro) — contagem exata; nunca um ponto inventado. */
  unlocated: number;
  unlocatedHref: string;
  /** UFs com projeto localizado, para realçar no mapa. */
  states: Array<{ uf: string; projects: number; critical: number; attention: number }>;
}

/* ── Local em foco: GET /api/dashboard/site/[projectId] (Visão geral) ────── */

export interface SiteHud {
  ok: true;
  generatedAt: string;
  today: string;
  project: {
    id: string;
    name: string;
    code: string | null;
    client: string | null;
    status: string | null;
    /** Descrição/escopo do projeto quando cadastrado; `null` = não há (nunca texto inventado). */
    scope: string | null;
    href: string;
    /** Tipo de obra detectado (nome, OS, escopo, itens) — só dirige a REPRESENTAÇÃO ESQUEMÁTICA 3D do local. */
    kind: SiteKindDetection;
  };
  location: SectionState<{
    position: SitePosition | null;
    /** Sem posição: o estado da apuração oficial (UNRESOLVED / REQUIRES_ATTENTION / CONFLICT). */
    pending: { state: 'UNRESOLVED' | 'REQUIRES_ATTENTION' | 'CONFLICT'; reason: string | null } | null;
  }>;
  /** O que está acontecendo aqui — mesma derivação do marcador. */
  now: SectionState<{
    health: { level: HealthLevel; reasons: string[] } | null;
    /** Fase atual = etapa-resumo (ou atividade) EM ANDAMENTO mais relevante do cronograma; `null` = nenhuma. */
    phase: { id: string; title: string; percent: number | null } | null;
    schedule: { open: number; overdue: number; critical: number; inProgress: number; blocked: number; partial: boolean } | null;
    nextMilestone: { id: string; date: string; title: string | null } | null;
    /** Avanço físico quando há base (folhas com duração); `null` = sem base. */
    progress: { percent: number } | null;
    /** Pessoas alocadas (só com `people.allocations_view` ou `projects.view`); `restricted` quando não lê. */
    team: SectionState<{ allocated: number }>;
    serviceOrders: SectionState<Array<{ id: string; number: string; status: string; statusLabel: string; href: string }>>;
  }>;
  /** A fila, recortada no projeto — linhas idênticas às do Dashboard (mesmo `key` e `explainRef`). */
  attention: SectionState<FeedModel>;
  /** A próxima ação da linha mais grave; `null` quando a fila não é `ok`, está vazia ou é parcial. */
  nextAction: NextAction | null;
  measurements: SectionState<{ pending: number; inCorrection: number; awaitingCustomer: number;
    next: { id: string; key: string; expected: string | null; status: string; statusLabel: string } | null }>;
  risks: SectionState<{ open: number; critical: number; high: number; withoutOwner: number }>;
  supply: SectionState<{ shortages: { total: number; critical: number; partial: boolean }; apexOpen: number | null }>;
  contract: SectionState<{ links: Array<{ contractId: string; label: string }> }>;
  /** Escopo: os contratos vinculados ao projeto (o evento de faturamento não tem projeto). */
  billing: SectionState<{ events: number; awaitingRelease: number; invoicesToIssue: number;
    /** Valor total dos eventos (só com a leitura financeira); `null` = restrito ou sem valor. */
    total: string | null }>;
  decisions: SectionState<{ count: number; overdue: number; top: DecisionPreview[] }>;
  calendar: SectionState<CalendarModel>;
  notReadable: string[];
}

export type SiteHudResponse = SiteHud | { ok: false; reason: 'invalid' | 'not_found' | 'restricted' | 'error'; message: string; error?: string };

/* ── Planejar: GET /api/dashboard/site/[projectId]/plan ───────────────── */

export interface GanttActivity {
  id: string;
  parentId: string | null;
  wbs: string | null;
  title: string;
  /** Nível no cronograma (0 = raiz). */
  level: number;
  start: string | null;
  finish: string | null;
  percent: number | null;
  status: string;
  statusLabel: string;
  isSummary: boolean;
  isMilestone: boolean;
  /** Prioridade crítica no cronograma (não é caminho crítico calculado). */
  critical: boolean;
  overdue: boolean;
  blocked: boolean;
  /** A necessidade mais cedo dos requisitos desta atividade (`required_by`), quando há. */
  needBy: string | null;
  /** Algum requisito desta atividade com falta. */
  atRisk: boolean;
  href: string;
}

export interface GanttLink { from: string; to: string; type: 'FS' | 'SS' | 'FF' | 'SF'; lagDays: number }

export interface ActivityNeed {
  id: string;
  title: string;
  type: string;
  typeLabel: string;
  qty: number | null;
  unit: string | null;
  requiredBy: string | null;
  /** `covered` / `partial` / `short` pela cobertura viva; `unknown` quando o requisito não tem cobertura calculável. */
  status: 'covered' | 'partial' | 'short' | 'unknown';
  statusLabel: string;
  coverage: { required: number; covered: number; shortage: number } | null;
  href: string;
}

export interface SitePlanData {
  window: { start: string; end: string };
  activities: GanttActivity[];
  links: GanttLink[];
  /** A atividade em foco ao abrir: a mais crítica (em risco → vencida → crítica → próxima). */
  focus: string | null;
  needsByActivity: Record<string, SectionState<ActivityNeed[]>>;
  truncated: boolean;
}

export type SitePlanResponse = ({ ok: true; today: string; project: { id: string; name: string } } & { plan: SectionState<SitePlanData> })
  | { ok: false; reason: 'invalid' | 'not_found' | 'restricted' | 'error'; message: string; error?: string };

/* ── Supply Chain: GET /api/dashboard/site/[projectId]/supply ─────────── */

/** De onde veio a necessidade — dito como é (nunca "a IA analisou" quando a regra é determinística). */
export interface NeedOrigin {
  source: 'ACTIVITY' | 'SERVICE_ORDER' | 'AI_PROPOSAL' | 'MANUAL' | 'OTHER';
  /** "Do cronograma: Lançamento de cabos (início 30/09)" · "Da OS OS-QA-2026-0301" · "Registro manual, sem atividade". */
  label: string;
  serviceOrder: { id: string; number: string; href: string } | null;
  activity: { id: string; title: string; start: string | null } | null;
  /** Só `true` quando o item da OS foi lido pela Apex no PDF (origin document_extraction + ai_model). */
  readByAi: boolean;
}

export interface MaterialBalance {
  requirementId: string;
  title: string;
  /** Origem da necessidade (cronograma / OS / manual). `null` = não foi possível ler. */
  origin: NeedOrigin | null;
  item: { id: string; code: string | null; description: string | null; unit: string | null } | null;
  activity: { id: string; title: string; start: string | null } | null;
  needBy: string | null;
  /** Números da cobertura VIVA (`supply_requirement_coverage`), na unidade do requisito. */
  required: number;
  reserved: number;
  consumed: number;
  inTransit: number;
  onOrder: number;
  requested: number;
  covered: number;
  inbound: number;
  inspection: number;
  shortage: number;
  risk: 'critical' | 'high' | 'medium' | 'ok';
  href: string;
}

/** Onde o MESMO item está disponível na rede (outros locais), com posição quando cadastrada. */
export interface StockNode {
  locationId: string;
  code: string | null;
  name: string;
  kind: string;
  kindLabel: string;
  lat: number | null;
  lng: number | null;
  onHand: number;
  reserved: number;
  available: number;
  /** O canteiro deste projeto. */
  isSite: boolean;
}

export interface InboundOrder {
  poId: string;
  number: string | null;
  supplier: { id: string; name: string } | null;
  status: string;
  statusLabel: string;
  expected: string | null;
  /** Chegada prevista DEPOIS da necessidade do requisito em foco. */
  late: boolean;
  lateDays: number | null;
  qty: number | null;
  /** Valor só com a leitura financeira de compras; `null` = restrito ou sem valor. */
  amountText: string | null;
  href: string;
}

/** A decisão da caixa desta pessoa ligada a este material/pedido — aprovada AQUI pelo mesmo ato de Decisões. */
export interface SupplyDecision {
  key: string;
  href: string;
  kindLabel: string;
  title: string;
  amountText: string | null;
  amountRestricted: boolean;
  due: string | null;
  overdue: boolean;
  poId: string | null;
}

export interface SiteSupplyData {
  /** O material em foco: a falta mais grave do projeto (risco → necessidade mais cedo). */
  focus: MaterialBalance | null;
  materials: MaterialBalance[];
  /** Posições do item em foco na rede. `restricted` sem leitura de estoque. */
  stock: SectionState<StockNode[]>;
  /** Pedidos abertos para o item/requisito em foco. `restricted` sem leitura de compras. */
  orders: SectionState<InboundOrder[]>;
  /** O plano/achados da Apex para o material em foco (sinais abertos com evidência). */
  apex: SectionState<ApexNote[]>;
  decisions: SectionState<SupplyDecision[]>;
  site: { lat: number; lng: number } | null;
  /** O plano da Apex (regra determinística sobre a cobertura viva + posições de estoque): reservar → transferir → comprar. */
  plan: SectionState<SupplyPlan>;
  /** Solicitação(ões) de compra do requisito em foco, com cotações, propostas e decisão. `restricted` sem leitura de compras. */
  procurement: SectionState<{ requisitions: RequisitionView[] }>;
  /** Fornecedores HOMOLOGADOS candidatos para o item (categoria do item ou histórico de cotação/pedido do item). */
  suppliers: SectionState<SupplierCandidate[]>;
  /** O que ESTA pessoa pode fazer aqui (espelha as permissões das rotas governadas). */
  capabilities: SupplyCapabilities;
  truncated: boolean;
}

export type SiteKind = 'substation' | 'transmission' | 'solar' | 'hydro' | 'wind' | 'generic';

export interface SiteKindDetection {
  kind: SiteKind;
  /** De onde veio a classificação (ex.: ['nome', 'OS', 'itens']). */
  basis: string[];
  /** Os termos que casaram (ex.: ['SE', '138 kV', 'DISJ-']). */
  matched: string[];
}

export type PlanStepKind = 'reserve' | 'transfer' | 'buy';

/** Um passo do plano. A ação é a rota GOVERNADA que já existe; `null` = sem permissão ou não executável agora. */
export interface SupplyPlanStep {
  kind: PlanStepKind;
  qty: number;
  unit: string | null;
  /** Origem física (reservar/transferir); `null` para comprar. */
  from: { locationId: string; name: string; lat: number | null; lng: number | null } | null;
  /** "Reservar 300 m no Canteiro SE Tucuruí" · "Transferir 250 m do Canteiro LT Marabá" · "Comprar 250 m". */
  label: string;
  /** `pending` = já pedido e aguardando outra pessoa (ex.: transferência aguardando aprovação no Estoque) — nem feito, nem a pedir de novo. */
  status: 'suggested' | 'pending' | 'done' | 'blocked';
  /** Por que está feito/bloqueado (ex.: "já requisitado (500 m) — RC-260924-C451E"). */
  reason: string | null;
  action: { method: 'POST'; href: string; body: Record<string, unknown>; permission: string; confirm: string } | null;
}

export interface SupplyPlan {
  steps: SupplyPlanStep[];
  /** Falta que sobra depois de reservar e transferir (o que precisa ser comprado). */
  remainingShortage: number;
  /** A base do plano, em uma linha ("Cobertura viva + estoque em 3 locais"). */
  basis: string;
}

export interface QuoteOption {
  quoteId: string;
  supplier: { id: string; name: string; homologated: boolean; onTimeRate: number | null };
  /** Custo total posto (preço + frete + impostos), formatado; `null` = restrito. */
  totalText: string | null;
  unitPriceText: string | null;
  leadDays: number | null;
  /** Chegada estimada (hoje + prazo). */
  eta: string | null;
  /** Chega até a necessidade. `null` = sem prazo informado. */
  onTime: boolean | null;
  lateDays: number | null;
  paymentTerms: string | null;
  validity: string | null;
  recommended: boolean;
  cheapest: boolean;
  /** Veredito em português, do `evaluateQuotes` (ex.: "Chega 7 dias depois da necessidade"). */
  verdict: string;
}

export interface RfqView {
  id: string;
  number: string;
  status: 'OPEN' | 'DECIDED' | 'CANCELLED';
  statusLabel: string;
  responseDue: string | null;
  /** Convidados, com contato cadastrado e se a cotação JÁ FOI ENVIADA (e-mail registrado). */
  invited: Array<{ supplierId: string; name: string; hasContact: boolean; sentAt: string | null }>;
  quotes: QuoteOption[];
  /** A recomendação da Apex (`recommendQuote`) e o porquê, em uma frase. */
  recommendation: { quoteId: string | null; text: string } | null;
  decision: {
    quoteId: string;
    followsRecommendation: boolean;
    poId: string | null;
    poNumber: string | null;
    poStatus: string | null;
    poStatusLabel: string | null;
    /** Chave em Decisões quando o pedido aguarda aprovação (aprovado aqui pelo MESMO ato). */
    decisionKey: string | null;
  } | null;
  href: string;
}

export interface RequisitionView {
  id: string;
  number: string;
  status: string;
  statusLabel: string;
  qty: number;
  unit: string | null;
  requiredBy: string | null;
  lineId: string | null;
  href: string;
  rfqs: RfqView[];
}

export interface SupplierCandidate {
  supplierId: string;
  name: string;
  status: 'HOMOLOGATED' | 'PROSPECT';
  categories: string[];
  contactName: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  onTimeRate: number | null;
  leadDays: number | null;
  /** Por que é candidato: a categoria do item, o histórico com o item, ou ambos. */
  basis: 'category' | 'history' | 'both';
}

export interface SupplyCapabilities {
  request: boolean;
  source: boolean;
  approve: boolean;
  suppliersManage: boolean;
  reserve: boolean;
  transfer: boolean;
  /** Busca de fornecedores na internet pela Apex (IA + busca web). Desligada = `available:false` com o motivo. */
  aiSearch: { available: boolean; reason: string | null };
}

/* ── Apex busca fornecedores na internet: POST /api/dashboard/site/[projectId]/supply/discover ── */

export interface ExternalSupplierCandidate {
  name: string;
  cnpj: string | null;
  site: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  uf: string | null;
  country: string | null;
  /** URLs das fontes (só as que vieram dos resultados da busca). */
  evidenceUrls: string[];
  confidence: 'high' | 'medium' | 'low';
  note: string | null;
}

export type SupplierDiscoveryResponse =
  | { ok: true; runAt: string; provider: string; model: string; query: string; candidates: ExternalSupplierCandidate[] }
  | { ok: false; reason: 'ai_unavailable' | 'invalid' | 'restricted' | 'error'; message: string; error?: string };

export type SiteSupplyResponse = ({ ok: true; today: string; project: { id: string; name: string } } & { supply: SectionState<SiteSupplyData> })
  | { ok: false; reason: 'invalid' | 'not_found' | 'restricted' | 'error'; message: string; error?: string };

/* ── Faturamento: GET /api/dashboard/site/[projectId]/billing ─────────── */

export type EventogramState = 'awaiting' | 'eligible' | 'pending_release' | 'released' | 'invoiced' | 'receivable' | 'paid' | 'blocked' | 'cancelled';

export interface EventogramRow {
  billingEventId: string;
  contractId: string;
  title: string;
  /** Valor do evento, formatado; `null` = restrito (sem leitura financeira) ou sem valor. */
  amount: string | null;
  state: EventogramState;
  stateLabel: string;
  measurement: { id: string; status: string; statusLabel: string } | null;
  fiscal: { number: string | null; status: string | null; statusLabel: string | null } | null;
  receivable: { due: string | null; state: string | null; stateLabel: string | null } | null;
  href: string;
}

export interface SiteBillingData {
  contracts: Array<{ id: string; label: string }>;
  /** Soma dos eventos (direito contratual) — só com a leitura financeira. */
  total: string | null;
  rows: EventogramRow[];
  /** O evento em foco: o primeiro elegível/pendente de liberação, senão o próximo a faturar. */
  focus: string | null;
  /** Referência "Entender" do evento em foco (`bill:<id>`) — a cadeia vem do endpoint explain. */
  focusExplainRef: string | null;
}

export type SiteBillingResponse = ({ ok: true; today: string; project: { id: string; name: string } } & { billing: SectionState<SiteBillingData> })
  | { ok: false; reason: 'invalid' | 'not_found' | 'restricted' | 'error'; message: string; error?: string };

