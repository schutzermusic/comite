'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';

// ============================================
// HUD Layout Persistence Hook
// ============================================

const STORAGE_KEY = 'insight_dashboard_hud_layout_v2';

export type HudMode = 'executivo' | 'operacional';
export type PeriodFilter = 'mtd' | 'qtd' | 'ytd' | 'custom';
export type ViewPreset = 'diretor' | 'financeiro' | 'rh' | 'comercial';

export interface WidgetState {
    pinned: boolean;
    compact: boolean;
    autoHide: boolean;
    x: number;
    y: number;
}

export interface AppliedFilter {
    key: string;
    label: string;
    removable: boolean;
}

export interface HudLayoutState {
    mode: HudMode;
    period: PeriodFilter;
    preset: ViewPreset;
    selectedUF: string | null;
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
    preset: 'diretor',
    selectedUF: null,
    eventStreamCollapsed: true,
    activeOverlay: null,
    widgets: {},
};

const PERIOD_LABELS: Record<PeriodFilter, string> = {
    mtd: 'MTD',
    qtd: 'QTD',
    ytd: 'YTD',
    custom: 'Personalizado',
};

const PRESET_LABELS: Record<ViewPreset, string> = {
    diretor: 'Diretor',
    financeiro: 'Financeiro',
    rh: 'RH',
    comercial: 'Comercial',
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
            eventStreamCollapsed: mode === 'executivo',
        }));
    }, [setLayout]);

    const setPeriod = useCallback((period: PeriodFilter) => {
        setLayout((prev) => ({ ...prev, period }));
    }, [setLayout]);

    const setPreset = useCallback((preset: ViewPreset) => {
        setLayout((prev) => ({ ...prev, preset }));
    }, [setLayout]);

    const setSelectedUF = useCallback((uf: string | null) => {
        setLayout((prev) => ({ ...prev, selectedUF: uf }));
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

    const appliedFilters: AppliedFilter[] = useMemo(() => {
        const filters: AppliedFilter[] = [
            { key: 'period', label: PERIOD_LABELS[layout.period], removable: false },
            { key: 'preset', label: PRESET_LABELS[layout.preset], removable: false },
        ];
        if (layout.selectedUF) {
            filters.push({ key: 'uf', label: `UF: ${layout.selectedUF}`, removable: true });
        } else {
            filters.push({ key: 'scope', label: 'Brasil', removable: false });
        }
        return filters;
    }, [layout.period, layout.preset, layout.selectedUF]);

    const removeFilter = useCallback((key: string) => {
        if (key === 'uf') {
            setSelectedUF(null);
        }
    }, [setSelectedUF]);

    return {
        layout,
        hydrated,
        setMode,
        setPeriod,
        setPreset,
        setSelectedUF,
        toggleEventStream,
        setActiveOverlay,
        getWidgetState,
        updateWidget,
        appliedFilters,
        removeFilter,
    };
}
