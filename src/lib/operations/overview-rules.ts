/**
 * Regras PURAS da Visão Geral de Operações.
 *
 * Todo número da tela sai daqui, com definição escrita. Nenhum é gravado: são
 * derivados do cronograma canônico (`project_timeline_items`), da medição
 * canônica (`project_measurements`), dos riscos (`risks`) e das OS.
 */
import type { MeasurementStatus } from '@/lib/projects/measurements/types';

export interface ActivityLike {
  status: string;
  priority: string;
  delay_status: string;
  is_milestone: boolean;
  is_summary: boolean;
  planned_start: string | null;
  planned_finish: string | null;
  actual_finish: string | null;
}

const OPEN_ACTIVITY = (a: ActivityLike) => a.status !== 'completed' && a.status !== 'cancelled' && !a.actual_finish;

/**
 * ATIVIDADE CRÍTICA — definição:
 * aberta (nem concluída nem cancelada) E folha do cronograma (não resumo) E
 * (prioridade `critical`, OU sinal de atraso `delayed`/`blocked`, OU término
 * planejado já vencido).
 */
export function isCriticalActivity(a: ActivityLike, today: string): boolean {
  if (!OPEN_ACTIVITY(a) || a.is_summary) return false;
  return a.priority === 'critical' || a.delay_status === 'delayed' || a.delay_status === 'blocked'
    || (a.planned_finish !== null && a.planned_finish < today);
}

/** Atraso: término planejado vencido e a atividade ainda aberta. */
export function isOverdueActivity(a: ActivityLike, today: string): boolean {
  return OPEN_ACTIVITY(a) && !a.is_summary && a.planned_finish !== null && a.planned_finish < today;
}

export type Horizon = 7 | 14 | 30;

/** Dias entre duas datas ISO (dia civil), positivo se `to` é depois de `from`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Em qual janela de execução próxima a atividade cai — pelo PRIMEIRO evento
 * futuro dela (início planejado se ainda não começou, senão término).
 * `null` = fora dos 30 dias ou já passada.
 */
export function horizonOf(a: ActivityLike & { actual_start?: string | null }, today: string): Horizon | null {
  if (!OPEN_ACTIVITY(a) || a.is_summary) return null;
  const started = Boolean(a.actual_start) || a.status === 'in_progress';
  const anchor = !started && a.planned_start && a.planned_start >= today ? a.planned_start : a.planned_finish;
  if (!anchor || anchor < today) return null;
  const d = daysBetween(today, anchor);
  if (d <= 7) return 7;
  if (d <= 14) return 14;
  if (d <= 30) return 30;
  return null;
}

/**
 * Pergunta da fila global de Medições & Evidências — QUEM tem o próximo passo.
 * `APPROVED_FOR_CUSTOMER` (pacote interno aprovado) NÃO é aceite do cliente:
 * fica em "Enviar ao cliente", separado de "Aguardando aceite".
 */
export type MeasurementLane =
  | 'PREPARE_EVIDENCE' | 'INTERNAL_REVIEW' | 'CORRECTION' | 'SEND_TO_CUSTOMER'
  | 'AWAITING_CUSTOMER' | 'BILLING_ELIGIBLE' | 'CLOSED';

export const MEASUREMENT_LANE_LABEL: Record<MeasurementLane, string> = {
  PREPARE_EVIDENCE: 'Preparar evidência',
  INTERNAL_REVIEW: 'Em análise interna',
  CORRECTION: 'Devolvida para correção',
  SEND_TO_CUSTOMER: 'Aprovada — enviar ao cliente',
  AWAITING_CUSTOMER: 'Aguardando aceite do cliente',
  BILLING_ELIGIBLE: 'Aceita — elegível a faturamento',
  CLOSED: 'Encerrada',
};

export function measurementLane(status: MeasurementStatus): MeasurementLane {
  switch (status) {
    case 'PLANNED':
    case 'IN_PREPARATION':
    case 'READY_FOR_SUBMISSION': return 'PREPARE_EVIDENCE';
    case 'SUBMITTED':
    case 'UNDER_REVIEW': return 'INTERNAL_REVIEW';
    case 'RETURNED_FOR_CORRECTION':
    case 'CUSTOMER_CORRECTION_REQUESTED': return 'CORRECTION';
    case 'APPROVED_FOR_CUSTOMER': return 'SEND_TO_CUSTOMER';
    case 'AWAITING_CUSTOMER_ACCEPTANCE': return 'AWAITING_CUSTOMER';
    case 'ACCEPTED': return 'BILLING_ELIGIBLE';
    case 'REJECTED':
    case 'CANCELLED':
    case 'SUPERSEDED': return 'CLOSED';
  }
}

/**
 * PENDÊNCIA DE MEDIÇÃO da operação — definição: medição cuja próxima ação é
 * da operação (preparar evidência que já venceu ou está em preparo, ou
 * corrigir o que voltou). O que espera Contratos ou o cliente não é
 * pendência da operação; aparece na fila, não no número.
 */
export function isOperationalMeasurementPending(
  status: MeasurementStatus, expectedAt: string | null, today: string,
): boolean {
  if (status === 'IN_PREPARATION' || status === 'READY_FOR_SUBMISSION') return true;
  if (status === 'RETURNED_FOR_CORRECTION' || status === 'CUSTOMER_CORRECTION_REQUESTED') return true;
  return status === 'PLANNED' && expectedAt !== null && expectedAt <= today;
}

export interface RiskLike { status: string; severity: string; responsible_id: string | null }

/** Risco aberto de severidade alta/crítica. */
export function isMaterialOpenRisk(r: RiskLike): boolean {
  return (r.status === 'open' || r.status === 'mitigating') && (r.severity === 'high' || r.severity === 'critical');
}

/** Projeto em risco — definição: tem atividade crítica OU risco material aberto. */
export function projectAtRisk(criticalActivities: number, materialRisks: number): boolean {
  return criticalActivities > 0 || materialRisks > 0;
}
