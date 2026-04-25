'use client';

import React, { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
    Vote,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    Settings2,
    FileText,
    Briefcase,
    Shield,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { HudPanel, HudRingGauge } from './hud';
import type { DashboardPayload } from '@/lib/dashboard-data';
import { cn } from '@/lib/utils';
import type { StateAggregate } from '@/data/geo/globe-kpi-data';

interface RightHudStackProps {
    data: DashboardPayload;
    scopeMode?: 'global' | 'state';
    stateScope?: StateAggregate | null;
}

// ─── Event Stream types ─────────────────────────────────────
type EventCategory = 'riscos' | 'decisoes' | 'docs' | 'projetos' | 'contratos';

interface EventItem {
    id: string;
    type: EventCategory;
    severity: 'critical' | 'warning' | 'info' | 'success';
    label: string;
    detail?: string;
    timestamp: string;
    href: string;
}

const CATEGORY_FILTER_KEYS: { key: 'all' | EventCategory; labelKey: string }[] = [
    { key: 'all', labelKey: 'categoryAll' },
    { key: 'riscos', labelKey: 'categoryRisks' },
    { key: 'decisoes', labelKey: 'categoryDecisions' },
    { key: 'docs', labelKey: 'categoryDocs' },
    { key: 'projetos', labelKey: 'categoryProjects' },
    { key: 'contratos', labelKey: 'categoryContracts' },
];

const SEVERITY_DOT: Record<string, string> = {
    critical: 'hud-dot hud-dot-critical',
    warning: 'hud-dot hud-dot-warning',
    info: 'hud-dot hud-dot-info',
    success: 'hud-dot hud-dot-success',
};

const CATEGORY_ICON: Record<EventCategory, React.ElementType> = {
    riscos: AlertTriangle,
    decisoes: Vote,
    docs: FileText,
    projetos: Briefcase,
    contratos: Shield,
};

const CATEGORY_LABEL_KEYS: Record<EventCategory, string> = {
    riscos: 'labelRisk',
    decisoes: 'labelDecision',
    docs: 'labelDoc',
    projetos: 'labelProject',
    contratos: 'labelContract',
};

const MOCK_EVENT_KEYS: { id: string; type: EventCategory; severity: EventItem['severity']; labelKey: string; timestamp: string; href: string }[] = [
    { id: 'e1', type: 'riscos', severity: 'critical', labelKey: 'eventCriticalRiskSp', timestamp: '17:15', href: '/riscos?severity=critico' },
    { id: 'e2', type: 'decisoes', severity: 'warning', labelKey: 'eventVoteSolar', timestamp: '17:10', href: '/deliberacoes' },
    { id: 'e3', type: 'docs', severity: 'info', labelKey: 'eventMinutesPending', timestamp: '17:05', href: '/atas' },
    { id: 'e4', type: 'projetos', severity: 'success', labelKey: 'eventMilestoneEnergisa', timestamp: '16:45', href: '/projetos' },
    { id: 'e5', type: 'contratos', severity: 'warning', labelKey: 'eventContractCesp', timestamp: '16:30', href: '/contratos' },
];

export const RightHudStack = React.memo(function RightHudStack({ data, scopeMode = 'global', stateScope = null }: RightHudStackProps) {
    const t = useTranslations('dashboard');
    const tCommon = useTranslations('common');
    const [eventFilter, setEventFilter] = useState<'all' | EventCategory>('all');
    const [streamExpanded, setStreamExpanded] = useState(true);
    const scopeSuffix = scopeMode === 'state' && stateScope ? `&state=${stateScope.uf}&uf=${stateScope.uf}` : '';
    const mockEvents: EventItem[] = useMemo(
        () => MOCK_EVENT_KEYS.map(({ labelKey, ...rest }) => ({ ...rest, label: t(labelKey) })),
        [t]
    );
    const scopedRiskSummary = scopeMode === 'state' && stateScope
        ? {
            critical: Math.min(stateScope.riskCount, Math.max(1, Math.floor(stateScope.riskCount * 0.45))),
            high: Math.max(0, stateScope.riskCount - Math.min(stateScope.riskCount, Math.max(1, Math.floor(stateScope.riskCount * 0.45)))),
            total: stateScope.riskCount,
        }
        : data.riskSummary;

    const filteredEvents = useMemo(
        () => mockEvents.filter((e) => eventFilter === 'all' || e.type === eventFilter),
        [mockEvents, eventFilter]
    );

    const topRiskKeys = [
        'topRiskContributors',
        'linkBankingProcess',
        'linkFxExposure',
        'linkReversedProjects',
    ] as const;

    return (
        <div className="cr-panel-stack-right">
            {/* ─── Panel D: Decision SLA / Votos ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 30 }}>
                <HudPanel
                    title={t('decisionSlaVotes')}
                    accentColor="bg-amber-400"
                    deepLinkHref={`/deliberacoes?due=72h${scopeSuffix}`}
                    deepLinkLabel={tCommon('deliberations')}
                    icon={<Vote className="w-3 h-3" />}
                    delay={0.15}
                >
                    <HudRingGauge
                        value={data.votingStatus.pending}
                        max={data.votingStatus.pending + data.votingStatus.approved}
                        label={t('pending')}
                        size={74}
                        strokeWidth={5}
                        color="#f59e0b"
                        trackColor="rgba(245, 158, 11, 0.08)"
                        sideMetrics={[
                            {
                                value: data.votingStatus.endingIn72h,
                                label: '<72h',
                                color: '#fbbf24',
                            },
                            {
                                value: `${data.performanceMetrics.avgDecisionTime}d`,
                                label: t('avgTimeMedium'),
                                color: '#94a3b8',
                            },
                        ]}
                    />
                </HudPanel>
            </div>

            {/* ─── Panel E: Risk Exposure ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 20, marginTop: '-6px' }}>
                <HudPanel
                    title={scopeMode === 'state' && stateScope ? t('riskExposureState', { uf: stateScope.uf }) : t('riskExposure')}
                    accentColor="bg-red-500"
                    deepLinkHref={`/riscos?severity=critico${scopeSuffix}`}
                    deepLinkLabel={tCommon('risks')}
                    icon={<AlertTriangle className="w-3 h-3" />}
                    delay={0.25}
                >
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            <Link href={`/riscos?severity=critico${scopeSuffix}`} className="text-center group cursor-pointer">
                                <p className="text-xl font-semibold text-red-400 tabular-nums leading-none group-hover:text-red-300 transition-colors">
                                    {scopedRiskSummary.critical}
                                </p>
                                <p className="cr-label mt-1">
                                    {t('critical')}
                                </p>
                            </Link>
                            <Link href={`/riscos${scopeSuffix}`} className="text-center group cursor-pointer">
                                <p className="text-xl font-semibold text-amber-400 tabular-nums leading-none group-hover:text-amber-300 transition-colors">
                                    {scopedRiskSummary.high}
                                </p>
                                <p className="cr-label mt-1">
                                    {t('withoutMitigation')}
                                </p>
                            </Link>
                            <Link href={`/riscos${scopeSuffix}`} className="text-center group cursor-pointer">
                                <p className="text-xl font-semibold text-white tabular-nums leading-none group-hover:text-cyan-100 transition-colors">
                                    {scopedRiskSummary.total}
                                </p>
                                <p className="cr-label mt-1">
                                    {t('totalExposure')}
                                </p>
                            </Link>
                        </div>

                        <div>
                            <p className="cr-label mb-1.5">
                                {t('topRiskContributors')}:
                            </p>
                            <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-0.5">
                                {topRiskKeys.slice(1).map((key) => (
                                    <Link
                                        key={key}
                                        href="/riscos"
                                        className="text-[9px] px-2 py-0.5 rounded-full bg-red-500/[0.07] border border-red-400/20 text-red-200/70 hover:border-red-300/40 hover:text-red-100 hover:bg-red-500/[0.12] transition-all duration-150 whitespace-nowrap flex-shrink-0"
                                    >
                                        {t(key)}
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>
                </HudPanel>
            </div>

            {/* ─── Panel F: Event Stream (SOC-style) ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 10, marginTop: '-6px' }}>
                <HudPanel
                    title={t('eventStream')}
                    accentColor="bg-cyan-400"
                    delay={0.35}
                    badge={filteredEvents.length}
                >
                    <div className="space-y-1.5">
                        {/* Header controls */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <span className="cr-live-indicator text-[8px] font-bold text-emerald-300 uppercase tracking-[0.14em]">Live</span>
                                <span className="text-[9px] text-white/30 tabular-nums">
                                    {filteredEvents.length}
                                </span>
                            </div>
                            <button
                                onClick={() => setStreamExpanded(!streamExpanded)}
                                className="p-0.5 rounded hover:bg-white/5 transition-colors"
                            >
                                {streamExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5 text-white/30" />
                                ) : (
                                    <ChevronDown className="w-3.5 h-3.5 text-white/30" />
                                )}
                            </button>
                        </div>

                        {/* Category filters */}
                        <div className="flex flex-wrap gap-0.5">
                            {CATEGORY_FILTER_KEYS.map(({ key, labelKey }) => (
                                <button
                                    key={key}
                                    onClick={() => setEventFilter(key)}
                                    className={cn(
                                        'hud-filter-pill',
                                        eventFilter === key && 'hud-filter-pill-active'
                                    )}
                                >
                                    {t(labelKey)}
                                </button>
                            ))}
                        </div>

                        {/* Event list */}
                        <AnimatePresence initial={false}>
                            {streamExpanded && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.25 }}
                                    className="overflow-hidden"
                                >
                                    <div className="cr-event-stream space-y-0.5">
                                        {filteredEvents.map((event) => {
                                            const CatIcon = CATEGORY_ICON[event.type] as any;
                                            return (
                                                <Link
                                                    key={event.id}
                                                    href={event.href}
                                                    className="group flex items-start gap-1.5 px-1.5 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer"
                                                >
                                                    <div
                                                        className={SEVERITY_DOT[event.severity]}
                                                        style={{ marginTop: 3 }}
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1">
                                                            <CatIcon className="w-[11px] h-[11px] text-white/30 flex-shrink-0" />
                                                            <span className="text-[9px] font-medium text-white/50 uppercase tracking-[0.08em]">
                                                                {t(CATEGORY_LABEL_KEYS[event.type])}
                                                            </span>
                                                            <span className="text-[9px] text-white/25 tabular-nums ml-auto flex-shrink-0">
                                                                {event.timestamp}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-white/75 leading-snug mt-0.5 group-hover:text-white/90 transition-colors">
                                                            {event.label}
                                                        </p>
                                                    </div>
                                                </Link>
                                            );
                                        })}
                                        {filteredEvents.length === 0 && (
                                            <div className="text-center py-4">
                                                <p className="text-[10px] text-white/30">
                                                    {t('noEvents')}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </HudPanel>
            </div>

            <div className="mt-2 flex items-center justify-end px-2">
                <span className="text-[9px] uppercase tracking-[0.32em] text-ig-fg-subtle">
                    EXECUTIVE · VIEW
                </span>
            </div>
        </div>
    );
});
