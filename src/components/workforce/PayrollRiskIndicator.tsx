'use client';

import { useMemo } from 'react';
import {
  Shield, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle, AlertCircle,
} from 'lucide-react';
import { PayrollRiskData, RiskStatus, formatWorkforcePercentage } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface PayrollRiskIndicatorProps {
  data: PayrollRiskData;
  className?: string;
  compact?: boolean;
}

const STATUS: Record<RiskStatus, {
  icon: typeof CheckCircle;
  color: string;
  bg: string;
  border: string;
  label: string;
  arcColor: string;
  railFrom: string;
}> = {
  healthy: {
    icon: CheckCircle,
    color: 'text-ig-success',
    bg: 'bg-ig-success/10',
    border: 'border-ig-success/25',
    label: 'Saudável',
    arcColor: '#22C55E',
    railFrom: 'from-ig-success',
  },
  attention: {
    icon: AlertTriangle,
    color: 'text-ig-warning',
    bg: 'bg-ig-warning/10',
    border: 'border-ig-warning/25',
    label: 'Atenção',
    arcColor: '#F59E0B',
    railFrom: 'from-ig-warning',
  },
  risk: {
    icon: AlertCircle,
    color: 'text-ig-danger',
    bg: 'bg-ig-danger/10',
    border: 'border-ig-danger/25',
    label: 'Risco',
    arcColor: '#EF4444',
    railFrom: 'from-ig-danger',
  },
};

// Total arc length for M 20 80 A 60 60 0 0 1 140 80 (semicircle r=60) ≈ π×60 ≈ 188.5
const ARC_LEN = 188;

