import { describe, expect, it } from 'vitest';
import {
  PUNCH_LABEL,
  computeDailySummary,
  deriveDayStatus,
  deriveWorkdayPhase,
  effectivePunches,
  formatDuration,
  groupPunchesByDay,
  lastPunchType,
  nextPunchOptions,
  primaryAction,
  secondaryActions,
} from '@/lib/ponto/attendance-state';
import { PENDING_SYNC_STATUS, type PunchRecord, type PunchType } from '@/lib/ponto/attendance-types';

const DAY = '2026-07-29';

function punch(
  type: PunchType,
  time: string,
  overrides: Partial<PunchRecord> = {},
): PunchRecord {
  const occurredAt = `${DAY}T${time}:00`;
  return {
    id: `${type}-${time}`,
    type,
    occurred_at: occurredAt,
    received_at: occurredAt,
    status: 'accepted',
    can_undo: false,
    ...overrides,
  };
}

/** Meio-dia de 29/07/2026 no fuso local, para congelar o "agora". */
const NOON = new Date(`${DAY}T12:00:00`).getTime();

describe('sequência da jornada', () => {
  it('só oferece a entrada quando o dia ainda não começou', () => {
    expect(nextPunchOptions(null)).toEqual(['clock_in']);
    expect(primaryAction([])).toBe('clock_in');
    expect(secondaryActions([])).toEqual([]);
  });

  it('nunca reoferece "Registrar entrada" depois da entrada (§4)', () => {
    const punches = [punch('clock_in', '08:00')];
    const options = nextPunchOptions(lastPunchType(punches));
    expect(options).not.toContain('clock_in');
    expect(options).toEqual(['break_start', 'clock_out']);
    expect(PUNCH_LABEL[primaryAction(punches)]).toBe('Iniciar intervalo');
  });

  it('em intervalo, a única saída é encerrar o intervalo', () => {
    const punches = [punch('clock_in', '08:00'), punch('break_start', '12:00')];
    expect(nextPunchOptions(lastPunchType(punches))).toEqual(['break_end']);
    expect(deriveWorkdayPhase(punches)).toBe('on_break');
  });

  it('percorre o Fluxo 2 inteiro: entrada → intervalo → retorno → saída', () => {
    const punches: PunchRecord[] = [];
    expect(deriveWorkdayPhase(punches)).toBe('not_started');

    punches.push(punch('clock_in', '08:00'));
    expect(deriveWorkdayPhase(punches)).toBe('working');

    punches.push(punch('break_start', '12:00'));
    expect(deriveWorkdayPhase(punches)).toBe('on_break');

    punches.push(punch('break_end', '13:00'));
    expect(deriveWorkdayPhase(punches)).toBe('working');
    expect(nextPunchOptions(lastPunchType(punches))).toEqual(['break_start', 'clock_out']);

    punches.push(punch('clock_out', '17:00'));
    expect(deriveWorkdayPhase(punches)).toBe('finished');
    expect(nextPunchOptions(lastPunchType(punches))).toEqual(['clock_in']);
  });

  it('ignora marcações canceladas e corrigidas ao decidir a próxima ação', () => {
    const punches = [
      punch('clock_in', '08:00'),
      punch('clock_out', '09:00', { status: 'cancelled' }),
    ];
    expect(effectivePunches(punches)).toHaveLength(1);
    expect(lastPunchType(punches)).toBe('clock_in');
    expect(deriveWorkdayPhase(punches)).toBe('working');
  });

  it('trata a marcação salva no aparelho como efetiva (Fluxo 5)', () => {
    const punches = [punch('clock_in', '08:00', { status: PENDING_SYNC_STATUS })];
    expect(deriveWorkdayPhase(punches)).toBe('working');
    expect(primaryAction(punches)).toBe('break_start');
  });
});

