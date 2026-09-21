'use client';

/**
 * Cabeçalho de duas faixas (grupo + tick) do painel do gráfico.
 *
 * Vive DENTRO do scroller único, como `sticky top-0`. A versão anterior ficava
 * fora e espelhava `scrollLeft` via transform num efeito — o que produzia um
 * frame de atraso visível ao arrastar. Sticky não tem esse problema.
 *
 * Cada coluna do canto esquerdo tem borda arrastável (estilo Excel).
 */

import React from 'react';
import { cn } from '@/lib/utils';
import type { GanttScale } from '@/lib/projects/timeline-analytics';
import { HEADER_H, type GanttColKey, type GanttColWidths } from './gantt-constants';
import { ColumnResizeHandle } from './ColumnResizeHandle';
import type { TimelineColumn } from '../timeline-store';

export interface GanttTimeHeaderProps {
  scale: GanttScale;
  panelWidth: number;
  colWidths: GanttColWidths;
  columns: Record<TimelineColumn, boolean>;
  executionKnown: boolean;
  todayX: number | null;
  onColumnResize: (column: GanttColKey, width: number) => void;
  onColumnReset: (column: GanttColKey) => void;
}

function HeadCell({
  column,
  width,
  className,
  children,
  onResize,
  onReset,
}: {
  column: GanttColKey;
  width: number;
  className?: string;
  children?: React.ReactNode;
  onResize: (column: GanttColKey, width: number) => void;
  onReset: (column: GanttColKey) => void;
}) {
  return (
    <span className={cn('relative shrink-0 truncate px-1', className)} style={{ width }}>
      {children}
      <ColumnResizeHandle column={column} width={width} onResize={onResize} onReset={onReset} />
    </span>
  );
}

export const GanttTimeHeader = React.memo(function GanttTimeHeader({
  scale,
  panelWidth,
  colWidths,
  columns,
  executionKnown,
  todayX,
  onColumnResize,
  onColumnReset,
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
        <HeadCell column="wbs" width={colWidths.wbs} onResize={onColumnResize} onReset={onColumnReset}>
          EDT
        </HeadCell>
        <HeadCell column="title" width={colWidths.title} onResize={onColumnResize} onReset={onColumnReset}>
          Atividade
        </HeadCell>
        <HeadCell
          column="progress"
          width={colWidths.progress}
          className="text-right"
          onResize={onColumnResize}
          onReset={onColumnReset}
        >
          %
        </HeadCell>
        <HeadCell column="start" width={colWidths.start} onResize={onColumnResize} onReset={onColumnReset}>
          Início
        </HeadCell>
        <HeadCell column="finish" width={colWidths.finish} onResize={onColumnResize} onReset={onColumnReset}>
          Término
        </HeadCell>
        {columns.responsible && (
          <HeadCell
            column="responsible"
            width={colWidths.responsible}
            onResize={onColumnResize}
            onReset={onColumnReset}
          >
            Resp.
          </HeadCell>
        )}
        {columns.status && (
          <HeadCell
            column="status"
            width={colWidths.status}
            onResize={onColumnResize}
            onReset={onColumnReset}
          >
            Status
          </HeadCell>
        )}
        {executionKnown && columns.plannedHours && (
          <HeadCell
            column="plannedHours"
            width={colWidths.plannedHours}
            onResize={onColumnResize}
            onReset={onColumnReset}
          >
            Plan.
          </HeadCell>
        )}
        {executionKnown && columns.loggedHours && (
          <HeadCell
            column="loggedHours"
            width={colWidths.loggedHours}
            onResize={onColumnResize}
            onReset={onColumnReset}
          >
            Apont.
          </HeadCell>
        )}
        {executionKnown && columns.lastActivity && (
          <HeadCell
            column="lastActivity"
            width={colWidths.lastActivity}
            onResize={onColumnResize}
            onReset={onColumnReset}
          >
            Últ. ap.
          </HeadCell>
        )}
        <HeadCell column="signal" width={colWidths.signal} onResize={onColumnResize} onReset={onColumnReset} />
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