export function PayrollRiskIndicator({ data, className, compact = false }: PayrollRiskIndicatorProps) {
  const cfg = STATUS[data.status];
  const StatusIcon = cfg.icon;

  const delta = useMemo(
    () => data.payrollGrowth - data.revenueGrowth,
    [data.payrollGrowth, data.revenueGrowth],
  );

  if (compact) {
    return (
      <div className={cn(
        'flex items-center gap-3 p-3 rounded-xl border',
        cfg.bg, cfg.border, className,
      )}>
        <StatusIcon className={cn('w-5 h-5', cfg.color)} />
        <div className="flex-1">
          <p className="text-xs text-ig-fg-muted">Risco de Folha</p>
          <p className={cn('text-sm font-semibold', cfg.color)}>{cfg.label}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ig-fg-muted">Score</p>
          <p className="text-sm font-semibold text-ig-fg-strong ig-tabular">{data.riskScore}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl border border-ig-border-subtle overflow-hidden', className)}>
      {/* Top gradient rail */}
      <div className={cn('h-[3px] bg-gradient-to-r to-transparent via-transparent/40', cfg.railFrom)} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-ig-border-subtle/60 bg-gradient-to-r from-ig-panel to-ig-panel/60">
        <div className="flex items-center gap-2.5">
          <div className={cn('p-1.5 rounded-lg border shrink-0', cfg.bg, cfg.border)}>
            <Shield className={cn('w-3.5 h-3.5', cfg.color)} />
          </div>
          <div>
            <span className="text-xs font-semibold text-ig-fg-strong">Indicador de Risco de Folha</span>
            <p className="text-[10px] text-ig-fg-subtle leading-none mt-0.5">Crescimento folha vs receita</p>
          </div>
        </div>
        <div className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold',
          cfg.bg, cfg.border, cfg.color,
        )}>
          <StatusIcon className="w-3 h-3 shrink-0" />
          {cfg.label}
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4 bg-ig-panel">

        {/* Gauge */}
        <div className="flex items-center justify-center">
          <svg viewBox="0 0 160 100" className="w-full max-w-[220px]">
            {/* Zone bands: green [0,63] · yellow [63,126] · red [126,188] */}
            <path d="M 20 80 A 60 60 0 0 1 140 80" fill="none"
              stroke="#22C55E" strokeOpacity="0.18" strokeWidth="12" strokeLinecap="butt"
              strokeDasharray="63 125" strokeDashoffset="0" />
            <path d="M 20 80 A 60 60 0 0 1 140 80" fill="none"
              stroke="#F59E0B" strokeOpacity="0.18" strokeWidth="12" strokeLinecap="butt"
              strokeDasharray="63 125" strokeDashoffset="125" />
            <path d="M 20 80 A 60 60 0 0 1 140 80" fill="none"
              stroke="#EF4444" strokeOpacity="0.18" strokeWidth="12" strokeLinecap="butt"
              strokeDasharray="62 126" strokeDashoffset="62" />

            {/* Value arc */}
            <motion.path
              d="M 20 80 A 60 60 0 0 1 140 80"
              fill="none"
              stroke={cfg.arcColor}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={ARC_LEN}
              initial={{ strokeDashoffset: ARC_LEN }}
              animate={{ strokeDashoffset: ARC_LEN - (ARC_LEN * data.riskScore / 100) }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
            />

            {/* Score */}
            <text x="80" y="73" textAnchor="middle"
              style={{ fontSize: '30px', fontWeight: 700, fill: 'var(--ig-fg-strong)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              {data.riskScore}
            </text>
            <text x="80" y="87" textAnchor="middle"
              style={{ fontSize: '8.5px', fontWeight: 700, letterSpacing: '0.18em', fill: 'var(--ig-fg-subtle)' }}>
              SCORE
            </text>
          </svg>
        </div>

        {/* Growth grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="px-3 py-2.5 rounded-xl bg-ig-panel border border-ig-border-subtle">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingUp className="w-3 h-3 text-ig-fg-subtle shrink-0" />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">Crescimento Folha</span>
            </div>
            <p className={cn(
              'text-lg font-bold ig-tabular leading-none',
              data.payrollGrowth > data.revenueGrowth ? 'text-ig-warning' : 'text-ig-fg-strong',
            )}>
              {formatWorkforcePercentage(data.payrollGrowth)}
            </p>
          </div>
          <div className="px-3 py-2.5 rounded-xl bg-ig-panel border border-ig-border-subtle">
            <div className="flex items-center gap-1.5 mb-1.5">
              <TrendingDown className="w-3 h-3 text-ig-fg-subtle shrink-0" />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">Crescimento Receita</span>
            </div>
            <p className="text-lg font-bold text-ig-success ig-tabular leading-none">
              {formatWorkforcePercentage(data.revenueGrowth)}
            </p>
          </div>
        </div>

        {/* Delta banner */}
        <div className={cn(
          'flex items-center justify-between px-4 py-2.5 rounded-xl border',
          delta > 0 ? `${cfg.bg} ${cfg.border}` : 'bg-ig-success/8 border-ig-success/20',
        )}>
          <span className="text-[11px] text-ig-fg-muted">Diferencial Folha − Receita</span>
          <span className={cn(
            'text-sm font-bold ig-tabular',
            delta > 5 ? 'text-ig-danger' : delta > 0 ? 'text-ig-warning' : 'text-ig-success',
          )}>
            {delta > 0 ? '+' : ''}{delta.toFixed(1)}&nbsp;p.p.
          </span>
        </div>

        {/* Message */}
        <div className="flex gap-2.5 px-4 py-2.5 rounded-xl bg-ig-panel/60 border border-ig-border-subtle">
          <StatusIcon className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', cfg.color)} />
          <p className="text-[11px] text-ig-fg-muted leading-relaxed">{data.message}</p>
        </div>

        {/* Governance footer */}
        <div className="flex items-center justify-between pt-3 border-t border-ig-border-subtle/60">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">
            Governance Health
          </span>
          <span className={cn('text-xs font-bold ig-tabular', cfg.color)}>
            {data.riskScore}/100
          </span>
        </div>
      </div>
    </div>
  );
}
