'use client';

import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { GlassPanel } from '@/components/dashboard/GlassPanel';
import { SignalChip } from '@/components/ui/signal-chip';
import { useParallaxGlass } from '@/hooks/useParallaxGlass';

export interface HudPanelProps {
    title: string;
    accentColor?: string;
    deepLinkHref?: string;
    deepLinkLabel?: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    delay?: number;
    /** Optional badge count shown next to toggle/expand */
    badge?: number;
    /** Serial number rendered in the footer (font-mono tracking-[0.2em]). */
    serial?: string;
    /** Watermark rendered in the footer (uppercase tracking-[0.32em]). */
    watermark?: string;
    /** Subtle parallax + spotlight on hover (auto-disabled with prefers-reduced-motion). */
    parallax?: boolean;
}

export const HudPanel = React.memo(function HudPanel({
    title,
    accentColor = 'bg-emerald-400',
    deepLinkHref,
    deepLinkLabel = 'Ver tudo',
    icon,
    children,
    className,
    delay = 0,
    badge,
    serial,
    watermark,
    parallax = false,
}: HudPanelProps) {
    const shouldReduceMotion = useReducedMotion();
    const parallaxGlass = useParallaxGlass(0.8);
    const parallaxEnabled = parallax && !shouldReduceMotion;

    return (
        <motion.div
            ref={parallaxEnabled ? parallaxGlass.containerRef : undefined}
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
            className={cn('group', className)}
            data-parallax={parallaxEnabled || undefined}
            onMouseMove={parallaxEnabled ? parallaxGlass.onMouseMove : undefined}
            onMouseLeave={parallaxEnabled ? parallaxGlass.onMouseLeave : undefined}
        >
            <GlassPanel>
                {parallaxEnabled && (
                    <span
                        data-ig-spotlight=""
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                        style={{
                            background:
                                'radial-gradient(circle 220px at var(--ig-spot-x, 50%) var(--ig-spot-y, 50%), rgba(20,184,166,0.10), transparent 65%)',
                        }}
                    />
                )}
                <div
                    data-ig-content=""
                    style={
                        parallaxEnabled
                            ? {
                                  transition:
                                      'transform 200ms cubic-bezier(0.22,1,0.36,1)',
                                  transform:
                                      'translate3d(calc(var(--ig-parallax-x, 0px) * 0.4), calc(var(--ig-parallax-y, 0px) * 0.4), 0)',
                                  willChange: 'transform',
                              }
                            : undefined
                    }
                >
                    <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                            <div
                                className={cn(
                                    'w-1.5 h-1.5 rounded-full flex-shrink-0',
                                    accentColor
                                )}
                                style={{ boxShadow: '0 0 10px currentColor' }}
                            />
                            {icon && (
                                <span className="text-white/70 flex-shrink-0 [&_svg]:stroke-[1.8]">{icon}</span>
                            )}
                            <span className="cr-panel-title truncate">{title}</span>
                            {badge !== undefined && (
                                <SignalChip
                                    tone="warning"
                                    size="xs"
                                    label={badge}
                                    hideDot
                                    className="ml-1 min-w-[18px] justify-center tracking-normal"
                                />
                            )}
                        </div>
                        {deepLinkHref && (
                            <Link
                                href={deepLinkHref}
                                className="text-[9px] font-semibold text-white/50 hover:text-cyan-200 transition-colors flex items-center gap-1 flex-shrink-0 uppercase tracking-[0.12em]"
                            >
                                {deepLinkLabel}
                                <span className="text-[7px] opacity-70">→</span>
                            </Link>
                        )}
                    </div>

                    <div className="mx-3.5 h-px bg-gradient-to-r from-transparent via-cyan-300/25 to-transparent" />
                    <div className="px-3.5 py-2.5">{children}</div>

                    {(watermark || serial) && (
                        <footer className="flex items-center justify-between border-t border-ig-border-subtle px-3.5 pb-2 pt-2">
                            {serial && (
                                <span className="font-mono text-[10px] tracking-[0.2em] text-ig-fg-subtle">
                                    {serial}
                                </span>
                            )}
                            {watermark && (
                                <span className="ml-auto text-[9px] uppercase tracking-[0.32em] text-ig-fg-subtle">
                                    {watermark}
                                </span>
                            )}
                        </footer>
                    )}
                </div>
            </GlassPanel>
        </motion.div>
    );
});
