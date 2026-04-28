'use client';

import React from 'react';
import { DeliberationItem } from '@/lib/types';
import {
    Vote,
    FolderOpen,
    Clock,
    CheckCircle,
    TimerReset,
    type LucideIcon,
} from 'lucide-react';
import { HudKpiStrip, type KpiItem, type HudKpiVariant } from '@/components/hud';

interface BoardHealthKPIProps {
    items: DeliberationItem[];
    activeFilter: string | null;
    onFilterClick: (filter: string | null) => void;
}

interface KPIConfig {
    id: string;
    label: string;
    icon: LucideIcon;
    variant: HudKpiVariant;
    getValue: (items: DeliberationItem[]) => number;
}

const kpiConfigs: KPIConfig[] = [
    {
        id: 'open',
        label: 'Abertas',
        icon: FolderOpen,
        variant: 'info',
        getValue: (items) => items.filter((item) =>
            ['draft', 'submitted', 'in_review', 'in_voting', 'awaiting_minutes', 'in_execution'].includes(item.deliberationStatus)
        ).length,
    },
    {
        id: 'in_voting',
        label: 'Em Votação',
        icon: Vote,
        variant: 'default',
        getValue: (items) => items.filter((item) => item.deliberationStatus === 'in_voting').length,
    },
    {
        id: 'overdue',
        label: 'Atrasadas',
        icon: Clock,
        variant: 'danger',
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
        variant: 'success',
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
        label: 'Tempo Médio (d)',
        icon: TimerReset,
        variant: 'warning',
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
    const kpis: KpiItem[] = kpiConfigs.map((cfg) => {
        const Icon = cfg.icon;
        const value = cfg.getValue(items);
        const isActive = activeFilter === cfg.id;
        return {
            id: cfg.id,
            label: cfg.label,
            value,
            icon: <Icon className="w-full h-full" />,
            variant: cfg.variant,
            tintValue: value > 0,
            active: isActive,
            onClick: () => onFilterClick(isActive ? null : cfg.id),
        };
    });

    return <HudKpiStrip kpis={kpis} columns={5} size="sm" connected />;
}
