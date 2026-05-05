'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { DeliberationItem } from '@/lib/types';
import { HudBadge } from '@/components/hud';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Clock,
    DollarSign,
    FileCheck,
    FileX,
    type LucideIcon,
} from 'lucide-react';
import { differenceInDays, differenceInHours, format } from 'date-fns';
import { pt } from 'date-fns/locale';

interface DecisionListProps {
  items: DeliberationItem[];
  selectedId?: string;
  onSelectItem: (item: DeliberationItem) => void;
}

const STATUS_META: Record<string, {
    label: string;
    nextAction: string;
    nextActionIcon: LucideIcon;
    badgeVariant: 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'default' | 'primary' | 'outline' | 'subtle';
    actionVariant: 'neutral' | 'warning' | 'info' | 'success' | 'danger';
}> = {
    draft: {
        label: 'Rascunho',
        nextAction: 'Completar e submeter',
        nextActionIcon: ArrowRight,
        badgeVariant: 'neutral',
        actionVariant: 'neutral',
    },
    submitted: {
        label: 'Submetida',
        nextAction: 'Aguardando roteamento',
        nextActionIcon: Clock,
        badgeVariant: 'info',
        actionVariant: 'info',
    },
    in_review: {
        label: 'Em Revisão',
        nextAction: 'Revisar agora',
        nextActionIcon: ArrowRight,
        badgeVariant: 'warning',
        actionVariant: 'warning',
    },
    in_voting: {
        label: 'Em Votação',
        nextAction: 'Votar agora',
        nextActionIcon: ArrowRight,
        badgeVariant: 'info',
        actionVariant: 'info',
    },
    awaiting_minutes: {
        label: 'Aguardando Ata',
        nextAction: 'Gerar ata',
        nextActionIcon: ArrowRight,
        badgeVariant: 'warning',
        actionVariant: 'warning',
    },
    resolved: {
        label: 'Resolvida',
        nextAction: 'Ver resolução',
        nextActionIcon: CheckCircle2,
        badgeVariant: 'success',
        actionVariant: 'success',
    },
    in_execution: {
        label: 'Em Execução',
        nextAction: 'Acompanhar execução',
        nextActionIcon: ArrowRight,
        badgeVariant: 'warning',
        actionVariant: 'warning',
    },
    closed: {
        label: 'Encerrada',
        nextAction: 'Arquivada',
        nextActionIcon: CheckCircle2,
        badgeVariant: 'neutral',
        actionVariant: 'neutral',
    },
    returned_for_revision: {
        label: 'Devolvida',
        nextAction: 'Corrigir e resubmeter',
        nextActionIcon: ArrowRight,
        badgeVariant: 'danger',
        actionVariant: 'danger',
    },
    withdrawn: {
        label: 'Retirada',
        nextAction: 'Retirada pelo solicitante',
        nextActionIcon: CheckCircle2,
        badgeVariant: 'neutral',
        actionVariant: 'neutral',
    },
};

const ACTION_COLORS: Record<string, string> = {
    neutral: 'text-ig-fg-muted bg-ig-panel border-ig-border',
    warning: 'text-ig-warning bg-[color-mix(in_oklab,var(--ig-warning)_8%,transparent)] border-[color-mix(in_oklab,var(--ig-warning)_22%,transparent)]',
    info: 'text-ig-info bg-[color-mix(in_oklab,var(--ig-info)_8%,transparent)] border-[color-mix(in_oklab,var(--ig-info)_22%,transparent)]',
    success: 'text-ig-success bg-[color-mix(in_oklab,var(--ig-success)_8%,transparent)] border-[color-mix(in_oklab,var(--ig-success)_22%,transparent)]',
    danger: 'text-ig-danger bg-[color-mix(in_oklab,var(--ig-danger)_8%,transparent)] border-[color-mix(in_oklab,var(--ig-danger)_22%,transparent)]',
};

const RISK_CLASSES: Record<string, string> = {
    critical: 'text-ig-danger',
    high: 'text-ig-danger',
    medium: 'text-ig-warning',
    low: 'text-ig-success',
};

const formatSLA = (dueDate?: Date) => {
    if (!dueDate) return null;
    const now = new Date();
    const hours = differenceInHours(dueDate, now);
    const days = differenceInDays(dueDate, now);

    if (hours < 0) return { text: 'Atrasado', variant: 'danger' as const, urgent: true };
    if (hours <= 24) return { text: `${hours}h restantes`, variant: 'danger' as const, urgent: true };
    if (hours <= 72) return { text: `${hours}h restantes`, variant: 'warning' as const, urgent: false };
    if (days <= 7) return { text: `${days}d restantes`, variant: 'neutral' as const, urgent: false };
    return { text: format(dueDate, 'dd MMM', { locale: pt }), variant: 'neutral' as const, urgent: false };
};

