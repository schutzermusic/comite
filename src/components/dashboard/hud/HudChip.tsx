'use client';

import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export type HudChipVariant = 'critical' | 'warning' | 'info' | 'success' | 'live';

export interface HudChipProps {
    label: string;
    count?: number;
    variant?: HudChipVariant;
    href?: string;
    className?: string;
    pulseDot?: boolean;
}

const VARIANT_STYLES: Record<HudChipVariant, { dot: string; chip: string }> = {
    critical: {
        dot: 'bg-red-400',
        chip: 'bg-red-500/[0.08] border-red-500/20 text-red-300 hover:border-red-500/35 hover:bg-red-500/[0.14]',
    },
    warning: {
        dot: 'bg-amber-400',
        chip: 'bg-amber-500/[0.06] border-amber-500/18 text-amber-300 hover:border-amber-500/30 hover:bg-amber-500/[0.12]',
    },
    info: {
        dot: 'bg-teal-400',
        chip: 'bg-teal-500/[0.06] border-teal-500/18 text-teal-300 hover:border-teal-500/30 hover:bg-teal-500/[0.12]',
    },
    success: {
        dot: 'bg-emerald-400',
        chip: 'bg-emerald-500/[0.06] border-emerald-500/18 text-emerald-300 hover:border-emerald-500/30 hover:bg-emerald-500/[0.12]',
    },
    live: {
        dot: 'bg-emerald-400 animate-pulse',
        chip: 'bg-emerald-500/[0.06] border-emerald-500/[0.15] text-emerald-400',
    },
};

export function HudChip({
    label,
    count,
    variant = 'info',
    href,
    className,
    pulseDot = false,
}: HudChipProps) {
    const styles = VARIANT_STYLES[variant];
    const inner = (
        <>
            <span className={cn('w-[0.35em] h-[0.35em] min-w-[0.35em] min-h-[0.35em] rounded-full inline-block flex-shrink-0', styles.dot, pulseDot && 'animate-pulse')} />
            <span className="truncate">{label}</span>
            {count !== undefined && (
                <span className="font-bold tabular-nums">{count}</span>
            )}
        </>
    );

    const chipClass = cn(
        'inline-flex items-center gap-[0.4em] px-[0.7em] py-[0.35em] rounded-full text-[0.85em] font-semibold tracking-wide border transition-all duration-150 cursor-pointer shrink-0',
        styles.chip,
        className
    );

    if (href) {
        return <Link href={href} className={chipClass}>{inner}</Link>;
    }
    return <span className={chipClass}>{inner}</span>;
}
