'use client';

import React from 'react';
import { Clock, User, MoreHorizontal, ChevronRight } from 'lucide-react';

type SeverityLevel = 'critical' | 'high' | 'medium' | 'low';

interface PriorityItem {
    id: string;
    title: string;
    owner: {
        name: string;
        initials?: string;
    };
    committee: string;
    daysRemaining: number;
    hoursRemaining?: number;
    severity: SeverityLevel;
}

interface WeeklyPrioritiesListProps {
    items: PriorityItem[];
    pendingCount?: number;
    className?: string;
}

const severityConfig: Record<SeverityLevel, { label: string; className: string }> = {
    critical: {
        label: 'CRÍTICO',
        className: 'intel-severity-critical'
    },
    high: {
        label: 'ALTO',
        className: 'intel-severity-high'
    },
    medium: {
        label: 'MÉDIO',
        className: 'intel-severity-medium'
    },
    low: {
        label: 'BAIXO',
        className: 'intel-severity-low'
    },
};

export function WeeklyPrioritiesList({
    items,
    pendingCount = 0,
    className = '',
}: WeeklyPrioritiesListProps) {
    // Calculate progress (mock: based on items completed vs total)
    const totalExpected = items.length + pendingCount;
    const progress = totalExpected > 0 ? ((totalExpected - items.length) / totalExpected) * 100 : 0;

    return (
        <div className={`intel-panel intel-panel-dominant p-5 ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                    <h2 className="intel-text-label">PRIORIDADES DA SEMANA</h2>
                    <div className="intel-progress-bar w-24">
                        <div
                            className="intel-progress-fill"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* Filter controls */}
                <div className="flex items-center gap-2 text-xs text-intel-text-muted">
                    <span className="flex items-center gap-1.5">
                        <span className="text-intel-text-secondary font-medium">RETUA DE</span>
                        <span className="font-bold text-intel-text-primary">5.3 ponto</span>
                    </span>
                    <div className="intel-divider-vertical h-3 mx-2" />
                    <span className="flex items-center gap-1.5">
                        <span className="font-bold text-intel-text-primary">2.2</span>
                        <span>monitore</span>
                    </span>
                    <div className="intel-divider-vertical h-3 mx-3" />
                    <button className="px-2 py-0.5 rounded bg-intel-bg-elevated text-intel-text-secondary hover:text-intel-text-primary transition-colors">
                        Crítico
                    </button>
                    <button className="px-2 py-0.5 rounded text-intel-text-muted hover:text-intel-text-secondary transition-colors">
                        Live
                    </button>
                </div>
            </div>

            {/* Priority items */}
            <div className="space-y-1">
                {items.map((item, index) => {
                    const config = severityConfig[item.severity];

                    return (
                        <div
                            key={item.id}
                            className="group flex items-center gap-4 p-3 -mx-1 rounded-lg intel-hover-subtle cursor-pointer"
                        >
                            {/* Severity tag */}
                            <div className={`intel-chip ${config.className} min-w-[70px] justify-center`}>
                                {config.label}
                            </div>

                            {/* Title and owner */}
                            <div className="flex-1 min-w-0">
                                <h3 className="text-sm font-medium text-intel-text-primary truncate">
                                    {item.title}
                                </h3>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-4 h-4 rounded-full bg-intel-bg-elevated border border-intel-border-subtle flex items-center justify-center">
                                            <User className="w-2.5 h-2.5 text-intel-text-muted" />
                                        </div>
                                        <span className="text-xs text-intel-text-muted">{item.owner.name}</span>
                                    </div>
                                    <span className="text-intel-text-muted">•</span>
                                    <span className="text-xs text-intel-text-muted">{item.committee}</span>
                                </div>
                            </div>

                            {/* Time remaining */}
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1.5 text-xs text-intel-text-secondary">
                                    <Clock className="w-3.5 h-3.5 text-intel-text-muted" />
                                    <span>{item.daysRemaining} mês</span>
                                </div>
                                <div className={`px-2 py-0.5 rounded text-xs font-medium ${item.daysRemaining <= 3
                                        ? 'bg-intel-accent-amberMuted text-intel-accent-amber'
                                        : 'bg-intel-bg-elevated text-intel-text-secondary'
                                    }`}>
                                    + {item.daysRemaining} dias
                                </div>

                                {/* Actions */}
                                <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-intel-bg-elevated transition-all">
                                    <MoreHorizontal className="w-4 h-4 text-intel-text-muted" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            {pendingCount > 0 && (
                <div className="mt-3 pt-3 border-t border-intel-border-subtle">
                    <button className="flex items-center gap-2 text-xs text-intel-text-muted hover:text-intel-text-secondary transition-colors group">
                        <span>★ {pendingCount} itens pendentes de menor prioridade</span>
                        <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                </div>
            )}
        </div>
    );
}
