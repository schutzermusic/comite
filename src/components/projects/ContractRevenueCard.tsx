'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
    DollarSign,
    ExternalLink,
    TrendingUp,
    Receipt,
} from 'lucide-react';
import { HUDCard } from '@/components/ui/hud-card';
import { Button } from '@/components/ui/button';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { formatMoney } from '@/lib/utils/project-utils';

// ── Helpers ─────────────────────────────────────────────────────

function pct(part: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min((part / total) * 100, 100);
}

function fmtPct(value: number): string {
    return `${value.toFixed(1)}%`;
}

// ── Props ───────────────────────────────────────────────────────

interface ContractRevenueCardProps {
    project: ProjectV2;
    onTabChange?: (tab: string) => void;
}

// ── Component ───────────────────────────────────────────────────

export function ContractRevenueCard({ project, onTabChange }: ContractRevenueCardProps) {
    const router = useRouter();
    const rev = project.revenue;

    // Compute values from revenue or legacy fields
    const { totalCents, billedCents, toBillCents, billedPct, toBillPct } = useMemo(() => {
        const total = rev?.totalContracted?.amountCents ?? (project as any).valor_total_cents ?? 0;
        const billed = rev?.billed?.amountCents ?? 0;
        const toBill = Math.max(total - billed, 0);
        return {
            totalCents: total,
            billedCents: billed,
            toBillCents: toBill,
            billedPct: pct(billed, total),
            toBillPct: pct(toBill, total),
        };
    }, [rev, project]);

    // Skip render if no revenue data
    if (totalCents === 0) return null;

    const contractId = project.contract_id;

    const handleBarClick = (segment: 'billed' | 'toBill') => {
        if (segment === 'billed') {
            onTabChange?.('finance');
            setTimeout(() => {
                document.getElementById('project-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        } else {
            if (contractId) {
                router.push(`/contratos/${contractId}`);
            } else {
                onTabChange?.('finance');
                setTimeout(() => {
                    document.getElementById('project-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        }
    };

    return (
        <HUDCard>
            {/* ── Header ────────────────────────── */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                    <div
                        className="p-1.5 rounded-lg"
                        style={{ background: 'rgba(0,200,255,0.12)' }}
                    >
                        <Receipt className="w-4 h-4 text-[#00C8FF]" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white orion-text-heading leading-tight">
                            Receita do Contrato
                        </h3>
                        <p className="text-[10px] text-[rgba(255,255,255,0.40)] leading-tight">
                            Total vs Faturado vs A Faturar
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Radial + Stacked Bar ────────────────────────── */}
            <div className="flex items-center gap-5">

                {/* ── Radial Ring ── */}
                <div className="relative flex-shrink-0">
                    <svg width="80" height="80" viewBox="0 0 80 80">
                        {/* Grid circle (background) */}
                        <circle
                            cx="40" cy="40" r="32"
                            fill="none"
                            stroke="rgba(255,255,255,0.06)"
                            strokeWidth="6"
                        />
                        {/* Progress arc */}
                        <circle
                            cx="40" cy="40" r="32"
                            fill="none"
                            stroke="#00FFB4"
                            strokeWidth="6"
                            strokeLinecap="round"
                            strokeDasharray={`${(billedPct / 100) * 2 * Math.PI * 32} ${2 * Math.PI * 32}`}
                            transform="rotate(-90 40 40)"
                            style={{
                                filter: 'drop-shadow(0 0 4px rgba(0,255,180,0.4))',
                                transition: 'stroke-dasharray 0.6s ease',
                            }}
                        />
                        {/* Remaining arc (toBill) */}
                        <circle
                            cx="40" cy="40" r="32"
                            fill="none"
                            stroke="rgba(255,184,77,0.35)"
                            strokeWidth="6"
                            strokeLinecap="round"
                            strokeDasharray={`${(toBillPct / 100) * 2 * Math.PI * 32} ${2 * Math.PI * 32}`}
                            strokeDashoffset={`${-(billedPct / 100) * 2 * Math.PI * 32}`}
                            transform="rotate(-90 40 40)"
                            style={{ transition: 'stroke-dasharray 0.6s ease' }}
                        />
                    </svg>
                    {/* Center text */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-sm font-bold text-white tabular-nums leading-none">
                            {fmtPct(billedPct)}
                        </span>
                        <span className="text-[8px] text-[rgba(255,255,255,0.45)] mt-0.5">
                            FATURADO
                        </span>
                    </div>
                </div>

                {/* ── Stacked Bar + Labels ── */}
                <div className="flex-1 space-y-3">
                    {/* Bar */}
                    <div className="relative w-full h-7 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                        {/* Subtle grid lines */}
                        {[25, 50, 75].map(p => (
                            <div
                                key={p}
                                className="absolute top-0 bottom-0 w-px"
                                style={{ left: `${p}%`, background: 'rgba(255,255,255,0.06)' }}
                            />
                        ))}
                        {/* Faturado segment */}
                        <div
                            className="absolute top-0 bottom-0 left-0 rounded-l-full cursor-pointer transition-all duration-500 hover:brightness-125"
                            style={{
                                width: `${billedPct}%`,
                                background: 'linear-gradient(90deg, #00C8FF 0%, #00FFB4 100%)',
                                boxShadow: '0 0 12px rgba(0,255,180,0.25)',
                            }}
                            onClick={() => handleBarClick('billed')}
                            title="Faturado — clique para ver detalhes financeiros"
                        >
                            {billedPct > 18 && (
                                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[#050D0A] tabular-nums">
                                    {fmtPct(billedPct)}
                                </span>
                            )}
                        </div>
                        {/* A Faturar segment */}
                        <div
                            className="absolute top-0 bottom-0 cursor-pointer transition-all duration-500 hover:brightness-125"
                            style={{
                                left: `${billedPct}%`,
                                width: `${toBillPct}%`,
                                background: 'linear-gradient(90deg, rgba(255,184,77,0.50) 0%, rgba(255,184,77,0.25) 100%)',
                                borderLeft: billedPct > 0 ? '1px solid rgba(255,255,255,0.15)' : 'none',
                            }}
                            onClick={() => handleBarClick('toBill')}
                            title="A Faturar — clique para ver contrato"
                        >
                            {toBillPct > 18 && (
                                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-[rgba(255,255,255,0.85)] tabular-nums">
                                    {fmtPct(toBillPct)}
                                </span>
                            )}
                        </div>
                        {/* Progress marker */}
                        <div
                            className="absolute top-0 bottom-0 w-0.5"
                            style={{
                                left: `${billedPct}%`,
                                background: 'rgba(255,255,255,0.5)',
                                boxShadow: '0 0 4px rgba(255,255,255,0.3)',
                            }}
                        />
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-4 text-[11px]">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: '#00FFB4', boxShadow: '0 0 4px rgba(0,255,180,0.5)' }} />
                            <span className="text-[rgba(255,255,255,0.55)]">Faturado</span>
                            <span className="font-semibold text-white tabular-nums">
                                {rev ? formatMoney(rev.billed, true) : '—'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: '#FFB84D', boxShadow: '0 0 4px rgba(255,184,77,0.5)' }} />
                            <span className="text-[rgba(255,255,255,0.55)]">A Faturar</span>
                            <span className="font-semibold text-white tabular-nums">
                                {rev ? formatMoney(rev.toBill, true) : '—'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── KPI Row ────────────────────────── */}
            <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)] grid grid-cols-3 gap-3 text-center">
                <div>
                    <p className="text-[10px] text-[rgba(255,255,255,0.40)] mb-0.5">
                        Contrato Total
                    </p>
                    <p className="text-sm font-bold text-white tabular-nums">
                        {rev ? formatMoney(rev.totalContracted, true) : '—'}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] text-[rgba(255,255,255,0.40)] mb-0.5">
                        Faturado
                    </p>
                    <p className="text-sm font-bold text-[#00FFB4] tabular-nums">
                        {rev ? formatMoney(rev.billed, true) : '—'}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] text-[rgba(255,255,255,0.40)] mb-0.5">
                        A Faturar
                    </p>
                    <p className="text-sm font-bold text-[#FFB84D] tabular-nums">
                        {rev ? formatMoney(rev.toBill, true) : '—'}
                    </p>
                </div>
            </div>

            {/* ── Footer CTAs ────────────────────────── */}
            <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                <p className="text-[9px] text-[rgba(255,255,255,0.25)]">
                    Fonte: Contrato · {rev?.updatedAt
                        ? new Date(rev.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                        : '—'}
                </p>
                <div className="flex items-center gap-2">
                    {contractId && (
                        <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[10px] border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                            onClick={() => router.push(`/contratos/${contractId}`)}
                        >
                            Abrir Contrato
                            <ExternalLink className="w-3 h-3 ml-1" />
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px] border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.65)] hover:bg-[rgba(255,255,255,0.06)] hover:text-white"
                        onClick={() => {
                            onTabChange?.('finance');
                            setTimeout(() => {
                                document.getElementById('project-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 100);
                        }}
                    >
                        Ver Financeiro
                        <TrendingUp className="w-3 h-3 ml-1" />
                    </Button>
                </div>
            </div>
        </HUDCard>
    );
}
