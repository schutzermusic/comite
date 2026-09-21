'use client';

/**
 * Estado de VIEW do cronograma (zustand).
 *
 * Duas categorias, deliberadamente separadas:
 *
 *   PERSISTIDO   preferências de leitura do usuário — zoom, largura do painel,
 *                colunas visíveis, setas ligadas. Sobrevivem ao reload.
 *   EFÊMERO      recorte de trabalho — filtros, busca, seleção, recolhidos.
 *                Somem ao sair; um filtro "grudado" de ontem é uma armadilha.
 *
 * `collapsed` é um Set e por isso NUNCA pode entrar no partialize: o storage
 * devolveria um objeto simples, sem `.has`, e flattenTree quebraria no primeiro
 * render.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GanttZoom } from '@/lib/projects/timeline-analytics';
import {
  COL_W,
  clampColWidth,
  type GanttColKey,
  type GanttColWidths,
} from './gantt/gantt-constants';

/** Recortes rápidos, acionados pelos KPIs e pelos chips da barra de filtros. */
export type TimelineFlag =
  | 'delayed'
  | 'at_risk'
  | 'blocked'
  | 'milestones'
  | 'no_responsible'
  | 'no_apontamento'
  | 'worked_today'
  | 'active_now'
  | 'no_recent_activity'
  | 'over_effort'
  | 'behind_schedule';

export type TimelineColumn =
  | 'responsible'
  | 'status'
  | 'plannedHours'
  | 'loggedHours'
  | 'lastActivity';

export const DEFAULT_COLUMNS: Record<TimelineColumn, boolean> = {
  responsible: true,
  status: true,
  plannedHours: true,
  loggedHours: true,
  // Coluna densa e de uso pontual — o dado continua no drawer.
  lastActivity: false,
};

export const PANEL_MIN_WIDTH = 320;
export const PANEL_MAX_WIDTH = 1400;
/** Base legada; a largura efetiva vem da soma das colunas redimensionáveis. */
export const PANEL_DEFAULT_WIDTH = 520;

export const DEFAULT_COLUMN_WIDTHS: GanttColWidths = { ...COL_W };

export interface TimelineFilters {
  search: string;
  responsibleUserId: string | null;
  status: string | null;
  flags: Set<TimelineFlag>;
}

const emptyFilters = (): TimelineFilters => ({
  search: '',
  responsibleUserId: null,
  status: null,
  flags: new Set<TimelineFlag>(),
});

interface TimelineUiState {
  /* ─── efêmero ─── */
  collapsed: Set<string>;
  selectedItemId: string | null;
  hoveredItemId: string | null;
  filters: TimelineFilters;
  /** Projeto ao qual o estado efêmero pertence. */
  projectId: string | null;

  /* ─── persistido ─── */
  zoom: GanttZoom;
  /** @deprecated Preferir columnWidths; mantido p/ rehidratação antiga. */
  panelWidth: number;
  /** Larguras do painel esquerdo (estilo Excel). */
  columnWidths: GanttColWidths;
  columns: Record<TimelineColumn, boolean>;
  showDependencies: boolean;
  showBaseline: boolean;

  toggleCollapse: (id: string) => void;
  expandAll: () => void;
  collapseAll: (ids: string[]) => void;
  /** Garante que todos os ids estejam expandidos (deep link, foco em item). */
  expandIds: (ids: string[]) => void;
  selectItem: (id: string | null) => void;
  hoverItem: (id: string | null) => void;

  setZoom: (zoom: GanttZoom) => void;
  setPanelWidth: (width: number) => void;
  setColumnWidth: (column: GanttColKey, width: number) => void;
  resetColumnWidth: (column: GanttColKey) => void;
  toggleColumn: (column: TimelineColumn) => void;
  setShowDependencies: (value: boolean) => void;
  setShowBaseline: (value: boolean) => void;

  setSearch: (value: string) => void;
  setResponsible: (userId: string | null) => void;
  setStatus: (status: string | null) => void;
  toggleFlag: (flag: TimelineFlag) => void;
  clearFilters: () => void;
  hasActiveFilters: () => boolean;

  /**
   * Zera o estado efêmero ao trocar de projeto. Sem isso o recolhimento e a
   * seleção do projeto A vazam para o B — o store é global de módulo e a aba
   * não desmonta na navegação.
   */
  resetForProject: (projectId: string) => void;
}

