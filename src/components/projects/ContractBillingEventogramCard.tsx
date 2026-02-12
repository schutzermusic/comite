'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
    ComposedChart,
    Bar,
    Line,
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
    Receipt,
    ExternalLink,
    TrendingUp,
} from 'lucide-react';
import { HUDCard } from '@/components/ui/hud-card';
import { Button } from '@/components/ui/button';
import type { ProjectV2, BillingEvent } from '@/lib/types/project-v2';
import { formatMoney, compactBRL } from '@/lib/utils/project-utils';
import { buildBillingSeries, type BillingMonthlyPoint } from '@/lib/utils/billing-utils';
import { BillingPeriodDrawer } from './BillingPeriodDrawer';

// ── Constants ───────────────────────────────────────────────────

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const xAxisFmt = (period: string) => {
    const parts = period.split('-');
    if (parts.length < 2) return period;
    const [y, m] = parts;
    return `${MONTHS_PT[parseInt(m, 10) - 1]}'${y.slice(2)}`;
};

const yAxisFmt = (v: number) => compactBRL(v);

// ── Custom Tooltip ──────────────────────────────────────────────

interface EventogramTooltipProps {
    active?: boolean;
    payload?: any[];
    label?: string;
    dataMap: Map<string, BillingMonthlyPoint>;
}

