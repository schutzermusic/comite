'use client';

import { ReactNode } from 'react';
import { GlobeContextLayer } from './GlobeContextLayer';
import { cn } from '@/lib/utils';

interface HeroSectionProps {
    children: ReactNode;
    className?: string;
    /** Enable globe interaction (clicking Brazil triggers zoom) */
    interactive?: boolean;
    /** Minimum height of the hero section */
    minHeight?: string;
}

/**
 * HeroSection
 * 
 * A container for the "first fold" of the dashboard that includes:
 * - The interactive globe as a background context layer
 * - Header content (KPIs, title, etc.)
 * 
 * ARCHITECTURE:
 * - position: relative with overflow: hidden
 * - Globe is absolutely positioned within this container
 * - When user scrolls past this section, the globe fades out
 * 
 * This ensures:
 * - Globe does NOT pollute the rest of the page
 * - Globe is clickable within the hero area
 * - UI panels in children remain fully interactive
 */
export function HeroSection({
    children,
    className,
    interactive = true,
    minHeight = '85vh',
}: HeroSectionProps) {
    return (
        <section
            className={cn(
                // Container for the hero area with globe
                'relative overflow-hidden',
                className
            )}
            style={{
                minHeight,
            }}
        >
            {/* 
              GLOBE CONTEXT LAYER
              - Absolutely positioned within this section
              - Uses IntersectionObserver to fade out when scrolled away
              - z-index: 1 (below children which are z-10+)
            */}
            <GlobeContextLayer interactive={interactive} />

            {/* 
              CONTENT LAYER
              - z-index: 10 to be above the globe
              - pointer-events: auto for full interactivity
            */}
            <div className="relative z-10 pointer-events-auto">
                {children}
            </div>
        </section>
    );
}

export default HeroSection;
