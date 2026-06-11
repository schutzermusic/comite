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
  blockedCount: number;
  completedCount: number;
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
  let blockedCount = 0;
  let completedCount = 0;
  let missingResponsible = 0;
  let weightedDone = 0;
  let weightTotal = 0;

  for (const item of leaves) {
    const ds = deriveDelayStatus(item, now);
    if (ds === 'delayed') delayedCount += 1;
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
    blockedCount,
    completedCount,
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
