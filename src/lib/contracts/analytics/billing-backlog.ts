/**
 * BACKLOG DE RECEITA — o valor contratado repartido pelo que o BLOQUEIA.
 *
 * Responde uma pergunta só: *o que impede o valor contratado de virar receita
 * faturável?* Não é a cadeia contrato→caixa (essa é `contract-to-cash.ts`, e
 * fala de estágios de valor); é o retrato de ONDE o direito está parado agora.
 *
 * ─── Por que sai da bancada de marcos, e não dos eventos ───────────────────
 *
 * Um evento de faturamento só existe depois que alguém o gerou. Perguntar aos
 * eventos o que está travado responderia sempre "nada" numa carteira sem
 * nenhum evento — que é justamente a carteira mais travada possível. A bancada
 * (`contract_milestone_workbench`) tem o DIREITO previsto no instrumento, que
 * existe desde a assinatura, e é ele que precisa ser repartido.
 *
 * ─── A regra de valor ──────────────────────────────────────────────────────
 *
 * O valor de um marco é o DIREITO (`entitlementAmount`) — a quantia que o
 * documento assinado atribui ao evento. Quando o direito não foi registrado,
 * `billingAmount` (o previsto do marco) entra como segunda opção e a origem
 * fica declarada. Quando nenhum dos dois existe, o marco entra na contagem do
 * segmento e **não** entra na soma: `amount` continua `null`, e a legenda diz
 * quantos marcos daquele segmento estão sem valor apurado.
 *
 * Um segmento com `amount: null` NUNCA desenha barra sólida — desenha trilho
 * tracejado, que é o vocabulário reservado do módulo para "não apurado". Uma
 * barra cinza de largura zero seria lida como "medido e deu zero".
 *
 * Lógica pura, sem JSX, sem I/O.
 */

import { deriveStage } from '../measurement/milestone-stage';
import type { MilestoneWorkbenchRow } from '../measurement/milestone-workbench-types';

/** Os seis estados operacionais, do mais cedo ao mais tarde na cadeia. */
export type BacklogStageKey =
  | 'trigger_unassessed'
  | 'awaiting_measurement'
  | 'awaiting_evidence'
  | 'awaiting_acceptance'
  | 'eligible'
  | 'billed';

export const BACKLOG_STAGE_ORDER: readonly BacklogStageKey[] = [
  'trigger_unassessed',
  'awaiting_measurement',
  'awaiting_evidence',
  'awaiting_acceptance',
  'eligible',
  'billed',
];

export const BACKLOG_STAGE_LABEL: Record<BacklogStageKey, string> = {
  trigger_unassessed: 'Gatilho não apurado',
  awaiting_measurement: 'Aguardando medição',
  awaiting_evidence: 'Aguardando evidência',
  awaiting_acceptance: 'Aguardando aceite',
  eligible: 'Elegível para faturar',
  billed: 'Faturado',
};

/** O que cada segmento significa para quem precisa destravar. */
export const BACKLOG_STAGE_HINT: Record<BacklogStageKey, string> = {
  trigger_unassessed:
    'O evento que dispara o direito ainda não foi apurado contra cronograma governado — ou o marco nem chegou a ser instrumentado.',
  awaiting_measurement: 'O gatilho ocorreu; falta a medição operacional da quantidade executada.',
  awaiting_evidence: 'A medição existe; falta o documento que o contrato exige para sustentá-la.',
  awaiting_acceptance: 'Está completo do lado de quem executou; falta o aceite da Contratante.',
  eligible: 'Nada mais bloqueia: o evento de faturamento pode ser gerado.',
  billed: 'O evento de faturamento foi gerado. Recebimento é outra pergunta — depende do razão financeiro.',
};

export type BacklogSegment = {
  readonly key: BacklogStageKey;
  readonly label: string;
  /** Σ do direito dos marcos do segmento. `null` = nenhum tinha valor. */
  readonly amount: number | null;
  readonly count: number;
  /** Marcos do segmento SEM valor apurado — a lacuna, dita em número. */
  readonly unpricedCount: number;
  /** Fração da base, de 0 a 1. `null` quando falta uma das pontas. */
  readonly share: number | null;
};

