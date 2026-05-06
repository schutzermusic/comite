'use client';

import React from 'react';
import { ShieldAlert, Shield, ShieldCheck } from 'lucide-react';
import { HudBadge, type HudBadgeVariant } from '@/components/hud';
import type { DeliberacaoRisco } from './types';

interface DecisionRiskBadgeProps {
  risco: DeliberacaoRisco;
  size?: 'sm' | 'md';
}

const RISK_MAP: Record<
  DeliberacaoRisco,
  { variant: HudBadgeVariant; label: string; icon: React.ReactNode }
> = {
  critico: {
    variant: 'danger',
    label: 'Crítico',
    icon: <ShieldAlert className="w-3 h-3" />,
  },
  alto: {
    variant: 'warning',
    label: 'Alto',
    icon: <ShieldAlert className="w-3 h-3" />,
  },
  medio: {
    variant: 'neutral',
    label: 'Médio',
    icon: <Shield className="w-3 h-3" />,
  },
  baixo: {
    variant: 'success',
    label: 'Baixo',
    icon: <ShieldCheck className="w-3 h-3" />,
  },
};

export function DecisionRiskBadge({ risco, size = 'sm' }: DecisionRiskBadgeProps) {
  const cfg = RISK_MAP[risco];
  return (
    <HudBadge variant={cfg.variant} size={size}>
      <span className="inline-flex items-center gap-1">
        {cfg.icon}
        {cfg.label}
      </span>
    </HudBadge>
  );
}
