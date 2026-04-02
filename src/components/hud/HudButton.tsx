'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type HudButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
export type HudButtonSize = 'sm' | 'md' | 'lg';

export interface HudButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: HudButtonVariant;
  size?: HudButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<HudButtonVariant, string> = {
  primary: [
    'bg-gradient-to-r from-cyan-500 to-emerald-500',
    'text-black font-semibold',
    'border-0',
    'hover:from-cyan-400 hover:to-emerald-400',
    'shadow-[0_0_20px_rgba(6,182,212,0.3)]',
    'hover:shadow-[0_0_30px_rgba(6,182,212,0.4)]',
  ].join(' '),
  secondary: [
    'bg-white/[0.08]',
    'text-white font-medium',
    'border border-white/[0.12]',
    'hover:bg-white/[0.12] hover:border-white/[0.18]',
  ].join(' '),
  ghost: [
    'bg-transparent',
    'text-white/70 font-medium',
    'border border-transparent',
    'hover:bg-white/[0.05] hover:text-white',
  ].join(' '),
  danger: [
    'bg-red-500/10',
    'text-red-400 font-medium',
    'border border-red-500/20',
    'hover:bg-red-500/15 hover:border-red-500/30',
  ].join(' '),
  glass: [
    'bg-white/[0.05]',
    'text-white font-medium',
    'border border-white/[0.10]',
    'backdrop-blur-sm',
    'hover:bg-white/[0.08] hover:border-cyan-500/30',
  ].join(' '),
};

const SIZE_STYLES: Record<HudButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export function HudButton({
  children,
  variant = 'secondary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  className,
  disabled,
  ...props
}: HudButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2',
        'rounded-lg',
        'transition-all duration-200',
        'focus:outline-none focus:ring-2 focus:ring-cyan-500/30',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        fullWidth && 'w-full',
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {!isLoading && leftIcon}
      {children}
      {!isLoading && rightIcon}
    </button>
  );
}
