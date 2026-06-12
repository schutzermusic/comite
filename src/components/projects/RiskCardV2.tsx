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
import { HudPanel } from '@/components/hud';
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
    variant?: 'default' | 'compact';
}

// ── Main Component ──────────────────────────────────────────────

export function RiskCardV2({ project, variant = 'default' }: RiskCardV2Props) {
    const isCompact = variant === 'compact';
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

        // Top contributing risks (max 3 default, 1 compact)
        const topContributing = sorted.slice(0, isCompact ? 1 : 3);

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
    }, [isCompact, risks]);

    // No risks state
    if (!computed) {
        return (
            <HudPanel>
                <div className="flex items-center gap-3 py-2">
                    <div className="p-2 rounded-lg bg-[rgba(101,163,13,0.08)] text-[#65A30D] dark:bg-[rgba(0,255,180,0.12)] dark:text-[#00FFB4]">
                        <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-sm font-semibold orion-text-primary">Risco Geral</h3>
                        <p className="text-xs hud-text-muted">Sem riscos abertos ✓</p>
                    </div>
                </div>
            </HudPanel>
        );
    }

    const levelColor = getRiskLevelColor(computed.overallLevel);
    const levelLabel = getRiskLevelLabel(computed.overallLevel);
    const exposureInfo = getFinancialExposureLevel(computed.totalExposureCents);

    return (
        <HudPanel noPadding>
          <div className={isCompact ? 'p-4' : 'p-6'}>
            {/* ── Header ────────────────────────── */}
            <div className={`flex items-center justify-between ${isCompact ? 'mb-2' : 'mb-4'}`}>
                <h3 className={`font-semibold orion-text-primary ${isCompact ? 'text-[13px]' : 'text-sm'}`}>Risco Geral</h3>
                <Button
                    size="sm"
                    variant="outline"
                    className={`px-2.5 text-[11px] border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.75)] hover:bg-[rgba(255,255,255,0.08)] hover:text-white ${isCompact ? 'h-6' : 'h-7'}`}
                    onClick={() => router.push(`/projetos/${project.id}?tab=riscos`)}
                >
                    {isCompact ? 'Riscos' : 'Registro de Riscos'}
                    <ExternalLink className="w-3 h-3 ml-1" />
                </Button>
            </div>

            {/* ── P / I / Score Chips ───────────── */}
            <div className={`flex flex-wrap items-center gap-2 ${isCompact ? 'mb-2' : 'mb-4'} ${isCompact ? '' : 'gap-3'}`}>
                {/* Probability chip */}
                <div
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.04)]"
                >
                    <Target className="w-3.5 h-3.5 hud-text-tertiary" />
                    <span className="text-[11px] hud-text-tertiary font-medium">P</span>
                    <span className="text-sm font-bold orion-text-primary">{computed.overallP}</span>
                    <span className="text-[10px] hud-text-muted">/5</span>
                </div>

                {/* Impact chip */}
                <div
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,0,0,0.06)] dark:border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.02)] dark:bg-[rgba(255,255,255,0.04)]"
                >
                    <AlertTriangle className="w-3.5 h-3.5 hud-text-tertiary" />
                    <span className="text-[11px] hud-text-tertiary font-medium">I</span>
                    <span className="text-sm font-bold orion-text-primary">{computed.overallI}</span>
                    <span className="text-[10px] hud-text-muted">/5</span>
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
            <div className={`flex flex-wrap items-center gap-3 ${isCompact ? 'mb-2' : 'mb-4'} ${isCompact ? '' : 'gap-4'}`}>
                <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-[#FF4040]" />
                    <span className="text-[11px] hud-text-tertiary">
                        {computed.highCriticalCount} alto/crítico
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <XCircle className="w-3 h-3 text-[var(--hud-warning)] dark:text-[#FF8C42]" />
                    <span className="text-[11px] hud-text-tertiary">
                        {computed.noMitigationCount} sem mitigação
                    </span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="text-[11px] hud-text-muted">
                        {computed.totalOpen} aberto{computed.totalOpen !== 1 ? 's' : ''}
                    </span>
                </div>
            </div>

            {/* ── Top Contributing Risks ──────── */}
            <div className={`space-y-1.5 ${isCompact ? 'mb-0' : 'mb-4'}`}>
                {!isCompact && (
                    <p className="text-[10px] hud-text-muted uppercase tracking-wider font-medium">
                        Top Riscos Contribuintes
                    </p>
                )}
                {computed.topContributing.map(risk => {
                    const score = risk.probability * risk.impact;
                    const level = getRiskLevelFromScore(score);
                    const lColor = getRiskLevelColor(level);
                    const mitStatus = getMitigationStatusChip(risk);

                    return (
                        <div
                            key={risk.id}
                            className={`flex items-center gap-2 rounded-lg ${isCompact ? 'p-2' : 'gap-3 p-2.5'}`}
                            style={{ background: 'rgba(255,255,255,0.03)' }}
                        >
                            {/* Score badge */}
                            <div
                                className={`flex items-center justify-center rounded-md font-bold shrink-0 ${isCompact ? 'h-7 w-7 text-[11px]' : 'w-8 h-8 text-xs'}`}
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
                                <p className={`orion-text-primary truncate ${isCompact ? 'text-[12px]' : 'text-sm'}`}>{risk.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] hud-text-muted">
                                        P{risk.probability}×I{risk.impact}
                                    </span>
                                    {risk.ownerName && (
                                        <span className="text-[10px] hud-text-muted">
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
            {!isCompact && computed.totalExposureCents > 0 && (
                <div
                    className="p-3 rounded-lg border bg-[rgba(0,0,0,0.02)] border-[rgba(0,0,0,0.06)] dark:bg-[rgba(255,255,255,0.02)] dark:border-[rgba(255,255,255,0.06)]"
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 hud-text-muted" />
                            <span className="text-[11px] hud-text-muted font-medium uppercase tracking-wider">
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
                    <p className="text-lg font-bold orion-text-primary mt-1">
                        {formatMoney({ amountCents: computed.totalExposureCents, currency: 'BRL' })}
                    </p>
                    <p className="text-[10px] hud-text-muted mt-0.5">
                        Exposição acumulada de {risks.filter(r => r.exposure && r.status !== 'resolved').length} risco(s) em aberto
                    </p>
                </div>
            )}
            </div>
        </HudPanel>
    );
}

export default RiskCardV2;
