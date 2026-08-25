/**
 * Inteligência de CRONOGRAMA — plano × realidade das datas.
 *
 * Vive separado de `timeline-execution.ts` de propósito: aqui nada depende do
 * apontamento. Progresso esperado, variação de prazo, atraso previsto e marcos
 * em risco saem de `project_timeline_items` puro, então continuam disponíveis
 * para quem NÃO tem `people.timesheet_view`. Misturar as duas camadas esconderia
 * inteligência de prazo atrás de uma permissão de horas.
 *
 * Puro: sem Supabase, sem React.
 *
 * ─── Limite do modelo ──────────────────────────────────────────────────────
 * `expectedProgress` é linear sobre dias de CALENDÁRIO entre início e término
 * planejados. É uma convenção de curva-S simplificada, determinística e
 * auditável — não uma previsão. Onde faltar data, o valor é null, nunca 0.
 */

import type { DependencyType, TimelineDependency, TimelineItem } from '@/lib/types/project-timeline';
import { isItemDelayed } from '@/lib/projects/timeline-analytics';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela em que um marco aberto passa a ser observado como "em risco". */
export const MILESTONE_RISK_WINDOW_DAYS = 14;

const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'delayed']);

function dateOf(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / DAY_MS);
}

export interface ScheduleSignal {
  itemId: string;
  /** % que o item DEVERIA ter hoje pelo plano. null sem datas. */
  expectedProgress: number | null;
  /** percentComplete − expectedProgress. Negativo = atrás do plano. */
  progressVariancePct: number | null;
  /** Dias entre o término efetivo e o planejado. Positivo = atrasado. */
  scheduleVarianceDays: number | null;
  /** Término que vale hoje: real → previsto → hoje (se vencido) → planejado. */
  effectiveFinish: string | null;
  isOverdue: boolean;
  /** Atrás do plano além da tolerância, ainda sem estar vencido. */
  behindSchedule: boolean;
}

export interface MilestoneRisk {
  itemId: string;
  title: string;
  plannedFinish: string | null;
  daysUntil: number | null;
  reason: 'overdue' | 'predecessor_late' | 'predecessor_open';
}

export interface ProjectScheduleIntelligence {
  byItem: Map<string, ScheduleSignal>;
  /** Maior plannedFinish entre os itens ativos. */
  plannedFinish: string | null;
  /** Maior término efetivo — a data que o plano indica hoje. */
  projectedFinish: string | null;
  /** projectedFinish − plannedFinish, em dias. null sem base. */
  forecastDelayDays: number | null;
  milestonesAtRisk: MilestoneRisk[];
  /** Média ponderada por duração do progresso esperado das folhas. */
  expectedProgressOverall: number | null;
}

/** Tolerância antes de chamar um item de "atrás do plano" (pontos de %). */
const BEHIND_TOLERANCE_PCT = 15;

/**
 * % esperado hoje. Concluído vale 100. Antes do início, 0 (observado: o plano
 * diz que não deveria ter começado). Sem datas, null.
 */
export function expectedProgressOf(item: TimelineItem, now: Date): number | null {
  if (item.status === 'completed') return 100;
  const start = dateOf(item.plannedStart);
  const finish = dateOf(item.plannedFinish);
  if (!start || !finish) return null;

  const today = startOfDay(now).getTime();
  const s = startOfDay(start).getTime();
  // Término é inclusivo: o item tem o dia do término inteiro para terminar.
  const f = startOfDay(finish).getTime() + DAY_MS;
  if (today <= s) return 0;
  if (today >= f) return 100;
  return Math.round(((today - s) / (f - s)) * 100);
}

/**
 * Término que vale hoje, na ordem em que a evidência manda:
 * real (aconteceu) → previsto (alguém reportou) → hoje (venceu e segue aberto)
 * → planejado (nada indica desvio).
 */
export function effectiveFinishOf(item: TimelineItem, now: Date): string | null {
  if (item.actualFinish) return item.actualFinish;
  if (item.forecastFinish) return item.forecastFinish;
  if (!item.plannedFinish) return null;
  if (isItemDelayed(item, now)) return startOfDay(now).toISOString().slice(0, 10);
  return item.plannedFinish;
}

export function buildScheduleSignal(item: TimelineItem, now: Date): ScheduleSignal {
  const expectedProgress = expectedProgressOf(item, now);
  const progressVariancePct =
    expectedProgress == null ? null : Math.round(item.percentComplete - expectedProgress);

  const effectiveFinish = effectiveFinishOf(item, now);
  const planned = dateOf(item.plannedFinish);
  const effective = dateOf(effectiveFinish);
  const scheduleVarianceDays = planned && effective ? daysBetween(effective, planned) : null;

  const isOverdue = isItemDelayed(item, now);

  return {
    itemId: item.id,
    expectedProgress,
    progressVariancePct,
    scheduleVarianceDays,
    effectiveFinish,
    isOverdue,
    behindSchedule:
      !isOverdue &&
      OPEN_STATUSES.has(item.status) &&
      progressVariancePct != null &&
      progressVariancePct < -BEHIND_TOLERANCE_PCT,
  };
}

