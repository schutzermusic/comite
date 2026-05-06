'use client';

import { motion, useReducedMotion } from 'framer-motion';
import {
  Briefcase,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Heart,
  ShieldAlert,
  Activity,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { compactBRL } from '@/lib/utils/project-utils';

export interface ProjectKpiSummary {
  total: number;
  inProgress: number;
  completed: number;
  delayed: number;
  critical: number;
  totalValue: number;
  avgHealth: number;
  avgProgress: number;
  openRisks: number;
  trendInProgress?: number;
  spark?: number[];
}

type Tone = 'neutral' | 'success' | 'info' | 'warning' | 'danger' | 'accent';

const TONE_MAP: Record<Tone, { color: string; ring: string; halo: string; tint: string }> = {
  neutral: { color: '#A6B0BC', ring: 'rgba(166,176,188,0.22)', halo: 'rgba(166,176,188,0.12)', tint: 'rgba(166,176,188,0.10)' },
  accent:  { color: '#84CC16', ring: 'rgba(132,204,22,0.32)', halo: 'rgba(132,204,22,0.18)', tint: 'rgba(132,204,22,0.10)' },
  success: { color: '#10B981', ring: 'rgba(16,185,129,0.32)', halo: 'rgba(16,185,129,0.18)', tint: 'rgba(16,185,129,0.10)' },
  info:    { color: '#22D3EE', ring: 'rgba(34,211,238,0.32)', halo: 'rgba(34,211,238,0.18)', tint: 'rgba(34,211,238,0.10)' },
  warning: { color: '#F59E0B', ring: 'rgba(245,158,11,0.34)', halo: 'rgba(245,158,11,0.18)', tint: 'rgba(245,158,11,0.10)' },
  danger:  { color: '#EF4444', ring: 'rgba(239,68,68,0.34)',  halo: 'rgba(239,68,68,0.18)',  tint: 'rgba(239,68,68,0.10)'  },
};

interface KpiCellProps {
  label: string;
  value: string | number;
  suffix?: string;
  icon: LucideIcon;
  tone?: Tone;
  trend?: number;
  spark?: number[];
  bar?: number;
  delay?: number;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 56;
  const h = 16;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const lastX = w;
  const lastY = h - ((values[values.length - 1] - min) / range) * h;
  return (
    <svg width={w} height={h} className="opacity-90">
      <defs>
        <linearGradient id={`sg-${color}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
      <circle cx={lastX} cy={lastY} r="1.5" fill={color} />
    </svg>
  );
}

function KpiCell({
  label,
  value,
  suffix,
  icon: Icon,
  tone = 'neutral',
  trend,
  spark,
  bar,
  delay = 0,
}: KpiCellProps) {
  const reduce = useReducedMotion();
  const t = TONE_MAP[tone];
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'relative overflow-hidden',
        'glass-tile glass-tile-elevated glass-tile-sheen',
        'p-3.5 flex flex-col justify-between',
        'min-h-[112px] transition-transform duration-200 hover:-translate-y-0.5',
      )}
      style={
        {
          ['--halo-color' as string]: t.halo,
        } as React.CSSProperties
      }
    >
      {/* Soft halo */}
      <span className="glass-tile-halo" />

      {/* Top row: label + icon */}
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] hud-text-muted truncate leading-tight pt-0.5">
          {label}
        </p>
        <div
          className={cn(
            'flex items-center justify-center rounded-lg shrink-0',
            'w-8 h-8',
          )}
          style={{
            background: t.tint,
            border: `1px solid ${t.ring}`,
            color: t.color,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06)`,
          }}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* Value */}
      <div className="relative mt-1">
        <div className="flex items-baseline gap-1">
          <span
            className="text-[26px] font-semibold tabular-nums leading-none tracking-[-0.02em]"
            style={{ color: t.color }}
          >
            {value}
          </span>
          {suffix && (
            <span className="text-xs hud-text-secondary font-semibold">{suffix}</span>
          )}
        </div>
      </div>

      {/* Bottom row: indicator + sparkline */}
      <div className="relative flex items-center justify-between gap-2 mt-2 min-h-[18px]">
        <div className="flex items-center gap-2 min-w-0">
          {typeof trend === 'number' && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums',
                trend >= 0 ? 'text-emerald-400' : 'text-red-400',
              )}
            >
              <TrendingUp className={cn('w-3 h-3', trend < 0 && 'rotate-180')} />
              {trend >= 0 ? '+' : ''}
              {trend}%
            </span>
          )}
          {typeof bar === 'number' && (
            <div
              className="flex-1 min-w-[52px] h-1 rounded-full overflow-hidden"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                boxShadow: 'inset 0 1px 1px rgba(0, 0, 0, 0.20)',
              }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, bar))}%`,
                  background: `linear-gradient(90deg, ${t.color}, ${t.color}aa)`,
                  boxShadow: `0 0 6px ${t.color}77`,
                }}
              />
            </div>
          )}
        </div>
        {spark && spark.length > 1 && <Sparkline values={spark} color={t.color} />}
      </div>
    </motion.div>
  );
}

interface ProjectKpiGridProps {
  summary: ProjectKpiSummary;
  className?: string;
}

export function ProjectKpiGrid({ summary, className }: ProjectKpiGridProps) {
  return (
    <div
      className={cn(
        'grid gap-3 grid-cols-2 md:grid-cols-4 2xl:grid-cols-8',
        className,
      )}
    >
      <KpiCell label="Total Projects" value={summary.total} icon={Briefcase} tone="info" delay={0} />
      <KpiCell
        label="In Progress"
        value={summary.inProgress}
        icon={Activity}
        tone="success"
        trend={summary.trendInProgress}
        delay={0.04}
      />
      <KpiCell
        label="Portfolio Value"
        value={compactBRL(summary.totalValue)}
        icon={DollarSign}
        tone="accent"
        delay={0.08}
      />
      <KpiCell
        label="Critical Projects"
        value={summary.critical}
        icon={AlertTriangle}
        tone={summary.critical > 0 ? 'danger' : 'neutral'}
        delay={0.12}
      />
      <KpiCell
        label="Avg Health"
        value={summary.avgHealth}
        suffix="%"
        icon={Heart}
        tone={summary.avgHealth >= 80 ? 'success' : summary.avgHealth >= 60 ? 'info' : 'warning'}
        bar={summary.avgHealth}
        delay={0.16}
      />
      <KpiCell
        label="Open Risks"
        value={summary.openRisks}
        icon={ShieldAlert}
        tone={summary.openRisks > 0 ? 'danger' : 'neutral'}
        delay={0.2}
      />
      <KpiCell
        label="Avg Progress"
        value={summary.avgProgress}
        suffix="%"
        icon={TrendingUp}
        tone="info"
        bar={summary.avgProgress}
        spark={summary.spark}
        delay={0.24}
      />
      <KpiCell
        label="Delayed"
        value={summary.delayed}
        icon={Clock}
        tone={summary.delayed > 0 ? 'warning' : 'neutral'}
        delay={0.28}
      />
    </div>
  );
}

export default ProjectKpiGrid;
