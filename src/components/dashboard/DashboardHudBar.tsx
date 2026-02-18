'use client';

import React from 'react';
import { Search, Radio } from 'lucide-react';
import type { HudMode, PeriodFilter } from '@/hooks/useHudLayout';
import { HudChip } from './hud';

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
        <div className="hud-bar flex items-center justify-between gap-4">
            {/* Left: Title */}
            <div className="flex-shrink-0 min-w-0">
                <h1 className="text-sm font-semibold text-white tracking-[0.02em] leading-tight truncate">
                    Sala de Controle Executivo
                </h1>
                <p className="text-[10px] text-white/45 tracking-[0.12em] uppercase mt-0.5 truncate">
                    Visão diária de governança e desempenho
                </p>
            </div>

            {/* Center: Filters */}
            <div className="flex items-center gap-3 flex-shrink-0">
                {/* Period filter */}
                <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md p-0.5 border border-white/[0.05]">
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
                <div className="w-px h-5 bg-white/[0.08]" />

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

            {/* Right: Alert Chips + Live + Search */}
            <div className="flex items-center gap-3 flex-shrink-0">
                {/* Alert chips */}
                <div className="hidden lg:flex items-center gap-2">
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

                {/* Last update */}
                <div className="text-right hidden md:block">
                    <p className="text-[9px] text-white/25 uppercase tracking-wider">
                        Última atualização
                    </p>
                    <p className="text-[11px] text-white/60 font-medium tabular-nums">
                        {new Date().toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </p>
                </div>

                {/* Command palette */}
                <button
                    onClick={onCommandPalette}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-all duration-150"
                    title="Busca rápida (⌘K)"
                >
                    <Search className="w-3.5 h-3.5 text-white/30" />
                    <span className="text-[10px] text-white/25 hidden lg:inline">⌘K</span>
                </button>
            </div>
        </div>
    );
}
