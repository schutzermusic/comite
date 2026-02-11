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
    ChevronUp
} from 'lucide-react';
import { AuditTrailEntry } from '@/lib/types';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

interface AuditTrailTimelineProps {
    entries: AuditTrailEntry[];
    maxVisible?: number;
}

const getActionConfig = (action: AuditTrailEntry['action']) => {
    const configs: Record<AuditTrailEntry['action'], { icon: React.ElementType; color: string; label: string }> = {
        'status_changed': { icon: History, color: '#00C8FF', label: 'Status Alterado' },
        'field_edited': { icon: PenSquare, color: '#00C8FF', label: 'Campo Editado' },
        'vote_cast': { icon: Vote, color: '#A855F7', label: 'Voto Registrado' },
        'voting_started': { icon: PlayCircle, color: '#00FFB4', label: 'Votação Iniciada' },
        'voting_closed': { icon: StopCircle, color: '#FFB04D', label: 'Votação Encerrada' },
        'evidence_added': { icon: FileCheck, color: '#00C8FF', label: 'Evidência Adicionada' },
        'review_requested': { icon: Send, color: '#A855F7', label: 'Revisão Solicitada' },
        'stage_transitioned': { icon: ArrowRightLeft, color: '#4ADE80', label: 'Transição de Etapa' },
        'minutes_generated': { icon: FileText, color: '#00FFB4', label: 'Ata Gerada' },
        'minutes_published': { icon: ClipboardCheck, color: '#00FFB4', label: 'Ata Publicada' },
        'decision_issued': { icon: Gavel, color: '#F59E0B', label: 'Decisão Emitida' },
        'execution_task_created': { icon: ListChecks, color: '#C084FC', label: 'Ação de Execução Criada' },
    };
    return configs[action] || { icon: History, color: 'rgba(255,255,255,0.65)', label: action };
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
            <div className="py-6 text-center rounded-lg border border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)]">
                <History className="w-8 h-8 mx-auto mb-2 text-[rgba(255,255,255,0.2)]" />
                <p className="text-xs text-[rgba(255,255,255,0.45)]">
                    Nenhuma atividade registrada
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <h4 className="text-xs font-semibold text-[rgba(255,255,255,0.85)] uppercase tracking-wide flex items-center gap-2">
                <History className="w-3.5 h-3.5" />
                Trilha de Auditoria
            </h4>

            <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[11px] top-0 bottom-0 w-px bg-[rgba(255,255,255,0.08)]" />

                <div className="space-y-3">
                    {visibleEntries.map((entry, index) => {
                        const config = getActionConfig(entry.action);
                        const Icon = config.icon;
                        const isFirst = index === 0;

                        return (
                            <div key={entry.id} className="relative flex gap-3">
                                {/* Timeline dot */}
                                <div
                                    className={cn(
                                        "relative z-10 w-6 h-6 rounded-full flex items-center justify-center shrink-0",
                                        isFirst ? "ring-2 ring-offset-2 ring-offset-[#050D0A]" : ""
                                    )}
                                    style={{
                                        backgroundColor: `${config.color}20`,
                                        borderColor: config.color,
                                        ringColor: isFirst ? config.color : 'transparent'
                                    }}
                                >
                                    <Icon className="w-3 h-3" style={{ color: config.color }} />
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0 pb-3">
                                    <div className="flex items-center gap-2 mb-0.5">
                                        <span
                                            className="text-xs font-medium"
                                            style={{ color: config.color }}
                                        >
                                            {config.label}
                                        </span>
                                        <span className="text-[10px] text-[rgba(255,255,255,0.35)]">•</span>
                                        <span className="text-[10px] text-[rgba(255,255,255,0.45)]">
                                            {format(new Date(entry.timestamp), "dd MMM, HH:mm", { locale: pt })}
                                        </span>
                                    </div>
                                    <p className="text-sm text-[rgba(255,255,255,0.75)] line-clamp-2">
                                        {entry.description}
                                    </p>
                                    <p className="text-[10px] text-[rgba(255,255,255,0.45)] mt-0.5">
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
                    className="flex items-center gap-1.5 text-xs text-[#00C8FF] hover:text-[#00A8D9] transition-colors mx-auto"
                >
                    {expanded ? (
                        <>
                            <ChevronUp className="w-3.5 h-3.5" />
                            Mostrar menos
                        </>
                    ) : (
                        <>
                            <ChevronDown className="w-3.5 h-3.5" />
                            Ver mais {sortedEntries.length - maxVisible} atividades
                        </>
                    )}
                </button>
            )}
        </div>
    );
}
