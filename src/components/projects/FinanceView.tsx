'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
    Zap,
    Link2,
    Plus,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    SlidersHorizontal,
    FileDown,
    Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { HudMetricChip, HudAlertCard } from '@/components/projects/finance-hud';
import { useTheme } from '@/contexts/ThemeContext';
import type { ProjectV2 } from '@/lib/types/project-v2';
import { compactBRL } from '@/lib/utils/project-utils';
import { getLedgerEntries, linkEntriesToProject, formatBRL } from '@/lib/finance/finance-store';
import { selectProjectFinanceView } from '@/lib/finance/selectors/project-finance';
import { resolveFinanceProjectId } from '@/lib/projects/finance-mapping';
import { LedgerCostBreakdown } from '@/components/finance/cost-analysis';
import { FinanceInvestorCockpit, GlassPanel, PanelHeader } from '@/components/projects/FinanceInvestorCockpit';
import { openProjectFinanceReport, type ReportSections } from '@/lib/projects/export-project-finance-report';
import { EditDataButton, ProjectChartEditorHost, type ProjectChartEditorKind } from '@/components/projects/ProjectChartEditors';

// ── Helpers ─────────────────────────────────────────────────────

function getConfidenceLabel(c: string): string {
    if (c === 'high') return 'Alta';
    if (c === 'medium') return 'Média';
    return 'Baixa';
}
function getMethodLabel(m: string): string {
    if (m === 'ac_plus_etc') return 'Custo realizado + Estimativa para concluir';
    return 'Manual';
}

const COST_SERIES_LABELS: Record<string, string> = {
    BAC: 'Orçamento ao concluir',
    AC: 'Custo realizado acumulado',
    EAC: 'Estimativa ao concluir',
    ETC: 'Estimativa para concluir',
};

function costSeriesLabel(key: string): string {
    return COST_SERIES_LABELS[key] ?? key;
}

const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const xAxisFmt = (period: string) => {
    const [, m] = period.split('-');
    return MONTHS_PT[parseInt(m, 10) - 1] || period;
};
const yAxisFmt = (v: number) => compactBRL(v);
const curveCentsToReais = (value: number | null | undefined): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value / 100 : null;

// ── Theme chart palette (dark keeps HUD neons; light uses deep tones) ──

interface ViewPalette {
    isLight: boolean;
    success: string;
    info: string;
    cost: string;
    warning: string;
    critical: string;
    grid: string;
    tick: string;
    axis: string;
    cutoff: string;
    dotStroke: string;
}

function buildViewPalette(isLight: boolean): ViewPalette {
    return {
        isLight,
        success: isLight ? '#047857' : '#10B981',
        info: isLight ? '#1D4ED8' : '#3B82F6',
        cost: isLight ? '#C2410C' : '#FB923C',
        warning: isLight ? '#B45309' : '#F59E0B',
        critical: isLight ? '#B91C1C' : '#EF4444',
        grid: isLight ? 'rgba(15,23,42,0.07)' : 'rgba(255,255,255,0.06)',
        tick: isLight ? '#64748B' : 'rgba(255,255,255,0.40)',
        axis: isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.08)',
        cutoff: isLight ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.35)',
        dotStroke: isLight ? '#FFFFFF' : '#0B0F14',
    };
}

function getConfidenceColor(c: string, pal: ViewPalette): string {
    if (c === 'high') return pal.success;
    if (c === 'medium') return pal.warning;
    return pal.critical;
}

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
        <div className="p-3 rounded-xl border border-[var(--ig-border-default)] bg-[var(--ig-bg-overlay)] shadow-xl backdrop-blur-sm min-w-[180px]">
            <p className="text-xs text-[var(--ig-fg-muted)] mb-2 font-medium">{periodLabel}</p>
            {visiblePayload.map((entry: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-4 mb-1">
                    <div className="flex items-center gap-2">
                        <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: entry.color }}
                        />
                        <span className="text-xs text-[var(--ig-fg-default)]">{entry.name}</span>
                    </div>
                    <span className="text-xs font-semibold text-[var(--ig-fg-strong)] tabular-nums">
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
                    <div className="mt-1.5 pt-1.5 border-t border-[var(--ig-border-subtle)] space-y-0.5">
                        {eac && bac && (
                            <span className="text-[10px] text-[var(--ig-fg-subtle)] block">
                                Δ {costSeriesLabel('EAC')} − {costSeriesLabel('BAC')}: {compactBRL(eac.value - bac.value)}
                            </span>
                        )}
                        {ac && bac && (
                            <span className="text-[10px] text-[var(--ig-fg-subtle)] block">
                                Δ {costSeriesLabel('AC')} − {costSeriesLabel('BAC')}: {compactBRL(ac.value - bac.value)}
                            </span>
                        )}
                    </div>
                );
            })()}
            {type === 'revenue' && visiblePayload.length >= 2 && (() => {
                const planned = visiblePayload.find((e: any) => e.dataKey === 'Planejado Faturar');
                const billed = visiblePayload.find((e: any) => e.dataKey === 'Faturado');
                return planned && billed ? (
                    <div className="mt-1.5 pt-1.5 border-t border-[var(--ig-border-subtle)]">
                        <span className="text-[10px] text-[var(--ig-fg-subtle)]">
                            Δ Faturado−Plan: {compactBRL(billed.value - planned.value)}
                        </span>
                    </div>
                ) : null;
            })()}
        </div>
    );
}

