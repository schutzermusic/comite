'use client';

/**
 * Divisor vertical entre o painel de colunas (EDT/atividade/apontamento) e a
 * faixa do gráfico. Arrastar alarga/encolhe a coluna Atividade — o efeito
 * visual é o mesmo do split pane do MS Project / Excel.
 */

import React, { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { COL_W, clampColWidth } from './gantt-constants';

export interface PanelSplitHandleProps {
  panelWidth: number;
  titleWidth: number;
  totalHeight: number;
  onTitleResize: (width: number) => void;
  onTitleReset?: () => void;
}

export function PanelSplitHandle({
  panelWidth,
  titleWidth,
  totalHeight,
  onTitleResize,
  onTitleReset,
}: PanelSplitHandleProps) {
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startW: titleWidth };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [titleWidth],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      onTitleResize(clampColWidth('title', drag.startW + (e.clientX - drag.startX)));
    },
    [onTitleResize],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
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
      onTitleReset?.();
      onTitleResize(COL_W.title);
    },
    [onTitleReset, onTitleResize],
  );

  return (
    // Trilho sticky: acompanha o scroll horizontal junto com o painel esquerdo.
    // width 0 + margem negativa: não empurra o layout; o hit-target fica na borda.
    <div
      className="pointer-events-none sticky left-0 z-[45]"
      style={{ width: 0, height: totalHeight, marginBottom: -totalHeight }}
      aria-hidden
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar painel do cronograma"
        aria-valuenow={Math.round(panelWidth)}
        title="Arraste para redimensionar o painel · duplo clique restaura"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
        className={cn(
          'pointer-events-auto absolute top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2',
          'after:bg-transparent hover:after:bg-ig-accent active:after:bg-ig-accent',
        )}
        style={{ left: panelWidth }}
      />
    </div>
  );
}
