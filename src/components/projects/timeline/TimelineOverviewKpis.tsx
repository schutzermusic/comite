'use client';

/**
 * "Cronograma" KPI block for the project Overview tab. Self-contained:
 * loads the relational timeline items and renders nothing when the
 * project has no schedule (or Supabase is unconfigured).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { GanttChart } from 'lucide-react';
import { HudKpiStrip } from '@/components/hud';
import { isTimelineAvailable, listTimelineItems } from '@/lib/services/project-timeline';
import { timelineKpis } from '@/lib/projects/timeline-analytics';
import type { TimelineItem } from '@/lib/types/project-timeline';

export interface TimelineOverviewKpisProps {
  projectId: string;
  /** Jump to the timeline tab when a KPI is clicked. */
  onOpenTimeline: () => void;
}

export function TimelineOverviewKpis({ projectId, onOpenTimeline }: TimelineOverviewKpisProps) {
  const [items, setItems] = useState<TimelineItem[]>([]);

  useEffect(() => {
    if (!isTimelineAvailable()) return;
    let active = true;
    listTimelineItems(projectId)
      .then((rows) => active && setItems(rows))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectId]);

  const kpis = useMemo(() => timelineKpis(items, new Date()), [items]);
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-ig-h3 font-semibold text-ig-fg-strong">
        <GanttChart className="h-4 w-4 text-ig-accent" /> Cronograma
      </h3>
      <HudKpiStrip
        columns={5}
        kpis={[
          { id: 't-progress', label: '% concluído', value: `${kpis.overallPercent}%`, onClick: onOpenTimeline },
          {
            id: 't-delayed',
            label: 'Atividades atrasadas',
            value: kpis.delayedCount,
            variant: kpis.delayedCount > 0 ? 'danger' : 'default',
            tintValue: kpis.delayedCount > 0,
            onClick: onOpenTimeline,
          },
          {
            id: 't-blocked',
            label: 'Bloqueadas',
            value: kpis.blockedCount,
            variant: kpis.blockedCount > 0 ? 'warning' : 'default',
            tintValue: kpis.blockedCount > 0,
            onClick: onOpenTimeline,
          },
          {
            id: 't-milestone',
            label: 'Próximo marco',
            value: kpis.nextMilestone?.plannedFinish
              ? kpis.nextMilestone.plannedFinish.split('-').reverse().slice(0, 2).join('/')
              : '—',
            onClick: onOpenTimeline,
          },
          {
            id: 't-days',
            label: 'Dias restantes',
            value: kpis.daysRemaining ?? '—',
            onClick: onOpenTimeline,
          },
        ]}
      />
    </div>
  );
}
