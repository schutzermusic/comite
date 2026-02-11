'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
    ReferenceLine,
    ResponsiveContainer,
} from 'recharts';
import {
    DollarSign,
    TrendingUp,
    TrendingDown,
    Clock,
    BarChart3,
    Layers,
    Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type {
    ProjectV2,
    CostCurvePoint,
    RevenueCurvePoint,
    CostBreakdownItem,
} from '@/lib/types/project-v2';
import { formatMoney, compactBRL } from '@/lib/utils/project-utils';
import type { MoneyAmount } from '@/lib/types/project-v2';

// ── Helpers ─────────────────────────────────────────────────────

function cents(m: MoneyAmount | undefined): number {
    return m ? m.amountCents / 100 : 0;
}

function getConfidenceColor(c: string): string {
    if (c === 'high') return '#00FFB4';
    if (c === 'medium') return '#FFB84D';
    return '#FF4040';
}
function getConfidenceLabel(c: string): string {
    if (c === 'high') return 'Alta';
    if (c === 'medium') return 'Média';
    return 'Baixa';
}
function getMethodLabel(m: string): string {
    if (m === 'ac_plus_etc') return 'AC + ETC';
    return 'Manual';
}

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const xAxisFmt = (period: string) => {
    const [, m] = period.split('-');
    return MONTHS_PT[parseInt(m, 10) - 1] || period;
};
const yAxisFmt = (v: number) => compactBRL(v);

// ── Custom chart tooltip ────────────────────────────────────────

interface ChartTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    type: 'cost' | 'revenue';
    hiddenSeries: Set<string>;
}

function ChartTooltipContent({ active, payload, label, type, hiddenSeries }: ChartTooltipProps) {
    if (!active || !payload?.length) return null;

    // Filter out hidden series
    const visiblePayload = payload.filter(
        (entry: any) => !hiddenSeries.has(entry.dataKey) && entry.value != null
    );
    if (visiblePayload.length === 0) return null;

    // Format period label nicely
    const periodLabel = label
        ? (() => {
            const [y, m] = label.split('-');
            return `${MONTHS_PT[parseInt(m, 10) - 1]} ${y}`;
        })()
        : '';

    return (
        <div className="p-3 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#0A1F18ee] shadow-xl backdrop-blur-sm min-w-[180px]">
            <p className="text-xs text-[rgba(255,255,255,0.50)] mb-2 font-medium">{periodLabel}</p>
            {visiblePayload.map((entry: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-4 mb-1">
                    <div className="flex items-center gap-2">
                        <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: entry.color }}
                        />
                        <span className="text-xs text-[rgba(255,255,255,0.65)]">{entry.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-white tabular-nums">
                        {compactBRL(entry.value)}
                    </span>
                </div>
            ))}
            {/* Delta vs baseline */}
            {type === 'cost' && visiblePayload.length >= 2 && (() => {
                const bac = visiblePayload.find((e: any) => e.dataKey === 'BAC');
                const eac = visiblePayload.find((e: any) => e.dataKey === 'EAC');
                const ac = visiblePayload.find((e: any) => e.dataKey === 'AC');
                return (
                    <div className="mt-1.5 pt-1.5 border-t border-[rgba(255,255,255,0.08)] space-y-0.5">
                        {eac && bac && (
                            <span className="text-[10px] text-[rgba(255,255,255,0.40)] block">
                                Δ EAC−BAC: {compactBRL(eac.value - bac.value)}
                            </span>
                        )}
                        {ac && bac && (
                            <span className="text-[10px] text-[rgba(255,255,255,0.40)] block">
                                Δ AC−BAC: {compactBRL(ac.value - bac.value)}
                            </span>
                        )}
                    </div>
                );
            })()}
            {type === 'revenue' && visiblePayload.length >= 2 && (() => {
                const planned = visiblePayload.find((e: any) => e.dataKey === 'Planejado Faturar');
                const billed = visiblePayload.find((e: any) => e.dataKey === 'Faturado');
                return planned && billed ? (
                    <div className="mt-1.5 pt-1.5 border-t border-[rgba(255,255,255,0.08)]">
                        <span className="text-[10px] text-[rgba(255,255,255,0.40)]">
                            Δ Faturado−Plan: {compactBRL(billed.value - planned.value)}
                        </span>
                    </div>
                ) : null;
            })()}
        </div>
    );
}

