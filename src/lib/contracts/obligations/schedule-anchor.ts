/**
 * Regra contratual ancorada em AGENDA operacional.
 *
 * ─── O terceiro estado ─────────────────────────────────────────────────────
 *
 * "Os documentos devem ser entregues 5 dias úteis antes da medição."
 *
 * No dia em que o contrato entra, a REGRA é conhecida por inteiro e a DATA não
 * existe — depende de uma medição que Projetos ainda não agendou. As duas
 * respostas que o modelo antigo sabia dar estavam erradas das duas pontas:
 * inventar uma data a partir do início do contrato produz um prazo falso com
 * cara de verdadeiro; devolver DESCONHECIDO para sempre é verdadeiro e inútil,
 * porque quando a medição for agendada nada recalcula nada.
 *
 * `AWAITING_SCHEDULE_ANCHOR` é o estado correto: regra conhecida, âncora
 * conhecida, agenda pendente. Ele não é uma pendência de cadastro que alguém
 * precise resolver — é a descrição fiel da situação.
 *
 * ─── Fronteira ─────────────────────────────────────────────────────────────
 *
 * Contratos é dono do QUE. Projetos é dono do QUANDO. Este módulo calcula a
 * data a partir de uma agenda que Projetos publicou; ele nunca escolhe a
 * agenda, nunca a corrige e nunca a inventa quando ela falta.
 *
 * Espelha `contract_obligations_apply_schedule_anchor()` e
 * `organization_shift_business_days()` (migration 155), que são a autoridade.
 */

/** Evento operacional a que um prazo contratual pode se amarrar. */
export type ScheduleAnchor =
  | 'measurement'
  | 'measurement_acceptance'
  | 'project_milestone'
  | 'project_start'
  | 'project_end';

export type DateState = 'RESOLVED' | 'AWAITING_SCHEDULE_ANCHOR' | 'UNKNOWN';

export type CalendarBasis = 'calendar_days' | 'business_days' | 'unspecified';

export type AnchoredDueKind = 'days_before_schedule_anchor' | 'days_after_schedule_anchor';

export const SCHEDULE_ANCHOR_LABEL: Record<ScheduleAnchor, string> = {
  measurement: 'medição',
  measurement_acceptance: 'aceite da medição',
  project_milestone: 'marco do projeto',
  project_start: 'início do projeto',
  project_end: 'fim do projeto',
};

export const DATE_STATE_LABEL: Record<DateState, string> = {
  RESOLVED: 'Prazo definido',
  AWAITING_SCHEDULE_ANCHOR: 'Aguardando agenda',
  UNKNOWN: 'Prazo desconhecido',
};

/**
 * Calendário DECLARADO da organização.
 *
 * A ausência de declaração não é um calendário vazio: é a ausência de
 * calendário. Sem ela, "5 dias úteis" continua sem resposta — contar como dias
 * corridos erraria o prazo e pareceria certo.
 */
export interface BusinessCalendar {
  /** ISO: 1 = segunda … 7 = domingo. */
  businessWeekdays: readonly number[];
  /** Feriados e demais dias não úteis, em `YYYY-MM-DD`. */
  nonBusinessDays: ReadonlySet<string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` → UTC Date. Datas de contrato são civis, nunca instantes. */
export function parseCivilDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCivilDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO weekday (1 = segunda … 7 = domingo) de uma data civil UTC. */
function isoWeekday(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Desloca N dias ÚTEIS. `null` quando não há calendário declarado — a mesma
 * resposta que o banco dá, e pela mesma razão.
 */
export function shiftBusinessDays(
  from: string,
  days: number,
  calendar: BusinessCalendar | null,
): string | null {
  if (!calendar) return null;
  const start = parseCivilDate(from);
  if (!start) return null;
  if (days === 0) return from;

  const step = days > 0 ? 1 : -1;
  const target = Math.abs(days);
  const weekdays = new Set(calendar.businessWeekdays);
  let cursor = start;
  let moved = 0;
  let guard = 0;

  while (moved < target) {
    guard += 1;
    // Um calendário patológico não pode virar laço eterno.
    if (guard > 3650) return null;
    cursor = new Date(cursor.getTime() + step * DAY_MS);
    const iso = formatCivilDate(cursor);
    if (weekdays.has(isoWeekday(cursor)) && !calendar.nonBusinessDays.has(iso)) {
      moved += 1;
    }
  }
  return formatCivilDate(cursor);
}

/** Dias corridos, que não dependem de calendário nenhum. */
export function shiftCalendarDays(from: string, days: number): string | null {
  const start = parseCivilDate(from);
  if (!start) return null;
  return formatCivilDate(new Date(start.getTime() + days * DAY_MS));
}

export interface AnchoredRule {
  anchor: ScheduleAnchor;
  dueKind: AnchoredDueKind;
  offsetDays: number;
  calendarBasis: CalendarBasis;
}

export interface ResolvedDeadline {
  dueDate: string | null;
  dueConfidence: 'known' | 'unknown';
  dateState: DateState;
  basis: string;
}

/**
 * O prazo operacional real, uma vez que a agenda existe.
 *
 * `anchorDate === null` devolve AWAITING_SCHEDULE_ANCHOR: a agenda ainda não
 * foi publicada, e nenhuma data é inventada para preencher a lacuna.
 */
export function resolveAnchoredDeadline(
  rule: AnchoredRule,
  anchorDate: string | null,
  calendar: BusinessCalendar | null,
): ResolvedDeadline {
  if (!anchorDate) {
    return {
      dueDate: null,
      dueConfidence: 'unknown',
      dateState: 'AWAITING_SCHEDULE_ANCHOR',
      basis: `prazo ancorado em ${SCHEDULE_ANCHOR_LABEL[rule.anchor]} ainda não agendado`,
    };
  }

  const signed = rule.dueKind === 'days_before_schedule_anchor' ? -rule.offsetDays : rule.offsetDays;

  if (rule.calendarBasis === 'business_days') {
    const due = shiftBusinessDays(anchorDate, signed, calendar);
    if (due === null) {
      return {
        dueDate: null,
        dueConfidence: 'unknown',
        dateState: 'UNKNOWN',
        basis: 'regra em dias úteis sem calendário declarado pela organização',
      };
    }
    return {
      dueDate: due,
      dueConfidence: 'known',
      dateState: 'RESOLVED',
      basis: `${rule.dueKind} (${rule.offsetDays} dias úteis)`,
    };
  }

  const due = shiftCalendarDays(anchorDate, signed);
  if (due === null) {
    return { dueDate: null, dueConfidence: 'unknown', dateState: 'UNKNOWN', basis: 'âncora inválida' };
  }
  return {
    dueDate: due,
    dueConfidence: 'known',
    dateState: 'RESOLVED',
    basis: `${rule.dueKind} (${rule.offsetDays} dias corridos)`,
  };
}

/**
 * A frase que o dossiê mostra no lugar de um prazo.
 *
 * Uma exigência aguardando agenda não deve parecer atrasada nem esquecida; ela
 * deve dizer o que falta e de quem depende.
 */
export function scheduleAnchorNotice(anchor: ScheduleAnchor | null, dateState: DateState): string | null {
  if (dateState !== 'AWAITING_SCHEDULE_ANCHOR') return null;
  const label = anchor ? SCHEDULE_ANCHOR_LABEL[anchor] : 'evento operacional';
  return `O Apex já entendeu esta exigência. O prazo será calculado quando a ${label} for agendada.`;
}
