'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface HudPanelProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accentColor?: 'cyan' | 'emerald' | 'amber' | 'red' | 'purple' | 'blue';
  deepLink?: { href: string; label: string };
  badge?: number;
  headerActions?: React.ReactNode;
  delay?: number;
  hoverGlow?: boolean;
  breathe?: boolean;
  noPadding?: boolean;
}

const ACCENT_DOTS: Record<string, string> = {
  cyan: 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]',
  emerald: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]',
  amber: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]',
  red: 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]',
  purple: 'bg-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.5)]',
  blue: 'bg-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]',
};

/**
 * HudPanel — uses the EXACT same cr-glass-panel CSS class from the Dashboard,
 * including border layer, specular highlight, and inner-stroke pseudo-layers.
 * NO grain, deep clean glass with restrained teal/cyan accents.
 */
export function HudPanel({
  children,
  className,
  title,
  subtitle,
  icon,
  accentColor = 'cyan',
  deepLink,
  badge,
  headerActions,
  delay = 0,
  hoverGlow = true,
  breathe = false,
  noPadding = false,
}: HudPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className={cn('group', className)}
    >
      {/* cr-glass-panel — the dashboard's exact glass recipe */}
      <div
        className={cn(
          'cr-glass-panel relative overflow-hidden rounded-2xl',
          hoverGlow && 'cr-glass-panel-hover',
          breathe && 'cr-glass-panel-breathe',
        )}
      >
        {/* Multi-layer border system — same as dashboard GlassPanel */}
        <div className="cr-glass-panel-border" />
        <div className="cr-glass-panel-specular" />
        <div className="cr-glass-panel-inner-stroke" />

        {/* Content wrapper above pseudo-layers */}
        <div className="relative z-[2]">
          {/* Header */}
          {(title || icon) && (
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', ACCENT_DOTS[accentColor])} />
                {icon && (
                  <span className="hud-panel-icon text-white/70 flex-shrink-0 [&_svg]:stroke-[1.8] [&_svg]:w-3.5 [&_svg]:h-3.5">
                    {icon}
                  </span>
                )}
                <div className="flex flex-col min-w-0">
                  {title && (
                    <span className="cr-panel-title truncate">{title}</span>
                  )}
                  {subtitle && (
                    <span className="hud-panel-subtitle text-[0.5625rem] text-white/40 tracking-wide">{subtitle}</span>
                  )}
                </div>
                {badge !== undefined && badge > 0 && (
                  <span className="hud-panel-badge ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-semibold tabular-nums border border-amber-400/25">
                    {badge}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {headerActions}
                {deepLink && (
                  <a
                    href={deepLink.href}
                    className="hud-panel-deeplink text-[9px] font-semibold text-white/50 hover:text-cyan-200 transition-colors flex items-center gap-1 flex-shrink-0 uppercase tracking-[0.12em]"
                  >
                    {deepLink.label}
                    <span className="text-[7px] opacity-70">→</span>
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Divider — same gradient line as dashboard panels */}
          {title && (
            <div className="hud-panel-divider mx-4 h-px bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent" />
          )}

          {/* Content */}
          <div className={cn(!noPadding && 'p-4', title && 'pt-3')}>
            {children}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
