'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  hoverGlow?: boolean;
  animatedBorder?: boolean;
}

export function GlassPanel({
  children,
  className,
  hoverGlow = true,
  animatedBorder = true,
}: GlassPanelProps) {
  return (
    <div
      className={cn(
        'cr-glass-panel relative overflow-hidden rounded-2xl',
        hoverGlow && 'cr-glass-panel-hover',
        animatedBorder && 'cr-glass-panel-breathe',
        className
      )}
    >
      <div className="cr-glass-panel-border" />
      <div className="cr-glass-panel-specular" />
      <div className="cr-glass-panel-inner-stroke" />
      <div className="relative z-[2]">{children}</div>
    </div>
  );
}

