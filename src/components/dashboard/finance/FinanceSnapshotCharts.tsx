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

const MONTHS = ['SET', 'OUT', 'NOV', 'DEZ', 'JAN', 'FEV'];

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

  const revenueSeries = useMemo<RevenuePoint[]>(() => {
    const monthlyBase = financialPulse.revenue.value / (financialPulse.revenue.period === 'quarter' ? 3 : 1);
    return MONTHS.map((month, index) => {
      const trendFactor = 0.88 + index * 0.04;
      const seasonality = index % 2 === 0 ? 1.01 : 0.98;
      const actual = Math.round(monthlyBase * trendFactor * seasonality);
      const forecast = Math.round(actual * (1.015 + ((index + 1) % 3) * 0.012));
      return {
        month,
        actual,
        forecast,
        variance: actual - forecast,
      };
    });
  }, [financialPulse.revenue.period, financialPulse.revenue.value]);

  const burnSeries = useMemo<BurnPoint[]>(() => {
    const burnBase = Math.abs(financialPulse.cash.actual) / 3;
    return MONTHS.map((month, index) => ({
      month,
      burn: Math.round(burnBase * (0.9 + index * 0.06)),
    }));
  }, [financialPulse.cash.actual]);

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
          <p className="cr-label">Revenue MTD</p>
          <p className="text-lg font-bold text-white tabular-nums">
            {formatCurrency(financialPulse.revenue.value, 'BRL')}
          </p>
        </div>
        <div className={`text-[10px] font-semibold tabular-nums ${financialPulse.revenue.trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          Δ {financialPulse.revenue.trend >= 0 ? '+' : ''}{financialPulse.revenue.trend.toFixed(1)}%
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2 py-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="cr-label">Monthly Revenue: Actual vs Forecast</p>
          <span className={`
            text-[9px] tabular-nums font-semibold
            ${lastRevenue.variance >= 0 ? 'text-emerald-300' : 'text-red-300'}
          `}>
            Δ {compactCurrency(lastRevenue.variance)}
          </span>
        </div>
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={revenueSeries} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={{
                  background: 'rgba(4,14,12,0.92)',
                  border: '1px solid rgba(120,220,210,0.25)',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                formatter={(value: number, key) => [compactCurrency(value), key === 'actual' ? 'Actual' : key === 'forecast' ? 'Forecast' : 'Variance']}
              />
              <Bar dataKey="actual" fill="rgba(16,185,129,0.55)" radius={[3, 3, 0, 0]} />
              <Line dataKey="forecast" type="monotone" stroke="rgba(103,232,249,0.92)" strokeWidth={1.8} dot={false} />
              <Bar dataKey="variance" fill="rgba(56,189,248,0.28)" radius={[2, 2, 2, 2]} barSize={5} />
              <ReferenceDot
                x={lastRevenue.month}
                y={lastRevenue.actual}
                r={3}
                fill={lastRevenue.variance >= 0 ? '#22c55e' : '#ef4444'}
                stroke="rgba(255,255,255,0.9)"
                strokeWidth={1}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2 py-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="cr-label">Monthly Burn + Run-rate</p>
          <span className="text-[9px] text-amber-300 tabular-nums">Run-rate {compactCurrency(runRate)}</span>
        </div>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={burnSeries} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Area type="monotone" dataKey="burn" stroke="rgba(245,158,11,0.95)" fill="rgba(245,158,11,0.2)" strokeWidth={1.8} />
              <Line type="monotone" dataKey="burn" stroke="rgba(251,191,36,0.96)" strokeWidth={1.4} dot={false} />
              <ReferenceLine
                y={runRate}
                stroke="rgba(248,250,252,0.55)"
                strokeDasharray="3 3"
                label={{ value: 'Run-rate', fill: 'rgba(248,250,252,0.68)', fontSize: 9, position: 'right' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2 py-2">
        <div className="mb-1 flex items-center justify-between">
          <p className="cr-label">S-Curve Cumulative</p>
          <span className={`text-[9px] tabular-nums font-semibold ${lastSCurve.gap >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
            Gap {compactCurrency(lastSCurve.gap)}
          </span>
        </div>
        <div className="h-20">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={sCurveSeries} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 9 }} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Area
                type="monotone"
                dataKey="gapBand"
                fill="rgba(250,204,21,0.12)"
                stroke="none"
                isAnimationActive={false}
              />
              <Line type="monotone" dataKey="plannedCum" stroke="rgba(34,211,238,0.62)" strokeWidth={1.4} dot={false} strokeDasharray="4 3" />
              <Line type="monotone" dataKey="actualCum" stroke="rgba(16,185,129,0.95)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2 py-2">
        <div className="flex items-center justify-between">
          <p className="cr-label">Waterfall Drilldown</p>
          <button
            type="button"
            onClick={() => setShowWaterfall((prev) => !prev)}
            className="text-[9px] uppercase tracking-[0.1em] text-cyan-300/85 hover:text-cyan-200 transition-colors"
          >
            {showWaterfall ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>

        {showWaterfall && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
                <p className="text-[8px] uppercase tracking-[0.1em] text-white/45">Revenue</p>
                <p className="text-[11px] tabular-nums font-semibold text-emerald-300">{compactCurrency(waterfallData.revenue)}</p>
              </div>
              <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
                <p className="text-[8px] uppercase tracking-[0.1em] text-white/45">Costs</p>
                <p className="text-[11px] tabular-nums font-semibold text-red-300">-{compactCurrency(waterfallData.costs)}</p>
              </div>
              <div className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
                <p className="text-[8px] uppercase tracking-[0.1em] text-white/45">Margin</p>
                <p className="text-[11px] tabular-nums font-semibold text-cyan-300">{compactCurrency(waterfallData.margin)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 items-end h-14">
              <div className="rounded-t-md bg-emerald-400/35 border border-emerald-300/35" style={{ height: `${Math.max(8, (waterfallData.revenue / waterfallData.maxValue) * 100)}%` }} />
              <div className="rounded-t-md bg-red-400/35 border border-red-300/35" style={{ height: `${Math.max(8, (waterfallData.costs / waterfallData.maxValue) * 100)}%` }} />
              <div className="rounded-t-md bg-cyan-400/35 border border-cyan-300/35" style={{ height: `${Math.max(8, (waterfallData.margin / waterfallData.maxValue) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
