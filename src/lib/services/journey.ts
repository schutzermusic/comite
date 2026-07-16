/**
 * Journey service (migration 045) — Fase 5.
 * Registro de ponto + jornada derivada + regras CLT (banco de horas,
 * hora extra, adicional noturno) + conciliação jornada × apontamento (D4).
 *
 * Jornada (attendance_punches) mede cumprimento de horário; apontamento
 * (time_entries) mede onde o tempo foi aplicado — domínios separados,
 * conciliáveis (spec §4). Eventos imutáveis: correção cria novo punch
 * ligado ao original (ADR-005). Banco de horas/HE/noturno são DERIVADOS.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type {
  AttendancePunch,
  DayJourney,
  JourneyReconciliation,
  Person,
  PunchSource,
  PunchStatus,
  PunchType,
} from '@/lib/types/people';
import {
  getCurrentOrgAndUser,
  getCurrentPerson,
  mapPersonRow,
  rlsFriendlyMessage,
  type PersonRow,
} from './people';
import { monthBounds } from './capacity';

export const PUNCHES_TABLE = 'attendance_punches';

/** Night window (adicional noturno): 22:00 → 05:00 local. */
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 5;

/* ─────────────────────────── mapping ─────────────────────────── */

type PunchRow = {
  id: string;
  organization_id: string;
  person_id: string;
  type: PunchType;
  occurred_at: string;
  received_at: string;
  timezone: string;
  source: PunchSource;
  status: PunchStatus;
  original_punch_id: string | null;
  correction_reason: string | null;
  corrected_by: string | null;
  client_event_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  people?: PersonRow | null;
};

function mapPunch(row: PunchRow): AttendancePunch {
  return {
    id: row.id,
    organizationId: row.organization_id,
    personId: row.person_id,
    type: row.type,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    timezone: row.timezone,
    source: row.source,
    status: row.status,
    originalPunchId: row.original_punch_id,
    correctionReason: row.correction_reason,
    correctedBy: row.corrected_by,
    clientEventId: row.client_event_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    person: row.people ? mapPersonRow(row.people) : undefined,
  };
}

/* ─────────────────────────── queries ─────────────────────────── */

export async function listPunches(
  startDate: string,
  endDate: string,
  personId?: string,
): Promise<AttendancePunch[]> {
  const supabase = createClient();
  let query = supabase
    .from(PUNCHES_TABLE)
    .select('*, people(*)')
    .neq('status', 'cancelled')
    .gte('occurred_at', `${startDate}T00:00:00`)
    .lte('occurred_at', `${endDate}T23:59:59`)
    .order('occurred_at', { ascending: true });
  if (personId) query = query.eq('person_id', personId);

  const { data, error } = await query;
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar jornada', error));
  return (data ?? []).map((r) => mapPunch(r as unknown as PunchRow));
}

export async function listMyPunches(
  startDate: string,
  endDate: string,
): Promise<AttendancePunch[]> {
  const person = await getCurrentPerson();
  if (!person) return [];
  return listPunches(startDate, endDate, person.id);
}

/* ─────────────────────────── mutations ───────────────────────── */

/** Valid next punch types given the last accepted punch of the day. */
export function nextPunchOptions(lastType: PunchType | null): PunchType[] {
  switch (lastType) {
    case null:
    case 'clock_out':
      return ['clock_in'];
    case 'clock_in':
    case 'break_end':
      return ['break_start', 'clock_out'];
    case 'break_start':
      return ['break_end'];
    default:
      return ['clock_in'];
  }
}

/** Registers a punch for the current user (immutable, accepted). */
export async function registerPunch(type: PunchType): Promise<AttendancePunch> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const person = await getCurrentPerson();
  if (!person) {
    throw new Error(
      'Seu usuário não está vinculado a um cadastro de pessoa. Peça ao RH para vincular em Pessoas & Custos → Pessoas.',
    );
  }

  const { data, error } = await supabase
    .from(PUNCHES_TABLE)
    .insert({
      organization_id: orgId,
      person_id: person.id,
      type,
      occurred_at: new Date().toISOString(),
      source: 'web',
      status: 'accepted',
      created_by: userId,
    })
    .select('*, people(*)')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao registrar ponto', error));

  void logAuditEvent({
    organizationId: orgId,
    action: 'attendance.punched',
    entityType: 'attendance_punch',
    entityId: (data as PunchRow).id,
    metadata: { type },
  });
  return mapPunch(data as unknown as PunchRow);
}

/**
 * Manager correction (people.attendance_manage): inserts a new punch
 * with original_punch_id and marks the original 'corrected'. Nothing is
 * overwritten (ADR-005).
 */
export async function correctPunch(
  original: AttendancePunch,
  newOccurredAt: string,
  reason: string,
): Promise<AttendancePunch> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);

  const { data, error } = await supabase
    .from(PUNCHES_TABLE)
    .insert({
      organization_id: orgId,
      person_id: original.personId,
      type: original.type,
      occurred_at: newOccurredAt,
      source: 'manager_adjustment',
      status: 'accepted',
      original_punch_id: original.id,
      correction_reason: reason,
      corrected_by: userId,
      created_by: userId,
    })
    .select('*, people(*)')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao corrigir ponto', error));

  const { error: markError } = await supabase
    .from(PUNCHES_TABLE)
    .update({ status: 'corrected' })
    .eq('id', original.id);
  if (markError) throw new Error(rlsFriendlyMessage('Erro ao marcar ponto original', markError));

  void logAuditEvent({
    organizationId: orgId,
    action: 'attendance.corrected',
    entityType: 'attendance_punch',
    entityId: original.id,
    metadata: { reason, new_occurred_at: newOccurredAt },
  });
  return mapPunch(data as unknown as PunchRow);
}

