'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

// Lazy load heavy sidebar components
const LeftHudStack = dynamic(
    () => import('@/components/dashboard/LeftHudStack').then(m => ({ default: m.LeftHudStack })),
    { ssr: false }
);
const RightHudStack = dynamic(
    () => import('@/components/dashboard/RightHudStack').then(m => ({ default: m.RightHudStack })),
    { ssr: false }
);

export default function DashboardPage() {
    const { layout, setMode, setPeriod, setActiveOverlay } = useHudLayout();
    const [mode, setLocalMode] = useState<'executivo' | 'operacional'>('executivo');
    const [period, setLocalPeriod] = useState<'mtd' | 'qtd' | 'ytd' | 'custom'>('mtd');
    const [data, setData] = useState<DashboardPayload | null>(null);
    const [drawerContext, setDrawerContext] = useState<DrawerContext>(null);
    const [scopeMode, setScopeMode] = useState<ScopeMode>('global');
    const [selectedState, setSelectedState] = useState<StateAggregate | null>(null);
    const [uiMode, setUiMode] = useState<'default' | 'projectFocus'>('default');
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);
    const [sidebarStateBeforeFocus, setSidebarStateBeforeFocus] = useState(true);
    const viewportRef = useRef<HTMLDivElement>(null);
    const parallaxRef = useRef({ x: 0, y: 0 });
    const rafRef = useRef<number>(0);
    const leftStackRef = useRef<HTMLDivElement>(null);
    const rightStackRef = useRef<HTMLDivElement>(null);

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

    // Memoize alert counts to avoid object re-creation on every render
    const alertCounts = useMemo(() => data ? ({
        critical: data.riskSummary.critical,
        votesIn72h: data.votingStatus.endingIn72h,
        docsPending: 2,
    }) : undefined, [data?.riskSummary.critical, data?.votingStatus.endingIn72h]);

    // Throttled parallax via rAF — updates DOM directly, no React state
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / rect.width - 0.5;
        const ny = (e.clientY - rect.top) / rect.height - 0.5;
        parallaxRef.current = { x: nx * 6, y: ny * 4 };

        if (rafRef.current) return; // already scheduled
        rafRef.current = requestAnimationFrame(() => {
            const { x, y } = parallaxRef.current;
            if (leftStackRef.current) {
                leftStackRef.current.style.transform = `translate(${x * -1}px, ${y * -0.5}px)`;
            }
            if (rightStackRef.current) {
                rightStackRef.current.style.transform = `translate(${x}px, ${y * -0.5}px)`;
            }
            rafRef.current = 0;
        });
    }, []);

    if (!data) return null;

    return (
        <div
            ref={viewportRef}
            className="cr-viewport bg-[#020915] text-white"
            onMouseMove={handleMouseMove}
        >
            {/* ═══ Layer 0: Globe Canvas (3D background) — fill entire viewport ═══ */}
            <div className="absolute inset-0 z-0 min-w-0 min-h-0" style={{ transform: 'translateX(40px)' }}>
                <ControlCanvas
                    mode={mode}
                    activeOverlay={layout.activeOverlay}
                    onOverlayChange={setActiveOverlay}
                    onOpenDrawer={setDrawerContext}
                    scopeMode={scopeMode}
                    onScopeModeChange={setScopeMode}
                    onStateContextChange={setSelectedState}
                    onProjectFocusChange={handleProjectFocusChange}
                    className="w-full h-full"
                />
            </div>

            {/* ═══ Layer 1: Atmospheric Center Glow ═══ */}
            <div className="cr-atmospheric-glow" />

            {/* ═══ Layer 1b: Heatmap hotspots over the globe (REMOVED) ═══ */}
            {/* <div className="absolute inset-0 z-[2] pointer-events-none">
                <BrazilHeatmap />
            </div> */}

            {/* ═══ Layer 2: Background scanline only ═══ */}
            <div className="cr-bg-scanline" />

            {/* ═══ Layer 3: Vignette ═══ */}
            <div className="cr-vignette z-[4]" />

            {/* ═══ Layer 4: HUD Frame (corner brackets + tick marks) ═══ */}
            <div className="cr-hud-frame" />

            {/* ═══ Layer 10: HUD Interface ═══ */}
            <div className="relative z-10 w-full h-full pointer-events-none flex flex-col">
                {/* Top HUD Bar */}
                <div className="pointer-events-auto z-50 flex-shrink-0 w-full">
                    <DashboardHudBar
                        mode={mode}
                        period={period}
                        onModeChange={handleModeChange}
                        onPeriodChange={handlePeriodChange}
                        alertCounts={alertCounts!}
                    />
                </div>

                {/* Main content: overlapping panel stacks */}
                <div className="flex-1 relative min-h-0 px-2 pb-2 h-full">
                    {/* ── Left Stack (parallax layer, z40) ── */}
                    <div
                        ref={leftStackRef}
                        className={cn(
                            "absolute top-0 left-2 bottom-2 pointer-events-auto z-40 overflow-y-auto scrollbar-hide will-change-transform",
                            isFocusMode
                                ? "-translate-x-[120%] opacity-0 pointer-events-none transition-all duration-300 ease-out"
                                : "translate-x-0 opacity-100",
                        )}
                        style={{
                            width: '360px',
                            transition: 'transform 0.35s ease-out',
                        }}
                    >
                        <LeftHudStack data={data} scopeMode={scopeMode} stateScope={selectedState} />
                    </div>

                    {/* ── Right Stack (parallax layer, z40, opposite direction) ── */}
                    <div
                        ref={rightStackRef}
                        className={cn(
                            "absolute top-0 right-2 bottom-2 pointer-events-auto z-40 overflow-y-auto scrollbar-hide will-change-transform",
                            isRightSidebarActive
                                ? "translate-x-0 opacity-100"
                                : "translate-x-[120%] opacity-0 pointer-events-none transition-all duration-300 ease-out"
                        )}
                        style={{
                            width: '330px',
                            transition: 'transform 0.35s ease-out',
                        }}
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
