'use client';

import { useMemo } from 'react';
import { Shield, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { HoverCard } from '@/components/motion';
import { PayrollRiskData, RiskStatus, formatWorkforcePercentage } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface PayrollRiskIndicatorProps {
  data: PayrollRiskData;
  className?: string;
  compact?: boolean;
}

const statusConfig: Record<RiskStatus, {
  icon: typeof CheckCircle;
  color: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
  label: string;
}> = {
  healthy: {
    icon: CheckCircle,
    color: 'text-ig-success',
    bgColor: 'bg-ig-success/10',
    borderColor: 'border-ig-success/25',
    glowColor: '',
    label: 'Saudável',
  },
  attention: {
    icon: AlertTriangle,
    color: 'text-ig-warning',
    bgColor: 'bg-ig-warning/10',
    borderColor: 'border-ig-warning/25',
    glowColor: '',
    label: 'Atenção',
  },
  risk: {
    icon: AlertCircle,
    color: 'text-ig-danger',
    bgColor: 'bg-ig-danger/10',
    borderColor: 'border-ig-danger/25',
    glowColor: '',
    label: 'Risco',
  },
};

export function PayrollRiskIndicator({ data, className, compact = false }: PayrollRiskIndicatorProps) {
  const config = statusConfig[data.status];
  const StatusIcon = config.icon;
  
  const delta = useMemo(() => 
    data.payrollGrowth - data.revenueGrowth,
    [data.payrollGrowth, data.revenueGrowth]
  );

  // Calculate gauge percentage (inverted: 100 = healthy, 0 = risk)
  const gaugePercent = data.riskScore;

  if (compact) {
    return (
      <div className={cn(
        'flex items-center gap-3 p-3 rounded-xl',
        config.bgColor,
        'border',
        config.borderColor,
        className
      )}>
        <StatusIcon className={cn('w-5 h-5', config.color)} />
        <div className="flex-1">
          <p className="text-xs text-ig-fg-muted">Risco de Folha</p>
          <p className={cn('text-sm font-semibold', config.color)}>{config.label}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-ig-fg-muted">Score</p>
          <p className="text-sm font-semibold text-ig-fg-strong ig-tabular">{data.riskScore}</p>
        </div>
      </div>
    );
  }

  return (
    <HoverCard preset="card" lightSweep>
      <OrionCard 
        variant="elevated" 
        className={cn(config.glowColor, className)}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={cn('p-2.5 rounded-xl', config.bgColor, 'border', config.borderColor)}>
              <Shield className={cn('w-5 h-5', config.color)} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-ig-fg-strong tracking-tight">
                Indicador de Risco de Folha
              </h3>
              <p className="text-xs text-ig-fg-muted">
                Crescimento folha vs receita
              </p>
            </div>
          </div>
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-full',
            config.bgColor,
            'border',
            config.borderColor
          )}>
            <StatusIcon className={cn('w-4 h-4', config.color)} />
            <span className={cn('text-sm font-semibold', config.color)}>
              {config.label}
            </span>
          </div>
        </div>

        {/* Gauge Visualization */}
        <div className="relative flex items-center justify-center mb-6">
          <svg viewBox="0 0 120 70" className="w-full max-w-[200px]">
            {/* Background arc */}
            <path
              d="M 10 60 A 50 50 0 0 1 110 60"
              fill="none"
              stroke="var(--ig-border-default)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Colored arc based on score */}
            <motion.path
              d="M 10 60 A 50 50 0 0 1 110 60"
              fill="none"
              stroke={
                data.status === 'healthy'
                  ? 'var(--ig-success)'
                  : data.status === 'attention'
                  ? 'var(--ig-warning)'
                  : 'var(--ig-danger)'
              }
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="157"
              initial={{ strokeDashoffset: 157 }}
              animate={{ strokeDashoffset: 157 - (157 * gaugePercent / 100) }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
            {/* Score text */}
            <text
              x="60"
              y="55"
              textAnchor="middle"
              className="ig-tabular"
              style={{ fontSize: '24px', fontWeight: 600, fill: 'var(--ig-fg-strong)', letterSpacing: '-0.02em' }}
            >
              {data.riskScore}
            </text>
            <text
              x="60"
              y="68"
              textAnchor="middle"
              style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.16em', fill: 'var(--ig-fg-subtle)' }}
            >
              SCORE
            </text>
          </svg>
        </div>

        {/* Growth Comparison */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Payroll Growth */}
          <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-ig-fg-subtle" />
              <span className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle">Crescimento Folha</span>
            </div>
            <p className={cn(
              'text-lg font-semibold ig-tabular tracking-tight',
              data.payrollGrowth > data.revenueGrowth
                ? 'text-ig-warning'
                : 'text-ig-fg-strong'
            )}>
              {formatWorkforcePercentage(data.payrollGrowth)}
            </p>
          </div>

          {/* Revenue Growth */}
          <div className="p-3 rounded-lg bg-ig-panel border border-ig-border-subtle">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-ig-fg-subtle" />
              <span className="text-[10.5px] font-semibold tracking-wider uppercase text-ig-fg-subtle">Crescimento Receita</span>
            </div>
            <p className="text-lg font-semibold text-ig-success ig-tabular tracking-tight">
              {formatWorkforcePercentage(data.revenueGrowth)}
            </p>
          </div>
        </div>

        {/* Delta Indicator */}
        <div className={cn(
          'p-3 rounded-lg border',
          delta > 0 ? config.bgColor : 'bg-ig-success/10',
          delta > 0 ? config.borderColor : 'border-ig-success/25'
        )}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-ig-fg-muted">
              Diferencial (Folha - Receita)
            </span>
            <span className={cn(
              'text-sm font-semibold ig-tabular',
              delta > 5
                ? 'text-ig-danger'
                : delta > 0
                ? 'text-ig-warning'
                : 'text-ig-success'
            )}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)} p.p.
            </span>
          </div>
        </div>

        {/* Message */}
        <div className="mt-4 p-3 rounded-lg bg-ig-panel/60 border border-ig-border-subtle">
          <p className="text-xs text-ig-fg-default leading-relaxed">
            <StatusIcon className={cn('w-3 h-3 inline mr-1', config.color)} />
            {data.message}
          </p>
        </div>

        {/* Governance Health Integration Note */}
        <div className="mt-4 pt-4 border-t border-ig-border-subtle">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ig-fg-muted">
              Contribuição para Governance Health
            </span>
            <span className="text-ig-fg-default font-semibold ig-tabular">
              Score: {data.riskScore}/100
            </span>
          </div>
        </div>
      </OrionCard>
    </HoverCard>
  );
}

