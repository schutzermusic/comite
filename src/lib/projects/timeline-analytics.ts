/**
 * Pure selectors/derivations for the project timeline (no Supabase).
 *
 * Delay status is DERIVED at read time from the item dates + status —
 * the persisted delay_status column only changes on explicit user
 * action (delay report / manual status). Mirrors the risk-analytics
 * "selectors" pattern.
 */

import type { DelayStatus, TimelineItem } from '@/lib/types/project-timeline';

export interface TimelineNode {
  item: TimelineItem;
  children: TimelineNode[];
  depth: number;
}

/** Builds the WBS tree from parent_id, ordered by row_order. */
export function buildTree(items: TimelineItem[]): TimelineNode[] {
  const sorted = [...items].sort((a, b) => a.rowOrder - b.rowOrder);
  const byId = new Map<string, TimelineNode>();
  for (const item of sorted) byId.set(item.id, { item, children: [], depth: 0 });

  const roots: TimelineNode[] = [];
  for (const node of byId.values()) {
    const parent = node.item.parentId ? byId.get(node.item.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const setDepth = (nodes: TimelineNode[], depth: number) => {
    for (const n of nodes) {
      n.depth = depth;
      setDepth(n.children, depth + 1);
    }
  };
  setDepth(roots, 0);
  return roots;
}

/** Flattens the tree honoring a set of collapsed item ids. */
export function flattenTree(roots: TimelineNode[], collapsed: ReadonlySet<string>): TimelineNode[] {
  const out: TimelineNode[] = [];
  const walk = (nodes: TimelineNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (!collapsed.has(n.item.id)) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/* ───────────── Navegação da árvore ───────────── */

/** Ids de todos os ancestrais de `id`, do pai à raiz. Ignora ciclos de parentId. */
export function ancestorIdsOf(items: TimelineItem[], id: string): string[] {
  const parentOf = new Map(items.map((i) => [i.id, i.parentId]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = parentOf.get(id) ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return out;
}

/** Ids de toda a subárvore de `id`, exclusive o próprio. */
export function descendantIdsOf(items: TimelineItem[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    const list = childrenOf.get(item.parentId);
    if (list) list.push(item.id);
    else childrenOf.set(item.parentId, [item.id]);
  }
  const out = new Set<string>();
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    stack.push(...(childrenOf.get(cur) ?? []));
  }
  return out;
}

/**
 * Sobe por parentId até achar um id presente em `visibleIds`.
 * Devolve o próprio id quando ele já é visível, ou null quando nenhum
 * ancestral está visível (item cujo ramo inteiro sumiu).
 */
export function visibleAncestorOf(
  id: string,
  parentOf: ReadonlyMap<string, string | null>,
  visibleIds: ReadonlySet<string>,
): string | null {
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    if (visibleIds.has(cur)) return cur;
    seen.add(cur);
    cur = parentOf.get(cur) ?? null;
  }
  return null;
}

export interface FilteredTree {
  roots: TimelineNode[];
  /** Itens que casam o predicado por mérito próprio. */
  matchedIds: Set<string>;
  /** Ancestrais mantidos apenas para preservar a hierarquia. */
  ancestorIds: Set<string>;
}

/**
 * Poda a árvore mantendo um nó quando ele casa o predicado OU quando algum
 * descendente casa. Ancestrais mantidos por herança entram em `ancestorIds`
 * para que a UI possa esmaecê-los e expandi-los sem tocar no conjunto de
 * recolhidos do usuário.
 */
export function filterTree(roots: TimelineNode[], predicate: (item: TimelineItem) => boolean): FilteredTree {
  const matchedIds = new Set<string>();
  const ancestorIds = new Set<string>();

  const walk = (nodes: TimelineNode[]): TimelineNode[] => {
    const kept: TimelineNode[] = [];
    for (const node of nodes) {
      const self = predicate(node.item);
      if (self) {
        // Uma fase que casa por mérito próprio traz a subárvore inteira:
        // filtrar por "Fase Um" deve mostrar o que está dentro dela.
        matchedIds.add(node.item.id);
        kept.push(node);
        continue;
      }
      const children = walk(node.children);
      if (children.length === 0) continue;
      ancestorIds.add(node.item.id);
      kept.push({ ...node, children });
    }
    return kept;
  };

  return { roots: walk(roots), matchedIds, ancestorIds };
}

/**
 * DFS sobre as arestas existentes: ligar `predecessorId → successorId` fecha
 * um ciclo se `predecessorId` já é alcançável a partir de `successorId`.
 * O banco não tem essa guarda (032 só barra auto-referência).
 */
export function wouldCreateCycle(
  deps: ReadonlyArray<{ predecessorId: string; successorId: string }>,
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;
  const successorsOf = new Map<string, string[]>();
  for (const dep of deps) {
    const list = successorsOf.get(dep.predecessorId);
    if (list) list.push(dep.successorId);
    else successorsOf.set(dep.predecessorId, [dep.successorId]);
  }
  const seen = new Set<string>();
  const stack = [successorId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === predecessorId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(successorsOf.get(cur) ?? []));
  }
  return false;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateOf(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const OPEN_STATUSES = new Set(['not_started', 'in_progress', 'blocked', 'delayed']);

/** Spec section 6: late when past planned finish and not done, or forecast slips. */
export function isItemDelayed(item: TimelineItem, now: Date): boolean {
  if (!OPEN_STATUSES.has(item.status)) return false;
  if (item.status === 'delayed') return true;
  const plannedFinish = dateOf(item.plannedFinish);
  if (plannedFinish && now.getTime() > plannedFinish.getTime() + DAY_MS - 1) return true;
  const forecastFinish = dateOf(item.forecastFinish);
  if (plannedFinish && forecastFinish && forecastFinish.getTime() > plannedFinish.getTime()) return true;
  return false;
}

export function deriveDelayStatus(item: TimelineItem, now: Date): DelayStatus {
  if (item.status === 'blocked') return 'blocked';
  if (isItemDelayed(item, now)) return 'delayed';
  // At risk: open task within 2 days of planned finish with < 80% progress.
  if (OPEN_STATUSES.has(item.status)) {
    const plannedFinish = dateOf(item.plannedFinish);
    if (plannedFinish) {
      const daysLeft = (plannedFinish.getTime() - now.getTime()) / DAY_MS;
      if (daysLeft >= 0 && daysLeft <= 2 && item.percentComplete < 80) return 'at_risk';
    }
  }
  return 'on_track';
}

export interface TimelineKpis {
  totalLeaf: number;
  delayedCount: number;
  atRiskCount: number;
  blockedCount: number;
  completedCount: number;
  milestoneCount: number;
  missingResponsible: number;
  overallPercent: number;
  nextMilestone: TimelineItem | null;
  daysRemaining: number | null;
  projectFinish: string | null;
}

export function timelineKpis(items: TimelineItem[], now: Date): TimelineKpis {
  const active = items.filter((i) => i.isActive && !i.deletedAt);
  const leaves = active.filter((i) => !i.isSummary);

  let delayedCount = 0;
  let atRiskCount = 0;
  let blockedCount = 0;
  let completedCount = 0;
  let missingResponsible = 0;
  let weightedDone = 0;
  let weightTotal = 0;

  for (const item of leaves) {
    const ds = deriveDelayStatus(item, now);
    if (ds === 'delayed') delayedCount += 1;
    if (ds === 'at_risk') atRiskCount += 1;
    if (ds === 'blocked') blockedCount += 1;
    if (item.status === 'completed') completedCount += 1;
    if (!item.responsibleUserId && OPEN_STATUSES.has(item.status)) missingResponsible += 1;
    const weight = item.durationMinutes && item.durationMinutes > 0 ? item.durationMinutes : 60;
    weightTotal += weight;
    weightedDone += weight * (Math.min(100, Math.max(0, item.percentComplete)) / 100);
  }

  const milestones = active
    .filter((i) => i.isMilestone && OPEN_STATUSES.has(i.status) && i.plannedFinish)
    .sort((a, b) => (a.plannedFinish! < b.plannedFinish! ? -1 : 1));
  const nextMilestone =
    milestones.find((m) => {
      const d = dateOf(m.plannedFinish);
      return d ? d.getTime() >= now.getTime() - DAY_MS : false;
    }) ?? milestones[0] ?? null;

  const finishes = active.map((i) => i.plannedFinish).filter((d): d is string => Boolean(d));
  const projectFinish = finishes.length > 0 ? finishes.reduce((a, b) => (a > b ? a : b)) : null;
  const finishDate = dateOf(projectFinish);
  const daysRemaining = finishDate ? Math.ceil((finishDate.getTime() - now.getTime()) / DAY_MS) : null;

  return {
    totalLeaf: leaves.length,
    delayedCount,
    atRiskCount,
    blockedCount,
    completedCount,
    milestoneCount: active.filter((i) => i.isMilestone).length,
    missingResponsible,
    overallPercent: weightTotal > 0 ? Math.round((weightedDone / weightTotal) * 100) : 0,
    nextMilestone,
    daysRemaining,
    projectFinish,
  };
}

/* ───────────── Gantt scale ───────────── */

export type GanttZoom = 'day' | 'week' | 'month';

export interface GanttTick {
  date: Date;
  /** Lower-tier label (day number / week start / month). */
  label: string;
  /** True when this tick starts a new upper-tier group (month/year). */
  groupStart: boolean;
  groupLabel: string;
}

export interface GanttScale {
  start: Date;
  end: Date;
  /** Pixels per millisecond. */
  pxPerMs: number;
  totalWidth: number;
  ticks: GanttTick[];
  tickWidth: number;
}

export const GANTT_TICK_WIDTH: Record<GanttZoom, number> = {
  day: 34,
  week: 64,
  month: 110,
};

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Computes the visible range + ticks for the chart pane. */
export function ganttScale(items: TimelineItem[], zoom: GanttZoom, now: Date): GanttScale {
  const dates: Date[] = [];
  for (const item of items) {
    for (const iso of [item.plannedStart, item.plannedFinish, item.actualStart, item.actualFinish, item.forecastFinish]) {
      const d = dateOf(iso);
      if (d) dates.push(d);
    }
  }
  if (dates.length === 0) dates.push(startOfDay(now));

  let min = new Date(Math.min(...dates.map((d) => d.getTime())));
  let max = new Date(Math.max(...dates.map((d) => d.getTime())));

  // Padding around the schedule so bars never touch the edges.
  min = new Date(min.getTime() - 3 * DAY_MS);
  max = new Date(max.getTime() + 5 * DAY_MS);

  const ticks: GanttTick[] = [];
  const tickWidth = GANTT_TICK_WIDTH[zoom];

  if (zoom === 'day') {
    for (let t = startOfDay(min).getTime(); t <= max.getTime(); t += DAY_MS) {
      const d = new Date(t);
      ticks.push({
        date: d,
        label: String(d.getDate()).padStart(2, '0'),
        groupStart: d.getDate() === 1 || t === startOfDay(min).getTime(),
        groupLabel: `${MONTHS_PT[d.getMonth()]} ${d.getFullYear()}`,
      });
    }
  } else if (zoom === 'week') {
    // Align to Monday.
    const first = startOfDay(min);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getTime() - offset * DAY_MS);
    for (let t = start.getTime(); t <= max.getTime(); t += 7 * DAY_MS) {
      const d = new Date(t);
      ticks.push({
        date: d,
        label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
        groupStart: d.getDate() <= 7,
        groupLabel: `${MONTHS_PT[d.getMonth()]} ${d.getFullYear()}`,
      });
    }
  } else {
    const start = new Date(min.getFullYear(), min.getMonth(), 1);
    const cur = new Date(start);
    while (cur.getTime() <= max.getTime()) {
      ticks.push({
        date: new Date(cur),
        label: MONTHS_PT[cur.getMonth()],
        groupStart: cur.getMonth() === 0 || cur.getTime() === start.getTime(),
        groupLabel: String(cur.getFullYear()),
      });
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const rangeStart = ticks[0]?.date ?? min;
  const lastTick = ticks[ticks.length - 1]?.date ?? max;
  const tickSpanMs = zoom === 'day' ? DAY_MS : zoom === 'week' ? 7 * DAY_MS : 31 * DAY_MS;
  const rangeEnd = new Date(lastTick.getTime() + tickSpanMs);
  const pxPerMs = tickWidth / tickSpanMs;

  return {
    start: rangeStart,
    end: rangeEnd,
    pxPerMs,
    totalWidth: Math.max(ticks.length * tickWidth, 320),
    ticks,
    tickWidth,
  };
}

/** X offset (px) of a date inside the scale. */
export function ganttX(scale: GanttScale, iso: string | null): number | null {
  const d = dateOf(iso);
  if (!d) return null;
  return (d.getTime() - scale.start.getTime()) * scale.pxPerMs;
}

/** Bar geometry for an item (finish is inclusive: +1 day). */
export function ganttBar(scale: GanttScale, item: TimelineItem): { left: number; width: number } | null {
  const left = ganttX(scale, item.plannedStart ?? item.plannedFinish);
  const rightStart = ganttX(scale, item.plannedFinish ?? item.plannedStart);
  if (left === null || rightStart === null) return null;
  const right = rightStart + DAY_MS * scale.pxPerMs;
  return { left, width: Math.max(right - left, 6) };
}

/**
 * Deslocamento (px) do primeiro sábado a partir da borda esquerda da escala.
 *
 * Só faz sentido no zoom de dia, onde 1 tick = 1 dia e a grade é uniforme —
 * o que permite pintar o fim de semana com um único repeating-linear-gradient
 * de período 7 dias em vez de um nó por dia. Devolve null nos demais zooms.
 */
export function weekendPhase(scale: GanttScale, zoom: GanttZoom): { offset: number; period: number; band: number } | null {
  if (zoom !== 'day') return null;
  // getDay(): 0=domingo … 6=sábado. Dias até o próximo sábado, a partir do 1º tick.
  const daysToSaturday = (6 - scale.start.getDay() + 7) % 7;
  return {
    offset: daysToSaturday * scale.tickWidth,
    period: 7 * scale.tickWidth,
    band: 2 * scale.tickWidth, // sábado + domingo
  };
}
