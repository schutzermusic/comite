'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DashboardHudBar } from '@/components/dashboard/DashboardHudBar';
import { ControlCanvas } from '@/components/dashboard/ControlCanvas';
import { BrazilHeatmap } from '@/components/dashboard/BrazilHeatmap';
import { LeftHudStack } from '@/components/dashboard/LeftHudStack';
import { RightHudStack } from '@/components/dashboard/RightHudStack';
import { ContextDrawer, type DrawerContext } from '@/components/dashboard/ContextDrawer';
import { QuickActionToast } from '@/components/dashboard/QuickActionToast';
import { useHudLayout } from '@/hooks/useHudLayout';
import { getMockDashboardData } from '@/lib/dashboard-data';
import type { DashboardPayload } from '@/lib/dashboard-data';

export default function DashboardPage() {
    const { layout, setMode, setPeriod, setActiveOverlay } = useHudLayout();
    const [mode, setLocalMode] = useState<'executivo' | 'operacional'>('executivo');
    const [period, setLocalPeriod] = useState<'mtd' | 'qtd' | 'ytd' | 'custom'>('mtd');
    const [data, setData] = useState<DashboardPayload | null>(null);
    const [drawerContext, setDrawerContext] = useState<DrawerContext>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const [parallax, setParallax] = useState({ x: 0, y: 0 });

    useEffect(() => {
        setData(getMockDashboardData());
    }, []);

    const handleModeChange = (m: 'executivo' | 'operacional') => {
        setLocalMode(m);
        setMode(m);
    };

    const handlePeriodChange = (p: 'mtd' | 'qtd' | 'ytd' | 'custom') => {
        setLocalPeriod(p);
        setPeriod(p);
    };

    // Subtle parallax on mouse move
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / rect.width - 0.5;  // -0.5 to 0.5
        const ny = (e.clientY - rect.top) / rect.height - 0.5;
        setParallax({ x: nx * 6, y: ny * 4 }); // max 3px / 2px shift
    }, []);

    if (!data) return null;

    return (
        <div
            ref={viewportRef}
            className="cr-viewport relative w-full overflow-hidden bg-[#020915] text-white"
            onMouseMove={handleMouseMove}
        >
            {/* ═══ Layer 0: Globe Canvas (3D background) ═══ */}
            <div className="absolute inset-0 z-0" style={{ opacity: 1 }}>
                <ControlCanvas
                    activeOverlay={layout.activeOverlay}
                    onOverlayChange={setActiveOverlay}
                    onOpenDrawer={setDrawerContext}
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
                <div className="pointer-events-auto px-3 pt-2 pb-1 z-50 flex-shrink-0">
                    <DashboardHudBar
                        mode={mode}
                        period={period}
                        onModeChange={handleModeChange}
                        onPeriodChange={handlePeriodChange}
                        alertCounts={{
                            critical: data.riskSummary.critical,
                            votesIn72h: data.votingStatus.endingIn72h,
                            docsPending: 2,
                        }}
                    />
                </div>

                {/* Main content: overlapping panel stacks */}
                <div className="flex-1 relative min-h-0 px-2 pb-2">
                    {/* ── Left Stack (parallax layer, z40) ── */}
                    <div
                        className="absolute top-0 left-2 bottom-2 pointer-events-auto z-40 overflow-y-auto scrollbar-hide"
                        style={{
                            width: '360px',
                            transform: `translate(${parallax.x * -1}px, ${parallax.y * -0.5}px)`,
                            transition: 'transform 0.35s ease-out',
                        }}
                    >
                        <LeftHudStack data={data} />
                    </div>

                    {/* ── Right Stack (parallax layer, z40, opposite direction) ── */}
                    <div
                        className="absolute top-0 right-2 bottom-2 pointer-events-auto z-40 overflow-y-auto scrollbar-hide"
                        style={{
                            width: '330px',
                            transform: `translate(${parallax.x}px, ${parallax.y * -0.5}px)`,
                            transition: 'transform 0.35s ease-out',
                        }}
                    >
                        <RightHudStack data={data} />
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
