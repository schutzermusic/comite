'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { DeliberationItem } from '@/lib/types';
import {
    Vote,
    FolderOpen,
    Clock,
    CheckCircle,
    TimerReset
} from 'lucide-react';

interface BoardHealthKPIProps {
    items: DeliberationItem[];
    activeFilter: string | null;
    onFilterClick: (filter: string | null) => void;
}

interface KPIConfig {
    id: string;
    label: string;
    icon: React.ElementType;
    color: string;
    bgColor: string;
    getValue: (items: DeliberationItem[]) => number;
}

const kpiConfigs: KPIConfig[] = [
    {
        id: 'open',
        label: 'Abertas',
        icon: FolderOpen,
        color: '#00C8FF',
        bgColor: 'rgba(0,200,255,0.12)',
        getValue: (items) => items.filter((item) =>
            ['draft', 'submitted', 'in_review', 'in_voting', 'awaiting_minutes', 'in_execution'].includes(item.deliberationStatus)
        ).length,
    },
    {
        id: 'in_voting',
        label: 'Em Votação',
        icon: Vote,
        color: '#A855F7',
        bgColor: 'rgba(168,85,247,0.12)',
        getValue: (items) => items.filter((item) => item.deliberationStatus === 'in_voting').length,
    },
    {
        id: 'overdue',
        label: 'Atrasadas',
        icon: Clock,
        color: '#FF5860',
        bgColor: 'rgba(255,88,96,0.12)',
        getValue: (items) => {
            const now = new Date();
            return items.filter((item) => {
                if (!item.dueDate) return false;
                return new Date(item.dueDate).getTime() < now.getTime();
            }).length;
        },
    },
    {
        id: 'resolved_30d',
        label: 'Resolvidas (30d)',
        icon: CheckCircle,
        color: '#00FFB4',
        bgColor: 'rgba(0,255,180,0.12)',
        getValue: (items) => {
            const now = new Date().getTime();
            const days30 = 30 * 24 * 60 * 60 * 1000;
            return items.filter((item) => {
                if (item.deliberationStatus !== 'resolved' && item.deliberationStatus !== 'closed') return false;
                if (!item.resolvedAt) return false;
                return now - new Date(item.resolvedAt).getTime() <= days30;
            }).length;
        },
    },
    {
        id: 'avg_resolution',
        label: 'Tempo Médio de Resolução',
        icon: TimerReset,
        color: '#F59E0B',
        bgColor: 'rgba(245,158,11,0.12)',
        getValue: (items) => {
            const resolved = items.filter((item) => item.submittedAt && item.resolvedAt);
            if (resolved.length === 0) return 0;
            const avgMs = resolved.reduce((total, item) => {
                return total + (new Date(item.resolvedAt as Date).getTime() - new Date(item.submittedAt as Date).getTime());
            }, 0) / resolved.length;
            return Math.round(avgMs / (24 * 60 * 60 * 1000));
        },
    },
];

export function BoardHealthKPI({ items, activeFilter, onFilterClick }: BoardHealthKPIProps) {
    return (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[rgba(255,255,255,0.1)]">
            {kpiConfigs.map((kpi) => {
                const Icon = kpi.icon;
                const value = kpi.getValue(items);
                const isActive = activeFilter === kpi.id;

                return (
                    <button
                        key={kpi.id}
                        onClick={() => onFilterClick(isActive ? null : kpi.id)}
                        className={cn(
                            "flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all whitespace-nowrap",
                            "border",
                            isActive
                                ? "border-current bg-current/10"
                                : "border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)]"
                        )}
                        style={{
                            borderColor: isActive ? kpi.color : undefined,
                            backgroundColor: isActive ? kpi.bgColor : undefined
                        }}
                    >
                        <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center"
                            style={{ backgroundColor: `${kpi.color}15` }}
                        >
                            <Icon className="w-4 h-4" style={{ color: kpi.color }} />
                        </div>
                        <div className="text-left">
                            <div
                                className="text-lg font-bold leading-none"
                                style={{ color: value > 0 ? kpi.color : 'rgba(255,255,255,0.35)' }}
                            >
                                {value}
                            </div>
                            <div className="text-[10px] text-[rgba(255,255,255,0.55)] mt-0.5">
                                {kpi.label}
                            </div>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
