'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, MapPin } from 'lucide-react';
import { STATE_PROJECT_DATA, formatCompact } from '@/data/geo/brazil-operational-data';
import { cn } from '@/lib/utils';

// Dynamic import EnterpriseGlobe to avoid SSR issues with WebGL
const EnterpriseGlobe = dynamic(
    () => import('@/components/globe/EnterpriseGlobe').then((mod) => mod.EnterpriseGlobe),
    {
        ssr: false,
        loading: () => (
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="relative w-20 h-20">
                    <div className="absolute inset-0 border-2 border-cyan-500/20 rounded-full" />
                    <div className="absolute inset-0 border-2 border-cyan-500/50 border-t-transparent rounded-full animate-spin" />
                </div>
            </div>
        ),
    }
);

interface GlobeContextLayerProps {
    className?: string;
    /** Enable full interactive mode with state machine navigation */
    interactive?: boolean;
}

/**
 * GlobeContextLayer
 * 
 * Globe that exists ONLY in the Hero area of the dashboard.
 * Uses IntersectionObserver to:
 * - Fade out when scrolling past the hero area
 * - Disable pointer events when not visible
 * - Re-enable when scrolling back to top
 * 
 * ARCHITECTURE:
 * - Position: absolute within the HeroSection (NOT fixed)
 * - Only covers the right portion of the viewport (doesn't block left panels)
 * - z-index: 1 (below UI panels which are z-10+)
 * 
 * Click behavior:
 * - Brazil polygons are pickable via react-globe.gl
 * - Click triggers flyTo zoom + BRAZIL_FOCUS state
 */
