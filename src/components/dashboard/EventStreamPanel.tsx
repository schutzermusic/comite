'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
    ChevronDown,
    ChevronUp,
    AlertTriangle,
    FileText,
    Briefcase,
    Vote,
    Shield,
    ExternalLink,
    Settings2,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type EventSeverity = 'critical' | 'warning' | 'info' | 'success';
export type EventCategory = 'riscos' | 'decisoes' | 'docs' | 'projetos' | 'contratos';

export interface EventItem {
    id: string;
    type: EventCategory;
    severity: EventSeverity;
    label: string;
    timestamp: string;
    href: string;
    action?: {
        label: string;
        href: string;
    };
}

interface EventStreamPanelProps {
    collapsed: boolean;
    onToggle: () => void;
    events: EventItem[];
}

const CATEGORY_FILTERS: { key: 'all' | EventCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'riscos', label: 'Riscos' },
    { key: 'decisoes', label: 'Decisões' },
    { key: 'docs', label: 'Docs' },
    { key: 'projetos', label: 'Projetos' },
    { key: 'contratos', label: 'Contratos' },
];

const SEVERITY_DOT: Record<EventSeverity, string> = {
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

export function EventStreamPanel({ collapsed, onToggle, events }: EventStreamPanelProps) {
    const [filter, setFilter] = useState<'all' | EventCategory>('all');

    const filtered = events.filter((e) => filter === 'all' || e.type === filter);

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.35, ease: 'easeOut' }}
            className="ig-glass"
            data-elev="3"
        >
            <span data-ig-noise="" />
            <span data-ig-specular="" />
            <div data-ig-content="">
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 pt-3 pb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                    <span className="text-[10px] font-semibold text-orion-text-secondary uppercase tracking-wider">
                        Event Stream (SOC-style)
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <Settings2 className="w-3 h-3 text-orion-text-muted" />
                    <button
                        onClick={onToggle}
                        className="p-0.5 rounded hover:bg-white/5 transition-colors"
                        title={collapsed ? 'Expandir' : 'Recolher'}
                    >
                        {collapsed ? (
                            <ChevronDown className="w-3.5 h-3.5 text-orion-text-muted" />
                        ) : (
                            <ChevronUp className="w-3.5 h-3.5 text-orion-text-muted" />
                        )}
                    </button>
                </div>
            </div>

            <AnimatePresence initial={false}>
                {!collapsed && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                    >
                        {/* Category filters */}
                        <div className="px-3 pb-2 flex flex-wrap gap-1">
                            {CATEGORY_FILTERS.map(({ key, label }) => (
                                <button
                                    key={key}
                                    onClick={() => setFilter(key)}
                                    className={cn(
                                        'hud-filter-pill',
                                        filter === key && 'hud-filter-pill-active'
                                    )}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Event list */}
                        <div className="cr-event-stream px-2 pb-2.5 space-y-0.5">
                            <AnimatePresence initial={false}>
                                {filtered.map((event) => {
                                    const CatIcon = CATEGORY_ICON[event.type];
                                    return (
                                        <motion.div
                                            key={event.id}
                                            initial={{ opacity: 0, x: 12 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: -12 }}
                                            transition={{ duration: 0.12 }}
                                            className="group flex items-start gap-2 p-2 rounded-md hover:bg-orion-bg-elevated/40 transition-colors"
                                        >
                                            <div className={SEVERITY_DOT[event.severity]} style={{ marginTop: 4 }} />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[8px] font-semibold text-orion-text-muted uppercase">
                                                        {event.type === 'decisoes' ? 'Decisão' : event.type === 'contratos' ? 'Contrato' : event.type.charAt(0).toUpperCase() + event.type.slice(1, -1)}
                                                    </span>
                                                    <span className="text-[8px] text-orion-text-muted tabular-nums">{event.timestamp}</span>
                                                </div>
                                                <p className="text-[10px] text-orion-text-secondary leading-snug mt-0.5">
                                                    {event.label}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1">
                                                {event.action ? (
                                                    <Link
                                                        href={event.action.href}
                                                        className="text-[8px] font-medium text-emerald-400 hover:text-emerald-300"
                                                    >
                                                        {event.action.label}
                                                    </Link>
                                                ) : (
                                                    <Link href={event.href} className="text-[8px] font-medium text-emerald-400/60 hover:text-emerald-400">
                                                        Abrir
                                                    </Link>
                                                )}
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>

                            {filtered.length === 0 && (
                                <div className="text-center py-4">
                                    <p className="text-[10px] text-orion-text-muted">Nenhum evento</p>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            </div>
        </motion.div>
    );
}
