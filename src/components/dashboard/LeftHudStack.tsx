'use client';

import React from 'react';
import Link from 'next/link';
import { Briefcase, TrendingUp, Zap, Users } from 'lucide-react';
import { HudPanel, HudMetric, HudSparkline } from './hud';
import type { DashboardPayload } from '@/lib/dashboard-data';
import { formatCurrency } from '@/lib/dashboard-data';

interface LeftHudStackProps {
    data: DashboardPayload;
}

/* Mock monthly data for mini-charts */
const REVENUE_MONTHLY = [9.2, 10.1, 11.5, 10.8, 12.3, 11.9, 13.1, 12.5, 14.2, 13.8, 15.0, 14.6];
const FORECAST_MONTHLY = [9.0, 10.0, 11.0, 11.5, 12.0, 12.5, 13.0, 13.5, 14.0, 14.5, 15.0, 15.5];
const EXPENSE_MONTHLY = [7.1, 7.5, 8.2, 7.8, 8.5, 8.1, 9.0, 8.6, 9.4, 9.0, 9.8, 9.5];
const SCURVE_ACTUAL = [0, 5, 12, 22, 35, 48, 60, 71, 78, 83, 88, 92];
const SCURVE_PLANNED = [0, 8, 16, 25, 33, 42, 50, 58, 67, 75, 83, 92];
const HEALTH_TREND = [72, 74, 71, 78, 82, 80, 85, 83, 86, 84, 87, 85];

