'use client';

/**
 * A FILA DE CONTRATOS → APROVAÇÕES — leitura do lado do cliente.
 *
 * ─── O que esta fila é, e o que ela não é ──────────────────────────────────
 *
 * É um RECORTE da medição canônica: mesmo id, mesmo estado, mesma história.
 * Não existe cópia do marco, não existe segundo identificador e não existe
 * estado próprio de "aprovação" — o que Contratos vê é literalmente a linha
 * que Projetos enviou.
 *
 * Por isso a fila é uma VISÃO (migration 194) e não uma tabela: uma tabela de
 * fila teria de ser sincronizada, e sincronização entre duas verdades é como
 * "Contratos diz que está pronto e Projetos diz que não" aparece.
 *
 * ─── Ausência não é zero ───────────────────────────────────────────────────
 *
 * `canViewValues` viaja na linha. Quantia nula sob restrição é NULA com o
 * motivo nomeado — nunca R$ 0,00, que faria um evento de R$ 2 milhões parecer
 * um evento sem valor.
 */

import { createClient } from '@/utils/supabase/client';
import { parsePreAnalysis, type PreAnalysisSummary } from './preanalysis';
import {
  MEASUREMENT_STATUS_LABEL, REVIEW_BUCKET_ORDER, parseSla, reviewBucketOf,
  type MeasurementSla, type MeasurementStatus, type ReadinessReason, type ReadinessState,
  type ReviewBucket,
} from './types';

export class ReviewQueueError extends Error {
  constructor(message: string) { super(message); this.name = 'ReviewQueueError'; }
}

/** Uma linha da fila, normalizada. */
export interface ReviewQueueItem {
  readonly measurementId: string;
  readonly contractId: string;
  readonly projectId: string;
  readonly milestoneId: string | null;
  readonly status: MeasurementStatus;
  readonly statusLabel: string;
  readonly bucket: ReviewBucket;
  readonly revision: number;

  readonly contractNumber: string | null;
  readonly contractTitle: string | null;
  readonly counterpartyName: string | null;
  readonly projectCode: string | null;
  readonly projectName: string | null;
  readonly projectClient: string | null;
  readonly milestoneTitle: string | null;
  readonly milestoneDueDate: string | null;

  readonly timelineTitle: string | null;
  readonly timelineWbsCode: string | null;
  readonly timelinePlannedFinish: string | null;
  readonly timelineActualFinish: string | null;

  /** `false` = a quantia existe e está RESTRITA para quem lê. */
  readonly canViewValues: boolean;
  readonly milestoneAmount: number | null;
  readonly measuredValue: number | null;
  readonly acceptedValue: number | null;
  readonly currency: string | null;

  readonly submittedAt: string | null;
  readonly reviewStartedAt: string | null;
  readonly approvedForCustomerAt: string | null;
  readonly sentToCustomerAt: string | null;
  readonly customerCorrectionAt: string | null;
  readonly returnedAt: string | null;
  readonly customerDueAt: string | null;
  readonly returnReason: string | null;
  readonly customerCorrectionReason: string | null;

  readonly readinessOverall: ReadinessState | null;
  readonly readinessReasons: readonly ReadinessReason[];
  readonly readinessComputedAt: string | null;

  readonly evidenceCount: number;
  readonly missingRequirementCount: number;
  readonly unknownRequirementCount: number;
  readonly openCorrectionCount: number;
  readonly dispatchCount: number;

