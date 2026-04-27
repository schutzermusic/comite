'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HudDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  position?: 'right' | 'left';
  width?: string;
  className?: string;
  showCloseButton?: boolean;
  hideMainContent?: boolean;
}

export function HudDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  position = 'right',
  width = '420px',
  className,
  showCloseButton = true,
}: HudDrawerProps) {
  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-50 ig-backdrop"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: position === 'right' ? '100%' : '-100%', opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: position === 'right' ? '100%' : '-100%', opacity: 0.8 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            style={{ width, maxWidth: '90vw' }}
            data-elev="3"
            className={cn(
              'fixed top-0 bottom-0 z-50 flex min-h-0 min-w-0 flex-col',
              position === 'right' ? 'right-0' : 'left-0',
              'hud-drawer-surface ig-glass',
              className
            )}
          >
            <span data-ig-noise="" />
            <span data-ig-specular="" />
            <div
              data-ig-content=""
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              {/* Header */}
              <div className="flex shrink-0 items-start justify-between border-b border-ig-border p-4">
                <div className="flex-1 min-w-0">
                  {title && (
                    <h2 className="text-lg font-semibold text-ig-fg-strong tracking-wide">
                      {title}
                    </h2>
                  )}
                  {subtitle && (
                    <p className="text-sm text-ig-fg-muted mt-0.5">{subtitle}</p>
                  )}
                </div>
                {showCloseButton && (
                  <button
                    onClick={onClose}
                    className="flex items-center justify-center w-8 h-8 rounded-lg bg-ig-panel border border-ig-border text-ig-fg-muted hover:text-ig-fg-strong hover:bg-ig-panel-hover transition-colors ml-3 flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain p-4 [-webkit-overflow-scrolling:touch]">
                {children}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
