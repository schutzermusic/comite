import type { AttendancePunch } from '@/lib/types/people';
import type {
  JourneyBalanceApproval,
  JourneyDayStatus,
  JourneyDaySummary,
  JourneyException,
  JourneyScheduleException,
  JourneyShiftAssignment,
  JourneyShiftTemplate,
  ResolvedJourneySchedule,
} from '@/lib/types/journey-management';

function timeMinutes(value: string): number {
  const [hour, minute] = value.slice(0, 5).split(':').map(Number);
  return hour * 60 + minute;
}

function dateParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    date: `${read('year')}-${String(read('month')).padStart(2, '0')}-${String(read('day')).padStart(2, '0')}`,
    minutes: read('hour') * 60 + read('minute'),
  };
}

function weekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function resolveJourneySchedule(
  personId: string,
  date: string,
  templates: JourneyShiftTemplate[],
  assignments: JourneyShiftAssignment[],
  exceptions: JourneyScheduleException[],
): ResolvedJourneySchedule | null {
  const exception = exceptions.find((item) => item.personId === personId && item.workDate === date);
  if (exception?.type === 'day_off' || exception?.type === 'planned_absence') return null;

  const assignment = assignments
    .filter((item) =>
      item.personId === personId
      && item.active
      && item.validFrom <= date
      && (item.validUntil == null || item.validUntil >= date),
    )
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  if (!assignment && exception?.type !== 'custom_shift') return null;

  const template = assignment
    ? templates.find((item) => item.id === assignment.shiftTemplateId && item.active)
    : null;
  if (!template && exception?.type !== 'custom_shift') return null;
  if (template && !template.weekdays.includes(weekday(date)) && exception?.type !== 'custom_shift') {
    return null;
  }

  const startTime = exception?.type === 'custom_shift' && exception.startTime
    ? exception.startTime
    : template!.startTime;
  const endTime = exception?.type === 'custom_shift' && exception.endTime
    ? exception.endTime
    : template!.endTime;

  return {
    personId,
    date,
    templateId: template?.id ?? null,
    templateName: exception?.type === 'custom_shift' ? 'Horário especial' : template!.name,
    projectId: assignment?.projectId ?? null,
    startTime,
    endTime,
    breakMinutes: exception?.breakMinutes ?? template?.breakMinutes ?? 0,
    toleranceBeforeMinutes: exception?.toleranceBeforeMinutes ?? template?.toleranceBeforeMinutes ?? 0,
    toleranceAfterMinutes: exception?.toleranceAfterMinutes ?? template?.toleranceAfterMinutes ?? 0,
    timezone: template?.timezone ?? 'America/Sao_Paulo',
    overnight: timeMinutes(endTime) <= timeMinutes(startTime),
  };
}

function nightOverlap(start: number, end: number): number {
  let result = 0;
  for (let minute = start; minute < end; minute += 1) {
    const normalized = ((minute % 1440) + 1440) % 1440;
    if (normalized >= 22 * 60 || normalized < 5 * 60) result += 1;
  }
  return result;
}

function computePunchDurations(punches: AttendancePunch[], timeZone: string) {
  const accepted = punches
    .filter((punch) => punch.status === 'accepted' || punch.status === 'under_review')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let worked = 0;
  let breaks = 0;
  let night = 0;
  let workStart: number | null = null;
  let breakStart: number | null = null;
  let firstIn: string | null = null;
  let lastOut: string | null = null;
  let dayOffset = 0;
  let previousRawMinute = -1;

  for (const punch of accepted) {
    const rawMinute = dateParts(punch.occurredAt, timeZone).minutes;
    if (previousRawMinute >= 0 && rawMinute < previousRawMinute - 12 * 60) dayOffset += 1440;
    const minute = rawMinute + dayOffset;
    previousRawMinute = rawMinute;
    if (punch.type === 'clock_in') {
      firstIn ??= punch.occurredAt;
      workStart = minute;
    } else if (punch.type === 'break_start') {
      if (workStart != null) {
        worked += Math.max(0, minute - workStart);
        night += nightOverlap(workStart, minute);
      }
      workStart = null;
      breakStart = minute;
    } else if (punch.type === 'break_end') {
      if (breakStart != null) breaks += Math.max(0, minute - breakStart);
      breakStart = null;
      workStart = minute;
    } else if (punch.type === 'clock_out') {
      if (workStart != null) {
        worked += Math.max(0, minute - workStart);
        night += nightOverlap(workStart, minute);
      }
      workStart = null;
      lastOut = punch.occurredAt;
    }
  }
  return {
    accepted,
    firstIn,
    lastOut,
    worked,
    breaks,
    night,
    openWork: workStart != null,
    openBreak: breakStart != null,
    lastType: accepted.at(-1)?.type ?? null,
  };
}

