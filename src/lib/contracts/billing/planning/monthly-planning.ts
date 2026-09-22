/**
 * PLANEJAMENTO MENSAL DE FATURAMENTO — lógica pura, sem JSX e sem banco.
 *
 * ─── O que este arquivo responde ───────────────────────────────────────────
 *
 *   · quanto se espera faturar neste mês, no passado e nos próximos
 *   · o que já virou evento de faturamento
 *   · o que está travado, e em qual elo
 *   · quais marcos contratuais entram nos meses à frente
 *
 * ─── O que ele NÃO faz ─────────────────────────────────────────────────────
 *
 *   · NÃO redefine o estado do marco. O estado vem de `deriveStage`, a máquina
 *     canônica de `milestone-stage.ts`. Aqui ele só é TRADUZIDO para o
 *     vocabulário do planejamento mensal. Uma segunda máquina de estado, com
 *     um `switch` só seu, divergiria da primeira no primeiro ajuste — e a
 *     tela passaria a discordar do dossiê sobre o mesmo marco.
 *
 *   · NÃO soma previsto com faturado. `plannedTotal`, `eligibleTotal`,
 *     `billedTotal` e `receivedTotal` são quatro somas SEPARADAS, cada uma com
 *     a sua origem. Previsão somada a realizado é receita inventada.
 *
 *   · NÃO inventa mês. Marco sem data prevista cai em `undated`, que é uma
 *     lista de verdade — e não o mês corrente, que é o erro que faz a carteira
 *     parecer completa quando metade dela não tem cronograma.
 *
 *   · NÃO olha `percentComplete`. Nunca, em nenhuma expressão deste arquivo.
 */

import { deriveStage, type MilestoneStage } from '../../measurement/milestone-stage';
import type { MilestoneWorkbenchRow } from '../../measurement/milestone-workbench-types';
import type { BillingMonthPlanRow } from './month-plan-types';

// ═══════════════════════════════════════════════════════════════════════════
// O VOCABULÁRIO DO PLANEJAMENTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Onde o marco está, na linguagem de quem planeja o mês.
 *
 * Mutuamente exclusivo, como o estágio de que deriva. Repare que `BILLED` e
 * `RECEIVED` são estados DIFERENTES: faturar é emitir o direito de cobrar;
 * receber é o dinheiro entrar, e só Finanças afirma isso.
 */
export type BillingPlanState =
  | 'PLANNED'
  | 'AWAITING_PROJECT_MILESTONE'
  | 'AWAITING_MEASUREMENT'
  | 'AWAITING_EVIDENCE'
  | 'AWAITING_APPROVAL'
  | 'ELIGIBLE'
  | 'BILLED'
  | 'RECEIVED'
  | 'BLOCKED'
  | 'NOT_ASSESSED';

export const BILLING_PLAN_STATE_LABEL: Record<BillingPlanState, string> = {
  PLANNED: 'Previsto',
  AWAITING_PROJECT_MILESTONE: 'Aguardando marco do projeto',
  AWAITING_MEASUREMENT: 'Aguardando medição',
  AWAITING_EVIDENCE: 'Aguardando evidência',
  AWAITING_APPROVAL: 'Aguardando aprovação',
  ELIGIBLE: 'Elegível para faturar',
  BILLED: 'Faturado',
  RECEIVED: 'Recebido',
  BLOCKED: 'Bloqueado',
  NOT_ASSESSED: 'Não apurado',
};

/**
 * Os quatro TONS que a tela usa — e a regra visual que eles carregam.
 *
 * `dashed` é o vocabulário reservado do dossiê para NÃO APURADO, e ele segue
 * valendo aqui: previsto contratual e nota emitida não podem ter a mesma cara.
 */
export type PlanTone = 'planned' | 'eligible' | 'billed' | 'received' | 'attention' | 'critical';

export const BILLING_PLAN_STATE_TONE: Record<BillingPlanState, PlanTone> = {
  PLANNED: 'planned',
  AWAITING_PROJECT_MILESTONE: 'planned',
  AWAITING_MEASUREMENT: 'attention',
  AWAITING_EVIDENCE: 'attention',
  AWAITING_APPROVAL: 'attention',
  ELIGIBLE: 'eligible',
  BILLED: 'billed',
  RECEIVED: 'received',
  BLOCKED: 'critical',
  NOT_ASSESSED: 'planned',
};