function EventogramTooltip({ active, payload, label, dataMap }: EventogramTooltipProps) {
    if (!active || !payload?.length || !label) return null;

    const point = dataMap.get(label);
    const previsto = point?.previsto ?? 0;
    const realizado = point?.realizado;
    const gap = realizado != null ? previsto - realizado : null;
    const gapPct = previsto > 0 && gap != null ? (gap / previsto) * 100 : null;
    const events = point?.events?.slice(0, 3) || [];

    const [y, m] = label.split('-');
    const periodLabel = `${MONTHS_PT[parseInt(m, 10) - 1]} ${y}`;

    return (
        <div className="p-3 rounded-xl border border-[rgba(255,255,255,0.12)] bg-[#0A1F18ee] shadow-xl backdrop-blur-sm min-w-[220px]">
            <p className="text-xs text-[rgba(255,255,255,0.50)] mb-2 font-medium">{periodLabel}</p>

            <div className="space-y-1 mb-2">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#FFB84D]" />
                        <span className="text-xs text-[rgba(255,255,255,0.65)]">Previsto</span>
                    </div>
                    <span className="text-xs font-semibold text-white tabular-nums">
                        {compactBRL(previsto)}
                    </span>
                </div>
                {realizado != null && (
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-[#00FFB4]" />
                            <span className="text-xs text-[rgba(255,255,255,0.65)]">Realizado</span>
                        </div>
                        <span className="text-xs font-semibold text-white tabular-nums">
                            {compactBRL(realizado)}
                        </span>
                    </div>
                )}
            </div>

            {gap != null && (
                <div className="pt-1.5 border-t border-[rgba(255,255,255,0.08)] space-y-0.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] text-[rgba(255,255,255,0.40)]">Gap</span>
                        <span className={`text-[10px] font-semibold tabular-nums ${gap > 0 ? 'text-[#FF4040]' : 'text-[#00FFB4]'}`}>
                            {compactBRL(Math.abs(gap))} ({gapPct != null ? `${Math.abs(gapPct).toFixed(1)}%` : ''})
                        </span>
                    </div>
                </div>
            )}

            {events.length > 0 && (
                <div className="mt-2 pt-1.5 border-t border-[rgba(255,255,255,0.08)]">
                    <p className="text-[9px] text-[rgba(255,255,255,0.35)] uppercase tracking-wider mb-1">Eventos</p>
                    {events.map(evt => (
                        <p key={evt.id} className="text-[10px] text-[rgba(255,255,255,0.55)] truncate">
                            • {evt.title}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Cutoff Label ────────────────────────────────────────────────

function CutoffLabel({ viewBox }: any) {
    const { x } = viewBox || {};
    return (
        <text x={(x || 0) + 4} y={16} fill="rgba(255,184,77,0.75)" fontSize={8} fontWeight={600}>
            DATA DE CORTE
        </text>
    );
}

// ── Props ───────────────────────────────────────────────────────

interface ContractBillingEventogramCardProps {
    project: ProjectV2;
    onTabChange?: (tab: string) => void;
}

// ── Main Component ──────────────────────────────────────────────

export function ContractBillingEventogramCard({ project, onTabChange }: ContractBillingEventogramCardProps) {
    const router = useRouter();
    const [mode, setMode] = useState<'monthly' | 'cumulative'>('monthly');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerPeriod, setDrawerPeriod] = useState('');
    const [drawerEvents, setDrawerEvents] = useState<BillingEvent[]>([]);

    const rev = project.revenue;
    const contractId = project.contract_id;

    // ── Resolve cutoff ────────────────────────────────────
    const cutoffPeriod = useMemo(() => {
        if (project.cutoffPeriod) return project.cutoffPeriod;
        const refDate = rev?.updatedAt ? new Date(rev.updatedAt) : new Date();
        const y = refDate.getFullYear();
        const m = refDate.getMonth() + 1;
        return `${y}-${String(m).padStart(2, '0')}`;
    }, [project.cutoffPeriod, rev?.updatedAt]);

    // ── Resolve project end ───────────────────────────────
    const projectEndPeriod = useMemo(() => {
        // Use last billing event planned date, or fallback
        const events = project.billing_eventogram || [];
        if (events.length > 0) {
            const lastPlanned = events.map(e => e.datePlanned).sort().pop()!;
            return lastPlanned.slice(0, 7);
        }
        // Fallback: cutoff + 6 months
        const [y, m] = cutoffPeriod.split('-').map(Number);
        const endM = m + 6;
        const endY = y + Math.floor((endM - 1) / 12);
        const endMonth = ((endM - 1) % 12) + 1;
        return `${endY}-${String(endMonth).padStart(2, '0')}`;
    }, [project.billing_eventogram, cutoffPeriod]);

    // ── Build series ──────────────────────────────────────
    const billingEvents = project.billing_eventogram || [];
    const data = useMemo(
        () => buildBillingSeries(billingEvents, mode, cutoffPeriod, projectEndPeriod),
        [billingEvents, mode, cutoffPeriod, projectEndPeriod]
    );

    // Lookup map for tooltip
    const dataMap = useMemo(() => {
        const m = new Map<string, BillingMonthlyPoint>();
        data.forEach(p => m.set(p.period, p));
        return m;
    }, [data]);

    // ── KPI Values ────────────────────────────────────────
    const totalCents = rev?.totalContracted?.amountCents ?? 0;
    const billedCents = rev?.billed?.amountCents ?? 0;
    const toBillCents = Math.max(totalCents - billedCents, 0);

    // Skip render if no data
    if (totalCents === 0 && billingEvents.length === 0) return null;

    const updatedDate = rev?.updatedAt
        ? new Date(rev.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // ── Handlers ──────────────────────────────────────────
    const handleBarClick = useCallback((_data: any, index: number) => {
        const point = data[index];
        if (point) {
            setDrawerPeriod(point.period);
            setDrawerEvents(point.events);
            setDrawerOpen(true);
        }
    }, [data]);

    const handleChartClick = useCallback((chartData: any) => {
        if (chartData?.activePayload?.[0]?.payload) {
            const point = chartData.activePayload[0].payload as BillingMonthlyPoint;
            setDrawerPeriod(point.period);
            setDrawerEvents(point.events);
            setDrawerOpen(true);
        }
    }, []);

    return (
        <>
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
                                Eventograma de Faturamento
                            </h3>
                            <p className="text-[10px] text-[rgba(255,255,255,0.40)] leading-tight">
                                Previsto x Realizado (até o fim do projeto)
                            </p>
                        </div>
                    </div>
                    {/* Mode toggle */}
                    <div className="flex items-center gap-0.5 bg-[rgba(255,255,255,0.05)] rounded-full p-0.5 border border-[rgba(255,255,255,0.08)]">
                        <button
                            onClick={() => setMode('monthly')}
                            className={`px-3 py-1 rounded-full text-[10px] font-medium transition-all ${mode === 'monthly'
                                ? 'bg-[#00FFB4] text-[#050D0A]'
                                : 'text-[rgba(255,255,255,0.50)] hover:text-white'
                                }`}
                        >
                            Mensal
                        </button>
                        <button
                            onClick={() => setMode('cumulative')}
                            className={`px-3 py-1 rounded-full text-[10px] font-medium transition-all ${mode === 'cumulative'
                                ? 'bg-[#00FFB4] text-[#050D0A]'
                                : 'text-[rgba(255,255,255,0.50)] hover:text-white'
                                }`}
                        >
                            Acumulado (Curva S)
                        </button>
                    </div>
                </div>

                {/* ── Chart ────────────────────────── */}
                {data.length > 0 ? (
                    <div className="mb-4">
                        <ResponsiveContainer width="100%" height={280}>
                            {mode === 'monthly' ? (
                                <ComposedChart
                                    data={data}
                                    margin={{ top: 10, right: 10, left: 0, bottom: 5 }}
                                    onClick={handleChartClick}
                                >
                                    <defs>
                                        <linearGradient id="gradBarRealizado" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#00FFB4" stopOpacity={0.9} />
                                            <stop offset="95%" stopColor="#00FFB4" stopOpacity={0.4} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                    <XAxis
                                        dataKey="period"
                                        tickFormatter={xAxisFmt}
                                        tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.40)' }}
                                        axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tickFormatter={yAxisFmt}
                                        tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.40)' }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={65}
                                    />
                                    <ReferenceLine
                                        x={cutoffPeriod}
                                        stroke="rgba(255,184,77,0.6)"
                                        strokeDasharray="4 4"
                                        strokeWidth={1.5}
                                        label={<CutoffLabel />}
                                    />
                                    <RechartsTooltip
                                        content={<EventogramTooltip dataMap={dataMap} />}
                                        cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                                    />
                                    <Bar
                                        dataKey="realizado"
                                        name="Faturado (R$)"
                                        fill="url(#gradBarRealizado)"
                                        radius={[4, 4, 0, 0]}
                                        maxBarSize={28}
                                        cursor="pointer"
                                        style={{ filter: 'drop-shadow(0 0 6px rgba(0,255,180,0.2))' }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="previsto"
                                        name="A Faturar (R$)"
                                        stroke="#FFB84D"
                                        strokeWidth={2.5}
                                        dot={{ r: 3, fill: '#FFB84D', stroke: '#0A1F18', strokeWidth: 2 }}
                                        activeDot={{ r: 5, fill: '#FFB84D', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                        style={{ filter: 'drop-shadow(0 0 4px rgba(255,184,77,0.3))' }}
                                    />
                                    <Legend
                                        content={() => (
                                            <div className="flex items-center justify-center gap-5 mt-3">
                                                <div className="flex items-center gap-1.5 text-[11px]">
                                                    <div className="w-3 h-2 rounded-sm" style={{ background: '#00FFB4', boxShadow: '0 0 4px rgba(0,255,180,0.4)' }} />
                                                    <span className="text-[rgba(255,255,255,0.55)]">Faturado (R$)</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[11px]">
                                                    <div className="w-3 h-0.5 rounded-full" style={{ background: '#FFB84D', boxShadow: '0 0 4px rgba(255,184,77,0.4)' }} />
                                                    <span className="text-[rgba(255,255,255,0.55)]">A Faturar (R$)</span>
                                                </div>
                                            </div>
                                        )}
                                    />
                                </ComposedChart>
                            ) : (
                                <AreaChart
                                    data={data}
                                    margin={{ top: 10, right: 10, left: 0, bottom: 5 }}
                                    onClick={handleChartClick}
                                >
                                    <defs>
                                        <linearGradient id="gradCumPrevisto" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#FFB84D" stopOpacity={0.15} />
                                            <stop offset="95%" stopColor="#FFB84D" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="gradCumRealizado" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#00FFB4" stopOpacity={0.20} />
                                            <stop offset="95%" stopColor="#00FFB4" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                    <XAxis
                                        dataKey="period"
                                        tickFormatter={xAxisFmt}
                                        tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.40)' }}
                                        axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tickFormatter={yAxisFmt}
                                        tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.40)' }}
                                        axisLine={false}
                                        tickLine={false}
                                        width={65}
                                    />
                                    <ReferenceLine
                                        x={cutoffPeriod}
                                        stroke="rgba(255,184,77,0.6)"
                                        strokeDasharray="4 4"
                                        strokeWidth={1.5}
                                        label={<CutoffLabel />}
                                    />
                                    <RechartsTooltip
                                        content={<EventogramTooltip dataMap={dataMap} />}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="previsto"
                                        name="Previsto Acumulado"
                                        stroke="#FFB84D"
                                        fill="url(#gradCumPrevisto)"
                                        strokeWidth={2}
                                        strokeDasharray="5 3"
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#FFB84D', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                        style={{ filter: 'drop-shadow(0 0 4px rgba(255,184,77,0.3))' }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="realizado"
                                        name="Realizado Acumulado"
                                        stroke="#00FFB4"
                                        fill="url(#gradCumRealizado)"
                                        strokeWidth={2.5}
                                        dot={false}
                                        activeDot={{ r: 4, fill: '#00FFB4', stroke: '#0A1F18', strokeWidth: 2 }}
                                        connectNulls={false}
                                        style={{ filter: 'drop-shadow(0 0 6px rgba(0,255,180,0.3))' }}
                                    />
                                    <Legend
                                        content={() => (
                                            <div className="flex items-center justify-center gap-5 mt-3">
                                                <div className="flex items-center gap-1.5 text-[11px]">
                                                    <div className="w-3 h-0.5 rounded-full" style={{ background: '#FFB84D', boxShadow: '0 0 4px rgba(255,184,77,0.4)' }} />
                                                    <span className="text-[rgba(255,255,255,0.55)]">Previsto Acumulado</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 text-[11px]">
                                                    <div className="w-3 h-0.5 rounded-full" style={{ background: '#00FFB4', boxShadow: '0 0 4px rgba(0,255,180,0.4)' }} />
                                                    <span className="text-[rgba(255,255,255,0.55)]">Realizado Acumulado</span>
                                                </div>
                                            </div>
                                        )}
                                    />
                                </AreaChart>
                            )}
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="flex items-center justify-center py-12 text-[rgba(255,255,255,0.30)] text-xs">
                        Dados de faturamento não disponíveis
                    </div>
                )}

                {/* ── Bottom KPI Summary ────────────────────────── */}
                <div className="pt-3 border-t border-[rgba(255,255,255,0.06)] grid grid-cols-3 gap-3 text-center">
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

                {/* ── Microtext ─────────────────────────────────── */}
                <p className="text-[9px] text-[rgba(255,255,255,0.20)] mt-2 text-center">
                    Fonte: Contrato/Financeiro • Atualizado em {updatedDate}
                </p>

                {/* ── Footer CTAs ────────────────────────── */}
                <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                    <p className="text-[9px] text-[rgba(255,255,255,0.25)]">
                        Clique em um período para ver eventos
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

            {/* ── Period Events Drawer ────────────────────────── */}
            <BillingPeriodDrawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                periodLabel={drawerPeriod}
                events={drawerEvents}
                projectId={project.id}
                onTabChange={onTabChange}
            />
        </>
    );
}
