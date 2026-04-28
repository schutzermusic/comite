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
        'bg-gradient-to-br from-white via-emerald-50/35 to-slate-50/95 border-slate-200/85',
        'shadow-[0_10px_40px_rgba(15,118,110,0.09),0_2px_8px_rgba(15,23,42,0.05)]',
        'dark:bg-gradient-to-br dark:from-emerald-950/40 dark:via-[#0f1815]/80 dark:to-[#0d1412]/90',
        'dark:border-white/[0.08]',
        'dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_24px_rgba(16,185,129,0.12),0_0_48px_rgba(16,185,129,0.06)]',
      ].join(' '),
      elevated: [
        'bg-gradient-to-br from-white via-teal-50/40 to-slate-100/95 border-slate-200/90',
        'shadow-[0_14px_48px_rgba(15,118,110,0.11),0_4px_14px_rgba(15,23,42,0.06)]',
        'dark:bg-gradient-to-br dark:from-emerald-950/50 dark:via-[#111a17]/90 dark:to-[#0f1815]/95',
        'dark:border-white/[0.12]',
        'dark:shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_36px_rgba(16,185,129,0.15),0_0_64px_rgba(16,185,129,0.08)]',
      ].join(' '),
      glass: [
        'bg-gradient-to-br from-white/92 via-teal-50/25 to-slate-50/80 backdrop-blur-2xl',
        'border-emerald-200/40 shadow-[0_10px_36px_rgba(15,118,110,0.08),0_2px_10px_rgba(0,0,0,0.04)]',
        'dark:from-emerald-900/20 dark:via-emerald-950/30 dark:to-transparent',
        'dark:border-emerald-500/10',
        'dark:shadow-[0_8px_32px_rgba(0,0,0,0.4),0_0_20px_rgba(16,185,129,0.1)]',
      ].join(' '),
      glow: [
        'bg-gradient-to-br from-white via-emerald-50/45 to-slate-100 border-emerald-300/45',
        'shadow-[0_0_36px_rgba(16,185,129,0.14),0_8px_28px_rgba(15,23,42,0.07)]',
        'dark:bg-gradient-to-br dark:from-emerald-950/50 dark:via-[#0f1815]/85 dark:to-[#0d1412]/90',
        'dark:border-emerald-500/20',
        'dark:shadow-[0_0_40px_rgba(16,185,129,0.2),0_0_80px_rgba(16,185,129,0.12)]',
      ].join(' '),
      premium: [
        'bg-gradient-to-br from-white via-emerald-50/50 to-slate-100/95 border-emerald-200/50',
        'shadow-[0_16px_52px_rgba(15,118,110,0.13),0_4px_16px_rgba(15,23,42,0.07)]',
        'dark:bg-gradient-to-br dark:from-emerald-950/60 dark:via-[#111a17]/90 dark:to-[#0e1614]/95',
        'dark:border-emerald-500/15',
        'dark:shadow-[0_12px_48px_rgba(0,0,0,0.55),0_0_50px_rgba(16,185,129,0.18),0_0_100px_rgba(16,185,129,0.1)]',
      ].join(' '),
      primary: [
        'bg-gradient-to-br from-white via-emerald-50/35 to-slate-50/95 border-slate-200/85',
        'shadow-[0_10px_40px_rgba(15,118,110,0.09),0_2px_8px_rgba(15,23,42,0.05)]',
        'dark:bg-gradient-to-br dark:from-emerald-950/40 dark:via-[#0f1815]/80 dark:to-[#0d1412]/90',
        'dark:border-white/[0.08]',
        'dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_24px_rgba(16,185,129,0.12),0_0_48px_rgba(16,185,129,0.06)]',
      ].join(' '),
      secondary: [
        'bg-gradient-to-br from-white via-slate-50/90 to-slate-100/95 border-slate-200/85',
        'shadow-[0_10px_40px_rgba(15,23,42,0.06),0_2px_8px_rgba(15,23,42,0.04)]',
        'dark:bg-gradient-to-br dark:from-emerald-950/40 dark:via-[#0f1815]/80 dark:to-[#0d1412]/90',
        'dark:border-white/[0.08]',
        'dark:shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_24px_rgba(16,185,129,0.12),0_0_48px_rgba(16,185,129,0.06)]',
      ].join(' '),
      visionpro: [
        'visionpro-glass-card visionpro-float visionpro-edge-light',
        'border-0',
      ].join(' '),
    };

    const glowClasses = {
      success:
        'shadow-[0_4px_28px_rgba(16,185,129,0.15)] border-emerald-400/40 dark:shadow-[0_0_30px_rgba(16,185,129,0.25)] dark:border-emerald-500/25',
      warning:
        'shadow-[0_4px_28px_rgba(245,158,11,0.16)] border-amber-400/45 dark:shadow-[0_0_30px_rgba(245,158,11,0.2)] dark:border-amber-500/25',
      error:
        'shadow-[0_4px_28px_rgba(239,68,68,0.14)] border-red-400/40 dark:shadow-[0_0_30px_rgba(239,68,68,0.2)] dark:border-red-500/25',
      info:
        'shadow-[0_4px_28px_rgba(6,182,212,0.14)] border-cyan-400/45 dark:shadow-[0_0_30px_rgba(6,182,212,0.2)] dark:border-cyan-500/25',
      purple:
        'shadow-[0_4px_28px_rgba(139,92,246,0.14)] border-violet-400/45 dark:shadow-[0_0_30px_rgba(139,92,246,0.2)] dark:border-violet-500/25',
    };

    const hoverClasses = (disableHover || variant === 'visionpro') ? '' : [
      'hover:border-slate-300/90',
      'hover:shadow-[0_18px_52px_rgba(15,118,110,0.14),0_8px_20px_rgba(15,23,42,0.08)]',
      'dark:hover:border-white/[0.15]',
      'dark:hover:shadow-[0_16px_56px_rgba(0,0,0,0.65),0_0_32px_rgba(16,185,129,0.18),0_0_64px_rgba(16,185,129,0.1)]',
      'hover:-translate-y-1',
      'hover:scale-[1.005]',
    ].join(' ');

    return (
      <div
        ref={ref}
        className={cn(
          'orion-card relative overflow-hidden rounded-xl border backdrop-blur-xl',
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
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-600/25 to-transparent pointer-events-none dark:via-emerald-500/20" />

        {/* Inner glow effect - Enhanced */}
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-600/[0.05] via-transparent to-transparent pointer-events-none dark:from-emerald-500/[0.03]" />

        {/* Inner highlight */}
        <div className="absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] pointer-events-none rounded-xl dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]" />

        {/* Content */}
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

OrionCard.displayName = 'OrionCard';

export { OrionCard };
export type { OrionCardProps };