describe('resumo do dia', () => {
  it('desconta o intervalo do total trabalhado', () => {
    const summary = computeDailySummary(
      [
        punch('clock_in', '08:00'),
        punch('break_start', '12:00'),
        punch('break_end', '13:00'),
        punch('clock_out', '17:00'),
      ],
      NOON,
    );
    expect(summary.workedMinutes).toBe(8 * 60);
    expect(summary.breakMinutes).toBe(60);
    expect(summary.open).toBe(false);
    expect(formatDuration(summary.workedMinutes)).toBe('8h00m');
  });

  it('conta o tempo em curso quando a jornada está aberta', () => {
    const summary = computeDailySummary([punch('clock_in', '08:00')], NOON);
    expect(summary.workedMinutes).toBe(4 * 60);
    expect(summary.open).toBe(true);
    expect(summary.clockOut).toBeNull();
  });

  it('conta o intervalo em curso separadamente', () => {
    const summary = computeDailySummary(
      [punch('clock_in', '08:00'), punch('break_start', '11:30')],
      NOON,
    );
    expect(summary.workedMinutes).toBe(3 * 60 + 30);
    expect(summary.breakMinutes).toBe(30);
    expect(summary.open).toBe(true);
  });

  it('soma múltiplos intervalos no mesmo dia', () => {
    const summary = computeDailySummary(
      [
        punch('clock_in', '08:00'),
        punch('break_start', '10:00'),
        punch('break_end', '10:15'),
        punch('break_start', '12:00'),
        punch('break_end', '13:00'),
        punch('clock_out', '17:00'),
      ],
      NOON,
    );
    expect(summary.breakMinutes).toBe(75);
    expect(summary.workedMinutes).toBe(9 * 60 - 75);
  });

  it('não conta marcações canceladas', () => {
    const summary = computeDailySummary(
      [punch('clock_in', '08:00'), punch('clock_out', '17:00', { status: 'cancelled' })],
      NOON,
    );
    expect(summary.open).toBe(true);
    expect(summary.workedMinutes).toBe(4 * 60);
  });

  it('conta zero quando não há marcação', () => {
    const summary = computeDailySummary([], NOON);
    expect(summary.workedMinutes).toBe(0);
    expect(summary.breakMinutes).toBe(0);
    expect(summary.clockIn).toBeNull();
    expect(formatDuration(summary.workedMinutes)).toBe('0h00m');
  });
});

describe('histórico agrupado por dia (Fluxo 8)', () => {
  it('agrupa do mais recente para o mais antigo e fecha dias passados', () => {
    const days = groupPunchesByDay(
      [
        punch('clock_in', '08:00'),
        punch('clock_out', '17:00'),
        {
          ...punch('clock_in', '08:00'),
          id: 'antigo',
          occurred_at: '2026-07-28T08:00:00',
          received_at: '2026-07-28T08:00:00',
        },
      ],
      NOON,
    );
    expect(days.map((d) => d.date)).toEqual(['2026-07-29', '2026-07-28']);
    // Um dia passado sem saída não pode somar até a meia-noite: conta 0 no
    // trecho aberto e fica "Incompleto".
    expect(days[1].summary.workedMinutes).toBe(0);
    expect(days[1].summary.open).toBe(true);
    expect(days[1].status).toBe('incomplete');
    // O dia corrente segue contando o tempo em curso.
    expect(days[0].summary.workedMinutes).toBe(9 * 60);
  });

  it('classifica cada situação exibida no histórico', () => {
    expect(deriveDayStatus([])).toBe('absent');
    expect(deriveDayStatus([punch('clock_in', '08:00'), punch('clock_out', '17:00')])).toBe('complete');
    expect(deriveDayStatus([punch('clock_in', '08:00')])).toBe('incomplete');
    expect(deriveDayStatus([punch('clock_in', '08:00', { status: 'under_review' })])).toBe('under_review');
    expect(deriveDayStatus([punch('clock_in', '08:00', { status: 'cancelled' })])).toBe('rejected');
    expect(deriveDayStatus([punch('clock_in', '08:00', { status: PENDING_SYNC_STATUS })])).toBe('pending_sync');
    expect(
      deriveDayStatus([
        punch('clock_in', '08:00'),
        punch('clock_out', '17:00', { original_punch_id: 'anterior' }),
      ]),
    ).toBe('adjusted');
  });
});

describe('dias passados não extrapolam o tempo trabalhado', () => {
  it('conta só os trechos fechados quando a jornada ficou aberta', () => {
    const summary = computeDailySummary(
      [punch('clock_in', '08:00'), punch('break_start', '12:00'), punch('break_end', '13:00')],
      NOON,
      false,
    );
    expect(summary.workedMinutes).toBe(4 * 60);
    expect(summary.breakMinutes).toBe(60);
    expect(summary.open).toBe(true);
  });
});
