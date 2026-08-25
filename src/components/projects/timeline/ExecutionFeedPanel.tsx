'use client';

/**
 * Feed de execução do projeto — o que realmente aconteceu no cronograma.
 *
 * Todos os eventos são DERIVADOS em tempo de leitura (ver timeline-events.ts):
 * não há tabela de eventos e não deve haver. O que aparece aqui já está nos
 * dados de quem é dono deles; este painel só os costura em ordem.
 */

import React, { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import { SignalChip, type SignalChipTone } from '@/components/ui/signal-chip';
import { composeTimelineEvents, formatEventTime } from '@/lib/projects/timeline-events';
import type { ProjectWorkSession, TimeEntry } from '@/lib/types/people';
import type { DelayLog, TimelineItem } from '@/lib/types/project-timeline';

/** Os tons do HudSignal e do SignalChip divergem em dois nomes. */
const CHIP_TONE: Record<string, SignalChipTone> = {
  live: 'live',
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  accent: 'accent',
  danger: 'critical',
  critical: 'critical',
  warning: 'warning',
};

export interface ExecutionFeedPanelProps {
  items: TimelineItem[];
  entries: TimeEntry[];
  sessions: ProjectWorkSession[];
  delayLogs: DelayLog[];
  onSelectItem: (itemId: string) => void;
  limit?: number;
}

export function ExecutionFeedPanel({
  items,
  entries,
  sessions,
  delayLogs,
  onSelectItem,
  limit = 20,
}: ExecutionFeedPanelProps) {
  const now = useMemo(() => new Date(), []);
  const events = useMemo(
    // Comentários ficam de fora no nível de projeto: buscá-los exigiria uma
    // query por item (N+1). No drawer, onde já estão carregados, eles entram.
    () => composeTimelineEvents({ items, entries, sessions, delayLogs, limit }),
    [items, entries, sessions, delayLogs, limit],
  );

  if (events.length === 0) return null;

  return (
    <HudPanel
      title="Execução recente"
      subtitle="Derivado do apontamento e dos registros do cronograma"
      icon={<Activity className="h-4 w-4" />}
      elevation={1}
      noPadding
    >
      <ul className="max-h-72 divide-y divide-ig-border-subtle overflow-y-auto">
        {events.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              onClick={() => onSelectItem(event.itemId)}
              className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-ig-panel-hover"
            >
              <SignalChip
                size="xs"
                tone={CHIP_TONE[event.tone] ?? 'neutral'}
                label={event.title}
                pulse={event.type === 'work_in_progress'}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-ig-fg">{event.itemTitle}</span>
                {event.detail && (
                  <span className="block truncate text-[11px] text-ig-fg-subtle">{event.detail}</span>
                )}
              </span>
              <span className="shrink-0 text-right text-[10px] tabular-nums text-ig-fg-subtle">
                {event.actorName && <span className="block truncate">{event.actorName}</span>}
                {formatEventTime(event, now)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </HudPanel>
  );
}
