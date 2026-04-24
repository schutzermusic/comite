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
    'hud-btn-primary',
    'bg-[linear-gradient(180deg,#17C3B2_0%,#0F9C8F_100%)]',
    'font-semibold',
    'border-0',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-1px_0_rgba(0,0,0,0.20),0_4px_12px_rgba(15,156,143,0.28),0_1px_2px_rgba(0,0,0,0.35)]',
    'hover:brightness-105 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(0,0,0,0.22),0_6px_18px_rgba(15,156,143,0.38),0_1px_2px_rgba(0,0,0,0.35)]',
    'active:translate-y-px active:scale-[0.995]',
    'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
    'transition-all duration-150',
  ].join(' '),
  secondary: [
    'hud-btn-secondary',
    'bg-ig-panel-hover',
    'text-ig-fg-strong font-medium',
    'border border-ig-border-strong',
    'hover:bg-ig-panel-hover hover:border-ig-border-focus',
    'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
  ].join(' '),
  ghost: [
    'hud-btn-ghost',
    'bg-transparent',
    'text-ig-fg font-medium',
    'border border-transparent',
    'hover:bg-ig-panel hover:text-ig-fg-strong',
    'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
  ].join(' '),
  danger: [
    'hud-btn-danger',
    'bg-[color-mix(in_oklab,var(--ig-danger)_14%,transparent)]',
    'text-ig-danger font-medium',
    'border border-[color-mix(in_oklab,var(--ig-danger)_32%,transparent)]',
    'hover:bg-[color-mix(in_oklab,var(--ig-danger)_20%,transparent)] hover:border-[color-mix(in_oklab,var(--ig-danger)_44%,transparent)]',
    'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
  ].join(' '),
  glass: [
    'hud-btn-glass',
    'bg-ig-panel',
    'text-ig-fg-strong font-medium',
    'border border-ig-border-strong',
    'backdrop-blur-sm',
    'hover:bg-ig-panel-hover hover:border-ig-border-focus',
    'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
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
      data-variant={variant}
      className={cn(
        'inline-flex items-center justify-center gap-2',
        'rounded-lg',
        'transition-all duration-200',
        'focus-visible:outline-none',
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
