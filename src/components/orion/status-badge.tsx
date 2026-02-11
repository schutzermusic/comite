'use client';

import { cn } from '@/lib/utils';

type StatusType = 
  | 'success' | 'healthy' | 'active' | 'approved' | 'completed'
  | 'warning' | 'attention' | 'pending' | 'in_progress' | 'review'
  | 'error' | 'critical' | 'overdue' | 'rejected' | 'failed'
  | 'info' | 'neutral' | 'draft' | 'archived';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

const statusConfig: Record<StatusType, { 
  label: string; 
  color: string;
  bgColor: string;
  dotColor: string;
}> = {
  // Success variants
  success: { label: 'Success', color: 'text-semantic-success-DEFAULT', bgColor: 'bg-semantic-success-DEFAULT/10', dotColor: 'bg-semantic-success-DEFAULT' },
  healthy: { label: 'Healthy', color: 'text-semantic-success-DEFAULT', bgColor: 'bg-semantic-success-DEFAULT/10', dotColor: 'bg-semantic-success-DEFAULT' },
  active: { label: 'Active', color: 'text-semantic-success-DEFAULT', bgColor: 'bg-semantic-success-DEFAULT/10', dotColor: 'bg-semantic-success-DEFAULT' },
  approved: { label: 'Approved', color: 'text-semantic-success-DEFAULT', bgColor: 'bg-semantic-success-DEFAULT/10', dotColor: 'bg-semantic-success-DEFAULT' },
  completed: { label: 'Completed', color: 'text-semantic-success-DEFAULT', bgColor: 'bg-semantic-success-DEFAULT/10', dotColor: 'bg-semantic-success-DEFAULT' },
  
  // Warning variants
  warning: { label: 'Warning', color: 'text-semantic-warning-DEFAULT', bgColor: 'bg-semantic-warning-DEFAULT/10', dotColor: 'bg-semantic-warning-DEFAULT' },
  attention: { label: 'Attention', color: 'text-semantic-warning-DEFAULT', bgColor: 'bg-semantic-warning-DEFAULT/10', dotColor: 'bg-semantic-warning-DEFAULT' },
  pending: { label: 'Pending', color: 'text-semantic-warning-DEFAULT', bgColor: 'bg-semantic-warning-DEFAULT/10', dotColor: 'bg-semantic-warning-DEFAULT' },
  in_progress: { label: 'In Progress', color: 'text-semantic-warning-DEFAULT', bgColor: 'bg-semantic-warning-DEFAULT/10', dotColor: 'bg-semantic-warning-DEFAULT' },
  review: { label: 'In Review', color: 'text-semantic-warning-DEFAULT', bgColor: 'bg-semantic-warning-DEFAULT/10', dotColor: 'bg-semantic-warning-DEFAULT' },
  
  // Error variants
  error: { label: 'Error', color: 'text-semantic-error-DEFAULT', bgColor: 'bg-semantic-error-DEFAULT/10', dotColor: 'bg-semantic-error-DEFAULT' },
  critical: { label: 'Critical', color: 'text-semantic-error-DEFAULT', bgColor: 'bg-semantic-error-DEFAULT/10', dotColor: 'bg-semantic-error-DEFAULT' },
  overdue: { label: 'Overdue', color: 'text-semantic-error-DEFAULT', bgColor: 'bg-semantic-error-DEFAULT/10', dotColor: 'bg-semantic-error-DEFAULT' },
  rejected: { label: 'Rejected', color: 'text-semantic-error-DEFAULT', bgColor: 'bg-semantic-error-DEFAULT/10', dotColor: 'bg-semantic-error-DEFAULT' },
  failed: { label: 'Failed', color: 'text-semantic-error-DEFAULT', bgColor: 'bg-semantic-error-DEFAULT/10', dotColor: 'bg-semantic-error-DEFAULT' },
  
  // Neutral variants
  info: { label: 'Info', color: 'text-semantic-info-DEFAULT', bgColor: 'bg-semantic-info-DEFAULT/10', dotColor: 'bg-semantic-info-DEFAULT' },
  neutral: { label: 'Neutral', color: 'text-orion-text-secondary', bgColor: 'bg-orion-bg-elevated', dotColor: 'bg-orion-text-muted' },
  draft: { label: 'Draft', color: 'text-orion-text-secondary', bgColor: 'bg-orion-bg-elevated', dotColor: 'bg-orion-text-muted' },
  archived: { label: 'Archived', color: 'text-orion-text-muted', bgColor: 'bg-orion-bg-elevated', dotColor: 'bg-orion-text-muted' },
};

export function OrionStatusBadge({
  status,
  label,
  size = 'md',
  dot = true,
  pulse = false,
  className,
}: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.neutral;
  const displayLabel = label || config.label;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  };

  const dotSizeClasses = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        'border border-transparent',
        sizeClasses[size],
        config.bgColor,
        config.color,
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            'rounded-full',
            dotSizeClasses[size],
            config.dotColor,
            pulse && 'animate-pulse'
          )}
        />
      )}
      {displayLabel}
    </span>
  );
}






