/** Estado que ainda NÃO virou evento de faturamento. */
export const OPEN_PLAN_STATES: readonly BillingPlanState[] = [
  'PLANNED', 'AWAITING_PROJECT_MILESTONE', 'AWAITING_MEASUREMENT',
  'AWAITING_EVIDENCE', 'AWAITING_APPROVAL', 'ELIGIBLE', 'BLOCKED', 'NOT_ASSESSED',
];

export const BILLING_PLAN_STATE_ORDER: readonly BillingPlanState[] = [
  'BLOCKED', 'ELIGIBLE', 'AWAITING_APPROVAL', 'AWAITING_EVIDENCE',
  'AWAITING_MEASUREMENT', 'AWAITING_PROJECT_MILESTONE', 'PLANNED',
  'BILLED', 'RECEIVED', 'NOT_ASSESSED',
];

// ═══════════════════════════════════════════════════════════════════════════
// A PONTE ATÉ A MÁQUINA CANÔNICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Monta, a partir da linha do planejamento, a forma que `deriveStage` consome.
 *
 * Campos que a visão do planejamento não traz entram com o valor que os
 * TORNA INERTES na derivação — nunca com um palpite:
 *
 *   · `measurementSubmittedAt` não é lido por `deriveStage` (só o status é),
 *     então `null` não muda nada.
 *   · `entitlementRuleCount` é reconstruído do próprio valor do direito: há
 *     direito registrado se, e somente se, há quantia de direito.
 *   · os campos de sobreposição (`ownerUserId`, prazos) entram fielmente
 *     porque são de graça; mas este módulo só usa `deriveStage`, e não
 *     `deriveOverlays` — atraso, aqui, é atraso de DATA PREVISTA, que é outra
 *     pergunta e tem função própria (`isPlannedDateOverdue`).
 */
function toStageInput(row: BillingMonthPlanRow): MilestoneWorkbenchRow {
  return {
    id: row.milestoneId,
    organizationId: row.organizationId,
    contractId: row.contractId,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    milestoneType: null,
    status: row.status,
    dueDate: row.milestoneDueDate,
    completedAt: row.completedAt,
    billingAmount: row.billingAmount,
    measuredAmount: row.measuredAmount,
    ownerUserId: row.milestoneOwnerUserId,
    evidence: row.evidence,
    evidenceDocumentId: row.evidenceDocumentId,

    entitlementAmount: row.entitlementAmount,
    entitlementCurrency: row.currency,
    entitlementSourceDocumentId: null,
    entitlementSourcePage: null,
    entitlementSourceReference: null,
    entitlementRuleCount: row.entitlementAmount !== null ? 1 : 0,

    requirementId: row.requirementId,
    requirementCount: row.requirementId !== null ? 1 : 0,
    customerAcceptanceRequired: row.customerAcceptanceRequired,
    evidenceRequired: row.evidenceRequired,
    requiredDocumentType: null,
    reportRequired: null,
    technicalReportRequired: null,

    governedMappingCount: row.governedMappingCount,
    timelineItemId: row.timelineItemId,
    timelineProjectId: row.projectId,
    timelineTitle: row.timelineTitle,
    timelineWbsCode: row.timelineWbsCode,
    timelineStatus: row.timelineStatus,
    timelinePercentComplete: row.timelinePercentComplete,
    timelinePlannedFinish: row.timelinePlannedFinish,
    timelineActualFinish: row.timelineActualFinish,

    measurementId: row.measurementId,
    measurementStatus: row.measurementStatus,
    measurementReadiness: row.measurementReadiness,
    measurementReadinessReasons: [],
    measurementExpectedAt: row.measurementExpectedAt,
    measurementSubmittedAt: null,
    measurementAcceptedAt: row.measurementAcceptedAt,
    acceptedValue: row.acceptedValue,
    acceptedCurrency: row.currency,
    measurementEvidenceCount: row.measurementEvidenceCount,
    measurementMissingRequirementCount: null,

    billingEventId: row.billingEventId,
    billingEligibilityState: row.billingEligibilityState,
    billingReleaseState: row.billingReleaseState,
    billingEligibleAmount: row.billingEligibleAmount,
    billingCurrency: row.currency,
    billingAmountSource: row.billingAmountSource,
    billingFiscalDocumentStatus: row.billingFiscalDocumentStatus,
    billingReceivableStatus: row.billingReceivableStatus,
    billingFinanceLinkState: row.billingFinanceLinkState,
  };
}

