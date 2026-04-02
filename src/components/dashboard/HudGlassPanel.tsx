'use client';

import React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { GlassPanel } from './GlassPanel';

interface HudGlassPanelProps {
    title: string;
    /** Small accent dot color */
    accentColor?: string;
    /** Deep-link href for "Ver tudo →" */
    deepLinkHref?: string;
    deepLinkLabel?: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    /** Delay for stagger animation */
    delay?: number;
    /** Show animated scan-line */
    scanLine?: boolean;
}

export function HudGlassPanel({
    title,
    accentColor = 'bg-emerald-400',
    deepLinkHref,
    deepLinkLabel = 'Ver tudo',
    icon,
    children,
    className,
    delay = 0,
    scanLine = true,
}: HudGlassPanelProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.4, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
            className={cn('group', className)}
        >
            <GlassPanel>
                <div className="flex items-center justify-between px-3.5 pt-3 pb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                        <div className={cn('w-2 h-2 rounded-full flex-shrink-0 shadow-lg', accentColor)}
                            style={{ boxShadow: '0 0 8px currentColor' }} />
                        {icon && <span className="text-emerald-400/70 flex-shrink-0">{icon}</span>}
                        <span className="text-[10px] font-bold text-emerald-300/80 uppercase tracking-[0.15em] truncate">
                            {title}
                        </span>
                    </div>
                    {deepLinkHref && (
                        <Link
                            href={deepLinkHref}
                            className="text-[9px] font-semibold text-emerald-400/50 hover:text-emerald-400 transition-colors flex items-center gap-1 flex-shrink-0 uppercase tracking-wider"
                        >
                            {deepLinkLabel} <span className="text-[7px]">→</span>
                        </Link>
                    )}
                </div>
                <div className="mx-3.5 h-px bg-gradient-to-r from-transparent via-emerald-500/15 to-transparent" />
                <div className="px-3.5 py-2.5">{children}</div>
            </GlassPanel>
        </motion.div>
    );
}
