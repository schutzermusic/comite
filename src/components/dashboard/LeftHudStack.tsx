'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Briefcase, TrendingUp, Zap, Users } from 'lucide-react';
import { HudPanel, HudMetric, HudSparkline } from './hud';
import type { DashboardPayload } from '@/lib/dashboard-data';
import { formatCurrency } from '@/lib/dashboard-data';
import type { StateAggregate } from '@/data/geo/globe-kpi-data';
import { FinanceSnapshotCharts } from './finance/FinanceSnapshotCharts';

interface LeftHudStackProps {
    data: DashboardPayload;
    scopeMode?: 'global' | 'state';
    stateScope?: StateAggregate | null;
}

const HEALTH_TREND = [72, 74, 71, 78, 82, 80, 85, 83, 86, 84, 87, 85];
const PORTFOLIO_TREND = [88, 92, 97, 103, 108, 113, 118, 121];
const PORTFOLIO_FORECAST = [88, 92, 97, 103, 108, 115, 123, 132];
const PORTFOLIO_BAND_LOW = [86, 90, 95, 101, 106, 111, 116, 121];
const PORTFOLIO_BAND_HIGH = [91, 96, 102, 108, 114, 121, 129, 138];

export const LeftHudStack = React.memo(function LeftHudStack({ data, scopeMode = 'global', stateScope = null }: LeftHudStackProps) {
    const t = useTranslations('dashboard');
    const scopedActiveValue = scopeMode === 'state' && stateScope
        ? stateScope.contractTotal
        : data.portfolioMetrics?.activeValue;
    const scopedProjects = scopeMode === 'state' && stateScope
        ? stateScope.projectCount
        : data.brazilProjectsMap?.summary.active;
    const scopedContracts = scopeMode === 'state' && stateScope
        ? stateScope.projectCount
        : data.financialOverview?.projectsUnderGovernance;
    const scopedHealth = scopeMode === 'state' && stateScope
        ? Math.max(22, Math.min(96, Math.round(100 - (stateScope.riskCount / Math.max(1, stateScope.projectCount * 3)) * 100)))
        : data.healthMetrics.overallHealth;

    const portfolioValue = typeof scopedActiveValue === 'number'
        ? formatCurrency(scopedActiveValue, data.portfolioMetrics?.currency || 'BRL')
        : '—';
    const portfolioDelta = scopeMode === 'state' ? undefined : data.portfolioMetrics?.activeValueDelta;
    const projetosHref = scopeMode === 'state' && stateScope ? `/projetos?state=${stateScope.uf}&uf=${stateScope.uf}` : '/projetos';

    return (
        <div className="cr-panel-stack-left">
            {/* ─── Panel A: Portfolio Overview ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 30 }}>
                <HudPanel
                    title={scopeMode === 'state' && stateScope ? t('portfolioOverviewState', { uf: stateScope.uf }) : t('portfolioOverview')}
                    accentColor="bg-cyan-400"
                    deepLinkHref={projetosHref}
                    deepLinkLabel={t('scopeProjects')}
                    icon={<Briefcase className="w-3 h-3" />}
                    delay={0.1}
                >
                    <div className="space-y-2.5">
                        <div>
                            <p className="cr-label mb-1">
                                {t('portfolioValue')}
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
                                    {scopedProjects ?? 12}
                                </p>
                                <p className="cr-label mt-0.5">{t('activeProjects')}</p>
                            </div>
                            <div>
                                <p className="text-xl font-bold text-white tabular-nums leading-none" style={{ textShadow: '0 0 14px rgba(106, 223, 255, 0.18)' }}>
                                    {scopedContracts ?? 46}
                                </p>
                                <p className="cr-label mt-0.5">{t('activeContracts')}</p>
                            </div>
                        </div>

                        {/* Portfolio trend band */}
                        <div>
                            <div className="flex items-baseline justify-between mb-1">
                                <p className="cr-label">{t('portfolioTrendForecast')}</p>
                                <span className="text-[10px] font-semibold text-cyan-200/80 tabular-nums">{t('horizon8m')}</span>
                            </div>
                            <HudSparkline
                                values={PORTFOLIO_TREND}
                                forecastValues={PORTFOLIO_FORECAST}
                                bandLower={PORTFOLIO_BAND_LOW}
                                bandUpper={PORTFOLIO_BAND_HIGH}
                                variant="line"
                                color="#5ad4f0"
                                height={30}
                            />
                        </div>

                        {/* Health sparkline */}
                        <div>
                            <div className="flex items-baseline justify-between mb-1">
                                <p className="cr-label">{t('averageHealth')}</p>
                                <span className="text-base font-bold text-white tabular-nums" style={{ textShadow: '0 0 14px rgba(16, 185, 129, 0.22)' }}>
                                    {scopedHealth}%
                                </span>
                            </div>
                            <HudSparkline
                                values={HEALTH_TREND}
                                variant="line"
                                color="#10b981"
                                height={20}
                            />
                        </div>
                    </div>
                </HudPanel>
            </div>

            {/* ─── Panel B: Finance Snapshot (with mini-charts) ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 20, marginTop: '-6px' }}>
                <HudPanel
                    title={t('financeSnapshot')}
                    accentColor="bg-emerald-400"
                    deepLinkHref="/contratos"
                    deepLinkLabel={t('scopeContracts')}
                    icon={<TrendingUp className="w-3 h-3" />}
                    delay={0.2}
                >
                    {data.financialPulse ? (
                        <FinanceSnapshotCharts financialPulse={data.financialPulse} />
                    ) : (
                        <p className="text-[10px] text-white/30">{t('noFinancialData')}</p>
                    )}
                </HudPanel>
            </div>

            {/* ─── Panel C: Fila Executiva ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 10, marginTop: '-6px' }}>
                <HudPanel
                    title={t('executiveQueue')}
                    accentColor="bg-amber-400"
                    deepLinkHref="/deliberacoes"
                    deepLinkLabel={t('seeAll')}
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
});
