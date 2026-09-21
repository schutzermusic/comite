'use client';

/**
 * Borda arrastável no estilo Excel: o usuário puxa a divisão entre colunas
 * para ajustar a largura. Duplo clique restaura o padrão.
 */

import React, { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { COL_W, clampColWidth, type GanttColKey } from './gantt-constants';

export interface ColumnResizeHandleProps {
  column: GanttColKey;
  width: number;
  onResize: (column: GanttColKey, width: number) => void;
  onReset?: (column: GanttColKey) => void;
}

export function ColumnResizeHandle({ column, width, onResize, onReset }: ColumnResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startW: width };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLSpanElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = clampColWidth(column, drag.startW + (e.clientX - drag.startX));
      onResize(column, next);
    },
    [column, onResize],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* já liberado */
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onReset?.(column);
      onResize(column, COL_W[column]);
    },
    [column, onReset, onResize],
  );

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Redimensionar coluna ${column}`}
      title="Arraste para redimensionar · duplo clique restaura"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onDoubleClick}
      className={cn(
        'absolute right-0 top-0 z-50 h-full w-1.5 cursor-col-resize touch-none',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2',
        'after:bg-transparent hover:after:bg-ig-accent active:after:bg-ig-accent',
      )}
    />
  );
}
