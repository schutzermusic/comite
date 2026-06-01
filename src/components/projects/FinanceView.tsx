'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
    Link2,
    Plus,
    AlertTriangle,
} from 'lucide-react';
import { HudPanel } from '@/components/hud';
import { Badge } from '@/components/ui/badge';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { compactBRL } from '@/lib/utils/project-utils';
import { getLedgerEntries, linkEntriesToProject, formatBRL } from '@/lib/finance/finance-store';
import { selectProjectFinanceView } from '@/lib/finance/selectors/project-finance';
import { resolveFinanceProjectId } from '@/lib/projects/finance-mapping';

// ── Helpers ─────────────────────────────────────────────────────

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
    const router = useRouter();
    const [hiddenCostSeries, setHiddenCostSeries] = useState<Set<string>>(new Set());
    const [hiddenRevSeries, setHiddenRevSeries] = useState<Set<string>>(new Set());
    const [refreshKey, setRefreshKey] = useState(0);

    const { finance } = project;
    // Resolve the unified-ledger project id (explicit link → contract fallback →
    // code match). All monetary numbers derive from the ledger filtered by it.
    const financeProjectId = resolveFinanceProjectId(project);

    // ── Ledger-derived financial view ────────────────────
    const view = useMemo(
        () => (financeProjectId ? selectProjectFinanceView(getLedgerEntries(), financeProjectId) : undefined),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [financeProjectId, refreshKey],
    );

    const cutoffPeriod = view?.sCurve.cutoffPeriod ?? '';

    // ── Recharts series (already in reais) ──
    const costData = useMemo(
        () => view?.sCurve.cost.map(p => ({ period: p.period, BAC: p.BAC, AC: p.AC, EAC: p.EAC })) ?? [],
        [view],
    );

    const revenueData = useMemo(
        () => view?.sCurve.revenue.map(p => ({
            period: p.period,
            'Planejado Faturar': p.planned,
            'Faturado': p.billed,
            'Recebido': p.received,
        })) ?? [],
        [view],
    );

    // ── Cost breakdown (ledger buckets) with variance ──
    const breakdownRows = useMemo(() => {
        if (!view) return [];
        return view.costBreakdown.map(item => {
            const varR$ = item.eac - item.bac;
            const varPct = item.bac > 0 ? (varR$ / item.bac) * 100 : 0;
            return { category: item.category, bac: item.bac, ac: item.ac, eac: item.eac, varMoney: varR$, varPercent: varPct };
        });
    }, [view]);

    const totals = useMemo(() => {
        if (!view) return null;
        const { bac, ac, eac, variance, variancePct } = view.baf;
        return { bac, ac, eac, varMoney: variance, varPercent: variancePct };
    }, [view]);

    // ── Forecast panel uses ledger BAF ──
    const forecastDelta = view ? view.baf.variance : 0;
    const forecastDeltaPct = view ? view.baf.variancePct : 0;
    const isOverBudget = forecastDelta > 0;

    const updatedDate = finance?.updatedAt
        ? new Date(finance.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';

    // ── Revenue gap KPIs (ledger) ──
    const revenueGaps = useMemo(() => {
        if (!view) return null;
        const { contracted, billed, toBill, toReceive } = view.revenue;
        const toBillPct = contracted > 0 ? (toBill / contracted) * 100 : 0;
        const toReceivePct = billed > 0 ? (toReceive / billed) * 100 : 0;
        return { toBill, toReceive, toBillPct, toReceivePct };
    }, [view]);

    // ── Shortcut actions → Finance ledger (prefilled) ──
    const pending = view?.pending;
    const goToNewEntry = useCallback((nature: 'expense' | 'revenue' | 'budget' | 'forecast') => {
        if (!financeProjectId) return;
        const params = new URLSearchParams({ projectId: financeProjectId, nature });
        const contractId = view?.summary.contract_id;
        if (contractId) params.set('contractId', contractId);
        router.push(`/financeiro/lancamentos?${params.toString()}`);
    }, [financeProjectId, view, router]);

    const handleLinkPending = useCallback(() => {
        if (!financeProjectId || !pending?.entries.length) return;
        linkEntriesToProject(pending.entries.map(e => e.id), financeProjectId, 'Vinculado via detalhe do projeto');
        setRefreshKey(k => k + 1);
    }, [financeProjectId, pending]);

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
                {/* Granularity toggle — ledger data is monthly; weekly is not
                    yet supported so it stays disabled (no fabricated precision). */}
                <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.05)] rounded-full p-0.5 border border-[rgba(255,255,255,0.08)]">
                    <button
                        className="px-3 py-1 rounded-full text-xs font-medium transition-all bg-[#00FFB4] text-[#050D0A]"
                    >
                        Mensal
                    </button>
                    <button
                        disabled
                        title="Disponível em breve — o ledger financeiro é mensal"
                        className="px-3 py-1 rounded-full text-xs font-medium text-[rgba(255,255,255,0.30)] cursor-not-allowed"
                    >
                        Semanal (em breve)
                    </button>
                </div>
            </div>

            {!financeProjectId && (
                <div className="flex items-center gap-2 rounded-xl border border-[rgba(255,184,77,0.28)] bg-[rgba(255,184,77,0.10)] px-4 py-3">
                    <AlertTriangle className="w-4 h-4 text-[#FFB84D]" />
                    <span className="text-xs text-[#FFB84D]">Projeto sem vínculo com o ledger financeiro — sem dados oficiais.</span>
                </div>
            )}

            {/* ── Ledger-derived KPI strip (BAC / AC / EAC / ETC / Receita / Margem) ── */}
            {view && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    {([
                        { label: 'BAC (orçado)', value: view.baf.bac, color: '#00C8FF' },
                        { label: 'AC (realizado)', value: view.baf.ac, color: '#00FFB4' },
                        { label: 'EAC (estimado)', value: view.baf.eac, color: '#FF8C42' },
                        { label: 'ETC (a concluir)', value: view.baf.etc, color: '#FFB84D' },
                        { label: 'Receita realizada', value: view.summary.revenue, color: '#00FFB4' },
                        { label: 'Margem', value: view.summary.margin, color: view.summary.margin >= 0 ? '#00FFB4' : '#FF4040', sub: `${view.summary.marginPct.toFixed(1)}%` },
                    ] as const).map((k) => (
                        <div key={k.label} className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3">
                            <p className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.40)]">{k.label}</p>
                            <p className="mt-1 text-sm font-semibold tabular-nums" style={{ color: k.color }}>{compactBRL(k.value)}</p>
                            {'sub' in k && k.sub && <p className="text-[10px] tabular-nums" style={{ color: k.color }}>{k.sub}</p>}
                        </div>
                    ))}
                </div>
            )}

            {/* ── Shortcut actions → Finance ledger (prefilled) ── */}
            {financeProjectId && (
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => goToNewEntry('expense')} className="flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-xs font-medium text-[rgba(255,255,255,0.75)] transition-colors hover:bg-[rgba(255,255,255,0.08)]"><Plus className="w-3.5 h-3.5" />Nova despesa</button>
                    <button onClick={() => goToNewEntry('revenue')} className="flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-xs font-medium text-[rgba(255,255,255,0.75)] transition-colors hover:bg-[rgba(255,255,255,0.08)]"><Plus className="w-3.5 h-3.5" />Nova receita</button>
                    <button onClick={() => goToNewEntry('budget')} className="flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-xs font-medium text-[rgba(255,255,255,0.75)] transition-colors hover:bg-[rgba(255,255,255,0.08)]"><Plus className="w-3.5 h-3.5" />Novo orçado</button>
                    <button onClick={() => goToNewEntry('forecast')} className="flex items-center gap-1.5 rounded-lg border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-xs font-medium text-[rgba(255,255,255,0.75)] transition-colors hover:bg-[rgba(255,255,255,0.08)]"><Plus className="w-3.5 h-3.5" />Novo forecast</button>
                </div>
            )}

            {/* ── Pending pre-project costs (excluded from AC until linked) ── */}
            {pending && pending.count > 0 && (
                <div className="rounded-xl border border-[rgba(255,184,77,0.28)] bg-[rgba(255,184,77,0.08)] p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2">
                            <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0 text-[#FFB84D]" />
                            <div>
                                <p className="text-sm font-semibold text-[#FFB84D]">Custos pendentes relacionados ao contrato</p>
                                <p className="text-xs text-[rgba(255,255,255,0.55)] mt-0.5">
                                    {pending.count} custo(s) no contrato <span className="font-mono">{pending.contract_id}</span> lançados antes do projeto — não entram no AC/margem até serem vinculados. Total {formatBRL(pending.totalCents)}.
                                </p>
                            </div>
                        </div>
                        <button onClick={handleLinkPending} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#00FFB4] px-3 py-1.5 text-xs font-semibold text-[#050D0A] transition-opacity hover:opacity-90">
                            <Link2 className="w-3.5 h-3.5" />Vincular custos
                        </button>
                    </div>
                    <ul className="mt-3 divide-y divide-[rgba(255,255,255,0.06)]">
                        {pending.entries.map((e) => (
                            <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                                <span className="truncate text-xs text-[rgba(255,255,255,0.70)]">{e.entry_date} • {e.description}</span>
                                <span className="shrink-0 font-mono text-xs text-[rgba(255,255,255,0.85)]">{formatBRL(e.amount_cents)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* ── Twin S-Curve Charts ───────── */}
            {(costData.length > 0 || revenueData.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Chart A — COST */}
                    {costData.length > 0 && (
                        <HudPanel noPadding>
                          <div className="p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <DollarSign className="w-4 h-4 text-[#00C8FF]" />
                                <h4 className="text-sm font-semibold orion-text-primary uppercase tracking-wide">
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
                        </HudPanel>
                    )}

                    {/* Chart B — REVENUE */}
                    {revenueData.length > 0 && (
                        <HudPanel noPadding>
                          <div className="p-5">
                            <div className="flex items-center gap-2 mb-4">
                                <TrendingUp className="w-4 h-4 text-[#00FFB4]" />
                                <h4 className="text-sm font-semibold orion-text-primary uppercase tracking-wide">
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
                        </HudPanel>
                    )}
                </div>
            )}

            {/* ── Bottom Row: Breakdown + Forecast ───────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Cost Breakdown Table */}
                <HudPanel noPadding className="lg:col-span-2">
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="w-4 h-4 text-[#00C8FF]" />
                        <h4 className="text-sm font-semibold orion-text-primary">Detalhamento Financeiro</h4>
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
                </HudPanel>

                {/* Forecast Panel */}
                <HudPanel noPadding>
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <TrendingDown className="w-4 h-4 text-[#FFB84D]" />
                        <h4 className="text-sm font-semibold orion-text-primary">Previsão (Custo)</h4>
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
                </HudPanel>
            </div>
        </div>
    );
}

export default FinanceView;
