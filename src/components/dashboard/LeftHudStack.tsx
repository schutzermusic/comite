'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Briefcase, TrendingUp, Zap } from 'lucide-react';
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
            {/* ─── Panel A: Action Queue (promoted to top) ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 30 }}>
                <HudPanel
                    title={t('executiveQueue')}
                    accentColor="bg-amber-400"
                    deepLinkHref="/deliberacoes"
                    deepLinkLabel={t('seeAll')}
                    icon={<Zap className="w-3 h-3" />}
                    delay={0.05}
                    badge={data.decisionQueue.length}
                >
                    <div className="space-y-1">
                        {data.decisionQueue.slice(0, 4).map((item) => (
                            <Link
                                key={item.id}
                                href={`/deliberacoes?id=${item.id}`}
                                className="flex items-center gap-2 group py-1.5 pl-2 pr-1 rounded-lg relative hover:bg-white/[0.03] transition-colors cursor-pointer"
                            >
                                <div
                                    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full"
                                    style={{
                                        background: item.severity === 'critical'
                                            ? '#ef4444'
                                            : item.severity === 'high'
                                                ? '#f59e0b'
                                                : '#14b8a6',
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
                                <span className="text-[11px] text-white/80 tracking-[0.01em] truncate flex-1">
                                    {item.title}
                                </span>
                                <span className="text-[9px] text-white/40 tabular-nums flex-shrink-0">
                                    {item.daysOpen}d
                                </span>
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/[0.08] border border-emerald-500/15 text-emerald-400/70 group-hover:text-emerald-400 group-hover:border-emerald-400/30 transition-all flex-shrink-0">
                                    {t('act')}
                                </span>
                            </Link>
                        ))}
                    </div>
                </HudPanel>
            </div>

            {/* ─── Panel B: Portfolio Overview (compact) ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 20, marginTop: '-4px' }}>
                <HudPanel
                    title={scopeMode === 'state' && stateScope ? t('portfolioOverviewState', { uf: stateScope.uf }) : t('portfolioOverview')}
                    accentColor="bg-cyan-400"
                    deepLinkHref={projetosHref}
                    deepLinkLabel={t('scopeProjects')}
                    icon={<Briefcase className="w-3 h-3" />}
                    delay={0.1}
                >
                    <div className="space-y-2">
                        <div className="flex items-end justify-between">
                            <div>
                                <p className="cr-label mb-0.5">{t('portfolioValue')}</p>
                                <HudMetric
                                    value={portfolioValue}
                                    delta={portfolioDelta}
                                    size="xl"
                                />
                            </div>
                            <div className="text-right">
                                <p className="cr-label mb-0.5">{t('averageHealth')}</p>
                                <span className="text-lg font-semibold text-white tabular-nums">
                                    {scopedHealth}%
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <p className="text-lg font-semibold text-white tabular-nums leading-none">
                                    {scopedProjects ?? 12}
                                </p>
                                <p className="cr-label mt-0.5">{t('activeProjects')}</p>
                            </div>
                            <div>
                                <p className="text-lg font-semibold text-white tabular-nums leading-none">
                                    {scopedContracts ?? 46}
                                </p>
                                <p className="cr-label mt-0.5">{t('activeContracts')}</p>
                            </div>
                        </div>

                        <div>
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

            {/* ─── Panel C: Finance Snapshot ─── */}
            <div className="cr-panel-overlap" style={{ zIndex: 10, marginTop: '-4px' }}>
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

            <div className="mt-2 flex items-center justify-between px-2">
                <span className="font-mono text-[10px] tracking-[0.2em] text-ig-fg-subtle">
                    HUD-2026
                </span>
                <span className="text-[9px] uppercase tracking-[0.32em] text-ig-fg-subtle">
                    CONTROL ROOM · V2.6
                </span>
            </div>
        </div>
    );
});
