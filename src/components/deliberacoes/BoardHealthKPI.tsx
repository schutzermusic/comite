'use client';

import React from 'react';
import { DeliberationItem } from '@/lib/types';
import {
    FolderOpen,
    SearchCheck,
    Vote,
    ClipboardCheck,
    PlayCircle,
    CheckCircle2,
    AlertTriangle,
    Gauge,
    Timer,
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
    getValue: (items: DeliberationItem[]) => number | string;
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
        id: 'in_review',
        label: 'Decisões em revisão',
        icon: SearchCheck,
        variant: 'warning',
        getValue: (items) => items.filter((item) => item.deliberationStatus === 'in_review').length,
    },
    {
        id: 'in_voting',
        label: 'Em votação',
        icon: Vote,
        variant: 'default',
        getValue: (items) => items.filter((item) => item.deliberationStatus === 'in_voting').length,
    },
    {
        id: 'awaiting_minutes',
        label: 'Aguardando Ata',
        icon: ClipboardCheck,
        variant: 'warning',
        getValue: (items) => items.filter((item) => item.deliberationStatus === 'awaiting_minutes').length,
    },
    {
        id: 'in_execution',
        label: 'Em Execução',
        icon: PlayCircle,
        variant: 'info',
        getValue: (items) => items.filter((item) => item.deliberationStatus === 'in_execution').length,
    },
    {
        id: 'resolved_30d',
        label: 'Concluídas (30d)',
        icon: CheckCircle2,
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
        id: 'overdue',
        label: 'Atrasadas',
        icon: AlertTriangle,
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
        id: 'avg_sla',
        label: 'SLA médio',
        icon: Gauge,
        variant: 'info',
        getValue: (items) => {
            const withDue = items.filter((item) => item.dueDate && !['closed', 'resolved'].includes(item.deliberationStatus));
            if (withDue.length === 0) return '0h';
            const now = Date.now();
            const avgHours = Math.round(
                withDue.reduce((total, item) => total + Math.max(0, new Date(item.dueDate as Date).getTime() - now), 0) /
                withDue.length /
                (60 * 60 * 1000)
            );
            return avgHours >= 24 ? `${Math.round(avgHours / 24)}d` : `${avgHours}h`;
        },
    },
    {
        id: 'avg_resolution',
        label: 'Tempo médio',
        icon: Timer,
        variant: 'success',
        getValue: (items) => {
            const resolved = items.filter((item) => item.resolvedAt);
            if (resolved.length === 0) return '0d';
            const avgDays = Math.max(1, Math.round(
                resolved.reduce((total, item) => {
                    const start = new Date(item.submittedAt ?? item.createdAt).getTime();
                    const end = new Date(item.resolvedAt as Date).getTime();
                    return total + Math.max(0, end - start);
                }, 0) /
                resolved.length /
                (24 * 60 * 60 * 1000)
            ));
            return `${avgDays}d`;
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
            tintValue: typeof value === 'number' ? value > 0 : !['0h', '0d'].includes(value),
            active: isActive,
            onClick: () => onFilterClick(isActive ? null : cfg.id),
        };
    });

    return <HudKpiStrip kpis={kpis} columns={6} size="sm" connected />;
}
