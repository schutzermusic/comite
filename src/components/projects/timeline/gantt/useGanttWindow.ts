'use client';

/**
 * Janelamento das linhas do Gantt.
 *
 * Não usa biblioteca porque não precisa: as linhas já são posicionadas por
 * índice em `absolute`, então a altura do conteúdo é constante e não há
 * spacers para manter. Basta descobrir qual fatia está sob o viewport.
 *
 * Abaixo de VIRTUALIZE_THRESHOLD linhas o hook devolve a lista inteira — o
 * caso comum não paga o custo de recalcular a cada scroll.
 */

import { useEffect, useRef, useState } from 'react';
import { HEADER_H, OVERSCAN, ROW_H, VIRTUALIZE_THRESHOLD } from './gantt-constants';

export interface GanttWindow {
  startIndex: number;
  endIndex: number;
  virtualized: boolean;
}

export function useGanttWindow(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  rowCount: number,
): GanttWindow {
  const virtualized = rowCount > VIRTUALIZE_THRESHOLD;
  const [range, setRange] = useState({ start: 0, end: rowCount });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    // Sem virtualização o retorno do hook já entrega a lista inteira — não há
    // estado a sincronizar aqui.
    if (!el || !virtualized) return;

    const measure = () => {
      frame.current = null;
      // O cabeçalho é sticky e ocupa os primeiros HEADER_H px do conteúdo.
      const scrollTop = Math.max(0, el.scrollTop - HEADER_H);
      const viewport = el.clientHeight;
      const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
      const end = Math.min(rowCount, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);
      setRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };

    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(measure);
    };

    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(el);

    return () => {
      el.removeEventListener('scroll', schedule);
      observer.disconnect();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [scrollRef, rowCount, virtualized]);

  return virtualized
    ? { startIndex: range.start, endIndex: range.end, virtualized: true }
    : { startIndex: 0, endIndex: rowCount, virtualized: false };
}
