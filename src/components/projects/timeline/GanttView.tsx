'use client';

/**
 * Enterprise Gantt — left WBS grid + right chart pane.
 * Single shared vertical scroll container keeps rows aligned; horizontal
 * scroll lives only on the chart pane (no page-level overflow).
 */

import React, { useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight, Diamond } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildTree,
  deriveDelayStatus,
  flattenTree,
  ganttBar,
  ganttScale,
  ganttX,
  type TimelineNode,
} from '@/lib/projects/timeline-analytics';
import { DELAY_STATUS_LABELS, TIMELINE_STATUS_LABELS, type TimelineItem } from '@/lib/types/project-timeline';
import { useTimelineStore } from './timeline-store';

const ROW_H = 36;
const GRID_W = 460;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

const DELAY_DOT: Record<string, string> = {
  on_track: 'bg-ig-success',
  at_risk: 'bg-ig-warning',
  delayed: 'bg-ig-danger',
  blocked: 'bg-ig-danger',
};

const BAR_COLOR: Record<string, string> = {
  on_track: 'bg-[color-mix(in_oklab,var(--ig-accent)_75%,transparent)]',
  at_risk: 'bg-[color-mix(in_oklab,var(--ig-warning)_80%,transparent)]',
  delayed: 'bg-[color-mix(in_oklab,var(--ig-danger)_80%,transparent)]',
  blocked: 'bg-[color-mix(in_oklab,var(--ig-danger)_80%,transparent)]',
  completed: 'bg-[color-mix(in_oklab,var(--ig-success)_70%,transparent)]',
};

export interface GanttViewProps {
  items: TimelineItem[];
}

