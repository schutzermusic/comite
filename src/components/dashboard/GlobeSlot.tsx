'use client';

import { useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { MapPin, TrendingUp, ExternalLink } from 'lucide-react';
import { STATE_PROJECT_DATA, formatCompact } from '@/data/geo/brazil-operational-data';
import { cn } from '@/lib/utils';

// Dynamic import EnterpriseGlobe to avoid SSR issues with WebGL
const EnterpriseGlobe = dynamic(
    () => import('@/components/globe/EnterpriseGlobe').then((mod) => mod.EnterpriseGlobe),
    {
        ssr: false,
        loading: () => (
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-2 border-cyan-500/20 rounded-full" />
                    <div className="absolute inset-0 border-2 border-cyan-500/50 border-t-transparent rounded-full animate-spin" />
                </div>
            </div>
        ),
    }
);

interface GlobeSlotProps {
    className?: string;
    /** Minimum height to match adjacent panel */
    minHeight?: number | string;
}

/**
 * GlobeSlot
 * 
 * A contained slot for the interactive globe that sits BESIDE the Saúde Financeira panel.
 * The globe is clipped to this container and does NOT pollute other areas of the page.
 * 
 * Features:
 * - Visually contained with gradient mask edges
 * - Clickable Brazil triggers zoom/flyTo
 * - Does not intercept clicks outside this slot
 * - Blends into dashboard background with gradient fades
 */
export function GlobeSlot({ className, minHeight = 420 }: GlobeSlotProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    // Calculate aggregate metrics
    const totalValue = STATE_PROJECT_DATA.reduce((sum, state) => sum + state.totalContracted, 0);
    const totalContracts = STATE_PROJECT_DATA.reduce((sum, state) => sum + state.contractsCount, 0);
    const activeStates = STATE_PROJECT_DATA.length;

    // Mock trend
    const deltaPercent = 12.5;

    return (
        <div
            ref={containerRef}
            className={cn(
                // Container: relative, overflow hidden to clip globe
                'relative overflow-hidden rounded-2xl',
                // Background that matches dashboard theme
                'bg-gradient-to-br from-[#0a0f0d]/80 via-[#0c1311]/70 to-[#0a0f0d]/80',
                // Subtle border
                'border border-white/[0.06]',
                className
            )}
            style={{
                minHeight: typeof minHeight === 'number' ? `${minHeight}px` : minHeight,
            }}
        >
            {/* 
              GRADIENT MASK OVERLAYS
              These create soft fades on edges so globe blends into background
              All overlays have pointer-events: none
            */}
            
            {/* Left edge fade - stronger to blend with Saúde Financeira */}
            <div 
                className="absolute inset-y-0 left-0 w-24 pointer-events-none z-20"
                style={{
                    background: 'linear-gradient(to right, rgba(10, 15, 13, 0.95) 0%, rgba(10, 15, 13, 0.7) 40%, transparent 100%)',
                }}
            />
            
            {/* Top edge fade */}
            <div 
                className="absolute inset-x-0 top-0 h-16 pointer-events-none z-20"
                style={{
                    background: 'linear-gradient(to bottom, rgba(10, 15, 13, 0.8) 0%, transparent 100%)',
                }}
            />
            
            {/* Bottom edge fade */}
            <div 
                className="absolute inset-x-0 bottom-0 h-20 pointer-events-none z-20"
                style={{
                    background: 'linear-gradient(to top, rgba(10, 15, 13, 0.9) 0%, rgba(10, 15, 13, 0.5) 50%, transparent 100%)',
                }}
            />
            
            {/* Right edge fade - subtle */}
            <div 
                className="absolute inset-y-0 right-0 w-12 pointer-events-none z-20"
                style={{
                    background: 'linear-gradient(to left, rgba(10, 15, 13, 0.6) 0%, transparent 100%)',
                }}
            />

            {/* Atmospheric glow behind globe */}
            <div 
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: 'radial-gradient(ellipse 80% 80% at 60% 50%, rgba(6, 182, 212, 0.08) 0%, transparent 60%)',
                }}
            />

            {/* 
              GLOBE CONTAINER
              Positioned to show globe centered/right within the slot
              Globe extends slightly beyond visible area for cinematic effect
            */}
            <div 
                className="absolute inset-0 pointer-events-auto"
                style={{
                    // Shift globe slightly right so center is in the right portion
                    left: '5%',
                    width: '110%',
                    height: '120%',
                    top: '-10%',
                }}
            >
                <EnterpriseGlobe
                    className="w-full h-full"
                    contextMode={false}
                    interactive={true}
                />
            </div>

            {/* 
              INFO OVERLAY - Top left corner
              Shows key metrics about operational presence
            */}
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className="absolute top-4 left-4 z-30 pointer-events-none"
            >
                <div className="flex items-center gap-2 mb-2">
                    <MapPin className="w-3.5 h-3.5 text-cyan-400/80" />
                    <span className="text-[11px] uppercase tracking-wider text-white/60 font-medium">
                        Presença Operacional
                    </span>
                </div>
                <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-white tracking-tight">
                        {activeStates}
                    </span>
                    <span className="text-sm text-white/50">estados</span>
                </div>
            </motion.div>

            {/* 
              METRICS OVERLAY - Bottom area
              Shows value and contract count
            */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="absolute bottom-4 left-4 right-4 z-30 pointer-events-none"
            >
                <div className="flex items-end justify-between">
                    <div>
                        <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-xl font-bold text-white">
                                {formatCompact(totalValue)}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                                <TrendingUp className="w-3 h-3" />
                                +{deltaPercent}%
                            </span>
                        </div>
                        <div className="text-xs text-white/40">
                            {totalContracts} contratos ativos
                        </div>
                    </div>
                    
                    {/* Hint text */}
                    <div className="text-[10px] text-white/30 flex items-center gap-1">
                        <span>Clique para explorar</span>
                        <ExternalLink className="w-3 h-3" />
                    </div>
                </div>
            </motion.div>

            {/* Corner accent - top right */}
            <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none z-10">
                <svg width="100%" height="100%" viewBox="0 0 80 80" fill="none">
                    <path
                        d="M80 0 L80 20 Q80 5 65 5 L45 5"
                        stroke="rgba(6, 182, 212, 0.3)"
                        strokeWidth="1"
                        fill="none"
                    />
                    <circle cx="78" cy="2" r="2" fill="rgba(6, 182, 212, 0.5)" />
                </svg>
            </div>

            {/* Corner accent - bottom left */}
            <div className="absolute bottom-0 left-0 w-16 h-16 pointer-events-none z-10">
                <svg width="100%" height="100%" viewBox="0 0 64 64" fill="none">
                    <path
                        d="M0 64 L0 48 Q0 58 12 58 L28 58"
                        stroke="rgba(6, 182, 212, 0.2)"
                        strokeWidth="1"
                        fill="none"
                    />
                </svg>
            </div>
        </div>
    );
}

export default GlobeSlot;
