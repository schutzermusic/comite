'use client';

/**
 * Cabeçalho de duas faixas (grupo + tick) do painel do gráfico.
 *
 * Vive DENTRO do scroller único, como `sticky top-0`. A versão anterior ficava
 * fora e espelhava `scrollLeft` via transform num efeito — o que produzia um
 * frame de atraso visível ao arrastar. Sticky não tem esse problema.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { GanttScale } from '@/lib/projects/timeline-analytics';
import { COL_W, HEADER_H, TITLE_MIN_W } from './gantt-constants';
import type { TimelineColumn } from '../timeline-store';

export interface GanttTimeHeaderProps {
  scale: GanttScale;
  panelWidth: number;
  columns: Record<TimelineColumn, boolean>;
  executionKnown: boolean;
  todayX: number | null;
}

function HeadCell({ width, className, children }: { width: number; className?: string; children?: React.ReactNode }) {
  return (
    <span className={cn('shrink-0 truncate px-1', className)} style={{ width }}>
      {children}
    </span>
  );
}

export const GanttTimeHeader = React.memo(function GanttTimeHeader({
  scale,
  panelWidth,
  columns,
  executionKnown,
  todayX,
}: GanttTimeHeaderProps) {
  // Agrupa os ticks na faixa superior (mês/ano).
  const groups: { label: string; span: number }[] = [];
  for (const tick of scale.ticks) {
    const last = groups[groups.length - 1];
    if (last && last.label === tick.groupLabel) last.span += 1;
    else groups.push({ label: tick.groupLabel, span: 1 });
  }

  const todayIndex = scale.ticks.findIndex((t) => {
    const d = new Date();
    return (
      t.date.getFullYear() === d.getFullYear() &&
      t.date.getMonth() === d.getMonth() &&
      t.date.getDate() === d.getDate()
    );
  });

  return (
    <div
      className="sticky top-0 z-30 flex border-b border-ig-border bg-ig-raised"
      style={{ height: HEADER_H, width: panelWidth + scale.totalWidth }}
    >
      {/* Canto: fixo nos dois eixos (top + left). */}
      <div
        className={cn(
          'sticky left-0 z-40 flex shrink-0 items-end overflow-hidden border-r border-ig-border bg-ig-raised',
          'pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-subtle',
        )}
        style={{ width: panelWidth }}
      >
        <HeadCell width={COL_W.wbs}>EDT</HeadCell>
        <span className="min-w-0 flex-1 truncate px-1" style={{ minWidth: TITLE_MIN_W }}>
          Atividade
        </span>
        <HeadCell width={COL_W.progress} className="text-right">%</HeadCell>
        <HeadCell width={COL_W.start}>Início</HeadCell>
        <HeadCell width={COL_W.finish}>Término</HeadCell>
        {columns.responsible && <HeadCell width={COL_W.responsible}>Resp.</HeadCell>}
        {columns.status && <HeadCell width={COL_W.status}>Status</HeadCell>}
        {executionKnown && columns.plannedHours && (
          <HeadCell width={COL_W.plannedHours}>Plan.</HeadCell>
        )}
        {executionKnown && columns.loggedHours && (
          <HeadCell width={COL_W.loggedHours}>Apont.</HeadCell>
        )}
        {executionKnown && columns.lastActivity && (
          <HeadCell width={COL_W.lastActivity}>Últ. ap.</HeadCell>
        )}
        <HeadCell width={COL_W.signal} />
      </div>

      {/* Escala de datas */}
      <div className="relative shrink-0" style={{ width: scale.totalWidth }}>
        <div className="flex border-b border-ig-border-subtle">
          {groups.map((g, i) => (
            <span
              key={i}
              className="truncate border-r border-ig-border-subtle px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-ig-fg-muted"
              style={{ width: g.span * scale.tickWidth }}
            >
              {g.label}
            </span>
          ))}
        </div>
        <div className="flex">
          {scale.ticks.map((tick, i) => (
            <span
              key={i}
              className={cn(
                'shrink-0 truncate px-1 py-1 text-center text-[10px] tabular-nums',
                i === todayIndex ? 'font-semibold text-ig-danger' : 'text-ig-fg-subtle',
              )}
              style={{ width: scale.tickWidth }}
            >
              {tick.label}
            </span>
          ))}
        </div>

        {/* Bandeirinha de hoje, ancorada na escala. */}
        {todayX !== null && todayX >= 0 && todayX <= scale.totalWidth && (
          <span
            className="pointer-events-none absolute bottom-0.5 z-10 -translate-x-1/2 rounded px-1 py-px text-[8px] font-bold uppercase tracking-wider text-ig-canvas"
            style={{ left: todayX, background: 'var(--ig-danger)' }}
          >
            Hoje
          </span>
        )}
      </div>
    </div>
  );
});
