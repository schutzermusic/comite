'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { ProjectPlanningModel } from '@/lib/operations/planning/read-model';
import { MEASUREMENT_LANE_LABEL, type MeasurementLane } from '@/lib/operations/overview-rules';
import { serviceOrderStatusLabels } from '@/lib/operations/service-orders/labels';
import {
  ApexFindings, AttentionRow, Chip, EmptyState, ErrorState, Plane, SignalStrip, Skeleton, dateShort, daysBetween, href, money, plural,
  relativeDue, useResource,
} from '@/components/ax';
import { ReadinessChip, ReadinessStrip } from '../planning/shared';
import type { ProjectOverviewPayload } from './ProjectGlance';

const LANES: MeasurementLane[] = ['PREPARE_EVIDENCE', 'CORRECTION', 'INTERNAL_REVIEW', 'SEND_TO_CUSTOMER', 'AWAITING_CUSTOMER', 'BILLING_ELIGIBLE'];
type Planning = ProjectPlanningModel & { ok: true; capabilities: { manage: boolean } };

/**
 * VISÃO GERAL DO PROJETO — a hierarquia do plano, nessa ordem: o que trava →
 * as próximas frentes e se estão prontas → a autorização (OS) → a medição →
 * a equipe → exposição financeira (só com leitura financeira). Tudo derivado
 * do cronograma, das OS, das medições, dos riscos e das alocações canônicas.
 */
