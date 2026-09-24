'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ProjectTimelineEvent, TimelineKind } from '@/lib/operations/projects/timeline';
import { TIMELINE_KIND_LABEL } from '@/lib/operations/projects/timeline';
import { EmptyNote, Panel, ResourceState, Segments, StatePill, useOperationsResource } from '../ui';

type Payload = { ok: true; events: ProjectTimelineEvent[]; access: { commercial: boolean; measurements: boolean; risks: boolean } };

const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * TIMELINE DO PROJETO — um fluxo só, do mais recente para trás: OS, projeto,
 * autorização, cronograma, medição, risco, equipe, documento e (quando houver)
 * supply. Cada linha abre o registro que a sustenta.
 */
export function ProjectActivityTimeline({ projectId }: { projectId: string }) {
  const { data, state, message } = useOperationsResource<Payload>(`/api/operations/projects/${encodeURIComponent(projectId)}/timeline`);
  const [kind, setKind] = useState<'all' | TimelineKind>('all');
  const events = useMemo(() => (data?.events ?? []).filter((e) => kind === 'all' || e.kind === kind), [data, kind]);
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const present = Array.from(new Set(data.events.map((e) => e.kind)));

  return (
    <section className="crm-workspace ops-workspace" aria-label="Timeline do projeto" data-testid="project-activity-timeline">
      <Panel
        title="Timeline"
        note={`${data.events.length} evento(s) de ${present.length} domínio(s)${data.access.commercial ? '' : ' · história comercial restrita para o seu papel'}`}
        aside={present.length > 1 ? (
          <Segments label="Filtrar eventos" value={kind} onChange={(v) => setKind(v as 'all' | TimelineKind)}
            options={[{ value: 'all', label: 'Tudo', count: data.events.length },
              ...present.map((k) => ({ value: k, label: TIMELINE_KIND_LABEL[k], count: data.events.filter((e) => e.kind === k).length }))]} />
        ) : undefined}
      >
        {events.length ? (
          <ul className="ops-history">
            {events.map((e) => (
              <li key={e.id}>
                <time dateTime={e.at}>{dateTime(e.at)}</time>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <StatePill tone={e.tone} dot>{TIMELINE_KIND_LABEL[e.kind]}</StatePill>
                    {e.href ? <Link href={e.href} className="crm-row-open">{e.title}</Link> : <b>{e.title}</b>}
                  </p>
                  {(e.detail || e.actor) && <p className="crm-muted">{[e.detail, e.actor].filter(Boolean).join(' · ')}</p>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote title="Sem eventos" description="Nada registrado ainda para este projeto nos domínios que você pode ver." />
        )}
      </Panel>
    </section>
  );
}
