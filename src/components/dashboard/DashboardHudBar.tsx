'use client';

import React from 'react';
import type { HudMode, PeriodFilter } from '@/hooks/useHudLayout';
import { HudChip } from './hud';
import NotificationCenter from '@/components/layout/notification-center';

interface AlertCounts {
    critical: number;
    votesIn72h: number;
    docsPending: number;
}

interface DashboardHudBarProps {
    mode: HudMode;
    period: PeriodFilter;
    onModeChange: (mode: HudMode) => void;
    onPeriodChange: (period: PeriodFilter) => void;
    onCommandPalette?: () => void;
    alertCounts?: AlertCounts;
}

const PERIODS: { key: PeriodFilter; label: string }[] = [
    { key: 'mtd', label: 'MTD' },
    { key: 'qtd', label: 'QTD' },
    { key: 'ytd', label: 'YTD' },
    { key: 'custom', label: 'Custom' },
];

export function DashboardHudBar({
    mode,
    period,
    onModeChange,
    onPeriodChange,
    onCommandPalette,
    alertCounts = { critical: 2, votesIn72h: 3, docsPending: 2 },
}: DashboardHudBarProps) {
    return (
        <div className="hud-bar flex items-center justify-between gap-[0.75em] min-h-[3.5em] py-[0.65em] px-[0.75em] w-full max-w-[100vw] overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            {/* Left: Title — only this shrinks; scales with .hud-bar font-size */}
            <div className="min-w-0 flex flex-col justify-center shrink">
                <h1 className="text-[1.05em] font-semibold text-white tracking-[0.02em] leading-tight truncate m-0">
                    Sala de Controle Executivo
                </h1>
                <p className="text-[0.75em] text-white/45 tracking-[0.12em] uppercase mt-[0.25em] truncate leading-none m-0">
                    Visão diária de governança e desempenho
                </p>
            </div>

            {/* Center: Filters — scale with bar */}
            <div className="flex items-center gap-[0.5em] flex-shrink-0 hidden xl:flex">
                {/* Period filter */}
                <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-[0.35em] p-0.5 border border-white/[0.05]">
                    {PERIODS.map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => onPeriodChange(key)}
                            className={`hud-period-btn ${period === key ? 'hud-period-btn-active' : ''}`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Divider */}
                <div className="w-px min-h-[1.2em] self-stretch bg-white/[0.08]" />

                {/* Mode toggle */}
                <div className="hud-mode-toggle">
                    <button
                        onClick={() => onModeChange('executivo')}
                        className={`hud-mode-btn ${mode === 'executivo' ? 'hud-mode-btn-active' : ''}`}
                    >
                        Executivo
                    </button>
                    <button
                        onClick={() => onModeChange('operacional')}
                        className={`hud-mode-btn ${mode === 'operacional' ? 'hud-mode-btn-active' : ''}`}
                    >
                        Operacional
                    </button>
                </div>
            </div>

            {/* Right: Alert Chips + Live + Search — never shrink so items stay visible at any zoom */}
            <div className="flex items-center gap-[0.5em] shrink-0 flex-nowrap ml-auto">
                {/* Alert chips */}
                <div className="hidden 2xl:flex items-center gap-[0.5em]">
                    <HudChip
                        label="Críticos"
                        count={alertCounts.critical}
                        variant="critical"
                        href="/riscos?severity=critico"
                    />
                    <HudChip
                        label="Votos 72h"
                        count={alertCounts.votesIn72h}
                        variant="warning"
                        href="/deliberacoes?due=72h"
                    />
                    <HudChip
                        label="Docs pendentes"
                        count={alertCounts.docsPending}
                        variant="info"
                        href="/atas"
                    />
                </div>

                {/* Ao Vivo indicator */}
                <HudChip label="AO VIVO" variant="live" pulseDot />

                {/* Notifications (relocated) */}
                <NotificationCenter />
            </div>
        </div>
    );
}
