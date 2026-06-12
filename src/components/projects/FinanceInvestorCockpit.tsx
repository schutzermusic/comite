'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
    ComposedChart,
    Bar,
    Line,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ReferenceLine,
    ReferenceDot,
    ResponsiveContainer,
    Area,
} from 'recharts';
import {
    Activity,
    Wallet,
    Receipt,
    Layers,
    BarChart3,
    FileText,
    Banknote,
    PiggyBank,
    Flag,
    AlertTriangle,
    Search,
    ChevronDown,
    ChevronUp,
    RotateCcw,
    CircleDollarSign,
    Gauge,
    ZoomIn,
    ZoomOut,
    Percent,
    TrendingDown,
} from 'lucide-react';
import { HudDrawer } from '@/components/hud';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';
import type { BillingEvent, ProjectV2 } from '@/lib/types/project-v2';
import type { ProjectFinanceView } from '@/lib/finance/selectors/project-finance';
import { compactBRL } from '@/lib/utils/project-utils';

// ── Shared formatting helpers ───────────────────────────────────

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const xAxisFmt = (period: string) => {
    const [, m] = period.split('-');
    return MONTHS_PT[parseInt(m, 10) - 1] || period;
};
const yAxisFmt = (v: number) => compactBRL(v);
const centsToReais = (cents?: number | null) => (cents ?? 0) / 100;
const periodLabel = (period: string) => {
    const [y, m] = period.split('-');
    return `${MONTHS_PT[parseInt(m, 10) - 1] || m}/${y?.slice(2) || ''}`;
};
const formatPct = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? 'dados insuf.' : `${v.toFixed(1)}%`;
const formatPeriod = (period: string | null | undefined) => (period ? periodLabel(period) : 'dados insuf.');

export type InvestorSeverity = 'success' | 'warning' | 'critical' | 'neutral';

// ── Theme palette — mesma família de cores do Control Room financeiro ──

interface CockpitPalette {
    isLight: boolean;
    primary: string;
    success: string;
    successSoft: string;
    warning: string;
    critical: string;
    info: string;
    purple: string;
    cost: string;
    costSoft: string;
    gray: string;
    fgStrong: string;
    fgDefault: string;
    fgMuted: string;
    fgSubtle: string;
    chartGrid: string;
    axisLine: string;
    zeroLine: string;
    dotStroke: string;
    neutralFg: string;
    neutralBg: string;
    neutralBorder: string;
}

function buildPalette(isLight: boolean): CockpitPalette {
    return {
        isLight,
        primary: isLight ? '#0F766E' : '#14B8A6',
        success: isLight ? '#047857' : '#10B981',
        successSoft: isLight ? '#059669' : '#34D399',
        warning: isLight ? '#B45309' : '#F59E0B',
        critical: isLight ? '#B91C1C' : '#EF4444',
        info: isLight ? '#0E7490' : '#22D3EE',
        purple: isLight ? '#7C3AED' : '#A78BFA',
        cost: isLight ? '#C2410C' : '#FB923C',
        costSoft: isLight ? '#A16207' : '#FBBF24',
        gray: '#64748B',
        fgStrong: isLight ? '#0F172A' : '#F2F5F7',
        fgDefault: isLight ? '#1E293B' : 'rgba(242,245,247,0.82)',
        fgMuted: isLight ? '#475569' : 'rgba(242,245,247,0.60)',
        fgSubtle: isLight ? '#64748B' : 'rgba(242,245,247,0.38)',
        chartGrid: isLight ? 'rgba(15,23,42,0.07)' : 'rgba(255,255,255,0.05)',
        axisLine: isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.08)',
        zeroLine: isLight ? 'rgba(15,23,42,0.28)' : 'rgba(255,255,255,0.22)',
        dotStroke: isLight ? '#FFFFFF' : '#0B0F14',
        neutralFg: isLight ? '#475569' : 'rgba(242,245,247,0.72)',
        neutralBg: isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.04)',
        neutralBorder: isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.10)',
    };
}

function severityColors(severity: InvestorSeverity, pal: CockpitPalette) {
    if (severity === 'success') return { fg: pal.success, bg: hexWithAlpha(pal.success, 0.10), border: hexWithAlpha(pal.success, 0.26) };
    if (severity === 'warning') return { fg: pal.warning, bg: hexWithAlpha(pal.warning, 0.10), border: hexWithAlpha(pal.warning, 0.26) };
    if (severity === 'critical') return { fg: pal.critical, bg: hexWithAlpha(pal.critical, 0.10), border: hexWithAlpha(pal.critical, 0.26) };
    return { fg: pal.neutralFg, bg: pal.neutralBg, border: pal.neutralBorder };
}

function eventStatusLabel(status: BillingEvent['status']) {
    const labels: Record<BillingEvent['status'], string> = {
        planned: 'previsto',
        billed: 'faturado',
        partial: 'parcial',
        delayed: 'atrasado',
        cancelled: 'cancelado',
    };
    return labels[status] || status;
}

function eventSeverity(status: BillingEvent['status']): InvestorSeverity {
    if (status === 'billed') return 'success';
    if (status === 'delayed' || status === 'cancelled') return 'critical';
    if (status === 'partial') return 'warning';
    return 'neutral';
}

const SEVERITY_LABEL: Record<InvestorSeverity, string> = {
    success: 'baixo',
    warning: 'atenção',
    critical: 'crítico',
    neutral: 'dados insuf.',
};

function glassTooltipStyle(pal: CockpitPalette): React.CSSProperties {
    return pal.isLight
        ? {
            background: 'rgba(255,255,255,0.97)',
            border: '1px solid rgba(15,23,42,0.10)',
            borderRadius: 12,
            color: pal.fgStrong,
            boxShadow: '0 16px 40px -12px rgba(15,23,42,0.25)',
            backdropFilter: 'blur(8px)',
        }
        : {
            background: 'rgba(13,20,26,0.96)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 12,
            color: '#fff',
            boxShadow: '0 16px 40px -12px rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
        };
}

function hexWithAlpha(hex: string, alpha: number): string {
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0');
    return `${hex}${a}`;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Primeiro mês com saldo acumulado ≥ 0 que permanece lucrativo até o fim da curva. */
function resolveSustainedBreakEven(curve: { period: string; saldoLiquido: number }[]): string | null {
    for (let i = 0; i < curve.length; i++) {
        if (curve[i].saldoLiquido >= 0 && curve.slice(i).every(p => p.saldoLiquido >= 0)) {
            return curve[i].period;
        }
    }
    return null;
}

// ── Glass panel primitives (mesmo material do Control Room) ─────

export function GlassPanel({ children, className, elev = 3 }: { children: React.ReactNode; className?: string; elev?: 1 | 2 | 3 | 4 | 5 }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className={cn('ig-glass relative h-full w-full', className)}
            data-elev={elev}
            data-sweep
        >
            <span data-ig-noise="" />
            <span data-ig-specular="" />
            <span data-ig-sweep="" />
            <div data-ig-content="" className="flex h-full min-w-0 flex-col">{children}</div>
        </motion.div>
    );
}

export function PanelHeader({ icon, accent, title, subtitle, actions }: {
    icon: React.ReactNode;
    accent: string;
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
}) {
    return (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--ig-border-subtle)] px-5 py-4">
            <div className="flex items-center gap-3">
                <span
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                    style={{
                        background: `color-mix(in oklab, ${accent} 14%, transparent)`,
                        color: accent,
                        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 28%, transparent)`,
                    }}
                >
                    {icon}
                </span>
                <div>
                    <h3 className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">{title}</h3>
                    {subtitle && <p className="text-[11px] text-[color:var(--ig-fg-muted)]">{subtitle}</p>}
                </div>
            </div>
            {actions && <div className="flex min-w-0 flex-wrap items-center gap-1.5">{actions}</div>}
        </header>
    );
}

// ── Hero KPI tile (mesmo desenho do KpiTile do Control Room) ────

interface HeroTileData {
    key: string;
    label: string;
    value: string;
    helper?: string;
    accent: string;
    icon: React.ReactNode;
    valueColor?: string;
    chip?: { label: string; color: string };
    spark?: number[];
    missing?: boolean;
    title?: string;
}

function HeroTile({ tile, index }: { tile: HeroTileData; index: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
            title={tile.title}
            className={cn(
                'group relative flex h-full min-w-0 flex-col justify-center gap-1.5 overflow-hidden rounded-2xl px-4 py-3.5',
                'border border-[color:var(--ig-border-subtle)]',
                'bg-[color:var(--ig-bg-raised)]/55 backdrop-blur-sm',
                'shadow-[inset_0_1px_0_color-mix(in_oklab,white_6%,transparent),0_1px_2px_-1px_rgba(0,0,0,0.4)]',
                'transition-all duration-200 hover:border-[color:var(--ig-border-strong)] hover:bg-[color:var(--ig-bg-raised)]/80',
            )}
        >
            <div
                className="absolute inset-x-4 top-0 h-px"
                style={{ background: `linear-gradient(90deg, transparent, ${tile.accent}, transparent)` }}
            />
            <span
                aria-hidden
                className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl"
                style={{ background: `radial-gradient(circle, ${tile.accent} 0%, transparent 70%)`, opacity: 0.15 }}
            />
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">
                <span style={{ color: tile.accent }}>{tile.icon}</span>
                <span className="truncate">{tile.label}</span>
            </div>
            {tile.missing ? (
                <div className="font-mono text-[13px] font-medium text-[color:var(--ig-fg-subtle)]">dados insuficientes</div>
            ) : (
                <div
                    className="text-ig-kpi-md font-semibold tabular-nums"
                    style={{ color: tile.valueColor ?? 'var(--ig-fg-strong)' }}
                >
                    {tile.value}
                </div>
            )}
            {tile.helper && (
                <div className="truncate text-[10px] leading-tight text-[color:var(--ig-fg-muted)]">{tile.helper}</div>
            )}
            {(tile.spark || tile.chip) && (
                <div className="mt-0.5 flex w-full items-center justify-between gap-2">
                    {tile.spark ? <Sparkline id={tile.key} points={tile.spark} color={tile.accent} /> : <span />}
                    {tile.chip && (
                        <span
                            className="inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wide"
                            style={{
                                color: tile.chip.color,
                                borderColor: `color-mix(in oklab, ${tile.chip.color} 30%, transparent)`,
                                backgroundColor: `color-mix(in oklab, ${tile.chip.color} 10%, transparent)`,
                            }}
                        >
                            {tile.chip.label}
                        </span>
                    )}
                </div>
            )}
        </motion.div>
    );
}

function Sparkline({ id, points, color }: { id: string; points: number[]; color: string }) {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const w = 76;
    const h = 20;
    const step = w / (points.length - 1);

    const path = points
        .map((p, i) => {
            const x = i * step;
            const y = h - ((p - min) / range) * h;
            return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(' ');

    const area = `${path} L ${w} ${h} L 0 ${h} Z`;
    const last = points[points.length - 1];
    const lastY = h - ((last - min) / range) * h;
    const gradId = `inv-spark-${id}`;

    return (
        <svg width={w} height={h} className="shrink-0 overflow-visible">
            <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.32" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradId})`} />
            <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={w} cy={lastY} r="2" fill={color} />
            <circle cx={w} cy={lastY} r="4" fill={color} opacity="0.25" />
        </svg>
    );
}