/** Tradução do estágio canônico para o vocabulário do planejamento mensal. */
const STATE_BY_STAGE: Record<MilestoneStage, BillingPlanState> = {
  BILLED: 'BILLED',
  READY_TO_BILL: 'ELIGIBLE',
  // Análise contratual e aceite da Contratante caem no MESMO estado de
  // planejamento — nenhum dos dois libera faturamento —, e continuam sendo
  // estágios distintos onde a distinção importa: no rótulo e no prazo.
  AWAITING_CONTRACT_REVIEW: 'AWAITING_APPROVAL',
  AWAITING_ACCEPTANCE: 'AWAITING_APPROVAL',
  AWAITING_EVIDENCE: 'AWAITING_EVIDENCE',
  READY_TO_MEASURE: 'AWAITING_MEASUREMENT',
  BLOCKED: 'BLOCKED',
  TRIGGER_PENDING: 'AWAITING_PROJECT_MILESTONE',
  UNMAPPED: 'PLANNED',
  UNINSTRUMENTED: 'PLANNED',
  CANCELLED: 'NOT_ASSESSED',
  UNKNOWN: 'NOT_ASSESSED',
};

/**
 * O estado de planejamento do marco.
 *
 * RECEBIDO vem à frente de tudo e SÓ de Finanças: `billingReceivableStatus ===
 * 'PAID'` é a afirmação de liquidação, derivada de pagamento registrado. A
 * ausência de evento de faturamento nunca vira "recebido", e nenhum campo de
 * Contratos promove caixa.
 */
export function deriveBillingPlanState(row: BillingMonthPlanRow): BillingPlanState {
  if (row.billingReceivableStatus === 'PAID') return 'RECEIVED';
  return STATE_BY_STAGE[deriveStage(toStageInput(row)).stage];
}

// ═══════════════════════════════════════════════════════════════════════════
// ATRASO — três perguntas diferentes, três respostas diferentes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ATRASO DE CRONOGRAMA vs. OBRIGAÇÃO CONTRATUAL VENCIDA vs. ATRASO DE
 * FATURAMENTO. Colapsar os três num "atrasado" só é o erro que transforma um
 * replanejamento de obra em acusação de inadimplência contratual.
 */
export type DelayKind =
  /** A data PREVISTA (do cronograma) passou e o gatilho não foi evidenciado. */
  | 'SCHEDULE_MILESTONE_OVERDUE'
  /** O PRAZO do próprio marco contratual passou sem conclusão registrada. */
  | 'CONTRACT_DUE_DATE_PASSED'
  /** Elegível para faturar há dias, e ninguém faturou. */
  | 'BILLING_DELAYED';

export const DELAY_LABEL: Record<DelayKind, string> = {
  SCHEDULE_MILESTONE_OVERDUE: 'Marco previsto vencido',
  CONTRACT_DUE_DATE_PASSED: 'Prazo contratual do marco vencido',
  BILLING_DELAYED: 'Faturamento pendente',
};

/**
 * Explicação de UMA linha para cada atraso — o texto que impede a leitura
 * errada. "Marco previsto vencido" é sobre o CRONOGRAMA ter passado da data;
 * não é, e não vira, declaração de inadimplemento contratual. Afirmar
 * inadimplemento exige ler o contrato e a evidência, e nenhum dos dois passa
 * por aqui.
 */
export const DELAY_MEANING: Record<DelayKind, string> = {
  SCHEDULE_MILESTONE_OVERDUE:
    'A data prevista no cronograma passou e o gatilho contratual ainda não foi '
    + 'evidenciado. É atraso de PLANEJAMENTO — não é, por si, inadimplemento contratual.',
  CONTRACT_DUE_DATE_PASSED:
    'O prazo registrado no próprio marco contratual passou sem conclusão registrada.',
  BILLING_DELAYED:
    'O marco está elegível para faturar e nenhum evento de faturamento foi gerado.',
};

const startOfDay = (value: string): number => new Date(`${value}T00:00:00`).getTime();