function exception(type: JourneyException['type'], label: string, severity: JourneyException['severity']): JourneyException {
  return { type, label, severity };
}

export function buildJourneyDaySummary(input: {
  personId: string;
  personName: string;
  department: string | null;
  date: string;
  schedule: ResolvedJourneySchedule | null;
  punches: AttendancePunch[];
  approval?: JourneyBalanceApproval;
  reportedMinutes?: number;
  now?: Date;
}): JourneyDaySummary {
  const {
    personId, personName, department, date, schedule, punches, approval,
    reportedMinutes = 0, now = new Date(),
  } = input;
  const timezone = schedule?.timezone ?? 'America/Sao_Paulo';
  const duration = computePunchDurations(punches, timezone);
  const expected = schedule
    ? (
      (timeMinutes(schedule.endTime) + (schedule.overnight ? 1440 : 0))
      - timeMinutes(schedule.startTime)
      - schedule.breakMinutes
    )
    : null;
  const balance = expected == null ? 0 : duration.worked - expected;
  const exceptions: JourneyException[] = [];
  const today = dateParts(now.toISOString(), timezone);
  const isPast = date < today.date;
  const isToday = date === today.date;

  let status: JourneyDayStatus = 'no_schedule';
  if (!schedule) {
    if (duration.accepted.length > 0) status = duration.openWork || duration.openBreak ? 'incomplete' : 'closed';
    exceptions.push(exception('no_schedule', 'Colaborador sem escala atribuída', 'info'));
  } else if (duration.accepted.length === 0) {
    const start = timeMinutes(schedule.startTime) + schedule.toleranceAfterMinutes;
    status = isPast || (isToday && today.minutes > start) ? 'absent' : 'expected';
    if (status === 'absent') exceptions.push(exception('absent', 'Sem marcação para a escala prevista', 'critical'));
  } else if (duration.openBreak) {
    status = 'break';
  } else if (duration.openWork) {
    status = 'working';
  } else if (duration.lastOut) {
    status = 'closed';
  } else {
    status = 'incomplete';
  }

  if (schedule && duration.firstIn) {
    const first = dateParts(duration.firstIn, timezone).minutes;
    if (first > timeMinutes(schedule.startTime) + schedule.toleranceAfterMinutes) {
      exceptions.push(exception('late', 'Entrada após a tolerância', 'warning'));
    }
  }
  if (schedule && duration.lastOut) {
    let out = dateParts(duration.lastOut, timezone).minutes;
    let plannedEnd = timeMinutes(schedule.endTime);
    if (schedule.overnight) {
      if (out < timeMinutes(schedule.startTime)) out += 1440;
      plannedEnd += 1440;
    }
    if (out < plannedEnd - schedule.toleranceBeforeMinutes) {
      exceptions.push(exception('early_departure', 'Saída antes do horário previsto', 'warning'));
    }
  }
  if (duration.openWork || duration.openBreak) {
    exceptions.push(exception('incomplete', 'Sequência de marcações incompleta', 'critical'));
  }
  if (schedule && duration.breaks < schedule.breakMinutes && status === 'closed') {
    exceptions.push(exception('short_break', 'Intervalo abaixo do previsto', 'warning'));
  }
  if (balance > 0) exceptions.push(exception('overtime', 'Saldo positivo aguardando decisão', 'warning'));
  if (duration.accepted.some((punch) => punch.status === 'under_review')) {
    exceptions.push(exception('under_review', 'Marcação em revisão de evidência', 'critical'));
  }

  const unclassified = Math.max(0, duration.worked - reportedMinutes);
  const outside = Math.max(0, reportedMinutes - duration.worked);
  if (unclassified > 0) exceptions.push(exception('unclassified_time', 'Jornada sem apontamento correspondente', 'warning'));
  if (outside > 0) exceptions.push(exception('outside_journey', 'Apontamento fora da jornada', 'critical'));

  return {
    personId,
    personName,
    department,
    date,
    schedule,
    status,
    firstIn: duration.firstIn,
    lastOut: duration.lastOut,
    workedMinutes: duration.worked,
    breakMinutes: duration.breaks,
    expectedMinutes: expected,
    overtimeMinutes: Math.max(0, balance),
    nightMinutes: duration.night,
    provisionalBalanceMinutes: balance,
    consolidatedBalanceMinutes: approval?.status === 'approved' ? approval.provisionalMinutes : 0,
    approvalStatus: approval?.status ?? (balance === 0 ? null : 'pending'),
    exceptions,
    punches: duration.accepted,
    reportedMinutes,
    unclassifiedMinutes: unclassified,
    outsideJourneyMinutes: outside,
  };
}

export function eachDateBetween(start: string, end: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const finish = new Date(`${end}T12:00:00Z`);
  while (cursor <= finish) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}
