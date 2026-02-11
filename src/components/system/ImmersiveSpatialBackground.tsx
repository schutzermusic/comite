'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface ImmersiveSpatialBackgroundProps {
    children?: React.ReactNode;
    className?: string;
    /** Globe intensity (0-1) */
    intensity?: number;
}

/**
 * Immersive Spatial Background - Apple Vision Pro Aesthetic
 * 
 * Creates a full-viewport Earth environment with:
 * - Gigantic Earth shifted right, South America dominant
 * - Dramatic cinematic lighting with city lights
 * - Atmospheric glow and depth effects
 * 
 * All UI elements float above this as glassmorphic panels.
 */
export function ImmersiveSpatialBackground({
    children,
    className,
    intensity = 1,
}: ImmersiveSpatialBackgroundProps) {
    return (
        <div 
            className={cn(
                // Use fixed positioning to stay anchored during scroll
                // pointer-events-none ensures this doesn't block interactions
                'fixed inset-0 overflow-hidden pointer-events-none', 
                className
            )}
        >
            {/* ================================================================== */}
            {/* LAYER 0: Deep Space Backdrop */}
            {/* Pure dark gradient - the void of space */}
            {/* ================================================================== */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    background: `
            radial-gradient(ellipse 150% 100% at 70% 50%, 
              #050a08 0%, 
              #030605 30%,
              #010202 60%,
              #000000 100%
            )
          `,
                    zIndex: 0,
                }}
            />

            {/* ================================================================== */}
            {/* LAYER 1: Subtle Star Field (optional ambient) */}
            {/* ================================================================== */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    backgroundImage: `
            radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.15), transparent),
            radial-gradient(1px 1px at 40px 70px, rgba(255,255,255,0.1), transparent),
            radial-gradient(1px 1px at 50px 160px, rgba(255,255,255,0.12), transparent),
            radial-gradient(1px 1px at 90px 40px, rgba(255,255,255,0.08), transparent),
            radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.1), transparent),
            radial-gradient(1px 1px at 160px 120px, rgba(255,255,255,0.06), transparent)
          `,
                    backgroundSize: '200px 200px',
                    opacity: intensity * 0.4,
                    zIndex: 1,
                }}
            />


            {/* ================================================================== */}
            {/* LAYER 3: Ambient Fill Light */}
            {/* Subtle green glow that reflects onto glass panels */}
            {/* ================================================================== */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    background: `
            radial-gradient(ellipse 80% 60% at 70% 70%, 
              rgba(16, 185, 129, 0.04) 0%, 
              transparent 50%
            )
          `,
                    opacity: intensity,
                    zIndex: 3,
                }}
            />

            {/* Secondary ambient - top edge */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    background: `
            radial-gradient(ellipse 100% 40% at 50% -10%, 
              rgba(6, 182, 212, 0.03) 0%, 
              transparent 60%
            )
          `,
                    opacity: intensity,
                    zIndex: 3,
                }}
            />

            {/* ================================================================== */}
            {/* LAYER 4: Vignette for Depth */}
            {/* Darkens edges to focus attention on content */}
            {/* ================================================================== */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    background: `
            radial-gradient(ellipse 100% 100% at 50% 50%, 
              transparent 30%, 
              rgba(0, 0, 0, 0.3) 70%,
              rgba(0, 0, 0, 0.6) 100%
            )
          `,
                    opacity: intensity * 0.7,
                    zIndex: 4,
                }}
            />

            {/* Left edge vignette - stronger for sidebar area */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    background: `
            linear-gradient(90deg, 
              rgba(0, 0, 0, 0.4) 0%, 
              transparent 25%
            )
          `,
                    opacity: intensity * 0.8,
                    zIndex: 4,
                }}
            />

            {/* Children (if any) rendered above background layers */}
            {children && (
                <div className="relative z-10 pointer-events-auto">
                    {children}
                </div>
            )}
        </div>
    );
}

export default ImmersiveSpatialBackground;
