'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type FinanceStatus =
  | 'ok' | 'attention' | 'critical' | 'justified'
  | 'draft' | 'review' | 'approved' | 'closed' | 'reported' | 'blocked'
  | 'open' | 'paid' | 'overdue' | 'pending' | 'partial' | 'cancelled'
  | 'active' | 'at_risk' | 'completed';

const TONE: Record<FinanceStatus, { ring: string; label: string }> = {
  ok:        { ring: 'border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success', label: 'OK' },
  attention: { ring: 'border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning', label: 'Atenção' },
  critical:  { ring: 'border-[color-mix(in_oklab,var(--ig-danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] text-ig-danger', label: 'Crítico' },
  justified: { ring: 'border-ig-border-focus bg-ig-accent-weak text-ig-accent', label: 'Justificado' },

  draft:     { ring: 'border-ig-border-subtle bg-ig-surface-subtle/60 text-ig-text-secondary', label: 'Draft' },
  review:    { ring: 'border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning', label: 'Em revisão' },
  approved:  { ring: 'border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success', label: 'Aprovado' },
  closed:    { ring: 'border-ig-border-focus bg-ig-accent-weak text-ig-accent', label: 'Fechado' },
  reported:  { ring: 'border-ig-border-focus bg-ig-accent-weak text-ig-accent', label: 'Reportado' },
  blocked:   { ring: 'border-[color-mix(in_oklab,var(--ig-danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] text-ig-danger', label: 'Bloqueado' },

  open:      { ring: 'border-ig-border-focus bg-ig-accent-weak text-ig-accent', label: 'Aberto' },
  paid:      { ring: 'border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success', label: 'Pago' },
  overdue:   { ring: 'border-[color-mix(in_oklab,var(--ig-danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] text-ig-danger', label: 'Vencido' },
  pending:   { ring: 'border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning', label: 'Pendente' },
  partial:   { ring: 'border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning', label: 'Parcial' },
  cancelled: { ring: 'border-ig-border-subtle bg-ig-surface-subtle/60 text-ig-text-secondary', label: 'Cancelado' },

  active:    { ring: 'border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success', label: 'Ativo' },
  at_risk:   { ring: 'border-[color-mix(in_oklab,var(--ig-danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_10%,transparent)] text-ig-danger', label: 'Em risco' },
  completed: { ring: 'border-ig-border-focus bg-ig-accent-weak text-ig-accent', label: 'Concluído' },
};

export interface FinanceStatusBadgeProps {
  status: FinanceStatus;
  label?: string;
  size?: 'xs' | 'sm';
  className?: string;
}

export function FinanceStatusBadge({ status, label, size = 'sm', className }: FinanceStatusBadgeProps) {
  const tone = TONE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border font-medium',
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
        tone.ring,
        className,
      )}
    >
      <span className="w-1 h-1 rounded-full bg-current opacity-80" />
      {label ?? tone.label}
    </span>
  );
}
