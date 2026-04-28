'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle, AlertCircle, TrendingUp, ChevronRight, Users } from 'lucide-react';
import { OrionCard } from '@/components/orion';
import { HoverCard } from '@/components/motion';
import { KpiSparkline } from '@/components/charts/echarts';
import { RiskStatus } from '@/lib/workforce-data';
import { cn } from '@/lib/utils';

interface WorkforceSignalCardProps {
  status: RiskStatus;
  payrollRevenuePercent: number;
  threshold: number;
  abnormalCenters: number;
  sparkline?: number[];
  riskScore?: number;
  className?: string;
}

const statusConfig: Record<RiskStatus, {
  icon: typeof CheckCircle;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  healthy: {
    icon: CheckCircle,
    label: 'Saudável',
    color: 'text-ig-success',
    bgColor: 'bg-ig-success/10',
    borderColor: 'border-ig-success/25',
  },
  attention: {
    icon: AlertTriangle,
    label: 'Atenção',
    color: 'text-ig-warning',
    bgColor: 'bg-ig-warning/10',
    borderColor: 'border-ig-warning/25',
  },
  risk: {
    icon: AlertCircle,
    label: 'Risco',
    color: 'text-ig-danger',
    bgColor: 'bg-ig-danger/10',
    borderColor: 'border-ig-danger/25',
  },
};

export function WorkforceSignalCard({
  status,
  payrollRevenuePercent,
  threshold,
  abnormalCenters,
  sparkline,
  riskScore,
  className,
}: WorkforceSignalCardProps) {
  const config = statusConfig[status];
  const StatusIcon = config.icon;
  const isOverThreshold = payrollRevenuePercent >= threshold;

  return (
    <HoverCard preset="card" lightSweep>
      <OrionCard variant="elevated" className={cn('relative overflow-hidden', className)}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-ig-panel border border-ig-border-subtle">
              <Users className="w-4 h-4 text-ig-info" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ig-fg-strong tracking-tight">Workforce & Custos</h3>
              <p className="text-xs text-ig-fg-muted">Sinalizador de folha de pagamento</p>
            </div>
          </div>
          
          {/* Status Badge */}
          <div className={cn(
            'flex items-center gap-1.5 px-2.5 py-1 rounded-full',
            config.bgColor,
            'border',
            config.borderColor
          )}>
            <StatusIcon className={cn('w-3.5 h-3.5', config.color)} />
            <span className={cn('text-xs font-semibold', config.color)}>
              {config.label}
            </span>
            {riskScore !== undefined && (
              <span className={cn('text-xs', config.color)}>
                {riskScore}
              </span>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex items-center justify-between gap-4">
          {/* Primary Metric */}
          <div className="flex-1">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-2xl font-semibold text-ig-fg-strong ig-tabular tracking-tight">
                {payrollRevenuePercent.toFixed(1)}%
              </span>
              <span className="text-xs text-ig-fg-muted">
                Folha/Receita
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-xs ig-tabular',
                isOverThreshold ? 'text-ig-warning' : 'text-ig-success'
              )}>
                Limite: {threshold}%
              </span>
              {isOverThreshold && (
                <TrendingUp className="w-3 h-3 text-ig-warning" />
              )}
            </div>
          </div>

          {/* Sparkline */}
          {sparkline && sparkline.length > 0 && (
            <div className="w-24">
              <KpiSparkline
                data={sparkline}
                height={40}
                width={96}
                color={status === 'healthy' ? 'success' : status === 'attention' ? 'warning' : 'error'}
              />
            </div>
          )}
        </div>

        {/* Alert Line */}
        {abnormalCenters > 0 && (
          <div className={cn(
            'flex items-center gap-2 mt-4 p-2 rounded-lg',
            'bg-ig-warning/10 border border-ig-warning/25'
          )}>
            <AlertTriangle className="w-3.5 h-3.5 text-ig-warning" />
            <span className="text-xs text-ig-warning font-medium">
              {abnormalCenters} centro{abnormalCenters > 1 ? 's' : ''} com crescimento anormal
            </span>
          </div>
        )}

        {/* CTA */}
        <Link
          href="/workforce-cost"
          className={cn(
            'flex items-center justify-between mt-4 p-3 rounded-lg',
            'bg-ig-panel hover:bg-ig-panel-hover',
            'border border-ig-border-subtle hover:border-ig-border',
            'transition-all duration-200 group'
          )}
        >
          <span className="text-sm font-medium text-ig-fg-strong">Analisar detalhes</span>
          <ChevronRight className="w-4 h-4 text-ig-fg-muted group-hover:text-ig-fg-strong group-hover:translate-x-1 transition-all" />
        </Link>
      </OrionCard>
    </HoverCard>
  );
}

