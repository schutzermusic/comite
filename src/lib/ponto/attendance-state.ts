/**
 * Máquina de estados da jornada do colaborador (domínio puro).
 *
 * A regra de sequência já existia em `nextPunchOptions` e é preservada
 * aqui integralmente — este módulo apenas a formaliza e acrescenta o que
 * a interface precisa: fase corrente, rótulos, resumo do dia e
 * agrupamento do histórico. Nada aqui fala com rede, browser ou banco.
 */

import { PENDING_SYNC_STATUS, type PunchRecord, type PunchType } from './attendance-types';

/* ───────────────────── rótulos ───────────────────── */

export const PUNCH_LABEL: Record<PunchType, string> = {
  clock_in: 'Registrar entrada',
  break_start: 'Iniciar intervalo',
  break_end: 'Encerrar intervalo',
  clock_out: 'Registrar saída',
};

/** Rótulo curto, para linhas do dia e badges. */
export const PUNCH_SHORT_LABEL: Record<PunchType, string> = {
  clock_in: 'Entrada',
  break_start: 'Início do intervalo',
  break_end: 'Fim do intervalo',
  clock_out: 'Saída',
};

/* ───────────────────── sequência ───────────────────── */

/**
 * Marcações possíveis a partir da última registrada.
 * Preserva a regra original (nenhuma ação impossível é oferecida).
 */
export function nextPunchOptions(last: PunchType | null): PunchType[] {
  switch (last) {
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

/** Marcações que não contam para a sequência (canceladas/substituídas). */
export function isEffectivePunch(punch: Pick<PunchRecord, 'status'>): boolean {
  return punch.status !== 'cancelled' && punch.status !== 'corrected';
}

/** Ordena por horário do evento e descarta marcações sem efeito. */
export function effectivePunches(punches: readonly PunchRecord[]): PunchRecord[] {
  return punches
    .filter(isEffectivePunch)
    .slice()
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
}

export function lastPunchType(punches: readonly PunchRecord[]): PunchType | null {
  const effective = effectivePunches(punches);
  return effective.length ? effective[effective.length - 1].type : null;
}

/* ───────────────────── fase da jornada ───────────────────── */

export type WorkdayPhase =
  | 'not_started'
  | 'working'
  | 'on_break'
  | 'finished';

export interface WorkdayPhaseMeta {
  label: string;
  hint: string;
  tone: 'neutral' | 'accent' | 'warning' | 'success';
}

export const WORKDAY_PHASE_META: Record<WorkdayPhase, WorkdayPhaseMeta> = {
  not_started: {
    label: 'Jornada não iniciada',
    hint: 'Registre a entrada para começar o dia.',
    tone: 'neutral',
  },
  working: {
    label: 'Jornada em andamento',
    hint: 'Você pode iniciar o intervalo ou registrar a saída.',
    tone: 'accent',
  },
  on_break: {
    label: 'Em intervalo',
    hint: 'Ao voltar, registre o fim do intervalo.',
    tone: 'warning',
  },
  finished: {
    label: 'Saída registrada',
    hint: 'Jornada encerrada. Bom descanso.',
    tone: 'success',
  },
};

export function deriveWorkdayPhase(punches: readonly PunchRecord[]): WorkdayPhase {
  switch (lastPunchType(punches)) {
    case 'clock_in':
    case 'break_end':
      return 'working';
    case 'break_start':
      return 'on_break';
    case 'clock_out':
      return 'finished';
    default:
      return 'not_started';
  }
}

/** Ação principal sugerida — a que ganha o botão grande da home. */
export function primaryAction(punches: readonly PunchRecord[]): PunchType {
  return nextPunchOptions(lastPunchType(punches))[0];
}

/** Ações restantes (ex.: "Registrar saída" quando a principal é o intervalo). */
export function secondaryActions(punches: readonly PunchRecord[]): PunchType[] {
  return nextPunchOptions(lastPunchType(punches)).slice(1);
}

/* ───────────────────── resumo do dia ───────────────────── */

export interface DailySummary {
  clockIn: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  clockOut: string | null;
  /** Minutos efetivamente trabalhados (fora dos intervalos). */
  workedMinutes: number;
  /** Minutos em intervalo. */
  breakMinutes: number;
  /** Há um trecho ainda em contagem (jornada ou intervalo aberto). */
  open: boolean;
  underReviewCount: number;
}

/**
 * Percorre as marcações em ordem e soma os trechos trabalhados e de
 * intervalo. `now` é injetado para manter a função determinística.
 *
 * `countOpen = false` fecha o relógio nos trechos ainda abertos: um dia
 * passado sem saída não pode contar até a meia-noite como se a pessoa
 * tivesse trabalhado — ele conta o que foi fechado e fica "Incompleto".
 */
export function computeDailySummary(
  punches: readonly PunchRecord[],
  now: number = Date.now(),
  countOpen = true,
): DailySummary {
  const list = effectivePunches(punches);
  const first = (type: PunchType): string | null =>
    list.find((p) => p.type === type)?.occurred_at ?? null;
  const lastOf = (type: PunchType): string | null => {
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].type === type) return list[i].occurred_at;
    return null;
  };

  let workedMs = 0;
  let breakMs = 0;
  let workingSince: number | null = null;
  let breakSince: number | null = null;

  for (const punch of list) {
    const at = new Date(punch.occurred_at).getTime();
    if (Number.isNaN(at)) continue;
    switch (punch.type) {
      case 'clock_in':
      case 'break_end':
        if (breakSince != null) {
          breakMs += Math.max(0, at - breakSince);
          breakSince = null;
        }
        workingSince ??= at;
        break;
      case 'break_start':
        if (workingSince != null) {
          workedMs += Math.max(0, at - workingSince);
          workingSince = null;
        }
        breakSince ??= at;
        break;
      case 'clock_out':
        if (breakSince != null) {
          breakMs += Math.max(0, at - breakSince);
          breakSince = null;
        }
        if (workingSince != null) {
          workedMs += Math.max(0, at - workingSince);
          workingSince = null;
        }
        break;
    }
  }

  const open = workingSince != null || breakSince != null;
  if (countOpen) {
    if (workingSince != null) workedMs += Math.max(0, now - workingSince);
    if (breakSince != null) breakMs += Math.max(0, now - breakSince);
  }

  return {
    clockIn: first('clock_in'),
    breakStart: first('break_start'),
    breakEnd: lastOf('break_end'),
    clockOut: lastOf('clock_out'),
    workedMinutes: Math.floor(workedMs / 60_000),
    breakMinutes: Math.floor(breakMs / 60_000),
    open,
    underReviewCount: list.filter((p) => p.status === 'under_review').length,
  };
}

