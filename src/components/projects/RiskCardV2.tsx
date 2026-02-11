'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
    AlertTriangle,
    ShieldCheck,
    ShieldAlert,
    Target,
    DollarSign,
    ExternalLink,
    CheckCircle2,
    XCircle,
} from 'lucide-react';
import { HUDCard } from '@/components/ui/hud-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { ProjectV2, ProjectRiskItem, RiskLevel } from '@/lib/types/project-v2';
import {
    getRiskLevelFromScore,
    getRiskLevelLabel,
    getRiskLevelColor,
    formatMoney,
} from '@/lib/utils/project-utils';

// ── Helpers ─────────────────────────────────────────────────────

function getMitigationStatusChip(risk: ProjectRiskItem): { label: string; color: string; bg: string } {
    if (risk.status === 'resolved') return { label: 'Resolvido', color: '#00FFB4', bg: 'rgba(0,255,180,0.12)' };
    if (risk.status === 'mitigating' && risk.mitigation) return { label: 'Mitigando', color: '#00C8FF', bg: 'rgba(0,200,255,0.10)' };
    if (risk.mitigation) return { label: 'Plano definido', color: '#FFB84D', bg: 'rgba(255,184,77,0.10)' };
    return { label: 'Sem mitigação', color: '#FF4040', bg: 'rgba(255,64,64,0.10)' };
}

function getFinancialExposureLevel(totalCents: number): { level: string; color: string; bg: string } {
    const reais = totalCents / 100;
    if (reais >= 5_000_000) return { level: 'Crítico', color: '#FF4040', bg: 'rgba(255,64,64,0.12)' };
    if (reais >= 2_000_000) return { level: 'Alto', color: '#FF8C42', bg: 'rgba(255,140,66,0.12)' };
    if (reais >= 500_000) return { level: 'Médio', color: '#FFB84D', bg: 'rgba(255,184,77,0.12)' };
    return { level: 'Baixo', color: '#00FFB4', bg: 'rgba(0,255,180,0.12)' };
}

// ── Component Props ─────────────────────────────────────────────

interface RiskCardV2Props {
    project: ProjectV2;
}

// ── Main Component ──────────────────────────────────────────────

