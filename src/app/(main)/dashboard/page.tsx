'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown } from 'lucide-react';
import { ControlCanvas, type ScopeMode } from '@/components/dashboard/ControlCanvas';
import { ContextDrawer, type DrawerContext } from '@/components/dashboard/ContextDrawer';
import { QuickActionToast } from '@/components/dashboard/QuickActionToast';
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
        <div className="flex min-h-14 w-full items-center justify-end gap-2 overflow-x-auto border-b border-ig-border-subtle bg-ig-base/70 px-3 py-2 backdrop-blur-md">
            <div className="flex items-center gap-1 rounded-[var(--ig-radius-md)] border border-ig-border bg-ig-panel p-0.5">
                {MODE_OPTIONS.map((option) => (
                    <button
                        key={option.key}
                        type="button"
                        onClick={() => onModeChange(option.key)}
                        className={cn(
                            'h-8 rounded-[var(--ig-radius-sm)] px-3 text-ig-body-sm font-medium text-ig-fg-muted transition-colors hover:text-ig-fg',
                            mode === option.key && 'bg-ig-accent-weak text-ig-accent',
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <div className="flex items-center gap-1 rounded-[var(--ig-radius-md)] border border-ig-border bg-ig-panel p-0.5">
                {PERIOD_OPTIONS.map((option) => (
                    <button
                        key={option.key}
                        type="button"
                        onClick={() => onPeriodChange(option.key)}
                        className={cn(
                            'h-8 rounded-[var(--ig-radius-sm)] px-3 text-ig-body-sm font-medium text-ig-fg-muted transition-colors hover:text-ig-fg',
                            period === option.key && 'bg-ig-accent-weak text-ig-accent',
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <div ref={presetRef} className="relative">
                <button
                    type="button"
                    onClick={() => setPresetOpen((value) => !value)}
                    className="flex h-9 items-center gap-2 rounded-[var(--ig-radius-md)] border border-ig-border bg-ig-panel px-3 text-ig-body-sm font-medium text-ig-fg transition-colors hover:border-ig-border-strong"
                    aria-expanded={presetOpen}
                >
                    {currentPresetLabel}
                    <ChevronDown
                        className={cn('h-3.5 w-3.5 text-ig-fg-disabled transition-transform', presetOpen && 'rotate-180')}
                        aria-hidden="true"
                    />
                </button>

                {presetOpen && (
                    <div
                        data-elev="3"
                        className="ig-glass absolute right-0 top-[calc(100%+0.5rem)] z-[60] w-40 overflow-hidden rounded-[var(--ig-radius-lg)] border border-ig-border p-1"
                    >
                        <span data-ig-noise="" />
                        <span data-ig-specular="" />
                        <div data-ig-content="">
                            {PRESET_OPTIONS.map((option) => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => {
                                        onPresetChange(option.key);
                                        setPresetOpen(false);
                                    }}
                                    className={cn(
                                        'block w-full rounded-[var(--ig-radius-sm)] px-3 py-2 text-left text-ig-body-sm text-ig-fg-muted transition-colors hover:bg-ig-panel-hover hover:text-ig-fg',
                                        preset === option.key && 'bg-ig-accent-weak text-ig-accent',
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
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

            {/* Quick Action Toast */}
            <div className="fixed bottom-5 right-5 z-[55] pointer-events-auto">
                <QuickActionToast />
            </div>

            {/* Drawer */}
            <ContextDrawer
                context={drawerContext}
                onClose={() => setDrawerContext(null)}
            />
        </div>
    );
}
