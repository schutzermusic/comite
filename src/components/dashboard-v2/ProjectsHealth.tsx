'use client';

import Link from 'next/link';
import { MapPinned } from 'lucide-react';
import { EmptyState, Plane, dateShort } from '@/components/ax';
import type { HealthLevel, ProjectsModel, SectionState } from '@/lib/dashboard/types';

/** Os mesmos rótulos da página do projeto e da Visão Geral de Operações. */
const HEALTH_LABEL: Record<HealthLevel, string> = {
  healthy: 'Em dia', attention: 'Atenção', critical: 'Crítico', unknown: 'Sem cronograma',
};
const SHOW = 6;

/**
 * PROJETOS — saúde operacional, a pior trava decide (mesma regra do projeto e
 * do mapa). O próximo marco é o do CRONOGRAMA, não um marco contratual.
 */
export function ProjectsHealth({ section, today }: { section: SectionState<ProjectsModel>; today: string }) {
  if (section.state === 'restricted') return null;
  if (section.state === 'error') {
    return (
      <Plane title="Projetos" testId="dashboard-projects">
        <EmptyState compact title="Não carregou">{section.message}</EmptyState>
      </Plane>
    );
  }
  const m = section.data;
  const flagged = m.rows.filter((r) => r.level !== 'healthy');
  const shown = (flagged.length > 0 ? flagged : m.rows).slice(0, SHOW);
  const healthy = m.counts.healthy;
  return (
    <Plane title="Projetos" subtitle={`${m.total.toLocaleString('pt-BR')} ${m.total === 1 ? 'ativo' : 'ativos'} — a pior trava decide`}
      flush testId="dashboard-projects"
      action={<Link className="ax-btn ghost sm" href="/projetos/operations-3d"><MapPinned size={13} aria-hidden />Mapa</Link>}>
      {m.total === 0 ? (
        <EmptyState compact title="Nenhum projeto ativo">Projetos entram aqui quando a OS é emitida e vinculada a um projeto.</EmptyState>
      ) : (
        <>
          <div className="dv2-health-bar" role="img"
            aria-label={`Crítico ${m.counts.critical}, atenção ${m.counts.attention}, sem cronograma ${m.counts.unknown}, em dia ${m.counts.healthy}`}>
            {(['critical', 'attention', 'unknown', 'healthy'] as HealthLevel[]).map((l) => (
              m.counts[l] > 0 ? <i key={l} data-level={l} style={{ flexGrow: m.counts[l] }} /> : null
            ))}
          </div>
          <div className="dv2-health-legend">
            {(['critical', 'attention', 'unknown', 'healthy'] as HealthLevel[]).map((l) => (
              <span key={l} data-level={l}><i aria-hidden />{HEALTH_LABEL[l]} <b className="num">{m.counts[l]}</b></span>
            ))}
          </div>
          <ol className="dv2-projects">
            {shown.map((p) => (
              <li key={p.projectId} className="dv2-project" data-level={p.level}>
                <div className="dv2-project-main">
                  <span className="dv2-project-top">
                    <span className="dv2-health" data-level={p.level}><i aria-hidden />{HEALTH_LABEL[p.level]}</span>
                    {p.client && <span className="dv2-where">{p.client}</span>}
                  </span>
                  <Link className="dv2-project-name" href={p.href}>{p.name}</Link>
                  <span className="dv2-project-why">
                    {p.topIssue ? p.topIssue.label : p.reasons.length ? p.reasons.slice(0, 2).join(' · ') : 'Sem trava aberta'}
                  </span>
                  <span className="dv2-project-meta">
                    {p.nextMilestone
                      ? <span title="Próximo marco do cronograma">◆ {p.nextMilestone.title ? `${p.nextMilestone.title} · ` : ''}{dateShort(p.nextMilestone.date)}{p.nextMilestone.date < today ? ' (vencido)' : ''}</span>
                      : <span className="ax-subtle">sem marco no cronograma</span>}
                  </span>
                </div>
                <Link className="ax-btn ghost sm icon" href={p.mapHref} aria-label={`Ver ${p.name} no mapa`} title="Ver no mapa">
                  <MapPinned size={14} aria-hidden />
                </Link>
              </li>
            ))}
          </ol>
          <div className="dv2-feed-foot">
            {flagged.length > shown.length && <span className="ax-subtle">+{flagged.length - shown.length} com trava</span>}
            {flagged.length > 0 && healthy > 0 && <span className="ax-subtle">{healthy} em dia</span>}
            {m.total > m.rows.length && <span className="ax-subtle">mostrando {m.rows.length} de {m.total}</span>}
            <Link className="ax-link" href="/projetos">Todos os projetos</Link>
          </div>
        </>
      )}
    </Plane>
  );
}
