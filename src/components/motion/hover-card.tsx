'use client';

import React, { forwardRef, HTMLAttributes } from 'react';
import { motion, MotionProps } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  cardHoverVariants,
  kpiCardHoverVariants,
  containerHoverVariants,
} from '@/lib/motion-presets';

// =============================================================================
// TYPES
// =============================================================================

type HoverPreset = 'card' | 'kpi' | 'container' | 'none';

interface HoverCardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Hover animation preset
   * - card: Standard subtle lift (-5px, scale 1.01)
   * - kpi: More pronounced for KPI cards (-6px, scale 1.015)
   * - container: Subtle for larger containers (-4px, scale 1.005)
   * - none: No animation
   */
  preset?: HoverPreset;
  /**
   * Enable light sweep effect on hover
   */
  lightSweep?: boolean;
  /**
   * Enable tap animation
   */
  enableTap?: boolean;
  /**
   * Framer Motion props
   */
  motionProps?: MotionProps;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * HoverCard - Premium motion wrapper for cards
 * Provides smooth hover animations with Framer Motion
 */
const HoverCard = forwardRef<HTMLDivElement, HoverCardProps>(
  (
    {
      children,
      className,
      preset = 'card',
      lightSweep = false,
      enableTap = false,
      motionProps,
      ...props
    },
    ref
  ) => {
    const variantsMap = {
      card: cardHoverVariants,
      kpi: kpiCardHoverVariants,
      container: containerHoverVariants,
      none: {},
    };

    const variants = variantsMap[preset];

    if (preset === 'none') {
      return (
        <div ref={ref} className={className} {...props}>
          {children}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        className={cn(
          'relative',
          lightSweep && 'light-sweep-container',
          className
        )}
        initial="rest"
        whileHover="hover"
        whileTap={enableTap ? 'tap' : undefined}
        variants={variants}
        {...motionProps}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

HoverCard.displayName = 'HoverCard';

// =============================================================================
// SPECIALIZED VARIANTS
// =============================================================================

/**
 * KpiHoverCard - Optimized for KPI cards in the top band
 */
const KpiHoverCard = forwardRef<
  HTMLDivElement,
  Omit<HoverCardProps, 'preset'>
>((props, ref) => (
  <HoverCard ref={ref} preset="kpi" {...props} />
));

KpiHoverCard.displayName = 'KpiHoverCard';

/**
 * ContainerHoverCard - For larger container cards
 */
const ContainerHoverCard = forwardRef<
  HTMLDivElement,
  Omit<HoverCardProps, 'preset'>
>((props, ref) => (
  <HoverCard ref={ref} preset="container" {...props} />
));

ContainerHoverCard.displayName = 'ContainerHoverCard';

// =============================================================================
// EXPORTS
// =============================================================================

export { HoverCard, KpiHoverCard, ContainerHoverCard };
export type { HoverCardProps };





