const formatCurrency = (value?: number) => {
    if (!value) return null;
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        notation: 'compact',
        maximumFractionDigits: 1,
    }).format(value);
};

const getStageProgress = (item: DeliberationItem) => {
    const stages = item.stages ?? [];
    if (stages.length === 0) return null;
    const completed = stages.filter((s) => s.status === 'completed').length;
    const current = stages.findIndex((s) => s.id === item.currentStageId) + 1;
    return { current: Math.max(current, completed), total: stages.length };
};

export function DecisionList({ items, selectedId, onSelectItem }: DecisionListProps) {
    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="w-12 h-12 rounded-full bg-ig-panel-hover flex items-center justify-center mb-3">
                    <FileX className="w-6 h-6 text-ig-fg-subtle" />
                </div>
                <p className="text-sm text-ig-fg-muted">Nenhuma deliberação encontrada para este filtro.</p>
                <p className="text-[11px] text-ig-fg-subtle mt-1">Tente outro status ou remova os filtros ativos.</p>
            </div>
        );
    }

    return (
        <div className="divide-y divide-ig-border-subtle">
            {items.map((item) => {
                const isSelected = item.id === selectedId;
                const sla = formatSLA(item.dueDate);
                const financial = formatCurrency(item.financialImpact);
                const meta = STATUS_META[item.deliberationStatus] ?? STATUS_META.draft;
                const ActionIcon = meta.nextActionIcon;
                const progress = getStageProgress(item);
                const isUrgent = sla?.urgent || item.riskLevel === 'critical';

                return (
                    <button
                        key={item.id}
                        onClick={() => onSelectItem(item)}
                        className={cn(
                            'w-full text-left px-4 py-3 transition-all relative',
                            'hover:bg-ig-panel-hover/60',
                            isSelected && 'bg-ig-accent-weak/30 border-l-2 border-l-ig-accent',
                            !isSelected && 'border-l-2 border-l-transparent',
                        )}
                    >
                        {/* Urgency indicator */}
                        {isUrgent && (
                            <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-ig-danger animate-pulse" />
                        )}

                        {/* Title row */}
                        <div className="flex items-start gap-2 mb-2 pr-4">
                            <h4 className="text-sm font-medium text-ig-fg-strong line-clamp-2 flex-1 leading-snug">
                                {item.title}
                            </h4>
                        </div>

                        {/* Committee + type + stage progress */}
                        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                            <span className="text-[10px] text-ig-fg-muted uppercase tracking-wide font-medium">
                                {item.ownerCommitteeName || item.committeeName}
                            </span>
                            {item.templateName && (
                                <HudBadge variant="info" size="sm">{item.templateName}</HudBadge>
                            )}
                            {progress && (
                                <span className="text-[10px] text-ig-fg-subtle font-mono">
                                    Etapa {progress.current}/{progress.total}
                                </span>
                            )}
                        </div>

                        {/* Status badge */}
                        <div className="mb-2.5">
                            <HudBadge variant={meta.badgeVariant} size="sm" dot>
                                {meta.label}
                            </HudBadge>
                        </div>

                        {/* Meta strip: SLA, financial, risk, evidence */}
                        <div className="flex items-center gap-3 text-[10px] flex-wrap mb-3">
                            {sla && (
                                <span className={cn(
                                    'flex items-center gap-1 font-medium',
                                    sla.variant === 'danger' && 'text-ig-danger',
                                    sla.variant === 'warning' && 'text-ig-warning',
                                    sla.variant === 'neutral' && 'text-ig-fg-muted',
                                )}>
                                    <Clock className="w-3 h-3" />
                                    {sla.text}
                                </span>
                            )}

                            {financial && (
                                <span className="flex items-center gap-1 text-ig-fg-muted">
                                    <DollarSign className="w-3 h-3" />
                                    {financial}
                                </span>
                            )}

                            {item.riskLevel && (
                                <span className={cn('flex items-center gap-1 font-semibold', RISK_CLASSES[item.riskLevel] ?? 'text-ig-fg-muted')}>
                                    <AlertTriangle className="w-3 h-3" />
                                    {item.riskLevel.toUpperCase()}
                                </span>
                            )}

                            <span className="flex items-center gap-1 text-ig-fg-subtle">
                                {item.evidenceComplete ? (
                                    <><FileCheck className="w-3 h-3 text-ig-success" /><span className="text-ig-success">Evidências OK</span></>
                                ) : (
                                    <><FileX className="w-3 h-3 text-ig-warning" /><span className="text-ig-warning">Evidências pendentes</span></>
                                )}
                            </span>
                        </div>

                        {/* Next action banner */}
                        <div className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold border',
                            ACTION_COLORS[meta.actionVariant] ?? ACTION_COLORS.neutral,
                        )}>
                            <ActionIcon className="w-3 h-3 shrink-0" />
                            <span>{meta.nextAction}</span>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
