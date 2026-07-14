'use client';

import React from 'react';
import { motion } from 'motion/react';
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
      label: 'Desvio da Projeção',
      value: formatCompactBRL(forecastGap),
      helper: 'vs Orçado Aprovado',
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
      label: 'Exposição de Caixa',
      value: formatCompactBRL(cashRisk),
      helper: 'Cobertura de 21 dias',
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

  const leftKeys = ['revenue', 'ebitda', 'operating', 'margin'];
  const rightKeys = ['forecastGap', 'cashRisk', 'pending'];
  const leftTiles = leftKeys
    .map((k) => tiles.find((t) => t.key === k))
    .filter((t): t is HeroKpi => Boolean(t));
  const rightTiles = rightKeys
    .map((k) => tiles.find((t) => t.key === k))
    .filter((t): t is HeroKpi => Boolean(t));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="ig-glass relative overflow-visible !rounded-[28px]"
      data-elev={3}
      data-sweep
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <span data-ig-sweep="" />
      <div data-ig-content="" className="relative overflow-visible">
        <div className="grid grid-cols-1 items-stretch gap-3 p-3 lg:grid-cols-[1fr_minmax(300px,360px)_1fr] lg:gap-4 lg:p-4">
          {/* Left KPI cluster */}
          <div className="grid auto-rows-fr grid-cols-2 gap-3">
            {leftTiles.map((t, i) => (
              <KpiTile key={t.key} kpi={t} index={i} align="left" />
            ))}
          </div>

          {/* Center health gauge — overflows the card top */}
          <HealthGauge
            score={healthScore}
            periodLabel={periodLabel}
            scenarioLabel={scenarioLabel}
          />

          {/* Right KPI cluster */}
          <div className="grid auto-rows-fr grid-cols-2 gap-3">
            {rightTiles.map((t, i) => (
              <KpiTile
                key={t.key}
                kpi={t}
                index={i}
                align="left"
                spanFull={rightTiles.length % 2 === 1 && i === rightTiles.length - 1}
              />
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
  const radius = 84;
  const circ = 2 * Math.PI * radius;
  const dash = (score / 100) * circ;
  const size = 220;
  const center = size / 2;

  return (
    <div className="relative flex flex-col items-center justify-end gap-3 px-5 pb-5 pt-2 text-center">
      <div className="absolute left-1/2 top-2 z-0 h-[120%] w-[110%] -translate-x-1/2 rounded-[40px]"
        style={{
          background:
            'radial-gradient(ellipse at 50% 30%, color-mix(in oklab, var(--ig-bg-raised) 80%, transparent) 0%, transparent 70%)',
        }}
      />
      <div className="relative flex flex-col items-center gap-1">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[color:var(--ig-fg-subtle)]">
          <Activity className="h-3 w-3" style={{ color: c.hex }} />
          Saúde Financeira
        </div>
        <div className="text-[11px] text-[color:var(--ig-fg-muted)]">
          {periodLabel} · <span style={{ color: c.hex }}>{scenarioLabel}</span>
        </div>
      </div>

      <div className="relative -mt-1">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            background: `radial-gradient(circle, color-mix(in oklab, ${c.hex} 28%, transparent) 0%, transparent 60%)`,
            filter: 'blur(14px)',
          }}
        />
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative -rotate-90">
          <defs>
            <linearGradient id="hg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={c.hex} stopOpacity="0.98" />
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
          {/* Outer faint ring */}
          <circle
            cx={center} cy={center} r={radius + 10}
            fill="none"
            stroke="color-mix(in oklab, var(--ig-border-subtle) 100%, transparent)"
            strokeWidth="1"
            strokeDasharray="2 4"
            opacity="0.6"
          />
          {/* Track */}
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            stroke="color-mix(in oklab, var(--ig-border-strong) 100%, transparent)"
            strokeWidth="6"
          />
          {/* Progress */}
          <circle
            cx={center} cy={center} r={radius}
            fill="none"
            stroke="url(#hg-grad)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
            filter="url(#hg-glow)"
          />
          {/* Inner tick ring */}
          {Array.from({ length: 48 }).map((_, i) => {
            const angle = (i / 48) * Math.PI * 2;
            const inner = radius - 14;
            const outer = i % 4 === 0 ? radius - 7 : radius - 10;
            const x1 = (center + Math.cos(angle) * inner).toFixed(3);
            const y1 = (center + Math.sin(angle) * inner).toFixed(3);
            const x2 = (center + Math.cos(angle) * outer).toFixed(3);
            const y2 = (center + Math.sin(angle) * outer).toFixed(3);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="color-mix(in oklab, var(--ig-fg-subtle) 55%, transparent)"
                strokeWidth="0.5"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[54px] font-light leading-none tabular-nums" style={{ color: c.hex }}>
            {Math.round(score)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.24em] text-[color:var(--ig-fg-subtle)]">
            / 100
          </div>
          <span
            className="mt-2 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]"
            style={{
              color: c.hex,
              borderColor: `color-mix(in oklab, ${c.hex} 40%, transparent)`,
              backgroundColor: `color-mix(in oklab, ${c.hex} 14%, transparent)`,
              boxShadow: `0 0 12px -2px color-mix(in oklab, ${c.hex} 45%, transparent)`,
            }}
          >
            {c.label}
          </span>
        </div>
      </div>

      <div className="grid w-full max-w-[260px] grid-cols-3 gap-1.5">
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
    <div className="rounded-xl border border-[color:var(--ig-border-subtle)] bg-[color:var(--ig-bg-raised)]/40 px-2 py-1.5 text-center backdrop-blur-sm">
      <div className="text-[9px] uppercase tracking-[0.16em] text-[color:var(--ig-fg-subtle)]">{label}</div>
      <div className="mt-0.5 text-xs font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

// ───── KPI Tile ─────

function KpiTile({
  kpi,
  index,
  align = 'center',
  spanFull = false,
}: {
  kpi: HeroKpi;
  index: number;
  align?: 'left' | 'right' | 'center';
  spanFull?: boolean;
}) {
  const accent = kpi.accent ?? 'var(--ig-accent)';
  const variance = kpi.variance ?? 0;
  const isPositive = variance > 0;
  const isFavorable = kpi.variancePositiveIsGood ? isPositive : !isPositive;
  const varianceColor = Math.abs(variance) < 0.01 ? 'var(--ig-fg-muted)' : isFavorable ? '#10B981' : '#EF4444';
  const VarianceIcon = Math.abs(variance) < 0.01 ? Minus : isPositive ? TrendingUp : TrendingDown;
  const alignClass =
    align === 'left' ? 'items-start text-left' : align === 'right' ? 'items-end text-right' : 'items-center text-center';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group relative flex h-full flex-col justify-center gap-2 overflow-hidden rounded-2xl px-4 py-4',
        'border border-[color:var(--ig-border-subtle)]',
        'bg-[color:var(--ig-bg-raised)]/55 backdrop-blur-sm',
        'shadow-[inset_0_1px_0_color-mix(in_oklab,white_6%,transparent),0_1px_2px_-1px_rgba(0,0,0,0.4)]',
        'transition-all duration-200 hover:bg-[color:var(--ig-bg-raised)]/80 hover:border-[color:var(--ig-border-strong)]',
        alignClass,
        spanFull && 'col-span-2',
      )}
    >
      <div
        className="absolute inset-x-4 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-60 blur-2xl"
        style={{ background: `radial-gradient(circle, ${accent} 0%, transparent 70%)`, opacity: 0.15 }}
      />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ig-fg-subtle)]">
        <span style={{ color: accent }}>{kpi.icon}</span>
        {kpi.label}
      </div>
      <div className="text-[26px] font-semibold leading-none tabular-nums text-[color:var(--ig-fg-strong)]">
        {kpi.value}
      </div>
      {kpi.helper && (
        <div className="text-[10px] leading-tight text-[color:var(--ig-fg-muted)]">{kpi.helper}</div>
      )}

      <div
        className={cn(
          'mt-1 flex w-full items-center gap-2',
          align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end flex-row-reverse' : 'justify-center',
        )}
      >
        {kpi.spark && <Sparkline points={kpi.spark} color={accent} />}
        <span
          className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
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
