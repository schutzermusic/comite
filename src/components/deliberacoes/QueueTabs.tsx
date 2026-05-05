'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { DeliberationStatus } from '@/lib/types';
import {
    FileText,
    Send,
    SearchCheck,
    Vote,
    ClipboardCheck,
    PlayCircle,
    Lock,
    ChevronRight,
    type LucideIcon,
} from 'lucide-react';

interface QueueTabsProps {
    activeQueue: DeliberationStatus;
    onQueueChange: (queue: DeliberationStatus) => void;
    counts: Record<DeliberationStatus, number>;
    overdueByStatus?: Partial<Record<DeliberationStatus, number>>;
}

interface QueueConfig {
    id: DeliberationStatus;
    label: string;
    icon: LucideIcon;
    activeClass: string;
    dotClass: string;
}

const queueConfig: QueueConfig[] = [
    {
        id: 'draft',
        label: 'Rascunho',
        icon: FileText,
        activeClass: 'border-l-ig-fg-muted bg-ig-panel text-ig-fg-strong',
        dotClass: 'bg-ig-fg-muted',
    },
    {
        id: 'submitted',
        label: 'Submetidas',
        icon: Send,
        activeClass: 'border-l-ig-info bg-[color-mix(in_oklab,var(--ig-info)_8%,transparent)] text-ig-info',
        dotClass: 'bg-ig-info',
    },
    {
        id: 'in_review',
        label: 'Em Revisão',
        icon: SearchCheck,
        activeClass: 'border-l-ig-warning bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] text-ig-warning',
        dotClass: 'bg-ig-warning',
    },
    {
        id: 'in_voting',
        label: 'Em Votação',
        icon: Vote,
        activeClass: 'border-l-ig-accent bg-ig-accent-weak text-ig-accent',
        dotClass: 'bg-ig-accent',
    },
    {
        id: 'awaiting_minutes',
        label: 'Aguardando Ata',
        icon: ClipboardCheck,
        activeClass: 'border-l-ig-success bg-[color-mix(in_oklab,var(--ig-success)_8%,transparent)] text-ig-success',
        dotClass: 'bg-ig-success',
    },
    {
        id: 'in_execution',
        label: 'Em Execução',
        icon: PlayCircle,
        activeClass: 'border-l-ig-warning bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] text-ig-warning',
        dotClass: 'bg-ig-warning',
    },
    {
        id: 'closed',
        label: 'Encerradas',
        icon: Lock,
        activeClass: 'border-l-ig-fg-subtle bg-ig-panel text-ig-fg-muted',
        dotClass: 'bg-ig-fg-subtle',
    },
];

export function QueueTabs({ activeQueue, onQueueChange, counts, overdueByStatus }: QueueTabsProps) {
    return (
        <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-ig-border">
            {queueConfig.map((queue, index) => {
                const Icon = queue.icon;
                const isActive = activeQueue === queue.id;
                const count = counts[queue.id] || 0;
                const hasOverdue = overdueByStatus ? (overdueByStatus[queue.id] ?? 0) > 0 : false;
                const isLast = index === queueConfig.length - 1;

                return (
                    <React.Fragment key={queue.id}>
                        <button
                            onClick={() => onQueueChange(queue.id)}
                            className={cn(
                                'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap relative',
                                'border-l-2',
                                isActive
                                    ? queue.activeClass
                                    : 'border-l-transparent text-ig-fg-muted hover:text-ig-fg-strong hover:bg-ig-panel-hover'
                            )}
                        >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span>{queue.label}</span>

                            {count > 0 && (
                                <span
                                    className={cn(
                                        'min-w-[18px] px-1.5 py-0.5 text-[10px] rounded-full font-semibold text-center tabular-nums',
                                        isActive
                                            ? 'bg-[rgba(0,0,0,0.18)] text-current'
                                            : 'bg-ig-panel text-ig-fg-muted border border-ig-border'
                                    )}
                                >
                                    {count}
                                </span>
                            )}

                            {hasOverdue && (
                                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-ig-danger animate-pulse" />
                            )}
                        </button>

                        {!isLast && (
                            <ChevronRight className="w-3 h-3 shrink-0 text-ig-fg-subtle opacity-40" />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}
