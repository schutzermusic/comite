'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import type { HudMode, PeriodFilter, ViewPreset } from '@/hooks/useHudLayout';
import { HudChip } from './hud';
import NotificationCenter from '@/components/layout/notification-center';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

interface DashboardHudBarProps {
    mode: HudMode;
    period: PeriodFilter;
    preset: ViewPreset;
    onModeChange: (mode: HudMode) => void;
    onPeriodChange: (period: PeriodFilter) => void;
    onPresetChange: (preset: ViewPreset) => void;
    onCommandPalette?: () => void;
    alertCounts?: AlertCounts;
}

interface AlertCounts {
    critical: number;
    votesIn72h: number;
    docsPending: number;
}

const PERIOD_KEYS: PeriodFilter[] = ['mtd', 'qtd', 'ytd', 'custom'];
const PRESET_OPTIONS: { key: ViewPreset; labelKey: string }[] = [
    { key: 'diretor', labelKey: 'presetDirector' },
    { key: 'financeiro', labelKey: 'presetFinance' },
    { key: 'rh', labelKey: 'presetHR' },
    { key: 'comercial', labelKey: 'presetCommercial' },
];

export function DashboardHudBar({
    mode,
    period,
    preset,
    onModeChange,
    onPeriodChange,
    onPresetChange,
    onCommandPalette,
    alertCounts = { critical: 2, votesIn72h: 3, docsPending: 2 },
}: DashboardHudBarProps) {
    const t = useTranslations('dashboard');
    const [presetOpen, setPresetOpen] = useState(false);
    const presetRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (presetRef.current && !presetRef.current.contains(e.target as Node)) {
                setPresetOpen(false);
            }
        }
        if (presetOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [presetOpen]);

    const currentPresetLabel = PRESET_OPTIONS.find(p => p.key === preset)?.labelKey || 'presetDirector';

    return (
        <div className="hud-bar flex items-center justify-between gap-[0.75em] min-h-[3.5em] py-[0.65em] px-[0.75em] w-full max-w-[100vw] overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            <div className="hud-bar-heading min-w-0 flex flex-col justify-center shrink gap-[0.2em]">
                <h1 className="hud-bar-title truncate m-0">
                    {t('controlRoomTitle')}
                </h1>
                <p className="hud-bar-subtitle truncate m-0">
                    {t('controlRoomSubtitle')}
                </p>
            </div>

            <div className="flex items-center gap-[0.5em] flex-shrink-0 hidden xl:flex">
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

                <div className="w-px min-h-[1.2em] self-stretch bg-white/[0.08]" />

                {/* View Preset Selector */}
                <div ref={presetRef} className="relative">
                    <button
                        onClick={() => setPresetOpen(!presetOpen)}
                        className="hud-period-btn hud-period-btn-active flex items-center gap-1"
                    >
                        {t(currentPresetLabel)}
                        <ChevronDown className={`w-3 h-3 transition-transform ${presetOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {presetOpen && (
                        <div className="absolute top-full left-0 mt-1 z-[60] min-w-[140px] py-1 rounded-lg bg-[rgba(6,20,16,0.92)] backdrop-blur-xl border border-white/10 shadow-xl">
                            {PRESET_OPTIONS.map(({ key, labelKey }) => (
                                <button
                                    key={key}
                                    onClick={() => {
                                        onPresetChange(key);
                                        setPresetOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors ${
                                        preset === key
                                            ? 'text-emerald-300 bg-emerald-500/10'
                                            : 'text-white/70 hover:text-white hover:bg-white/[0.04]'
                                    }`}
                                >
                                    {t(labelKey)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-[0.5em] shrink-0 flex-nowrap ml-auto">
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
                <ThemeToggle />
                <NotificationCenter />
            </div>
        </div>
    );
}
