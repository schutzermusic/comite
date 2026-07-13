'use client';

import React from 'react';
import { Clock, AlertTriangle, AlarmClock } from 'lucide-react';
import { HudStatusPill, type HudStatusPillVariant } from '@/components/hud';
import type { SlaStatus } from './types';

interface DecisionSlaBadgeProps {
  status: SlaStatus;
  size?: 'sm' | 'md';
}

const SLA_MAP: Record<
  SlaStatus,
  { variant: HudStatusPillVariant; label: string; icon: React.ReactNode; pulse: boolean; explain: string }
> = {
  on_track: {
    variant: 'active',
    label: 'No prazo',
    icon: <Clock className="w-3 h-3" />,
    pulse: false,
    explain: 'No prazo: dentro do prazo definido.',
  },
  at_risk: {
    variant: 'at_risk',
    label: 'Em risco',
    icon: <AlertTriangle className="w-3 h-3" />,
    pulse: false,
    explain: 'Em risco: prazo próximo do vencimento.',
  },
  overdue: {
    variant: 'critical',
    label: 'Atrasada',
    icon: <AlarmClock className="w-3 h-3" />,
    pulse: true,
    explain: 'Atrasada: prazo vencido.',
  },
};

export function DecisionSlaBadge({ status, size = 'sm' }: DecisionSlaBadgeProps) {
  const cfg = SLA_MAP[status];
  return (
    <HudStatusPill variant={cfg.variant} size={size} pulse={cfg.pulse}>
      <span className="inline-flex items-center gap-1" title={cfg.explain}>
        {cfg.icon}
        {cfg.label}
      </span>
    </HudStatusPill>
  );
}
