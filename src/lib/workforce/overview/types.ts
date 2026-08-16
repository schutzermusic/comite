/**
 * Contrato do cockpit de Pessoas & Custos — modelo único da Visão Geral.
 *
 * ─── A regra que este arquivo existe para sustentar ────────────────────────
 *
 * Pessoas & Custos exibe SOMENTE dado apurado. Onde não há fonte, a interface
 * diz "não apurado": nunca `0`, nunca um valor derivado. A razão é simples e
 * já custou caro uma vez: depois de formatado na tela, um número modelado é
 * indistinguível de um número apurado. A única defesa é não produzi-lo.
 *
 * Até aqui a regra era convenção — dezenas de `!== undefined` espalhados pelos
 * seletores, pelos painéis e pela página. Convenção não escala para quatro
 * superfícies (tela, PDF, deck HTML e PowerPoint): basta um `?? 0` distraído em
 * qualquer uma delas para o cockpit afirmar o que ninguém mediu.
 *
 * `Measured<T>` move a regra para o tipo. Ausente e zero deixam de ser valores
 * diferentes e passam a ser FORMAS diferentes — o compilador não deixa somar,
 * formatar ou comparar um indicador sem antes decidir o que fazer quando ele
 * não existe. Cada renderizador tem um único ponto onde "não medido" vira
 * pixel, e é impossível esquecer de passar por ele.
 *
 * ─── Fronteiras ────────────────────────────────────────────────────────────
 *
 * Este módulo não importa React nem `period.ts`. Ele é o vocabulário comum
 * entre `model.ts` (que compõe a partir dos seletores) e `report/*` (que
 * desenha), e precisa rodar em Node para a rota do PowerPoint e o harness de QA.
 */

import type {
  CostConcentrationData,
  CostCenter,
  PayrollRiskData,
  RiskStatus,
} from '@/lib/workforce-data';
import type { CompetenceCoverage } from '@/lib/workforce/esocial-coverage';
import type { ReportBranding } from '@/lib/reports/report-branding';
import type { ComplianceSnapshot, EsocialLinkState } from '@/lib/workforce/compliance';
import type { PayrollClosingBatch } from '@/lib/types/payroll-closing';
import type {
  AbsenteeismMonthlyPoint,
  AbsenteeismPoint,
  AdmissionDismissalPoint,
  AreaTurnoverPoint,
  BenefitTypePoint,
  EfficiencyPoint,
  MonthlyIndicatorMatrix,
  OvertimePoint,
  PayrollCompositionPoint,
  PayrollVsRevenuePoint,
  SCurvePoint,
  TurnoverPoint,
  WorkforceAlert,
  WorkforcePeriodKey,
  WorkforceTrendPoint,
} from '@/lib/workforce/period';

// ═══════════════════════════════════════════════════════════════════════════
// Measured<T> — apurado ou explicitamente não apurado
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Por que um indicador não pôde ser apurado.
 *
 * O motivo importa: "sem fonte" e "não se reparte por este recorte" pedem
 * mensagens diferentes na tela, e um deles é culpa do filtro que o usuário
 * acabou de aplicar — informação acionável, não desculpa genérica.
 */
export type UnmeasuredReason =
  /** A fonte nunca entregou o dado (rubricas não classificadas, eSocial mudo). */
  | 'no-source'
  /** Não há período de comparação: 'Todo período', ou a primeira competência. */
  | 'no-baseline'
  /** Existe no total, mas não se reparte pelo recorte aplicado. */
  | 'not-attributable'
  /** As duas pontas da razão não foram medidas (folha sem receita). */
  | 'not-comparable'
  /** A permissão do usuário não alcança a fonte (SST, série salarial). */
  | 'no-permission';

export type Measured<T> =
  | { readonly measured: true; readonly value: T }
  | { readonly measured: false; readonly reason: UnmeasuredReason; readonly note?: string };

export const measured = <T>(value: T): Measured<T> => ({ measured: true, value });

export const unmeasured = <T = never>(
  reason: UnmeasuredReason,
  note?: string,
): Measured<T> => ({ measured: false, reason, note });

/**
 * Único construtor usado por `model.ts`.
 *
 * Só produz `measured` quando o valor existe de fato — é o que impede um
 * `undefined` de virar zero na travessia entre o seletor e o modelo.
 */