export function GlobeContextLayer({ className, interactive = true }: GlobeContextLayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(true);
    const [visibilityRatio, setVisibilityRatio] = useState(1);

    // Calculate metrics
    const totalValue = STATE_PROJECT_DATA.reduce((sum, state) => sum + state.totalContracted, 0);
    const totalContracts = STATE_PROJECT_DATA.reduce((sum, state) => sum + state.contractsCount, 0);
    const activeStates = STATE_PROJECT_DATA.length;

    // Mock sparkline data
    const sparklineData = [380, 395, 412, 425, 438, 455, 516];
    const deltaPercent = ((sparklineData[sparklineData.length - 1] - sparklineData[0]) / sparklineData[0] * 100).toFixed(1);

    // IntersectionObserver to track visibility
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    // Update visibility based on intersection ratio
                    setVisibilityRatio(entry.intersectionRatio);
                    setIsVisible(entry.intersectionRatio > 0.1);
                });
            },
            {
                // Track visibility with fine granularity
                threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
                // Start tracking slightly before element enters viewport
                rootMargin: '50px 0px -10% 0px',
            }
        );

        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, []);

    // Calculate opacity based on visibility ratio (fade out as user scrolls)
    const opacity = Math.min(1, visibilityRatio * 1.5);

    return (
        <div
            ref={containerRef}
            className={cn(
                // RELATIVE positioning - contained within parent HeroSection
                'absolute inset-0 overflow-hidden',
                // Pointer events depend on visibility
                isVisible ? 'pointer-events-none' : 'pointer-events-none',
                className
            )}
            style={{
                zIndex: 1, // Below UI panels
            }}
        >
            {/* 
              GLOBE CONTAINER
              - Positioned to the right side only (doesn't block left UI)
              - Partially outside viewport for cinematic effect
            */}
            <motion.div
                className="absolute"
                style={{
                    // Position: top-right, partially off-screen
                    top: '0',
                    right: '-8%',
                    width: 'min(80vh, 850px)',
                    height: 'min(80vh, 850px)',
                    // Pointer events enabled only when visible
                    pointerEvents: isVisible && interactive ? 'auto' : 'none',
                }}
                animate={{
                    opacity: opacity,
                    scale: 0.95 + (visibilityRatio * 0.05),
                }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
            >
                {/* Atmospheric rim glow - purely decorative, no pointer events */}
                <div
                    className="absolute inset-0 rounded-full pointer-events-none"
                    style={{
                        background: 'radial-gradient(circle at center, transparent 35%, rgba(6, 182, 212, 0.06) 50%, rgba(6, 182, 212, 0.12) 60%, transparent 75%)',
                        filter: 'blur(30px)',
                        transform: 'scale(1.3)',
                        opacity: opacity,
                    }}
                />

                {/* Enterprise Globe - receives pointer events for Brazil picking */}
                <EnterpriseGlobe
                    className="w-full h-full"
                    contextMode={!interactive}
                    interactive={interactive && isVisible}
                />
            </motion.div>

            {/* Summary Overlay Panel - compact metrics display */}
            <AnimatePresence>
                {!interactive && isVisible && (
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: opacity, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        transition={{ delay: 0.3, duration: 0.5, ease: 'easeOut' }}
                        className="absolute pointer-events-auto"
                        style={{
                            right: 'min(calc(40vh + 100px), calc(45vw))',
                            top: '120px',
                            zIndex: 2,
                        }}
                    >
                        {/* Trace line connecting to globe */}
                        <svg
                            className="absolute pointer-events-none"
                            style={{
                                width: '90px',
                                height: '70px',
                                right: '-85px',
                                bottom: '15px',
                            }}
                        >
                            <defs>
                                <linearGradient id="globeTraceLine" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="rgba(6, 182, 212, 0.5)" />
                                    <stop offset="100%" stopColor="rgba(6, 182, 212, 0.1)" />
                                </linearGradient>
                            </defs>
                            <path
                                d="M 0 35 Q 45 35 80 60"
                                stroke="url(#globeTraceLine)"
                                strokeWidth="1.5"
                                fill="none"
                                strokeDasharray="5 3"
                            />
                            <circle cx="80" cy="60" r="4" fill="rgba(6, 182, 212, 0.5)" />
                        </svg>

                        {/* Panel content */}
                        <div
                            className={cn(
                                'relative px-4 py-3',
                                'rounded-xl',
                                'backdrop-blur-xl',
                                'border border-white/[0.1]',
                                'bg-gradient-to-br from-black/50 via-black/40 to-black/50',
                            )}
                            style={{
                                width: '180px',
                                boxShadow: '0 0 40px rgba(6, 182, 212, 0.1), inset 0 1px 0 rgba(255,255,255,0.05)',
                            }}
                        >
                            {/* Title */}
                            <div className="flex items-center gap-1.5 mb-2">
                                <MapPin className="w-3 h-3 text-cyan-400/80" />
                                <span className="text-[10px] uppercase tracking-wider text-white/60 font-medium">
                                    Presença Operacional
                                </span>
                            </div>

                            {/* Key Metric */}
                            <div className="flex items-baseline gap-2 mb-2">
                                <span className="text-xl font-bold text-white tracking-tight">
                                    {formatCompact(totalValue)}
                                </span>
                                <span className="flex items-center gap-0.5 text-[10px] text-emerald-400 font-medium">
                                    <TrendingUp className="w-2.5 h-2.5" />
                                    +{deltaPercent}%
                                </span>
                            </div>

                            {/* Mini Sparkline */}
                            <div className="h-7 mb-2">
                                <svg width="100%" height="100%" viewBox="0 0 140 28" preserveAspectRatio="none">
                                    <defs>
                                        <linearGradient id="heroSparkGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="rgba(6, 182, 212, 0.35)" />
                                            <stop offset="100%" stopColor="rgba(6, 182, 212, 0)" />
                                        </linearGradient>
                                    </defs>
                                    {/* Area fill */}
                                    <path
                                        d={`M 0 ${28 - (sparklineData[0] / 600) * 28} ${sparklineData.map((val, i) => `L ${(i / (sparklineData.length - 1)) * 140} ${28 - (val / 600) * 28}`).join(' ')} L 140 28 L 0 28 Z`}
                                        fill="url(#heroSparkGradient)"
                                    />
                                    {/* Line */}
                                    <path
                                        d={`M 0 ${28 - (sparklineData[0] / 600) * 28} ${sparklineData.map((val, i) => `L ${(i / (sparklineData.length - 1)) * 140} ${28 - (val / 600) * 28}`).join(' ')}`}
                                        stroke="rgba(6, 182, 212, 0.7)"
                                        strokeWidth="2"
                                        fill="none"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                    {/* End dot */}
                                    <circle
                                        cx="140"
                                        cy={28 - (sparklineData[sparklineData.length - 1] / 600) * 28}
                                        r="3"
                                        fill="#06b6d4"
                                    />
                                </svg>
                            </div>

                            {/* Stats row */}
                            <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
                                <div className="text-center">
                                    <div className="text-sm font-semibold text-white">{activeStates}</div>
                                    <div className="text-[9px] text-white/50">Estados</div>
                                </div>
                                <div className="w-px h-6 bg-white/[0.08]" />
                                <div className="text-center">
                                    <div className="text-sm font-semibold text-white">{totalContracts}</div>
                                    <div className="text-[9px] text-white/50">Contratos</div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Click hint - appears in interactive mode */}
            <AnimatePresence>
                {interactive && isVisible && visibilityRatio > 0.5 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 0.8, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ delay: 1, duration: 0.5 }}
                        className="absolute bottom-8 right-8 pointer-events-none"
                        style={{ zIndex: 2 }}
                    >
                        <div className="px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-cyan-500/20">
                            <span className="text-xs text-white/60">
                                Clique no Brasil para explorar estados
                            </span>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default GlobeContextLayer;
