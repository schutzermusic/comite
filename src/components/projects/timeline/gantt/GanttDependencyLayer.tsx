'use client';

/**
 * Camada SVG das setas de dependência.
 *
 * `pointer-events: none` no SVG inteiro: as arestas NÃO são clicáveis. Fazer
 * hit-test em ~100 paths finos brigaria com o clique das barras e custaria
 * caro; o realce por hover da linha entrega a mesma informação de graça.
 *
 * Convenções visuais:
 *   tracejada + esmaecida → a aresta foi redirecionada a um ancestral porque o
 *                           extremo real está num ramo recolhido;
 *   vermelha              → violação de FS (a sucessora começa antes da hora);
 *   realce                → alguma ponta toca a linha sob o cursor/seleção.
 */

import React from 'react';
import { edgePath, edgesInWindow, type DepEdge } from '@/lib/projects/gantt-dependencies';
import { ROW_H } from './gantt-constants';

export interface GanttDependencyLayerProps {
  edges: DepEdge[];
  width: number;
  height: number;
  startIndex: number;
  endIndex: number;
  /** Item sob o cursor ou selecionado — realça as arestas incidentes. */
  focusedItemId: string | null;
  focusedRow: number | null;
}

export const GanttDependencyLayer = React.memo(function GanttDependencyLayer({
  edges,
  width,
  height,
  startIndex,
  endIndex,
  focusedItemId,
  focusedRow,
}: GanttDependencyLayerProps) {
  const visible = edgesInWindow(edges, startIndex, endIndex);
  if (visible.length === 0) return null;

  const hasFocus = focusedItemId !== null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-[15]"
      width={width}
      height={height}
      aria-hidden
    >
      <defs>
        {/* `context-stroke` não é confiável entre navegadores: fill explícito. */}
        <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--ig-fg-subtle)" />
        </marker>
        <marker id="gantt-arrow-violated" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--ig-danger)" />
        </marker>
        <marker id="gantt-arrow-focus" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--ig-accent)" />
        </marker>
      </defs>

      {visible.map((edge: DepEdge) => {
        const incident =
          hasFocus &&
          (edge.predecessorId === focusedItemId ||
            edge.successorId === focusedItemId ||
            edge.fromRow === focusedRow ||
            edge.toRow === focusedRow);

        const stroke = edge.violated
          ? 'var(--ig-danger)'
          : incident
            ? 'var(--ig-accent)'
            : 'var(--ig-fg-subtle)';

        const marker = edge.violated
          ? 'url(#gantt-arrow-violated)'
          : incident
            ? 'url(#gantt-arrow-focus)'
            : 'url(#gantt-arrow)';

        // Com foco ativo, o que não é incidente recua para dar leitura.
        const opacity = hasFocus ? (incident ? 1 : 0.22) : edge.routed ? 0.45 : 0.7;

        const title =
          `${edge.label}${edge.mergedCount > 1 ? ` (+${edge.mergedCount - 1})` : ''}` +
          (edge.routed ? ' — aponta para um ramo recolhido' : '') +
          (edge.violated ? ' — sequência violada' : '');

        return (
          <path
            key={`${edge.id}-${edge.fromRow}-${edge.toRow}`}
            d={edgePath(edge, ROW_H)}
            fill="none"
            stroke={stroke}
            strokeWidth={incident || edge.violated ? 1.5 : 1}
            strokeDasharray={edge.routed ? '3 3' : undefined}
            markerEnd={marker}
            opacity={opacity}
          >
            <title>{title}</title>
          </path>
        );
      })}
    </svg>
  );
});
