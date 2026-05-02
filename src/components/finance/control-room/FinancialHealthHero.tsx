'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Banknote,
  Percent,
  LineChart,
  ShieldAlert,
  AlertCircle,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCompactBRL, formatPct } from './helpers';
import { SPARKLINES } from './mock-data';

export interface HeroKpi {
  key: string;
  label: string;
  value: string;
  helper?: string;
  variance?: number;
  variancePositiveIsGood?: boolean;
  status?: 'positive' | 'negative' | 'neutral' | 'warning';
  spark?: number[];
  icon?: React.ReactNode;
  accent?: string;
  format?: 'currency' | 'pct' | 'count';
}

export interface FinancialHealthHeroProps {
  healthScore: number;
  netRevenue: number;
  ebitda: number;
  ebitdaMargin: number;
  operatingResult: number;
  forecastGap: number;
  cashRisk: number;
  pendingActions: number;
  periodLabel: string;
  scenarioLabel: string;
}

export function FinancialHealthHero(props: FinancialHealthHeroProps) {
  const {
    healthScore,
    netRevenue,
    ebitda,
    ebitdaMargin,
    operatingResult,
    forecastGap,
    cashRisk,
    pendingActions,
    periodLabel,
    scenarioLabel,
  } = props;

  const tiles: HeroKpi[] = [
    {
      key: 'revenue',
      label: 'Receita Líquida',
      value: formatCompactBRL(netRevenue),
      helper: 'Acum. período',
      variance: 2.4,
      variancePositiveIsGood: true,
      status: 'positive',
      spark: SPARKLINES.revenue,
      icon: <Banknote className="h-3.5 w-3.5" />,
      accent: '#14B8A6',
      format: 'currency',
    },
    {
      key: 'ebitda',
      label: 'EBITDA',
      value: formatCompactBRL(ebitda),
      helper: 'Operacional ajustado',
      variance: -0.6,
      variancePositiveIsGood: true,
      status: 'warning',
      spark: SPARKLINES.ebitda,
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      accent: '#10B981',
      format: 'currency',
    },
    {
      key: 'margin',
      label: 'Margem EBITDA',
      value: `${ebitdaMargin.toFixed(1)}%`,
      helper: 'Líquido / Receita',
      variance: -2.2,
      variancePositiveIsGood: true,
      status: 'warning',
      spark: SPARKLINES.margin,
      icon: <Percent className="h-3.5 w-3.5" />,
      accent: '#A78BFA',
      format: 'pct',
    },
    {
      key: 'operating',
      label: 'Resultado Operacional',
      value: formatCompactBRL(operatingResult),
      helper: 'Pré-financeiro',
      variance: 1.8,
      variancePositiveIsGood: true,
      status: 'positive',
      spark: SPARKLINES.operating,
      icon: <LineChart className="h-3.5 w-3.5" />,
      accent: '#22D3EE',
      format: 'currency',
    },
    {
      key: 'forecastGap',
      label: 'Forecast Gap',
      value: formatCompactBRL(forecastGap),
      helper: 'vs Board Approved',
      variance: -1.2,
      variancePositiveIsGood: false,
      status: 'negative',
      spark: SPARKLINES.forecastGap,
      icon: <Target className="h-3.5 w-3.5" />,
      accent: '#F59E0B',
      format: 'currency',
    },
    {
      key: 'cashRisk',
      label: 'Cash Exposure',
      value: formatCompactBRL(cashRisk),
      helper: 'Runway 21 dias',
      variance: -8.4,
      variancePositiveIsGood: false,
      status: 'negative',
      spark: SPARKLINES.cashRisk,
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
      accent: '#F43F5E',
      format: 'currency',
    },
    {
      key: 'pending',
      label: 'Ações Pendentes',
      value: String(pendingActions),
      helper: 'Aprovações + decisões',
      variance: 3,
      variancePositiveIsGood: false,
      status: 'warning',
      spark: SPARKLINES.pendingActions,
      icon: <AlertCircle className="h-3.5 w-3.5" />,
      accent: '#FBBF24',
      format: 'count',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative"
      data-elev={3}
      data-sweep
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="" className="relative">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr]">
          <HealthGauge score={healthScore} periodLabel={periodLabel} scenarioLabel={scenarioLabel} />
          <div className="grid grid-cols-2 gap-px bg-[color:var(--ig-border-subtle)] sm:grid-cols-3 lg:grid-cols-7">
            {tiles.map((t, i) => (
              <KpiTile key={t.key} kpi={t} index={i} />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ───── Health Gauge (left panel) ─────

function HealthGauge({ score, periodLabel, scenarioLabel }: { score: number; periodLabel: string; scenarioLabel: string }) {
  const status = score >= 80 ? 'excellent' : score >= 65 ? 'healthy' : score >= 50 ? 'watch' : 'critical';
  const statusColors: Record<string, { hex: string; label: string }> = {
    excellent: { hex: '#10B981', label: 'Excelente' },
    healthy: { hex: '#14B8A6', label: 'Saudável' },
    watch: { hex: '#F59E0B', label: 'Atenção' },
    critical: { hex: '#EF4444', label: 'Crítico' },
  };
  const c = statusColors[status];
  const radius = 72;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;

  return (
    <div className="relative flex flex-col items-center justify-center gap-3 border-b border-[color:var(--ig-border-subtle)] p-6 lg:border-b-0 lg:border-r">
      <div className="flex w-full items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">
            <Activity className="h-3 w-3" style={{ color: c.hex }} />
            Health Score
          </div>
          <div className="mt-1 text-[11px] text-[color:var(--ig-fg-muted)]">
            {periodLabel} · <span style={{ color: c.hex }}>{scenarioLabel}</span>
          </div>
        </div>
        <span
          className="rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            color: c.hex,
            borderColor: `color-mix(in oklab, ${c.hex} 32%, transparent)`,
            backgroundColor: `color-mix(in oklab, ${c.hex} 12%, transparent)`,
          }}
        >
          {c.label}
        </span>
      </div>

      <div className="relative">
        <svg width={180} height={180} viewBox="0 0 180 180" className="-rotate-90">
          <defs>
            <linearGradient id="hg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={c.hex} stopOpacity="0.95" />
              <stop offset="100%" stopColor={c.hex} stopOpacity="0.55" />
            </linearGradient>
            <filter id="hg-glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle
            cx="90" cy="90" r={radius}
            fill="none"
            stroke="color-mix(in oklab, var(--ig-border-strong) 100%, transparent)"
            strokeWidth="6"
          />
          <circle
            cx="90" cy="90" r={radius}
            fill="none"
            stroke="url(#hg-grad)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
            filter="url(#hg-glow)"
          />
          {Array.from({ length: 36 }).map((_, i) => {
            const angle = (i / 36) * Math.PI * 2;
            const inner = 86;
            const outer = i % 4 === 0 ? 92 : 89;
            return (
              <line
                key={i}
                x1={90 + Math.cos(angle) * inner}
                y1={90 + Math.sin(angle) * inner}
                x2={90 + Math.cos(angle) * outer}
                y2={90 + Math.sin(angle) * outer}
                stroke="color-mix(in oklab, var(--ig-fg-subtle) 60%, transparent)"
                strokeWidth="0.6"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-mono text-[42px] leading-none tabular-nums" style={{ color: c.hex }}>
            {Math.round(score)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ig-fg-subtle)]">
            / 100
          </div>
        </div>
      </div>

      <div className="grid w-full grid-cols-3 gap-1.5 pt-1">
        <MicroStat label="Liquidez" value="1,42x" tone="positive" />
        <MicroStat label="Endivid." value="0,48x" tone="neutral" />
        <MicroStat label="ROIC" value="14,8%" tone="positive" />
      </div>
    </div>
  );
}

function MicroStat({ label, value, tone }: { label: string; value: string; tone: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? '#10B981' : tone === 'negative' ? '#EF4444' : 'var(--ig-fg-default)';
  return (
    <div className="rounded-md border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/30 px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-[0.16em] text-[color:var(--ig-fg-subtle)]">{label}</div>
      <div className="mt-0.5 font-mono text-xs font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

// ───── KPI Tile ─────

function KpiTile({ kpi, index }: { kpi: HeroKpi; index: number }) {
  const accent = kpi.accent ?? 'var(--ig-accent)';
  const variance = kpi.variance ?? 0;
  const isPositive = variance > 0;
  const isFavorable = kpi.variancePositiveIsGood ? isPositive : !isPositive;
  const varianceColor = Math.abs(variance) < 0.01 ? 'var(--ig-fg-muted)' : isFavorable ? '#10B981' : '#EF4444';
  const VarianceIcon = Math.abs(variance) < 0.01 ? Minus : isPositive ? TrendingUp : TrendingDown;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group relative bg-[color:var(--ig-bg-raised)]/50 px-4 py-4',
        'transition-colors hover:bg-[color:var(--ig-bg-raised)]/85',
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[color:var(--ig-fg-subtle)]">
        <span style={{ color: accent }}>{kpi.icon}</span>
        {kpi.label}
      </div>
      <div className="mt-2 font-mono text-[22px] font-semibold leading-none tabular-nums text-[color:var(--ig-fg-strong)]">
        {kpi.value}
      </div>
      {kpi.helper && (
        <div className="mt-1 text-[10px] text-[color:var(--ig-fg-muted)]">{kpi.helper}</div>
      )}

      <div className="mt-2 flex items-end justify-between gap-2">
        {kpi.spark && <Sparkline points={kpi.spark} color={accent} />}
        <span
          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums"
          style={{
            color: varianceColor,
            borderColor: `color-mix(in oklab, ${varianceColor} 30%, transparent)`,
            backgroundColor: `color-mix(in oklab, ${varianceColor} 10%, transparent)`,
          }}
        >
          <VarianceIcon className="h-3 w-3" />
          {Math.abs(variance) < 0.01 ? '0' : formatPct(variance, 1)}
        </span>
      </div>
    </motion.div>
  );
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 84;
  const h = 24;
  const step = w / (points.length - 1);

  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const last = points[points.length - 1];
  const lastX = w;
  const lastY = h - ((last - min) / range) * h;

  return (
    <svg width={w} height={h} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-${color})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
      <circle cx={lastX} cy={lastY} r="4" fill={color} opacity="0.25" />
    </svg>
  );
}