/* ─────────────────── derived journey (CLT rules) ──────────────── */

function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Minutes of [start,end] overlapping the recurring 22:00–05:00 window. */
function nightMinutes(start: Date, end: Date): number {
  let total = 0;
  const dayMs = 86_400_000;
  // anchor night windows on the day before start through the day of end
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1);
  for (let t = from.getTime(); t <= end.getTime() + dayMs; t += dayMs) {
    const d = new Date(t);
    const winStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), NIGHT_START_HOUR, 0, 0);
    const winEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, NIGHT_END_HOUR, 0, 0);
    const overlap =
      Math.min(end.getTime(), winEnd.getTime()) - Math.max(start.getTime(), winStart.getTime());
    if (overlap > 0) total += overlap;
  }
  return Math.round(total / 60000);
}

/**
 * Computes the journey of one person on one day from ordered punches.
 * Working state: clock_in/break_end → working; break_start/clock_out → paused.
 */
export function computeDayJourney(
  person: Person,
  date: string,
  dayPunches: AttendancePunch[],
): DayJourney {
  const punches = dayPunches
    .filter((p) => p.status === 'accepted')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const expectedMinutes = Math.round((person.weeklyHours / 5) * 60);

  let workedMs = 0;
  let breakMs = 0;
  let night = 0;
  let openWorkStart: Date | null = null;
  let openBreakStart: Date | null = null;
  let firstIn: string | null = null;
  let lastOut: string | null = null;

  for (const p of punches) {
    const at = new Date(p.occurredAt);
    if (p.type === 'clock_in') {
      if (!firstIn) firstIn = p.occurredAt;
      openWorkStart = at;
    } else if (p.type === 'break_start') {
      if (openWorkStart) {
        workedMs += at.getTime() - openWorkStart.getTime();
        night += nightMinutes(openWorkStart, at);
        openWorkStart = null;
      }
      openBreakStart = at;
    } else if (p.type === 'break_end') {
      if (openBreakStart) {
        breakMs += at.getTime() - openBreakStart.getTime();
        openBreakStart = null;
      }
      openWorkStart = at;
    } else if (p.type === 'clock_out') {
      if (openWorkStart) {
        workedMs += at.getTime() - openWorkStart.getTime();
        night += nightMinutes(openWorkStart, at);
        openWorkStart = null;
      }
      lastOut = p.occurredAt;
    }
  }

  const incomplete = openWorkStart !== null || openBreakStart !== null;
  const workedMinutes = Math.round(workedMs / 60000);
  const overtimeMinutes = Math.max(0, workedMinutes - expectedMinutes);

  return {
    personId: person.id,
    date,
    firstIn,
    lastOut,
    workedMinutes,
    breakMinutes: Math.round(breakMs / 60000),
    expectedMinutes,
    overtimeMinutes,
    nightMinutes: night,
    balanceMinutes: workedMinutes - expectedMinutes,
    incomplete,
    punches,
  };
}

/** Groups punches into per-day journeys for one person. */
export function buildJourneys(person: Person, punches: AttendancePunch[]): DayJourney[] {
  const byDay = new Map<string, AttendancePunch[]>();
  for (const p of punches) {
    if (p.personId !== person.id) continue;
    const day = localDate(p.occurredAt);
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  return Array.from(byDay.entries())
    .map(([date, list]) => computeDayJourney(person, date, list))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Cumulative banco de horas (minutes) across ordered journeys. */
export function computeBancoHoras(journeys: DayJourney[]): number {
  return journeys.reduce((sum, j) => sum + j.balanceMinutes, 0);
}

/* ─────────────────── conciliação (D4) ────────────────────────── */

/**
 * Reconciles the journey (worked minutes from punches) against the
 * apontamento (reported minutes from time_entries) per day for a person
 * in a month. Surfaces "tempo não classificado" and "projeto fora da
 * jornada" (spec §4.3).
 */
export async function getJourneyReconciliation(
  personId: string,
  month: string,
  person: Person,
): Promise<JourneyReconciliation[]> {
  const supabase = createClient();
  const [monthStart, monthEnd] = monthBounds(month);

  const [punches, { data: entryRows, error }] = await Promise.all([
    listPunches(monthStart, monthEnd, personId),
    supabase
      .from('time_entries')
      .select('work_date, minutes, status')
      .eq('person_id', personId)
      .gte('work_date', monthStart)
      .lte('work_date', monthEnd)
      .neq('status', 'rejected'),
  ]);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao conciliar jornada', error));

  const journeys = buildJourneys(person, punches);
  const workedByDay = new Map(journeys.map((j) => [j.date, j.workedMinutes]));

  const reportedByDay = new Map<string, number>();
  for (const e of entryRows ?? []) {
    const day = e.work_date as string;
    reportedByDay.set(day, (reportedByDay.get(day) ?? 0) + (e.minutes as number));
  }

  const days = new Set<string>([...workedByDay.keys(), ...reportedByDay.keys()]);
  return Array.from(days)
    .map((date) => {
      const worked = workedByDay.get(date) ?? 0;
      const reported = reportedByDay.get(date) ?? 0;
      return {
        personId,
        date,
        workedMinutes: worked,
        reportedMinutes: reported,
        unclassifiedMinutes: Math.max(0, worked - reported),
        outsideJourneyMinutes: Math.max(0, reported - worked),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
