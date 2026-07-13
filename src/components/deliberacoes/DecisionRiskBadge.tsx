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
  { variant: HudBadgeVariant; label: string; icon: React.ReactNode; explain: string }
> = {
  critico: {
    variant: 'danger',
    label: 'Crítico',
    icon: <ShieldAlert className="w-3 h-3" />,
    explain: 'Crítico: risco alto — reforce evidências e aprovação.',
  },
  alto: {
    variant: 'warning',
    label: 'Alto',
    icon: <ShieldAlert className="w-3 h-3" />,
    explain: 'Alto risco: exige atenção e, em geral, revisão antes da votação.',
  },
  medio: {
    variant: 'neutral',
    label: 'Médio',
    icon: <Shield className="w-3 h-3" />,
    explain: 'Risco médio: dentro do apetite usual do comitê.',
  },
  baixo: {
    variant: 'success',
    label: 'Baixo',
    icon: <ShieldCheck className="w-3 h-3" />,
    explain: 'Risco baixo: decisão de rotina.',
  },
};

export function DecisionRiskBadge({ risco, size = 'sm' }: DecisionRiskBadgeProps) {
  const cfg = RISK_MAP[risco];
  return (
    <HudBadge variant={cfg.variant} size={size}>
      <span className="inline-flex items-center gap-1" title={cfg.explain}>
        {cfg.icon}
        {cfg.label}
      </span>
    </HudBadge>
  );
}
