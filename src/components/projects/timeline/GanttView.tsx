'use client';

/**
 * Gantt enterprise — painel WBS congelado + painel do gráfico.
 *
 * ─── Estrutura ─────────────────────────────────────────────────────────────
 * UM único scroller nos dois eixos. Dentro dele, cada linha é um só nó do DOM
 * que atravessa painel e gráfico, com as células da esquerda em
 * `sticky left-0`; o cabeçalho é `sticky top-0`, e o canto, os dois.
 *
 * Isso substitui o arranjo anterior (irmão flex de largura fixa + espelho de
 * `scrollLeft` por transform) e resolve de uma vez três coisas: o painel passa
 * a ficar de fato fixo, o cabeçalho para de atrasar um frame no arrasto, e o
 * realce de hover/seleção fica sincronizado entre os painéis sem nenhum JS.
 *
 * ─── Camadas (de baixo para cima) ──────────────────────────────────────────
 *   fundo    grade + faixas de fim de semana, via repeating-linear-gradient
 *            (não um nó por tick: ~730 spans no zoom de dia matavam o scroll)
 *   z-10/11  barras e trilhos de execução
 *   z-15     setas de dependência (SVG, pointer-events: none)
 *   z-20     células fixas do painel esquerdo
 *   z-25     linha de hoje
 *   z-30/40  cabeçalho e canto
 */

import React, { useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  buildTree,
  deriveDelayStatus,
  filterTree,
  flattenTree,
  ganttScale,
  ganttX,
  weekendPhase,
  type TimelineNode,
} from '@/lib/projects/timeline-analytics';
import { buildDependencyEdges } from '@/lib/projects/gantt-dependencies';
import { EMPTY_EXECUTION, type ProjectExecutionModel } from '@/lib/projects/timeline-execution';
import type { ScheduleSignal } from '@/lib/projects/timeline-intelligence';
import type { TimelineDependency, TimelineItem } from '@/lib/types/project-timeline';
import { useTimelineStore } from './timeline-store';
import { buildTimelineFilter } from './timeline-filter';
import { GanttRow } from './gantt/GanttRow';
import { GanttTimeHeader } from './gantt/GanttTimeHeader';
import { GanttDependencyLayer } from './gantt/GanttDependencyLayer';
import { useGanttWindow } from './gantt/useGanttWindow';
import { HEADER_H, ROW_H, panelWidthFor } from './gantt/gantt-constants';
import type { BarTone } from './gantt/GanttBar';

/** Acima disso as setas viram ruído e são desligadas automaticamente. */
const MAX_EDGES = 400;

export interface GanttViewHandle {
  scrollToToday: () => void;
  scrollToItem: (itemId: string) => void;
}

export interface GanttViewProps {
  items: TimelineItem[];
  execution?: ProjectExecutionModel;
  /** Sinais de prazo por item — sempre presentes, mesmo sem permissão de horas. */
  scheduleByItem?: ReadonlyMap<string, ScheduleSignal>;
  dependencies?: TimelineDependency[];
  /** Informa ao pai quantas atividades sobraram do filtro. */
  onVisibleCountChange?: (visible: number, total: number) => void;
  /**
   * Ocupa toda a altura do container em vez do teto de 62vh.
   *
   * Existe para o modo apresentação: ali a altura é a do container flex, não
   * uma fração da viewport — o painel precisa crescer até o rodapé da tela.
   */
  fill?: boolean;
}

