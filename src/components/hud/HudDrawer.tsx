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
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: position === 'right' ? '100%' : '-100%', opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: position === 'right' ? '100%' : '-100%', opacity: 0.8 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            style={{ width, maxWidth: '90vw' }}
            className={cn(
              'fixed top-0 bottom-0 z-50',
              position === 'right' ? 'right-0' : 'left-0',
              // Glass panel styling
              'hud-drawer-surface',
              'bg-gradient-to-b from-[rgba(8,28,22,0.95)] to-[rgba(4,18,14,0.98)]',
              'backdrop-blur-[32px]',
              'border-l border-white/[0.08]',
              'shadow-[-8px_0_48px_rgba(0,0,0,0.55)]',
              'flex flex-col',
              className
            )}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-4 border-b border-white/[0.08]">
              <div className="flex-1 min-w-0">
                {title && (
                  <h2 className="text-lg font-semibold text-white tracking-wide">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="text-sm text-white/50 mt-0.5">{subtitle}</p>
                )}
              </div>
              {showCloseButton && (
                <button
                  onClick={onClose}
                  className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.08] transition-colors ml-3 flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
