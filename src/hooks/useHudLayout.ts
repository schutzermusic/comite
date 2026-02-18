'use client';

import { useState, useCallback, useEffect } from 'react';

// ============================================
// HUD Layout Persistence Hook
// ============================================

const STORAGE_KEY = 'insight_dashboard_hud_layout_v1';

export type HudMode = 'executivo' | 'operacional';
export type PeriodFilter = 'mtd' | 'qtd' | 'ytd' | 'custom';

export interface WidgetState {
    pinned: boolean;
    compact: boolean;
    autoHide: boolean;
    x: number;
    y: number;
}

export interface HudLayoutState {
    mode: HudMode;
    period: PeriodFilter;
    eventStreamCollapsed: boolean;
    activeOverlay: string | null;
    widgets: Record<string, WidgetState>;
}

const DEFAULT_WIDGET: WidgetState = {
    pinned: true,
    compact: true,
    autoHide: false,
    x: 0,
    y: 0,
};

const DEFAULT_LAYOUT: HudLayoutState = {
    mode: 'executivo',
    period: 'mtd',
    eventStreamCollapsed: true, // collapsed by default in executivo
    activeOverlay: null,
    widgets: {},
};

function loadLayout(): HudLayoutState {
    if (typeof window === 'undefined') return DEFAULT_LAYOUT;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_LAYOUT;
        return { ...DEFAULT_LAYOUT, ...JSON.parse(raw) };
    } catch {
        return DEFAULT_LAYOUT;
    }
}

function saveLayout(state: HudLayoutState) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // quota exceeded — silently ignore
    }
}

export function useHudLayout() {
    const [layout, setLayoutRaw] = useState<HudLayoutState>(DEFAULT_LAYOUT);
    const [hydrated, setHydrated] = useState(false);

    // Hydrate from localStorage on mount
    useEffect(() => {
        setLayoutRaw(loadLayout());
        setHydrated(true);
    }, []);

    const setLayout = useCallback((updater: HudLayoutState | ((prev: HudLayoutState) => HudLayoutState)) => {
        setLayoutRaw((prev) => {
            const next = typeof updater === 'function' ? updater(prev) : updater;
            saveLayout(next);
            return next;
        });
    }, []);

    const setMode = useCallback((mode: HudMode) => {
        setLayout((prev) => ({
            ...prev,
            mode,
            // When switching to executivo, collapse event stream
            eventStreamCollapsed: mode === 'executivo' ? true : false,
        }));
    }, [setLayout]);

    const setPeriod = useCallback((period: PeriodFilter) => {
        setLayout((prev) => ({ ...prev, period }));
    }, [setLayout]);

    const toggleEventStream = useCallback(() => {
        setLayout((prev) => ({ ...prev, eventStreamCollapsed: !prev.eventStreamCollapsed }));
    }, [setLayout]);

    const setActiveOverlay = useCallback((overlay: string | null) => {
        setLayout((prev) => ({ ...prev, activeOverlay: overlay }));
    }, [setLayout]);

    const getWidgetState = useCallback((id: string): WidgetState => {
        return layout.widgets[id] || DEFAULT_WIDGET;
    }, [layout.widgets]);

    const updateWidget = useCallback((id: string, patch: Partial<WidgetState>) => {
        setLayout((prev) => ({
            ...prev,
            widgets: {
                ...prev.widgets,
                [id]: { ...(prev.widgets[id] || DEFAULT_WIDGET), ...patch },
            },
        }));
    }, [setLayout]);

    return {
        layout,
        hydrated,
        setMode,
        setPeriod,
        toggleEventStream,
        setActiveOverlay,
        getWidgetState,
        updateWidget,
    };
}