/** Dias corridos entre `asOf` e a data prevista. Negativo = já passou. */
export function daysUntilPlanned(row: BillingMonthPlanRow, asOf: Date): number | null {
  if (!row.plannedBillingDate) return null;
  const diff = startOfDay(row.plannedBillingDate)
    - startOfDay(asOf.toISOString().slice(0, 10));
  return Math.round(diff / 86_400_000);
}

/**
 * Os atrasos da linha. Acumuláveis, porque um marco pode estar vencido no
 * cronograma E elegível sem faturamento ao mesmo tempo.
 */
export function deriveDelays(row: BillingMonthPlanRow, asOf: Date): readonly DelayKind[] {
  const out: DelayKind[] = [];
  const state = deriveBillingPlanState(row);
  // Marco já faturado, recebido ou cancelado não está atrasado para faturar.
  const settled = state === 'BILLED' || state === 'RECEIVED' || row.status === 'cancelled';

  const days = daysUntilPlanned(row, asOf);
  // Gatilho evidenciado é `actualFinish` ou `completed` — nunca percentual.
  const triggerEvidenced = row.timelineActualFinish !== null
    || row.timelineStatus === 'completed'
    || row.completedAt !== null;
  if (!settled && days !== null && days < 0 && !triggerEvidenced) {
    out.push('SCHEDULE_MILESTONE_OVERDUE');
  }

  if (!settled && row.milestoneDueDate && row.completedAt === null
      && startOfDay(row.milestoneDueDate) < startOfDay(asOf.toISOString().slice(0, 10))) {
    out.push('CONTRACT_DUE_DATE_PASSED');
  }

  if (state === 'ELIGIBLE' && row.billingEventId === null) out.push('BILLING_DELAYED');

  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// O MÊS
// ═══════════════════════════════════════════════════════════════════════════

/** `YYYY-MM` de uma data local, sem passar por UTC (que erra o dia 1º). */
export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, (m - 1) + delta, 1);
  return monthKey(d);
}

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

