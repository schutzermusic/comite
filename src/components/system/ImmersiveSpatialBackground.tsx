'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/contexts/ThemeContext';

interface ImmersiveSpatialBackgroundProps {
    children?: React.ReactNode;
    className?: string;
    /** Globe intensity (0-1) */
    intensity?: number;
}

/**
 * Immersive Spatial Background
 *
 * Dark mode: Deep space environment with green ambient glow
 * Light mode: Soft neutral atmosphere with subtle lime focal glow
 */
export function ImmersiveSpatialBackground({
    children,
    className,
    intensity = 1,
}: ImmersiveSpatialBackgroundProps) {
    const { theme } = useTheme();
    const isLight = theme === 'light';

    return (
        <div
            className={cn(
                'fixed inset-0 overflow-hidden pointer-events-none',
                className
            )}
        >
            {/* LAYER 0: Base Backdrop */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    background: isLight
                        ? `linear-gradient(180deg, #f4f5f3 0%, #edeee9 40%, #f0f1ed 100%)`
                        : `radial-gradient(ellipse 150% 100% at 70% 50%,
                            #050a08 0%,
                            #030605 30%,
                            #010202 60%,
                            #000000 100%
                          )`,
                    zIndex: 0,
                }}
            />

            {/* LAYER 1: Subtle texture / stars */}
            {!isLight && (
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
            )}

            {/* LAYER 3: Ambient Fill Light */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    background: isLight
                        ? `radial-gradient(ellipse 70% 50% at 60% 40%,
                            rgba(186, 249, 26, 0.03) 0%,
                            transparent 60%
                          )`
                        : `radial-gradient(ellipse 80% 60% at 70% 70%,
                            rgba(16, 185, 129, 0.04) 0%,
                            transparent 50%
                          )`,
                    opacity: intensity,
                    zIndex: 3,
                }}
            />

            {/* Secondary ambient */}
            <div
                className="fixed inset-0 pointer-events-none"
                style={{
                    background: isLight
                        ? `radial-gradient(ellipse 80% 40% at 50% 0%,
                            rgba(186, 249, 26, 0.02) 0%,
                            transparent 60%
                          )`
                        : `radial-gradient(ellipse 100% 40% at 50% -10%,
                            rgba(6, 182, 212, 0.03) 0%,
                            transparent 60%
                          )`,
                    opacity: intensity,
                    zIndex: 3,
                }}
            />

            {/* LAYER 4: Vignette */}
            {!isLight && (
                <>
                    <div
                        className="fixed inset-0 pointer-events-none"
                        style={{
                            background: `radial-gradient(ellipse 100% 100% at 50% 50%,
                                transparent 30%,
                                rgba(0, 0, 0, 0.3) 70%,
                                rgba(0, 0, 0, 0.6) 100%
                            )`,
                            opacity: intensity * 0.7,
                            zIndex: 4,
                        }}
                    />
                    <div
                        className="fixed inset-0 pointer-events-none"
                        style={{
                            background: `linear-gradient(90deg,
                                rgba(0, 0, 0, 0.4) 0%,
                                transparent 25%
                            )`,
                            opacity: intensity * 0.8,
                            zIndex: 4,
                        }}
                    />
                </>
            )}

            {/* Light mode: subtle edge softening */}
            {isLight && (
                <div
                    className="fixed inset-0 pointer-events-none"
                    style={{
                        background: `radial-gradient(ellipse 100% 100% at 50% 50%,
                            transparent 60%,
                            rgba(237, 238, 233, 0.4) 100%
                        )`,
                        zIndex: 4,
                    }}
                />
            )}

            {children && (
                <div className="relative z-10 pointer-events-auto">
                    {children}
                </div>
            )}
        </div>
    );
}

export default ImmersiveSpatialBackground;
