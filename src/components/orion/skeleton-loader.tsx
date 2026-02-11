'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  variant?: 'default' | 'circular' | 'rectangular';
}

export function Skeleton({ className, variant = 'default' }: SkeletonProps) {
  const variantClasses = {
    default: 'rounded-md',
    circular: 'rounded-full',
    rectangular: 'rounded-none',
  };

  return (
    <div
      className={cn(
        'animate-pulse bg-orion-bg-elevated',
        variantClasses[variant],
        className
      )}
    />
  );
}

// Pre-built skeleton patterns
export function KpiCardSkeleton() {
  return (
    <div className="p-6 rounded-xl bg-orion-bg-secondary/80 border border-orion-border-DEFAULT">
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-10 w-32 mb-2" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

export function DecisionQueueItemSkeleton() {
  return (
    <div className="p-4 rounded-lg bg-orion-bg-secondary/60 border border-orion-border-DEFAULT border-l-4 border-l-orion-border-strong">
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="h-5 w-16 rounded" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-4 w-3/4 mb-2" />
      <Skeleton className="h-3 w-full mb-3" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  );
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div 
      className="rounded-xl bg-orion-bg-secondary/50 border border-orion-border-subtle p-4"
      style={{ height }}
    >
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-end justify-around h-[calc(100%-48px)] gap-2 px-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton
            key={i}
            className="flex-1"
            style={{ height: `${30 + Math.random() * 50}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-orion-border-subtle">
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-4',
            i === 0 ? 'w-8' : i === 1 ? 'w-32' : 'w-24'
          )}
        />
      ))}
    </div>
  );
}

export function RingChartSkeleton({ size = 160 }: { size?: number }) {
  return (
    <div className="flex items-center justify-center p-4">
      <div 
        className="relative"
        style={{ width: size, height: size }}
      >
        <Skeleton className="absolute inset-0 rounded-full" />
        <div 
          className="absolute bg-orion-bg-primary rounded-full"
          style={{ 
            top: size * 0.2, 
            left: size * 0.2,
            width: size * 0.6,
            height: size * 0.6,
          }}
        />
      </div>
    </div>
  );
}

// Loading overlay for sections
export function SectionLoader({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 border-2 border-orion-border-DEFAULT rounded-full" />
        <div className="absolute inset-0 border-2 border-semantic-info-DEFAULT border-t-transparent rounded-full animate-spin" />
      </div>
      <p className="text-sm text-orion-text-muted">{message}</p>
    </div>
  );
}






