export function monthShortLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)}/${String(y).slice(2)}`;
}

/**
 * Os totais de um recorte.
 *
 * QUATRO somas, quatro origens, e `null` quando não há nada apurado naquele
 * lado. Zero diria "apurei e deu zero", que é outro fato — e num painel de
 * faturamento a diferença entre "não sei" e "zero" é a diferença entre
 * investigar e comemorar.
 */
export interface BillingTotals {
  /** Direito contratual previsto, de TODOS os marcos do recorte. */
  readonly plannedTotal: number | null;
  /** Marcos sem valor previsto registrado — o previsto acima está incompleto. */
  readonly plannedUnknownCount: number;
  /** Previsto dos marcos ELEGÍVEIS. Previsão, não apuração. */
  readonly eligibleTotal: number | null;
  /** Valor do EVENTO de faturamento gerado. Apurado a jusante. */
  readonly billedTotal: number | null;
  /** Liquidado, em reais, conforme Finanças. Nunca derivado de Contratos. */
  readonly receivedTotal: number | null;
  /** Previsto dos marcos BLOQUEADOS. */
  readonly blockedTotal: number | null;
  /** Previsto dos marcos que aguardam algum elo da cadeia. */
  readonly pendingTotal: number | null;
  readonly count: number;
  readonly countByState: Readonly<Record<BillingPlanState, number>>;
}

const sumOrNull = (values: readonly (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) : null;
};

export function computeTotals(
  rows: readonly BillingMonthPlanRow[],
): BillingTotals {
  /*
    O estado é resolvido POSICIONALMENTE, num array paralelo — não num Map
    indexado por `milestoneId`.

    A versão indexada parecia mais limpa e tinha um defeito real: duas linhas
    com o mesmo id (um recorte montado a partir de duas leituras, um marco
    superado convivendo com o vigente) colidiam na chave, e a segunda impunha
    o seu estado à primeira. O sintoma seria um marco apenas previsto entrando
    na soma de ELEGÍVEL — previsão apresentada como apuração, que é o defeito
    que este módulo inteiro existe para não cometer.

    Posicional, a cardinalidade do array é a única coisa em que se confia.
  */
  const paired = rows.map((row) => ({ row, state: deriveBillingPlanState(row) }));

  const countByState = Object.fromEntries(
    BILLING_PLAN_STATE_ORDER.map((s) => [s, paired.filter((p) => p.state === s).length]),
  ) as Record<BillingPlanState, number>;

  const pendingStates: readonly BillingPlanState[] = [
    'AWAITING_PROJECT_MILESTONE', 'AWAITING_MEASUREMENT',
    'AWAITING_EVIDENCE', 'AWAITING_APPROVAL',
  ];

  return {
    plannedTotal: sumOrNull(rows.map((r) => r.plannedAmount)),
    plannedUnknownCount: rows.filter((r) => r.plannedAmount === null).length,
    eligibleTotal: sumOrNull(
      paired.filter((p) => p.state === 'ELIGIBLE').map((p) => p.row.plannedAmount)),
    // O valor do evento, e não o previsto: faturado é o que o evento apurou.
    billedTotal: sumOrNull(
      rows.filter((r) => r.billingEventId !== null).map((r) => r.billingEligibleAmount)),
    receivedTotal: sumOrNull(
      rows.map((r) => (r.receivablePaidAmountCents === null
        ? null
        : r.receivablePaidAmountCents / 100))),
    blockedTotal: sumOrNull(
      paired.filter((p) => p.state === 'BLOCKED').map((p) => p.row.plannedAmount)),
    pendingTotal: sumOrNull(
      paired.filter((p) => pendingStates.includes(p.state)).map((p) => p.row.plannedAmount)),
    count: rows.length,
    countByState,
  };
}

/**
 * A VARIAÇÃO do mês: faturado menos previsto.
 *
 * `null` quando falta qualquer um dos dois lados — e nunca zero. Um mês sem
 * nada faturado e um mês que faturou exatamente o previsto produziriam o mesmo
 * zero, e são situações opostas.
 */
export function variance(totals: BillingTotals): number | null {
  if (totals.billedTotal === null || totals.plannedTotal === null) return null;
  return totals.billedTotal - totals.plannedTotal;
}

export interface MonthBucket {
  readonly month: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly rows: readonly BillingMonthPlanRow[];
  readonly totals: BillingTotals;
  readonly variance: number | null;
  /** O mês é passado, o corrente ou futuro, em relação ao `asOf`. */
  readonly position: 'past' | 'current' | 'future';
}

export interface MonthlyPortfolio {
  readonly months: readonly MonthBucket[];
  /**
   * Marcos SEM data prevista. Não entram em mês nenhum, e a tela precisa
   * mostrá-los: é aqui que mora o contrato cujo cronograma ainda não chegou.
   */
  readonly undated: readonly BillingMonthPlanRow[];
  readonly totals: BillingTotals;
  readonly currentMonth: string;
}

/**
 * A carteira, organizada por mês previsto.
 *
 * `window` garante que os meses pedidos APAREÇAM mesmo vazios — um outubro
 * sem nada previsto é informação, e omitir a coluna faria a linha do tempo
 * pular de setembro para novembro como se outubro não existisse.
 */
export function buildMonthlyPortfolio(
  rows: readonly BillingMonthPlanRow[],
  options: { asOf: Date; window?: readonly string[] },
): MonthlyPortfolio {
  const current = monthKey(options.asOf);
  const byMonth = new Map<string, BillingMonthPlanRow[]>();
  const undated: BillingMonthPlanRow[] = [];

  for (const row of rows) {
    if (!row.plannedBillingMonth) { undated.push(row); continue; }
    const list = byMonth.get(row.plannedBillingMonth) ?? [];
    list.push(row);
    byMonth.set(row.plannedBillingMonth, list);
  }

  for (const key of options.window ?? []) {
    if (!byMonth.has(key)) byMonth.set(key, []);
  }

  const months = [...byMonth.keys()].sort().map((month): MonthBucket => {
    const monthRows = byMonth.get(month) ?? [];
    const totals = computeTotals(monthRows);
    return {
      month,
      label: monthLabel(month),
      shortLabel: monthShortLabel(month),
      rows: monthRows,
      totals,
      variance: variance(totals),
      position: month === current ? 'current' : month < current ? 'past' : 'future',
    };
  });

  return { months, undated, totals: computeTotals(rows), currentMonth: current };
}

// ═══════════════════════════════════════════════════════════════════════════
// PREVISÃO ROLANTE
// ═══════════════════════════════════════════════════════════════════════════

export type ForecastHorizon = 'current' | 'next3' | 'next6' | 'full';

export const FORECAST_HORIZON_LABEL: Record<ForecastHorizon, string> = {
  current: 'Mês corrente',
  next3: 'Próximos 3 meses',
  next6: 'Próximos 6 meses',
  full: 'Horizonte completo do contrato',
};

export interface ForecastWindow {
  readonly horizon: ForecastHorizon;
  readonly label: string;
  readonly months: readonly string[];
  readonly rows: readonly BillingMonthPlanRow[];
  readonly totals: BillingTotals;
  readonly variance: number | null;
}

/**
 * As janelas da previsão rolante.
 *
 * `full` inclui TUDO que tem mês previsto, inclusive o passado: a previsão do
 * horizonte do contrato sem o que já venceu esconde justamente o que atrasou.
 * Marcos sem data continuam fora de toda janela — e continuam contados em
 * `undated`, para que ninguém leia a previsão como completa.
 */
export function buildForecast(
  rows: readonly BillingMonthPlanRow[],
  asOf: Date,
): readonly ForecastWindow[] {
  const current = monthKey(asOf);
  const windowOf = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => shiftMonth(current, i));

  const build = (horizon: ForecastHorizon, months: readonly string[] | null): ForecastWindow => {
    const selected = months === null
      ? rows.filter((r) => r.plannedBillingMonth !== null)
      : rows.filter((r) => r.plannedBillingMonth !== null
          && months.includes(r.plannedBillingMonth));
    const totals = computeTotals(selected);
    return {
      horizon,
      label: FORECAST_HORIZON_LABEL[horizon],
      months: months ?? [...new Set(selected.map((r) => r.plannedBillingMonth!))].sort(),
      rows: selected,
      totals,
      variance: variance(totals),
    };
  };

  return [
    build('current', [current]),
    build('next3', windowOf(4)),
    build('next6', windowOf(7)),
    build('full', null),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// AGREGAÇÃO POR DIMENSÃO
// ═══════════════════════════════════════════════════════════════════════════

export interface AggregateBucket {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly BillingMonthPlanRow[];
  readonly totals: BillingTotals;
}

/**
 * Agrupa por qualquer dimensão — contrato, cliente, projeto, estado.
 *
 * O `label` vem de FORA, de quem já resolve nome de cliente pelo read model de
 * confiança da carteira. Resolver aqui exigiria uma segunda fonte de nome de
 * cliente, e duas fontes de nome discordam no primeiro cadastro corrigido.
 */
export function aggregateBy(
  rows: readonly BillingMonthPlanRow[],
  keyOf: (row: BillingMonthPlanRow) => string,
  labelOf: (key: string, row: BillingMonthPlanRow) => string,
): readonly AggregateBucket[] {
  const groups = new Map<string, BillingMonthPlanRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({
      key,
      label: labelOf(key, list[0]),
      rows: list,
      totals: computeTotals(list),
    }))
    .sort((a, b) => (b.totals.plannedTotal ?? 0) - (a.totals.plannedTotal ?? 0));
}

/** A data prevista foi reprogramada pelo cronograma? */
export function wasReprogrammed(row: BillingMonthPlanRow): boolean {
  return row.reprogrammingCount > 0;
}

/**
 * A data prevista veio do CRONOGRAMA governado?
 *
 * É a pergunta que separa "outubro porque a obra termina em outubro" de
 * "outubro porque alguém digitou um prazo no marco". As duas aparecem no mesmo
 * mês e não têm o mesmo peso.
 */
export function isScheduleAnchored(row: BillingMonthPlanRow): boolean {
  return row.plannedBillingDateBasis === 'timeline_forecast_finish'
    || row.plannedBillingDateBasis === 'timeline_planned_finish';
}

export const PLANNED_DATE_BASIS_LABEL: Record<BillingMonthPlanRow['plannedBillingDateBasis'], string> = {
  timeline_forecast_finish: 'Cronograma do projeto (replanejado)',
  timeline_planned_finish: 'Cronograma do projeto (linha de base)',
  measurement_expected_at: 'Medição agendada em Projetos',
  milestone_due_date: 'Prazo registrado no marco contratual',
  undetermined: 'Sem data — cronograma não mapeado',
};
