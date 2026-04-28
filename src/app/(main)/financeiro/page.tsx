'use client';

import { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { TrendingUp, CheckCircle2 } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from '@/contexts/ThemeContext';
import {
  HudPageLayout, HudHeader, HudPanel, HudSelect, HudStatusPill,
  HudDrawer, HudTable, HudButton, HudEmptyState, HudKpiStrip,
  type HudTableColumn, type KpiItem,
} from '@/components/hud';
import {
  computePnL, computeCostStackMonthly, computeMarginByProject,
  computeDataQuality, getPendingActionCount, getLedgerEntries,
  computeTopDrivers, getPendingActions,
  formatBRL, formatCompactBRL,
} from '@/lib/finance/finance-store';
import type { LedgerEntry, ManagementGroupKey, TopDriver, PendingAction } from '@/lib/types/finance';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// ── Helpers ───────────────────────────────────────────────────

const GROUP_COLORS: Record<ManagementGroupKey, string> = {
  revenue: '#10b981',
  cogs: '#f59e0b',
  opex: '#6366f1',
  financial: '#ec4899',
  taxes: '#ef4444',
};

const GROUP_TEXT_COLORS: Record<ManagementGroupKey, string> = {
  revenue: 'text-emerald-400',
  cogs: 'text-amber-400',
  opex: 'text-indigo-400',
  financial: 'text-pink-400',
  taxes: 'text-red-400',
};

const STATUS_VARIANTS: Record<string, string> = {
  draft: 'pending',
  in_review: 'warning',
  approved: 'info',
  posted: 'completed',
  reconciled: 'active',
  void: 'error',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  in_review: 'Em Revisão',
  approved: 'Aprovado',
  posted: 'Postado',
  reconciled: 'Reconciliado',
  void: 'Anulado',
};

function displayFinanceLabel(label?: string | null): string {
  if (!label) return '';

  return label
    .replace(/\s*\(COGS\)/g, '')
    .replace(/\s*\(OPEX\)/g, '')
    .replace(/\bCOGS\b/g, 'Custo Direto')
    .replace(/\bOPEX\b/g, 'Despesas Operacionais');
}

function agingColor(days: number): string {
  if (days <= 3) return 'text-white/60';
  if (days <= 7) return 'text-amber-400';
  return 'text-red-400';
}

function marginColor(pct: number): string {
  if (pct >= 30) return '#10b981';
  if (pct >= 15) return '#f59e0b';
  return '#ef4444';
}

// ── Drill-down Drawer for filtered ledger entries ─────────────

type DrawerState =
  | { type: 'closed' }
  | { type: 'metric'; title: string; groupKey?: ManagementGroupKey; periodFrom: string; periodTo: string }
  | { type: 'project'; projectId: string; projectName: string; periodFrom: string; periodTo: string }
  | { type: 'variance'; driver: TopDriver; periodFrom: string; periodTo: string }
  | { type: 'quality'; qualityKey: string; title: string; periodKey: string }
  | { type: 'entry'; entryId: string };

// ── Main Component ────────────────────────────────────────────

export default function FinanceOverviewPage() {
  const t = useTranslations('finance');
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [periodFrom, setPeriodFrom] = useState('2026-01');
  const [periodTo, setPeriodTo] = useState('2026-03');
  const [drawer, setDrawer] = useState<DrawerState>({ type: 'closed' });

  // ── Computed data ────────────────────────────────────────
  const pnl = useMemo(() => computePnL(periodFrom, periodTo), [periodFrom, periodTo]);
  const costStack = useMemo(() => computeCostStackMonthly(periodFrom, periodTo), [periodFrom, periodTo]);
  const margins = useMemo(() => computeMarginByProject(periodFrom, periodTo), [periodFrom, periodTo]);
  const quality = useMemo(() => computeDataQuality(periodTo), [periodTo]);
  const pendingCount = useMemo(() => getPendingActionCount(), []);
  const pendingActions = useMemo(() => getPendingActions(), []);
  const topDrivers = useMemo(() => computeTopDrivers(periodFrom, periodTo), [periodFrom, periodTo]);

  const revenue = pnl.find(r => r.group_key === 'revenue')?.actual || 0;
  const cogs = pnl.find(r => r.group_key === 'cogs')?.actual || 0;
  const opex = pnl.find(r => r.group_key === 'opex')?.actual || 0;
  const financial = pnl.find(r => r.group_key === 'financial')?.actual || 0;
  const taxes = pnl.find(r => r.group_key === 'taxes')?.actual || 0;
  const grossMargin = revenue + cogs;
  const operatingResult = grossMargin + opex + financial + taxes;
  const marginPct = revenue !== 0 ? (grossMargin / revenue) * 100 : 0;

  // Projects with revenue but zero direct cost
  const inflatedMarginCount = useMemo(() => {
    return margins.filter(m => m.revenue > 0 && m.cogs === 0).length;
  }, [margins]);

  // SLA warning: items > 7 days
  const slaBreachCount = useMemo(() => pendingActions.filter(a => a.aging_days > 7).length, [pendingActions]);

  // ── Drawer data ──────────────────────────────────────────
  const drawerEntries = useMemo((): LedgerEntry[] => {
    if (drawer.type === 'metric') {
      const filters = { period_from: drawer.periodFrom, period_to: drawer.periodTo };
      const all = getLedgerEntries(filters, 'all');
      if (drawer.groupKey) {
        return all.filter(e => {
          const gk = e.category?.group_key;
          return gk === drawer.groupKey && (e.status === 'approved' || e.status === 'posted' || e.status === 'reconciled') && e.entry_type === 'actual';
        });
      }
      return all.filter(e => (e.status === 'approved' || e.status === 'posted' || e.status === 'reconciled') && e.entry_type === 'actual');
    }
    if (drawer.type === 'project') {
      const filters = { period_from: drawer.periodFrom, period_to: drawer.periodTo, project_ids: [drawer.projectId] };
      return getLedgerEntries(filters, 'all').filter(e => (e.status === 'approved' || e.status === 'posted' || e.status === 'reconciled'));
    }
    if (drawer.type === 'variance') {
      const filters = { period_from: drawer.periodFrom, period_to: drawer.periodTo };
      return getLedgerEntries(filters, 'all').filter(e => {
        const cat = e.category;
        if (!cat) return false;
        // Match L2: either the entry's category is the L2, or its parent is
        return (cat.id === drawer.driver.category_id || cat.parent_id === drawer.driver.category_id) &&
          (e.status === 'posted' || e.status === 'reconciled');
      });
    }
    if (drawer.type === 'quality') {
      const entries = getLedgerEntries({ period_from: drawer.periodKey, period_to: drawer.periodKey }, 'all');
      if (drawer.qualityKey === 'missing_dimensions') return entries.filter(e => e.category?.requires_project && !e.project_id);
      if (drawer.qualityKey === 'pending_evidence') return entries.filter(e => e.evidence_required && !e.evidence_provided);
      if (drawer.qualityKey === 'stale_drafts') return entries.filter(e => {
        if (e.status !== 'draft') return false;
        return (Date.now() - new Date(e.created_at).getTime()) > 5 * 24 * 60 * 60 * 1000;
      });
      return entries;
    }
    if (drawer.type === 'entry') {
      const entries = getLedgerEntries(undefined, 'all');
      return entries.filter(e => e.id === drawer.entryId);
    }
    return [];
  }, [drawer]);

  const closeDrawer = useCallback(() => setDrawer({ type: 'closed' }), []);

  const openMetricDrawer = useCallback((title: string, groupKey?: ManagementGroupKey) => {
    setDrawer({ type: 'metric', title, groupKey, periodFrom, periodTo });
  }, [periodFrom, periodTo]);

  const openProjectDrawer = useCallback((projectId: string, projectName: string) => {
    setDrawer({ type: 'project', projectId, projectName, periodFrom, periodTo });
  }, [periodFrom, periodTo]);

  const openVarianceDrawer = useCallback((driver: TopDriver) => {
    setDrawer({ type: 'variance', driver, periodFrom, periodTo });
  }, [periodFrom, periodTo]);

  const openQualityDrawer = useCallback((qualityKey: string, title: string) => {
    setDrawer({ type: 'quality', qualityKey, title, periodKey: periodTo });
  }, [periodTo]);

  const openEntryDrawer = useCallback((entryId: string) => {
    setDrawer({ type: 'entry', entryId });
  }, []);

  // ── Ledger table columns for drawers ─────────────────────
  const ledgerColumns: HudTableColumn<LedgerEntry>[] = [
    { key: 'entry_date', header: t('date'), width: '90px', cell: (e) => <span className="text-white/70 text-xs tabular-nums">{e.entry_date}</span> },
    { key: 'description', header: t('description'), cell: (e) => (
      <div className="min-w-0">
        <p className="text-white/80 text-xs truncate">{e.description}</p>
        <p className="text-white/30 text-[10px]">{displayFinanceLabel(e.category?.name || e.category_id)}</p>
      </div>
    )},
    { key: 'project', header: t('project'), width: '120px', cell: (e) => (
      <span className="text-white/60 text-xs truncate block">{e.project_name || e.project_id || '—'}</span>
    )},
    { key: 'amount_cents', header: t('amount'), width: '110px', align: 'right', cell: (e) => (
      <span className="text-white/90 text-xs font-medium tabular-nums">{formatBRL(e.amount_cents)}</span>
    )},
    { key: 'status', header: t('status'), width: '90px', align: 'center', cell: (e) => (
      <HudStatusPill variant={STATUS_VARIANTS[e.status] as any || 'pending'} size="sm">
        {STATUS_LABELS[e.status] || e.status}
      </HudStatusPill>
    )},
  ];

  // ── Waterfall chart option ───────────────────────────────
  const waterfallData = useMemo(() => {
    const gm = revenue + cogs;
    const or = gm + opex + financial + taxes;
    return [
      { name: t('revenue'), value: revenue, color: '#10b981', isTotal: false },
      { name: t('directCosts'), value: cogs, color: '#f59e0b', isTotal: false },
      { name: t('grossMargin'), value: gm, color: '#34d399', isTotal: true },
      { name: t('operatingExpenses'), value: opex, color: '#6366f1', isTotal: false },
      { name: t('financialCosts'), value: financial, color: '#ec4899', isTotal: false },
      { name: t('taxesCosts'), value: taxes, color: '#ef4444', isTotal: false },
      { name: t('operatingResult'), value: or, color: '#06b6d4', isTotal: true },
    ];
  }, [revenue, cogs, opex, financial, taxes, t]);

  const waterfallGroupKeys: (ManagementGroupKey | null)[] = ['revenue', 'cogs', null, 'opex', 'financial', 'taxes', null];

  const waterfallOption = useMemo(() => {
    // Calculate running totals for waterfall positioning
    let runningTotal = 0;
    const transparentBars: number[] = [];
    const valueBars: Array<{ value: number; itemStyle: { color: string; borderRadius?: number[] } }> = [];

    waterfallData.forEach((item) => {
      if (item.isTotal) {
        transparentBars.push(0);
        valueBars.push({
          value: item.value,
          itemStyle: { color: item.color, borderRadius: [2, 2, 0, 0] },
        });
        runningTotal = item.value;
      } else if (item.name === waterfallData[0].name) {
        // First bar (Revenue) — starts from 0
        transparentBars.push(0);
        valueBars.push({
          value: item.value,
          itemStyle: { color: item.color, borderRadius: [2, 2, 0, 0] },
        });
        runningTotal = item.value;
      } else {
        // Decrease bar
        const newTotal = runningTotal + item.value; // value is negative
        transparentBars.push(Math.min(runningTotal, newTotal));
        valueBars.push({
          value: Math.abs(item.value),
          itemStyle: { color: item.color, borderRadius: [2, 2, 0, 0] },
        });
        runningTotal = newTotal;
      }
    });

    return {
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: isLight ? 'rgba(255,255,255,0.96)' : '#162522',
        borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(200,220,235,0.12)',
        textStyle: { color: isLight ? '#1C1F24' : '#f0fdf8', fontSize: 11 },
        formatter: (params: any) => {
          const idx = params[0]?.dataIndex ?? 0;
          const item = waterfallData[idx];
          if (!item) return '';
          const pctOfRevenue = revenue !== 0 ? ((Math.abs(item.value) / Math.abs(revenue)) * 100).toFixed(1) : '—';
          return `<b>${item.name}</b><br/>${formatCompactBRL(item.value)}<br/>${pctOfRevenue}% da Receita`;
        },
      },
      grid: { left: 12, right: 16, top: 20, bottom: 48, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: waterfallData.map(d => d.name),
        axisLabel: {
          color: isLight ? '#4B5563' : '#9abfaf',
          fontSize: 9,
          interval: 0,
          rotate: 0,
          lineHeight: 12,
          formatter: (value: string) => value.replace('Custo Direto', 'Custo\nDireto')
            .replace('Margem Bruta', 'Margem\nBruta')
            .replace('Despesas Operacionais', 'Despesas\nOperacionais')
            .replace('Resultado Operacional', 'Resultado\nOperacional'),
        },
        axisLine: { lineStyle: { color: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(200,220,235,0.06)' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { color: isLight ? '#6B7280' : '#6a8b7c', fontSize: 10, formatter: (v: number) => formatCompactBRL(v) },
        splitLine: { lineStyle: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)' } },
        axisLine: { show: false },
      },
      series: [
        {
          name: 'transparent',
          type: 'bar',
          stack: 'waterfall',
          data: transparentBars,
          itemStyle: { color: 'transparent' },
          emphasis: { itemStyle: { color: 'transparent' } },
          tooltip: { show: false },
        },
        {
          name: 'value',
          type: 'bar',
          stack: 'waterfall',
          data: valueBars,
          barWidth: 36,
          label: {
            show: true,
            position: 'top' as const,
            color: isLight ? '#374151' : '#d8f0e4',
            fontSize: 10,
            fontFamily: 'monospace',
            formatter: (p: any) => {
              const idx = p.dataIndex;
              return formatCompactBRL(waterfallData[idx].value);
            },
          },
        },
      ],
    };
  }, [waterfallData, revenue, t, isLight]);

  // ── Cost Composition chart (NO revenue) ──────────────────
  const costCompOption = useMemo(() => {
    const months = costStack.map(m => {
      const [y, mo] = m.period_key.split('-');
      const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      return labels[parseInt(mo) - 1] || m.period_key;
    });

    return {
      tooltip: {
        trigger: 'axis' as const,
        axisPointer: { type: 'shadow' as const },
        backgroundColor: isLight ? 'rgba(255,255,255,0.96)' : '#162522',
        borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(200,220,235,0.12)',
        textStyle: { color: isLight ? '#1C1F24' : '#f0fdf8', fontSize: 11 },
      },
      legend: {
        data: [t('directCosts'), t('operatingExpenses'), 'Financeiro', 'Impostos'],
        type: 'scroll',
        left: 8,
        right: 8,
        textStyle: { color: isLight ? '#4B5563' : '#9abfaf', fontSize: 10 },
        bottom: 0,
        icon: 'rect',
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: 50, right: 16, top: 16, bottom: 54 },
      xAxis: {
        type: 'category' as const,
        data: months,
        axisLabel: { color: isLight ? '#4B5563' : '#9abfaf', fontSize: 10 },
        axisLine: { lineStyle: { color: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(200,220,235,0.06)' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { color: isLight ? '#6B7280' : '#6a8b7c', fontSize: 10, formatter: (v: number) => formatCompactBRL(v) },
        splitLine: { lineStyle: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)' } },
        axisLine: { show: false },
      },
      series: [
        { name: t('directCosts'), type: 'bar', stack: 'costs', data: costStack.map(m => Math.abs(m.cogs)), itemStyle: { color: '#f59e0b' }, barWidth: 28 },
        { name: t('operatingExpenses'), type: 'bar', stack: 'costs', data: costStack.map(m => Math.abs(m.opex)), itemStyle: { color: '#6366f1' }, barWidth: 28 },
        { name: 'Financeiro', type: 'bar', stack: 'costs', data: costStack.map(m => Math.abs(m.financial)), itemStyle: { color: '#ec4899' }, barWidth: 28 },
        { name: 'Impostos', type: 'bar', stack: 'costs', data: costStack.map(m => Math.abs(m.taxes)), itemStyle: { color: '#ef4444' }, barWidth: 28 },
      ],
    };
  }, [costStack, isLight, t]);

  // ── Margin by project chart ──────────────────────────────
  const top10Margins = useMemo(() => margins.filter(m => m.revenue > 0 && m.cogs !== 0).slice(0, 10), [margins]);

  const marginOption = useMemo(() => ({
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: isLight ? 'rgba(255,255,255,0.96)' : '#162522',
      borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(200,220,235,0.12)',
      textStyle: { color: isLight ? '#1C1F24' : '#f0fdf8', fontSize: 11 },
      formatter: (params: any) => {
        const idx = params[0]?.dataIndex ?? 0;
        const proj = top10Margins[top10Margins.length - 1 - idx];
        if (!proj) return '';
        return `<b>${proj.project_name}</b><br/>Receita: ${formatCompactBRL(proj.revenue)}<br/>Custo Direto: ${formatCompactBRL(Math.abs(proj.cogs))}<br/>Margem: ${proj.margin_pct.toFixed(1)}%`;
      },
    },
    grid: { left: 130, right: 50, top: 8, bottom: 8 },
    xAxis: {
      type: 'value' as const,
      axisLabel: { formatter: '{value}%', color: isLight ? '#6B7280' : '#6a8b7c', fontSize: 10 },
      splitLine: { lineStyle: { color: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)' } },
      axisLine: { show: false },
    },
    yAxis: {
      type: 'category' as const,
      data: [...top10Margins].reverse().map(m => m.project_name.slice(0, 22)),
      axisLabel: { color: isLight ? '#4B5563' : '#9abfaf', fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: [...top10Margins].reverse().map(m => ({
        value: Math.round(m.margin_pct * 10) / 10,
        itemStyle: { color: marginColor(m.margin_pct), borderRadius: [0, 2, 2, 0] },
      })),
      barWidth: 16,
      label: {
        show: true,
        position: 'right' as const,
        color: isLight ? '#374151' : '#d8f0e4',
        fontSize: 10,
        fontFamily: 'monospace',
        formatter: (p: any) => `${p.value}%`,
      },
    }],
  }), [top10Margins, isLight]);

  // ── Drawer content ───────────────────────────────────────
  const drawerTitle = useMemo(() => {
    if (drawer.type === 'metric') return drawer.title;
    if (drawer.type === 'project') return `${t('financialDossier')} — ${drawer.projectName}`;
    if (drawer.type === 'variance') return `${displayFinanceLabel(drawer.driver.category_name)}: ${formatCompactBRL(drawer.driver.variance_abs)} vs. Orçamento`;
    if (drawer.type === 'quality') return drawer.title;
    if (drawer.type === 'entry') return t('entryDetails');
    return '';
  }, [drawer, t]);

  const drawerWidth = drawer.type === 'project' ? '720px' : '640px';

  // ── Period options ───────────────────────────────────────
  const periodOptions = [
    { value: '2025-10', label: 'Out/2025' }, { value: '2025-11', label: 'Nov/2025' }, { value: '2025-12', label: 'Dez/2025' },
    { value: '2026-01', label: 'Jan/2026' }, { value: '2026-02', label: 'Fev/2026' }, { value: '2026-03', label: 'Mar/2026' },
    { value: '2026-04', label: 'Abr/2026' }, { value: '2026-05', label: 'Mai/2026' }, { value: '2026-06', label: 'Jun/2026' },
  ];

  // ═════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════

  return (
    <HudPageLayout>
      {/* ── ROW 0: Header ─────────────────────────────────── */}
      <HudHeader
        title={t('title')}
        subtitle={t('overview')}
        icon={<TrendingUp className="w-5 h-5" />}
        iconTint="#14B8A6"
        breadcrumbs={[{ label: t('title') }]}
        actions={
          <div className="flex items-center gap-2">
            <HudSelect label="" value={periodFrom} onChange={setPeriodFrom} options={periodOptions} size="sm" />
            <span className="hud-text-muted text-xs">a</span>
            <HudSelect label="" value={periodTo} onChange={setPeriodTo} options={periodOptions} size="sm" />
          </div>
        }
      />

      {/* ── ROW 1: Executive Strip (standardized HUD KPI strip) ──── */}
      {(() => {
        const execItems: Array<{
          label: string;
          value: string;
          deltaText?: string;
          deltaTone?: 'success' | 'danger' | 'neutral';
          groupKey: ManagementGroupKey | null;
          isPending?: boolean;
          isMargin?: boolean;
          isOperating?: boolean;
        }> = [
          { label: t('kpiNetRevenue'), value: formatCompactBRL(revenue), deltaText: '+8.7%', deltaTone: 'success', groupKey: 'revenue' },
          { label: t('kpiCogs'), value: formatCompactBRL(Math.abs(cogs)), groupKey: 'cogs' },
          { label: t('kpiGrossMargin'), value: `${marginPct.toFixed(1)}%`, groupKey: null, isMargin: true },
          { label: t('kpiOpex'), value: formatCompactBRL(Math.abs(opex)), deltaText: '↓ 3.2%', deltaTone: 'success', groupKey: 'opex' },
          { label: t('kpiOperatingResult'), value: formatCompactBRL(operatingResult), groupKey: null, isOperating: true },
          { label: t('kpiPendingActions'), value: `${pendingCount}`, groupKey: null, isPending: true },
        ];
        const kpis: KpiItem[] = execItems.map((metric, i) => ({
          id: `exec-${i}`,
          label: metric.label,
          value: metric.value,
          deltaText: metric.deltaText,
          deltaTone: metric.deltaTone,
          onClick: () => {
            if (metric.isPending) {
              document.getElementById('approval-queue')?.scrollIntoView({ behavior: 'smooth' });
            } else if (metric.groupKey) {
              openMetricDrawer(`${metric.label} — ${periodFrom} a ${periodTo}`, metric.groupKey);
            } else if (metric.isMargin || metric.isOperating) {
              openMetricDrawer(`${metric.label} — ${periodFrom} a ${periodTo}`);
            }
          },
        }));
        return <HudKpiStrip kpis={kpis} columns={6} size="md" connected className="mt-4" />;
      })()}

      {/* ── ROW 2: P&L Waterfall (8 cols) + Approval Queue (4 cols) ── */}
      <div className="grid grid-cols-12 gap-5 mt-5">
        <div className="col-span-12 lg:col-span-8">
          <HudPanel
            title={t('pnlWaterfall')}
            hoverGlow={false}
            parallax
            serial={`FIN-${new Date().getFullYear()}-PNL`}
            watermark="FIN · OVERVIEW · V2.6"
          >
            {waterfallData.every(d => d.value === 0) ? (
              <HudEmptyState
                title={t('emptyWaterfall')}
                description={t('emptyWaterfallAction')}
                icon="file"
                compact
                action={{ label: t('goToLedger'), onClick: () => window.location.href = '/financeiro/lancamentos' }}
              />
            ) : (
              <ReactECharts
                option={waterfallOption}
                style={{ height: 290 }}
                opts={{ renderer: 'svg' }}
                onEvents={{
                  click: (params: any) => {
                    const idx = params.dataIndex;
                    const gk = waterfallGroupKeys[idx];
                    const name = waterfallData[idx]?.name || '';
                    if (gk) {
                      openMetricDrawer(`${name} — ${periodFrom} a ${periodTo}`, gk);
                    } else {
                      openMetricDrawer(`${name} — ${periodFrom} a ${periodTo}`);
                    }
                  },
                }}
              />
            )}
          </HudPanel>
        </div>

        <div className="col-span-12 lg:col-span-4" id="approval-queue">
          <HudPanel
            title={t('actionQueue')}
            badge={pendingActions.length > 0 ? pendingActions.length : undefined}
            accentColor={slaBreachCount > 0 ? 'red' : 'amber'}
            hoverGlow={false}
            headerActions={
              slaBreachCount > 0 ? (
                <span className="text-[9px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full tabular-nums">
                  SLA: {slaBreachCount} {'>'} 7d
                </span>
              ) : undefined
            }
          >
            {pendingActions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-3" />
                <p className="text-white/60 text-xs">{t('emptyQueue')}</p>
                <p className="text-white/30 text-[10px] mt-1">{t('emptyQueueSub')}</p>
              </div>
            ) : (
              <div className="space-y-0">
                {/* Table header */}
                <div className="grid grid-cols-[1fr_80px_52px_48px] gap-2 px-2 pb-2 border-b border-white/[0.06]">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider font-medium">{t('description')}</span>
                  <span className="text-[10px] text-white/40 uppercase tracking-wider font-medium text-right">{t('impact')}</span>
                  <span className="text-[10px] text-white/40 uppercase tracking-wider font-medium text-right">{t('aging')}</span>
                  <span className="text-[10px] text-white/40 uppercase tracking-wider font-medium text-center">{t('action')}</span>
                </div>
                {pendingActions.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    onClick={() => openEntryDrawer(item.id)}
                    className="grid grid-cols-[1fr_80px_52px_48px] gap-2 px-2 py-2 hover:bg-white/[0.03] cursor-pointer border-b border-white/[0.03] items-center"
                  >
                    <div className="min-w-0">
                      <p className="text-white/80 text-xs truncate">{item.description}</p>
                      <p className="text-white/30 text-[10px] truncate">{displayFinanceLabel(item.category_name)}</p>
                    </div>
                    <span className="text-white/90 text-xs font-medium tabular-nums text-right">
                      {formatCompactBRL(item.amount_cents)}
                    </span>
                    <span className={`text-xs tabular-nums text-right ${agingColor(item.aging_days)}`}>
                      {item.aging_days}d
                    </span>
                    <div className="flex justify-center">
                      <HudButton
                        variant="glass"
                        size="sm"
                        className="!h-6 !px-2 !text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEntryDrawer(item.id);
                        }}
                      >
                        {t('review')}
                      </HudButton>
                    </div>
                  </div>
                ))}
                {pendingActions.length > 6 && (
                  <Link href="/financeiro/lancamentos?tab=in_review" className="block text-center text-cyan-400 text-[10px] hover:text-cyan-300 transition-colors pt-2">
                    {t('viewAll')} ({pendingActions.length}) →
                  </Link>
                )}
              </div>
            )}
          </HudPanel>
        </div>
      </div>

      {/* ── ROW 3: Top Drivers (6 cols) + Margin by Project (6 cols) ── */}
      <div className="grid grid-cols-12 gap-5 mt-5">
        {/* Top Drivers */}
        <div className="col-span-12 lg:col-span-6">
          <HudPanel title={t('topDrivers')} hoverGlow={false}>
            {topDrivers.length === 0 ? (
              <HudEmptyState
                title={t('emptyDrivers')}
                description={t('emptyDriversSub')}
                icon="alert"
                compact
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      <th className="text-left py-2 px-2 text-white/40 font-medium uppercase tracking-wider text-[10px] w-6">#</th>
                      <th className="text-left py-2 px-2 text-white/40 font-medium uppercase tracking-wider text-[10px]">{t('category')}</th>
                      <th className="text-left py-2 px-2 text-white/40 font-medium uppercase tracking-wider text-[10px] w-[100px]">{t('project')}</th>
                      <th className="text-right py-2 px-2 text-white/40 font-medium uppercase tracking-wider text-[10px] w-[90px]">{t('varAbs')}</th>
                      <th className="text-right py-2 px-2 text-white/40 font-medium uppercase tracking-wider text-[10px] w-[56px]">{t('varPct')}</th>
                      <th className="text-right py-2 px-2 text-white/40 font-medium uppercase tracking-wider text-[10px] w-[56px]">{t('contribPct')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDrivers.map((d) => {
                      const isFavorable = (d.group_key === 'revenue' && d.variance_abs > 0) ||
                        (d.group_key !== 'revenue' && d.variance_abs < 0);
                      return (
                        <tr
                          key={`${d.category_id}-${d.project_id}`}
                          onClick={() => openVarianceDrawer(d)}
                          className="border-b border-white/[0.03] hover:bg-white/[0.03] cursor-pointer"
                        >
                          <td className="py-2 px-2 text-white/30 tabular-nums">{d.rank}</td>
                          <td className="py-2 px-2">
                            <span className="text-white/80">{displayFinanceLabel(d.category_name)}</span>
                            <span className={`block text-[10px] ${GROUP_TEXT_COLORS[d.group_key]}`}>{d.group_label}</span>
                          </td>
                          <td className="py-2 px-2 text-white/50 truncate">{d.project_name}</td>
                          <td className={`py-2 px-2 text-right font-medium tabular-nums ${isFavorable ? 'text-emerald-400' : 'text-red-400'}`}>
                            {d.variance_abs > 0 ? '+' : ''}{formatCompactBRL(d.variance_abs)}
                          </td>
                          <td className={`py-2 px-2 text-right tabular-nums ${isFavorable ? 'text-emerald-400' : 'text-red-400'}`}>
                            {d.variance_pct > 0 ? '+' : ''}{d.variance_pct.toFixed(1)}%
                          </td>
                          <td className="py-2 px-2 text-right text-white/40 tabular-nums">
                            {d.contribution_pct.toFixed(0)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </HudPanel>
        </div>

        {/* Margin by Project */}
        <div className="col-span-12 lg:col-span-6">
          <HudPanel title={t('marginByProject')} hoverGlow={false}>
            {top10Margins.length === 0 ? (
              <HudEmptyState
                title={t('emptyMargin')}
                description={t('emptyMarginSub')}
                icon="alert"
                compact
              />
            ) : (
              <>
                <ReactECharts
                  option={marginOption}
                  style={{ height: top10Margins.length * 28 + 16 }}
                  opts={{ renderer: 'svg' }}
                  onEvents={{
                    click: (params: any) => {
                      const idx = params.dataIndex;
                      const proj = top10Margins[top10Margins.length - 1 - idx];
                      if (proj) openProjectDrawer(proj.project_id, proj.project_name);
                    },
                  }}
                />
                {inflatedMarginCount > 0 && (
                  <div className="mt-2 px-2 py-1.5 border border-amber-500/20 rounded bg-amber-500/5 text-[10px] text-amber-400">
                    ⚠ {inflatedMarginCount} projetos têm receita sem custo direto registrado — margem pode estar inflada.
                  </div>
                )}
              </>
            )}
          </HudPanel>
        </div>
      </div>

      {/* ── ROW 4: Cost Composition (12 cols, NO revenue) ── */}
      <div className="mt-5">
        <HudPanel title={t('costStack')} hoverGlow={false}>
          {costStack.length === 0 ? (
            <HudEmptyState
              title={t('emptyCostComp')}
              description={t('emptyCostCompSub')}
              icon="file"
              compact
              action={{ label: t('goToLedger'), onClick: () => window.location.href = '/financeiro/lancamentos' }}
            />
          ) : (
            <ReactECharts
              option={costCompOption}
              style={{ height: 240 }}
              opts={{ renderer: 'svg' }}
              onEvents={{
                click: (params: any) => {
                  const seriesName = params.seriesName;
                  const monthIdx = params.dataIndex;
                  const month = costStack[monthIdx];
                  if (!month) return;
                  const groupMap: Record<string, ManagementGroupKey> = { [t('directCosts')]: 'cogs', [t('operatingExpenses')]: 'opex', Financeiro: 'financial', Impostos: 'taxes' };
                  const gk = groupMap[seriesName];
                  if (gk) {
                    openMetricDrawer(`${seriesName} — ${month.period_key}`, gk);
                  }
                },
              }}
            />
          )}
        </HudPanel>
      </div>

      {/* ── ROW 5: Data Quality Bar (inline, no panel chrome) ── */}
      <div className="mt-4 px-4 py-2.5 rounded-lg bg-black/20 finance-quality-bar flex items-center gap-4 flex-wrap">
        {quality.every(q => q.status === 'green') ? (
          <span className="text-emerald-400 text-[11px] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            ✓ {t('dataQualityOk')}
          </span>
        ) : (
          quality.map((q) => (
            <button
              key={q.key}
              onClick={() => openQualityDrawer(q.key, q.label)}
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity cursor-pointer"
            >
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${
                q.status === 'green' ? 'bg-emerald-400' : q.status === 'yellow' ? 'bg-amber-400' : 'bg-red-400'
              }`} />
              <span className={`text-[11px] tabular-nums ${
                q.status === 'green' ? 'text-emerald-400' : q.status === 'yellow' ? 'text-amber-400' : 'text-red-400'
              }`}>
                {typeof q.value === 'number' && q.value % 1 !== 0 ? `${q.value.toFixed(1)}%` : q.value} {q.label.toLowerCase()}
              </span>
            </button>
          ))
        )}
      </div>

      {/* ── Drill-down Drawer ─────────────────────────────── */}
      <HudDrawer
        isOpen={drawer.type !== 'closed'}
        onClose={closeDrawer}
        title={drawerTitle}
        width={drawerWidth}
      >
        {drawer.type !== 'closed' && (
          <div className="space-y-4">
            {/* Summary bar for metric/variance drills */}
            {(drawer.type === 'metric' || drawer.type === 'variance') && (
              <div className="flex items-center gap-4 pb-3 border-b border-white/[0.06]">
                <div>
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">{t('total')}</span>
                  <p className="text-white font-semibold tabular-nums text-sm">
                    {formatBRL(drawerEntries.reduce((sum, e) => sum + e.amount_cents, 0))}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-white/40 uppercase tracking-wider">{t('entries')}</span>
                  <p className="text-white/70 text-sm tabular-nums">{drawerEntries.length}</p>
                </div>
              </div>
            )}

            {/* Project dossier: mini P&L */}
            {drawer.type === 'project' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {['revenue', 'cogs'].map(gk => {
                    const total = drawerEntries
                      .filter(e => e.category?.group_key === gk && e.entry_type === 'actual')
                      .reduce((sum, e) => sum + (e.amount_cents * (e.category?.sign || 1)), 0);
                    return (
                      <div key={gk} className="text-center p-2 border border-white/[0.06] rounded">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider block">{gk === 'revenue' ? t('revenue') : t('directCosts')}</span>
                        <span className={`text-sm font-semibold tabular-nums ${gk === 'revenue' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {formatCompactBRL(total)}
                        </span>
                      </div>
                    );
                  })}
                  <div className="text-center p-2 border border-white/[0.06] rounded">
                    <span className="text-[10px] text-white/40 uppercase tracking-wider block">{t('grossMargin')}</span>
                    <span className="text-sm font-semibold tabular-nums text-cyan-400">
                      {(() => {
                        const rev = drawerEntries.filter(e => e.category?.group_key === 'revenue' && e.entry_type === 'actual').reduce((s, e) => s + (e.amount_cents * (e.category?.sign || 1)), 0);
                        const cost = drawerEntries.filter(e => e.category?.group_key === 'cogs' && e.entry_type === 'actual').reduce((s, e) => s + (e.amount_cents * (e.category?.sign || 1)), 0);
                        const m = rev !== 0 ? ((rev + cost) / rev * 100) : 0;
                        return `${m.toFixed(1)}%`;
                      })()}
                    </span>
                  </div>
                </div>
                <div className="border-b border-white/[0.06]" />
              </div>
            )}

            {/* Variance comparison */}
            {drawer.type === 'variance' && drawer.driver && (
              <div className="grid grid-cols-3 gap-3 pb-3 border-b border-white/[0.06]">
                <div className="text-center p-2 border border-white/[0.06] rounded">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider block">{t('actual')}</span>
                  <span className="text-sm font-semibold tabular-nums text-white">{formatCompactBRL(drawer.driver.actual)}</span>
                </div>
                <div className="text-center p-2 border border-white/[0.06] rounded">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider block">{t('budget')}</span>
                  <span className="text-sm font-semibold tabular-nums text-white/60">{formatCompactBRL(drawer.driver.budget)}</span>
                </div>
                <div className="text-center p-2 border border-white/[0.06] rounded">
                  <span className="text-[10px] text-white/40 uppercase tracking-wider block">{t('variance')}</span>
                  <span className={`text-sm font-semibold tabular-nums ${drawer.driver.variance_abs >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {drawer.driver.variance_abs > 0 ? '+' : ''}{formatCompactBRL(drawer.driver.variance_abs)}
                  </span>
                </div>
              </div>
            )}

            {/* Entries table */}
            <HudTable
              columns={ledgerColumns}
              data={drawerEntries}
              keyExtractor={(e) => e.id}
              compact
              emptyState={
                <HudEmptyState
                  title={t('noEntries')}
                  description={t('noEntriesDescription')}
                  icon="file"
                  compact
                />
              }
            />

            {/* Footer */}
            {drawerEntries.length > 0 && (
              <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                <span className="text-[10px] text-white/40">
                  {drawerEntries.length} {t('entries')} · {t('total')}: {formatBRL(drawerEntries.reduce((sum, e) => sum + e.amount_cents, 0))}
                </span>
              </div>
            )}
          </div>
        )}
      </HudDrawer>
    </HudPageLayout>
  );
}