export const fromNullable = <T>(
  value: T | null | undefined,
  reason: UnmeasuredReason,
  note?: string,
): Measured<T> =>
  value === null || value === undefined ? unmeasured<T>(reason, note) : measured(value);

/** Valor apurado, ou o fallback. Use só onde "não apurado" já foi tratado. */
export const orElse = <T>(m: Measured<T>, fallback: T): T => (m.measured ? m.value : fallback);

/** Encadeia sem perder o motivo da ausência. */
export const mapMeasured = <T, U>(m: Measured<T>, fn: (value: T) => U): Measured<U> =>
  m.measured ? measured(fn(m.value)) : m;

/** Frase pronta para a interface e para os relatórios. */
export const UNMEASURED_LABEL: Record<UnmeasuredReason, string> = {
  'no-source': 'não apurado',
  'no-baseline': 'sem base de comparação',
  'not-attributable': 'não atribuível neste recorte',
  'not-comparable': 'não apurável',
  'no-permission': 'sem permissão',
};

// ═══════════════════════════════════════════════════════════════════════════
// Recorte
// ═══════════════════════════════════════════════════════════════════════════

/** Como o quadro do mês foi estabelecido. Substitui o PJ/CLT, que não tem fonte. */
export type HeadcountSourceFilter = 'all' | 'esocial' | 'manual';

export interface WorkforceOverviewFilters {
  /** Ids da dimensão unificada (centro de custo + lotação). Vazio = sem recorte. */
  unitIds: string[];
  headcountSource: HeadcountSourceFilter;
}

export const EMPTY_WORKFORCE_FILTERS: WorkforceOverviewFilters = {
  unitIds: [],
  headcountSource: 'all',
};

/**
 * O que o recorte impediu de apurar.
 *
 * A lista é o que separa "este indicador não existe" de "este indicador existe,
 * mas não sobrevive ao filtro que você aplicou" — e é renderizada em prosa
 * acima da seção afetada, não escondida num tooltip.
 */
export interface Degradation {
  field: 'revenue' | 'headcount' | 'composition' | 'benefits' | 'overtime' | 'absenceEvents';
  reason: UnmeasuredReason;
  /** Frase pronta, em pt-BR, explicando a consequência para quem lê. */
  humanLabel: string;
}

/**
 * Unidade organizacional — centro de custo e lotação unificados.
 *
 * As duas são a MESMA dimensão no caminho do eSocial (os centros de custo são
 * sintetizados a partir das lotações, com id `esocial-<código>`) e disjuntas no
 * caminho do lote de folha. Dois filtros separados seriam redundantes metade do
 * tempo e silenciosamente inconsistentes na outra metade.
 */
