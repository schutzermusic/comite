'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HudDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  /** Aceita nós para que o cabeçalho possa trazer código + chips de estado. */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  position?: 'right' | 'left';
  width?: string;
  className?: string;
  showCloseButton?: boolean;
  hideMainContent?: boolean;
  /** Sticky footer rendered below the scroll area (action buttons). */
  footer?: React.ReactNode;
  /** Extra buttons rendered in the header, to the left of the close button. */
  headerActions?: React.ReactNode;
  /** Content to the left of the title (e.g. client logo upload). */
  headerLeading?: React.ReactNode;
  /**
   * `compact` aperta cabeçalho, corpo e rodapé. Painéis operacionais densos —
   * onde a rolagem é o custo, não o respiro — usam esta densidade.
   */
  density?: 'comfortable' | 'compact';
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
  footer,
  headerActions,
  headerLeading,
  density = 'comfortable',
}: HudDrawerProps) {
  const compact = density === 'compact';
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const drawer = (
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
            className="fixed inset-0 z-[80] ig-backdrop"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: position === 'right' ? '100%' : '-100%', opacity: 0.8 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: position === 'right' ? '100%' : '-100%', opacity: 0.8 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            // Width via CSS var so mobile can go full-width while sm+ keeps the
            // caller-provided width (clamped to 90vw as before).
            style={{ '--hud-drawer-w': width } as React.CSSProperties}
            data-elev="3"
            className={cn(
              'fixed inset-y-0 z-[81] flex h-[100dvh] max-h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden',
              'w-full sm:w-[min(var(--hud-drawer-w),90vw)]',
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
              <div
                className={cn(
                  'flex shrink-0 items-start justify-between border-b border-ig-border',
                  compact ? 'px-3.5 py-3' : 'p-4',
                )}
              >
                <div className={cn('flex min-w-0 flex-1 items-start', compact ? 'gap-2.5' : 'gap-3')}>
                  {headerLeading}
                  <div className="min-w-0 flex-1">
                    {title && (
                      <h2
                        className={cn(
                          'font-semibold tracking-wide text-ig-fg-strong',
                          compact ? 'truncate text-[15px] leading-tight' : 'text-lg',
                        )}
                        title={compact && typeof title === 'string' ? title : undefined}
                      >
                        {title}
                      </h2>
                    )}
                    {subtitle && (
                      compact
                        ? <div className="mt-1.5 min-w-0">{subtitle}</div>
                        : <p className="text-sm text-ig-fg-muted mt-0.5">{subtitle}</p>
                    )}
                  </div>
                </div>
                {(headerActions || showCloseButton) && (
                  <div className="ml-3 flex flex-shrink-0 items-center gap-2">
                    {headerActions}
                    {showCloseButton && (
                      <button
                        onClick={onClose}
                        className="flex items-center justify-center w-8 h-8 rounded-lg bg-ig-panel border border-ig-border text-ig-fg-muted hover:text-ig-fg-strong hover:bg-ig-panel-hover transition-colors flex-shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div
                className={cn(
                  'min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch]',
                  compact ? 'px-3.5 py-3.5' : 'p-4',
                )}
              >
                {children}
              </div>

              {footer && (
                <div
                  className={cn(
                    'shrink-0 border-t border-ig-border',
                    compact
                      ? 'px-3.5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
                      : 'p-4 pb-[max(1rem,env(safe-area-inset-bottom))]',
                  )}
                >
                  {footer}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(drawer, document.body);
}
