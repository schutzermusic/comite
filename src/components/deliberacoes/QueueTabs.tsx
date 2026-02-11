'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { DeliberationStatus } from '@/lib/types';
import {
    FileText,
    Send,
    SearchCheck,
    Vote,
    CheckCircle,
    ClipboardCheck,
    PlayCircle,
    Lock
} from 'lucide-react';

interface QueueTabsProps {
    activeQueue: DeliberationStatus;
    onQueueChange: (queue: DeliberationStatus) => void;
    counts: Record<DeliberationStatus, number>;
}

const queueConfig: Array<{
    id: DeliberationStatus;
    label: string;
    icon: React.ElementType;
    color: string;
}> = [
        { id: 'draft', label: 'Rascunho', icon: FileText, color: 'rgba(255,255,255,0.65)' },
        { id: 'submitted', label: 'Submetidas', icon: Send, color: '#00C8FF' },
        { id: 'in_review', label: 'Em Revisão', icon: SearchCheck, color: '#FFB04D' },
        { id: 'in_voting', label: 'Em Votação', icon: Vote, color: '#A855F7' },
        { id: 'awaiting_minutes', label: 'Aguardando Atas', icon: ClipboardCheck, color: '#4ADE80' },
        { id: 'resolved', label: 'Resolvidas', icon: CheckCircle, color: '#00FFB4' },
        { id: 'in_execution', label: 'Em Execução', icon: PlayCircle, color: '#F59E0B' },
        { id: 'closed', label: 'Encerradas', icon: Lock, color: 'rgba(255,255,255,0.45)' },
    ];

export function QueueTabs({ activeQueue, onQueueChange, counts }: QueueTabsProps) {
    return (
        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[rgba(255,255,255,0.1)]">
            {queueConfig.map((queue) => {
                const Icon = queue.icon;
                const isActive = activeQueue === queue.id;
                const count = counts[queue.id] || 0;

                return (
                    <button
                        key={queue.id}
                        onClick={() => onQueueChange(queue.id)}
                        className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
                            "border border-transparent",
                            isActive
                                ? "bg-[rgba(255,255,255,0.08)] border-[rgba(255,255,255,0.12)] text-white"
                                : "text-[rgba(255,255,255,0.55)] hover:text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.04)]"
                        )}
                    >
                        <Icon
                            className="w-3.5 h-3.5"
                            style={{ color: isActive ? queue.color : 'inherit' }}
                        />
                        <span>{queue.label}</span>
                        {count > 0 && (
                            <span
                                className={cn(
                                    "ml-1 px-1.5 py-0.5 text-[10px] rounded-full font-semibold min-w-[18px] text-center",
                                    isActive
                                        ? "bg-[rgba(255,255,255,0.15)] text-white"
                                        : "bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.65)]"
                                )}
                            >
                                {count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
