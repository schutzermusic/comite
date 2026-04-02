'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  hoverGlow?: boolean;
  onClick?: () => void;
}

export function GlassPanel({
  children,
  className,
  hoverGlow = true,
  onClick,
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        'cr-glass-panel relative overflow-hidden rounded-[14px]',
        hoverGlow && 'cr-glass-panel-hover',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="cr-glass-panel-border" />
      <div className="cr-glass-panel-specular" />
      <div className="relative z-[2]">{children}</div>
    </div>
  );
}

