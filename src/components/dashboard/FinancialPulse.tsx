'use client';

import { OrionCard } from '@/components/orion';
import { TrendingUp, TrendingDown, DollarSign, TrendingUpIcon } from 'lucide-react';
import { FinancialPulse as FinancialPulseType } from '@/lib/dashboard-data';
import { formatCurrency, formatPercentage } from '@/lib/dashboard-data';
import { cn } from '@/lib/utils';

interface FinancialPulseProps {
  data: FinancialPulseType;
  className?: string;
  compact?: boolean;
}

export function FinancialPulse({ data, className, compact }: FinancialPulseProps) {
  const revenueTrend = data.revenue.trend >= 0;
  const ebitdaTrend = data.ebitda.trend >= 0;
  const cashVariance = data.cash.variance >= 0;

  return (
    <OrionCard
      variant="visionpro"
      className={className}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={compact ? "space-y-2" : "space-y-4"}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white orion-section-title">Saúde Financeira</h3>
          <DollarSign className="w-4 h-4 text-orion-text-muted" />
        </div>

        {/* Revenue */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-orion-text-muted uppercase tracking-wider">Receita</span>
            <span className="text-xs text-orion-text-muted">{data.revenue.period === 'quarter' ? 'QTD' : 'Mês'}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-white">
              {formatCurrency(data.revenue.value, 'BRL')}
            </span>
            <div className={cn(
              'flex items-center gap-1 text-xs',
              revenueTrend ? 'text-semantic-success-DEFAULT' : 'text-semantic-error-DEFAULT'
            )}>
              {revenueTrend ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{formatPercentage(data.revenue.trend)}</span>
            </div>
          </div>
        </div>

        {/* EBITDA */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-orion-text-muted uppercase tracking-wider">EBITDA</span>
            <span className="text-xs text-orion-text-muted">Margem {data.ebitda.margin.toFixed(1)}%</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold text-white">
              {formatCurrency(data.ebitda.value, 'BRL')}
            </span>
            <div className={cn(
              'flex items-center gap-1 text-xs',
              ebitdaTrend ? 'text-semantic-success-DEFAULT' : 'text-semantic-error-DEFAULT'
            )}>
              {ebitdaTrend ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{formatPercentage(data.ebitda.trend)}</span>
            </div>
          </div>
        </div>

        {/* Cash Forecast vs Actual */}
        <div className="pt-2 border-t border-white/5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-orion-text-muted uppercase tracking-wider">Caixa</span>
            <div className={cn(
              'flex items-center gap-1 text-xs',
              cashVariance ? 'text-semantic-success-DEFAULT' : 'text-semantic-warning-DEFAULT'
            )}>
              {cashVariance ? (
                <TrendingUpIcon className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{formatPercentage(Math.abs(data.cash.variance))}</span>
            </div>
          </div>
          <div className="flex items-baseline justify-between">
            <div className="space-y-0.5">
              <div className="text-xs text-orion-text-tertiary">Previsto</div>
              <div className="text-sm font-medium text-white">
                {formatCurrency(data.cash.forecast, 'BRL')}
              </div>
            </div>
            <div className="text-xs text-orion-text-muted">vs</div>
            <div className="space-y-0.5">
              <div className="text-xs text-orion-text-tertiary">Real</div>
              <div className="text-sm font-medium text-white">
                {formatCurrency(data.cash.actual, 'BRL')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </OrionCard>
  );
}
