'use client';

import { cn } from '@/lib/utils';
import { forwardRef, HTMLAttributes } from 'react';

interface OrionCardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'glass' | 'glow' | 'premium' | 'primary' | 'secondary' | 'visionpro';
  glowColor?: 'success' | 'warning' | 'error' | 'info' | 'purple';
  noPadding?: boolean;
  disableHover?: boolean;
}

const OrionCard = forwardRef<HTMLDivElement, OrionCardProps>(
  ({ className, variant = 'default', glowColor, noPadding, disableHover, children, ...props }, ref) => {
    const variantClasses = {
      default: [
        'bg-gradient-to-br from-emerald-950/40 via-[#0f1815]/80 to-[#0d1412]/90',
        'border-white/[0.08]',
        'shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_24px_rgba(16,185,129,0.12),0_0_48px_rgba(16,185,129,0.06)]',
      ].join(' '),
      elevated: [
        'bg-gradient-to-br from-emerald-950/50 via-[#111a17]/90 to-[#0f1815]/95',
        'border-white/[0.12]',
        'shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_36px_rgba(16,185,129,0.15),0_0_64px_rgba(16,185,129,0.08)]',
      ].join(' '),
      glass: [
        'bg-gradient-to-br from-emerald-900/20 via-emerald-950/30 to-transparent',
        'border-emerald-500/10',
        'backdrop-blur-2xl',
        'shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_20px_rgba(16,185,129,0.1)]',
      ].join(' '),
      glow: [
        'bg-gradient-to-br from-emerald-950/50 via-[#0f1815]/85 to-[#0d1412]/90',
        'border-emerald-500/20',
        'shadow-[0_0_40px_rgba(16,185,129,0.2),0_0_80px_rgba(16,185,129,0.12)]',
      ].join(' '),
      premium: [
        'bg-gradient-to-br from-emerald-950/60 via-[#111a17]/90 to-[#0e1614]/95',
        'border-emerald-500/15',
        'shadow-[0_12px_48px_rgba(0,0,0,0.55),0_0_50px_rgba(16,185,129,0.18),0_0_100px_rgba(16,185,129,0.1)]',
      ].join(' '),
      // Primary cards - mantido para compatibilidade, mas usando sombras mais fortes
      primary: [
        'bg-gradient-to-br from-emerald-950/40 via-[#0f1815]/80 to-[#0d1412]/90',
        'border-white/[0.08]',
        'shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_24px_rgba(16,185,129,0.12),0_0_48px_rgba(16,185,129,0.06)]',
      ].join(' '),
      // Secondary cards - mantido para compatibilidade
      secondary: [
        'bg-gradient-to-br from-emerald-950/40 via-[#0f1815]/80 to-[#0d1412]/90',
        'border-white/[0.08]',
        'shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_24px_rgba(16,185,129,0.12),0_0_48px_rgba(16,185,129,0.06)]',
      ].join(' '),
      // Vision Pro - Apple Spatial Computing glassmorphism
      visionpro: [
        'visionpro-glass-card visionpro-float visionpro-edge-light',
        'border-0',
      ].join(' '),
    };

    const glowClasses = {
      success: 'shadow-[0_0_30px_rgba(16,185,129,0.25)] border-emerald-500/25',
      warning: 'shadow-[0_0_30px_rgba(245,158,11,0.2)] border-amber-500/25',
      error: 'shadow-[0_0_30px_rgba(239,68,68,0.2)] border-red-500/25',
      info: 'shadow-[0_0_30px_rgba(6,182,212,0.2)] border-cyan-500/25',
      purple: 'shadow-[0_0_30px_rgba(139,92,246,0.2)] border-violet-500/25',
    };

    const hoverClasses = (disableHover || variant === 'visionpro') ? '' : [
      'hover:border-white/[0.15]',
      'hover:shadow-[0_16px_56px_rgba(0,0,0,0.65),0_0_32px_rgba(16,185,129,0.18),0_0_64px_rgba(16,185,129,0.1)]',
      'hover:-translate-y-1',
      'hover:scale-[1.005]',
    ].join(' ');

    return (
      <div
        ref={ref}
        className={cn(
          'relative overflow-hidden rounded-xl border backdrop-blur-xl',
          'transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
          variantClasses[variant],
          glowColor && glowClasses[glowColor],
          hoverClasses,
          !noPadding && 'p-6',
          className
        )}
        {...props}
      >
        {/* Top gradient border highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent pointer-events-none" />

        {/* Inner glow effect - Enhanced */}
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/[0.03] via-transparent to-transparent pointer-events-none" />

        {/* Inner highlight */}
        <div className="absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] pointer-events-none rounded-xl" />

        {/* Content */}
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

OrionCard.displayName = 'OrionCard';

export { OrionCard };
export type { OrionCardProps };


