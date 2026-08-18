'use client';

import React from 'react';
import { HudSignal } from './HudSignal';
import type { HudSignalTone } from './HudSignal';

export type HudChipVariant = 'critical' | 'warning' | 'info' | 'success' | 'live' | 'neutral';

export interface HudChipProps {
  label: string;
  count?: number;
  variant?: HudChipVariant;
  href?: string;
  className?: string;
  pulseDot?: boolean;
  size?: 'sm' | 'md';
}

const VARIANT_TONE: Record<HudChipVariant, HudSignalTone> = {
  critical: 'critical',
  warning: 'warning',
  info: 'accent',
  success: 'success',
  live: 'live',
  neutral: 'neutral',
};

/**
 * Chip de status — hoje um Signal Chip (ver `HudSignal`). A API é mantida por
 * compatibilidade; a antiga cápsula com ponto colorido foi aposentada.
 */
export function HudChip({
  label,
  count,
  variant = 'info',
  href,
  className,
  pulseDot = false,
  size = 'md',
}: HudChipProps) {
  return (
    <HudSignal
      label={label}
      value={count}
      tone={VARIANT_TONE[variant]}
      href={href}
      size={size}
      pulse={pulseDot}
      className={className}
    />
  );
}
