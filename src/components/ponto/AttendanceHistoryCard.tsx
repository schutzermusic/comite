'use client';

/**
 * Cartão diário do histórico (§9).
 *
 * No celular não há tabela: cada dia é um cartão que abre a linha do
 * tempo do próprio dia. No desktop os mesmos cartões ganham uma grade de
 * colunas, sem virar tabela espremida.
 */

import * as React from 'react';
import { ChevronDown, CircleCheck, CircleSlash, CloudUpload, PencilLine, Search, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DAY_STATUS_LABEL,
  formatDayLabel,
  formatDuration,
  formatTime,
  type DayRecord,
  type DayStatus,
} from '@/lib/ponto/attendance-state';
import { AttendanceTimeline } from './AttendanceTimeline';
import { PontoButton, PontoCard, StatusBadge, type Tone } from './primitives';

const DAY_STATUS_TONE: Record<DayStatus, Tone> = {
  complete: 'success',
  incomplete: 'warning',
  under_review: 'info',
  adjusted: 'neutral',
  rejected: 'danger',
  pending_sync: 'warning',
  absent: 'neutral',
};

const DAY_STATUS_ICON: Record<DayStatus, LucideIcon> = {
  complete: CircleCheck,
  incomplete: TriangleAlert,
  under_review: Search,
  adjusted: PencilLine,
  rejected: CircleSlash,
  pending_sync: CloudUpload,
  absent: CircleSlash,
};

export function DayStatusBadge({ status }: { status: DayStatus }) {
  return (
    <StatusBadge
      label={DAY_STATUS_LABEL[status]}
      tone={DAY_STATUS_TONE[status]}
      icon={DAY_STATUS_ICON[status]}
    />
  );
}

export interface AttendanceHistoryCardProps {
  day: DayRecord;
  /** Aberto por padrão — usado no dia corrente. */
  defaultOpen?: boolean;
  onRequestAdjustment?: (day: DayRecord) => void;
}

export function AttendanceHistoryCard({
  day,
  defaultOpen = false,
  onRequestAdjustment,
}: AttendanceHistoryCardProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const contentId = React.useId();

  return (
    <PontoCard as="article">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={contentId}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3.5 text-left',
          'rounded-[var(--ig-radius-lg)] focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-ig-h3 text-ig-fg-strong first-letter:uppercase">{formatDayLabel(day.date)}</p>
          <p className="ig-tabular mt-0.5 truncate text-ig-caption text-ig-fg-muted">
            {formatTime(day.summary.clockIn)} – {formatTime(day.summary.clockOut)}
            {day.summary.breakMinutes > 0 ? ` · intervalo ${formatDuration(day.summary.breakMinutes)}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="ig-tabular text-ig-h3 text-ig-accent">
            {formatDuration(day.summary.workedMinutes)}
          </span>
          <DayStatusBadge status={day.status} />
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-ig-fg-subtle transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div id={contentId} className="border-t border-ig-border px-4 py-4">
          <AttendanceTimeline punches={day.punches} emptyLabel="Nenhuma marcação neste dia." />
          {onRequestAdjustment ? (
            <PontoButton
              variant="secondary"
              icon={PencilLine}
              onClick={() => onRequestAdjustment(day)}
              className="mt-4 min-h-[44px] text-ig-body-sm"
            >
              Solicitar ajuste deste dia
            </PontoButton>
          ) : null}
        </div>
      ) : null}
    </PontoCard>
  );
}