export function RiskCardV2({ project }: RiskCardV2Props) {
    const router = useRouter();
    const risks = project.risks || [];

    // Computed risk metrics
    const computed = useMemo(() => {
        const openRisks = risks.filter(r => r.status !== 'resolved');
        if (openRisks.length === 0) return null;

        // Sort by score descending → top risk drives overall score
        const sorted = [...openRisks].sort((a, b) => (b.probability * b.impact) - (a.probability * a.impact));
        const topRisk = sorted[0];
        const topScore = topRisk.probability * topRisk.impact;
        const overallLevel = getRiskLevelFromScore(topScore);

        // Top contributing risks (max 3)
        const topContributing = sorted.slice(0, 3);

        // Counts
        const highCriticalCount = openRisks.filter(r => {
            const score = r.probability * r.impact;
            return score >= 11; // high + critical
        }).length;
        const noMitigationCount = openRisks.filter(r => !r.mitigation).length;

        // Financial exposure (sum of all open risks with exposure)
        const totalExposureCents = openRisks.reduce((sum, r) => sum + (r.exposure?.amountCents || 0), 0);

        return {
            topRisk,
            topScore,
            overallLevel,
            overallP: topRisk.probability,
            overallI: topRisk.impact,
            topContributing,
            highCriticalCount,
            noMitigationCount,
            totalExposureCents,
            totalOpen: openRisks.length,
        };
    }, [risks]);

    // No risks state
    if (!computed) {
        return (
            <HUDCard>
                <div className="flex items-center gap-3 py-2">
                    <div className="p-2 rounded-lg" style={{ background: 'rgba(0,255,180,0.12)' }}>
                        <ShieldCheck className="w-5 h-5 text-[#00FFB4]" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold text-white orion-text-heading">Risco Geral</h3>
                        <p className="text-xs text-[rgba(255,255,255,0.50)]">Sem riscos abertos ✓</p>
                    </div>
                </div>
            </HUDCard>
        );
    }

    const levelColor = getRiskLevelColor(computed.overallLevel);
    const levelLabel = getRiskLevelLabel(computed.overallLevel);
    const exposureInfo = getFinancialExposureLevel(computed.totalExposureCents);

    return (
        <HUDCard>
            {/* ── Header ────────────────────────── */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white orion-text-heading">Risco Geral</h3>
                <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-[11px] border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.08)] hover:text-white"
                    onClick={() => router.push(`/projetos/${project.id}?tab=riscos`)}
                >
                    Registro de Riscos
                    <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
            </div>

            {/* ── P / I / Score Chips ───────────── */}
            <div className="flex items-center gap-3 mb-4">
                {/* Probability chip */}
                <div
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border"
                    style={{
                        background: 'rgba(255,255,255,0.04)',
                        borderColor: 'rgba(255,255,255,0.08)',
                    }}
                >
                    <Target className="w-3.5 h-3.5 text-[rgba(255,255,255,0.50)]" />
                    <span className="text-[11px] text-[rgba(255,255,255,0.50)] font-medium">P</span>
                    <span className="text-sm font-bold text-white">{computed.overallP}</span>
                    <span className="text-[10px] text-[rgba(255,255,255,0.30)]">/5</span>
                </div>

                {/* Impact chip */}
                <div
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border"
                    style={{
                        background: 'rgba(255,255,255,0.04)',
                        borderColor: 'rgba(255,255,255,0.08)',
                    }}
                >
                    <AlertTriangle className="w-3.5 h-3.5 text-[rgba(255,255,255,0.50)]" />
                    <span className="text-[11px] text-[rgba(255,255,255,0.50)] font-medium">I</span>
                    <span className="text-sm font-bold text-white">{computed.overallI}</span>
                    <span className="text-[10px] text-[rgba(255,255,255,0.30)]">/5</span>
                </div>

                {/* Score chip — color-coded */}
                <div
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border"
                    style={{
                        background: `${levelColor}15`,
                        borderColor: `${levelColor}30`,
                    }}
                >
                    <ShieldAlert className="w-3.5 h-3.5" style={{ color: levelColor }} />
                    <span className="text-sm font-bold" style={{ color: levelColor }}>
                        {computed.topScore}
                    </span>
                    <Badge
                        className="text-[9px] font-semibold border-0 px-1.5 py-0"
                        style={{
                            background: `${levelColor}20`,
                            color: levelColor,
                        }}
                    >
                        {levelLabel}
                    </Badge>
                </div>
            </div>

            {/* ── Risk Counts ──────────────────── */}
            <div className="flex items-center gap-4 mb-4">
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-[#FF4040]" />
                    <span className="text-[11px] text-[rgba(255,255,255,0.60)]">
                        {computed.highCriticalCount} alto/crítico
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <XCircle className="w-3 h-3 text-[#FF8C42]" />
                    <span className="text-[11px] text-[rgba(255,255,255,0.60)]">
                        {computed.noMitigationCount} sem mitigação
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-[rgba(255,255,255,0.40)]">
                        {computed.totalOpen} aberto{computed.totalOpen !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            {/* ── Top Contributing Risks ──────── */}
            <div className="space-y-2 mb-4">
                <p className="text-[10px] text-[rgba(255,255,255,0.35)] uppercase tracking-wider font-medium">
                    Top Riscos Contribuintes
                </p>
                {computed.topContributing.map(risk => {
                    const score = risk.probability * risk.impact;
                    const level = getRiskLevelFromScore(score);
                    const lColor = getRiskLevelColor(level);
                    const mitStatus = getMitigationStatusChip(risk);

                    return (
                        <div
                            key={risk.id}
                            className="flex items-center gap-3 p-2.5 rounded-lg"
                            style={{ background: 'rgba(255,255,255,0.03)' }}
                        >
                            {/* Score badge */}
                            <div
                                className="flex items-center justify-center w-8 h-8 rounded-md text-xs font-bold shrink-0"
                                style={{
                                    background: `${lColor}18`,
                                    color: lColor,
                                    border: `1px solid ${lColor}30`,
                                }}
                            >
                                {score}
                            </div>

                            {/* Title */}
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-[rgba(255,255,255,0.85)] truncate">{risk.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-[rgba(255,255,255,0.40)]">
                                        P{risk.probability}×I{risk.impact}
                                    </span>
                                    {risk.ownerName && (
                                        <span className="text-[10px] text-[rgba(255,255,255,0.35)]">
                                            → {risk.ownerName}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Mitigation status */}
                            <span
                                className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                                style={{ color: mitStatus.color, background: mitStatus.bg }}
                            >
                                {mitStatus.label}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* ── Impacto Financeiro (separate section) ── */}
            {computed.totalExposureCents > 0 && (
                <div
                    className="p-3 rounded-lg border"
                    style={{
                        background: 'rgba(255,255,255,0.02)',
                        borderColor: 'rgba(255,255,255,0.06)',
                    }}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-[rgba(255,255,255,0.50)]" />
                            <span className="text-[11px] text-[rgba(255,255,255,0.50)] font-medium uppercase tracking-wider">
                                Impacto Financeiro
                            </span>
                        </div>
                        <Badge
                            className="text-[10px] font-semibold border-0 px-2 py-0.5"
                            style={{ background: exposureInfo.bg, color: exposureInfo.color }}
                        >
                            {exposureInfo.level}
                        </Badge>
                    </div>
                    <p className="text-lg font-bold text-white mt-1">
                        {formatMoney({ amountCents: computed.totalExposureCents, currency: 'BRL' })}
                    </p>
                    <p className="text-[10px] text-[rgba(255,255,255,0.35)] mt-0.5">
                        Exposição acumulada de {risks.filter(r => r.exposure && r.status !== 'resolved').length} risco(s) em aberto
                    </p>
                </div>
            )}
        </HUDCard>
    );
}

export default RiskCardV2;
