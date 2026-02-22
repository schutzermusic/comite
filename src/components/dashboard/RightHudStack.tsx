'use client';

import React, { useState } from 'react';
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

const CATEGORY_FILTERS: { key: 'all' | EventCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'riscos', label: 'Riscos' },
    { key: 'decisoes', label: 'Decisões' },
    { key: 'docs', label: 'Docs' },
    { key: 'projetos', label: 'Projetos' },
    { key: 'contratos', label: 'Contratos' },
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

const CATEGORY_LABEL: Record<EventCategory, string> = {
    riscos: 'Risco',
    decisoes: 'Decisão',
    docs: 'Doc',
    projetos: 'Projeto',
    contratos: 'Contrato',
};

const MOCK_EVENTS: EventItem[] = [
    {
        id: 'e1',
        type: 'riscos',
        severity: 'critical',
        label: 'Risco operacional crítico escalado em SP',
        timestamp: '17:15',
        href: '/riscos?severity=critico',
    },
    {
        id: 'e2',
        type: 'decisoes',
        severity: 'warning',
        label: 'Voto do Conselho: Novo Projeto Solar',
        timestamp: '17:10',
        href: '/deliberacoes',
    },
    {
        id: 'e3',
        type: 'docs',
        severity: 'info',
        label: 'Ata de Reunião do Comitê pendente',
        timestamp: '17:05',
        href: '/atas',
    },
    {
        id: 'e4',
        type: 'projetos',
        severity: 'success',
        label: 'Milestone entregue: Energisa Grid',
        timestamp: '16:45',
        href: '/projetos',
    },
    {
        id: 'e5',
        type: 'contratos',
        severity: 'warning',
        label: 'Contrato CESP expira em 30 dias',
        timestamp: '16:30',
        href: '/contratos',
    },
];

