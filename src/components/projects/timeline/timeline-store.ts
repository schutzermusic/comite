'use client';

import { create } from 'zustand';
import type { GanttZoom } from '@/lib/projects/timeline-analytics';

interface TimelineUiState {
  collapsed: Set<string>;
  zoom: GanttZoom;
  selectedItemId: string | null;
  toggleCollapse: (id: string) => void;
  setZoom: (zoom: GanttZoom) => void;
  selectItem: (id: string | null) => void;
}

export const useTimelineStore = create<TimelineUiState>((set) => ({
  collapsed: new Set<string>(),
  zoom: 'week',
  selectedItemId: null,
  toggleCollapse: (id) =>
    set((state) => {
      const collapsed = new Set(state.collapsed);
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      return { collapsed };
    }),
  setZoom: (zoom) => set({ zoom }),
  selectItem: (id) => set({ selectedItemId: id }),
}));
