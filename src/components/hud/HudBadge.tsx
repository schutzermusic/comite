'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { signalToneStyle } from './HudSignal';
import type { HudSignalTone } from './HudSignal';

export type HudBadgeVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'outline'
  | 'subtle';

export interface HudBadgeProps {
  children: React.ReactNode;
  variant?: HudBadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
  /** Mantido por compatibilidade. O trilho de tom substituiu o ponto. */
  dot?: boolean;
  /** Sobrescreve a cor do trilho com um valor CSS arbitrário. */
  dotColor?: string;
}

const VARIANT_TONE: Record<HudBadgeVariant, HudSignalTone> = {
  default: 'neutral',
  primary: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'neutral',
  outline: 'neutral',
  subtle: 'neutral',
};

const SIZE_STYLES = {
  sm: 'text-[10px] pl-2.5 pr-2 py-[3px]',
  md: 'text-[11px] pl-3 pr-2.5 py-[5px]',
};

/**
 * Etiqueta — mesma anatomia do Signal Chip (trilho de tom + vidro + raio 7px),
 * porém sem caixa alta forçada: badges carregam conteúdo livre (nomes, datas,
 * valores) que a caixa alta prejudicaria.
 *
 * `subtle` e `outline` seguem sendo as saídas discretas do sistema.
 */
export function HudBadge({
  children,
  variant = 'default',
  size = 'md',
  className,
  dotColor,
}: HudBadgeProps) {
  if (variant === 'subtle') {
    return (
      <span className={cn('inline-flex items-center font-medium text-ig-fg-muted', SIZE_STYLES[size], 'px-0', className)}>
        {children}
      </span>
    );
  }

  const isOutline = variant === 'outline';
  const style = dotColor
    ? ({ ['--sig-tone' as string]: dotColor } as React.CSSProperties)
    : signalToneStyle(VARIANT_TONE[variant]);
  const isMuted = VARIANT_TONE[variant] === 'neutral' && !dotColor;

  return (
    <span
      style={style}
      className={cn(
        'relative isolate inline-flex items-center gap-1.5 overflow-hidden rounded-[7px] border font-semibold leading-none',
        'border-[color-mix(in_oklab,var(--sig-tone)_26%,var(--ig-border-strong))]',
        isOutline
          ? 'bg-transparent'
          : 'bg-[linear-gradient(135deg,color-mix(in_oklab,var(--sig-tone)_9%,var(--ig-bg-raised)),color-mix(in_oklab,var(--ig-bg-raised)_88%,transparent))]',
        'shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_75%,transparent)]',
        isMuted ? 'text-ig-fg-muted' : 'text-ig-fg-strong',
        SIZE_STYLES[size],
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px] bg-[color:var(--sig-tone)] shadow-[0_0_10px_color-mix(in_oklab,var(--sig-tone)_75%,transparent)]"
      />
      {children}
    </span>
  );
}
