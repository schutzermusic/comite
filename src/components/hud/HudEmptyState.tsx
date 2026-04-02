'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Package, Search, FileX, AlertCircle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudButton } from './HudButton';

export type EmptyStateIcon = 'package' | 'search' | 'file' | 'alert' | 'inbox' | 'custom';

export interface HudEmptyStateProps {
  title?: string;
  description?: string;
  icon?: EmptyStateIcon;
  customIcon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'secondary';
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  compact?: boolean;
}

const ICONS: Record<EmptyStateIcon, React.ReactNode> = {
  package: <Package className="w-12 h-12" />,
  search: <Search className="w-12 h-12" />,
  file: <FileX className="w-12 h-12" />,
  alert: <AlertCircle className="w-12 h-12" />,
  inbox: <Inbox className="w-12 h-12" />,
  custom: null,
};

export function HudEmptyState({
  title = 'Nenhum item encontrado',
  description = 'Não há dados para exibir no momento.',
  icon = 'package',
  customIcon,
  action,
  secondaryAction,
  className,
  compact = false,
}: HudEmptyStateProps) {
  const Icon = icon === 'custom' ? customIcon : ICONS[icon];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 px-4' : 'py-16 px-6',
        className
      )}
    >
      {/* Icon */}
      <div className={cn(
        'flex items-center justify-center rounded-2xl mb-4',
        'bg-gradient-to-br from-cyan-500/10 to-emerald-500/10',
        'border border-cyan-500/20',
        compact ? 'w-16 h-16' : 'w-20 h-20'
      )}>
        <span className="text-cyan-300/60">
          {Icon}
        </span>
      </div>

      {/* Title */}
      <h3 className={cn(
        'font-semibold text-white tracking-wide mb-2',
        compact ? 'text-base' : 'text-lg'
      )}>
        {title}
      </h3>

      {/* Description */}
      <p className={cn(
        'text-white/50 max-w-sm mb-6',
        compact ? 'text-sm' : 'text-base'
      )}>
        {description}
      </p>

      {/* Actions */}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3 flex-wrap justify-center">
          {action && (
            <HudButton
              variant={action.variant || 'primary'}
              size={compact ? 'sm' : 'md'}
              onClick={action.onClick}
            >
              {action.label}
            </HudButton>
          )}
          {secondaryAction && (
            <HudButton
              variant="ghost"
              size={compact ? 'sm' : 'md'}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </HudButton>
          )}
        </div>
      )}
    </motion.div>
  );
}
