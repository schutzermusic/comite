'use client';

import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getHealthScoreColor, getHealthScoreLabel } from '@/lib/utils/project-utils';

interface ProjectHealthIndicatorProps {
  score: number;
  variant?: 'pill' | 'ring' | 'inline';
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

export function ProjectHealthIndicator({
  score,
  variant = 'pill',
  size = 'sm',
  showLabel = false,
  className,
}: ProjectHealthIndicatorProps) {
  const safe = Math.max(0, Math.min(100, Math.round(score)));
  const color = getHealthScoreColor(safe);
  const label = getHealthScoreLabel(safe);

  if (variant === 'ring') {
    const radius = size === 'md' ? 18 : 14;
    const stroke = size === 'md' ? 3 : 2.5;
    const circ = 2 * Math.PI * radius;
    const offset = circ * (1 - safe / 100);
    const box = (radius + stroke) * 2;
    return (
      <div className={cn('inline-flex items-center gap-2 health-indicator', className)}>
        <div className="relative" style={{ width: box, height: box }}>
          <svg width={box} height={box} className="-rotate-90">
            <circle
              cx={box / 2}
              cy={box / 2}
              r={radius}
              stroke="currentColor"
              className="hud-text-muted opacity-25"
              strokeWidth={stroke}
              fill="none"
            />
            <circle
              cx={box / 2}
              cy={box / 2}
              r={radius}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 600ms ease' }}
            />
          </svg>
          <span
            className={cn(
              'absolute inset-0 flex items-center justify-center font-semibold tabular-nums',
              size === 'md' ? 'text-xs' : 'text-[10px]',
            )}
            style={{ color }}
          >
            {safe}
          </span>
        </div>
        {showLabel && (
          <div className="leading-tight">
            <p className="text-[10px] uppercase tracking-wider hud-text-muted">Health</p>
            <p className="text-xs font-medium" style={{ color }}>{label}</p>
          </div>
        )}
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={cn('inline-flex items-center gap-1.5 health-indicator', className)}>
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-sm font-semibold tabular-nums" style={{ color }}>
          {safe}
        </span>
        {showLabel && <span className="text-xs hud-text-muted">{label}</span>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold health-indicator',
        size === 'md' ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]',
        className,
      )}
      style={{
        color,
        background: `${color}1A`,
        border: `1px solid ${color}33`,
      }}
    >
      <Heart className={size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
      <span className="tabular-nums">{safe}</span>
      {showLabel && <span className="opacity-80">{label}</span>}
    </div>
  );
}

export default ProjectHealthIndicator;
