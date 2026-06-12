'use client';

import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FinancialPulse } from '@/lib/dashboard-data';
import { formatCurrency } from '@/lib/dashboard-data';
import { useTheme } from '@/contexts/ThemeContext';

interface FinanceSnapshotChartsProps {
  financialPulse: FinancialPulse;
}

interface RevenuePoint {
  month: string;
  actual: number;
  forecast: number;
  variance: number;
}

interface BurnPoint {
  month: string;
  burn: number;
}

interface SCurvePoint {
  month: string;
  actualCum: number;
  plannedCum: number;
  gap: number;
  gapBand: [number, number];
}

const MONTH_LABELS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'] as const;

/** Rolling window ending at the current calendar month. */
function getRollingMonths(count = 6): string[] {
  const currentMonth = new Date().getMonth();
  return Array.from({ length: count }, (_, i) => {
    const idx = (currentMonth - (count - 1 - i) + 12) % 12;
    return MONTH_LABELS[idx];
  });
}

function monthTrendFactor(index: number): number {
  return 0.88 + index * 0.04;
}

function monthSeasonality(index: number): number {
  return index % 2 === 0 ? 1.01 : 0.98;
}

function compactCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);
}

export function FinanceSnapshotCharts({ financialPulse }: FinanceSnapshotChartsProps) {
  const [showWaterfall, setShowWaterfall] = useState(false);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Theme-aware chart colors
  const gridStroke = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
  const axisTick = isLight ? { fill: 'rgba(0,0,0,0.45)', fontSize: 9 } : { fill: 'rgba(255,255,255,0.45)', fontSize: 9 };
  const tooltipCursor = isLight ? { fill: 'rgba(0,0,0,0.04)' } : { fill: 'rgba(255,255,255,0.04)' };
  const tooltipStyle = isLight
    ? { background: 'rgba(255,255,255,0.96)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, fontSize: 11, color: '#1C1F24' }
    : { background: 'rgba(4,14,12,0.92)', border: '1px solid rgba(120,220,210,0.25)', borderRadius: 8, fontSize: 11 };
  const containerBorder = isLight ? 'border-black/[0.06] bg-black/[0.02]' : 'border-white/[0.08] bg-white/[0.02]';
  const waterfallBorder = isLight ? 'border-black/[0.06] bg-black/[0.02]' : 'border-white/[0.08] bg-white/[0.03]';
  const mutedText = isLight ? 'text-[#6B7280]' : 'text-white/45';

  const chartMonths = useMemo(() => getRollingMonths(), []);

  const revenueSeries = useMemo<RevenuePoint[]>(() => {
    const currentRevenue = financialPulse.revenue.value;
    const lastIndex = chartMonths.length - 1;
    const lastMultiplier = monthTrendFactor(lastIndex) * monthSeasonality(lastIndex);

    return chartMonths.map((month, index) => {
      const scaled =
        financialPulse.revenue.period === 'month'
          ? currentRevenue * ((monthTrendFactor(index) * monthSeasonality(index)) / lastMultiplier)
          : (currentRevenue / 3) * monthTrendFactor(index) * monthSeasonality(index);
      const actual = Math.round(scaled);
      const forecast = Math.round(actual * (1.015 + ((index + 1) % 3) * 0.012));
      return {
        month,
        actual,
        forecast,
        variance: actual - forecast,
      };
    });
  }, [chartMonths, financialPulse.revenue.period, financialPulse.revenue.value]);

  const burnSeries = useMemo<BurnPoint[]>(() => {
    const burnBase = Math.abs(financialPulse.cash.actual) / 3;
    return chartMonths.map((month, index) => ({
      month,
      burn: Math.round(burnBase * (0.9 + index * 0.06)),
    }));
  }, [chartMonths, financialPulse.cash.actual]);

  const runRate = useMemo(
    () => Math.round(burnSeries.reduce((sum, point) => sum + point.burn, 0) / Math.max(1, burnSeries.length)),
    [burnSeries],
  );

  const sCurveSeries = useMemo<SCurvePoint[]>(() => {
    return revenueSeries.map((point, index) => {
      const actualCum = revenueSeries.slice(0, index + 1).reduce((sum, item) => sum + item.actual, 0);
      const plannedCum = revenueSeries.slice(0, index + 1).reduce((sum, item) => sum + item.forecast, 0);
      const gap = actualCum - plannedCum;
      return {
        month: point.month,
        actualCum,
        plannedCum,
        gap,
        gapBand: [Math.min(actualCum, plannedCum), Math.max(actualCum, plannedCum)],
      };
    });
  }, [revenueSeries]);

  const lastRevenue = revenueSeries[revenueSeries.length - 1];
  const lastSCurve = sCurveSeries[sCurveSeries.length - 1];
  const waterfallData = useMemo(() => {
    const revenue = financialPulse.revenue.value;
    const costs = Math.abs(financialPulse.cash.actual) + financialPulse.ebitda.value * 0.42;
    const margin = Math.max(0, revenue - costs);
    const maxValue = Math.max(revenue, costs, margin, 1);
    return {
      revenue,
      costs,
      margin,
      maxValue,
    };
  }, [financialPulse.cash.actual, financialPulse.ebitda.value, financialPulse.revenue.value]);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="cr-label">Receita no mês</p>
          <p className={`text-lg font-bold tabular-nums ${isLight ? 'text-[#1C1F24]' : 'text-white'}`}>
            {formatCurrency(financialPulse.revenue.value, 'BRL')}
          </p>
        </div>
        <div className={`text-[10px] font-semibold tabular-nums ${financialPulse.revenue.trend >= 0 ? (isLight ? 'text-lime-700' : 'text-emerald-400') : (isLight ? 'text-red-600' : 'text-red-400')}`}>
          Δ {financialPulse.revenue.trend >= 0 ? '+' : ''}{financialPulse.revenue.trend.toFixed(1)}%
        </div>
      </div>

      <div className={`rounded-lg border px-2 py-2 ${containerBorder}`}>
        <div className="mb-1 flex items-center justify-between">
          <p className="cr-label">Receita mensal: real e previsto</p>
          <span className={`
            text-[9px] tabular-nums font-semibold
            ${lastRevenue.variance >= 0 ? (isLight ? 'text-lime-700' : 'text-emerald-300') : (isLight ? 'text-red-600' : 'text-red-300')}
          `}>
            Δ {compactCurrency(lastRevenue.variance)}
          </span>
        </div>
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={revenueSeries} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip
                cursor={tooltipCursor}
                contentStyle={tooltipStyle}
                formatter={(value: number, key) => [compactCurrency(value), key === 'actual' ? 'Real' : key === 'forecast' ? 'Previsto' : 'Variação']}
              />
              <Bar dataKey="actual" fill={isLight ? 'rgba(132,204,22,0.45)' : 'rgba(16,185,129,0.55)'} radius={[3, 3, 0, 0]} />
              <Line dataKey="forecast" type="monotone" stroke={isLight ? 'rgba(101,163,13,0.8)' : 'rgba(103,232,249,0.92)'} strokeWidth={1.8} dot={false} />
              <Bar dataKey="variance" fill={isLight ? 'rgba(14,116,144,0.2)' : 'rgba(56,189,248,0.28)'} radius={[2, 2, 2, 2]} barSize={5} />
              <ReferenceDot
                x={lastRevenue.month}
                y={lastRevenue.actual}
                r={3}
                fill={lastRevenue.variance >= 0 ? '#22c55e' : '#ef4444'}
                stroke={isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.9)'}
                strokeWidth={1}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`rounded-lg border px-2 py-2 ${containerBorder}`}>
        <div className="mb-1 flex items-center justify-between">
          <p className="cr-label">Queima mensal + ritmo projetado</p>
          <span className={`text-[9px] tabular-nums ${isLight ? 'text-amber-600' : 'text-amber-300'}`}>
            Ritmo proj. {compactCurrency(runRate)}
          </span>
        </div>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={burnSeries} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Area type="monotone" dataKey="burn" stroke="rgba(245,158,11,0.95)" fill={isLight ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.2)'} strokeWidth={1.8} />
              <Line type="monotone" dataKey="burn" stroke="rgba(251,191,36,0.96)" strokeWidth={1.4} dot={false} />
              <ReferenceLine
                y={runRate}
                stroke={isLight ? 'rgba(0,0,0,0.25)' : 'rgba(248,250,252,0.55)'}
                strokeDasharray="3 3"
                label={{ value: 'Ritmo proj.', fill: isLight ? 'rgba(0,0,0,0.45)' : 'rgba(248,250,252,0.68)', fontSize: 9, position: 'right' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`rounded-lg border px-2 py-2 ${containerBorder}`}>
        <div className="mb-1 flex items-center justify-between">
          <p className="cr-label">Curva S acumulada</p>
          <span className={`text-[9px] tabular-nums font-semibold ${lastSCurve.gap >= 0 ? (isLight ? 'text-lime-700' : 'text-emerald-300') : (isLight ? 'text-red-600' : 'text-red-300')}`}>
            Desvio {compactCurrency(lastSCurve.gap)}
          </span>
        </div>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sCurveSeries} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={gridStroke} />
              <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Area
                type="monotone"
                dataKey="gapBand"
                fill={isLight ? 'rgba(250,204,21,0.08)' : 'rgba(250,204,21,0.12)'}
                stroke="none"
                isAnimationActive={false}
              />
              <Line type="monotone" dataKey="plannedCum" stroke={isLight ? 'rgba(101,163,13,0.5)' : 'rgba(34,211,238,0.62)'} strokeWidth={1.4} dot={false} strokeDasharray="4 3" />
              <Line type="monotone" dataKey="actualCum" stroke="rgba(16,185,129,0.95)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className={`rounded-lg border px-2 py-2 ${containerBorder}`}>
        <div className="flex items-center justify-between">
          <p className="cr-label">Análise em cascata</p>
          <button
            type="button"
            onClick={() => setShowWaterfall((prev) => !prev)}
            className={`text-[9px] uppercase tracking-[0.1em] transition-colors ${isLight ? 'text-lime-700/85 hover:text-lime-800' : 'text-cyan-300/85 hover:text-cyan-200'}`}
          >
            {showWaterfall ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>

        {showWaterfall && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className={`rounded-md border px-2 py-1.5 ${waterfallBorder}`}>
                <p className={`text-[8px] uppercase tracking-[0.1em] ${mutedText}`}>Receita</p>
                <p className={`text-[11px] tabular-nums font-semibold ${isLight ? 'text-lime-700' : 'text-emerald-300'}`}>{compactCurrency(waterfallData.revenue)}</p>
              </div>
              <div className={`rounded-md border px-2 py-1.5 ${waterfallBorder}`}>
                <p className={`text-[8px] uppercase tracking-[0.1em] ${mutedText}`}>Custos</p>
                <p className={`text-[11px] tabular-nums font-semibold ${isLight ? 'text-red-600' : 'text-red-300'}`}>-{compactCurrency(waterfallData.costs)}</p>
              </div>
              <div className={`rounded-md border px-2 py-1.5 ${waterfallBorder}`}>
                <p className={`text-[8px] uppercase tracking-[0.1em] ${mutedText}`}>Margem</p>
                <p className={`text-[11px] tabular-nums font-semibold ${isLight ? 'text-lime-800' : 'text-cyan-300'}`}>{compactCurrency(waterfallData.margin)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 items-end h-14">
              <div className={`rounded-t-md ${isLight ? 'bg-lime-500/25 border border-lime-500/20' : 'bg-emerald-400/35 border border-emerald-300/35'}`} style={{ height: `${Math.max(8, (waterfallData.revenue / waterfallData.maxValue) * 100)}%` }} />
              <div className={`rounded-t-md ${isLight ? 'bg-red-500/25 border border-red-500/20' : 'bg-red-400/35 border border-red-300/35'}`} style={{ height: `${Math.max(8, (waterfallData.costs / waterfallData.maxValue) * 100)}%` }} />
              <div className={`rounded-t-md ${isLight ? 'bg-lime-500/25 border border-lime-500/20' : 'bg-cyan-400/35 border border-cyan-300/35'}`} style={{ height: `${Math.max(8, (waterfallData.margin / waterfallData.maxValue) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