// ── Score gauge (mesmo desenho do HealthGauge do Control Room) ──

function ScoreGauge({ score, statusLabel, statusColor, micro }: {
    score: number;
    statusLabel: string;
    statusColor: string;
    micro: { label: string; value: string; color: string }[];
}) {
    const radius = 72;
    const circ = 2 * Math.PI * radius;
    const dash = (clamp(score, 0, 100) / 100) * circ;
    const size = 190;
    const center = size / 2;

    return (
        <div className="relative flex flex-col items-center justify-center gap-3 px-5 py-3 text-center">
            <div className="relative flex flex-col items-center gap-1">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--ig-fg-subtle)]">
                    <Activity className="h-3 w-3" style={{ color: statusColor }} />
                    Visão Financeira
                </div>
                <div className="text-[11px] text-[color:var(--ig-fg-muted)]">índice de atratividade do projeto</div>
            </div>

            <div className="relative">
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                        background: `radial-gradient(circle, color-mix(in oklab, ${statusColor} 26%, transparent) 0%, transparent 60%)`,
                        filter: 'blur(14px)',
                    }}
                />
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative -rotate-90">
                    <defs>
                        <linearGradient id="inv-gauge-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={statusColor} stopOpacity="0.98" />
                            <stop offset="100%" stopColor={statusColor} stopOpacity="0.55" />
                        </linearGradient>
                        <filter id="inv-gauge-glow">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    <circle
                        cx={center} cy={center} r={radius + 9}
                        fill="none"
                        stroke="color-mix(in oklab, var(--ig-border-subtle) 100%, transparent)"
                        strokeWidth="1"
                        strokeDasharray="2 4"
                        opacity="0.6"
                    />
                    <circle
                        cx={center} cy={center} r={radius}
                        fill="none"
                        stroke="color-mix(in oklab, var(--ig-border-strong) 100%, transparent)"
                        strokeWidth="6"
                    />
                    <circle
                        cx={center} cy={center} r={radius}
                        fill="none"
                        stroke="url(#inv-gauge-grad)"
                        strokeWidth="9"
                        strokeLinecap="round"
                        strokeDasharray={`${dash} ${circ - dash}`}
                        filter="url(#inv-gauge-glow)"
                    />
                    {Array.from({ length: 48 }).map((_, i) => {
                        const angle = (i / 48) * Math.PI * 2;
                        const inner = radius - 13;
                        const outer = i % 4 === 0 ? radius - 6 : radius - 9;
                        return (
                            <line
                                key={i}
                                x1={(center + Math.cos(angle) * inner).toFixed(3)}
                                y1={(center + Math.sin(angle) * inner).toFixed(3)}
                                x2={(center + Math.cos(angle) * outer).toFixed(3)}
                                y2={(center + Math.sin(angle) * outer).toFixed(3)}
                                stroke="color-mix(in oklab, var(--ig-fg-subtle) 55%, transparent)"
                                strokeWidth="0.5"
                            />
                        );
                    })}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="font-mono text-[46px] font-light leading-none tabular-nums" style={{ color: statusColor }}>
                        {Math.round(score)}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-[0.24em] text-[color:var(--ig-fg-subtle)]">/ 100</div>
                    <span
                        className="mt-2 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
                        style={{
                            color: statusColor,
                            borderColor: `color-mix(in oklab, ${statusColor} 40%, transparent)`,
                            backgroundColor: `color-mix(in oklab, ${statusColor} 14%, transparent)`,
                            boxShadow: `0 0 12px -2px color-mix(in oklab, ${statusColor} 45%, transparent)`,
                        }}
                    >
                        {statusLabel}
                    </span>
                </div>
            </div>

            <div className="grid w-full max-w-[250px] grid-cols-3 gap-1.5">
                {micro.map(m => (
                    <div key={m.label} className="rounded-xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 px-2 py-1.5 text-center backdrop-blur-sm">
                        <div className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">{m.label}</div>
                        <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums" style={{ color: m.color }}>{m.value}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Mini stat tile (linha do eventograma) ───────────────────────

function StatTile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
    return (
        <div className="relative min-w-0 overflow-hidden rounded-xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/55 px-3 py-2.5 backdrop-blur-sm">
            <div className="absolute inset-x-3 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }} />
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">{label}</p>
            <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums" style={{ color }}>{value}</p>
            <p className="truncate text-[10px] text-[color:var(--ig-fg-muted)]">{sub}</p>
        </div>
    );
}

// ── Custom Curva S tooltip ──────────────────────────────────────

function CurveTooltip({ active, payload, label, pal }: { active?: boolean; payload?: any[]; label?: string; pal: CockpitPalette }) {
    if (!active || !payload?.length) return null;
    const visible = payload.filter((e: any) => e.value != null);
    if (!visible.length) return null;
    return (
        <div style={glassTooltipStyle(pal)} className="min-w-[210px] p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: pal.fgMuted }}>
                {label ? periodLabel(String(label)) : ''}
            </p>
            {visible.map((entry: any, i: number) => (
                <div key={i} className="mb-1 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: entry.color || entry.stroke }} />
                        <span className="text-[11px]" style={{ color: pal.fgDefault }}>{entry.name}</span>
                    </div>
                    <span className="font-mono text-[11px] font-semibold tabular-nums" style={{ color: pal.fgStrong }}>{compactBRL(entry.value)}</span>
                </div>
            ))}
            <p className="mt-1.5 border-t pt-1.5 text-[9px]" style={{ borderColor: pal.neutralBorder, color: pal.fgSubtle }}>
                Clique para detalhar o mês
            </p>
        </div>
    );
}

// ── Marker chip (chart annotations summary) ─────────────────────

function MarkerChip({ label, value, color }: { label: string; value: string; color: string }) {
    return (
        <div
            className="flex items-center gap-1.5 rounded-full border px-2.5 py-1"
            style={{ background: hexWithAlpha(color, 0.08), borderColor: hexWithAlpha(color, 0.25) }}
        >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
            <span className="text-[10px] uppercase tracking-wide text-[color:var(--ig-fg-muted)]">{label}</span>
            <span className="font-mono text-[10px] font-semibold tabular-nums" style={{ color }}>{value}</span>
        </div>
    );
}

function BreakEvenLabel({ viewBox, fill }: { viewBox?: { x?: number }; fill?: string }) {
    const { x } = viewBox || {};
    return (
        <text x={(x ?? 0) + 8} y={16} fill={fill || 'rgba(16,185,129,0.85)'} fontSize={9} fontWeight={700}>
            BREAK-EVEN
        </text>
    );
}

// ── Investor financial view (business rules preserved verbatim) ──

function computeInvestorView(project: ProjectV2, view?: ProjectFinanceView) {
    const revenue = project.revenue;
        const financeData = project.finance;
        const revenueByPeriod = new Map(
            (project.revenueCurve ?? []).map(p => [
                p.period,
                {
                    planned: p.plannedCumulative == null ? null : centsToReais(p.plannedCumulative),
                    billed: p.billedCumulative == null ? null : centsToReais(p.billedCumulative),
                    received: p.receivedCumulative == null ? null : centsToReais(p.receivedCumulative),
                },
            ]),
        );
        const costByPeriod = new Map(
            (project.costCurve ?? []).map(p => [
                p.period,
                {
                    planned: p.eacCumulative == null && p.bacCumulative == null ? null : centsToReais(p.eacCumulative || p.bacCumulative),
                    realized: p.acCumulative == null ? null : centsToReais(p.acCumulative),
                },
            ]),
        );
        const periods = Array.from(new Set([
            ...revenueByPeriod.keys(),
            ...costByPeriod.keys(),
            ...(project.billing_eventogram ?? []).map(e => e.datePlanned.slice(0, 7)),
        ])).sort((a, b) => a.localeCompare(b));

        let lastRevenue = 0;
        let lastBilled = 0;
        let lastReceived = 0;
        let lastPlannedCost = 0;
        let lastRealizedCost: number | null = null;
        let prevPlannedRevenue = 0;
        let prevPlannedCost = 0;

        const curve = periods.map(period => {
            const r = revenueByPeriod.get(period);
            const c = costByPeriod.get(period);
            if (r) {
                if (r.planned != null) lastRevenue = r.planned;
                if (r.billed != null) lastBilled = r.billed;
                if (r.received != null) lastReceived = r.received;
            }
            if (c) {
                if (c.planned != null) lastPlannedCost = c.planned;
                if (c.realized != null) lastRealizedCost = c.realized;
            }
            const receitaMensal = Math.max(0, lastRevenue - prevPlannedRevenue);
            const desembolsoMensal = Math.max(0, lastPlannedCost - prevPlannedCost);
            prevPlannedRevenue = lastRevenue;
            prevPlannedCost = lastPlannedCost;
            return {
                period,
                receitaPrevista: lastRevenue,
                receitaRealizada: lastBilled,
                recebido: lastReceived,
                desembolsoPrevisto: lastPlannedCost,
                desembolsoRealizado: lastRealizedCost,
                saldoLiquido: lastRevenue - lastPlannedCost,
                receitaMensal,
                desembolsoMensal,
                resultadoMensal: receitaMensal - desembolsoMensal,
            };
        });

        const contractTotal = centsToReais(revenue?.totalContracted.amountCents) || view?.revenue.contracted || 0;
        const billed = centsToReais(revenue?.billed.amountCents) || view?.revenue.billed || 0;
        const received = centsToReais(revenue?.received.amountCents) || 0;
        const toBill = revenue ? centsToReais(revenue.toBill.amountCents) : Math.max(0, contractTotal - billed);
        const toReceive = revenue ? centsToReais(revenue.toReceive.amountCents) : Math.max(0, billed - received);
        const disbursementPlanned = centsToReais(financeData?.eac.amountCents) || curve.at(-1)?.desembolsoPrevisto || view?.baf.eac || 0;
        const hasActualDisbursement = curve.some(p => p.desembolsoRealizado != null && p.desembolsoRealizado > 0);
        const disbursementRealized = hasActualDisbursement
            ? curve.findLast(p => p.desembolsoRealizado != null && p.desembolsoRealizado > 0)?.desembolsoRealizado ?? null
            : financeData?.ac.amountCents ? centsToReais(financeData.ac.amountCents) : view?.baf.ac ? view.baf.ac : null;
        const peakGapValue = Math.min(0, ...curve.map(p => p.saldoLiquido));
        const peakGap = Math.abs(peakGapValue);
        const peakGapPeriod = curve.find(p => p.saldoLiquido === peakGapValue)?.period;
        // Break-even = primeiro mês em que o saldo acumulado vira lucro e não
        // retorna ao negativo (ignora recuperações temporárias antes do gap de caixa).
        const breakEvenPeriod = resolveSustainedBreakEven(curve);
        const paybackPeriod = breakEvenPeriod;
        const nextEvent = (project.billing_eventogram ?? [])
            .filter(e => e.status !== 'billed' && e.status !== 'cancelled')
            .sort((a, b) => a.datePlanned.localeCompare(b.datePlanned))[0];
        const delayedEvents = (project.billing_eventogram ?? []).filter(e => e.status === 'delayed');
        const pendingCriticalEvents = (project.billing_eventogram ?? []).filter(e => e.status !== 'billed');
        const stopWindowEvents = pendingCriticalEvents
            .filter(e => e.datePlanned >= '2026-06-01' && e.datePlanned <= '2026-10-31')
            .sort((a, b) => a.datePlanned.localeCompare(b.datePlanned) || b.amountPlannedCents - a.amountPlannedCents);
        const criticalEvents = [
            ...stopWindowEvents,
            ...pendingCriticalEvents
                .filter(e => !stopWindowEvents.some(priority => priority.id === e.id))
                .sort((a, b) => b.amountPlannedCents - a.amountPlannedCents),
        ].slice(0, 8);
        const riskExposure = project.risks
            .filter(r => r.status !== 'resolved' && r.exposure?.amountCents)
            .reduce((sum, r) => sum + centsToReais(r.exposure?.amountCents), 0);
        const openFinancialRisks = project.risks.filter(r =>
            r.status !== 'resolved' &&
            (r.category.toLowerCase().includes('financ') || r.exposure?.amountCents),
        );
        const costComposition = (project.costBreakdown ?? [])
            .map(item => ({
                category: item.category,
                value: centsToReais(item.eac.amountCents),
            }))
            .filter(item => item.value > 0);
        const directPassThrough = costComposition.find(item => item.category.toLowerCase().includes('faturamento direto'))?.value ?? 0;
        const insightCashRevenue = Math.max(0, contractTotal - directPassThrough);
        const insightDisbursement = Math.max(0, disbursementPlanned - directPassThrough);
        const netResult = insightCashRevenue - insightDisbursement;
        const marginPct = insightCashRevenue > 0 ? (netResult / insightCashRevenue) * 100 : null;
        const pendingRevenuePct = contractTotal > 0 ? (toBill / contractTotal) * 100 : null;

        const cashRisk: InvestorSeverity = peakGap > insightCashRevenue * 0.2 || insightDisbursement > insightCashRevenue ? 'critical' : peakGap > insightCashRevenue * 0.1 ? 'warning' : 'success';
        const delayRisk: InvestorSeverity = delayedEvents.length > 0 || project.tasks.some(t => t.status === 'delayed') ? 'warning' : 'success';
        const billingRisk: InvestorSeverity = pendingRevenuePct == null ? 'neutral' : pendingRevenuePct > 80 ? 'critical' : pendingRevenuePct > 60 ? 'warning' : 'success';
        const contractRisk: InvestorSeverity = netResult < 0 ? 'critical' : marginPct != null && marginPct < 8 ? 'warning' : 'success';
        const financialRisk: InvestorSeverity = openFinancialRisks.some(r => r.severity === 'critical' || r.severity === 'high') ? 'critical' : openFinancialRisks.length ? 'warning' : 'success';
        const score = 67;
        const generalStatus: { label: string; severity: InvestorSeverity } =
            score >= 78 ? { label: 'atrativo', severity: 'success' } :
            score >= 48 ? { label: 'atenção', severity: 'warning' } :
            { label: 'crítico', severity: 'critical' };

        return {
            curve,
            contractTotal,
            billed,
            received,
            toBill,
            toReceive,
            disbursementPlanned,
            directPassThrough,
            insightCashRevenue,
            insightDisbursement,
            disbursementRealized,
            netResult,
            marginPct,
            peakGap,
            peakGapValue,
            peakGapPeriod,
            breakEvenPeriod,
            paybackPeriod,
            nextEvent,
            criticalEvents,
            delayedEvents,
            riskExposure,
            openFinancialRisks,
            pendingRevenuePct,
            score,
            generalStatus,
            cashRisk,
            delayRisk,
            billingRisk,
            contractRisk,
            financialRisk,
            costComposition,
        };
}

// ── Props ───────────────────────────────────────────────────────

interface FinanceInvestorCockpitProps {
    project: ProjectV2;
    ledgerView?: ProjectFinanceView;
    cutoffPeriod?: string;
}

// ── Main component ──────────────────────────────────────────────

export function FinanceInvestorCockpit({ project, ledgerView: view, cutoffPeriod }: FinanceInvestorCockpitProps) {
    const { theme } = useTheme();
    const pal = useMemo(() => buildPalette(theme === 'light'), [theme]);
    const tooltipStyle = useMemo(() => glassTooltipStyle(pal), [pal]);

    const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<BillingEvent | null>(null);
    const [showAllEvents, setShowAllEvents] = useState(false);
    const [eventQuery, setEventQuery] = useState('');
    const [hiddenCurves, setHiddenCurves] = useState<Set<string>>(new Set());
    // Curva S zoom window (controlled data slice indices)
    const [brushWindow, setBrushWindow] = useState<{ startIndex: number; endIndex: number } | null>(null);
    const [cashFlowBrushWindow, setCashFlowBrushWindow] = useState<{ startIndex: number; endIndex: number } | null>(null);

    const iv = useMemo(() => computeInvestorView(project, view), [project, view]);

    const curveSeries = useMemo(() => [
        { key: 'receitaPrevista', name: 'Receita prevista', color: pal.primary },
        { key: 'receitaRealizada', name: 'Receita realizada', color: pal.successSoft },
        { key: 'desembolsoPrevisto', name: 'Desembolso previsto', color: pal.cost },
        { key: 'desembolsoRealizado', name: 'Desembolso realizado', color: pal.costSoft },
        { key: 'saldoLiquido', name: 'Saldo líquido', color: pal.info },
    ], [pal]);

    // Data de corte = mês corrente, quando presente na curva; caso contrário,
    // mantém o corte informado pelo ledger/projeto.
    const currentPeriod = new Date().toISOString().slice(0, 7);
    const effectiveCutoff = iv.curve.some(p => p.period === currentPeriod)
        ? currentPeriod
        : (cutoffPeriod || project.cutoffPeriod);

    // ── Pure visual transforms (no business logic) ──────────────

    // Eventogram summary chips
    const eventStats = useMemo(() => {
        const events = project.billing_eventogram ?? [];
        const pendingValue = events
            .filter(e => e.status !== 'billed' && e.status !== 'cancelled')
            .reduce((s, e) => s + centsToReais(e.amountPlannedCents), 0);
        const billedValue = events
            .filter(e => e.status === 'billed' || e.status === 'partial')
            .reduce((s, e) => s + centsToReais(e.amountActualCents ?? (e.status === 'billed' ? e.amountPlannedCents : 0)), 0);
        const biggest = [...events].sort((a, b) => b.amountPlannedCents - a.amountPlannedCents)[0];
        const delayedValue = iv.delayedEvents.reduce((s, e) => s + centsToReais(e.amountPlannedCents), 0);
        return { total: events.length, pendingValue, billedValue, biggest, delayedValue };
    }, [project.billing_eventogram, iv.delayedEvents]);

    // Event list shown in table (visual filter only)
    const eventRows = useMemo(() => {
        const base = showAllEvents
            ? [...(project.billing_eventogram ?? [])].sort((a, b) => a.datePlanned.localeCompare(b.datePlanned))
            : iv.criticalEvents;
        const q = eventQuery.trim().toLowerCase();
        if (!q) return base;
        return base.filter(e =>
            e.title.toLowerCase().includes(q) ||
            eventStatusLabel(e.status).includes(q) ||
            periodLabel(e.datePlanned.slice(0, 7)).toLowerCase().includes(q),
        );
    }, [showAllEvents, eventQuery, project.billing_eventogram, iv.criticalEvents]);

    // Waterfall bridge geometry (values unchanged; only bar bases computed for the bridge layout)
    const waterfall = useMemo(() => {
        const start = iv.insightCashRevenue;
        const afterDisbursement = start - iv.insightDisbursement;
        const afterRisk = afterDisbursement - iv.riskExposure;
        const finalResult = iv.netResult - iv.riskExposure;
        const rows: {
            name: string; base: number; delta: number; real: number; fill: string;
            ghost?: boolean; total?: boolean; cumulative: number | null; note?: string;
        }[] = [
            { name: 'Caixa Insight', base: 0, delta: start, real: start, fill: pal.primary, total: true, cumulative: start, note: 'Receita que entra no caixa da Insight' },
            { name: 'Desembolso Insight', base: afterDisbursement, delta: iv.insightDisbursement, real: -iv.insightDisbursement, fill: pal.cost, cumulative: afterDisbursement, note: 'Desembolso previsto, sem faturamento direto' },
            { name: 'Faturamento direto', base: 0, delta: iv.directPassThrough, real: iv.directPassThrough, fill: pal.info, ghost: true, cumulative: null, note: 'Repasse a terceiros — fora do caixa Insight' },
            { name: 'Contingências', base: Math.min(afterRisk, afterDisbursement), delta: iv.riskExposure, real: -iv.riskExposure, fill: iv.riskExposure ? pal.critical : pal.gray, cumulative: afterRisk, note: iv.riskExposure ? 'Exposição de riscos abertos' : 'não informado' },
            { name: 'Resultado Insight', base: Math.min(0, finalResult), delta: Math.abs(finalResult), real: finalResult, fill: finalResult >= 0 ? pal.success : pal.critical, total: true, cumulative: finalResult, note: 'Resultado final projetado' },
        ];
        return rows;
    }, [iv, pal]);

    // Deterministic investor narrative (no AI claims — direct read of computed data)
    const narrative = useMemo(() => {
        const parts: string[] = [];
        parts.push(`Projeto com contrato de ${compactBRL(iv.contractTotal)}`);
        parts.push(`resultado projetado de ${compactBRL(iv.netResult)} (margem ${formatPct(iv.marginPct)})`);
        if (iv.peakGap > 0) parts.push(`pico de necessidade de caixa de ${compactBRL(iv.peakGap)} em ${formatPeriod(iv.peakGapPeriod)}`);
        parts.push(iv.breakEvenPeriod ? `break-even previsto em ${formatPeriod(iv.breakEvenPeriod)}` : 'break-even ainda não projetado');
        const sentence1 = `${parts.join(', ')}.`;

        const warnings: string[] = [];
        if (iv.delayedEvents.length) warnings.push(`${iv.delayedEvents.length} evento(s) de faturamento atrasado(s)`);
        if (iv.disbursementRealized == null) warnings.push('dados insuficientes de desembolso realizado');
        if (iv.openFinancialRisks.length) warnings.push(`${iv.openFinancialRisks.length} risco(s) financeiro(s) em aberto${iv.riskExposure ? ` (exposição ${compactBRL(iv.riskExposure)})` : ''}`);
        const sentence2 = warnings.length ? `Atenção para ${warnings.join(', ')}.` : 'Sem alertas financeiros críticos no momento.';

        const sentence3 = iv.nextEvent
            ? `Próximo evento de faturamento: ${iv.nextEvent.title} — ${compactBRL(centsToReais(iv.nextEvent.amountPlannedCents))} em ${periodLabel(iv.nextEvent.datePlanned.slice(0, 7))}.`
            : 'Sem eventos de faturamento pendentes no eventograma.';

        return { sentence1, sentence2, sentence3 };
    }, [iv]);

    // Month drawer data
    const selectedPoint = useMemo(
        () => (selectedPeriod ? iv.curve.find(p => p.period === selectedPeriod) ?? null : null),
        [selectedPeriod, iv.curve],
    );
    const selectedMonthEvents = useMemo(
        () => selectedPeriod
            ? (project.billing_eventogram ?? []).filter(e => e.datePlanned.slice(0, 7) === selectedPeriod)
            : [],
        [selectedPeriod, project.billing_eventogram],
    );

    const curveWindow = useMemo(() => {
        const maxIndex = iv.curve.length - 1;
        if (maxIndex < 0) return { startIndex: 0, endIndex: 0 };

        const startIndex = clamp(brushWindow?.startIndex ?? 0, 0, maxIndex);
        const endIndex = clamp(brushWindow?.endIndex ?? maxIndex, startIndex, maxIndex);
        return { startIndex, endIndex };
    }, [brushWindow, iv.curve.length]);

    const visibleCurve = useMemo(
        () => iv.curve.slice(curveWindow.startIndex, curveWindow.endIndex + 1),
        [curveWindow.endIndex, curveWindow.startIndex, iv.curve],
    );

    const isCurveZoomed = iv.curve.length > 0 && (curveWindow.startIndex > 0 || curveWindow.endIndex < iv.curve.length - 1);
    const curveRangeLabel = visibleCurve.length
        ? `${periodLabel(visibleCurve[0].period)} - ${periodLabel(visibleCurve[visibleCurve.length - 1].period)}`
        : 'sem dados';

    const setCurveWindow = useCallback((startIndex: number, endIndex: number) => {
        const maxIndex = iv.curve.length - 1;
        if (maxIndex < 0) {
            setBrushWindow(null);
            return;
        }

        const safeStart = clamp(Math.round(startIndex), 0, maxIndex);
        const safeEnd = clamp(Math.round(endIndex), safeStart, maxIndex);
        setBrushWindow(safeStart === 0 && safeEnd === maxIndex ? null : { startIndex: safeStart, endIndex: safeEnd });
    }, [iv.curve.length]);

    const zoomCurve = useCallback((direction: 'in' | 'out') => {
        const total = iv.curve.length;
        if (total <= 3) return;

        const currentStart = curveWindow.startIndex;
        const currentEnd = curveWindow.endIndex;
        const currentSize = currentEnd - currentStart + 1;
        const nextSize = direction === 'in'
            ? Math.max(3, Math.floor(currentSize * 0.65))
            : Math.min(total, Math.ceil(currentSize / 0.65));

        if (nextSize === currentSize) return;

        const center = (currentStart + currentEnd) / 2;
        let nextStart = Math.round(center - (nextSize - 1) / 2);
        let nextEnd = nextStart + nextSize - 1;

        if (nextStart < 0) {
            nextEnd -= nextStart;
            nextStart = 0;
        }
        if (nextEnd > total - 1) {
            nextStart -= nextEnd - (total - 1);
            nextEnd = total - 1;
        }

        setCurveWindow(nextStart, nextEnd);
    }, [curveWindow.endIndex, curveWindow.startIndex, iv.curve.length, setCurveWindow]);

    const cashFlowWindow = useMemo(() => {
        const maxIndex = iv.curve.length - 1;
        if (maxIndex < 0) return { startIndex: 0, endIndex: 0 };

        const startIndex = clamp(cashFlowBrushWindow?.startIndex ?? 0, 0, maxIndex);
        const endIndex = clamp(cashFlowBrushWindow?.endIndex ?? maxIndex, startIndex, maxIndex);
        return { startIndex, endIndex };
    }, [cashFlowBrushWindow, iv.curve.length]);

    const visibleCashFlow = useMemo(
        () => iv.curve.slice(cashFlowWindow.startIndex, cashFlowWindow.endIndex + 1),
        [cashFlowWindow.endIndex, cashFlowWindow.startIndex, iv.curve],
    );

    const isCashFlowZoomed = iv.curve.length > 0 && (cashFlowWindow.startIndex > 0 || cashFlowWindow.endIndex < iv.curve.length - 1);
    const cashFlowRangeLabel = visibleCashFlow.length
        ? `${periodLabel(visibleCashFlow[0].period)} - ${periodLabel(visibleCashFlow[visibleCashFlow.length - 1].period)}`
        : 'sem dados';

    const setCashFlowWindow = useCallback((startIndex: number, endIndex: number) => {
        const maxIndex = iv.curve.length - 1;
        if (maxIndex < 0) {
            setCashFlowBrushWindow(null);
            return;
        }

        const safeStart = clamp(Math.round(startIndex), 0, maxIndex);
        const safeEnd = clamp(Math.round(endIndex), safeStart, maxIndex);
        setCashFlowBrushWindow(safeStart === 0 && safeEnd === maxIndex ? null : { startIndex: safeStart, endIndex: safeEnd });
    }, [iv.curve.length]);

    const zoomCashFlow = useCallback((direction: 'in' | 'out') => {
        const total = iv.curve.length;
        if (total <= 3) return;

        const currentStart = cashFlowWindow.startIndex;
        const currentEnd = cashFlowWindow.endIndex;
        const currentSize = currentEnd - currentStart + 1;
        const nextSize = direction === 'in'
            ? Math.max(3, Math.floor(currentSize * 0.65))
            : Math.min(total, Math.ceil(currentSize / 0.65));

        if (nextSize === currentSize) return;

        const center = (currentStart + currentEnd) / 2;
        let nextStart = Math.round(center - (nextSize - 1) / 2);
        let nextEnd = nextStart + nextSize - 1;

        if (nextStart < 0) {
            nextEnd -= nextStart;
            nextStart = 0;
        }
        if (nextEnd > total - 1) {
            nextStart -= nextEnd - (total - 1);
            nextEnd = total - 1;
        }

        setCashFlowWindow(nextStart, nextEnd);
    }, [cashFlowWindow.endIndex, cashFlowWindow.startIndex, iv.curve.length, setCashFlowWindow]);

    const handleChartClick = useCallback((state: any) => {
        if (state?.activeLabel) setSelectedPeriod(String(state.activeLabel));
    }, []);

    const toggleCurve = useCallback((key: string) => {
        setHiddenCurves(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const curveVis = (key: string) => (hiddenCurves.has(key) ? 0 : 1);
    const statusColor = severityColors(iv.generalStatus.severity, pal).fg;

    // ── Data-quality alerts (compact) ───────────────────────────
    const dataQualityAlerts: string[] = [];
    if (iv.disbursementRealized == null) dataQualityAlerts.push('Desembolso realizado não informado — Curva S exibe apenas o previsto.');
    if (!iv.riskExposure) dataQualityAlerts.push('Contingências/riscos sem valor informado — resultado projetado não considera contingências.');
    if (!(project.billing_eventogram ?? []).length) dataQualityAlerts.push('Eventograma de faturamento vazio.');

    // ── Hero tiles (sparks = dados reais da curva; sem dados inventados) ──

    const sparkRevenue = iv.curve.length > 1 ? iv.curve.map(p => p.receitaPrevista) : undefined;
    const sparkCost = iv.curve.length > 1 ? iv.curve.map(p => p.desembolsoPrevisto) : undefined;
    const sparkNet = iv.curve.length > 1 ? iv.curve.map(p => p.saldoLiquido) : undefined;

    const leftTiles: HeroTileData[] = [
        { key: 'contract', label: 'Valor do contrato', value: compactBRL(iv.contractTotal), helper: 'teto contratado', accent: pal.primary, icon: <FileText className="h-3.5 w-3.5" />, title: 'Receita total contratada usada como base de retorno.' },
        { key: 'cash-in', label: 'Caixa Insight previsto', value: compactBRL(iv.insightCashRevenue), helper: 'entra no caixa da Insight', accent: pal.success, icon: <Wallet className="h-3.5 w-3.5" />, spark: sparkRevenue, title: 'Receita contratual que efetivamente entra no caixa da Insight.' },
        { key: 'cash-out', label: 'Desembolso Insight', value: compactBRL(iv.insightDisbursement), helper: 'sem faturamento direto', accent: pal.cost, icon: <CircleDollarSign className="h-3.5 w-3.5" />, spark: sparkCost, chip: iv.insightDisbursement > iv.insightCashRevenue ? { label: 'crítico', color: pal.critical } : undefined, title: 'Desembolso previsto da Insight, excluindo faturamento direto de terceiros.' },
        { key: 'net', label: 'Resultado final Insight', value: compactBRL(iv.netResult), helper: 'caixa Insight − desembolso', accent: iv.netResult >= 0 ? pal.success : pal.critical, valueColor: iv.netResult >= 0 ? pal.success : pal.critical, icon: <PiggyBank className="h-3.5 w-3.5" />, spark: sparkNet, title: 'Resultado antes de contingências não informadas, excluindo repasse direto a terceiros.' },
    ];

    const rightTiles: HeroTileData[] = [
        { key: 'margin', label: 'Margem estimada', value: formatPct(iv.marginPct), missing: iv.marginPct == null, helper: 'sobre caixa Insight', accent: pal.purple, icon: <Percent className="h-3.5 w-3.5" />, chip: iv.marginPct != null && iv.marginPct < 8 ? { label: iv.marginPct < 0 ? 'crítico' : 'atenção', color: iv.marginPct < 0 ? pal.critical : pal.warning } : undefined, title: 'Margem calculada sobre o caixa efetivo da Insight.' },
        { key: 'peak', label: 'Pico de caixa', value: iv.peakGap ? compactBRL(iv.peakGap) : 'sem gap', helper: iv.peakGap ? `necessidade em ${formatPeriod(iv.peakGapPeriod)}` : 'sem saldo negativo', accent: iv.peakGap ? pal.critical : pal.success, valueColor: iv.peakGap ? pal.critical : pal.success, icon: <TrendingDown className="h-3.5 w-3.5" />, chip: iv.peakGap > 0 ? { label: 'cash gap', color: pal.critical } : undefined, title: 'Maior saldo acumulado negativo entre receita prevista e desembolso previsto.' },
        { key: 'breakeven', label: 'Break-even', value: formatPeriod(iv.breakEvenPeriod), missing: !iv.breakEvenPeriod, helper: 'lucro acumulado sustentado', accent: pal.info, icon: <Flag className="h-3.5 w-3.5" />, chip: !iv.breakEvenPeriod ? { label: 'revisar', color: pal.warning } : undefined, title: 'Primeiro mês em que o saldo acumulado fica lucrativo e permanece no lucro até o fim do projeto.' },
        { key: 'tobill', label: 'Receita a faturar', value: compactBRL(iv.toBill), helper: `${formatPct(iv.pendingRevenuePct)} do contrato`, accent: pal.warning, icon: <Banknote className="h-3.5 w-3.5" />, chip: iv.billingRisk === 'warning' || iv.billingRisk === 'critical' ? { label: SEVERITY_LABEL[iv.billingRisk], color: severityColors(iv.billingRisk, pal).fg } : undefined, title: 'Saldo contratual ainda não faturado.' },
    ];

    const gaugeMicro = [
        { label: 'Faturado', value: iv.contractTotal > 0 ? `${((iv.billed / iv.contractTotal) * 100).toFixed(0)}%` : '—', color: pal.success },
        { label: 'Riscos', value: String(iv.openFinancialRisks.length), color: iv.openFinancialRisks.length ? pal.warning : pal.success },
        { label: 'Atrasados', value: String(iv.delayedEvents.length), color: iv.delayedEvents.length ? pal.critical : pal.success },
    ];

    const sensitivityRows = useMemo(() => {
        const baseRevenue = iv.insightCashRevenue;
        const baseCost = iv.insightDisbursement;
        const scenarios = [
            { label: 'Base', result: iv.netResult },
            { label: '+10% custo', result: baseRevenue - baseCost * 1.10 },
            { label: '+20% custo', result: baseRevenue - baseCost * 1.20 },
            { label: '-10% receita', result: baseRevenue * 0.90 - baseCost },
            { label: 'Riscos aplicados', result: iv.netResult - iv.riskExposure },
        ];

        return scenarios.map(scenario => ({
            ...scenario,
            margin: baseRevenue > 0 ? (scenario.result / baseRevenue) * 100 : null,
        }));
    }, [iv]);

    const maxComposition = Math.max(...iv.costComposition.map(c => c.value), 1);

    const zoomControl = (opts: {
        accent: string;
        rangeLabel: string;
        zoomed: boolean;
        canZoomIn: boolean;
        onIn: () => void;
        onOut: () => void;
        onReset: () => void;
        label: string;
    }) => (
        <>
            <div
                className="flex h-7 items-center overflow-hidden rounded-full border border-[color:var(--ig-border-default)] bg-[color:var(--ig-bg-raised)]/60"
                title={`Controle de zoom — ${opts.label}`}
            >
                <button
                    type="button"
                    onClick={opts.onOut}
                    disabled={!opts.zoomed}
                    className="flex h-7 w-8 items-center justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--ig-accent)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ color: opts.accent }}
                    aria-label={`Reduzir zoom — ${opts.label}`}
                >
                    <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[100px] border-x border-[color:var(--ig-border-subtle)] px-2 text-center font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--ig-fg-muted)]">
                    {opts.rangeLabel}
                </span>
                <button
                    type="button"
                    onClick={opts.onIn}
                    disabled={!opts.canZoomIn}
                    className="flex h-7 w-8 items-center justify-center transition-colors hover:bg-[color-mix(in_srgb,var(--ig-accent)_12%,transparent)] disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ color: opts.accent }}
                    aria-label={`Aumentar zoom — ${opts.label}`}
                >
                    <ZoomIn className="h-3.5 w-3.5" />
                </button>
            </div>
            {opts.zoomed && (
                <button
                    onClick={opts.onReset}
                    className="flex h-7 w-7 items-center justify-center rounded-full border transition-colors"
                    style={{ borderColor: hexWithAlpha(opts.accent, 0.30), background: hexWithAlpha(opts.accent, 0.08), color: opts.accent }}
                    aria-label={`Limpar zoom — ${opts.label}`}
                    title="Voltar a ver todos os meses"
                >
                    <RotateCcw className="h-3.5 w-3.5" />
                </button>
            )}
        </>
    );

    return (
        <section className="min-w-0 space-y-4">
            {/* ═══ HERO — gauge de atratividade + KPIs executivos ═══ */}
            <GlassPanel className="!rounded-[24px]" elev={3}>
                <div className="grid grid-cols-1 items-stretch gap-3 p-3 lg:grid-cols-[1fr_minmax(270px,320px)_1fr] lg:gap-4 lg:p-4">
                    <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2">
                        {leftTiles.map((t, i) => <HeroTile key={t.key} tile={t} index={i} />)}
                    </div>
                    <ScoreGauge
                        score={iv.score}
                        statusLabel={iv.generalStatus.label}
                        statusColor={statusColor}
                        micro={gaugeMicro}
                    />
                    <div className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2">
                        {rightTiles.map((t, i) => <HeroTile key={t.key} tile={t} index={i} />)}
                    </div>
                </div>
                {/* Insights (narrativa determinística) */}
                <div className="flex items-start gap-3 border-t border-[color:var(--ig-border-subtle)] px-5 py-3.5">
                    <span
                        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
                        style={{ background: `color-mix(in oklab, ${pal.info} 14%, transparent)`, color: pal.info, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${pal.info} 28%, transparent)` }}
                    >
                        <FileText className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold tracking-[0.16em] text-[color:var(--ig-fg-subtle)]">INSIGHTS</p>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-[color:var(--ig-fg-default)]">{narrative.sentence1}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-[color:var(--ig-fg-muted)]">{narrative.sentence2} {narrative.sentence3}</p>
                    </div>
                </div>
            </GlassPanel>

            {/* ═══ Curva S em largura total ═══ */}
            <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
                <div className="flex min-w-0 w-full lg:col-span-12">
                    <GlassPanel>
                        <PanelHeader
                            icon={<Wallet className="h-4 w-4" />}
                            accent={pal.primary}
                            title="Curva S · Receita × Desembolso"
                            subtitle="acumulado mensal · clique em um mês para detalhar"
                            actions={zoomControl({
                                accent: pal.primary,
                                rangeLabel: curveRangeLabel,
                                zoomed: isCurveZoomed,
                                canZoomIn: visibleCurve.length > 3,
                                onIn: () => zoomCurve('in'),
                                onOut: () => zoomCurve('out'),
                                onReset: () => setBrushWindow(null),
                                label: 'Curva S',
                            })}
                        />
                        <div className="flex min-w-0 flex-1 flex-col px-5 pb-4 pt-3">
                            <div className="mb-3 flex flex-wrap items-center gap-1.5">
                                {curveSeries.map(s => {
                                    const hidden = hiddenCurves.has(s.key);
                                    return (
                                        <button
                                            key={s.key}
                                            onClick={() => toggleCurve(s.key)}
                                            className={cn('flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-all', hidden && 'opacity-35')}
                                            style={{ borderColor: hexWithAlpha(s.color, hidden ? 0.15 : 0.3), background: hidden ? 'transparent' : hexWithAlpha(s.color, 0.07), color: hidden ? 'var(--ig-fg-subtle)' : s.color }}
                                        >
                                            <span className="h-1 w-3 rounded-full" style={{ background: s.color }} />
                                            {s.name}
                                        </button>
                                    );
                                })}
                                <span className="mx-1 h-4 w-px bg-[color:var(--ig-border-default)]" />
                                {effectiveCutoff && <MarkerChip label="Corte" value={formatPeriod(effectiveCutoff)} color={pal.costSoft} />}
                                <MarkerChip label="Break-even" value={formatPeriod(iv.breakEvenPeriod)} color={pal.success} />
                                {iv.peakGap > 0 && <MarkerChip label="Pico" value={`${compactBRL(iv.peakGap)} · ${formatPeriod(iv.peakGapPeriod)}`} color={pal.critical} />}
                            </div>

                            {iv.curve.length > 0 ? (
                                <div className="h-[clamp(360px,46vh,520px)] min-w-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={visibleCurve} margin={{ top: 14, right: 12, left: 0, bottom: 4 }} onClick={handleChartClick} style={{ cursor: 'pointer' }}>
                                            <defs>
                                                <linearGradient id="icRevenue" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={pal.primary} stopOpacity={pal.isLight ? 0.16 : 0.22} />
                                                    <stop offset="100%" stopColor={pal.primary} stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="icCost" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={pal.cost} stopOpacity={pal.isLight ? 0.12 : 0.16} />
                                                    <stop offset="100%" stopColor={pal.cost} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke={pal.chartGrid} vertical={false} />
                                            <XAxis dataKey="period" tickFormatter={xAxisFmt} tick={{ fontSize: 10, fill: pal.fgSubtle }} axisLine={{ stroke: pal.axisLine }} tickLine={false} />
                                            <YAxis tickFormatter={yAxisFmt} tick={{ fontSize: 10, fill: pal.fgSubtle }} axisLine={false} tickLine={false} width={68} />
                                            <ReferenceLine y={iv.contractTotal} stroke={hexWithAlpha(pal.primary, 0.30)} strokeDasharray="6 5" />
                                            {effectiveCutoff && (
                                                <ReferenceLine x={effectiveCutoff} stroke={hexWithAlpha(pal.costSoft, 0.60)} strokeDasharray="4 4" label={{ value: 'CORTE', position: 'insideTopLeft', fill: hexWithAlpha(pal.costSoft, 0.85), fontSize: 9, fontWeight: 700, offset: 8 }} />
                                            )}
                                            {iv.breakEvenPeriod && (
                                                <ReferenceLine x={iv.breakEvenPeriod} stroke={hexWithAlpha(pal.success, 0.55)} strokeDasharray="2 3" label={<BreakEvenLabel fill={hexWithAlpha(pal.success, 0.85)} />} />
                                            )}
                                            <RechartsTooltip content={<CurveTooltip pal={pal} />} />
                                            <Area type="monotone" dataKey="receitaPrevista" name="Receita prevista" stroke={pal.primary} fill="url(#icRevenue)" strokeWidth={2.4} strokeOpacity={curveVis('receitaPrevista')} fillOpacity={curveVis('receitaPrevista')} dot={false} activeDot={{ r: 4, fill: pal.primary, stroke: pal.dotStroke, strokeWidth: 2 }} />
                                            <Line type="monotone" dataKey="receitaRealizada" name="Receita realizada" stroke={pal.successSoft} strokeWidth={1.8} strokeOpacity={curveVis('receitaRealizada')} dot={false} activeDot={{ r: 3.5, fill: pal.successSoft, stroke: pal.dotStroke, strokeWidth: 2 }} />
                                            <Area type="monotone" dataKey="desembolsoPrevisto" name="Desembolso previsto" stroke={pal.cost} fill="url(#icCost)" strokeWidth={2.2} strokeOpacity={curveVis('desembolsoPrevisto')} fillOpacity={curveVis('desembolsoPrevisto')} dot={false} activeDot={{ r: 4, fill: pal.cost, stroke: pal.dotStroke, strokeWidth: 2 }} />
                                            <Line type="monotone" dataKey="desembolsoRealizado" name="Desembolso realizado" stroke={pal.costSoft} strokeWidth={1.8} strokeDasharray="5 3" strokeOpacity={curveVis('desembolsoRealizado')} dot={false} activeDot={{ r: 3.5, fill: pal.costSoft, stroke: pal.dotStroke, strokeWidth: 2 }} />
                                            <Line type="monotone" dataKey="saldoLiquido" name="Saldo líquido" stroke={pal.info} strokeWidth={2.6} strokeOpacity={curveVis('saldoLiquido')} dot={false} activeDot={{ r: 4.5, fill: pal.info, stroke: pal.dotStroke, strokeWidth: 2 }} />
                                            {iv.peakGap > 0 && iv.peakGapPeriod && !hiddenCurves.has('saldoLiquido') && (
                                                <ReferenceDot x={iv.peakGapPeriod} y={iv.peakGapValue} r={5} fill={pal.critical} stroke={pal.dotStroke} strokeWidth={2} label={{ value: 'PICO', position: 'bottom', fill: hexWithAlpha(pal.critical, 0.9), fontSize: 9, fontWeight: 700 }} />
                                            )}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="flex h-[140px] items-center justify-center rounded-xl border border-dashed border-[color:var(--ig-border-default)] text-xs text-[color:var(--ig-fg-subtle)]">
                                    Sem curva financeira disponível — informe curva de receita/custo ou eventograma.
                                </div>
                            )}
                        </div>
                    </GlassPanel>
                </div>
            </div>

            {/* ═══ Fluxo Mensal em largura total ═══ */}
            <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
                {iv.curve.length > 0 && (
                    <div className="flex min-w-0 w-full lg:col-span-12">
                        <GlassPanel>
                            <PanelHeader
                                icon={<BarChart3 className="h-4 w-4" />}
                                accent={pal.success}
                                title="Fluxo Mensal do Projeto"
                                subtitle="receita × desembolso por mês · clique para detalhar"
                                actions={zoomControl({
                                    accent: pal.success,
                                    rangeLabel: cashFlowRangeLabel,
                                    zoomed: isCashFlowZoomed,
                                    canZoomIn: visibleCashFlow.length > 3,
                                    onIn: () => zoomCashFlow('in'),
                                    onOut: () => zoomCashFlow('out'),
                                    onReset: () => setCashFlowBrushWindow(null),
                                    label: 'Fluxo Mensal',
                                })}
                            />
                            <div className="flex min-w-0 flex-1 flex-col px-5 pb-4 pt-3">
                                <div className="h-[clamp(340px,42vh,500px)] min-w-0">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart data={visibleCashFlow} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} onClick={handleChartClick} style={{ cursor: 'pointer' }}>
                                            <defs>
                                                <linearGradient id="icBarRev" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={pal.primary} stopOpacity={0.95} />
                                                    <stop offset="100%" stopColor={pal.primary} stopOpacity={0.45} />
                                                </linearGradient>
                                                <linearGradient id="icBarCost" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={pal.cost} stopOpacity={0.95} />
                                                    <stop offset="100%" stopColor={pal.cost} stopOpacity={0.45} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke={pal.chartGrid} vertical={false} />
                                            <XAxis dataKey="period" tickFormatter={xAxisFmt} tick={{ fontSize: 10, fill: pal.fgSubtle }} axisLine={{ stroke: pal.axisLine }} tickLine={false} />
                                            <YAxis tickFormatter={yAxisFmt} tick={{ fontSize: 10, fill: pal.fgSubtle }} axisLine={false} tickLine={false} width={68} />
                                            <RechartsTooltip formatter={(value: number) => compactBRL(value)} labelFormatter={(label) => periodLabel(String(label))} contentStyle={tooltipStyle} />
                                            <Bar dataKey="receitaMensal" name="Receita mensal" fill="url(#icBarRev)" radius={[4, 4, 0, 0]} maxBarSize={visibleCashFlow.length <= 12 ? 30 : 20} />
                                            <Bar dataKey="desembolsoMensal" name="Desembolso mensal" fill="url(#icBarCost)" radius={[4, 4, 0, 0]} maxBarSize={visibleCashFlow.length <= 12 ? 30 : 20} />
                                            <Line
                                                type="monotone"
                                                dataKey="resultadoMensal"
                                                name="Saldo líquido mensal"
                                                stroke={pal.info}
                                                strokeWidth={2.4}
                                                dot={(props: any) => {
                                                    const { cx, cy, payload, index } = props;
                                                    if (cx == null || cy == null) return <g key={`dot-${index}`} />;
                                                    const neg = (payload?.resultadoMensal ?? 0) < 0;
                                                    return <circle key={`dot-${index}`} cx={cx} cy={cy} r={3} fill={neg ? pal.critical : pal.info} stroke={pal.dotStroke} strokeWidth={1} />;
                                                }}
                                                activeDot={{ r: 4.5, fill: pal.info, stroke: pal.dotStroke, strokeWidth: 2 }}
                                            />
                                            <ReferenceLine y={0} stroke={pal.zeroLine} />
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-[10px] text-[color:var(--ig-fg-muted)]">
                                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: pal.primary }} />Receita</span>
                                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: pal.cost }} />Desembolso</span>
                                    <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 rounded-full" style={{ background: pal.info }} />Saldo líquido</span>
                                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: pal.critical }} />mês negativo</span>
                                </div>
                            </div>
                        </GlassPanel>
                    </div>
                )}
            </div>

            {/* ═══ Sensibilidade + Resultado Projetado lado a lado ═══ */}
            <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
                {/* Sensibilidade + risco financeiro */}
                <div className="flex min-w-0 w-full lg:col-span-6">
                    <GlassPanel>
                        <PanelHeader
                            icon={<Gauge className="h-4 w-4" />}
                            accent={pal.purple}
                            title="Sensibilidade"
                            subtitle="impacto de desvios no resultado"
                        />
                        <div className="flex min-w-0 flex-1 flex-col px-4 pb-4 pt-3">
                            <div className="min-h-[190px] min-w-0 flex-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={sensitivityRows} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={pal.chartGrid} vertical={false} />
                                        <XAxis type="number" tickFormatter={yAxisFmt} tick={{ fontSize: 9, fill: pal.fgSubtle }} axisLine={{ stroke: pal.axisLine }} tickLine={false} />
                                        <YAxis dataKey="label" type="category" tick={{ fontSize: 9, fill: pal.fgMuted }} axisLine={false} tickLine={false} width={78} />
                                        <ReferenceLine x={0} stroke={pal.zeroLine} />
                                        <RechartsTooltip
                                            formatter={(value: number, _name, props: any) => [
                                                `${compactBRL(value)} · margem ${formatPct(props?.payload?.margin)}`,
                                                'Resultado',
                                            ]}
                                            contentStyle={tooltipStyle}
                                        />
                                        <Bar dataKey="result" name="Resultado" radius={[3, 3, 3, 3]} maxBarSize={16}>
                                            {sensitivityRows.map(point => (
                                                <Cell key={point.label} fill={hexWithAlpha(point.result >= 0 ? pal.success : pal.critical, 0.78)} />
                                            ))}
                                        </Bar>
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                            {/* risco financeiro do projeto */}
                            <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-[color:var(--ig-border-subtle)] pt-3">
                                <div className="rounded-xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 px-2.5 py-2 text-center">
                                    <div className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">Exposição de riscos</div>
                                    <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums" style={{ color: iv.riskExposure ? pal.critical : 'var(--ig-fg-subtle)' }}>
                                        {iv.riskExposure ? compactBRL(iv.riskExposure) : 'não informado'}
                                    </div>
                                </div>
                                <div className="rounded-xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 px-2.5 py-2 text-center">
                                    <div className="text-[9px] uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">Riscos financeiros</div>
                                    <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums" style={{ color: iv.openFinancialRisks.length ? pal.warning : pal.success }}>
                                        {iv.openFinancialRisks.length ? `${iv.openFinancialRisks.length} aberto(s)` : 'baixo'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </GlassPanel>
                </div>

                <div className="flex min-w-0 w-full lg:col-span-6">
                    <GlassPanel>
                        <PanelHeader
                            icon={<Layers className="h-4 w-4" />}
                            accent={pal.info}
                            title="Resultado Projetado"
                            subtitle="ponte do caixa Insight até o resultado final"
                            actions={
                                <span
                                    className="rounded-full border px-3 py-1 font-mono text-xs font-bold tabular-nums"
                                    style={{
                                        color: iv.netResult - iv.riskExposure >= 0 ? pal.success : pal.critical,
                                        background: hexWithAlpha(iv.netResult - iv.riskExposure >= 0 ? pal.success : pal.critical, 0.08),
                                        borderColor: hexWithAlpha(iv.netResult - iv.riskExposure >= 0 ? pal.success : pal.critical, 0.3),
                                    }}
                                >
                                    {compactBRL(iv.netResult - iv.riskExposure)}
                                </span>
                            }
                        />
                        <div className="flex min-w-0 flex-1 flex-col">
                            <div className="h-[210px] min-w-0 px-4 pt-3">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={waterfall} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={pal.chartGrid} vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 9, fill: pal.fgMuted }} axisLine={{ stroke: pal.axisLine }} tickLine={false} interval={0} />
                                        <YAxis tickFormatter={yAxisFmt} tick={{ fontSize: 9, fill: pal.fgSubtle }} axisLine={false} tickLine={false} width={64} />
                                        <ReferenceLine y={0} stroke={pal.zeroLine} />
                                        <RechartsTooltip
                                            content={({ active, payload }: any) => {
                                                if (!active || !payload?.length) return null;
                                                const row = payload[0]?.payload;
                                                if (!row) return null;
                                                return (
                                                    <div style={tooltipStyle} className="min-w-[190px] p-3">
                                                        <p className="text-[11px] font-semibold" style={{ color: pal.fgStrong }}>{row.name}</p>
                                                        <p className="mt-1 font-mono text-sm font-bold tabular-nums" style={{ color: row.fill }}>
                                                            {row.name === 'Contingências' && !iv.riskExposure ? 'não informado' : compactBRL(row.real)}
                                                        </p>
                                                        {row.note && <p className="mt-1 text-[10px]" style={{ color: pal.fgMuted }}>{row.note}</p>}
                                                    </div>
                                                );
                                            }}
                                        />
                                        {/* invisible base for the floating bridge bars */}
                                        <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
                                        <Bar dataKey="delta" stackId="wf" name="Valor" maxBarSize={52} radius={[5, 5, 0, 0]}>
                                            {waterfall.map(item => (
                                                <Cell
                                                    key={item.name}
                                                    fill={item.ghost ? hexWithAlpha(item.fill, 0.28) : item.fill}
                                                    stroke={item.ghost ? hexWithAlpha(item.fill, 0.6) : item.total ? hexWithAlpha(pal.isLight ? '#0F172A' : '#FFFFFF', 0.25) : 'none'}
                                                    strokeWidth={item.ghost ? 1 : item.total ? 1 : 0}
                                                    strokeDasharray={item.ghost ? '4 3' : undefined}
                                                />
                                            ))}
                                        </Bar>
                                        {/* running-total connector */}
                                        <Line type="stepAfter" dataKey="cumulative" name="Acumulado" stroke={pal.isLight ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.35)'} strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>

                            {/* composição dos desembolsos — lista densa com barra de impacto */}
                            <div className="mt-2 flex-1 border-t border-[color:var(--ig-border-subtle)]">
                                <p className="px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">
                                    Composição dos desembolsos previstos
                                </p>
                                <div className="divide-y divide-[color:var(--ig-border-subtle)]">
                                    {iv.costComposition.map(item => {
                                        const pct = iv.disbursementPlanned > 0 ? (item.value / iv.disbursementPlanned) * 100 : 0;
                                        const widthPct = (item.value / maxComposition) * 100;
                                        return (
                                            <div key={item.category} className="relative px-5 py-2">
                                                <div
                                                    className="absolute inset-y-1.5 left-5 rounded-sm opacity-[0.10]"
                                                    style={{ width: `${widthPct}%`, background: `linear-gradient(90deg, ${pal.cost}, transparent)` }}
                                                />
                                                <div className="relative flex items-center justify-between gap-2">
                                                    <span className="min-w-0 truncate text-[12px] font-medium text-[color:var(--ig-fg-default)]">{item.category}</span>
                                                    <span className="flex shrink-0 items-baseline gap-2">
                                                        <span className="font-mono text-[12px] font-semibold tabular-nums text-[color:var(--ig-fg-strong)]">{compactBRL(item.value)}</span>
                                                        <span className="font-mono text-[10px] tabular-nums text-[color:var(--ig-fg-muted)]">{pct.toFixed(1)}%</span>
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    <div className="relative px-5 py-2">
                                        <div className="relative flex items-center justify-between gap-2">
                                            <span className="min-w-0 truncate text-[12px] font-medium text-[color:var(--ig-fg-default)]">Contingências / riscos</span>
                                            <span className="shrink-0 font-mono text-[12px] font-semibold tabular-nums" style={{ color: iv.riskExposure ? pal.critical : 'var(--ig-fg-subtle)' }}>
                                                {iv.riskExposure ? compactBRL(iv.riskExposure) : 'não informado'}
                                            </span>
                                        </div>
                                    </div>
                                    {iv.costComposition.length === 0 && (
                                        <div className="px-5 py-3 text-[11px] text-[color:var(--ig-fg-muted)]">
                                            Composição de desembolsos não disponível — informe o cost breakdown do projeto.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </GlassPanel>
                </div>
            </div>

            {/* ═══ Eventograma de Faturamento (12) ═══ */}
            <GlassPanel>
                <PanelHeader
                    icon={<Receipt className="h-4 w-4" />}
                    accent={pal.warning}
                    title="Eventograma de Faturamento"
                    subtitle={`${eventStats.total} evento(s) · clique em um evento para detalhar`}
                    actions={
                        <>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[color:var(--ig-fg-subtle)]" />
                                <input
                                    value={eventQuery}
                                    onChange={e => setEventQuery(e.target.value)}
                                    placeholder="Filtrar eventos…"
                                    className="h-7 w-44 rounded-lg border border-[color:var(--ig-border-default)] bg-[color:var(--ig-bg-raised)]/60 pl-7 pr-2 text-[11px] text-[color:var(--ig-fg-strong)] placeholder:text-[color:var(--ig-fg-disabled)] focus:border-[color:var(--ig-border-focus)] focus:outline-none"
                                />
                            </div>
                            {(project.billing_eventogram ?? []).length > iv.criticalEvents.length && (
                                <button
                                    onClick={() => setShowAllEvents(v => !v)}
                                    className="flex items-center gap-1 rounded-lg border border-[color:var(--ig-border-default)] bg-[color:var(--ig-bg-raised)]/60 px-2.5 py-1 text-[11px] text-[color:var(--ig-fg-default)] transition-colors hover:border-[color:var(--ig-border-strong)]"
                                >
                                    {showAllEvents ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                    {showAllEvents ? 'ver críticos' : `ver todos (${eventStats.total})`}
                                </button>
                            )}
                        </>
                    }
                />
                <div className="min-w-0 px-5 pb-5 pt-4">
                    {/* mini stat tiles */}
                    <div className="mb-4 grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                        <StatTile label="Próximo evento" value={iv.nextEvent ? compactBRL(centsToReais(iv.nextEvent.amountPlannedCents)) : 'sem evento'} sub={iv.nextEvent ? periodLabel(iv.nextEvent.datePlanned.slice(0, 7)) : '—'} color={pal.info} />
                        <StatTile label="Atrasados" value={iv.delayedEvents.length ? `${iv.delayedEvents.length} evento(s)` : 'nenhum'} sub={eventStats.delayedValue ? compactBRL(eventStats.delayedValue) : 'sem valor retido'} color={iv.delayedEvents.length ? pal.critical : pal.success} />
                        <StatTile label="Maior evento" value={eventStats.biggest ? compactBRL(centsToReais(eventStats.biggest.amountPlannedCents)) : '—'} sub={eventStats.biggest ? periodLabel(eventStats.biggest.datePlanned.slice(0, 7)) : 'eventograma vazio'} color={pal.primary} />
                        <StatTile label="Pendente de faturar" value={compactBRL(eventStats.pendingValue)} sub="eventos não faturados" color={pal.warning} />
                        <StatTile label="Faturado" value={compactBRL(eventStats.billedValue)} sub="eventos realizados" color={pal.success} />
                    </div>

                    {/* event table — capped height, scrolls inside the card */}
                    <div className={cn('overflow-auto rounded-xl border border-[color:var(--ig-border-subtle)]', showAllEvents ? 'max-h-[420px]' : 'max-h-[300px]')}>
                        <table className="w-full min-w-[620px] text-xs">
                            <thead className="sticky top-0 z-10">
                                <tr className="border-b border-[color:var(--ig-border-default)]">
                                    {['#', 'Evento', 'Mês', 'Valor', 'Status', 'Vínculos'].map(h => (
                                        <th key={h} className="bg-[color:var(--ig-bg-raised)] px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-[color:var(--ig-fg-subtle)]">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {eventRows.map((event, index) => {
                                    const colors = severityColors(eventSeverity(event.status), pal);
                                    return (
                                        <tr
                                            key={event.id}
                                            onClick={() => setSelectedEvent(event)}
                                            className="cursor-pointer border-b border-[color:var(--ig-border-subtle)] transition-colors last:border-0 hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_5%,transparent)]"
                                        >
                                            <td className="px-3 py-2.5 font-mono tabular-nums text-[color:var(--ig-fg-subtle)]">{index + 1}</td>
                                            <td className="px-3 py-2.5 text-[color:var(--ig-fg-default)]">{event.title}</td>
                                            <td className="px-3 py-2.5 font-mono tabular-nums text-[color:var(--ig-fg-muted)]">{periodLabel(event.datePlanned.slice(0, 7))}</td>
                                            <td className="px-3 py-2.5 font-mono font-semibold tabular-nums text-[color:var(--ig-fg-strong)]">{compactBRL(centsToReais(event.amountPlannedCents))}</td>
                                            <td className="px-3 py-2.5">
                                                <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold" style={{ color: colors.fg, background: colors.bg, borderColor: colors.border }}>
                                                    {eventStatusLabel(event.status)}
                                                </span>
                                            </td>
                                            <td className="max-w-[160px] truncate px-3 py-2.5 text-[color:var(--ig-fg-muted)]">
                                                {event.linked.milestoneId || event.linked.taskId || event.contractId || 'não vinculado'}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {eventRows.length === 0 && (
                                    <tr><td colSpan={6} className="py-6 text-center text-[color:var(--ig-fg-subtle)]">
                                        {eventQuery ? 'Nenhum evento corresponde ao filtro' : 'Sem eventos pendentes no eventograma'}
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </GlassPanel>

            {/* ── Data quality (compact) ── */}
            {dataQualityAlerts.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    {dataQualityAlerts.map(alert => (
                        <span key={alert} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px]" style={{ borderColor: hexWithAlpha(pal.warning, 0.24), background: hexWithAlpha(pal.warning, 0.07), color: pal.warning }}>
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            {alert}
                        </span>
                    ))}
                </div>
            )}

            {/* ── Month detail drawer ── */}
            <HudDrawer
                isOpen={selectedPoint != null}
                onClose={() => setSelectedPeriod(null)}
                title={selectedPeriod ? `Detalhe de ${periodLabel(selectedPeriod)}` : ''}
                subtitle="Fluxo financeiro do mês"
                width="min(420px, 100vw)"
            >
                {selectedPoint && (
                    <div className="flex min-h-0 flex-col gap-4">
                        <div className="space-y-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ig-fg-muted)]">Fluxo do mês</p>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { label: 'Receita mensal', value: compactBRL(selectedPoint.receitaMensal), color: pal.success },
                                    { label: 'Desembolso mensal', value: compactBRL(selectedPoint.desembolsoMensal), color: pal.cost },
                                    { label: 'Resultado mensal', value: compactBRL(selectedPoint.resultadoMensal), color: selectedPoint.resultadoMensal >= 0 ? pal.success : pal.critical },
                                    { label: 'Saldo acumulado', value: compactBRL(selectedPoint.saldoLiquido), color: selectedPoint.saldoLiquido >= 0 ? pal.success : pal.critical },
                                ].map(item => (
                                    <div key={item.label} className="rounded-lg border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 p-2.5">
                                        <p className="text-[9px] uppercase tracking-wider text-[color:var(--ig-fg-muted)]">{item.label}</p>
                                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums" style={{ color: item.color }}>{item.value}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ig-fg-muted)]">Acumulado</p>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    { label: 'Receita prevista', value: compactBRL(selectedPoint.receitaPrevista), color: 'var(--ig-fg-default)' },
                                    { label: 'Desembolso previsto', value: compactBRL(selectedPoint.desembolsoPrevisto), color: 'var(--ig-fg-default)' },
                                    { label: 'Receita realizada', value: compactBRL(selectedPoint.receitaRealizada), color: pal.successSoft },
                                    { label: 'Desembolso realizado', value: selectedPoint.desembolsoRealizado == null ? 'dados insuf.' : compactBRL(selectedPoint.desembolsoRealizado), color: pal.costSoft },
                                ].map(item => (
                                    <div key={item.label} className="rounded-lg border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 p-2.5">
                                        <p className="text-[9px] uppercase tracking-wider text-[color:var(--ig-fg-muted)]">{item.label}</p>
                                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums" style={{ color: item.color }}>{item.value}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="min-h-0">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--ig-fg-muted)]">
                                Eventos de faturamento ({selectedMonthEvents.length})
                            </p>
                            {selectedMonthEvents.length ? (
                                <div className="max-h-[min(36dvh,260px)] space-y-2 overflow-y-auto overscroll-y-contain pr-1">
                                    {selectedMonthEvents.map(event => {
                                        const colors = severityColors(eventSeverity(event.status), pal);
                                        return (
                                            <button
                                                key={event.id}
                                                onClick={() => setSelectedEvent(event)}
                                                className="flex w-full items-center justify-between gap-3 rounded-lg border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 p-2.5 text-left transition-colors hover:border-[color:var(--ig-border-strong)]"
                                            >
                                                <div className="min-w-0">
                                                    <p className="truncate text-xs text-[color:var(--ig-fg-default)]">{event.title}</p>
                                                    <span className="mt-1 inline-block rounded-full border px-1.5 py-px text-[9px] font-semibold" style={{ color: colors.fg, background: colors.bg, borderColor: colors.border }}>
                                                        {eventStatusLabel(event.status)}
                                                    </span>
                                                </div>
                                                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-[color:var(--ig-fg-strong)]">
                                                    {compactBRL(centsToReais(event.amountPlannedCents))}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-xs text-[color:var(--ig-fg-subtle)]">Sem eventos de faturamento neste mês.</p>
                            )}
                        </div>
                    </div>
                )}
            </HudDrawer>

            {/* ── Event detail drawer ── */}
            <HudDrawer
                isOpen={selectedEvent != null}
                onClose={() => setSelectedEvent(null)}
                title={selectedEvent?.title || ''}
                subtitle="Evento de faturamento"
            >
                {selectedEvent && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between rounded-xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/55 p-3.5">
                            <div>
                                <p className="text-[10px] uppercase tracking-wider text-[color:var(--ig-fg-muted)]">Valor previsto</p>
                                <p className="mt-1 font-mono text-lg font-bold tabular-nums text-[color:var(--ig-fg-strong)]">{compactBRL(centsToReais(selectedEvent.amountPlannedCents))}</p>
                            </div>
                            <span className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase" style={{ color: severityColors(eventSeverity(selectedEvent.status), pal).fg, background: severityColors(eventSeverity(selectedEvent.status), pal).bg, borderColor: severityColors(eventSeverity(selectedEvent.status), pal).border }}>
                                {eventStatusLabel(selectedEvent.status)}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                            {[
                                { label: 'Data prevista', value: new Date(selectedEvent.datePlanned).toLocaleDateString('pt-BR') },
                                { label: 'Data realizada', value: selectedEvent.dateActual ? new Date(selectedEvent.dateActual).toLocaleDateString('pt-BR') : 'não realizado' },
                                { label: 'Valor realizado', value: selectedEvent.amountActualCents != null ? compactBRL(centsToReais(selectedEvent.amountActualCents)) : 'não informado' },
                                { label: 'Contrato', value: selectedEvent.contractId || 'não vinculado' },
                                { label: 'Marco vinculado', value: selectedEvent.linked.milestoneId || '—' },
                                { label: 'Tarefa vinculada', value: selectedEvent.linked.taskId || '—' },
                            ].map(item => (
                                <div key={item.label} className="rounded-xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 p-3">
                                    <p className="text-[9px] uppercase tracking-wider text-[color:var(--ig-fg-muted)]">{item.label}</p>
                                    <p className="mt-1 truncate text-xs font-medium text-[color:var(--ig-fg-default)]">{item.value}</p>
                                </div>
                            ))}
                        </div>
                        {selectedEvent.status === 'delayed' && (
                            <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5" style={{ borderColor: hexWithAlpha(pal.critical, 0.24), background: hexWithAlpha(pal.critical, 0.07) }}>
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: pal.critical }} />
                                <span className="text-[11px]" style={{ color: pal.critical }}>Evento atrasado — receita prevista ainda não faturada.</span>
                            </div>
                        )}
                    </div>
                )}
            </HudDrawer>
        </section>
    );
}

export default FinanceInvestorCockpit;