// ── Cutoff Reference Line Label ─────────────────────────────────

function CutoffLabel({ viewBox }: any) {
    const { x } = viewBox || {};
    return (
        <text x={(x || 0) + 4} y={16} fill="rgba(255,255,255,0.55)" fontSize={9} fontWeight={600}>
            CUTOFF
        </text>
    );
}

// ── Component Props ─────────────────────────────────────────────

interface FinanceViewProps {
    project: ProjectV2;
}

// ── Main Component ──────────────────────────────────────────────

export function FinanceView({ project }: FinanceViewProps) {
    const [granularity, setGranularity] = useState<'monthly' | 'weekly'>('monthly');
    const [hiddenCostSeries, setHiddenCostSeries] = useState<Set<string>>(new Set());
    const [hiddenRevSeries, setHiddenRevSeries] = useState<Set<string>>(new Set());

    const { finance, revenue, costCurve, revenueCurve, costBreakdown } = project;

    // ── Cutoff period resolution ─────────────────────────
    const cutoffPeriod = useMemo(() => {
        if (project.cutoffPeriod) return project.cutoffPeriod;
        // Fallback: derive from finance.updatedAt or now
        const refDate = finance.updatedAt ? new Date(finance.updatedAt) : new Date();
        const y = refDate.getFullYear();
        const m = refDate.getMonth() + 1;
        return `${y}-${String(m).padStart(2, '0')}`;
    }, [project.cutoffPeriod, finance.updatedAt]);

    // ── Transform curves for recharts (cents → reais, nulls preserved) ──
    const costData = useMemo(() => {
        if (!costCurve?.length) return [];
        return costCurve.map(p => ({
            period: p.period,
            BAC: p.bacCumulative / 100,
            AC: p.acCumulative != null ? p.acCumulative / 100 : null,
            EAC: p.eacCumulative / 100,
        }));
    }, [costCurve]);

    const revenueData = useMemo(() => {
        if (!revenueCurve?.length) return [];
        return revenueCurve.map(p => ({
            period: p.period,
            'Planejado Faturar': p.plannedCumulative / 100,
            'Faturado': p.billedCumulative != null ? p.billedCumulative / 100 : null,
            'Recebido': p.receivedCumulative != null ? p.receivedCumulative / 100 : null,
        }));
    }, [revenueCurve]);

    // ── Breakdown computations with TOTAL row ────────────
    const breakdownRows = useMemo(() => {
        if (!costBreakdown?.length) return [];
        return costBreakdown.map(item => {
            const bacVal = cents(item.bac);
            const acVal = cents(item.ac);
            const eacVal = cents(item.eac);
            const varR$ = eacVal - bacVal;
            const varPct = bacVal > 0 ? ((eacVal - bacVal) / bacVal) * 100 : 0;
            return {
                category: item.category,
                bac: bacVal,
                ac: acVal,
                eac: eacVal,
                varMoney: varR$,
                varPercent: varPct,
            };
        });
    }, [costBreakdown]);

    const totals = useMemo(() => {
        if (breakdownRows.length === 0) return null;
        const totalBac = breakdownRows.reduce((s, r) => s + r.bac, 0);
        const totalAc = breakdownRows.reduce((s, r) => s + r.ac, 0);
        const totalEac = breakdownRows.reduce((s, r) => s + r.eac, 0);
        const totalVar = totalEac - totalBac;
        const totalVarPct = totalBac > 0 ? (totalVar / totalBac) * 100 : 0;
        return { bac: totalBac, ac: totalAc, eac: totalEac, varMoney: totalVar, varPercent: totalVarPct };
    }, [breakdownRows]);

    // ── Forecast panel uses computed totals for consistency ──
    const forecastDelta = totals ? totals.varMoney : cents(finance.varianceAmount);
    const forecastDeltaPct = totals ? totals.varPercent : finance.variancePercent;
    const isOverBudget = forecastDelta > 0;

    const updatedDate = finance.updatedAt
        ? new Date(finance.updatedAt).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        })
        : '—';

    // ── Revenue gap KPIs ─────────────────────────────────
    const revenueGaps = useMemo(() => {
        if (!revenue) return null;
        const planned = cents(revenue.totalContracted);
        const billed = cents(revenue.billed);
        const received = cents(revenue.received);
        const toBill = planned - billed;
        const toReceive = billed - received;
        const toBillPct = planned > 0 ? (toBill / planned) * 100 : 0;
        const toReceivePct = billed > 0 ? (toReceive / billed) * 100 : 0;
        return { toBill, toReceive, toBillPct, toReceivePct };
    }, [revenue]);

    // ── Legend toggle handlers ───────────────────────────
    const toggleCostSeries = useCallback((dataKey: string) => {
        setHiddenCostSeries(prev => {
            const next = new Set(prev);
            if (next.has(dataKey)) next.delete(dataKey);
            else next.add(dataKey);
            return next;
        });
    }, []);

    const toggleRevSeries = useCallback((dataKey: string) => {
        setHiddenRevSeries(prev => {
            const next = new Set(prev);
            if (next.has(dataKey)) next.delete(dataKey);
            else next.add(dataKey);
            return next;
        });
    }, []);

    // ── Custom interactive legend render ─────────────────
    const renderCostLegend = useCallback((props: any) => {
        const { payload } = props;
        return (
            <div className="flex items-center justify-center gap-4 mt-2">
                {payload?.map((entry: any, i: number) => {
                    const isHidden = hiddenCostSeries.has(entry.dataKey || entry.value);
                    return (
                        <button
                            key={i}
                            onClick={() => toggleCostSeries(entry.dataKey || entry.value)}
                            className={`flex items-center gap-1.5 text-[11px] transition-all px-1.5 py-0.5 rounded hover:bg-[rgba(255,255,255,0.06)] ${isHidden ? 'opacity-30 line-through' : 'opacity-100'}`}
                        >
                            <div className="w-3 h-0.5 rounded-full" style={{ background: entry.color }} />
                            <span style={{ color: isHidden ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.65)' }}>
                                {entry.value}
                            </span>
                        </button>
                    );
                })}
            </div>
        );
    }, [hiddenCostSeries, toggleCostSeries]);

    const renderRevLegend = useCallback((props: any) => {
        const { payload } = props;
        return (
            <div className="flex items-center justify-center gap-4 mt-2">
                {payload?.map((entry: any, i: number) => {
                    const isHidden = hiddenRevSeries.has(entry.dataKey || entry.value);
                    return (
                        <button
                            key={i}
                            onClick={() => toggleRevSeries(entry.dataKey || entry.value)}
                            className={`flex items-center gap-1.5 text-[11px] transition-all px-1.5 py-0.5 rounded hover:bg-[rgba(255,255,255,0.06)] ${isHidden ? 'opacity-30 line-through' : 'opacity-100'}`}
                        >
                            <div className="w-3 h-0.5 rounded-full" style={{ background: entry.color }} />
                            <span style={{ color: isHidden ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.65)' }}>
                                {entry.value}
                            </span>
                        </button>
                    );
                })}
            </div>
        );
    }, [hiddenRevSeries, toggleRevSeries]);

    // Visibility helpers for series
    const costVis = (key: string) => hiddenCostSeries.has(key) ? 0 : 1;
    const revVis = (key: string) => hiddenRevSeries.has(key) ? 0 : 1;

    // ── Chip severity color helper ───────────────────────
    function chipColor(pct: number): { bg: string; fg: string } {
        if (pct > 50) return { bg: 'rgba(255,64,64,0.15)', fg: '#FF4040' };
        if (pct > 30) return { bg: 'rgba(255,184,77,0.15)', fg: '#FFB84D' };
        return { bg: 'rgba(0,255,180,0.12)', fg: '#00FFB4' };
    }

    return (
        <div className="space-y-8">
            {/* ── Header ───────── */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Layers className="w-5 h-5 text-[#00C8FF]" />
                        Visão Financeira
                    </h3>
                    <p className="text-xs text-[rgba(255,255,255,0.40)] mt-0.5 uppercase tracking-wider">
                        CUSTOS vs RECEITAS
                    </p>
                </div>
                {/* Granularity toggle */}
                <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.05)] rounded-full p-0.5 border border-[rgba(255,255,255,0.08)]">
                    <button
                        onClick={() => setGranularity('monthly')}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${granularity === 'monthly'
                            ? 'bg-[#00FFB4] text-[#050D0A]'
                            : 'text-[rgba(255,255,255,0.50)] hover:text-white'
                            }`}
                    >
                        Mensal
                    </button>
                    <button
                        onClick={() => setGranularity('weekly')}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${granularity === 'weekly'
                            ? 'bg-[#00FFB4] text-[#050D0A]'
                            : 'text-[rgba(255,255,255,0.50)] hover:text-white'
                            }`}
                    >
                        Semanal
                    </button>
                </div>
            </div>

            {/* ── Twin S-Curve Charts ───────── */}
            {(costData.length > 0 || revenueData.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Chart A — COST */}
                    {costData.length > 0 && (
                        <div className="p-5 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                            <div className="flex items-center gap-2 mb-4">
                                <DollarSign className="w-4 h-4 text-[#00C8FF]" />
                                <h4 className="text-sm font-semibold text-white uppercase tracking-wide">
                                    Custo Acumulado
                                </h4>
                                <Badge
                                    variant="outline"
                                    className="text-[10px] ml-auto border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.40)]"
                                >
                                    COST
                                </Badge>
                            </div>
                            <ResponsiveContainer width="100%" height={240}>
                                <AreaChart data={costData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="gradBAC" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#00C8FF" stopOpacity={0.15} />
                                            <stop offset="95%" stopColor="#00C8FF" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gradAC" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#00FFB4" stopOpacity={0.15} />
                                            <stop offset="95%" stopColor="#00FFB4" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gradEAC" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#FF8C42" stopOpacity={0.15} />
                                            <stop offset="95%" stopColor="#FF8C42" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                    <XAxis
                                        dataKey="period"
                                        tickFormatter={xAxisFmt}
                                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.40)' }}
                                        axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tickFormatter={yAxisFmt}
                                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.40)' }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={70}
                                    />
                                    {/* Cutoff vertical marker */}
                                    <ReferenceLine
                                        x={cutoffPeriod}
                                        stroke="rgba(255,255,255,0.35)"
                                        strokeDasharray="4 4"
                                        strokeWidth={1.5}
                                        label={<CutoffLabel />}
                                    />
                                    <RechartsTooltip
                                        content={<ChartTooltipContent type="cost" hiddenSeries={hiddenCostSeries} />}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="BAC"
                                        stroke="#00C8FF"
                                        fill="url(#gradBAC)"
                                        strokeWidth={2}
                                        strokeOpacity={costVis('BAC')}
                                        fillOpacity={costVis('BAC') * 0.6}
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#00C8FF', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="AC"
                                        stroke="#00FFB4"
                                        fill="url(#gradAC)"
                                        strokeWidth={2}
                                        strokeOpacity={costVis('AC')}
                                        fillOpacity={costVis('AC') * 0.6}
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#00FFB4', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="EAC"
                                        stroke="#FF8C42"
                                        fill="url(#gradEAC)"
                                        strokeWidth={2}
                                        strokeDasharray="5 3"
                                        strokeOpacity={costVis('EAC')}
                                        fillOpacity={costVis('EAC') * 0.6}
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#FF8C42', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                    />
                                    <Legend content={renderCostLegend} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* Chart B — REVENUE */}
                    {revenueData.length > 0 && (
                        <div className="p-5 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                            <div className="flex items-center gap-2 mb-4">
                                <TrendingUp className="w-4 h-4 text-[#00FFB4]" />
                                <h4 className="text-sm font-semibold text-white uppercase tracking-wide">
                                    Receita Acumulada
                                </h4>
                                <Badge
                                    variant="outline"
                                    className="text-[10px] ml-auto border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.40)]"
                                >
                                    REVENUE
                                </Badge>
                            </div>

                            {/* Revenue Gap Chips */}
                            {revenueGaps && (
                                <div className="flex items-center gap-3 mb-4">
                                    <div
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all"
                                        style={{
                                            background: chipColor(revenueGaps.toBillPct).bg,
                                            color: chipColor(revenueGaps.toBillPct).fg,
                                            borderColor: `${chipColor(revenueGaps.toBillPct).fg}30`,
                                        }}
                                    >
                                        <Zap className="w-3 h-3" />
                                        A Faturar: {compactBRL(revenueGaps.toBill)}
                                        <span className="opacity-60 text-[10px] ml-0.5">
                                            ({revenueGaps.toBillPct.toFixed(0)}%)
                                        </span>
                                    </div>
                                    <div
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all"
                                        style={{
                                            background: chipColor(revenueGaps.toReceivePct).bg,
                                            color: chipColor(revenueGaps.toReceivePct).fg,
                                            borderColor: `${chipColor(revenueGaps.toReceivePct).fg}30`,
                                        }}
                                    >
                                        <Zap className="w-3 h-3" />
                                        A Receber: {compactBRL(revenueGaps.toReceive)}
                                        <span className="opacity-60 text-[10px] ml-0.5">
                                            ({revenueGaps.toReceivePct.toFixed(0)}%)
                                        </span>
                                    </div>
                                </div>
                            )}

                            <ResponsiveContainer width="100%" height={240}>
                                <AreaChart data={revenueData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                                    <defs>
                                        <linearGradient id="gradPlanned" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#00C8FF" stopOpacity={0.12} />
                                            <stop offset="95%" stopColor="#00C8FF" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gradBilled" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#00FFB4" stopOpacity={0.15} />
                                            <stop offset="95%" stopColor="#00FFB4" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gradReceived" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#FFB84D" stopOpacity={0.12} />
                                            <stop offset="95%" stopColor="#FFB84D" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                    <XAxis
                                        dataKey="period"
                                        tickFormatter={xAxisFmt}
                                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.40)' }}
                                        axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tickFormatter={yAxisFmt}
                                        tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.40)' }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={70}
                                    />
                                    {/* Cutoff vertical marker */}
                                    <ReferenceLine
                                        x={cutoffPeriod}
                                        stroke="rgba(255,255,255,0.35)"
                                        strokeDasharray="4 4"
                                        strokeWidth={1.5}
                                        label={<CutoffLabel />}
                                    />
                                    <RechartsTooltip
                                        content={<ChartTooltipContent type="revenue" hiddenSeries={hiddenRevSeries} />}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="Planejado Faturar"
                                        stroke="#00C8FF"
                                        fill="url(#gradPlanned)"
                                        strokeWidth={2}
                                        strokeDasharray="5 3"
                                        strokeOpacity={revVis('Planejado Faturar')}
                                        fillOpacity={revVis('Planejado Faturar') * 0.6}
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#00C8FF', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="Faturado"
                                        stroke="#00FFB4"
                                        fill="url(#gradBilled)"
                                        strokeWidth={2}
                                        strokeOpacity={revVis('Faturado')}
                                        fillOpacity={revVis('Faturado') * 0.6}
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#00FFB4', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="Recebido"
                                        stroke="#FFB84D"
                                        fill="url(#gradReceived)"
                                        strokeWidth={2}
                                        strokeOpacity={revVis('Recebido')}
                                        fillOpacity={revVis('Recebido') * 0.6}
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#FFB84D', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                    />
                                    <Legend content={renderRevLegend} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
            )}

            {/* ── Bottom Row: Breakdown + Forecast ───────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Cost Breakdown Table */}
                <div className="lg:col-span-2 p-5 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="w-4 h-4 text-[#00C8FF]" />
                        <h4 className="text-sm font-semibold text-white">Detalhamento Financeiro</h4>
                        <Badge
                            variant="outline"
                            className="text-[10px] ml-auto border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.40)]"
                        >
                            CUSTOS
                        </Badge>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="border-b border-[rgba(255,255,255,0.08)]">
                                    <th className="text-left py-2 px-2 text-[rgba(255,255,255,0.40)] font-medium uppercase tracking-wider">
                                        Categoria
                                    </th>
                                    <th className="text-right py-2 px-2 text-[rgba(255,255,255,0.40)] font-medium uppercase tracking-wider">
                                        BAC
                                    </th>
                                    <th className="text-right py-2 px-2 text-[#00FFB4] font-medium uppercase tracking-wider">
                                        AC
                                    </th>
                                    <th className="text-right py-2 px-2 text-[rgba(255,255,255,0.40)] font-medium uppercase tracking-wider">
                                        EAC
                                    </th>
                                    <th className="text-right py-2 px-2 text-[rgba(255,255,255,0.40)] font-medium uppercase tracking-wider">
                                        Var (R$)
                                    </th>
                                    <th className="text-right py-2 px-2 text-[rgba(255,255,255,0.40)] font-medium uppercase tracking-wider">
                                        Var (%)
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {breakdownRows.map((row, i) => {
                                    const isOver = row.varMoney > 0;
                                    const varColor = isOver ? '#FF4040' : '#00FFB4';
                                    return (
                                        <tr
                                            key={i}
                                            className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] transition-colors"
                                        >
                                            <td className="py-2.5 px-2 text-[rgba(255,255,255,0.80)] font-medium">
                                                {row.category}
                                            </td>
                                            <td className="py-2.5 px-2 text-right text-[rgba(255,255,255,0.65)] tabular-nums">
                                                {compactBRL(row.bac)}
                                            </td>
                                            <td className="py-2.5 px-2 text-right text-[#00FFB4] tabular-nums font-medium">
                                                {compactBRL(row.ac)}
                                            </td>
                                            <td className="py-2.5 px-2 text-right text-[rgba(255,255,255,0.65)] tabular-nums">
                                                {compactBRL(row.eac)}
                                            </td>
                                            <td
                                                className="py-2.5 px-2 text-right tabular-nums font-medium"
                                                style={{ color: varColor }}
                                            >
                                                {isOver ? '+' : ''}{compactBRL(row.varMoney)}
                                            </td>
                                            <td
                                                className="py-2.5 px-2 text-right tabular-nums"
                                                style={{ color: varColor }}
                                            >
                                                {isOver ? '+' : ''}{row.varPercent.toFixed(1)}%
                                            </td>
                                        </tr>
                                    );
                                })}
                                {/* ── TOTAL Row ── */}
                                {totals && (
                                    <tr className="border-t-2 border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.04)]">
                                        <td className="py-3 px-2 text-white font-bold uppercase tracking-wider text-[11px]">
                                            TOTAL
                                        </td>
                                        <td className="py-3 px-2 text-right text-white font-bold tabular-nums">
                                            {compactBRL(totals.bac)}
                                        </td>
                                        <td className="py-3 px-2 text-right text-[#00FFB4] font-bold tabular-nums">
                                            {compactBRL(totals.ac)}
                                        </td>
                                        <td className="py-3 px-2 text-right text-white font-bold tabular-nums">
                                            {compactBRL(totals.eac)}
                                        </td>
                                        <td
                                            className="py-3 px-2 text-right font-bold tabular-nums"
                                            style={{ color: totals.varMoney > 0 ? '#FF4040' : '#00FFB4' }}
                                        >
                                            {totals.varMoney > 0 ? '+' : ''}{compactBRL(totals.varMoney)}
                                        </td>
                                        <td
                                            className="py-3 px-2 text-right font-bold tabular-nums"
                                            style={{ color: totals.varMoney > 0 ? '#FF4040' : '#00FFB4' }}
                                        >
                                            {totals.varMoney > 0 ? '+' : ''}{totals.varPercent.toFixed(1)}%
                                        </td>
                                    </tr>
                                )}
                                {breakdownRows.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="py-6 text-center text-[rgba(255,255,255,0.30)] text-xs">
                                            Dados de detalhamento não disponíveis
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Forecast Panel */}
                <div className="p-5 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingDown className="w-4 h-4 text-[#FFB84D]" />
                        <h4 className="text-sm font-semibold text-white">Previsão (Custo)</h4>
                    </div>

                    <div className="space-y-4">
                        {/* Method + Confidence + Date */}
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <p className="text-[10px] text-[rgba(255,255,255,0.40)] uppercase mb-1 tracking-wider">Método</p>
                                <Badge variant="outline" className="text-xs border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.65)]">
                                    {getMethodLabel(finance.forecastMethod)}
                                </Badge>
                            </div>
                            <div>
                                <p className="text-[10px] text-[rgba(255,255,255,0.40)] uppercase mb-1 tracking-wider">Confiança</p>
                                <Badge
                                    className="text-xs font-medium border-0"
                                    style={{
                                        background: `${getConfidenceColor(finance.confidence)}20`,
                                        color: getConfidenceColor(finance.confidence),
                                    }}
                                >
                                    {getConfidenceLabel(finance.confidence)}
                                </Badge>
                            </div>
                            <div>
                                <p className="text-[10px] text-[rgba(255,255,255,0.40)] uppercase mb-1 tracking-wider">Atualizado</p>
                                <div className="flex items-center gap-1">
                                    <Clock className="w-3 h-3 text-[rgba(255,255,255,0.40)]" />
                                    <span className="text-xs text-[rgba(255,255,255,0.65)]">{updatedDate}</span>
                                </div>
                            </div>
                        </div>

                        {/* Variance Summary — uses computed totals for consistency */}
                        <div className="p-3 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.04)]">
                            <p className="text-[10px] text-[rgba(255,255,255,0.40)] uppercase mb-1 tracking-wider">
                                Variação EAC vs BAC
                            </p>
                            <div className="flex items-end gap-4">
                                <span
                                    className="text-lg font-bold tabular-nums"
                                    style={{ color: isOverBudget ? '#FF4040' : '#00FFB4' }}
                                >
                                    {isOverBudget ? '+' : ''}{compactBRL(forecastDelta)}
                                </span>
                                <span
                                    className="text-sm font-medium tabular-nums"
                                    style={{ color: isOverBudget ? '#FF4040' : '#00FFB4' }}
                                >
                                    ({isOverBudget ? '+' : ''}{forecastDeltaPct.toFixed(1)}%)
                                </span>
                            </div>
                            {totals && (
                                <p className="text-[9px] text-[rgba(255,255,255,0.25)] mt-1">
                                    ∑ categorias: EAC {compactBRL(totals.eac)} − BAC {compactBRL(totals.bac)}
                                </p>
                            )}
                        </div>

                        {/* Top Drivers */}
                        {finance.drivers && finance.drivers.length > 0 && (
                            <div>
                                <p className="text-[10px] text-[rgba(255,255,255,0.40)] uppercase mb-2 tracking-wider">
                                    Principais Impulsores
                                </p>
                                <div className="space-y-1.5">
                                    {finance.drivers.slice(0, 3).map((driver, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#FFB84D] flex-shrink-0" />
                                            <span className="text-xs text-[rgba(255,255,255,0.65)]">{driver}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default FinanceView;
