/**
 * Tipos do domínio de Ponto compartilhados entre o portal web do
 * colaborador, o cliente HTTP (`client.ts`) e as rotas /api/mobile/*.
 *
 * Módulo PURO: sem `use client`, sem import de browser/Supabase — pode ser
 * carregado por testes em Node e por route handlers.
 */

export type PunchType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';

/** Espelha o CHECK de attendance_punches.status (migration 045). */
export type PunchStatus = 'accepted' | 'under_review' | 'corrected' | 'cancelled';

/**
 * Status apenas de interface: a marcação existe no aparelho e ainda não
 * foi aceita pelo servidor. Nunca é gravado no banco — serve para a UI
 * jamais afirmar que um registro está confirmado antes da validação.
 */
export const PENDING_SYNC_STATUS = 'pending_sync';

export interface PunchRecord {
  id: string;
  type: PunchType;
  occurred_at: string;
  received_at: string;
  status: PunchStatus | string;
  can_undo: boolean;
  /** Presente no histórico: marcação de ajuste aponta para a original. */
  original_punch_id?: string | null;
  correction_reason?: string | null;
  review_note?: string | null;
  notes?: string | null;
}

export interface AllocationRecord {
  project_id: string;
  role_title: string | null;
  planned_percentage: number;
}

/** Cerca ativa do projeto — o portal usa centro/raio para pré-validar no cliente. */
export interface GeofenceRecord {
  id: string;
  project_id: string;
  name: string;
  center_lat?: number | null;
  center_lng?: number | null;
  radius_meters?: number | null;
  accuracy_tolerance_meters?: number | null;
}

export interface PersonRecord {
  id: string;
  full_name: string;
  job_title: string | null;
}

export interface RunningSession {
  id: string;
  project_id: string;
  started_at: string;
  timeline_item_id?: string | null;
}

export interface PontoBootstrap {
  person: PersonRecord | null;
  today: string;
  punches: PunchRecord[];
  runningSession: RunningSession | null;
  allocations: AllocationRecord[];
  geofences: GeofenceRecord[];
  devices: Array<{ id: string; device_public_id: string; status: string }>;
}

export interface TimelineStage {
  id: string;
  wbs_code: string | null;
  title: string;
  type: string;
  status: string;
  percent_complete: number;
  outline_level: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface PunchInput {
  type: PunchType;
  clientEventId: string;
  occurredAt?: string;
  location?: GeoPoint;
  authenticationEvidenceId?: string;
  /** Marcação capturada sem rede e sincronizada depois. */
  offline?: boolean;
}

export interface PunchResponse {
  ok: true;
  needsReview?: boolean;
  idempotent?: boolean;
  biometricVerified?: boolean;
  punch?: { id: string; occurred_at: string; status: string };
  geofence?: {
    inside: boolean;
    distanceMeters: number | null;
    geofenceName: string | null;
  } | null;
}

/* ───────────────────── solicitações de ajuste ───────────────────── */

/**
 * Motivos aceitos numa solicitação de ajuste. São gravados em
 * attendance_punches.correction_reason (texto livre no banco) — a lista
 * fechada aqui evita entrada arbitrária vinda do cliente.
 */
export const ADJUSTMENT_REASONS = [
  'forgot_punch',
  'no_signal',
  'device_issue',
  'wrong_time',
  'outside_area',
  'other',
] as const;

export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const ADJUSTMENT_REASON_LABEL: Record<AdjustmentReason, string> = {
  forgot_punch: 'Esqueci de registrar',
  no_signal: 'Estava sem sinal ou internet',
  device_issue: 'Problema no celular ou no app',
  wrong_time: 'O horário registrado está errado',
  outside_area: 'Trabalhei fora da área cadastrada',
  other: 'Outro motivo',
};

export function isAdjustmentReason(value: unknown): value is AdjustmentReason {
  return typeof value === 'string' && (ADJUSTMENT_REASONS as readonly string[]).includes(value);
}

/** Status visível ao colaborador para a solicitação de ajuste. */
export type AdjustmentStatus = 'sent' | 'under_review' | 'approved' | 'rejected';

export const ADJUSTMENT_STATUS_LABEL: Record<AdjustmentStatus, string> = {
  sent: 'Enviado',
  under_review: 'Em análise',
  approved: 'Aprovado',
  rejected: 'Recusado',
};

export interface AdjustmentRequest {
  id: string;
  type: PunchType;
  occurredAt: string;
  createdAt: string;
  status: AdjustmentStatus;
  reason: AdjustmentReason | null;
  /** Explicação escrita pelo colaborador. */
  note: string | null;
  /** Justificativa do gestor ao recusar/aprovar. */
  managerNote: string | null;
  originalPunchId: string | null;
}

export interface AdjustmentInput {
  type: PunchType;
  /** Data/hora corrigida, ISO. */
  occurredAt: string;
  reason: AdjustmentReason;
  note?: string;
  originalPunchId?: string;
}
