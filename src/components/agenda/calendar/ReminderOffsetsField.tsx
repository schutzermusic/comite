'use client';

import React from 'react';
import { BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MeetingReminderToken, TaskReminderToken } from '@/lib/types/agenda';
import { MEETING_REMINDER_LABELS, TASK_REMINDER_LABELS } from '@/lib/types/agenda';

const TASK_TOKENS = Object.keys(TASK_REMINDER_LABELS) as TaskReminderToken[];
const MEETING_TOKENS = Object.keys(MEETING_REMINDER_LABELS) as MeetingReminderToken[];

const DEFAULT_HINT = {
  task: 'Padrão: 1 dia antes + ao atrasar',
  meeting: 'Padrão: 1 hora antes',
};

/**
 * Chip multi-select for per-item reminders. `value === null` means
 * "padrão" (legacy automatic behavior).
 */
export function ReminderOffsetsField<T extends TaskReminderToken | MeetingReminderToken>({
  kind,
  value,
  onChange,
}: {
  kind: 'task' | 'meeting';
  value: T[] | null;
  onChange: (next: T[] | null) => void;
}) {
  const tokens = (kind === 'task' ? TASK_TOKENS : MEETING_TOKENS) as T[];
  const labels = (kind === 'task' ? TASK_REMINDER_LABELS : MEETING_REMINDER_LABELS) as Record<T, string>;
  const isDefault = value === null;

  const toggle = (token: T) => {
    const current = value ?? [];
    const next = current.includes(token)
      ? current.filter((t) => t !== token)
      : [...current, token];
    onChange(next.length === 0 ? null : next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
        <BellRing className="h-3.5 w-3.5" />
        Lembretes
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus',
            isDefault
              ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
              : 'border-ig-border bg-ig-panel text-ig-fg-muted hover:bg-ig-panel-hover',
          )}
        >
          Padrão
        </button>
        {tokens.map((token) => {
          const active = (value ?? []).includes(token);
          return (
            <button
              key={token}
              type="button"
              onClick={() => toggle(token)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus',
                active
                  ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
                  : 'border-ig-border bg-ig-panel text-ig-fg-muted hover:bg-ig-panel-hover',
              )}
            >
              {labels[token]}
            </button>
          );
        })}
      </div>
      {isDefault && <p className="text-[10px] text-ig-fg-subtle">{DEFAULT_HINT[kind]}</p>}
    </div>
  );
}