export const useTimelineStore = create<TimelineUiState>()(
  persist(
    (set, get) => ({
      collapsed: new Set<string>(),
      selectedItemId: null,
      hoveredItemId: null,
      filters: emptyFilters(),
      projectId: null,

      zoom: 'week',
      panelWidth: PANEL_DEFAULT_WIDTH,
      columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
      columns: { ...DEFAULT_COLUMNS },
      showDependencies: true,
      showBaseline: true,

      toggleCollapse: (id) =>
        set((state) => {
          const collapsed = new Set(state.collapsed);
          if (collapsed.has(id)) collapsed.delete(id);
          else collapsed.add(id);
          return { collapsed };
        }),

      expandAll: () => set({ collapsed: new Set<string>() }),
      collapseAll: (ids) => set({ collapsed: new Set(ids) }),

      expandIds: (ids) =>
        set((state) => {
          if (ids.length === 0) return state;
          const collapsed = new Set(state.collapsed);
          let changed = false;
          for (const id of ids) changed = collapsed.delete(id) || changed;
          return changed ? { collapsed } : state;
        }),

      selectItem: (id) => set({ selectedItemId: id }),
      hoverItem: (id) => set({ hoveredItemId: id }),

      setZoom: (zoom) => set({ zoom }),
      setPanelWidth: (width) =>
        set({ panelWidth: Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(width))) }),
      setColumnWidth: (column, width) =>
        set((state) => ({
          columnWidths: { ...state.columnWidths, [column]: clampColWidth(column, width) },
        })),
      resetColumnWidth: (column) =>
        set((state) => ({
          columnWidths: { ...state.columnWidths, [column]: COL_W[column] },
        })),
      toggleColumn: (column) =>
        set((state) => ({ columns: { ...state.columns, [column]: !state.columns[column] } })),
      setShowDependencies: (value) => set({ showDependencies: value }),
      setShowBaseline: (value) => set({ showBaseline: value }),

      setSearch: (search) => set((state) => ({ filters: { ...state.filters, search } })),
      setResponsible: (responsibleUserId) =>
        set((state) => ({ filters: { ...state.filters, responsibleUserId } })),
      setStatus: (status) => set((state) => ({ filters: { ...state.filters, status } })),

      toggleFlag: (flag) =>
        set((state) => {
          const flags = new Set(state.filters.flags);
          if (flags.has(flag)) flags.delete(flag);
          else flags.add(flag);
          return { filters: { ...state.filters, flags } };
        }),

      clearFilters: () => set({ filters: emptyFilters() }),

      hasActiveFilters: () => {
        const { search, responsibleUserId, status, flags } = get().filters;
        return Boolean(search.trim() || responsibleUserId || status || flags.size > 0);
      },

      resetForProject: (projectId) =>
        set((state) =>
          state.projectId === projectId
            ? state
            : {
                projectId,
                collapsed: new Set<string>(),
                selectedItemId: null,
                hoveredItemId: null,
                filters: emptyFilters(),
              },
        ),
    }),
    {
      name: 'insight.timeline.ui.v1',
      // Só preferências de leitura. Set/seleção/filtros ficam de fora — ver
      // o comentário no topo sobre `collapsed` e a rehidratação de Set.
      partialize: (state) => ({
        zoom: state.zoom,
        panelWidth: state.panelWidth,
        columnWidths: state.columnWidths,
        columns: state.columns,
        showDependencies: state.showDependencies,
        showBaseline: state.showBaseline,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TimelineUiState>;
        return {
          ...current,
          ...p,
          // Garante chaves novas após upgrade (storage antigo sem columnWidths).
          // 62 era o default antigo de Apont. — quem ainda está nele recebe o novo.
          columnWidths: {
            ...DEFAULT_COLUMN_WIDTHS,
            ...(p.columnWidths ?? {}),
            ...(p.columnWidths?.loggedHours === 62
              ? { loggedHours: DEFAULT_COLUMN_WIDTHS.loggedHours }
              : {}),
          },
          columns: { ...DEFAULT_COLUMNS, ...(p.columns ?? {}) },
          filters: current.filters,
          collapsed: current.collapsed,
        };
      },
    },
  ),
);
