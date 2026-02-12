'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
    X,
    Calendar,
    DollarSign,
    ExternalLink,
    FileText,
    Clock,
    GanttChart,
    Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { BillingEvent } from '@/lib/types/project-v2';
import { compactBRL } from '@/lib/utils/project-utils';

// ── Status Colors ───────────────────────────────────────────────

const STATUS_MAP: Record<BillingEvent['status'], { label: string; color: string; bg: string }> = {
    planned: { label: 'Previsto', color: '#00C8FF', bg: 'rgba(0,200,255,0.12)' },
    billed: { label: 'Faturado', color: '#00FFB4', bg: 'rgba(0,255,180,0.12)' },
    partial: { label: 'Parcial', color: '#FFB84D', bg: 'rgba(255,184,77,0.12)' },
    delayed: { label: 'Atrasado', color: '#FF4040', bg: 'rgba(255,64,64,0.12)' },
    cancelled: { label: 'Cancelado', color: '#888', bg: 'rgba(136,136,136,0.12)' },
};

// ── Props ───────────────────────────────────────────────────────

interface BillingPeriodDrawerProps {
    open: boolean;
    onClose: () => void;
    periodLabel: string;
    events: BillingEvent[];
    projectId: string;
    onTabChange?: (tab: string) => void;
}

// ── Component ───────────────────────────────────────────────────

export function BillingPeriodDrawer({
    open,
    onClose,
    periodLabel,
    events,
    projectId,
    onTabChange,
}: BillingPeriodDrawerProps) {
    const router = useRouter();

    if (!open) return null;

    const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const formatPeriod = (p: string) => {
        const [y, m] = p.split('-');
        return `${MONTHS_PT[parseInt(m, 10) - 1]} ${y}`;
    };

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                onClick={onClose}
            />
            {/* Drawer */}
            <div
                className="fixed top-0 right-0 bottom-0 w-[420px] max-w-[90vw] z-50 flex flex-col"
                style={{
                    background: 'linear-gradient(180deg, #0A1F18 0%, #050D0A 100%)',
                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.08)]">
                    <div>
                        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-[#00C8FF]" />
                            Eventos do Período
                        </h3>
                        <p className="text-xs text-[rgba(255,255,255,0.45)] mt-0.5">
                            {formatPeriod(periodLabel)} • {events.length} evento{events.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.06)]"
                        onClick={onClose}
                    >
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                {/* Events list */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
                    {events.length === 0 ? (
                        <div className="text-center py-12">
                            <Clock className="w-8 h-8 text-[rgba(255,255,255,0.15)] mx-auto mb-2" />
                            <p className="text-xs text-[rgba(255,255,255,0.35)]">
                                Nenhum evento neste período
                            </p>
                        </div>
                    ) : (
                        events.map(evt => {
                            const st = STATUS_MAP[evt.status];
                            return (
                                <div
                                    key={evt.id}
                                    className="p-4 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] space-y-3 hover:border-[rgba(255,255,255,0.12)] transition-colors"
                                >
                                    {/* Title + status */}
                                    <div className="flex items-start justify-between gap-2">
                                        <h4 className="text-sm font-medium text-white leading-snug">
                                            {evt.title}
                                        </h4>
                                        <Badge
                                            className="text-[10px] font-semibold border-0 shrink-0"
                                            style={{ background: st.bg, color: st.color }}
                                        >
                                            {st.label}
                                        </Badge>
                                    </div>

                                    {/* Dates */}
                                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                                        <div>
                                            <span className="text-[rgba(255,255,255,0.40)]">Data prevista</span>
                                            <p className="text-white font-medium mt-0.5">
                                                {new Date(evt.datePlanned).toLocaleDateString('pt-BR')}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-[rgba(255,255,255,0.40)]">Data realizada</span>
                                            <p className="text-white font-medium mt-0.5">
                                                {evt.dateActual
                                                    ? new Date(evt.dateActual).toLocaleDateString('pt-BR')
                                                    : '—'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Amounts */}
                                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                                        <div>
                                            <span className="text-[rgba(255,255,255,0.40)]">Previsto</span>
                                            <p className="text-[#FFB84D] font-semibold mt-0.5 tabular-nums">
                                                {compactBRL(evt.amountPlannedCents / 100)}
                                            </p>
                                        </div>
                                        <div>
                                            <span className="text-[rgba(255,255,255,0.40)]">Realizado</span>
                                            <p className="text-[#00FFB4] font-semibold mt-0.5 tabular-nums">
                                                {evt.amountActualCents != null
                                                    ? compactBRL(evt.amountActualCents / 100)
                                                    : '—'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Deep-link CTAs */}
                                    <div className="flex items-center gap-2 pt-1">
                                        {evt.linked.taskId && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-6 px-2 text-[10px] border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                                                onClick={() => {
                                                    onTabChange?.('timeline');
                                                    onClose();
                                                    setTimeout(() => {
                                                        document.getElementById('project-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                    }, 100);
                                                }}
                                            >
                                                <GanttChart className="w-3 h-3 mr-1" />
                                                Abrir Timeline
                                            </Button>
                                        )}
                                        {evt.linked.documentIds && evt.linked.documentIds.length > 0 && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-6 px-2 text-[10px] border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                                                onClick={() => router.push(`/documentos`)}
                                            >
                                                <FileText className="w-3 h-3 mr-1" />
                                                Ver Documento
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 px-2 text-[10px] border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                                            onClick={() => router.push(`/pautas/nova?projeto=${projectId}&ref=${evt.id}`)}
                                        >
                                            <Plus className="w-3 h-3 mr-1" />
                                            Criar Pauta
                                        </Button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                    <p className="text-[9px] text-[rgba(255,255,255,0.25)]">
                        Fonte: Eventograma de Faturamento
                    </p>
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px] border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.55)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                        onClick={onClose}
                    >
                        Fechar
                    </Button>
                </div>
            </div>
        </>
    );
}
