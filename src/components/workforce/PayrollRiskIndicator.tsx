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
    color: 'text-semantic-success-DEFAULT',
    bgColor: 'bg-semantic-success-bg',
    borderColor: 'border-semantic-success-DEFAULT/20',
    glowColor: 'shadow-[0_0_20px_rgba(0,255,180,0.15)]',
    label: 'Saudável',
  },
  attention: {
    icon: AlertTriangle,
    color: 'text-semantic-warning-DEFAULT',
    bgColor: 'bg-semantic-warning-bg',
    borderColor: 'border-semantic-warning-DEFAULT/20',
    glowColor: 'shadow-[0_0_20px_rgba(255,176,77,0.15)]',
    label: 'Atenção',
  },
  risk: {
    icon: AlertCircle,
    color: 'text-semantic-error-DEFAULT',
    bgColor: 'bg-semantic-error-bg',
    borderColor: 'border-semantic-error-DEFAULT/20',
    glowColor: 'shadow-[0_0_20px_rgba(255,88,96,0.15)]',
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
          <p className="text-xs text-orion-text-muted">Risco de Folha</p>
          <p className={cn('text-sm font-semibold', config.color)}>{config.label}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-orion-text-muted">Score</p>
          <p className="text-sm font-bold text-white">{data.riskScore}</p>
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
              <h3 className="text-base font-semibold text-white orion-text-heading">
                Indicador de Risco de Folha
              </h3>
              <p className="text-xs text-orion-text-muted">
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
              stroke="rgba(255,255,255,0.1)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Colored arc based on score */}
            <motion.path
              d="M 10 60 A 50 50 0 0 1 110 60"
              fill="none"
              stroke={
                data.status === 'healthy' 
                  ? '#00FFB4' 
                  : data.status === 'attention' 
                  ? '#FFB04D' 
                  : '#FF5860'
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
              className="fill-white text-2xl font-bold"
              style={{ fontSize: '24px' }}
            >
              {data.riskScore}
            </text>
            <text
              x="60"
              y="68"
              textAnchor="middle"
              className="fill-orion-text-muted"
              style={{ fontSize: '8px' }}
            >
              SCORE
            </text>
          </svg>
        </div>

        {/* Growth Comparison */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          {/* Payroll Growth */}
          <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-orion-text-muted" />
              <span className="text-xs text-orion-text-muted">Crescimento Folha</span>
            </div>
            <p className={cn(
              'text-lg font-bold',
              data.payrollGrowth > data.revenueGrowth 
                ? 'text-semantic-warning-DEFAULT' 
                : 'text-white'
            )}>
              {formatWorkforcePercentage(data.payrollGrowth)}
            </p>
          </div>

          {/* Revenue Growth */}
          <div className="p-3 rounded-lg bg-orion-bg-elevated/50">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="w-4 h-4 text-orion-text-muted" />
              <span className="text-xs text-orion-text-muted">Crescimento Receita</span>
            </div>
            <p className="text-lg font-bold text-semantic-success-DEFAULT">
              {formatWorkforcePercentage(data.revenueGrowth)}
            </p>
          </div>
        </div>

        {/* Delta Indicator */}
        <div className={cn(
          'p-3 rounded-lg',
          delta > 0 ? config.bgColor : 'bg-semantic-success-bg',
          'border',
          delta > 0 ? config.borderColor : 'border-semantic-success-DEFAULT/20'
        )}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-orion-text-secondary">
              Diferencial (Folha - Receita)
            </span>
            <span className={cn(
              'text-sm font-bold',
              delta > 5 
                ? 'text-semantic-error-DEFAULT' 
                : delta > 0 
                ? 'text-semantic-warning-DEFAULT' 
                : 'text-semantic-success-DEFAULT'
            )}>
              {delta > 0 ? '+' : ''}{delta.toFixed(1)} p.p.
            </span>
          </div>
        </div>

        {/* Message */}
        <div className="mt-4 p-3 rounded-lg bg-orion-bg-elevated/30 border border-orion-border-subtle">
          <p className="text-xs text-orion-text-secondary leading-relaxed">
            <StatusIcon className={cn('w-3 h-3 inline mr-1', config.color)} />
            {data.message}
          </p>
        </div>

        {/* Governance Health Integration Note */}
        <div className="mt-4 pt-4 border-t border-orion-border-subtle">
          <div className="flex items-center justify-between text-xs">
            <span className="text-orion-text-muted">
              Contribuição para Governance Health
            </span>
            <span className="text-orion-text-secondary font-medium">
              Score: {data.riskScore}/100
            </span>
          </div>
        </div>
      </OrionCard>
    </HoverCard>
  );
}

