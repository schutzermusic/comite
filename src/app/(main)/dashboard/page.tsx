'use client';

import React, { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { ControlCanvas, type ScopeMode } from '@/components/dashboard/ControlCanvas';
import { ContextDrawer, type DrawerContext } from '@/components/dashboard/ContextDrawer';
import { useHudLayout } from '@/hooks/useHudLayout';
import { getMockDashboardData } from '@/lib/dashboard-data';
import type { DashboardPayload } from '@/lib/dashboard-data';
import { buildLiveDashboardPayload } from '@/lib/dashboard-live';
import type { StateAggregate } from '@/data/geo/globe-kpi-data';
import { cn } from '@/lib/utils';
import { useCurrentUser } from '@/hooks/use-current-user';
import { getProjectsAsync, getProjectsV2Async } from '@/lib/services/projects';
import { listProjectContractValues } from '@/lib/projects/contract/project-contract-service';

import { listRisks } from '@/lib/services/risks';
import { listDeliberations } from '@/lib/services/deliberations';

const LeftHudStack = dynamic(
    () => import('@/components/dashboard/LeftHudStack').then(m => ({ default: m.LeftHudStack })),
    { ssr: false }
);
const RightHudStack = dynamic(
    () => import('@/components/dashboard/RightHudStack').then(m => ({ default: m.RightHudStack })),
    { ssr: false }
);

export default function DashboardPage() {
    const { organization, loading: organizationLoading } = useCurrentUser();
    const {
        layout, setSelectedUF,
        setActiveOverlay,
    } = useHudLayout();
    const [mode] = useState<'executivo' | 'operacional'>('executivo');
    const [data, setData] = useState<DashboardPayload | null>(null);
    const [drawerContext, setDrawerContext] = useState<DrawerContext>(null);
    const [scopeMode, setScopeMode] = useState<ScopeMode>('global');
    const [selectedState, setSelectedState] = useState<StateAggregate | null>(null);
    const [uiMode, setUiMode] = useState<'default' | 'projectFocus'>('default');
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);

    const isDemo = organization?.is_demo === true;
    const isRightSidebarActive = isSidebarVisible && selectedState === null;
    const isFocusMode = uiMode === 'projectFocus' || selectedState !== null;

    const handleProjectFocusChange = useCallback((active: boolean) => {
        if (active) {
            setUiMode('projectFocus');
            setIsSidebarVisible(false);
        } else {
            setUiMode('default');
            setSelectedState(null);
            setScopeMode('global');
            setSelectedUF(null);
            setIsSidebarVisible(true);
        }
    }, [setSelectedUF]);

    useEffect(() => {
        let active = true;

        if (isDemo) {
            setData(getMockDashboardData());
            return () => { active = false; };
        }

        /*
          Org ao vivo: globo + painéis glass com fatos de projeto/contrato.
          Sem mock de deliberação/votação — filas vazias até haver fonte governada.
        */
        void (async () => {
            try {
                const [projects, projectsV2, contractValues, risks, deliberations] = await Promise.all([
                    getProjectsAsync(),
                    getProjectsV2Async(),
                    listProjectContractValues().catch(
                        () => new Map<string, { contractValue: number; currency: string | null }>(),
                    ),
                    listRisks().catch(() => [] as const),
                    listDeliberations().catch(() => [] as const),
                ]);
                if (!active) return;
                const values = new Map<string, number>();
                contractValues.forEach((v, id) => values.set(id, v.contractValue));
                setData(buildLiveDashboardPayload(projects, projectsV2, values, {
                    risks,
                    deliberations,
                }));
            } catch {
                if (active) {
                    setData(buildLiveDashboardPayload([], [], new Map()));
                }
            }
        })();

        return () => { active = false; };
    }, [organization?.id, isDemo]);

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

    if (organizationLoading) return null;

    return (
        <div className="cr-viewport bg-ig-canvas text-ig-fg-strong">
            {/* ═══ Layer 0: Globe Canvas (3D background) ═══ */}
            <div className="absolute inset-0 z-0 min-w-0 min-h-0 overflow-hidden">
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

            {/* ═══ Layer 10: HUD glass KPIs ═══ */}
            {data ? (
                <div className="relative z-10 w-full h-full pointer-events-none flex flex-col">
                    <div className="flex-1 relative min-h-0 px-0 pb-0 h-full">
                        <div
                            className={cn(
                                "absolute top-0 left-0 bottom-0 pointer-events-auto z-40 overflow-y-auto scrollbar-hide",
                                isFocusMode
                                    ? "-translate-x-[120%] opacity-0 pointer-events-none transition-all duration-300 ease-out"
                                    : "translate-x-0 opacity-100 transition-all duration-300 ease-out",
                            )}
                            style={{ width: '364px' }}
                        >
                            <LeftHudStack data={data} scopeMode={scopeMode} stateScope={selectedState} />
                        </div>

                        <div
                            className={cn(
                                "absolute top-0 right-0 bottom-0 pointer-events-auto z-40 overflow-y-auto scrollbar-hide",
                                isRightSidebarActive
                                    ? "translate-x-0 opacity-100 transition-all duration-300 ease-out"
                                    : "translate-x-[120%] opacity-0 pointer-events-none transition-all duration-300 ease-out"
                            )}
                            style={{ width: '344px' }}
                        >
                            <RightHudStack data={data} scopeMode={scopeMode} stateScope={selectedState} />
                        </div>
                    </div>
                </div>
            ) : null}

            <ContextDrawer
                context={drawerContext}
                onClose={() => setDrawerContext(null)}
            />
        </div>
    );
}
