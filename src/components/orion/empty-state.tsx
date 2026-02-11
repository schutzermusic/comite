'use client';

import { cn } from '@/lib/utils';
import { LucideIcon, Inbox, Search, FileX, AlertCircle, CheckCircle } from 'lucide-react';
import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: 'default' | 'search' | 'error' | 'success';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const variantConfig = {
  default: {
    icon: Inbox,
    iconColor: 'text-orion-text-muted',
  },
  search: {
    icon: Search,
    iconColor: 'text-orion-text-muted',
  },
  error: {
    icon: AlertCircle,
    iconColor: 'text-semantic-error-DEFAULT/70',
  },
  success: {
    icon: CheckCircle,
    iconColor: 'text-semantic-success-DEFAULT/70',
  },
};

const sizeConfig = {
  sm: {
    iconSize: 'w-8 h-8',
    title: 'text-sm',
    description: 'text-xs',
    padding: 'py-6',
  },
  md: {
    iconSize: 'w-12 h-12',
    title: 'text-base',
    description: 'text-sm',
    padding: 'py-12',
  },
  lg: {
    iconSize: 'w-16 h-16',
    title: 'text-lg',
    description: 'text-base',
    padding: 'py-16',
  },
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'default',
  size = 'md',
  className,
}: EmptyStateProps) {
  const variantCfg = variantConfig[variant];
  const sizeCfg = sizeConfig[size];
  const IconComponent = icon || variantCfg.icon;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        sizeCfg.padding,
        className
      )}
    >
      {/* Icon with subtle background */}
      <div className="relative mb-4">
        <div className="absolute inset-0 bg-orion-bg-elevated rounded-full blur-xl opacity-50" />
        <div className="relative p-4 rounded-full bg-orion-bg-elevated/50">
          <IconComponent className={cn(sizeCfg.iconSize, variantCfg.iconColor)} />
        </div>
      </div>

      {/* Title */}
      <h3 className={cn('font-semibold text-orion-text-secondary mb-1', sizeCfg.title)}>
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className={cn('text-orion-text-muted max-w-sm', sizeCfg.description)}>
          {description}
        </p>
      )}

      {/* Action */}
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  );
}

// Pre-built empty states
export function NoDataState({ message = 'No data available' }: { message?: string }) {
  return (
    <EmptyState
      title={message}
      description="Data will appear here once available."
      variant="default"
    />
  );
}

export function NoSearchResultsState({ query }: { query?: string }) {
  return (
    <EmptyState
      title="No results found"
      description={query ? `No results for "${query}". Try a different search term.` : 'Try adjusting your search or filters.'}
      variant="search"
    />
  );
}

export function ErrorState({ 
  message = 'Something went wrong', 
  onRetry 
}: { 
  message?: string; 
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      title="Error"
      description={message}
      variant="error"
      action={
        onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-2 text-sm font-medium text-white bg-semantic-error-DEFAULT/20 hover:bg-semantic-error-DEFAULT/30 rounded-lg transition-colors"
          >
            Try Again
          </button>
        )
      }
    />
  );
}

export function SuccessState({ 
  title = 'Success!', 
  message 
}: { 
  title?: string; 
  message?: string;
}) {
  return (
    <EmptyState
      title={title}
      description={message}
      variant="success"
    />
  );
}






















