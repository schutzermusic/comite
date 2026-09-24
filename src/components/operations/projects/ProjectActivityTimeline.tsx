'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ProjectTimelineEvent, TimelineKind } from '@/lib/operations/projects/timeline';
import { TIMELINE_KIND_LABEL } from '@/lib/operations/projects/timeline';
import { Chip, EmptyState, Filters, Plane, Resource, dateTime, useResource } from '@/components/ax';

type Payload = { ok: true; events: ProjectTimelineEvent[]; access: { commercial: boolean; measurements: boolean; risks: boolean } };

/**
 * HISTÓRICO DO PROJETO — um fluxo só, do mais recente para trás: OS, projeto,
 * autorização, cronograma, medição, risco, equipe, documento e supply. Cada
 * linha abre o registro que a sustenta.
 */
export function ProjectActivityTimeline({ projectId }: { projectId: string }) {
  const resource = useResource<Payload>(`/api/operations/projects/${encodeURIComponent(projectId)}/timeline`);
  return (
    <section aria-label="Histórico do projeto" data-testid="project-activity-timeline">
      <Resource {...resource}>{(data) => <History data={data} />}</Resource>
    </section>
  );
}

function History({ data }: { data: Payload }) {
  const [kind, setKind] = useState<'all' | TimelineKind>('all');
  const present = Array.from(new Set(data.events.map((e) => e.kind)));
  const events = data.events.filter((e) => kind === 'all' || e.kind === kind);
  return (
    <Plane flush title="Histórico" count={data.events.length}
      subtitle={`${data.events.length} evento(s) de ${present.length} domínio(s)${data.access.commercial ? '' : ' · história comercial restrita para o seu papel'}`}
      bar={present.length > 1 ? (
        <Filters<'all' | TimelineKind> label="Filtrar eventos" value={kind} onChange={setKind} options={[
          { id: 'all', label: 'Tudo', count: data.events.length },
          ...present.map((k) => ({ id: k, label: TIMELINE_KIND_LABEL[k], count: data.events.filter((e) => e.kind === k).length })),
        ]} />
      ) : undefined}>
      {events.length ? (
        <ol className="ax-history">
          {events.map((e) => (
            <li key={e.id} data-tone={e.tone}>
              <time dateTime={e.at}>{dateTime(e.at)}</time>
              <div>
                <span className="ax-history-head">
                  <Chip tone={e.tone} quiet>{TIMELINE_KIND_LABEL[e.kind]}</Chip>
                  {e.href ? <Link className="ax-link" href={e.href}>{e.title}</Link> : <strong>{e.title}</strong>}
                </span>
                {(e.detail || e.actor) && <small>{[e.detail, e.actor].filter(Boolean).join(' · ')}</small>}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState compact title="Sem eventos">Nada registrado ainda para este projeto nos domínios que você pode ver.</EmptyState>
      )}
    </Plane>
  );
}
