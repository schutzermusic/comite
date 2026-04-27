'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown } from 'lucide-react';
import { ControlCanvas, type ScopeMode } from '@/components/dashboard/ControlCanvas';
import { ContextDrawer, type DrawerContext } from '@/components/dashboard/ContextDrawer';
import { useHudLayout, type HudMode, type PeriodFilter, type ViewPreset } from '@/hooks/useHudLayout';
import { getMockDashboardData } from '@/lib/dashboard-data';
import type { DashboardPayload } from '@/lib/dashboard-data';
import type { StateAggregate } from '@/data/geo/globe-kpi-data';
import { cn } from '@/lib/utils';

const LeftHudStack = dynamic(
    () => import('@/components/dashboard/LeftHudStack').then(m => ({ default: m.LeftHudStack })),
    { ssr: false }
);
const RightHudStack = dynamic(
    () => import('@/components/dashboard/RightHudStack').then(m => ({ default: m.RightHudStack })),
    { ssr: false }
);

const PERIOD_OPTIONS: { key: PeriodFilter; label: string }[] = [
    { key: 'mtd', label: 'MTD' },
    { key: 'qtd', label: 'QTD' },
    { key: 'ytd', label: 'YTD' },
    { key: 'custom', label: 'Custom' },
];

const MODE_OPTIONS: { key: HudMode; label: string }[] = [
    { key: 'executivo', label: 'Executivo' },
    { key: 'operacional', label: 'Operacional' },
];

const PRESET_OPTIONS: { key: ViewPreset; label: string }[] = [
    { key: 'diretor', label: 'Diretor' },
    { key: 'financeiro', label: 'Financeiro' },
    { key: 'rh', label: 'RH' },
    { key: 'comercial', label: 'Comercial' },
];

interface DashboardShellControlsProps {
    mode: HudMode;
    period: PeriodFilter;
    preset: ViewPreset;
    onModeChange: (mode: HudMode) => void;
    onPeriodChange: (period: PeriodFilter) => void;
    onPresetChange: (preset: ViewPreset) => void;
}

