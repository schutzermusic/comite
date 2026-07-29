'use client';

/**
 * Resumo do dia e linha do tempo das marcações.
 *
 * O resumo é a leitura rápida (quatro horários + dois totais); a linha do
 * tempo é a leitura detalhada, com o estado de cada marcação. Nenhum
 * estado depende só de cor: todos trazem rótulo em texto.
 */

import * as React from 'react';
import { CircleCheck, CircleSlash, CloudUpload, PencilLine, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PENDING_SYNC_STATUS, type PunchRecord } from '@/lib/ponto/attendance-types';
import {
  PUNCH_SHORT_LABEL,
  formatDuration,
  formatTime,
  type DailySummary as DailySummaryData,
} from '@/lib/ponto/attendance-state';
import { StatusBadge, type Tone } from './primitives';

/* ───────────────────── resumo ───────────────────── */

function SummaryCell({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    // `mt-auto` + células esticadas pelo grid: quando um rótulo quebra em
    // duas linhas ("Início do intervalo"), os valores continuam alinhados
    // entre si em vez de escalonar.
    <div className="flex min-w-0 flex-col">
      <dt className="text-ig-caption leading-tight text-ig-fg-subtle">{label}</dt>
      <dd
        className={cn(
          'ig-tabular mt-auto truncate pt-0.5',
          emphasis ? 'text-ig-h2 text-ig-accent' : 'text-ig-h3 text-ig-fg-strong',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function DailySummary({ summary, className }: { summary: DailySummaryData; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-4 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-6', className)}>
      <SummaryCell label="Entrada" value={formatTime(summary.clockIn)} />
      <SummaryCell label="Início do intervalo" value={formatTime(summary.breakStart)} />
      <SummaryCell label="Fim do intervalo" value={formatTime(summary.breakEnd)} />
      <SummaryCell label="Saída" value={formatTime(summary.clockOut)} />
      <SummaryCell
        label={summary.open ? 'Trabalhado (em curso)' : 'Total trabalhado'}
        value={formatDuration(summary.workedMinutes)}
        emphasis
      />
      <SummaryCell label="Total de intervalo" value={formatDuration(summary.breakMinutes)} />
    </dl>
  );
}

/* ───────────────────── estado de cada marcação ───────────────────── */

interface PunchStatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

export function punchStatusMeta(status: string): PunchStatusMeta | null {
  switch (status) {
    case PENDING_SYNC_STATUS:
      return { label: 'Salvo no aparelho', tone: 'warning', icon: CloudUpload };
    case 'under_review':
      return { label: 'Em análise', tone: 'info', icon: Search };
    case 'cancelled':
      return { label: 'Recusado', tone: 'danger', icon: CircleSlash };
    case 'corrected':
      return { label: 'Ajustado', tone: 'neutral', icon: PencilLine };
    case 'accepted':
      return null;
    default:
      return null;
  }
}

const DOT_TONE: Record<Tone, string> = {
  neutral: 'bg-ig-fg-subtle',
  accent: 'bg-ig-accent',
  success: 'bg-ig-success',
  warning: 'bg-ig-warning',
  danger: 'bg-ig-danger',
  info: 'bg-ig-info',
};

/* ───────────────────── linha do tempo ───────────────────── */

export function AttendanceTimeline({
  punches,
  className,
  emptyLabel = 'Nenhuma marcação registrada.',
}: {
  punches: readonly PunchRecord[];
  className?: string;
  emptyLabel?: string;
}) {
  if (punches.length === 0) {
    return <p className={cn('text-ig-body-sm text-ig-fg-subtle', className)}>{emptyLabel}</p>;
  }

  return (
    <ol className={cn('relative space-y-0', className)}>
      {punches.map((punch, index) => {
        const meta = punchStatusMeta(punch.status);
        const tone: Tone = meta?.tone ?? 'accent';
        const isLast = index === punches.length - 1;
        const struck = punch.status === 'cancelled';
        return (
          <li key={punch.id} className="flex gap-3">
            <div className="flex flex-col items-center pt-1.5">
              <span
                className={cn('h-2.5 w-2.5 shrink-0 rounded-full', DOT_TONE[tone])}
                aria-hidden="true"
              />
              {!isLast ? <span className="w-px flex-1 bg-ig-border" aria-hidden="true" /> : null}
            </div>
            {/* Fluido, sem breakpoint: o selo fica na mesma linha quando cabe
                e desce sozinho quando não cabe (320px). O rótulo não usa
                `flex-1` justamente para permitir essa quebra. */}
            <div
              className={cn(
                'flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1.5',
                isLast ? 'pb-0' : 'pb-4',
              )}
            >
              <span
                className={cn(
                  'ig-tabular w-[52px] shrink-0 text-ig-h3 text-ig-fg-strong',
                  struck && 'text-ig-fg-subtle line-through',
                )}
              >
                {formatTime(punch.occurred_at)}
              </span>
              <span className={cn('min-w-0 text-ig-body-sm text-ig-fg-muted', struck && 'line-through')}>
                {PUNCH_SHORT_LABEL[punch.type]}
              </span>
              <span className="ml-auto">
                {meta ? (
                  <StatusBadge label={meta.label} tone={meta.tone} icon={meta.icon} />
                ) : (
                  <StatusBadge label="Confirmado" tone="success" icon={CircleCheck} />
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
