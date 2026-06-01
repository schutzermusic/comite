'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface HudPageLayoutProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}

const MAX_WIDTHS = {
  sm: 'max-w-3xl',
  md: 'max-w-4xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
  '2xl': 'max-w-[1800px]',
  full: 'max-w-none',
};

/**
 * HudPageLayout — thin wrapper that provides consistent padding/max-width.
 * Does NOT add its own background — the MainLayout already provides
 * ImmersiveSpatialBackground as a fixed layer behind all pages.
 */
export function HudPageLayout({
  children,
  className,
  contentClassName,
  maxWidth = '2xl',
}: HudPageLayoutProps) {
  return (
    // overflow-x-hidden at the page-layout root is the single point where
    // we clip any rogue child width. The parent <main> in (main)/layout.tsx
    // still scrolls vertically; horizontal scroll must live INSIDE charts/tables.
    <div className={cn('min-h-full relative w-full min-w-0 overflow-x-hidden', className)}>
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'relative z-10',
          'p-4 md:p-6 lg:p-8',
          'mx-auto',
          // min-w-0 + w-full so grid children can shrink rather than push the page wider.
          'w-full min-w-0',
          MAX_WIDTHS[maxWidth],
          'space-y-6',
          contentClassName,
        )}
      >
        {children}
      </motion.div>
    </div>
  );
}
