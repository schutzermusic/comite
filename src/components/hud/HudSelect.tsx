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
}: HudSelectProps) {
  const sizeStyles = {
    sm: 'h-9 px-3 text-sm',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-4 text-base',
  };

  const selectedOption = options.find((opt) => opt.value === value);
  const displayValue = selectedOption?.label || placeholder;

  return (
    <div className={cn('flex flex-col gap-1.5', fullWidth && 'w-full', className)}>
      {label && (
        <label className="text-[11px] font-medium text-white/60 uppercase tracking-wider">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'rounded-lg appearance-none cursor-pointer',
            'bg-white/[0.03] backdrop-blur-sm',
            'text-white',
            'border border-white/[0.08]',
            'focus:outline-none focus:border-cyan-500/30 focus:bg-white/[0.05]',
            'hover:border-white/[0.12]',
            'transition-all duration-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            sizeStyles[size],
            fullWidth && 'w-full',
            error && 'border-red-500/50 focus:border-red-500/50'
          )}
        >
          <option value="" disabled className="bg-[#0a0f0d] text-white/50">
            {placeholder}
          </option>
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className="bg-[#0a0f0d] text-white"
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
      </div>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