// ── Cutoff Reference Line Label ─────────────────────────────────

function CutoffLabel({ viewBox, fill }: any) {
    const { x } = viewBox || {};
    return (
        <text x={(x || 0) + 4} y={16} fill={fill || 'rgba(255,255,255,0.55)'} fontSize={9} fontWeight={600}>
            CUTOFF
        </text>
    );
}

// ── Component Props ─────────────────────────────────────────────

interface FinanceViewProps {
    project: ProjectV2;
    /** Re-fetch do projeto após edição manual de dados de gráfico. */
    onProjectChange?: () => void | Promise<void>;
}

// ── Main Component ──────────────────────────────────────────────

export function FinanceView({ project, onProjectChange }: FinanceViewProps) {
    const router = useRouter();
    const { theme } = useTheme();
    const pal = useMemo(() => buildViewPalette(theme === 'light'), [theme]);
    const [hiddenCostSeries, setHiddenCostSeries] = useState<Set<string>>(new Set());
    const [hiddenRevSeries, setHiddenRevSeries] = useState<Set<string>>(new Set());
    const [activeEditor, setActiveEditor] = useState<ProjectChartEditorKind | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [internalOpen, setInternalOpen] = useState<boolean | null>(null);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportMenuOpen, setExportMenuOpen] = useState(false);
    const exportMenuRef = useRef<HTMLDivElement>(null);

    // Close export menu on outside click
    useEffect(() => {
        if (!exportMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
                setExportMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [exportMenuOpen]);

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

    // Internal controls stay collapsed unless there is meaningful cost-control
    // data (BAC/AC/EAC > 0) so empty operational sections don't dominate the
    // investor-facing page.
    const hasCostControlData = Boolean(view && (view.baf.bac > 0 || view.baf.ac > 0 || view.baf.eac > 0));
    const showInternal = internalOpen ?? hasCostControlData;

    // ── Recharts series (already in reais) ──
    // project.costCurve (edição manual) tem precedência sobre o ledger — mesmo
    // padrão de merge usado na curva de receita abaixo.
    const costData = useMemo(() => {
        const ledgerByPeriod = new Map(
            (view?.sCurve.cost ?? []).map(p => [p.period, p]),
        );
        const projectByPeriod = new Map(
            (project.costCurve ?? []).map(p => [p.period, p]),
        );
        const periods = Array.from(new Set([
            ...projectByPeriod.keys(),
            ...ledgerByPeriod.keys(),
        ])).sort((a, b) => a.localeCompare(b));

        return periods.map(period => {
            const projectPoint = projectByPeriod.get(period);
            const ledgerPoint = ledgerByPeriod.get(period);
            return {
                period,
                BAC: curveCentsToReais(projectPoint?.bacCumulative) ?? ledgerPoint?.BAC ?? null,
                AC: curveCentsToReais(projectPoint?.acCumulative) ?? ledgerPoint?.AC ?? null,
                EAC: curveCentsToReais(projectPoint?.eacCumulative) ?? ledgerPoint?.EAC ?? null,
            };
        });
    }, [project.costCurve, view]);

    const revenueData = useMemo(() => {
        const ledgerByPeriod = new Map(
            (view?.sCurve.revenue ?? []).map(p => [p.period, p]),
        );
        const projectByPeriod = new Map(
            (project.revenueCurve ?? []).map(p => [p.period, p]),
        );
        const periods = Array.from(new Set([
            ...projectByPeriod.keys(),
            ...ledgerByPeriod.keys(),
        ])).sort((a, b) => a.localeCompare(b));

        return periods.map(period => {
            const projectPoint = projectByPeriod.get(period);
            const ledgerPoint = ledgerByPeriod.get(period);
            const planned = curveCentsToReais(projectPoint?.plannedCumulative) ?? ledgerPoint?.planned ?? 0;
            const billed = curveCentsToReais(projectPoint?.billedCumulative) ?? ledgerPoint?.billed ?? null;
            const received = curveCentsToReais(projectPoint?.receivedCumulative) ?? ledgerPoint?.received ?? null;
            return {
                period,
                'Planejado Faturar': planned,
                'Faturado': billed,
                'Recebido': received,
            };
        });
    }, [project.revenueCurve, view]);

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

    // ── Investor PDF report (print window → PDF). Uses the SAME ledger view
    //    and project state shown on screen — no recalculation here. ──
    const handleExportPdf = useCallback((sections: ReportSections = 'all') => {
        setExportError(null);
        setExporting(true);
        setExportMenuOpen(false);
        // Defer one frame so the button paints its loading state before the
        // synchronous report build / window.open blocks the main thread.
        requestAnimationFrame(() => {
            const result = openProjectFinanceReport({
                project,
                ledgerView: view,
                cutoffPeriod,
                sections,
            });
            if (!result.ok) setExportError(result.message);
            setExporting(false);
        });
    }, [project, view, cutoffPeriod]);

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
                            className={`flex items-center gap-1.5 text-[11px] transition-all px-1.5 py-0.5 rounded hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_6%,transparent)] ${isHidden ? 'opacity-30 line-through' : 'opacity-100'}`}
                        >
                            <div className="w-3 h-0.5 rounded-full" style={{ background: entry.color }} />
                            <span className={isHidden ? 'text-[var(--ig-fg-disabled)]' : 'text-[var(--ig-fg-muted)]'}>
                                {costSeriesLabel(entry.dataKey || entry.value)}
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
                            className={`flex items-center gap-1.5 text-[11px] transition-all px-1.5 py-0.5 rounded hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_6%,transparent)] ${isHidden ? 'opacity-30 line-through' : 'opacity-100'}`}
                        >
                            <div className="w-3 h-0.5 rounded-full" style={{ background: entry.color }} />
                            <span className={isHidden ? 'text-[var(--ig-fg-disabled)]' : 'text-[var(--ig-fg-muted)]'}>
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

    return (
        <div className="min-w-0 space-y-6">
            {/* ── Financeiro tab header + investor PDF export ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Visão Financeira / Visão do Investidor</p>
                    <p className="text-[11px] text-[color:var(--ig-fg-muted)]">Relatório financeiro do projeto · pronto para apresentação a investidores e conselho</p>
                </div>
                <div className="relative flex flex-col items-end gap-1" ref={exportMenuRef}>
                    <button
                        onClick={() => setExportMenuOpen(!exportMenuOpen)}
                        disabled={exporting}
                        title="Gera um relatório em PDF (abre uma janela de impressão)"
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--ig-border-default)] bg-[color-mix(in_srgb,var(--ig-fg-strong)_4%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--ig-fg-default)] transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_8%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {exporting
                            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Gerando PDF...</>
                            : <><FileDown className="h-3.5 w-3.5" />Exportar PDF <ChevronDown className="h-3 w-3 opacity-60" /></>}
                    </button>
                    {/* Export dropdown menu */}
                    {exportMenuOpen && !exporting && (
                        <div className="absolute right-0 top-full z-50 mt-1.5 min-w-[240px] overflow-hidden rounded-xl border border-[var(--ig-border-default)] bg-[var(--ig-bg-overlay)] shadow-xl backdrop-blur-md">
                            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--ig-fg-subtle)] border-b border-[var(--ig-border-subtle)]">
                                Escolha o conteúdo do PDF
                            </div>
                            <button
                                onClick={() => handleExportPdf('financeiro')}
                                className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_6%,transparent)]"
                            >
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--ig-success)_14%,transparent)] text-[var(--ig-success)]">
                                    <DollarSign className="h-3 w-3" />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[var(--ig-fg-strong)]">Relatório Financeiro</p>
                                    <p className="text-[10px] text-[var(--ig-fg-muted)]">Curva S, fluxo mensal, eventograma, resultado e sensibilidade</p>
                                </div>
                            </button>
                            <button
                                onClick={() => handleExportPdf('controle-interno')}
                                className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_6%,transparent)]"
                            >
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--ig-info)_14%,transparent)] text-[var(--ig-info)]">
                                    <SlidersHorizontal className="h-3 w-3" />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[var(--ig-fg-strong)]">Controle Interno</p>
                                    <p className="text-[10px] text-[var(--ig-fg-muted)]">BAC / AC / EAC / ETC, variações de custo e detalhamento</p>
                                </div>
                            </button>
                            <div className="border-t border-[var(--ig-border-subtle)]">
                                <button
                                    onClick={() => handleExportPdf('all')}
                                    className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_6%,transparent)]"
                                >
                                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--ig-accent)_14%,transparent)] text-[var(--ig-accent)]">
                                        <FileDown className="h-3 w-3" />
                                    </span>
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold text-[var(--ig-fg-strong)]">Completo</p>
                                        <p className="text-[10px] text-[var(--ig-fg-muted)]">Financeiro + Controle Interno em um único relatório</p>
                                    </div>
                                </button>
                            </div>
                        </div>
                    )}
                    {exportError && (
                        <span className="max-w-[280px] text-right text-[10px] text-[var(--ig-critical)]">{exportError}</span>
                    )}
                </div>
            </div>

            {/* ── Investor Financial Cockpit (primary content) ── */}
            <FinanceInvestorCockpit project={project} ledgerView={view} cutoffPeriod={cutoffPeriod} onEditChart={setActiveEditor} />

            {/* ── Manual chart-data editor (single modal instance) ── */}
            <ProjectChartEditorHost
                project={project}
                editor={activeEditor}
                onClose={() => setActiveEditor(null)}
                onSaved={onProjectChange}
            />

            {/* ── Internal project-control section (secondary / collapsible) ── */}
            <section className="space-y-5">
                <button
                    onClick={() => setInternalOpen(!showInternal)}
                    className="flex w-full items-center justify-between rounded-2xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/55 px-4 py-3 backdrop-blur-sm transition-all hover:border-[color:var(--ig-border-strong)] hover:bg-[color:var(--ig-bg-raised)]/80"
                >
                    <div className="flex items-center gap-3">
                        <span
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                            style={{
                                background: `color-mix(in oklab, ${pal.info} 14%, transparent)`,
                                color: pal.info,
                                boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${pal.info} 28%, transparent)`,
                            }}
                        >
                            <SlidersHorizontal className="h-4 w-4" />
                        </span>
                        <div className="text-left">
                            <p className="text-sm font-semibold tracking-tight text-[color:var(--ig-fg-strong)]">Controle Interno do Projeto</p>
                            <p className="text-[11px] text-[color:var(--ig-fg-muted)]">
                                Orçamento, realizado, estimativa ao concluir · ledger oficial · detalhamento de custos
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {view && (
                            hasCostControlData ? (
                                <span className="hidden font-mono text-[11px] tabular-nums text-[color:var(--ig-fg-muted)] md:inline">
                                    {costSeriesLabel('EAC')} {compactBRL(view.baf.eac)} · {costSeriesLabel('AC')} {compactBRL(view.baf.ac)}
                                </span>
                            ) : (
                                <span className="hidden rounded-full border border-[color:var(--ig-border-default)] px-2 py-0.5 text-[10px] text-[color:var(--ig-fg-subtle)] md:inline">
                                    sem dados de controle de custo
                                </span>
                            )
                        )}
                        {showInternal
                            ? <ChevronUp className="h-4 w-4 text-[color:var(--ig-fg-muted)]" />
                            : <ChevronDown className="h-4 w-4 text-[color:var(--ig-fg-muted)]" />}
                    </div>
                </button>

                {showInternal && (
                    <>
                        {/* ── Ledger-derived KPI strip (BAC / AC / EAC / ETC / Receita / Margem) ── */}
                        {view && (
                            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
                                {([
                                    { label: costSeriesLabel('BAC'), value: view.baf.bac, color: pal.info },
                                    { label: costSeriesLabel('AC'), value: view.baf.ac, color: pal.success },
                                    { label: costSeriesLabel('EAC'), value: view.baf.eac, color: pal.cost },
                                    { label: costSeriesLabel('ETC'), value: view.baf.etc, color: pal.warning },
                                    { label: 'Receita realizada', value: view.summary.revenue, color: pal.success },
                                    { label: 'Margem', value: view.summary.margin, color: view.summary.margin >= 0 ? pal.success : pal.critical, sub: `${view.summary.marginPct.toFixed(1)}%` },
                                ] as const).map((k) => (
                                    <div key={k.label} className="relative min-w-0 overflow-hidden rounded-xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/55 px-3 py-2.5 backdrop-blur-sm">
                                        <div className="absolute inset-x-3 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${k.color}, transparent)` }} />
                                        <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">{k.label}</p>
                                        <p className="mt-1 truncate font-mono text-sm font-semibold tabular-nums" style={{ color: k.color }}>{compactBRL(k.value)}</p>
                                        {'sub' in k && k.sub && <p className="font-mono text-[10px] tabular-nums" style={{ color: k.color }}>{k.sub}</p>}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* ── Shortcut actions → Finance ledger (prefilled) ── */}
                        {financeProjectId && (
                            <div className="flex flex-wrap items-center gap-2">
                                <button onClick={() => goToNewEntry('expense')} className="flex items-center gap-1.5 rounded-lg border border-[var(--ig-border-default)] bg-[color-mix(in_srgb,var(--ig-fg-strong)_4%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--ig-fg-default)] transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_8%,transparent)]"><Plus className="w-3.5 h-3.5" />Nova despesa</button>
                                <button onClick={() => goToNewEntry('revenue')} className="flex items-center gap-1.5 rounded-lg border border-[var(--ig-border-default)] bg-[color-mix(in_srgb,var(--ig-fg-strong)_4%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--ig-fg-default)] transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_8%,transparent)]"><Plus className="w-3.5 h-3.5" />Nova receita</button>
                                <button onClick={() => goToNewEntry('budget')} className="flex items-center gap-1.5 rounded-lg border border-[var(--ig-border-default)] bg-[color-mix(in_srgb,var(--ig-fg-strong)_4%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--ig-fg-default)] transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_8%,transparent)]"><Plus className="w-3.5 h-3.5" />Novo orçado</button>
                                <button onClick={() => goToNewEntry('forecast')} className="flex items-center gap-1.5 rounded-lg border border-[var(--ig-border-default)] bg-[color-mix(in_srgb,var(--ig-fg-strong)_4%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--ig-fg-default)] transition-colors hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_8%,transparent)]"><Plus className="w-3.5 h-3.5" />Novo forecast</button>
                            </div>
                        )}

                        {/* ── Pending pre-project costs (excluded from AC until linked) ── */}
                        {pending && pending.count > 0 && (
                            <HudAlertCard
                                accent={pal.warning}
                                icon={<AlertTriangle className="h-4 w-4" />}
                                title="Custos pendentes relacionados ao contrato"
                                message={<>
                                    {pending.count} custo(s) no contrato <span className="font-mono">{pending.contract_id}</span> lançados antes do projeto — não entram no AC/margem até serem vinculados. Total {formatBRL(pending.totalCents)}.
                                </>}
                                action={
                                    <button onClick={handleLinkPending} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--ig-accent)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90">
                                        <Link2 className="h-3.5 w-3.5" />Vincular custos
                                    </button>
                                }
                            >
                                <ul className="mt-3 divide-y divide-[var(--ig-border-subtle)]">
                                    {pending.entries.map((e) => (
                                        <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                                            <span className="truncate text-xs text-[var(--ig-fg-default)]">{e.entry_date} • {e.description}</span>
                                            <span className="shrink-0 font-mono text-xs text-[var(--ig-fg-strong)]">{formatBRL(e.amount_cents)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </HudAlertCard>
                        )}

                        {/* ── Twin S-Curve Charts ───────── */}
                        {(costData.length > 0 || revenueData.length > 0) && (
                            <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
                                {/* Chart A — COST */}
                                {costData.length > 0 && (
                                    <GlassPanel>
                                      <PanelHeader
                                        icon={<DollarSign className="h-4 w-4" />}
                                        accent={pal.info}
                                        title="Custo Acumulado"
                                        subtitle={`${costSeriesLabel('BAC')} × ${costSeriesLabel('AC')} × ${costSeriesLabel('EAC')} · ledger oficial`}
                                        actions={
                                            <>
                                                <EditDataButton onClick={() => setActiveEditor('costCurve')} />
                                                <Badge variant="outline" className="text-[10px] border-[color:var(--ig-border-default)] text-[color:var(--ig-fg-subtle)]">
                                                    COST
                                                </Badge>
                                            </>
                                        }
                                      />
                                      <div className="min-w-0 flex-1 px-5 pb-4 pt-3">
                                        <ResponsiveContainer width="100%" height={240}>
                                            <AreaChart data={costData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                                                <defs>
                                                    <linearGradient id="gradBAC" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={pal.info} stopOpacity={0.15} />
                                                        <stop offset="95%" stopColor={pal.info} stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="gradAC" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={pal.success} stopOpacity={0.15} />
                                                        <stop offset="95%" stopColor={pal.success} stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="gradEAC" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={pal.cost} stopOpacity={0.15} />
                                                        <stop offset="95%" stopColor={pal.cost} stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke={pal.grid} />
                                                <XAxis
                                                    dataKey="period"
                                                    tickFormatter={xAxisFmt}
                                                    tick={{ fontSize: 10, fill: pal.tick }}
                                                    axisLine={{ stroke: pal.axis }}
                                                    tickLine={false}
                                                />
                                                <YAxis
                                                    tickFormatter={yAxisFmt}
                                                    tick={{ fontSize: 10, fill: pal.tick }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    width={70}
                                                />
                                                {/* Cutoff vertical marker */}
                                                <ReferenceLine
                                                    x={cutoffPeriod}
                                                    stroke={pal.cutoff}
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.5}
                                                    label={<CutoffLabel fill={pal.cutoff} />}
                                                />
                                                <RechartsTooltip
                                                    content={<ChartTooltipContent type="cost" hiddenSeries={hiddenCostSeries} />}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="BAC"
                                                    name={costSeriesLabel('BAC')}
                                                    stroke={pal.info}
                                                    fill="url(#gradBAC)"
                                                    strokeWidth={2}
                                                    strokeOpacity={costVis('BAC')}
                                                    fillOpacity={costVis('BAC') * 0.6}
                                                    dot={false}
                                                    activeDot={{ r: 4, fill: pal.info, stroke: pal.dotStroke, strokeWidth: 2 }}
                                                    connectNulls={false}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="AC"
                                                    name={costSeriesLabel('AC')}
                                                    stroke={pal.success}
                                                    fill="url(#gradAC)"
                                                    strokeWidth={2}
                                                    strokeOpacity={costVis('AC')}
                                                    fillOpacity={costVis('AC') * 0.6}
                                                    dot={false}
                                                    activeDot={{ r: 4, fill: pal.success, stroke: pal.dotStroke, strokeWidth: 2 }}
                                                    connectNulls={false}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="EAC"
                                                    name={costSeriesLabel('EAC')}
                                                    stroke={pal.cost}
                                                    fill="url(#gradEAC)"
                                                    strokeWidth={2}
                                                    strokeDasharray="5 3"
                                                    strokeOpacity={costVis('EAC')}
                                                    fillOpacity={costVis('EAC') * 0.6}
                                                    dot={false}
                                                    activeDot={{ r: 4, fill: pal.cost, stroke: pal.dotStroke, strokeWidth: 2 }}
                                                    connectNulls={false}
                                                />
                                                <Legend content={renderCostLegend} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                      </div>
                                    </GlassPanel>
                                )}

                                {/* Chart B — REVENUE */}
                                {revenueData.length > 0 && (
                                    <GlassPanel>
                                      <PanelHeader
                                        icon={<TrendingUp className="h-4 w-4" />}
                                        accent={pal.success}
                                        title="Receita Acumulada"
                                        subtitle="planejado × faturado × recebido"
                                        actions={
                                            <>
                                                <EditDataButton onClick={() => setActiveEditor('revenueCurve')} />
                                                <Badge variant="outline" className="text-[10px] border-[color:var(--ig-border-default)] text-[color:var(--ig-fg-subtle)]">
                                                    REVENUE
                                                </Badge>
                                            </>
                                        }
                                      />
                                      <div className="min-w-0 flex-1 px-5 pb-4 pt-3">
                                        {/* Revenue Gap Chips */}
                                        {revenueGaps && (
                                            <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
                                                <HudMetricChip
                                                    icon={<Zap className="h-3 w-3" />}
                                                    label="A Faturar"
                                                    value={compactBRL(revenueGaps.toBill)}
                                                    sub={`${revenueGaps.toBillPct.toFixed(0)}%`}
                                                    color={chipColor(revenueGaps.toBillPct, pal).fg}
                                                    title="Saldo contratual ainda não faturado"
                                                />
                                                <HudMetricChip
                                                    icon={<Zap className="h-3 w-3" />}
                                                    label="A Receber"
                                                    value={compactBRL(revenueGaps.toReceive)}
                                                    sub={`${revenueGaps.toReceivePct.toFixed(0)}%`}
                                                    color={chipColor(revenueGaps.toReceivePct, pal).fg}
                                                    title="Valor faturado ainda não recebido"
                                                />
                                            </div>
                                        )}

                                        <ResponsiveContainer width="100%" height={240}>
                                            <AreaChart data={revenueData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                                                <defs>
                                                    <linearGradient id="gradPlanned" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={pal.info} stopOpacity={0.12} />
                                                        <stop offset="95%" stopColor={pal.info} stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="gradBilled" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={pal.success} stopOpacity={0.15} />
                                                        <stop offset="95%" stopColor={pal.success} stopOpacity={0} />
                                                    </linearGradient>
                                                    <linearGradient id="gradReceived" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor={pal.warning} stopOpacity={0.12} />
                                                        <stop offset="95%" stopColor={pal.warning} stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke={pal.grid} />
                                                <XAxis
                                                    dataKey="period"
                                                    tickFormatter={xAxisFmt}
                                                    tick={{ fontSize: 10, fill: pal.tick }}
                                                    axisLine={{ stroke: pal.axis }}
                                                    tickLine={false}
                                                />
                                                <YAxis
                                                    tickFormatter={yAxisFmt}
                                                    tick={{ fontSize: 10, fill: pal.tick }}
                                                    axisLine={false}
                                                    tickLine={false}
                                                    width={70}
                                                />
                                                {/* Cutoff vertical marker */}
                                                <ReferenceLine
                                                    x={cutoffPeriod}
                                                    stroke={pal.cutoff}
                                                    strokeDasharray="4 4"
                                                    strokeWidth={1.5}
                                                    label={<CutoffLabel fill={pal.cutoff} />}
                                                />
                                                <RechartsTooltip
                                                    content={<ChartTooltipContent type="revenue" hiddenSeries={hiddenRevSeries} />}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="Planejado Faturar"
                                                    stroke={pal.info}
                                                    fill="url(#gradPlanned)"
                                                    strokeWidth={2}
                                                    strokeDasharray="5 3"
                                                    strokeOpacity={revVis('Planejado Faturar')}
                                                    fillOpacity={revVis('Planejado Faturar') * 0.6}
                                                    dot={false}
                                                    activeDot={{ r: 4, fill: pal.info, stroke: pal.dotStroke, strokeWidth: 2 }}
                                                    connectNulls={false}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="Faturado"
                                                    stroke={pal.success}
                                                    fill="url(#gradBilled)"
                                                    strokeWidth={2}
                                                    strokeOpacity={revVis('Faturado')}
                                                    fillOpacity={revVis('Faturado') * 0.6}
                                                    dot={false}
                                                    activeDot={{ r: 4, fill: pal.success, stroke: pal.dotStroke, strokeWidth: 2 }}
                                                    connectNulls={false}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="Recebido"
                                                    stroke={pal.warning}
                                                    fill="url(#gradReceived)"
                                                    strokeWidth={2}
                                                    strokeOpacity={revVis('Recebido')}
                                                    fillOpacity={revVis('Recebido') * 0.6}
                                                    dot={false}
                                                    activeDot={{ r: 4, fill: pal.warning, stroke: pal.dotStroke, strokeWidth: 2 }}
                                                    connectNulls={false}
                                                />
                                                <Legend content={renderRevLegend} />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                      </div>
                                    </GlassPanel>
                                )}
                            </div>
                        )}

                        {/* ── Bottom Row: Breakdown + Forecast ───────── */}
                        <div className="grid min-w-0 grid-cols-1 items-stretch gap-5 lg:grid-cols-3">
                            {/* Cost Breakdown Table */}
                            <div className="flex min-w-0 w-full lg:col-span-2">
                              <GlassPanel>
                                <PanelHeader
                                    icon={<BarChart3 className="h-4 w-4" />}
                                    accent={pal.info}
                                    title="Detalhamento Financeiro"
                                    subtitle={`custos por categoria · variação ${costSeriesLabel('EAC')} vs ${costSeriesLabel('BAC')}`}
                                    actions={
                                        <Badge variant="outline" className="text-[10px] border-[color:var(--ig-border-default)] text-[color:var(--ig-fg-subtle)]">
                                            CUSTOS
                                        </Badge>
                                    }
                                />
                                <div className="min-w-0 flex-1 px-5 pb-4 pt-3">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-[var(--ig-border-default)]">
                                                <th className="text-left py-2 px-2 text-[var(--ig-fg-subtle)] font-medium uppercase tracking-wider">
                                                    Categoria
                                                </th>
                                                <th className="text-right py-2 px-2 text-[var(--ig-fg-subtle)] font-medium tracking-wider">
                                                    {costSeriesLabel('BAC')}
                                                </th>
                                                <th className="text-right py-2 px-2 font-medium tracking-wider" style={{ color: pal.success }}>
                                                    {costSeriesLabel('AC')}
                                                </th>
                                                <th className="text-right py-2 px-2 text-[var(--ig-fg-subtle)] font-medium tracking-wider">
                                                    {costSeriesLabel('EAC')}
                                                </th>
                                                <th className="text-right py-2 px-2 text-[var(--ig-fg-subtle)] font-medium uppercase tracking-wider">
                                                    Var (R$)
                                                </th>
                                                <th className="text-right py-2 px-2 text-[var(--ig-fg-subtle)] font-medium uppercase tracking-wider">
                                                    Var (%)
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {breakdownRows.map((row, i) => {
                                                const isOver = row.varMoney > 0;
                                                const varColor = isOver ? pal.critical : pal.success;
                                                return (
                                                    <tr
                                                        key={i}
                                                        className="border-b border-[var(--ig-border-subtle)] hover:bg-[color-mix(in_srgb,var(--ig-fg-strong)_4%,transparent)] transition-colors"
                                                    >
                                                        <td className="py-2.5 px-2 text-[var(--ig-fg-default)] font-medium">
                                                            {row.category}
                                                        </td>
                                                        <td className="py-2.5 px-2 text-right text-[var(--ig-fg-muted)] tabular-nums">
                                                            {compactBRL(row.bac)}
                                                        </td>
                                                        <td className="py-2.5 px-2 text-right tabular-nums font-medium" style={{ color: pal.success }}>
                                                            {compactBRL(row.ac)}
                                                        </td>
                                                        <td className="py-2.5 px-2 text-right text-[var(--ig-fg-muted)] tabular-nums">
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
                                                <tr className="border-t-2 border-[var(--ig-border-strong)] bg-[color-mix(in_srgb,var(--ig-fg-strong)_4%,transparent)]">
                                                    <td className="py-3 px-2 text-[var(--ig-fg-strong)] font-bold uppercase tracking-wider text-[11px]">
                                                        TOTAL
                                                    </td>
                                                    <td className="py-3 px-2 text-right text-[var(--ig-fg-strong)] font-bold tabular-nums">
                                                        {compactBRL(totals.bac)}
                                                    </td>
                                                    <td className="py-3 px-2 text-right font-bold tabular-nums" style={{ color: pal.success }}>
                                                        {compactBRL(totals.ac)}
                                                    </td>
                                                    <td className="py-3 px-2 text-right text-[var(--ig-fg-strong)] font-bold tabular-nums">
                                                        {compactBRL(totals.eac)}
                                                    </td>
                                                    <td
                                                        className="py-3 px-2 text-right font-bold tabular-nums"
                                                        style={{ color: totals.varMoney > 0 ? pal.critical : pal.success }}
                                                    >
                                                        {totals.varMoney > 0 ? '+' : ''}{compactBRL(totals.varMoney)}
                                                    </td>
                                                    <td
                                                        className="py-3 px-2 text-right font-bold tabular-nums"
                                                        style={{ color: totals.varMoney > 0 ? pal.critical : pal.success }}
                                                    >
                                                        {totals.varMoney > 0 ? '+' : ''}{totals.varPercent.toFixed(1)}%
                                                    </td>
                                                </tr>
                                            )}
                                            {breakdownRows.length === 0 && (
                                                <tr>
                                                    <td colSpan={6} className="py-6 text-center text-[var(--ig-fg-subtle)] text-xs">
                                                        Dados de detalhamento não disponíveis
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                </div>
                              </GlassPanel>
                            </div>

                            {/* Forecast Panel */}
                            <div className="flex min-w-0 w-full">
                              <GlassPanel>
                                <PanelHeader
                                    icon={<TrendingDown className="h-4 w-4" />}
                                    accent={pal.warning}
                                    title="Previsão (Custo)"
                                    subtitle="método, confiança e variação"
                                />
                                <div className="min-w-0 flex-1 px-5 pb-4 pt-3">
                                <div className="space-y-4">
                                    {/* Method + Confidence + Date */}
                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <p className="text-[10px] text-[var(--ig-fg-subtle)] uppercase mb-1 tracking-wider">Método</p>
                                            <Badge variant="outline" className="text-xs border-[var(--ig-border-default)] text-[var(--ig-fg-muted)]">
                                                {getMethodLabel(finance.forecastMethod)}
                                            </Badge>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-[var(--ig-fg-subtle)] uppercase mb-1 tracking-wider">Confiança</p>
                                            <Badge
                                                className="text-xs font-medium border-0"
                                                style={{
                                                    background: `${getConfidenceColor(finance.confidence, pal)}20`,
                                                    color: getConfidenceColor(finance.confidence, pal),
                                                }}
                                            >
                                                {getConfidenceLabel(finance.confidence)}
                                            </Badge>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-[var(--ig-fg-subtle)] uppercase mb-1 tracking-wider">Atualizado</p>
                                            <div className="flex items-center gap-1">
                                                <Clock className="w-3 h-3 text-[var(--ig-fg-subtle)]" />
                                                <span className="text-xs text-[var(--ig-fg-muted)]">{updatedDate}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Variance Summary — uses computed totals for consistency */}
                                    <div className="p-3 rounded-xl bg-[color-mix(in_srgb,var(--ig-fg-strong)_3%,transparent)] border border-[var(--ig-border-subtle)]">
                                        <p className="text-[10px] text-[var(--ig-fg-subtle)] uppercase mb-1 tracking-wider">
                                            Variação {costSeriesLabel('EAC')} vs {costSeriesLabel('BAC')}
                                        </p>
                                        <div className="flex items-end gap-4">
                                            <span
                                                className="text-lg font-bold tabular-nums"
                                                style={{ color: isOverBudget ? pal.critical : pal.success }}
                                            >
                                                {isOverBudget ? '+' : ''}{compactBRL(forecastDelta)}
                                            </span>
                                            <span
                                                className="text-sm font-medium tabular-nums"
                                                style={{ color: isOverBudget ? pal.critical : pal.success }}
                                            >
                                                ({isOverBudget ? '+' : ''}{forecastDeltaPct.toFixed(1)}%)
                                            </span>
                                        </div>
                                        {totals && (
                                            <p className="text-[9px] text-[var(--ig-fg-disabled)] mt-1">
                                                ∑ categorias: {costSeriesLabel('EAC')} {compactBRL(totals.eac)} − {costSeriesLabel('BAC')} {compactBRL(totals.bac)}
                                            </p>
                                        )}
                                    </div>

                                    {/* Top Drivers */}
                                    {finance.drivers && finance.drivers.length > 0 && (
                                        <div>
                                            <p className="text-[10px] text-[var(--ig-fg-subtle)] uppercase mb-2 tracking-wider">
                                                Principais Impulsores
                                            </p>
                                            <div className="space-y-1.5">
                                                {finance.drivers.slice(0, 3).map((driver, i) => (
                                                    <div key={i} className="flex items-center gap-2">
                                                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: pal.warning }} />
                                                        <span className="text-xs text-[var(--ig-fg-muted)]">{driver}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                </div>
                              </GlassPanel>
                            </div>
                        </div>

                        {/* ── Ledger-backed cost analytics (category / subcategory / mobilization) ── */}
                        {financeProjectId && (
                            <LedgerCostBreakdown filter={{ projectId: financeProjectId }} variant="project" />
                        )}
                    </>
                )}
            </section>
        </div>
    );
}

// ── Chip severity color helper ───────────────────────
function chipColor(pct: number, pal: ViewPalette): { bg: string; fg: string } {
    if (pct > 50) return { bg: `${pal.critical}26`, fg: pal.critical };
    if (pct > 30) return { bg: `${pal.warning}26`, fg: pal.warning };
    return { bg: `${pal.success}1F`, fg: pal.success };
}

export default FinanceView;