  readonly preAnalysis: PreAnalysisSummary;
  readonly sla: MeasurementSla;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

function toItem(raw: Record<string, unknown>): ReviewQueueItem {
  const status = raw.status as MeasurementStatus;
  return {
    measurementId: String(raw.measurement_id),
    contractId: String(raw.contract_id),
    projectId: String(raw.project_id),
    milestoneId: (raw.milestone_id as string | null) ?? null,
    status,
    statusLabel: MEASUREMENT_STATUS_LABEL[status] ?? status,
    // A visão já filtra pelos estados da fila; o `??` existe para que um estado
    // novo na máquina não jogue a linha fora silenciosamente.
    bucket: reviewBucketOf(status) ?? 'AWAITING_CONTRACT_REVIEW',
    revision: Number(raw.revision ?? 1),

    contractNumber: (raw.contract_number as string | null) ?? null,
    contractTitle: (raw.contract_title as string | null) ?? null,
    counterpartyName: (raw.counterparty_name as string | null) ?? null,
    projectCode: (raw.project_code as string | null) ?? null,
    projectName: (raw.project_name as string | null) ?? null,
    projectClient: (raw.project_client as string | null) ?? null,
    milestoneTitle: (raw.milestone_title as string | null) ?? null,
    milestoneDueDate: (raw.milestone_due_date as string | null) ?? null,

    timelineTitle: (raw.timeline_title as string | null) ?? null,
    timelineWbsCode: (raw.timeline_wbs_code as string | null) ?? null,
    timelinePlannedFinish: (raw.timeline_planned_finish as string | null) ?? null,
    timelineActualFinish: (raw.timeline_actual_finish as string | null) ?? null,

    canViewValues: raw.can_view_values === true,
    milestoneAmount: num(raw.milestone_amount),
    measuredValue: num(raw.measured_value),
    acceptedValue: num(raw.accepted_value),
    currency: (raw.currency as string | null) ?? null,

    submittedAt: (raw.submitted_at as string | null) ?? null,
    reviewStartedAt: (raw.review_started_at as string | null) ?? null,
    approvedForCustomerAt: (raw.approved_for_customer_at as string | null) ?? null,
    sentToCustomerAt: (raw.sent_to_customer_at as string | null) ?? null,
    customerCorrectionAt: (raw.customer_correction_at as string | null) ?? null,
    returnedAt: (raw.returned_at as string | null) ?? null,
    customerDueAt: (raw.customer_due_at as string | null) ?? null,
    returnReason: (raw.return_reason as string | null) ?? null,
    customerCorrectionReason: (raw.customer_correction_reason as string | null) ?? null,

    readinessOverall: (raw.readiness_overall as ReadinessState | null) ?? null,
    readinessReasons: Array.isArray(raw.readiness_reasons)
      ? (raw.readiness_reasons as ReadinessReason[]) : [],
    readinessComputedAt: (raw.readiness_computed_at as string | null) ?? null,

    evidenceCount: Number(raw.evidence_count ?? 0),
    missingRequirementCount: Number(raw.missing_requirement_count ?? 0),
    unknownRequirementCount: Number(raw.unknown_requirement_count ?? 0),
    openCorrectionCount: Number(raw.open_correction_count ?? 0),
    dispatchCount: Number(raw.dispatch_count ?? 0),

    preAnalysis: parsePreAnalysis(raw.preanalysis, String(raw.measurement_id)),
    sla: parseSla(raw.sla),
  };
}

/**
 * A fila inteira do inquilino, opcionalmente recortada por contratos.
 *
 * Sem `contractIds`, devolve tudo o que a RLS permite ver. O recorte existe
 * porque a aba de Contratos já filtra a carteira, e mostrar na fila um contrato
 * que o filtro escondeu confunde quem acabou de filtrar.
 */
export async function listReviewQueue(
  contractIds?: readonly string[],
): Promise<readonly ReviewQueueItem[]> {
  let query = createClient().from('project_measurement_review_queue').select('*');
  if (contractIds && contractIds.length > 0) query = query.in('contract_id', [...contractIds]);
  const { data, error } = await query;
  if (error) throw new ReviewQueueError(error.message);
  return sortQueue((data ?? []).map((r) => toItem(r as Record<string, unknown>)));
}

/**
 * Ordem: o balde manda; dentro dele, o PRAZO — vencido primeiro.
 *
 * Pendência sem prazo declarado vai para o fim do balde, e não para o começo:
 * ela não é urgente, ela é não apurada, e promovê-la a urgente enterraria o que
 * de fato venceu.
 */
export function sortQueue(items: readonly ReviewQueueItem[]): readonly ReviewQueueItem[] {
  const rank = (b: ReviewBucket) => REVIEW_BUCKET_ORDER.indexOf(b);
  const slaRank = (s: MeasurementSla) =>
    (s.state === 'OVERDUE' ? 0 : s.state === 'WARNING' ? 1 : s.state === 'ON_TIME' ? 2 : 3);
  return [...items].sort((a, b) => {
    const byBucket = rank(a.bucket) - rank(b.bucket);
    if (byBucket !== 0) return byBucket;
    const bySla = slaRank(a.sla) - slaRank(b.sla);
    if (bySla !== 0) return bySla;
    const da = a.sla.dueAt ?? '9999-12-31';
    const db = b.sla.dueAt ?? '9999-12-31';
    if (da !== db) return da.localeCompare(db);
    return (a.milestoneTitle ?? '').localeCompare(b.milestoneTitle ?? '', 'pt-BR');
  });
}

export function groupQueueByBucket(
  items: readonly ReviewQueueItem[],
): readonly { readonly bucket: ReviewBucket; readonly items: readonly ReviewQueueItem[] }[] {
  return REVIEW_BUCKET_ORDER
    .map((bucket) => ({ bucket, items: items.filter((i) => i.bucket === bucket) }))
    .filter((g) => g.items.length > 0);
}

export interface ReviewQueueSummary {
  readonly total: number;
  readonly awaitingReview: number;
  readonly inReview: number;
  readonly awaitingDispatch: number;
  readonly awaitingCustomer: number;
  readonly awaitingCorrection: number;
  readonly overdue: number;
  readonly withInconsistencies: number;
  /** Itens cujo prazo ninguém declarou. Não são "no prazo". */
  readonly termNotDeclared: number;
}

export function summarizeQueue(items: readonly ReviewQueueItem[]): ReviewQueueSummary {
  const inBucket = (b: ReviewBucket) => items.filter((i) => i.bucket === b).length;
  return {
    total: items.length,
    awaitingReview: inBucket('AWAITING_CONTRACT_REVIEW'),
    inReview: inBucket('IN_CONTRACT_REVIEW'),
    awaitingDispatch: inBucket('AWAITING_DISPATCH'),
    awaitingCustomer: inBucket('AWAITING_CUSTOMER'),
    awaitingCorrection: inBucket('AWAITING_PROJECT_CORRECTION'),
    overdue: items.filter((i) => i.sla.state === 'OVERDUE').length,
    withInconsistencies: items.filter(
      (i) => i.preAnalysis.inconsistent > 0 || i.preAnalysis.needsHumanReview > 0).length,
    termNotDeclared: items.filter((i) => i.sla.state === 'NOT_ASSESSED').length,
  };
}

/**
 * As AÇÕES que a fila oferece para um item, dado o que a pessoa pode fazer.
 *
 * Uma por estado, e a lista é derivada do ESTADO — nunca de um campo de
 * permissão embutido na linha. Quem não pode analisar vê o item e não vê botão:
 * a fila é informação antes de ser painel de controle.
 */
export type ReviewAction =
  | 'start_review'
  | 'request_correction'
  | 'approve_for_customer'
  | 'send_to_customer'
  | 'record_acceptance'
  | 'record_customer_correction'
  | 'reject';

export const REVIEW_ACTION_LABEL: Record<ReviewAction, string> = {
  start_review: 'Iniciar análise',
  request_correction: 'Solicitar correção',
  approve_for_customer: 'Aprovar para envio ao cliente',
  send_to_customer: 'Enviar para aceite da contratante',
  record_acceptance: 'Registrar aceite da contratante',
  record_customer_correction: 'Registrar correção pedida pela contratante',
  reject: 'Rejeitar medição',
};

export function availableActions(item: ReviewQueueItem): readonly ReviewAction[] {
  switch (item.status) {
    case 'SUBMITTED':
      return ['start_review', 'request_correction', 'approve_for_customer', 'reject'];
    case 'UNDER_REVIEW':
      return ['request_correction', 'approve_for_customer', 'reject'];
    case 'APPROVED_FOR_CUSTOMER':
      return ['send_to_customer', 'request_correction'];
    case 'AWAITING_CUSTOMER_ACCEPTANCE':
      // Aceite e pedido de correção do cliente — os dois desfechos reais. E
      // `record_acceptance`, nunca um "Aceitar" interno: quem aceita é a
      // Contratante, e o que o produto faz é REGISTRAR isso.
      return ['record_acceptance', 'record_customer_correction', 'reject'];
    case 'CUSTOMER_CORRECTION_REQUESTED':
    case 'RETURNED_FOR_CORRECTION':
      // A bola está com o Projeto. Contratos acompanha e cobra; não reenvia.
      return [];
    default:
      return [];
  }
}

/**
 * Os DOCUMENTOS que a remessa pode citar.
 *
 * Lê `project_files` pelo vínculo de medição OU pelo marco — os dois, porque a
 * evidência anexada antes de a medição existir fica pendurada no marco, e uma
 * consulta só por `measurement_id` esconderia justamente o anexo mais antigo.
 *
 * Devolve o id CANÔNICO. A remessa cita o documento; ela nunca copia arquivo.
 */
export interface QueueDocument {
  readonly documentId: string;
  readonly fileName: string;
  readonly evidenceCategory: string | null;
  readonly createdAt: string;
}

export async function listMeasurementDocuments(
  measurementId: string,
  milestoneId: string | null,
): Promise<readonly QueueDocument[]> {
  const supabase = createClient();
  const filter = milestoneId
    ? `measurement_id.eq.${measurementId},contract_milestone_id.eq.${milestoneId}`
    : `measurement_id.eq.${measurementId}`;
  const { data, error } = await supabase
    .from('project_files')
    .select('id, file_name, evidence_category, created_at')
    .or(filter)
    .order('created_at', { ascending: false });
  if (error) throw new ReviewQueueError(error.message);

  const seen = new Set<string>();
  const out: QueueDocument[] = [];
  for (const r of data ?? []) {
    const id = String((r as Record<string, unknown>).id);
    // O mesmo arquivo pode casar pelos dois critérios. Um registro, uma linha.
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      documentId: id,
      fileName: String((r as Record<string, unknown>).file_name ?? 'documento'),
      evidenceCategory: ((r as Record<string, unknown>).evidence_category as string | null) ?? null,
      createdAt: String((r as Record<string, unknown>).created_at),
    });
  }
  return out;
}