export function RightHudStack({ data, scopeMode = 'global', stateScope = null }: RightHudStackProps) {
    const [eventFilter, setEventFilter] = useState<'all' | EventCategory>('all');
    const [streamExpanded, setStreamExpanded] = useState(true);
    const scopeSuffix = scopeMode === 'state' && stateScope ? `&state=${stateScope.uf}&uf=${stateScope.uf}` : '';
    const scopedRiskSummary = scopeMode === 'state' && stateScope
        ? {
            critical: Math.min(stateScope.riskCount, Math.max(1, Math.floor(stateScope.riskCount * 0.45))),
            high: Math.max(0, stateScope.riskCount - Math.min(stateScope.riskCount, Math.max(1, Math.floor(stateScope.riskCount * 0.45)))),
            total: stateScope.riskCount,
        }
        : data.riskSummary;

    const filteredEvents = MOCK_EVENTS.filter(
        (e) => eventFilter === 'all' || e.type === eventFilter
    );

    const topRisks = [
        { label: 'Top risk contributors', href: '/riscos' },
        { label: 'Processo de bancarização/ações', href: '/riscos' },
        { label: 'Exposição dólar/euro', href: '/riscos' },
        { label: 'Projetos estornados', href: '/riscos' },
    ];

    return (
        <div className="cr-panel-stack-right">
            {/* ─── Panel D: Decision SLA / Votos ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 30 }}>
                <HudPanel
                    title="Decision SLA / Votos"
                    accentColor="bg-amber-400"
                    deepLinkHref={`/deliberacoes?due=72h${scopeSuffix}`}
                    deepLinkLabel="Deliberações"
                    icon={<Vote className="w-3 h-3" />}
                    delay={0.15}
                >
                    <HudRingGauge
                        value={data.votingStatus.pending}
                        max={data.votingStatus.pending + data.votingStatus.approved}
                        label="pendentes"
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
                                label: 'avg tempo médio',
                                color: '#94a3b8',
                            },
                        ]}
                    />
                </HudPanel>
            </div>

            {/* ─── Panel E: Risk Exposure ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 20, marginTop: '-6px' }}>
                <HudPanel
                    title={scopeMode === 'state' && stateScope ? `Risk Exposure · ${stateScope.uf}` : 'Risk Exposure'}
                    accentColor="bg-red-500"
                    deepLinkHref={`/riscos?severity=critico${scopeSuffix}`}
                    deepLinkLabel="Riscos"
                    icon={<AlertTriangle className="w-3 h-3" />}
                    delay={0.25}
                >
                    <div className="space-y-3">
                        {/* KPI row */}
                        <div className="grid grid-cols-3 gap-2">
                            <div className="text-center">
                                <p className="text-xl font-bold text-red-400 tabular-nums leading-none" style={{ textShadow: '0 0 12px rgba(239, 68, 68, 0.25)' }}>
                                    {scopedRiskSummary.critical}
                                </p>
                                <p className="cr-label mt-1">
                                    Críticos
                                </p>
                            </div>
                            <div className="text-center">
                                <p className="text-xl font-bold text-amber-400 tabular-nums leading-none" style={{ textShadow: '0 0 12px rgba(245, 158, 11, 0.2)' }}>
                                    {scopedRiskSummary.high}
                                </p>
                                <p className="cr-label mt-1">
                                    Sem mitigação
                                </p>
                            </div>
                            <div className="text-center">
                                <p className="text-2xl font-bold text-white tabular-nums leading-none" style={{ textShadow: '0 0 14px rgba(124, 232, 253, 0.18)' }}>
                                    {scopedRiskSummary.total}
                                </p>
                                <p className="cr-label mt-1">
                                    Exposição total
                                </p>
                            </div>
                        </div>

                        {/* Top risk contributors — scrollable chips */}
                        <div>
                            <p className="cr-label mb-1.5">
                                Top risk contributors:
                            </p>
                            <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-0.5">
                                {topRisks.slice(1).map((risk) => (
                                    <Link
                                        key={risk.label}
                                        href={risk.href}
                                        className="text-[8px] px-2 py-0.5 rounded-full bg-red-500/[0.07] border border-red-400/20 text-red-200/80 hover:border-red-300/40 hover:text-red-100 hover:bg-red-500/[0.14] transition-all duration-150 whitespace-nowrap flex-shrink-0"
                                    >
                                        {risk.label}
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
                    title="Event Stream (SOC-style)"
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
                            {CATEGORY_FILTERS.map(({ key, label }) => (
                                <button
                                    key={key}
                                    onClick={() => setEventFilter(key)}
                                    className={cn(
                                        'hud-filter-pill',
                                        eventFilter === key && 'hud-filter-pill-active'
                                    )}
                                >
                                    {label}
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
                                                <div
                                                    key={event.id}
                                                    className="group flex items-start gap-1.5 px-1.5 py-1 rounded-md hover:bg-white/[0.03] transition-colors"
                                                >
                                                    <div
                                                        className={SEVERITY_DOT[event.severity]}
                                                        style={{ marginTop: 3 }}
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1">
                                                            <CatIcon className="w-[11px] h-[11px] text-white/30 flex-shrink-0" />
                                                            <span className="text-[8px] font-semibold text-white/58 uppercase tracking-[0.1em]">
                                                                {CATEGORY_LABEL[event.type]}
                                                            </span>
                                                            <span className="text-[8px] text-white/25 tabular-nums ml-auto flex-shrink-0">
                                                                {event.timestamp}
                                                            </span>
                                                        </div>
                                                        <p className="text-[9px] text-white/78 leading-snug mt-0.5">
                                                            {event.label}
                                                        </p>
                                                    </div>
                                                    <Link
                                                        href={event.href}
                                                        className="text-[8px] font-medium px-1 py-0.5 rounded bg-emerald-500/[0.06] border border-emerald-500/15 text-emerald-400/55 hover:text-emerald-400 hover:border-emerald-400/30 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 mt-0.5"
                                                    >
                                                        Abrir
                                                    </Link>
                                                </div>
                                            );
                                        })}
                                        {filteredEvents.length === 0 && (
                                            <div className="text-center py-4">
                                                <p className="text-[10px] text-white/30">
                                                    Nenhum evento
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
        </div>
    );
}
