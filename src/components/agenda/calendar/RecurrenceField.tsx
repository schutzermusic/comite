'use client';

import React from 'react';
import { Repeat } from 'lucide-react';
import { HudInput, HudSelect } from '@/components/hud';
import type { RecurrenceFreq } from '@/lib/types/agenda';
import { RECURRENCE_FREQ_LABELS } from '@/lib/types/agenda';

export interface RecurrenceValue {
  freq: RecurrenceFreq | null;
  interval: number;
  until: string; // yyyy-MM-dd ou ''
}

/** Task recurrence: frequency + interval + optional end date. */
export function RecurrenceField({
  value,
  onChange,
}: {
  value: RecurrenceValue;
  onChange: (next: RecurrenceValue) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">
        <Repeat className="h-3.5 w-3.5" />
        Recorrência
      </span>
      <div className="grid gap-3 sm:grid-cols-3">
        <HudSelect
          value={value.freq ?? ''}
          onChange={(v) => onChange({ ...value, freq: (v || null) as RecurrenceFreq | null })}
          options={[
            { value: '', label: 'Não se repete' },
            ...(Object.keys(RECURRENCE_FREQ_LABELS) as RecurrenceFreq[]).map((k) => ({
              value: k,
              label: RECURRENCE_FREQ_LABELS[k],
            })),
          ]}
        />
        {value.freq && (
          <>
            <HudInput
              type="number"
              min={1}
              max={52}
              value={String(value.interval)}
              onChange={(e) => onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })}
              placeholder="Intervalo"
            />
            <HudInput
              type="date"
              value={value.until}
              onChange={(e) => onChange({ ...value, until: e.target.value })}
              placeholder="Repetir até"
            />
          </>
        )}
      </div>
      {value.freq && (
        <p className="text-[10px] text-ig-fg-subtle">
          Ao concluir, a próxima ocorrência é criada automaticamente
          {value.until ? ` (até ${value.until.split('-').reverse().join('/')})` : ''}.
        </p>
      )}
    </div>
  );
}
