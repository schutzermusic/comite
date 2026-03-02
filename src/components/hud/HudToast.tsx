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

const VARIANT_STYLES: Record<ToastVariant, { icon: React.ReactNode; colors: string; accent: string }> = {
  success: {
    icon: <CheckCircle className="w-5 h-5" />,
    colors: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    accent: 'bg-emerald-500',
  },
  error: {
    icon: <AlertCircle className="w-5 h-5" />,
    colors: 'bg-red-500/10 border-red-500/20 text-red-300',
    accent: 'bg-red-500',
  },
  warning: {
    icon: <AlertTriangle className="w-5 h-5" />,
    colors: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    accent: 'bg-amber-500',
  },
  info: {
    icon: <Info className="w-5 h-5" />,
    colors: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300',
    accent: 'bg-cyan-500',
  },
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
  const styles = VARIANT_STYLES[variant];

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
          className={cn(
            'fixed bottom-6 right-6 z-[60]',
            'min-w-[320px] max-w-[420px]',
            'rounded-xl p-4',
            'backdrop-blur-xl',
            'border',
            styles.colors,
            'shadow-[0_12px_48px_rgba(0,0,0,0.55)]'
          )}
        >
          {/* Top accent line */}
          <div className={cn('absolute top-0 left-4 right-4 h-0.5 rounded-full opacity-50', styles.accent)} />

          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className="flex-shrink-0 mt-0.5">{styles.icon}</div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-white">{title}</p>
              {description && (
                <p className="text-sm text-white/60 mt-1">{description}</p>
              )}
              {action && (
                <button
                  onClick={action.onClick}
                  className="mt-2 text-sm font-medium underline underline-offset-2 hover:text-white transition-colors"
                >
                  {action.label}
                </button>
              )}
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="flex-shrink-0 p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
