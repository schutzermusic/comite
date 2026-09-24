'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ProjectOverviewModel, ProjectAccess } from '@/lib/operations/projects/read-model';
import { HEALTH_LABEL } from '@/lib/operations/projects/health';
import { serviceOrderStatusLabels } from '@/lib/operations/service-orders/labels';
import { Meter, dateShort, href, relativeDue, type Tone } from '@/components/ax';

export type ProjectOverviewPayload = ProjectOverviewModel & { ok: true; access: ProjectAccess };

export interface ProjectGlanceFacts {
  statusLabel: string;
  statusTone: Tone;
  responsible: string | null;
  start: string | null;
  finish: string | null;
  /** Receita — só presente com leitura financeira do projeto (ausente, nunca zerada). */
  revenue: null | { contract: string; billed: string; toBill: string; source: string };
}

const HEALTH_TONE: Record<string, Tone> = { critical: 'danger', attention: 'warning', healthy: 'success', unknown: 'neutral' };

/**
 * O PROJETO NUM OLHAR — os campos que se leem antes de qualquer aba: estado,
 * responsável, período, avanço, saúde (com o motivo), próximo marco, a OS que
 * autoriza o trabalho e, com leitura financeira, o contrato. Cada campo leva à
 * aba que o explica.
 */
export function ProjectGlance({ facts, overview, onOpenTab }: {
  facts: ProjectGlanceFacts; overview: ProjectOverviewPayload | null; onOpenTab: (tab: string) => void;
}) {
  const today = overview?.today ?? null;
  const next = overview?.nextMilestones[0] ?? null;
  const os = overview?.serviceOrders[0] ?? null;
  const health = overview?.health ?? null;
  const progress = overview?.progress.percent ?? null;
  // Período: o declarado no projeto; sem ele, o que o cronograma diz (e a tela diz que veio de lá).
  const declared = Boolean(facts.start || facts.finish);
  const start = facts.start ?? overview?.span.start ?? null;
  const finish = facts.finish ?? overview?.span.finish ?? null;
  return (
    <section className="ax-glance" aria-label="O projeto num olhar" data-testid="project-glance">
      <Cell label="Estado" tone={facts.statusTone} value={facts.statusLabel} sub={facts.responsible ? `resp. ${facts.responsible}` : 'sem responsável'} />
      <Cell label="Período" value={start || finish ? `${start ? dateShort(start) : '—'} → ${finish ? dateShort(finish) : '—'}` : 'não definido'}
        sub={[declared ? null : start || finish ? 'pelo cronograma' : null,
          finish && today ? (finish < today ? `término vencido ${relativeDue(finish, today).text}` : `termina ${relativeDue(finish, today).text}`) : null]
          .filter(Boolean).join(' · ') || undefined} />
      <Cell label="Avanço físico" value={progress === null ? '—' : `${progress.toLocaleString('pt-BR')}%`}
        sub={overview ? (overview.progress.total ? `${overview.progress.done} de ${overview.progress.total} atividades` : 'cronograma não importado') : undefined}
        extra={progress === null ? null : <Meter value={progress / 100} label="Avanço físico" />} onClick={() => onOpenTab('timeline')} />
      <Cell label="Saúde" tone={health ? HEALTH_TONE[health.level] ?? 'neutral' : 'neutral'} value={health ? HEALTH_LABEL[health.level] : '—'}
        sub={health?.reasons[0]?.text ?? (health ? 'sem bloqueio' : undefined)} onClick={() => onOpenTab('overview')} />
      <Cell label="Próximo marco" value={next ? dateShort(next.date) : '—'} sub={next ? next.title : 'nenhum marco futuro'} onClick={() => onOpenTab('timeline')} />
      <Cell label="Autorização" value={os ? <Link className="ax-link" href={href.serviceOrder(os.id)}>{os.osNumber}</Link> : 'sem OS vinculada'}
        sub={os ? `OS ${serviceOrderStatusLabels[os.status].toLowerCase()}` : 'o projeto nasce da OS emitida'}
        tone={os ? (os.nextAction.tone === 'danger' ? 'danger' : 'neutral') : 'warning'} />
      {facts.revenue && (
        <Cell label="Contrato" value={facts.revenue.contract} sub={`faturado ${facts.revenue.billed} · a faturar ${facts.revenue.toBill}`}
          title={facts.revenue.source} onClick={() => onOpenTab('finance')} />
      )}
    </section>
  );
}

function Cell({ label, value, sub, tone, extra, onClick, title }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; extra?: ReactNode; onClick?: () => void; title?: string;
}) {
  const body = (
    <>
      <span className="ax-glance-label">{tone && tone !== 'neutral' ? <i data-tone={tone} aria-hidden /> : null}{label}</span>
      <strong className="ax-glance-value">{value}</strong>
      {extra}
      {sub && <small className="ax-glance-sub">{sub}</small>}
    </>
  );
  return onClick
    ? <button type="button" className="ax-glance-cell" data-tone={tone} onClick={onClick} title={title}>{body}</button>
    : <div className="ax-glance-cell" data-tone={tone} title={title}>{body}</div>;
}