export function LeftHudStack({ data }: LeftHudStackProps) {
    const portfolioValue = data.portfolioMetrics
        ? formatCurrency(data.portfolioMetrics.activeValue, data.portfolioMetrics.currency)
        : '—';
    const portfolioDelta = data.portfolioMetrics?.activeValueDelta;

    return (
        <div className="cr-panel-stack-left">
            {/* ─── Panel A: Portfolio Overview ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 30 }}>
                <HudPanel
                    title="Portfolio Overview"
                    accentColor="bg-cyan-400"
                    deepLinkHref="/projetos"
                    deepLinkLabel="Projetos"
                    icon={<Briefcase className="w-3 h-3" />}
                    delay={0.1}
                >
                    <div className="space-y-3">
                        <div>
                            <p className="cr-label mb-1">
                                Valor do Portfólio
                            </p>
                            <div className="flex items-baseline gap-3">
                                <HudMetric
                                    value={portfolioValue}
                                    delta={portfolioDelta}
                                    size="xl"
                                />
                            </div>
                        </div>

                        {/* KPI row */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <p className="text-xl font-bold text-white tabular-nums leading-none" style={{ textShadow: '0 0 14px rgba(106, 223, 255, 0.18)' }}>
                                    {data.brazilProjectsMap?.summary.active ?? 12}
                                </p>
                                <p className="cr-label mt-0.5">Projetos ativos</p>
                            </div>
                            <div>
                                <p className="text-xl font-bold text-white tabular-nums leading-none" style={{ textShadow: '0 0 14px rgba(106, 223, 255, 0.18)' }}>
                                    {data.financialOverview?.projectsUnderGovernance ?? 46}
                                </p>
                                <p className="cr-label mt-0.5">Contratos ativos</p>
                            </div>
                        </div>

                        {/* Health sparkline */}
                        <div>
                            <div className="flex items-baseline justify-between mb-1">
                                <p className="cr-label">Saúde média</p>
                                <span className="text-base font-bold text-white tabular-nums" style={{ textShadow: '0 0 14px rgba(16, 185, 129, 0.22)' }}>
                                    {data.healthMetrics.overallHealth}%
                                </span>
                            </div>
                            <HudSparkline
                                values={HEALTH_TREND}
                                variant="line"
                                color="#10b981"
                                height={24}
                            />
                        </div>
                    </div>
                </HudPanel>
            </div>

            {/* ─── Panel B: Finance Snapshot (with mini-charts) ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 20, marginTop: '-6px' }}>
                <HudPanel
                    title="Finance Snapshot"
                    accentColor="bg-emerald-400"
                    deepLinkHref="/contratos"
                    deepLinkLabel="Contratos"
                    icon={<TrendingUp className="w-3 h-3" />}
                    delay={0.2}
                >
                    {data.financialPulse ? (
                        <div className="space-y-3">
                            {/* Revenue with bullet graph: actual vs target */}
                            <div>
                                <div className="flex items-baseline justify-between mb-1">
                                    <p className="cr-label">Receita (MTD)</p>
                                    <span className={`text-[9px] font-semibold ${data.financialPulse.revenue.trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        ↗+{data.financialPulse.revenue.trend}%
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-2 mb-1.5">
                                    <span className="text-xl font-bold text-white tabular-nums" style={{ textShadow: '0 0 16px rgba(106, 223, 255, 0.2)' }}>
                                        {formatCurrency(data.financialPulse.revenue.value, 'BRL')}
                                    </span>
                                    <span className="text-[8px] text-white/25">
                                        / {formatCurrency(data.financialPulse.revenue.value * 1.08, 'BRL')}
                                    </span>
                                </div>
                                {/* Bullet graph — wider track */}
                                <div className="relative h-2.5 rounded-full overflow-hidden bg-white/[0.04]">
                                    {/* Target zone */}
                                    <div
                                        className="absolute inset-y-0 left-0 bg-emerald-500/10 rounded-full"
                                        style={{ width: '100%' }}
                                    />
                                    {/* Actual bar */}
                                    <div
                                        className="absolute inset-y-0 left-0 rounded-full"
                                        style={{
                                            width: `${Math.min((data.financialPulse.revenue.value / (data.financialPulse.revenue.value * 1.08)) * 100, 100)}%`,
                                            background: 'linear-gradient(90deg, #10b981, #06b6d4)',
                                            boxShadow: '0 0 10px rgba(16, 185, 129, 0.35), 0 0 4px rgba(6, 182, 212, 0.2)',
                                        }}
                                    />
                                    {/* Target marker */}
                                    <div
                                        className="absolute top-0 bottom-0 w-[2px] bg-white/35"
                                        style={{ left: '92%' }}
                                    />
                                </div>
                            </div>

                            {/* EBITDA with inline bar */}
                            <div>
                                <div className="flex items-baseline justify-between">
                                    <p className="cr-label">EBITDA</p>
                                    <span className="text-lg font-bold text-white tabular-nums">
                                        {data.financialPulse.ebitda.margin}%
                                    </span>
                                </div>
                                <div className="relative h-1.5 mt-1 rounded-full overflow-hidden bg-white/[0.04]">
                                    <div
                                        className="absolute inset-y-0 left-0 rounded-full bg-cyan-500/40"
                                        style={{
                                            width: `${data.financialPulse.ebitda.margin}%`,
                                            boxShadow: '0 0 6px rgba(6, 182, 212, 0.2)',
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Cash variance — mini waterfall */}
                            <div>
                                <p className="cr-label mb-1">Caixa vs previsto</p>
                                <div className="flex items-end gap-1 h-[36px]">
                                    {/* Forecast bar */}
                                    <div className="flex flex-col items-center flex-1">
                                        <div
                                            className="w-full rounded-t bg-white/[0.08]"
                                            style={{ height: '100%' }}
                                        />
                                        <span className="text-[7px] text-white/30 mt-0.5">Prev</span>
                                    </div>
                                    {/* Delta bar */}
                                    <div className="flex flex-col items-center flex-1">
                                        <div
                                            className={`w-full rounded-t ${data.financialPulse.cash.variance >= 0 ? 'bg-emerald-400/30' : 'bg-red-400/30'}`}
                                            style={{ height: `${Math.abs(data.financialPulse.cash.variance) * 3}%` }}
                                        />
                                        <span className={`text-[7px] mt-0.5 font-semibold ${data.financialPulse.cash.variance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {data.financialPulse.cash.variance > 0 ? '+' : ''}{data.financialPulse.cash.variance}%
                                        </span>
                                    </div>
                                    {/* Actual bar */}
                                    <div className="flex flex-col items-center flex-1">
                                        <div
                                            className="w-full rounded-t"
                                            style={{
                                                height: `${Math.min(100, 100 + data.financialPulse.cash.variance * 2)}%`,
                                                background: 'linear-gradient(180deg, rgba(245, 158, 11, 0.4), rgba(245, 158, 11, 0.15))',
                                            }}
                                        />
                                        <span className="text-[7px] text-white/30 mt-0.5">Real</span>
                                    </div>
                                </div>
                                <div className="flex items-baseline gap-2 mt-1">
                                    <span className="text-base font-bold text-white tabular-nums">
                                        {formatCurrency(data.financialPulse.cash.actual, 'BRL')}
                                    </span>
                                </div>
                            </div>

                            {/* Mini S-Curve preview */}
                            <div className="pt-1 border-t border-white/[0.06]">
                                <div className="flex items-center justify-between mb-1">
                                <p className="cr-label">S-Curve Preview</p>
                                    <div className="flex items-center gap-2">
                                        <span className="flex items-center gap-1 text-[7px] text-emerald-400/60">
                                            <span className="w-2 h-[2px] bg-emerald-400/60 rounded-full inline-block" /> Real
                                        </span>
                                        <span className="flex items-center gap-1 text-[7px] text-cyan-400/40">
                                            <span className="w-2 h-[2px] bg-cyan-400/40 rounded-full inline-block border-dashed" /> Plan
                                        </span>
                                    </div>
                                </div>
                                <div className="relative">
                                    <HudSparkline values={SCURVE_PLANNED} variant="line" color="rgba(6,182,212,0.3)" height={28} />
                                    <div className="absolute inset-0">
                                        <HudSparkline values={SCURVE_ACTUAL} variant="line" color="#10b981" height={28} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p className="text-[10px] text-white/30">Sem dados financeiros</p>
                    )}
                </HudPanel>
            </div>

            {/* ─── Panel C: Fila Executiva ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 10, marginTop: '-6px' }}>
                <HudPanel
                    title="Fila Executiva"
                    accentColor="bg-amber-400"
                    deepLinkHref="/deliberacoes"
                    deepLinkLabel="Ver tudo"
                    icon={<Zap className="w-3 h-3" />}
                    delay={0.3}
                    badge={data.decisionQueue.length}
                >
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-3 mb-2">
                            <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-400">
                                <Zap className="w-3 h-3" /> {data.decisionQueue.length}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-white/40">
                                <Users className="w-3 h-3" />{' '}
                                {data.decisionQueue.filter((d) => d.type === 'vote').length}
                            </span>
                        </div>

                        {data.decisionQueue.slice(0, 4).map((item) => (
                            <div key={item.id} className="flex items-center gap-2 group py-1 pl-2 rounded-md relative hover:bg-white/[0.02] transition-colors">
                                {/* Severity left accent */}
                                <div
                                    className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full"
                                    style={{
                                        background: item.severity === 'critical'
                                            ? '#ef4444'
                                            : item.severity === 'high'
                                                ? '#f59e0b'
                                                : '#14b8a6',
                                        opacity: 0.5,
                                    }}
                                />
                                <div
                                    className={`hud-dot flex-shrink-0 ${item.severity === 'critical'
                                        ? 'hud-dot-critical'
                                        : item.severity === 'high'
                                            ? 'hud-dot-warning'
                                            : 'hud-dot-info'
                                        }`}
                                />
                                <span className="text-[10px] text-white/78 tracking-[0.01em] truncate flex-1">
                                    {item.title}
                                </span>
                                <span className="text-[8px] text-white/45 tabular-nums flex-shrink-0">
                                    {item.daysOpen}d
                                </span>
                                <Link
                                    href="/deliberacoes"
                                    className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/[0.06] border border-emerald-500/15 text-emerald-400/60 hover:text-emerald-400 hover:border-emerald-400/30 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                                >
                                    Abrir
                                </Link>
                            </div>
                        ))}
                    </div>
                </HudPanel>
            </div>
        </div>
    );
}
