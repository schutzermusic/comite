'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
    History,
    Vote,
    FileCheck,
    PlayCircle,
    StopCircle,
    FileText,
    Send,
    PenSquare,
    ArrowRightLeft,
    ClipboardCheck,
    Gavel,
    ListChecks,
    ChevronDown,
    ChevronUp,
    type LucideIcon,
} from 'lucide-react';
import { AuditTrailEntry } from '@/lib/types';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

interface AuditTrailTimelineProps {
    entries: AuditTrailEntry[];
    maxVisible?: number;
}

const ACTION_CONFIGS: Record<AuditTrailEntry['action'], {
    icon: LucideIcon;
    colorClass: string;
    bgClass: string;
    label: string;
}> = {
    'status_changed':       { icon: History,          colorClass: 'text-ig-info',    bgClass: 'bg-[color-mix(in_oklab,var(--ig-info)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-info)_28%,transparent)]',    label: 'Status Alterado' },
    'field_edited':         { icon: PenSquare,         colorClass: 'text-ig-info',    bgClass: 'bg-[color-mix(in_oklab,var(--ig-info)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-info)_28%,transparent)]',    label: 'Campo Editado' },
    'vote_cast':            { icon: Vote,              colorClass: 'text-ig-accent',  bgClass: 'bg-ig-accent-weak border-ig-border-focus',                                                                                  label: 'Voto Registrado' },
    'voting_started':       { icon: PlayCircle,        colorClass: 'text-ig-success', bgClass: 'bg-[color-mix(in_oklab,var(--ig-success)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)]', label: 'Votação Iniciada' },
    'voting_closed':        { icon: StopCircle,        colorClass: 'text-ig-warning', bgClass: 'bg-[color-mix(in_oklab,var(--ig-warning)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)]', label: 'Votação Encerrada' },
    'evidence_added':       { icon: FileCheck,         colorClass: 'text-ig-info',    bgClass: 'bg-[color-mix(in_oklab,var(--ig-info)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-info)_28%,transparent)]',    label: 'Evidência Adicionada' },
    'review_requested':     { icon: Send,              colorClass: 'text-ig-accent',  bgClass: 'bg-ig-accent-weak border-ig-border-focus',                                                                                  label: 'Revisão Solicitada' },
    'stage_transitioned':   { icon: ArrowRightLeft,    colorClass: 'text-ig-success', bgClass: 'bg-[color-mix(in_oklab,var(--ig-success)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)]', label: 'Transição de Etapa' },
    'minutes_generated':    { icon: FileText,          colorClass: 'text-ig-success', bgClass: 'bg-[color-mix(in_oklab,var(--ig-success)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)]', label: 'Ata Gerada' },
    'minutes_published':    { icon: ClipboardCheck,    colorClass: 'text-ig-success', bgClass: 'bg-[color-mix(in_oklab,var(--ig-success)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_28%,transparent)]', label: 'Ata Publicada' },
    'decision_issued':      { icon: Gavel,             colorClass: 'text-ig-warning', bgClass: 'bg-[color-mix(in_oklab,var(--ig-warning)_16%,transparent)] border-[color-mix(in_oklab,var(--ig-warning)_28%,transparent)]', label: 'Decisão Emitida' },
    'execution_task_created':{ icon: ListChecks,       colorClass: 'text-ig-accent',  bgClass: 'bg-ig-accent-weak border-ig-border-focus',                                                                                  label: 'Ação de Execução Criada' },
};

export function AuditTrailTimeline({ entries, maxVisible = 5 }: AuditTrailTimelineProps) {
    const [expanded, setExpanded] = React.useState(false);

    const sortedEntries = [...entries].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const visibleEntries = expanded ? sortedEntries : sortedEntries.slice(0, maxVisible);
    const hasMore = sortedEntries.length > maxVisible;

    if (entries.length === 0) {
        return (
            <div className="py-6 text-center rounded-lg border border-dashed border-ig-border bg-ig-panel/50">
                <History className="w-8 h-8 mx-auto mb-2 text-ig-fg-subtle" />
                <p className="text-xs text-ig-fg-subtle">Nenhuma atividade registrada</p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <h4 className="text-xs font-semibold text-ig-fg-strong uppercase tracking-wide flex items-center gap-2">
                <History className="w-3.5 h-3.5" />
                Trilha de Auditoria
            </h4>

            <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-0 bottom-0 w-px bg-ig-border-subtle" />

                <div className="space-y-3">
                    {visibleEntries.map((entry, index) => {
                        const config = ACTION_CONFIGS[entry.action] ?? {
                            icon: History,
                            colorClass: 'text-ig-fg-muted',
                            bgClass: 'bg-ig-panel border-ig-border',
                            label: entry.action,
                        };
                        const Icon = config.icon;
                        const isFirst = index === 0;

                        return (
                            <div key={entry.id} className="relative flex gap-3">
                                {/* Timeline dot */}
                                <div
                                    className={cn(
                                        'relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0 border',
                                        config.bgClass,
                                        isFirst && 'ring-2 ring-ig-bg-canvas ring-offset-0'
                                    )}
                                >
                                    <Icon className={cn('w-3 h-3', config.colorClass)} />
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0 pb-3">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span className={cn('text-xs font-medium', config.colorClass)}>
                                            {config.label}
                                        </span>
                                        <span className="text-[10px] text-ig-fg-subtle">•</span>
                                        <span className="text-[10px] text-ig-fg-subtle">
                                            {format(new Date(entry.timestamp), 'dd MMM, HH:mm', { locale: pt })}
                                        </span>
                                    </div>
                                    <p className="text-sm text-ig-fg line-clamp-2">
                                        {entry.description}
                                    </p>
                                    <p className="text-[10px] text-ig-fg-subtle mt-0.5">
                                        por {entry.userName}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {hasMore && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1.5 text-xs text-ig-accent hover:text-ig-accent/80 transition-colors mx-auto"
                >
                    {expanded ? (
                        <><ChevronUp className="w-3.5 h-3.5" />Mostrar menos</>
                    ) : (
                        <><ChevronDown className="w-3.5 h-3.5" />Ver mais {sortedEntries.length - maxVisible} atividades</>
                    )}
                </button>
            )}
        </div>
    );
}
