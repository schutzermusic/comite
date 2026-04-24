'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { DashboardHudBar } from '@/components/dashboard/DashboardHudBar';
import { ControlCanvas, type ScopeMode } from '@/components/dashboard/ControlCanvas';
import { ContextDrawer, type DrawerContext } from '@/components/dashboard/ContextDrawer';
import { QuickActionToast } from '@/components/dashboard/QuickActionToast';
import { useHudLayout } from '@/hooks/useHudLayout';
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

    const alertCounts = useMemo(() => data ? ({
        critical: data.riskSummary.critical,
        votesIn72h: data.votingStatus.endingIn72h,
        docsPending: 2,
    }) : undefined, [data?.riskSummary.critical, data?.votingStatus.endingIn72h]);

    if (!data) return null;

    return (
        <div className="cr-viewport bg-[#020915] text-white">
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
                    <DashboardHudBar
                        mode={mode}
                        period={period}
                        preset={layout.preset}
                        onModeChange={handleModeChange}
                        onPeriodChange={handlePeriodChange}
                        onPresetChange={setPreset}
                        alertCounts={alertCounts!}
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
