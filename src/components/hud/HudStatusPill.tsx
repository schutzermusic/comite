'use client';

import React from 'react';
import { HudSignal } from './HudSignal';
import type { HudSignalTone } from './HudSignal';

export type HudStatusPillVariant =
  | 'active'
  | 'completed'
  | 'pending'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'info'
  | 'critical'
  | 'at_risk';

export interface HudStatusPillProps {
  children: React.ReactNode;
  variant?: HudStatusPillVariant;
  size?: 'sm' | 'md';
  className?: string;
  pulse?: boolean;
}

const VARIANT_TONE: Record<HudStatusPillVariant, HudSignalTone> = {
  active: 'success',
  completed: 'accent',
  pending: 'warning',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
  info: 'info',
  critical: 'critical',
  at_risk: 'warning',
};

/**
 * Indicador de estado — hoje um Signal Chip sem dado numérico (ver `HudSignal`).
 * Nome e API preservados: é o componente de status mais usado do produto.
 */
export function HudStatusPill({
  children,
  variant = 'neutral',
  size = 'md',
  className,
  pulse = false,
}: HudStatusPillProps) {
  return (
    <HudSignal
      label={children}
      tone={VARIANT_TONE[variant]}
      size={size}
      pulse={pulse}
      className={className}
    />
  );
}
