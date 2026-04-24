'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface HudToastProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const VARIANT_ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle className="w-5 h-5 text-ig-success" />,
  error:   <AlertCircle className="w-5 h-5 text-ig-danger" />,
  warning: <AlertTriangle className="w-5 h-5 text-ig-warning" />,
  info:    <Info className="w-5 h-5 text-ig-accent" />,
};

const STATE_MAP: Record<ToastVariant, 'success' | 'critical' | 'warning' | 'default'> = {
  success: 'success',
  error:   'critical',
  warning: 'warning',
  info:    'default',
};

export function HudToast({
  isOpen,
  onClose,
  title,
  description,
  variant = 'info',
  duration = 5000,
  action,
}: HudToastProps) {
  // Auto-close after duration
  useEffect(() => {
    if (isOpen && duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, duration, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 50, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          data-elev="4"
          data-state={STATE_MAP[variant]}
          className={cn(
            'fixed bottom-6 right-6 z-[60]',
            'min-w-[320px] max-w-[420px]',
            'ig-glass',
          )}
        >
          <span data-ig-noise="" />
          <div data-ig-content="" className="px-4 py-3">
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="flex-shrink-0 mt-0.5">{VARIANT_ICONS[variant]}</div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-ig-fg-strong">{title}</p>
                {description && (
                  <p className="text-sm text-ig-fg-muted mt-1">{description}</p>
                )}
                {action && (
                  <button
                    onClick={action.onClick}
                    className="mt-2 text-sm font-medium text-ig-accent underline underline-offset-2 hover:brightness-110 transition-colors"
                  >
                    {action.label}
                  </button>
                )}
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className="flex-shrink-0 p-1 rounded-md text-ig-fg-subtle hover:text-ig-fg-strong hover:bg-ig-panel-hover transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
