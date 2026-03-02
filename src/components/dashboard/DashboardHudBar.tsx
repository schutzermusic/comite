'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import type { HudMode, PeriodFilter } from '@/hooks/useHudLayout';
import { HudChip } from './hud';
import NotificationCenter from '@/components/layout/notification-center';

interface DashboardHudBarProps {
    mode: HudMode;
    period: PeriodFilter;
    onModeChange: (mode: HudMode) => void;
    onPeriodChange: (period: PeriodFilter) => void;
    onCommandPalette?: () => void;
    alertCounts?: AlertCounts;
}

interface AlertCounts {
    critical: number;
    votesIn72h: number;
    docsPending: number;
}

const PERIOD_KEYS: PeriodFilter[] = ['mtd', 'qtd', 'ytd', 'custom'];

export function DashboardHudBar({
    mode,
    period,
    onModeChange,
    onPeriodChange,
    onCommandPalette,
    alertCounts = { critical: 2, votesIn72h: 3, docsPending: 2 },
}: DashboardHudBarProps) {
    const t = useTranslations('dashboard');
    return (
        <div className="hud-bar flex items-center justify-between gap-[0.75em] min-h-[3.5em] py-[0.65em] px-[0.75em] w-full max-w-[100vw] overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            {/* Left: Title — only this shrinks; scales with .hud-bar font-size */}
            <div className="hud-bar-heading min-w-0 flex flex-col justify-center shrink gap-[0.2em]">
                <h1 className="hud-bar-title truncate m-0">
                    {t('controlRoomTitle')}
                </h1>
                <p className="hud-bar-subtitle truncate m-0">
                    {t('controlRoomSubtitle')}
                </p>
            </div>

            {/* Center: Filters — scale with bar */}
            <div className="flex items-center gap-[0.5em] flex-shrink-0 hidden xl:flex">
                {/* Period filter */}
                <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-[0.35em] p-0.5 border border-white/[0.05]">
                    {PERIOD_KEYS.map((key) => (
                        <button
                            key={key}
                            onClick={() => onPeriodChange(key)}
                            className={`hud-period-btn ${period === key ? 'hud-period-btn-active' : ''}`}
                        >
                            {t(key === 'mtd' ? 'periodMtd' : key === 'qtd' ? 'periodQtd' : key === 'ytd' ? 'periodYtd' : 'periodCustom')}
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
                        {t('modeExecutive')}
                    </button>
                    <button
                        onClick={() => onModeChange('operacional')}
                        className={`hud-mode-btn ${mode === 'operacional' ? 'hud-mode-btn-active' : ''}`}
                    >
                        {t('modeOperational')}
                    </button>
                </div>
            </div>

            {/* Right: Alert Chips + Live + Search — never shrink so items stay visible at any zoom */}
            <div className="flex items-center gap-[0.5em] shrink-0 flex-nowrap ml-auto">
                {/* Alert chips */}
                <div className="hidden 2xl:flex items-center gap-[0.5em]">
                    <HudChip
                        label={t('critical')}
                        count={alertCounts.critical}
                        variant="critical"
                        href="/riscos?severity=critico"
                    />
                    <HudChip
                        label={t('votes72h')}
                        count={alertCounts.votesIn72h}
                        variant="warning"
                        href="/deliberacoes?due=72h"
                    />
                    <HudChip
                        label={t('docsPending')}
                        count={alertCounts.docsPending}
                        variant="info"
                        href="/atas"
                    />
                </div>

                <HudChip label={t('live')} variant="live" pulseDot />

                {/* Notifications (relocated) */}
                <NotificationCenter />
            </div>
        </div>
    );
}
