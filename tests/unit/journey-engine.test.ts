import { describe, expect, it } from 'vitest';
import { buildJourneyDaySummary, resolveJourneySchedule } from '@/lib/services/journey-engine';
import type {
  JourneyBalanceApproval,
  JourneyScheduleException,
  JourneyShiftAssignment,
  JourneyShiftTemplate,
} from '@/lib/types/journey-management';
import type { AttendancePunch, PunchType } from '@/lib/types/people';

const template: JourneyShiftTemplate = {
  id: 'shift-1',
  organizationId: 'org-1',
  name: 'Comercial',
  weekdays: [1, 2, 3, 4, 5],
  startTime: '08:00',
  endTime: '17:00',
  breakMinutes: 60,
  toleranceBeforeMinutes: 10,
  toleranceAfterMinutes: 10,
  timezone: 'America/Sao_Paulo',
  active: true,
};
const assignment: JourneyShiftAssignment = {
  id: 'assignment-1',
  organizationId: 'org-1',
  personId: 'person-1',
  shiftTemplateId: template.id,
  projectId: null,
  validFrom: '2026-07-01',
  validUntil: null,
  active: true,
};

function punch(id: string, type: PunchType, occurredAt: string): AttendancePunch {
  return {
    id,
    organizationId: 'org-1',
    personId: 'person-1',
    type,
    occurredAt,
    receivedAt: occurredAt,
    timezone: 'America/Sao_Paulo',
    source: 'mobile',
    status: 'accepted',
    originalPunchId: null,
    correctionReason: null,
    correctedBy: null,
    clientEventId: null,
    notes: null,
    nsr: 1,
    integrityHash: 'hash',
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

function summary(
  punches: AttendancePunch[],
  shift: JourneyShiftTemplate = template,
  approval?: JourneyBalanceApproval,
) {
  const schedule = resolveJourneySchedule('person-1', '2026-07-29', [shift], [assignment], []);
  return buildJourneyDaySummary({
    personId: 'person-1',
    personName: 'Pessoa',
    department: 'Operações',
    date: '2026-07-29',
    schedule,
    punches,
    approval,
    now: new Date('2026-07-30T12:00:00Z'),
  });
}

describe('motor gerencial de jornada', () => {
  it('resolve turno apenas em dia da semana e respeita folga planejada', () => {
    expect(resolveJourneySchedule('person-1', '2026-07-29', [template], [assignment], []))
      .toMatchObject({ templateName: 'Comercial', startTime: '08:00' });
    const exceptions: JourneyScheduleException[] = [{
      id: 'exception-1', organizationId: 'org-1', personId: 'person-1',
      workDate: '2026-07-29', type: 'day_off', startTime: null, endTime: null,
      breakMinutes: null, toleranceBeforeMinutes: null, toleranceAfterMinutes: null,
      reason: 'Folga compensatória',
    }];
    expect(resolveJourneySchedule('person-1', '2026-07-29', [template], [assignment], exceptions)).toBeNull();
    expect(resolveJourneySchedule('person-1', '2026-08-01', [template], [assignment], [])).toBeNull();
  });

  it('calcula jornada, intervalo, HE e saldo em turno diurno', () => {
    const result = summary([
      punch('1', 'clock_in', '2026-07-29T11:00:00Z'),
      punch('2', 'break_start', '2026-07-29T15:00:00Z'),
      punch('3', 'break_end', '2026-07-29T16:00:00Z'),
      punch('4', 'clock_out', '2026-07-29T20:30:00Z'),
    ]);
    expect(result.workedMinutes).toBe(510);
    expect(result.breakMinutes).toBe(60);
    expect(result.expectedMinutes).toBe(480);
    expect(result.overtimeMinutes).toBe(30);
    expect(result.provisionalBalanceMinutes).toBe(30);
  });

  it('aplica tolerância de entrada e detecta atraso após o limite', () => {
    const within = summary([
      punch('1', 'clock_in', '2026-07-29T11:09:00Z'),
      punch('2', 'clock_out', '2026-07-29T20:00:00Z'),
    ]);
    expect(within.exceptions.some((item) => item.type === 'late')).toBe(false);
    const late = summary([
      punch('1', 'clock_in', '2026-07-29T11:11:00Z'),
      punch('2', 'clock_out', '2026-07-29T20:00:00Z'),
    ]);
    expect(late.exceptions.some((item) => item.type === 'late')).toBe(true);
  });

  it('detecta ausência, saída antecipada e intervalo irregular', () => {
    const absent = summary([]);
    expect(absent.status).toBe('absent');
    const early = summary([
      punch('1', 'clock_in', '2026-07-29T11:00:00Z'),
      punch('2', 'break_start', '2026-07-29T15:00:00Z'),
      punch('3', 'break_end', '2026-07-29T15:30:00Z'),
      punch('4', 'clock_out', '2026-07-29T19:00:00Z'),
    ]);
    expect(early.exceptions.map((item) => item.type)).toEqual(
      expect.arrayContaining(['early_departure', 'short_break']),
    );
  });

  it('calcula turno noturno atravessando a meia-noite', () => {
    const nightShift = { ...template, startTime: '22:00', endTime: '06:00', breakMinutes: 60 };
    const result = summary([
      punch('1', 'clock_in', '2026-07-30T01:00:00Z'),
      punch('2', 'break_start', '2026-07-30T05:00:00Z'),
      punch('3', 'break_end', '2026-07-30T06:00:00Z'),
      punch('4', 'clock_out', '2026-07-30T09:00:00Z'),
    ], nightShift);
    expect(result.workedMinutes).toBe(420);
    expect(result.expectedMinutes).toBe(420);
    expect(result.nightMinutes).toBe(360);
  });

  it('só consolida o saldo depois da aprovação', () => {
    const punches = [
      punch('1', 'clock_in', '2026-07-29T11:00:00Z'),
      punch('2', 'clock_out', '2026-07-29T20:30:00Z'),
    ];
    expect(summary(punches).consolidatedBalanceMinutes).toBe(0);
    const approved: JourneyBalanceApproval = {
      id: 'approval-1', organizationId: 'org-1', personId: 'person-1',
      workDate: '2026-07-29', provisionalMinutes: 30, status: 'approved',
      reason: null, decidedBy: 'user-1', decidedAt: '2026-07-30T10:00:00Z',
    };
    expect(summary(punches, template, approved).consolidatedBalanceMinutes).toBe(30);
  });
});