export interface WorkforceUnit {
  id: string;
  label: string;
  origin: 'payroll-batch' | 'esocial-lotacao' | 'both';
  /**
   * O que esta unidade sabe responder. Um centro de custo vindo só do lote de
   * folha carrega valor mas não carrega quadro — quem for filtrar precisa ver
   * isso ANTES de escolher, não descobrir depois pelo traço no KPI.
   */
  carries: {
    payroll: boolean;
    headcount: boolean;
    movement: boolean;
    absence: boolean;
  };
  /** Competências em que a unidade aparece. */
  competences: string[];
  /** Folha acumulada — ordena o seletor pelo que pesa. */
  totalPayroll: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Comparação
// ═══════════════════════════════════════════════════════════════════════════

export type ComparisonMode = 'previous-period' | 'same-period-last-year' | 'none';

export const COMPARISON_OPTIONS: { value: ComparisonMode; label: string }[] = [
  { value: 'previous-period', label: 'Período anterior' },
  { value: 'same-period-last-year', label: 'Mesmo período do ano anterior' },
  { value: 'none', label: 'Sem comparação' },
];

export const DEFAULT_COMPARISON_MODE: ComparisonMode = 'previous-period';

// ═══════════════════════════════════════════════════════════════════════════
// KPI
// ═══════════════════════════════════════════════════════════════════════════

export type KpiGroup = 'volume' | 'custo' | 'eficiencia' | 'conformidade';
export type KpiFormat = 'currency' | 'int' | 'pct' | 'ratio' | 'text';
export type KpiTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface KpiDelta {
  /** Variação percentual sobre a base. */
  pct: number;
  /** Variação absoluta, na unidade do próprio KPI. */
  abs: number;
  /** 'vs mês anterior', 'vs Abr/2025'… */
  label: string;
  /** Se subir é bom. Define a cor, não o sinal. */
  upIsGood: boolean;
}

/**
 * O contrato de KPI compartilhado pela tela e pelos três exports.
 *
 * É o mecanismo central contra divergência: a faixa executiva da tela, a do
 * PDF, a do deck e a do PowerPoint consomem este MESMO array. Não existe um
 * caminho em que um deles formate o número por conta própria.
 */
export interface WorkforceKpi {
  id: string;
  group: KpiGroup;
  label: string;
  value: Measured<number>;
  format: KpiFormat;
  /** Texto pronto quando `format: 'text'` (ex.: "12 · 4"). */
  display?: Measured<string>;
  helper?: string;
  delta: Measured<KpiDelta>;
  sparkline?: number[];
  tone?: KpiTone;
  /** Para onde o clique leva na tela. Ignorado nos exports. */
  target?: { kind: 'route' | 'anchor'; to: string };
}

// ═══════════════════════════════════════════════════════════════════════════
// Sinais
// ═══════════════════════════════════════════════════════════════════════════

export type SignalLevel = 'ok' | 'warn' | 'error';

/**
 * Um sinal do radar de risco.
 *
 * Só entra na lista o indicador que foi APURADO. O radar antigo empurrava um
 * chip verde "Crescimento · alinhado com receita" mesmo sem receita nenhuma —
 * folha e receita ambas em zero passavam nos limiares e acendiam a luz verde.
 * Sinal sem medição não é sinal bom: é ausência de sinal.
 */
export interface WorkforceSignal {
  id: string;
  level: SignalLevel;
  label: string;
  detail: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Modelo
// ═══════════════════════════════════════════════════════════════════════════

export interface WorkforceOverviewMeta {
  periodLabel: string;
  periodKey: WorkforcePeriodKey;
  monthsInRange: number;
  aggregation: 'point' | 'average';
  comparison: {
    mode: ComparisonMode;
    /** 'vs mês anterior' | 'vs Abr/2025'. Não apurado quando não há base. */
    label: Measured<string>;
    /** A janela que serviu de base: 'Jan/2025 – Mar/2025'. */
    windowLabel: Measured<string>;
  };
  /** Legenda humana do recorte — idêntica na tela e nos três documentos. */
  filtersLabel: string;
  generatedAt: string;
  source: string;
  coverage: Measured<CompetenceCoverage>;
  /** @deprecated Use `branding.companyName`. Mantido para consumidores antigos. */
  brandName: string;
  /**
   * Marca da empresa nos documentos.
   *
   * Vive no modelo, e não em cada construtor, porque é o modelo que garante
   * que os quatro destinos mostrem a MESMA marca — o mesmo motivo pelo qual os
   * KPIs vivem aqui.
   */
  branding: ReportBranding;
}

export interface WorkforceOverviewScope {
  filters: WorkforceOverviewFilters;
  degradations: Degradation[];
  unitsInScope: WorkforceUnit[];
  /** Todas as unidades da série, filtradas ou não — alimenta o seletor. */
  allUnits: WorkforceUnit[];
  /** Nenhuma fonte real produziu competência: não há cockpit a desenhar. */
  hasData: boolean;
}

export interface WorkforceExecutive {
  /** A frase que abre o relatório e o resumo da tela. */
  headline: string;
  kpis: WorkforceKpi[];
  signals: WorkforceSignal[];
  risk: {
    score: Measured<number>;
    status: Measured<RiskStatus>;
    payrollGrowth: Measured<number>;
    revenueGrowth: Measured<number>;
    message: string;
    /**
     * O dado bruto do seletor, para os componentes que ainda o consomem
     * inteiro. Só deve ser lido DEPOIS de checar `score.measured` — é por isso
     * que os campos apurados vêm acima, e não porque haja dois números
     * diferentes: são o mesmo, um deles já qualificado.
     */
    raw: PayrollRiskData;
  };
  alerts: WorkforceAlert[];
}

export interface WorkforceEfficiency {
  series: EfficiencyPoint[];
  revenuePerEmployee: Measured<number>;
  costPerEmployee: Measured<number>;
  payrollAsRevenuePct: Measured<number>;
  /** Limite de política do módulo — constante, não fonte apurada. */
  threshold: number;
}

export interface WorkforceDynamics {
  movement: AdmissionDismissalPoint[];
  turnover: TurnoverPoint[];
  turnoverByArea: AreaTurnoverPoint[];
  absenteeismByArea: AbsenteeismPoint[];
  absenteeismMonthly: AbsenteeismMonthlyPoint[];
  overtime: OvertimePoint[];
  headcountSource: Measured<'esocial' | 'manual'>;
  latestTurnoverPct: Measured<number>;
  latestOvertimePct: Measured<number>;
  maxAbsenteeismPct: Measured<number>;
}

export interface WorkforceCostStructure {
  composition: PayrollCompositionPoint[];
  benefits: BenefitTypePoint[];
  scurve: SCurvePoint[];
  vsRevenue: PayrollVsRevenuePoint[];
  /** Folha, quadro e custo médio mês a mês — a série da tendência. */
  trend: WorkforceTrendPoint[];
  matrix: MonthlyIndicatorMatrix;
  totalPayrollAccum: number;
  benefitsTotal: Measured<number>;
  chargesTotal: Measured<number>;
  /** Participação do salário direto na folha classificada. */
  directPct: Measured<number>;
}

export interface WorkforceConcentration {
  data: CostConcentrationData;
  top3: Measured<number>;
  abnormal: CostCenter[];
  /**
   * Se a janela do período tem window anterior na série.
   *
   * `CostCenter.growthVsPrevious` é `0` quando não há base — o seletor resolve
   * assim de propósito ("sem mês anterior, a variação é 0, que é o que se
   * sabe"). Só que `0,0%` numa coluna de variação AFIRMA estabilidade, e quem
   * lê um relatório de board não tem como distinguir isso de "não havia contra
   * o que comparar". Esta bandeira permite exibir o traço no lugar.
   */
  hasBaseline: boolean;
  /** Centro selecionado via `?costCenterId=`. Só a tela usa. */
  drilldown: CostCenter | null;
}

export interface WorkforceComplianceKpiValues {
  admissions: Measured<number>;
  terminations: Measured<number>;
  activeAbsences: Measured<number>;
  catsInMonth: Measured<number>;
  asoExpired: Measured<number>;
  asoExpiring: Measured<number>;
  workersWithoutAso: Measured<number>;
  withoutRaise12m: Measured<number>;
}

export interface WorkforceComplianceBlock {
  snapshot: ComplianceSnapshot;
  byCompetence: Record<string, { payrollStatus: PayrollClosingBatch['status'] | 'missing'; score: number }>;
  kpis: WorkforceComplianceKpiValues;
  esocialLink: EsocialLinkState;
  currentCompetence: string;
  currentCompetenceLabel: string;
}

/**
 * Sementes do simulador.
 *
 * `Measured` de propósito: a página alimentava o simulador com
 * `latestEfficiency?.revenue ?? 0`, e uma receita zerada por ausência produzia
 * uma simulação de impacto catastrófico por motivo inventado. Sem semente
 * apurada, o simulador pede o número em vez de supor.
 */
export interface WorkforceSimulatorSeed {
  avgCostPerEmployee: Measured<number>;
  currentPayroll: Measured<number>;
  currentRevenue: Measured<number>;
  currentHeadcount: Measured<number>;
  payrollRevenueThreshold: number;
}

/** O payload único: uma origem para a tela e para os três documentos. */
export interface WorkforceOverviewModel {
  meta: WorkforceOverviewMeta;
  scope: WorkforceOverviewScope;
  executive: WorkforceExecutive;
  efficiency: WorkforceEfficiency;
  dynamics: WorkforceDynamics;
  costStructure: WorkforceCostStructure;
  concentration: WorkforceConcentration;
  compliance: WorkforceComplianceBlock;
  simulator: WorkforceSimulatorSeed;
}

/** Tema dos documentos gerados. A tela segue o tema do app, independente disto. */
export type WorkforceReportTheme = 'dark' | 'light';