/* ───────────────────── histórico por dia ───────────────────── */

export type DayStatus =
  | 'complete'
  | 'incomplete'
  | 'under_review'
  | 'adjusted'
  | 'rejected'
  | 'pending_sync'
  | 'absent';

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  complete: 'Completo',
  incomplete: 'Incompleto',
  under_review: 'Em análise',
  adjusted: 'Ajustado',
  rejected: 'Recusado',
  pending_sync: 'Aguardando sincronização',
  absent: 'Sem registro',
};

export interface DayRecord {
  /** Data local no formato YYYY-MM-DD. */
  date: string;
  punches: PunchRecord[];
  summary: DailySummary;
  status: DayStatus;
}

/** YYYY-MM-DD no fuso do dispositivo (o dia de trabalho é local, não UTC). */
export function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function deriveDayStatus(punches: readonly PunchRecord[]): DayStatus {
  if (punches.length === 0) return 'absent';
  if (punches.some((p) => p.status === PENDING_SYNC_STATUS)) return 'pending_sync';
  if (punches.some((p) => p.status === 'under_review')) return 'under_review';
  const effective = effectivePunches(punches);
  if (effective.length === 0) return 'rejected';
  if (punches.some((p) => p.original_punch_id)) return 'adjusted';
  const last = effective[effective.length - 1].type;
  return last === 'clock_out' ? 'complete' : 'incomplete';
}

/**
 * Agrupa o histórico em cartões diários, do mais recente para o mais
 * antigo. Marcações canceladas continuam visíveis no dia (o colaborador
 * precisa entender o que foi recusado), mas não entram no cálculo.
 */
export function groupPunchesByDay(
  punches: readonly PunchRecord[],
  now: number = Date.now(),
): DayRecord[] {
  const byDay = new Map<string, PunchRecord[]>();
  for (const punch of punches) {
    const key = localDayKey(punch.occurred_at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(punch);
    else byDay.set(key, [punch]);
  }

  return Array.from(byDay.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, dayPunches]) => {
      const ordered = dayPunches
        .slice()
        .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
      // Só o dia corrente conta o tempo em curso. Num dia já encerrado, uma
      // jornada sem saída fica "Incompleta" — nunca somando até a meia-noite.
      const isToday = date === localDayKey(new Date(now).toISOString());
      return {
        date,
        punches: ordered,
        summary: computeDailySummary(ordered, now, isToday),
        status: deriveDayStatus(ordered),
      };
    });
}

/* ───────────────────── formatação ───────────────────── */

export function formatTime(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "8h17m" — compacto, legível ao sol. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0h00m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, '0')}m`;
}

export function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
}

export function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}
