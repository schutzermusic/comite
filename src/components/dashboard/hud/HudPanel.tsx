'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { GlassPanel } from '@/components/dashboard/GlassPanel';

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
}: HudPanelProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
            className={cn('group', className)}
        >
            <GlassPanel>
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
                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-semibold tabular-nums border border-amber-400/25">
                                {badge}
                            </span>
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
            </GlassPanel>
        </motion.div>
    );
});
