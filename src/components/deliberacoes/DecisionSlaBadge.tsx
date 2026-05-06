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
  { variant: HudStatusPillVariant; label: string; icon: React.ReactNode; pulse: boolean }
> = {
  on_track: {
    variant: 'active',
    label: 'No prazo',
    icon: <Clock className="w-3 h-3" />,
    pulse: false,
  },
  at_risk: {
    variant: 'at_risk',
    label: 'Em risco',
    icon: <AlertTriangle className="w-3 h-3" />,
    pulse: false,
  },
  overdue: {
    variant: 'critical',
    label: 'Atrasada',
    icon: <AlarmClock className="w-3 h-3" />,
    pulse: true,
  },
};

export function DecisionSlaBadge({ status, size = 'sm' }: DecisionSlaBadgeProps) {
  const cfg = SLA_MAP[status];
  return (
    <HudStatusPill variant={cfg.variant} size={size} pulse={cfg.pulse}>
      <span className="inline-flex items-center gap-1">
        {cfg.icon}
        {cfg.label}
      </span>
    </HudStatusPill>
  );
}
