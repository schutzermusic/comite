'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

type GlobeViewState = 'GLOBAL_VIEW' | 'BRAZIL_FOCUS' | 'STATE_SELECTED';

interface GlobeModeChipProps {
    viewState: GlobeViewState;
    onBackClick: () => void;
    className?: string;
}

const modeLabels: Record<GlobeViewState, string> = {
    GLOBAL_VIEW: 'Global',
    BRAZIL_FOCUS: 'Brasil',
    STATE_SELECTED: 'Estado',
};

/**
 * GlobeModeChip
 * 
 * A compact indicator showing the current globe view mode.
 * Provides a "Back" button to return to previous view state.
 */
export function GlobeModeChip({
    viewState,
    onBackClick,
    className
}: GlobeModeChipProps) {
    const showBackButton = viewState !== 'GLOBAL_VIEW';

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
                'flex items-center gap-2',
                'px-3 py-1.5',
                'rounded-full',
                'backdrop-blur-xl',
                'border border-white/[0.08]',
                'bg-black/40',
                className
            )}
            style={{
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            }}
        >
            <Globe className="w-3.5 h-3.5 text-cyan-400/70" />

            <span className="text-[11px] font-medium text-white/70">
                Mode:
            </span>

            <span className="text-[11px] font-semibold text-white">
                {modeLabels[viewState]}
            </span>

            <AnimatePresence>
                {showBackButton && (
                    <motion.button
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: 'auto' }}
                        exit={{ opacity: 0, width: 0 }}
                        onClick={onBackClick}
                        className={cn(
                            'flex items-center gap-1',
                            'ml-1 pl-2 border-l border-white/10',
                            'text-[11px] text-white/50 hover:text-white/80',
                            'transition-colors'
                        )}
                    >
                        <ArrowLeft className="w-3 h-3" />
                        <span>Voltar</span>
                    </motion.button>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

export default GlobeModeChip;
