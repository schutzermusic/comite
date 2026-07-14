'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HudModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  showCloseButton?: boolean;
  className?: string;
  footer?: React.ReactNode;
}

const SIZE_WIDTHS = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[90vw]',
};

export function HudModal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  size = 'md',
  showCloseButton = true,
  className,
  footer,
}: HudModalProps) {
  // Lock body scroll when modal is open
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 ig-backdrop"
          />

          {/* Modal */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            data-elev="4"
            className={cn(
              'relative flex w-full max-h-[calc(100dvh-2rem)] flex-col overflow-hidden',
              SIZE_WIDTHS[size],
              'hud-modal-surface ig-glass',
              className
            )}
          >
            <span data-ig-noise="" />
            <span data-ig-specular="" />
            <div data-ig-content="" className="flex min-h-0 flex-1 flex-col">
              {/* Header */}
              {(title || showCloseButton) && (
                <div className="flex shrink-0 items-start justify-between border-b border-ig-border p-5">
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
              )}

              {/* Content */}
              <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-5', !title && !showCloseButton && 'pt-6')}>
                {children}
              </div>

              {/* Footer */}
              {footer && (
                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ig-border bg-ig-raised p-5">
                  {footer}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
