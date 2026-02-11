'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface GlobeTraceLinesProps {
    /** Screen coordinates of the panel anchor point */
    panelPosition: { x: number; y: number } | null;
    /** Screen coordinates of the state on the globe */
    statePosition: { x: number; y: number } | null;
    /** Whether to show the trace lines */
    visible: boolean;
    className?: string;
}

/**
 * GlobeTraceLines
 * 
 * SVG overlay that draws thin bezier curves connecting
 * the state contract panel to the selected state on the globe.
 * Creates a "system correlation" aesthetic.
 */
export function GlobeTraceLines({
    panelPosition,
    statePosition,
    visible,
    className,
}: GlobeTraceLinesProps) {
    const [pathD, setPathD] = useState<string>('');

    useEffect(() => {
        if (!panelPosition || !statePosition) {
            setPathD('');
            return;
        }

        // Calculate bezier control points for a smooth curve
        const startX = panelPosition.x;
        const startY = panelPosition.y;
        const endX = statePosition.x;
        const endY = statePosition.y;

        // Control points for smooth curve
        const midX = (startX + endX) / 2;
        const cp1X = startX - 40;
        const cp1Y = startY;
        const cp2X = midX;
        const cp2Y = endY + 20;

        const d = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
        setPathD(d);
    }, [panelPosition, statePosition]);

    if (!visible || !pathD) return null;

    return (
        <AnimatePresence>
            <motion.svg
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className={`fixed inset-0 pointer-events-none z-40 ${className}`}
                style={{ width: '100vw', height: '100vh' }}
            >
                <defs>
                    {/* Gradient for the line */}
                    <linearGradient id="traceGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="rgba(6, 182, 212, 0.5)" />
                        <stop offset="50%" stopColor="rgba(6, 182, 212, 0.3)" />
                        <stop offset="100%" stopColor="rgba(6, 182, 212, 0.15)" />
                    </linearGradient>

                    {/* Glow filter */}
                    <filter id="traceGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                {/* Main trace line */}
                <motion.path
                    d={pathD}
                    fill="none"
                    stroke="url(#traceGradient)"
                    strokeWidth="1"
                    strokeDasharray="6 4"
                    filter="url(#traceGlow)"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                />

                {/* Start point (panel side) */}
                {panelPosition && (
                    <motion.circle
                        cx={panelPosition.x}
                        cy={panelPosition.y}
                        r="3"
                        fill="rgba(6, 182, 212, 0.6)"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.2, duration: 0.3 }}
                    />
                )}

                {/* End point (globe side) */}
                {statePosition && (
                    <motion.circle
                        cx={statePosition.x}
                        cy={statePosition.y}
                        r="4"
                        fill="rgba(6, 182, 212, 0.4)"
                        stroke="rgba(6, 182, 212, 0.6)"
                        strokeWidth="1"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.4, duration: 0.3 }}
                    >
                        {/* Pulse animation */}
                        <animate
                            attributeName="r"
                            values="4;6;4"
                            dur="2s"
                            repeatCount="indefinite"
                        />
                        <animate
                            attributeName="opacity"
                            values="1;0.5;1"
                            dur="2s"
                            repeatCount="indefinite"
                        />
                    </motion.circle>
                )}
            </motion.svg>
        </AnimatePresence>
    );
}

export default GlobeTraceLines;
