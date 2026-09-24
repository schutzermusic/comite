'use client';

import type { Readiness, ReadinessDimension } from '@/lib/operations/planning/readiness';
import { DIMENSION_LABEL, READINESS_LABEL } from '@/lib/operations/planning/readiness';
import { StatePill, type Tone } from '../ui';

export const READINESS_TONE: Record<Readiness, Tone> = {
  READY: 'success', PARTIAL: 'warning', SHORTAGE: 'danger', PENDING: 'info', OVERDUE: 'danger', UNCONFIRMED: 'neutral',
};

export function ReadinessPill({ value }: { value: Readiness | null | undefined }) {
  if (!value) return <span className="crm-muted">—</span>;
  return <StatePill tone={READINESS_TONE[value]}>{READINESS_LABEL[value]}</StatePill>;
}

const MARK: Record<Readiness, string> = { READY: '✓', PARTIAL: '◐', SHORTAGE: '⚠', PENDING: '…', OVERDUE: '⚠', UNCONFIRMED: '?' };

/** Uma célula da matriz de prontidão: marca + texto (nunca só cor). */
export function ReadinessCell({ value }: { value: Readiness | undefined }) {
  if (!value) return <span className="ops-cell" aria-label="sem requisito">—</span>;
  const level = value === 'READY' ? 0 : value === 'SHORTAGE' || value === 'OVERDUE' ? 2 : 1;
  return (
    <span className="ops-cell" data-level={level} title={READINESS_LABEL[value]} aria-label={READINESS_LABEL[value]}>
      {MARK[value]}
    </span>
  );
}

export const MATRIX_DIMENSIONS: ReadinessDimension[] = ['team', 'material', 'equipment', 'document', 'customer'];
export { DIMENSION_LABEL };