function DashboardShellControls({
    mode,
    period,
    preset,
    onModeChange,
    onPeriodChange,
    onPresetChange,
}: DashboardShellControlsProps) {
    const [presetOpen, setPresetOpen] = useState(false);
    const presetRef = useRef<HTMLDivElement>(null);
    const currentPresetLabel = PRESET_OPTIONS.find((option) => option.key === preset)?.label ?? 'Diretor';

    useEffect(() => {
        function handlePointerDown(event: PointerEvent) {
            if (!presetRef.current?.contains(event.target as Node)) {
                setPresetOpen(false);
            }
        }

        if (presetOpen) {
            document.addEventListener('pointerdown', handlePointerDown);
            return () => document.removeEventListener('pointerdown', handlePointerDown);
        }

        return undefined;
    }, [presetOpen]);

    return (
        <div className="dashboard-filter-dock pointer-events-auto">
            <div className="dashboard-filter-cluster" role="toolbar" aria-label="Dashboard filters">
                <div className="dashboard-filter-group" aria-label="Modo de visualização">
                    {MODE_OPTIONS.map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => onModeChange(option.key)}
                            className={cn(
                                'dashboard-filter-pill',
                                mode === option.key && 'dashboard-filter-pill-active',
                            )}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <span className="dashboard-filter-sep" aria-hidden="true" />

                <div className="dashboard-filter-group dashboard-filter-group-compact" aria-label="Período">
                    {PERIOD_OPTIONS.map((option) => (
                        <button
                            key={option.key}
                            type="button"
                            onClick={() => onPeriodChange(option.key)}
                            className={cn(
                                'dashboard-filter-pill dashboard-filter-pill-compact',
                                period === option.key && 'dashboard-filter-pill-active',
                            )}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                <span className="dashboard-filter-sep" aria-hidden="true" />

                <div ref={presetRef} className="relative">
                    <button
                        type="button"
                        onClick={() => setPresetOpen((value) => !value)}
                        className={cn('dashboard-filter-preset', presetOpen && 'dashboard-filter-preset-open')}
                        aria-expanded={presetOpen}
                        aria-label="Filtro de papel"
                    >
                        <span className="dashboard-filter-preset-label">{currentPresetLabel}</span>
                        <ChevronDown
                            className={cn('h-3 w-3 transition-transform duration-150', presetOpen && 'rotate-180')}
                            aria-hidden="true"
                        />
                    </button>

                    {presetOpen && (
                        <div className="dashboard-filter-preset-menu" role="menu">
                            {PRESET_OPTIONS.map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                        onPresetChange(option.key);
                                        setPresetOpen(false);
                                    }}
                                    className={cn(
                                        'dashboard-filter-preset-item',
                                        preset === option.key && 'dashboard-filter-preset-item-active',
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function DashboardPage() {
    const {
        layout, setMode, setPeriod, setPreset, setSelectedUF,
        setActiveOverlay,
    } = useHudLayout();
    const [mode, setLocalMode] = useState<'executivo' | 'operacional'>('executivo');
    const [period, setLocalPeriod] = useState<'mtd' | 'qtd' | 'ytd' | 'custom'>('mtd');
    const [data, setData] = useState<DashboardPayload | null>(null);
    const [drawerContext, setDrawerContext] = useState<DrawerContext>(null);
    const [scopeMode, setScopeMode] = useState<ScopeMode>('global');
    const [selectedState, setSelectedState] = useState<StateAggregate | null>(null);
    const [uiMode, setUiMode] = useState<'default' | 'projectFocus'>('default');
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);
    const [sidebarStateBeforeFocus, setSidebarStateBeforeFocus] = useState(true);

    const isRightSidebarActive = isSidebarVisible && selectedState === null;
    const isFocusMode = uiMode === 'projectFocus' || selectedState !== null;

    const handleProjectFocusChange = useCallback((active: boolean) => {
        if (active) {
            setSidebarStateBeforeFocus(isSidebarVisible);
            setUiMode('projectFocus');
            setIsSidebarVisible(false);
        } else {
            setUiMode('default');
            setIsSidebarVisible(sidebarStateBeforeFocus);
        }
    }, [isSidebarVisible, sidebarStateBeforeFocus]);

    useEffect(() => {
        setData(getMockDashboardData());
    }, []);

    const handleModeChange = useCallback((m: 'executivo' | 'operacional') => {
        setLocalMode(m);
        setMode(m);
    }, [setMode]);

    const handlePeriodChange = useCallback((p: 'mtd' | 'qtd' | 'ytd' | 'custom') => {
        setLocalPeriod(p);
        setPeriod(p);
    }, [setPeriod]);

    const handleStateSelect = useCallback((state: StateAggregate | null) => {
        setSelectedState(state);
        if (state) {
            setScopeMode('state');
            setSelectedUF(state.uf);
        } else {
            setScopeMode('global');
            setSelectedUF(null);
        }
    }, [setSelectedUF]);

    if (!data) return null;

    return (
        <div className="cr-viewport bg-ig-canvas text-ig-fg-strong">
            {/* ═══ Layer 0: Globe Canvas (3D background) ═══ */}
            <div className="absolute inset-0 z-0 min-w-0 min-h-0" style={{ transform: 'translateX(40px)' }}>
                <ControlCanvas
                    mode={mode}
                    activeOverlay={layout.activeOverlay}
                    onOverlayChange={setActiveOverlay}
                    onOpenDrawer={setDrawerContext}
                    scopeMode={scopeMode}
                    onScopeModeChange={setScopeMode}
                    onStateContextChange={handleStateSelect}
                    onProjectFocusChange={handleProjectFocusChange}
                    className="w-full h-full"
                />
            </div>

            {/* ═══ Atmospheric layers ═══ */}
            <div className="cr-atmospheric-glow" />
            <div className="cr-bg-scanline" />
            <div className="cr-vignette z-[4]" />
            <div className="cr-hud-frame" />

            {/* ═══ Layer 10: HUD Interface ═══ */}
            <div className="relative z-10 w-full h-full pointer-events-none flex flex-col">
                {/* Top HUD Bar */}
                <div className="pointer-events-auto z-50 flex-shrink-0 w-full">
                    <DashboardShellControls
                        mode={mode}
                        period={period}
                        preset={layout.preset}
                        onModeChange={handleModeChange}
                        onPeriodChange={handlePeriodChange}
                        onPresetChange={setPreset}
                    />
                </div>

                {/* Main content: overlapping panel stacks */}
                <div className="flex-1 relative min-h-0 px-3 pb-3 h-full">
                    {/* ── Left Stack ── */}
                    <div
                        className={cn(
                            "absolute top-0 left-3 bottom-3 pointer-events-auto z-40 overflow-y-auto scrollbar-hide",
                            isFocusMode
                                ? "-translate-x-[120%] opacity-0 pointer-events-none transition-all duration-300 ease-out"
                                : "translate-x-0 opacity-100 transition-all duration-300 ease-out",
                        )}
                        style={{ width: '340px' }}
                    >
                        <LeftHudStack data={data} scopeMode={scopeMode} stateScope={selectedState} />
                    </div>

                    {/* ── Right Stack ── */}
                    <div
                        className={cn(
                            "absolute top-0 right-3 bottom-3 pointer-events-auto z-40 overflow-y-auto scrollbar-hide",
                            isRightSidebarActive
                                ? "translate-x-0 opacity-100 transition-all duration-300 ease-out"
                                : "translate-x-[120%] opacity-0 pointer-events-none transition-all duration-300 ease-out"
                        )}
                        style={{ width: '320px' }}
                    >
                        <RightHudStack data={data} scopeMode={scopeMode} stateScope={selectedState} />
                    </div>

                </div>
            </div>

            {/* Drawer */}
            <ContextDrawer
                context={drawerContext}
                onClose={() => setDrawerContext(null)}
            />
        </div>
    );
}
