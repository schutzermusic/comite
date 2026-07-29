'use client';

import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HudSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface HudSelectProps {
  label?: string;
  value: string;
  options: HudSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  className?: string;
  disabled?: boolean;
}

export function HudSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Selecionar...',
  error,
  size = 'md',
  fullWidth = true,
  className,
  disabled = false,
}: HudSelectProps) {
  const sizeStyles = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-4 text-base',
  };

  return (
    <div className={cn('flex flex-col gap-1.5', fullWidth && 'w-full', className)}>
      {label && (
        <label className="text-[11px] font-medium hud-label uppercase tracking-wider">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'rounded-lg appearance-none cursor-pointer',
            'hud-input-bg backdrop-blur-sm',
            'border',
            'hover:border-[var(--orion-border-default)]',
            'transition-all duration-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            sizeStyles[size],
            fullWidth && 'w-full',
            error && 'border-[color-mix(in_oklab,var(--ig-danger)_50%,transparent)] focus:border-[color-mix(in_oklab,var(--ig-danger)_60%,transparent)]'
          )}
        >
          <option value="" disabled className="hud-option-bg hud-text-muted">
            {placeholder}
          </option>
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="hud-option-bg hud-text"
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 hud-icon pointer-events-none" />
      </div>
      {error && (
        <p className="text-xs text-ig-danger">{error}</p>
      )}
    </div>
  );
}
