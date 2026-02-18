'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Minimize2, Maximize2, Pin, PinOff, Eye, EyeOff, GripVertical } from 'lucide-react';
import Link from 'next/link';
import type { WidgetState } from '@/hooks/useHudLayout';
import { cn } from '@/lib/utils';

interface HudWidgetProps {
    id: string;
    title: string;
    icon: React.ElementType;
    compactContent: React.ReactNode;
    detailContent: React.ReactNode;
    deepLinkHref?: string;
    deepLinkLabel?: string;
    widgetState: WidgetState;
    onUpdate: (patch: Partial<WidgetState>) => void;
    className?: string;
    /** Accent color class for the widget's dot indicator */
    accentColor?: string;
}

export function HudWidget({
    id,
    title,
    icon: Icon,
    compactContent,
    detailContent,
    deepLinkHref,
    deepLinkLabel = 'Ver tudo',
    widgetState,
    onUpdate,
    className,
    accentColor = 'bg-emerald-400',
}: HudWidgetProps) {
    const { pinned, compact, autoHide } = widgetState;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={cn(
                'hud-widget',
                autoHide && !pinned && 'hud-widget-auto-hide',
                className
            )}
        >
            {/* Widget Header */}
            <div className="relative z-10 flex items-center justify-between px-3.5 pt-3 pb-2">
                <div className="flex items-center gap-2 min-w-0">
                    <div className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', accentColor)} />
                    <Icon className="w-3.5 h-3.5 text-orion-text-muted flex-shrink-0" />
                    <span className="text-[11px] font-medium text-orion-text-secondary uppercase tracking-wider truncate">
                        {title}
                    </span>
                </div>

                {/* Widget Controls */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                        onClick={() => onUpdate({ autoHide: !autoHide })}
                        className="p-1 rounded hover:bg-glass-light transition-colors"
                        title={autoHide ? 'Sempre visível' : 'Auto-ocultar'}
                    >
                        {autoHide ? (
                            <EyeOff className="w-3 h-3 text-orion-text-muted" />
                        ) : (
                            <Eye className="w-3 h-3 text-orion-text-muted" />
                        )}
                    </button>
                    <button
                        onClick={() => onUpdate({ pinned: !pinned })}
                        className="p-1 rounded hover:bg-glass-light transition-colors"
                        title={pinned ? 'Desfixar' : 'Fixar'}
                    >
                        {pinned ? (
                            <Pin className="w-3 h-3 text-emerald-400" />
                        ) : (
                            <PinOff className="w-3 h-3 text-orion-text-muted" />
                        )}
                    </button>
                    <button
                        onClick={() => onUpdate({ compact: !compact })}
                        className="p-1 rounded hover:bg-glass-light transition-colors"
                        title={compact ? 'Expandir' : 'Compactar'}
                    >
                        {compact ? (
                            <Maximize2 className="w-3 h-3 text-orion-text-muted" />
                        ) : (
                            <Minimize2 className="w-3 h-3 text-orion-text-muted" />
                        )}
                    </button>
                </div>
            </div>

            {/* Widget Content */}
            <div className="relative z-10 px-3.5 pb-3">
                <motion.div
                    key={compact ? 'compact' : 'detail'}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                >
                    {compact ? compactContent : detailContent}
                </motion.div>

                {/* Deep Link CTA */}
                {deepLinkHref && (
                    <Link
                        href={deepLinkHref}
                        className="mt-2.5 flex items-center gap-1 text-[10px] font-medium text-emerald-400/70 hover:text-emerald-400 transition-colors"
                    >
                        <span>{deepLinkLabel}</span>
                        <span className="text-[8px]">→</span>
                    </Link>
                )}
            </div>
        </motion.div>
    );
}
