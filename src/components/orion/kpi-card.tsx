'use client';

import { cn } from '@/lib/utils';
import { OrionCard } from './orion-card';
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { kpiCardHoverVariants } from '@/lib/motion-presets';

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label?: string;
  };
  sparkline?: ReactNode;
  status?: 'success' | 'warning' | 'error' | 'neutral';
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Disable hover animation */
  disableHover?: boolean;
}

export function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  trend,
  sparkline,
  status = 'neutral',
  className,
  size = 'md',
  disableHover = false,
}: KpiCardProps) {
  const statusColors = {
    success: 'text-semantic-success-DEFAULT',
    warning: 'text-semantic-warning-DEFAULT',
    error: 'text-semantic-error-DEFAULT',
    neutral: 'text-orion-text-secondary',
  };

  const statusGlow = {
    success: 'shadow-glow-success',
    warning: 'shadow-glow-warning',
    error: 'shadow-glow-error',
    neutral: '',
  };

  const sizeClasses = {
    sm: {
      value: 'text-2xl',
      label: 'text-xs',
      icon: 'w-4 h-4',
      padding: 'p-4',
    },
    md: {
      value: 'text-kpi-sm',
      label: 'text-label',
      icon: 'w-5 h-5',
      padding: 'p-6',
    },
    lg: {
      value: 'text-kpi-md',
      label: 'text-sm',
      icon: 'w-6 h-6',
      padding: 'p-8',
    },
  };

  const getTrendIcon = () => {
    if (!trend) return null;
    if (trend.value > 0) return TrendingUp;
    if (trend.value < 0) return TrendingDown;
    return Minus;
  };

  const TrendIcon = getTrendIcon();

  const cardContent = (
    <OrionCard
      variant="premium"
      className={cn(
        sizeClasses[size].padding,
        status !== 'neutral' && statusGlow[status],
        'group light-sweep-container',
        className
      )}
      disableHover={true}
    >
      {/* Header with label and icon */}
      <div className="flex items-start justify-between mb-3">
        <span className={cn(
          'font-medium uppercase tracking-wider',
          sizeClasses[size].label,
          'text-orion-text-muted'
        )}>
          {label}
        </span>
        
        {Icon && (
          <div className={cn(
            'p-2 rounded-lg',
            'bg-glass-light',
            'transition-all duration-300',
            'group-hover:bg-glass-medium'
          )}>
            <Icon className={cn(sizeClasses[size].icon, statusColors[status])} />
          </div>
        )}
      </div>

      {/* Value - Premium styling */}
      <div className="flex items-end gap-3">
        <span className={cn(
          'font-bold tracking-tight orion-kpi-number',
          sizeClasses[size].value
        )}>
          {value}
        </span>

        {/* Trend indicator */}
        {trend && TrendIcon && (
          <div className={cn(
            'flex items-center gap-1 mb-1',
            'text-sm font-medium',
            trend.value > 0 ? 'text-semantic-success-DEFAULT' :
            trend.value < 0 ? 'text-semantic-error-DEFAULT' :
            'text-orion-text-muted'
          )}>
            <TrendIcon className="w-4 h-4" />
            <span>{Math.abs(trend.value)}%</span>
          </div>
        )}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <p className="mt-2 text-sm text-orion-text-tertiary">
          {subtitle}
        </p>
      )}

      {/* Trend label */}
      {trend?.label && (
        <p className="mt-1 text-xs text-orion-text-muted">
          {trend.label}
        </p>
      )}

      {/* Sparkline slot */}
      {sparkline && (
        <div className="mt-4 h-12">
          {sparkline}
        </div>
      )}
    </OrionCard>
  );

  if (disableHover) {
    return cardContent;
  }

  return (
    <motion.div
      initial="rest"
      whileHover="hover"
      whileTap="tap"
      variants={kpiCardHoverVariants}
    >
      {cardContent}
    </motion.div>
  );
}


