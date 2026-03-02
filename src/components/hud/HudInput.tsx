'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface HudInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'glass';
  fullWidth?: boolean;
}

export function HudInput({
  label,
  error,
  leftIcon,
  rightIcon,
  size = 'md',
  variant = 'glass',
  fullWidth = true,
  className,
  ...props
}: HudInputProps) {
  const sizeStyles = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-4 text-base',
  };

  const variantStyles = {
    default: [
      'bg-white/[0.05]',
      'border-white/[0.08]',
      'focus:border-cyan-500/30',
      'focus:ring-1 focus:ring-cyan-500/20',
    ],
    glass: [
      'bg-white/[0.03]',
      'backdrop-blur-sm',
      'border-white/[0.08]',
      'focus:border-cyan-500/30',
      'focus:bg-white/[0.05]',
    ],
  };

  return (
    <div className={cn('flex flex-col gap-1.5', fullWidth && 'w-full')}>
      {label && (
        <label className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">
            {leftIcon}
          </span>
        )}
        <input
          className={cn(
            'rounded-lg',
            'text-white placeholder:text-white/30',
            'border',
            'focus:outline-none',
            'transition-all duration-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            sizeStyles[size],
            variantStyles[variant],
            leftIcon && 'pl-10',
            rightIcon && 'pr-10',
            error && 'border-red-500/50 focus:border-red-500/50',
            fullWidth && 'w-full',
            className
          )}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40">
            {rightIcon}
          </span>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