export function GanttView({ items }: GanttViewProps) {
  const { collapsed, zoom, selectedItemId, toggleCollapse, selectItem } = useTimelineStore();
  const now = useMemo(() => new Date(), []);
  const chartScrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const roots = buildTree(items);
    return flattenTree(roots, collapsed);
  }, [items, collapsed]);

  const scale = useMemo(() => ganttScale(items, zoom, now), [items, zoom, now]);
  const todayX = ganttX(scale, now.toISOString().slice(0, 10));
  const contentHeight = visible.length * ROW_H;

  const renderGridRow = (node: TimelineNode) => {
    const item = node.item;
    const ds = item.status === 'completed' ? 'completed' : deriveDelayStatus(item, now);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedItemId === item.id;
    const responsible = item.assignments?.find((a) => a.role === 'responsible' && !a.removedAt);

    return (
      <div
        key={item.id}
        role="row"
        onClick={() => selectItem(item.id)}
        className={cn(
          'grid cursor-pointer items-center gap-1 border-b border-ig-border px-2 text-xs transition-colors',
          'grid-cols-[56px_1fr_44px_56px_56px_22px]',
          isSelected ? 'bg-ig-accent-weak' : 'hover:bg-ig-panel-hover',
        )}
        style={{ height: ROW_H }}
      >
        <span className="font-mono text-[10px] text-ig-fg-muted truncate">{item.wbsCode ?? ''}</span>
        <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: node.depth * 14 }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleCollapse(item.id);
              }}
              className="shrink-0 text-ig-fg-muted hover:text-ig-fg"
              aria-label={collapsed.has(item.id) ? 'Expandir' : 'Recolher'}
            >
              {collapsed.has(item.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {item.isMilestone && <Diamond className="h-3 w-3 shrink-0 text-ig-accent" />}
          <span
            className={cn('truncate', item.isSummary ? 'font-semibold text-ig-fg' : 'text-ig-fg')}
            title={`${item.title} — ${TIMELINE_STATUS_LABELS[item.status]}`}
          >
            {item.title}
          </span>
        </span>
        <span className="text-right tabular-nums text-ig-fg-muted">{Math.round(item.percentComplete)}%</span>
        <span className="tabular-nums text-ig-fg-muted">{fmtDate(item.plannedStart)}</span>
        <span className="tabular-nums text-ig-fg-muted">{fmtDate(item.plannedFinish)}</span>
        <span className="flex items-center justify-center gap-1">
          {responsible && (
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full bg-ig-panel-hover text-[8px] font-semibold text-ig-fg-muted"
              title={`Responsável: ${responsible.userName ?? ''}`}
            >
              {(responsible.userName ?? '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <span
            className={cn('h-2 w-2 rounded-full', DELAY_DOT[ds] ?? DELAY_DOT.on_track)}
            title={DELAY_STATUS_LABELS[ds === 'completed' ? 'on_track' : (ds as keyof typeof DELAY_STATUS_LABELS)] ?? ''}
          />
        </span>
      </div>
    );
  };

  const renderBar = (node: TimelineNode, rowIndex: number) => {
    const item = node.item;
    const geom = ganttBar(scale, item);
    if (!geom) return null;
    const ds = item.status === 'completed' ? 'completed' : deriveDelayStatus(item, now);
    const top = rowIndex * ROW_H;

    if (item.isMilestone) {
      const x = ganttX(scale, item.plannedFinish ?? item.plannedStart);
      if (x === null) return null;
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => selectItem(item.id)}
          className="absolute z-10"
          style={{ left: x - 6, top: top + ROW_H / 2 - 6 }}
          title={item.title}
        >
          <span
            className={cn(
              'block h-3 w-3 rotate-45 border',
              item.status === 'completed'
                ? 'bg-ig-success border-ig-success'
                : 'bg-ig-accent border-ig-accent',
            )}
          />
        </button>
      );
    }

    if (item.isSummary) {
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => selectItem(item.id)}
          className="absolute z-10 rounded-sm bg-ig-fg-muted/70"
          style={{ left: geom.left, width: geom.width, top: top + ROW_H / 2 - 3, height: 5 }}
          title={item.title}
        />
      );
    }

    const progress = Math.min(100, Math.max(0, item.percentComplete));
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => selectItem(item.id)}
        className={cn(
          'absolute z-10 overflow-hidden rounded-md border border-black/10',
          BAR_COLOR[ds] ?? BAR_COLOR.on_track,
        )}
        style={{ left: geom.left, width: geom.width, top: top + 7, height: ROW_H - 14 }}
        title={`${item.title} — ${Math.round(progress)}%`}
      >
        <span className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${progress}%` }} />
      </button>
    );
  };

  return (
    <div className="overflow-hidden rounded-xl border border-ig-border">
      {/* Headers */}
      <div className="flex border-b border-ig-border bg-ig-bg-elevated text-[10px] font-medium uppercase tracking-wide text-ig-fg-muted">
        <div
          className="grid shrink-0 items-center gap-1 border-r border-ig-border px-2 py-2 grid-cols-[56px_1fr_44px_56px_56px_22px]"
          style={{ width: GRID_W }}
        >
          <span>EDT</span>
          <span>Atividade</span>
          <span className="text-right">%</span>
          <span>Início</span>
          <span>Término</span>
          <span />
        </div>
        <div className="flex-1 overflow-hidden">
          <GanttHeader scale={scale} syncWith={chartScrollRef} />
        </div>
      </div>

      {/* Body — shared vertical scroll */}
      <div className="max-h-[58vh] overflow-y-auto">
        <div className="flex">
          <div className="shrink-0 border-r border-ig-border" style={{ width: GRID_W }}>
            {visible.map(renderGridRow)}
          </div>
          <div className="flex-1 overflow-x-auto" ref={chartScrollRef}>
            <div className="relative" style={{ width: scale.totalWidth, height: contentHeight }}>
              {/* tick gridlines */}
              {scale.ticks.map((tick, i) => (
                <span
                  key={i}
                  className={cn(
                    'absolute inset-y-0 w-px',
                    tick.groupStart ? 'bg-ig-border-strong' : 'bg-ig-border/60',
                  )}
                  style={{ left: i * scale.tickWidth }}
                />
              ))}
              {/* row separators */}
              {visible.map((_, i) => (
                <span
                  key={`r-${i}`}
                  className="absolute left-0 right-0 h-px bg-ig-border/50"
                  style={{ top: (i + 1) * ROW_H }}
                />
              ))}
              {/* today line */}
              {todayX !== null && todayX >= 0 && todayX <= scale.totalWidth && (
                <span
                  className="absolute inset-y-0 z-20 w-[2px] bg-ig-danger"
                  style={{ left: todayX }}
                  title="Hoje"
                />
              )}
              {visible.map((node, i) => renderBar(node, i))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Date header rendered above the chart pane. Mirrors the chart's horizontal
 * scroll position (the header itself lives outside the scroller so the grid
 * header stays fixed).
 */
function GanttHeader({
  scale,
  syncWith,
}: {
  scale: ReturnType<typeof ganttScale>;
  syncWith: React.RefObject<HTMLDivElement | null>;
}) {
  const innerRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const scroller = syncWith.current;
    const inner = innerRef.current;
    if (!scroller || !inner) return;
    const onScroll = () => {
      inner.style.transform = `translateX(-${scroller.scrollLeft}px)`;
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [syncWith]);

  // Group ticks into upper-tier segments (month/year).
  const groups: { label: string; span: number }[] = [];
  for (const tick of scale.ticks) {
    const last = groups[groups.length - 1];
    if (last && last.label === tick.groupLabel) last.span += 1;
    else groups.push({ label: tick.groupLabel, span: 1 });
  }

  return (
    <div ref={innerRef} style={{ width: scale.totalWidth }}>
      <div className="flex border-b border-ig-border/60">
        {groups.map((g, i) => (
          <span
            key={i}
            className="truncate border-r border-ig-border/40 px-1 py-0.5 text-[9px]"
            style={{ width: g.span * scale.tickWidth }}
          >
            {g.label}
          </span>
        ))}
      </div>
      <div className="flex">
        {scale.ticks.map((tick, i) => (
          <span key={i} className="shrink-0 px-1 py-0.5 text-[9px] tabular-nums" style={{ width: scale.tickWidth }}>
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