/** Predecessoras diretas de cada item, a partir das dependências carregadas. */
function predecessorsOf(deps: TimelineDependency[]): Map<string, { id: string; type: DependencyType }[]> {
  const map = new Map<string, { id: string; type: DependencyType }[]>();
  for (const dep of deps) {
    const list = map.get(dep.successorId);
    if (list) list.push({ id: dep.predecessorId, type: dep.type });
    else map.set(dep.successorId, [{ id: dep.predecessorId, type: dep.type }]);
  }
  return map;
}

export interface BuildScheduleIntelligenceInput {
  items: TimelineItem[];
  dependencies?: TimelineDependency[];
  now: Date;
}

export function buildScheduleIntelligence(
  input: BuildScheduleIntelligenceInput,
): ProjectScheduleIntelligence {
  const { items, dependencies = [], now } = input;
  const active = items.filter((i) => i.isActive && !i.deletedAt);
  const byItem = new Map<string, ScheduleSignal>();
  for (const item of active) byItem.set(item.id, buildScheduleSignal(item, now));

  /* ─── Datas do projeto ─── */
  const plannedDates = active.map((i) => i.plannedFinish).filter((d): d is string => Boolean(d));
  const plannedFinish = plannedDates.length ? plannedDates.reduce((a, b) => (a > b ? a : b)) : null;

  const effectiveDates = active
    .map((i) => byItem.get(i.id)?.effectiveFinish ?? null)
    .filter((d): d is string => Boolean(d));
  const projectedFinish = effectiveDates.length ? effectiveDates.reduce((a, b) => (a > b ? a : b)) : null;

  const p = dateOf(plannedFinish);
  const e = dateOf(projectedFinish);
  const forecastDelayDays = p && e ? daysBetween(e, p) : null;

  /* ─── Progresso esperado geral (mesmo peso do overallPercent) ─── */
  const leaves = active.filter((i) => !i.isSummary);
  let weightTotal = 0;
  let weightedExpected = 0;
  let anyExpected = false;
  for (const leaf of leaves) {
    const expected = byItem.get(leaf.id)?.expectedProgress;
    if (expected == null) continue;
    anyExpected = true;
    const weight = leaf.durationMinutes && leaf.durationMinutes > 0 ? leaf.durationMinutes : 60;
    weightTotal += weight;
    weightedExpected += weight * (expected / 100);
  }
  const expectedProgressOverall =
    anyExpected && weightTotal > 0 ? Math.round((weightedExpected / weightTotal) * 100) : null;

  /* ─── Marcos em risco ─── */
  const itemById = new Map(active.map((i) => [i.id, i]));
  const preds = predecessorsOf(dependencies);
  const milestonesAtRisk: MilestoneRisk[] = [];

  for (const item of active) {
    if (!item.isMilestone || !OPEN_STATUSES.has(item.status)) continue;
    const signal = byItem.get(item.id)!;
    const finish = dateOf(item.plannedFinish);
    const daysUntil = finish ? daysBetween(finish, now) : null;

    let reason: MilestoneRisk['reason'] | null = null;
    if (signal.isOverdue) {
      reason = 'overdue';
    } else {
      const direct = preds.get(item.id) ?? [];
      const latePred = direct.some((d) => {
        const pred = itemById.get(d.id);
        return pred ? byItem.get(pred.id)?.isOverdue || pred.status === 'blocked' : false;
      });
      if (latePred) {
        reason = 'predecessor_late';
      } else if (
        daysUntil != null &&
        daysUntil >= 0 &&
        daysUntil <= MILESTONE_RISK_WINDOW_DAYS &&
        direct.some((d) => itemById.get(d.id)?.status !== 'completed')
      ) {
        reason = 'predecessor_open';
      }
    }

    if (reason) {
      milestonesAtRisk.push({
        itemId: item.id,
        title: item.title,
        plannedFinish: item.plannedFinish,
        daysUntil,
        reason,
      });
    }
  }

  milestonesAtRisk.sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999));

  return {
    byItem,
    plannedFinish,
    projectedFinish,
    forecastDelayDays,
    milestonesAtRisk,
    expectedProgressOverall,
  };
}

export const EMPTY_SCHEDULE_INTELLIGENCE: ProjectScheduleIntelligence = {
  byItem: new Map(),
  plannedFinish: null,
  projectedFinish: null,
  forecastDelayDays: null,
  milestonesAtRisk: [],
  expectedProgressOverall: null,
};

/** Dias com sinal explícito. null ⇒ travessão. */
export function formatDays(days: number | null): string {
  if (days == null) return '—';
  if (days === 0) return 'no prazo';
  const sign = days > 0 ? '+' : '';
  return `${sign}${days} d`;
}

/** Pontos percentuais com sinal. null ⇒ travessão. */
export function formatPct(points: number | null): string {
  if (points == null) return '—';
  const sign = points > 0 ? '+' : '';
  return `${sign}${points} p.p.`;
}
