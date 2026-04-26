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
        'ig-glass relative overflow-hidden rounded-[14px]',
        onClick && 'cursor-pointer',
        className
      )}
      data-elev="3"
      data-interactive={(hoverGlow || Boolean(onClick)) || undefined}
      onClick={onClick}
    >
      <span data-ig-noise="" />
      <span data-ig-specular="" />
      <div data-ig-content="">{children}</div>
    </div>
  );
}