export type BillingBacklog = {
  readonly segments: readonly BacklogSegment[];
  /** Σ de todos os segmentos. `null` quando nada foi apurado. */
  readonly base: number | null;
  readonly totalMilestones: number;
  /** Marcos cancelados — fora da repartição, porque não há direito a destravar. */
  readonly cancelledCount: number;
  /** Quantos marcos, no total, não tinham valor apurado. */
  readonly unpricedCount: number;
  readonly coverage: { readonly counted: number; readonly total: number };
};

/**
 * O direito de um marco.
 *
 * Ordem deliberada: o direito registrado vence o previsto. Devolve `null`
 * quando nenhum dos dois existe — jamais `0`.
 */
function entitlementOf(row: MilestoneWorkbenchRow): number | null {
  if (typeof row.entitlementAmount === 'number' && Number.isFinite(row.entitlementAmount)) {
    return row.entitlementAmount;
  }
  if (typeof row.billingAmount === 'number' && Number.isFinite(row.billingAmount)) {
    return row.billingAmount;
  }
  return null;
}

/**
 * Em que segmento o marco está.
 *
 * O mapeamento é sobre `MilestoneStage`, a taxonomia canônica do módulo, e não
 * sobre o `status` cru da linha: o estágio já resolve precedência entre aceite,
 * evidência, medição e gatilho, e reimplementá-lo aqui faria duas verdades.
 *
 * `CANCELLED` devolve `null` — um marco cancelado não tem direito a destravar,
 * e mantê-lo no gráfico inflaria o "bloqueado" com valor que ninguém espera.
 */
export function backlogStageOf(row: MilestoneWorkbenchRow): BacklogStageKey | null {
  switch (deriveStage(row).stage) {
    case 'CANCELLED':
      return null;
    case 'BILLED':
      return 'billed';
    case 'READY_TO_BILL':
      return 'eligible';
    case 'AWAITING_ACCEPTANCE':
      return 'awaiting_acceptance';
    case 'AWAITING_EVIDENCE':
      return 'awaiting_evidence';
    case 'READY_TO_MEASURE':
    case 'BLOCKED':
      return 'awaiting_measurement';
    case 'TRIGGER_PENDING':
    case 'UNMAPPED':
    case 'UNINSTRUMENTED':
    case 'UNKNOWN':
    default:
      return 'trigger_unassessed';
  }
}

export function buildBillingBacklog(rows: readonly MilestoneWorkbenchRow[]): BillingBacklog {
  const buckets = new Map<BacklogStageKey, MilestoneWorkbenchRow[]>(
    BACKLOG_STAGE_ORDER.map((key) => [key, []]),
  );
  let cancelled = 0;

  for (const row of rows) {
    const key = backlogStageOf(row);
    if (key === null) { cancelled += 1; continue; }
    buckets.get(key)!.push(row);
  }

  const priced = (list: readonly MilestoneWorkbenchRow[]) =>
    list.map(entitlementOf).filter((v): v is number => v !== null);

  const raw = BACKLOG_STAGE_ORDER.map((key) => {
    const list = buckets.get(key)!;
    const values = priced(list);
    return {
      key,
      label: BACKLOG_STAGE_LABEL[key],
      amount: values.length > 0 ? values.reduce((a, b) => a + b, 0) : null,
      count: list.length,
      unpricedCount: list.length - values.length,
    };
  });

  const known = raw.map((s) => s.amount).filter((v): v is number => v !== null);
  const base = known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;

  const segments: BacklogSegment[] = raw.map((s) => ({
    ...s,
    // `share` só existe quando as duas pontas existem. Nunca 0 por ausência.
    share: s.amount !== null && base !== null && base > 0 ? s.amount / base : null,
  }));

  const pricedTotal = rows.filter((r) => entitlementOf(r) !== null).length;

  return {
    segments,
    base,
    totalMilestones: rows.length,
    cancelledCount: cancelled,
    unpricedCount: rows.length - pricedTotal,
    coverage: { counted: pricedTotal, total: rows.length },
  };
}