export function ProjectOverviewTab({ projectId, overview, onOpenTab }: {
  projectId: string;
  overview: { data: ProjectOverviewPayload | null; state: string; message: string | null; refresh: () => void };
  onOpenTab: (tab: string) => void;
}) {
  const planning = useResource<Planning>(`/api/operations/projects/${encodeURIComponent(projectId)}/requirements`);
  if (overview.state === 'error') return <ErrorState message={overview.message} onRetry={overview.refresh} />;
  if (!overview.data) return <Skeleton />;
  const data = overview.data;
  const h = data.health;
  const plan = planning.data;
  const liveNeeds = (plan?.requirements ?? []).filter((r) => r.status === 'PLANNED' || r.status === 'CONFIRMED');
  const materialShort = liveNeeds.filter((r) => r.readiness === 'SHORTAGE' || r.readiness === 'PARTIAL').length;
  const unreadyFronts = (plan?.activities ?? []).filter((a) => a.start && a.start >= data.today && daysBetween(data.today, a.start) <= 14)
    .filter((a) => { const mine = liveNeeds.filter((r) => r.activity_id === a.id); return !mine.length || mine.some((r) => r.readiness !== 'READY'); }).length;

  return (
    <section className="ax-stack" aria-label="Visão geral do projeto" data-testid="project-overview">
      {/* Estado, saúde, avanço e próximo marco já estão no cabeçalho; aqui, o que pede ação nesta frente de trabalho. */}
      <SignalStrip label="Sinais do projeto" items={[
        { label: 'Atividades críticas', value: data.schedule.critical, tone: data.schedule.critical ? 'danger' : undefined,
          hint: `${plural(data.schedule.overdue, 'vencida', 'vencidas')} · ${plural(data.schedule.blocked, 'bloqueada', 'bloqueadas')}`,
          onClick: () => onOpenTab('timeline') },
        { label: 'Frentes sem prontidão', value: planning.data ? unreadyFronts : '—', tone: unreadyFronts ? 'warning' : undefined,
          hint: 'começam em 14 dias com necessidade pendente ou sem nenhuma registrada', onClick: () => onOpenTab('timeline') },
        { label: 'Material sem cobertura', value: planning.data ? materialShort : '—', tone: materialShort ? 'danger' : undefined,
          hint: 'falta ou cobertura parcial do Supply', onClick: () => onOpenTab('supply') },
        ...(data.measurements ? [{ label: 'Medições pendentes', value: data.measurements.pending,
          tone: data.measurements.pending ? 'warning' as const : undefined,
          hint: data.measurements.next ? `próxima: ${data.measurements.next.key} · ${dateShort(data.measurements.next.expected)}` : 'nenhuma medição a preparar',
          onClick: () => onOpenTab('measurements') }] : []),
      ]} />

      <div className="ax-grid main-side">
        <div className="ax-stack">
          <Plane flush title="Bloqueios críticos" count={data.blockers.length} countTone={data.blockers.some((b) => b.tone === 'danger') ? 'danger' : undefined}
            subtitle={h.reasons.length ? h.reasons.map((r) => r.text).join(' · ') : 'Atividade crítica, vencida ou bloqueada, e risco alto/crítico aberto'}>
            {data.blockers.length ? (
              <div className="ax-queue">
                {data.blockers.map((b) => (
                  <AttentionRow key={b.id} tone={b.tone} kind={b.kind === 'risk' ? 'Risco' : 'Atividade'} object={b.title} issue={b.issue}
                    due={b.due} owner={b.owner} today={data.today}
                    action={<button type="button" className="ax-btn sm" onClick={() => onOpenTab(b.kind === 'risk' ? 'risks' : 'timeline')}>
                      Abrir<ArrowUpRight size={13} aria-hidden /></button>} />
                ))}
              </div>
            ) : <EmptyState compact title="Nenhum bloqueio crítico">Nenhuma atividade crítica, vencida ou bloqueada, e nenhum risco alto/crítico aberto.</EmptyState>}
          </Plane>
          <NextFronts planning={planning.data} today={data.today} onOpenTab={onOpenTab} />
        </div>

        <div className="ax-stack">
          <ApexFindings projectId={projectId} limit={3} title="Apex — neste projeto" />
          <Plane flush title="Autorização do trabalho" subtitle="A OS interna que autoriza este projeto — e o pacote PT + PC por trás dela"
            action={<Link className="ax-btn ghost sm" href="/operacoes/ordens-servico">Fila de OS</Link>}>
            {data.serviceOrders.length ? (
              <ul className="ax-mini">
                {data.serviceOrders.map((o) => (
                  <li key={o.id}>
                    <span><Link className="ax-link" href={href.serviceOrder(o.id)}>{o.osNumber}</Link><small>{o.title}</small></span>
                    <span className="ax-mini-side">
                      <Chip tone={o.nextAction.tone === 'danger' ? 'danger' : o.nextAction.tone === 'warning' ? 'warning' : 'success'}>{serviceOrderStatusLabels[o.status]}</Chip>
                      <Link className="ax-link" href={href.serviceOrder(o.id, 'comparacao')}>OS × PT × PC</Link>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState compact title="Nenhuma OS interna vinculada">O projeto nasce da OS emitida — vincule pela fila de OS.</EmptyState>}
          </Plane>
          <Plane flush title="Medições & evidências" subtitle="As mesmas medições da aba Medições — por quem tem o próximo passo"
            action={data.measurements?.total ? <button type="button" className="ax-btn ghost sm" onClick={() => onOpenTab('measurements')}>Abrir</button> : undefined}>
            {data.measurements ? (
              data.measurements.total ? (
                <ul className="ax-mini">
                  {LANES.filter((l) => data.measurements!.lanes[l]).map((lane) => (
                    <li key={lane}><span>{MEASUREMENT_LANE_LABEL[lane]}</span><strong className="ax-num">{data.measurements!.lanes[lane]}</strong></li>
                  ))}
                </ul>
              ) : <EmptyState compact title="Nenhuma medição planejada" />
            ) : <EmptyState compact title="Leitura de medições restrita para o seu papel" />}
          </Plane>
          <Plane flush title="Equipe" action={<button type="button" className="ax-btn ghost sm" onClick={() => onOpenTab('team')}>Abrir</button>}>
            {data.team ? (
              data.team.allocated ? (
                <ul className="ax-mini">
                  {data.team.people.map((p, i) => (
                    <li key={i}><span>{p.name}{p.role && <small>{p.role}</small>}</span><strong className="ax-num">{p.percent}%</strong></li>
                  ))}
                  {data.team.pending > 0 && <li><span className="ax-subtle">{plural(data.team.pending, 'alocação aguardando aprovação', 'alocações aguardando aprovação')}</span></li>}
                </ul>
              ) : <EmptyState compact title="Nenhuma pessoa alocada ativamente" />
            ) : <EmptyState compact title="Leitura de alocações restrita para o seu papel" />}
          </Plane>
          {data.financial && (
            <Plane title="Exposição financeira das medições" subtitle="Visível só com leitura financeira do projeto">
              <ul className="ax-mini" style={{ margin: '-4px 0' }}>
                <li><span>Aceito pelo cliente</span><strong className="ax-num">{money(data.financial.accepted, data.financial.currency)}</strong></li>
                <li><span>Em trânsito (submetido → aceite)</span><strong className="ax-num">{money(data.financial.inFlight, data.financial.currency)}</strong></li>
              </ul>
            </Plane>
          )}
        </div>
      </div>
      <p className="ax-note">Visão derivada do cronograma, das OS, das medições, dos riscos e das alocações canônicas deste projeto — nada é copiado para o projeto.</p>
    </section>
  );
}

/** As próximas frentes do cronograma com a prontidão delas — o elo entre o plano e o que o Supply e a equipe precisam entregar. */
function NextFronts({ planning, today, onOpenTab }: { planning: Planning | null; today: string; onOpenTab: (tab: string) => void }) {
  const readiness = new Map((planning?.readinessByActivity ?? []).map((a) => [a.activityId, a]));
  const fronts = (planning?.activities ?? [])
    .filter((a) => a.start && a.start >= today)
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    .slice(0, 5);
  const needsOf = (activityId: string) => (planning?.requirements ?? []).filter((r) => r.activity_id === activityId
    && (r.status === 'PLANNED' || r.status === 'CONFIRMED'));
  return (
    <Plane flush title="Próximas frentes" testId="project-next-fronts"
      subtitle="O que começa a seguir e se está pronto: equipe, material, equipamento, documento, cliente"
      action={<button type="button" className="ax-btn ghost sm" onClick={() => onOpenTab('timeline')}>Planejamento</button>}>
      {!planning ? <div style={{ padding: 16 }}><Skeleton /></div> : fronts.length === 0 ? (
        <EmptyState compact title="Nenhuma frente futura no cronograma" />
      ) : (
        <div>
          {fronts.map((a) => {
            const r = readiness.get(a.id);
            const needs = needsOf(a.id);
            const pending = needs.filter((n) => n.readiness !== 'READY');
            const start = relativeDue(a.start, today);
            return (
              <div key={a.id} className="ax-front" data-tone={!needs.length && (start.days ?? 99) <= 14 ? 'warning'
                : r?.overall === 'SHORTAGE' || r?.overall === 'OVERDUE' ? 'danger' : pending.length ? 'warning' : 'neutral'}>
                <div className="ax-front-when"><strong>{dateShort(a.start)}</strong><small>{start.text}</small></div>
                <div className="ax-front-main">
                  <span className="ax-row-eyebrow"><span className="ax-kind">{a.milestone ? 'Marco' : a.wbs ? `EAP ${a.wbs}` : 'Atividade'}</span></span>
                  <span className="ax-row-object">{a.title}</span>
                  <span className="ax-row-issue">{needs.length ? `${plural(needs.length, 'necessidade', 'necessidades')}${pending.length ? ` · ${pending.length} sem prontidão` : ' · tudo pronto'}`
                    : 'Nenhuma necessidade registrada — planeje antes do início.'}</span>
                  <ReadinessStrip cells={r?.cells ?? {}} label={`Prontidão de ${a.title}`} />
                </div>
                <div className="ax-front-state"><ReadinessChip value={r?.overall ?? null} /></div>
              </div>
            );
          })}
        </div>
      )}
    </Plane>
  );
}