export const GanttView = React.forwardRef<GanttViewHandle, GanttViewProps>(function GanttView(
  { items, execution = EMPTY_EXECUTION, scheduleByItem, dependencies = [], onVisibleCountChange, fill = false },
  ref,
) {
  const {
    collapsed, zoom, selectedItemId, hoveredItemId, filters, panelWidth: storedPanelWidth, columns,
    showDependencies, showBaseline, toggleCollapse, selectItem, hoverItem,
  } = useTimelineStore();

  const now = useMemo(() => new Date(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const executionKnown = execution.availability === 'available';

  // A largura do painel também posiciona o gráfico: se as colunas ligadas não
  // couberem nela, as células invadem a faixa das barras. Por isso o mínimo
  // calculado vence a preferência do usuário.
  const panelWidth = Math.max(storedPanelWidth, panelWidthFor(columns, executionKnown));

  const scale = useMemo(() => ganttScale(items, zoom, now), [items, zoom, now]);
  const todayX = ganttX(scale, now.toISOString().slice(0, 10));

  /* ─── Árvore visível: filtro → recolhimento ─── */
  const { visible, ancestorIds, totalCount } = useMemo(() => {
    const roots = buildTree(items);
    const active = filters.search.trim() || filters.responsibleUserId || filters.status || filters.flags.size > 0;
    const total = items.filter((i) => !i.isSummary).length;

    if (!active) {
      return { visible: flattenTree(roots, collapsed), ancestorIds: new Set<string>(), totalCount: total };
    }

    const predicate = buildTimelineFilter({ filters, execution, scheduleByItem, now });
    const filtered = filterTree(roots, predicate);
    // Ancestrais mantidos só por hierarquia são forçados a abrir, SEM tocar no
    // conjunto de recolhidos do usuário — limpar o filtro restaura o contorno.
    const effective = new Set([...collapsed].filter((id) => !filtered.ancestorIds.has(id)));
    return {
      visible: flattenTree(filtered.roots, effective),
      ancestorIds: filtered.ancestorIds,
      totalCount: total,
    };
  }, [items, collapsed, filters, execution, scheduleByItem, now]);

  const rowIndexById = useMemo(
    () => new Map(visible.map((node, i) => [node.item.id, i])),
    [visible],
  );

  React.useEffect(() => {
    onVisibleCountChange?.(visible.filter((n) => !n.item.isSummary).length, totalCount);
  }, [visible, totalCount, onVisibleCountChange]);

  /* ─── Dependências ─── */
  const edges = useMemo(() => {
    if (!showDependencies || dependencies.length === 0) return [];
    return buildDependencyEdges({ deps: dependencies, items, rowIndexById, scale, rowHeight: ROW_H });
  }, [showDependencies, dependencies, items, rowIndexById, scale]);

  const edgesShown = edges.length <= MAX_EDGES ? edges : [];

  /* ─── Virtualização ─── */
  const contentHeight = visible.length * ROW_H;
  const { startIndex, endIndex } = useGanttWindow(scrollRef, visible.length);
  const rows = visible.slice(startIndex, endIndex);

  /* ─── Navegação imperativa (botões "Hoje" e deep link) ─── */
  const scrollToX = useCallback((x: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: reduced ? 'auto' : 'smooth' });
  }, []);

  useImperativeHandle(ref, () => ({
    scrollToToday: () => {
      if (todayX !== null) scrollToX(todayX);
    },
    scrollToItem: (itemId: string) => {
      const index = rowIndexById.get(itemId);
      const el = scrollRef.current;
      if (index === undefined || !el) return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({
        top: Math.max(0, index * ROW_H - el.clientHeight / 2),
        behavior: reduced ? 'auto' : 'smooth',
      });
      const item = items.find((i) => i.id === itemId);
      const x = item ? ganttX(scale, item.plannedStart ?? item.plannedFinish) : null;
      if (x !== null) scrollToX(x);
    },
  }), [todayX, scrollToX, rowIndexById, items, scale]);

  /* ─── Fundo: grade e fins de semana como gradientes, não como nós ─── */
  const weekend = weekendPhase(scale, zoom);
  const gridBackground = useMemo(() => {
    const layers = [
      `repeating-linear-gradient(to right, var(--ig-border-subtle) 0 1px, transparent 1px ${scale.tickWidth}px)`,
    ];
    if (weekend) {
      layers.unshift(
        `repeating-linear-gradient(to right,` +
          ` transparent 0 ${weekend.offset}px,` +
          ` color-mix(in oklab, var(--ig-fg-subtle) 7%, transparent) ${weekend.offset}px ${weekend.offset + weekend.band}px,` +
          ` transparent ${weekend.offset + weekend.band}px ${weekend.period}px)`,
      );
    }
    return layers.join(', ');
  }, [scale.tickWidth, weekend]);

  const focusedItemId = hoveredItemId ?? selectedItemId;
  const focusedRow = focusedItemId ? rowIndexById.get(focusedItemId) ?? null : null;

  const toneOf = (item: TimelineItem): BarTone =>
    item.status === 'completed' ? 'completed' : deriveDelayStatus(item, now);

  return (
    <div
      ref={scrollRef}
      className={cn(
        'relative overflow-auto rounded-xl border border-ig-border bg-ig-panel',
        fill && 'min-h-0 flex-1',
      )}
      style={fill ? undefined : { maxHeight: '62vh' }}
      role="grid"
      aria-label="Cronograma do projeto"
    >
      <div
        className="relative"
        style={{ width: panelWidth + scale.totalWidth, height: HEADER_H + contentHeight }}
      >
        <GanttTimeHeader
          scale={scale}
          panelWidth={panelWidth}
          columns={columns}
          executionKnown={executionKnown}
          todayX={todayX}
        />

        <div className="relative" style={{ height: contentHeight }}>
          {/* Grade + fins de semana */}
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: panelWidth, width: scale.totalWidth, backgroundImage: gridBackground }}
            aria-hidden
          />

          {/* Divisores de mês/ano */}
          {scale.ticks.map((tick, i) =>
            tick.groupStart ? (
              <span
                key={`g-${i}`}
                className="pointer-events-none absolute inset-y-0 w-px bg-ig-border"
                style={{ left: panelWidth + i * scale.tickWidth }}
                aria-hidden
              />
            ) : null,
          )}

          {edgesShown.length > 0 && (
            <div className="pointer-events-none absolute inset-y-0" style={{ left: panelWidth }}>
              <GanttDependencyLayer
                edges={edgesShown}
                width={scale.totalWidth}
                height={contentHeight}
                startIndex={startIndex}
                endIndex={endIndex}
                focusedItemId={focusedItemId}
                focusedRow={focusedRow}
              />
            </div>
          )}

          {rows.map((node: TimelineNode, i: number) => {
            const index = startIndex + i;
            return (
              <GanttRow
                key={node.item.id}
                node={node}
                index={index}
                tone={toneOf(node.item)}
                scale={scale}
                panelWidth={panelWidth}
                columns={columns}
                execution={execution.byItem.get(node.item.id)}
                schedule={scheduleByItem?.get(node.item.id)}
                executionKnown={executionKnown}
                collapsed={collapsed.has(node.item.id)}
                hasChildren={node.children.length > 0}
                selected={selectedItemId === node.item.id}
                hovered={hoveredItemId === node.item.id}
                dimmed={ancestorIds.has(node.item.id)}
                showBaseline={showBaseline}
                onSelect={selectItem}
                onToggleCollapse={toggleCollapse}
                onHover={hoverItem}
              />
            );
          })}

          {/* Linha de hoje, acima das barras e abaixo do cabeçalho */}
          {todayX !== null && todayX >= 0 && todayX <= scale.totalWidth && (
            <span
              className="pointer-events-none absolute inset-y-0 z-[25] w-[2px]"
              style={{ left: panelWidth + todayX, background: 'var(--ig-danger)', opacity: 0.75 }}
              aria-hidden
            />
          )}
        </div>
      </div>

      {edges.length > MAX_EDGES && (
        <div className="sticky bottom-0 left-0 z-30 border-t border-ig-border bg-ig-raised px-3 py-1 text-[10px] text-ig-fg-muted">
          {edges.length} dependências ocultas — recolha fases ou filtre para visualizá-las.
        </div>
      )}
    </div>
  );
});
