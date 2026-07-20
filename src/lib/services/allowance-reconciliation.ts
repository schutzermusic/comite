/**
 * Diárias de Campo — motor de conciliação (PURO, sem I/O).
 *
 * Compara o PREVISTO (a diária paga) com o REALIZADO (jornada,
 * geofence e apontamento). Decide 'confirmed' ou 'divergent' e devolve
 * os motivos — nunca altera silenciosamente o histórico nem propõe
 * desconto: a divergência é sinalizada para análise/ajuste manual
 * (ADR-006 — sem acusação automática). A coleta dos sinais vive em
 * allowances.ts; aqui só há regra.
 */

/** Motivos de divergência/observação de uma diária conciliada. */
export type ReconciliationReason =
  | 'no_attendance' // sem registro de entrada no dia
  | 'outside_geofence' // ponto fora da cerca da obra
  | 'location_unavailable' // GPS/ponto offline — exige análise, não é fraude
  | 'no_time_entry'; // sem apontamento no projeto (observação, não bloqueia)

export type ReconciliationOutcome = 'confirmed' | 'divergent';

export interface ReconciliationInput {
  /** política exige presença para conciliar */
  attendanceRequired: boolean;
  /** política exige geofence para conciliar */
  geofenceRequired: boolean;
  /** há clock_in aceito da pessoa no dia */
  hasAcceptedClockIn: boolean;
  /** há evidência de localização capturada no dia */
  locationAvailable: boolean;
  /** a evidência de localização está dentro da cerca (raio+tolerância) */
  hasLocationWithinGeofence: boolean;
  /** há apontamento (aprovado/enviado) no projeto da diária no dia */
  hasProjectTimeEntry: boolean;
}

export interface ReconciliationResult {
  outcome: ReconciliationOutcome;
  reasons: ReconciliationReason[];
}

/** Motivos que caracterizam divergência (os demais são observações). */
const BLOCKING: ReconciliationReason[] = ['no_attendance', 'outside_geofence', 'location_unavailable'];

/**
 * Concilia UMA diária. Função total: nunca lança. 'no_time_entry' é
 * observação (não torna a diária divergente por si só) — apontamento é
 * sinal mais fraco que presença/geofence.
 */
export function reconcileDaily(input: ReconciliationInput): ReconciliationResult {
  const reasons: ReconciliationReason[] = [];

  if (input.attendanceRequired && !input.hasAcceptedClockIn) {
    reasons.push('no_attendance');
  }

  if (input.geofenceRequired) {
    if (!input.locationAvailable) reasons.push('location_unavailable');
    else if (!input.hasLocationWithinGeofence) reasons.push('outside_geofence');
  }

  if (input.hasAcceptedClockIn && !input.hasProjectTimeEntry) {
    reasons.push('no_time_entry');
  }

  const divergent = reasons.some((r) => BLOCKING.includes(r));
  return { outcome: divergent ? 'divergent' : 'confirmed', reasons };
}

export const RECONCILIATION_REASON_LABELS: Record<ReconciliationReason, string> = {
  no_attendance: 'Sem registro de entrada',
  outside_geofence: 'Ponto fora da geofence da obra',
  location_unavailable: 'Localização indisponível (requer análise)',
  no_time_entry: 'Sem apontamento no projeto',
};
