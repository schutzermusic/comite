'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, MapPinned, ShieldCheck } from 'lucide-react';
import type { OperationsOverview as OverviewData } from '@/lib/operations/overview';
import { MEASUREMENT_LANE_LABEL, type MeasurementLane } from '@/lib/operations/overview-rules';
import {
  AttentionRow, AxPage, CommandHeader, Dot, EmptyState, Filters, FlowPipeline, HealthMatrix, HorizonLegend, HorizonTimeline,
  Plane, Resource, SignalStrip, date, dateShort, href, plural, relativeDue, useResource, type HorizonLane, type Tone,
} from '@/components/ax';

type Payload = OverviewData & { ok: true };
type Kind = 'all' | 'service_order' | 'activity' | 'material' | 'dependency' | 'measurement' | 'risk';

const KIND_LABEL: Record<Exclude<Kind, 'all'>, string> = {
  service_order: 'OS', activity: 'Atividade', material: 'Material', dependency: 'Cliente', measurement: 'Medição', risk: 'Risco',
};
const LANES: MeasurementLane[] = ['PREPARE_EVIDENCE', 'CORRECTION', 'INTERNAL_REVIEW', 'SEND_TO_CUSTOMER', 'AWAITING_CUSTOMER', 'BILLING_ELIGIBLE'];

/**
 * CENTRO DE COMANDO DE OPERAÇÕES.
 *
 * A ordem da tela é a ordem da decisão: o que está travado e de quem é a
 * próxima jogada (fila de exceções), por onde a autorização está passando
 * (fluxo da OS e das medições), quem está em risco e por quê (saúde por
 * projeto e matriz de travas), e o que vence nos próximos 30 dias (horizonte).
 * Todo número vem de um registro canônico e leva a ele; o que a pessoa não
 * pode ver aparece "Restrito", nunca zero.
 */
export function OperationsOverview() {
  const res = useResource<Payload>('/api/operations/overview');
  return (
    <AxPage testId="operations-overview">
      <Resource {...res}>{(d) => <Command data={d} />}</Resource>
    </AxPage>
  );
}

function Command({ data }: { data: Payload }) {
  const [kind, setKind] = useState<Kind>('all');
  const [expanded, setExpanded] = useState(false);
  const k = data.kpis;
  const restricted = (v: number | null) => (v === null ? 'Restrito' : v.toLocaleString('pt-BR'));
  const attention = useMemo(() => data.attention.filter((a) => kind === 'all' || a.kind === kind), [data.attention, kind]);
  const counts = useMemo(() => {
    const c: Partial<Record<Kind, number>> = {};
    for (const a of data.attention) c[a.kind as Kind] = (c[a.kind as Kind] ?? 0) + 1;
    return c;
  }, [data.attention]);
  const critical = data.attention.filter((a) => a.tone === 'danger').length;

  const lanes: HorizonLane[] = useMemo(() => {
    if (!data.horizon) return [];
    const byProject = new Map<string, HorizonLane & { weight: number }>();
    const lane = (id: string, label: string) => {
      let l = byProject.get(id);
      if (!l) { l = { id, label, items: [], weight: 0 }; byProject.set(id, l); }
      return l;
    };
    for (const h of [7, 14, 30] as const) {
      for (const a of data.horizon[h]) {
        if (!a.date) continue;
        const l = lane(a.projectId, a.project);
        l.items.push({ id: `a:${a.id}`, date: a.date, title: a.title, kind: a.milestone ? 'milestone' : 'activity',
          tone: a.critical ? 'danger' : a.milestone ? 'accent' : 'neutral', href: href.projectSchedule(a.projectId) });
        l.weight += a.critical ? 3 : 1;
      }
    }
    for (const n of data.needs ?? []) {
      const l = lane(n.projectId, n.project);
      l.items.push({ id: `n:${n.requirementId}`, date: n.date, title: n.short ? 'Necessidade de material SEM cobertura' : 'Necessidade de material coberta',
        kind: 'need', tone: n.short ? 'danger' : 'success', href: href.requirement(n.requirementId) });
      l.weight += n.short ? 3 : 1;
    }
    return Array.from(byProject.values()).sort((a, b) => b.weight - a.weight).slice(0, 8);
  }, [data.horizon, data.needs]);

  const flow = data.osFlow;
  const shown = expanded ? attention : attention.slice(0, 8);

  return (
    <>
      <CommandHeader domain="operations" area="Visão geral" title="Centro de comando operacional"
        context={<>
          <span><strong>{data.attentionTotal}</strong> {data.attentionTotal === 1 ? 'decisão pendente' : 'decisões pendentes'}</span>
          {critical > 0 && <span><Dot tone="danger" label="crítico" /><strong>{critical}</strong> {critical === 1 ? 'crítica' : 'críticas'}</span>}
          <span>Hoje, {date(data.today)}</span>
        </>}
        actions={<>
          <Link className="ax-btn" href={href.map()}><MapPinned size={15} aria-hidden />Mapa de operações</Link>
          <Link className="ax-btn primary" href="/operacoes/ordens-servico">Ordens de Serviço<ArrowUpRight size={14} aria-hidden /></Link>
        </>} />

      <SignalStrip label="Sinais de Operações" items={[
        { label: 'Projetos ativos', value: restricted(k.activeProjects), hint: k.projectsAtRisk ? `${k.projectsAtRisk} em risco` : 'nenhum em risco',
          tone: k.projectsAtRisk ? 'warning' : undefined, href: '/projetos', testId: 'kpi-active-projects' },
        { label: 'Atividades críticas', value: restricted(k.criticalActivities), hint: 'atrasadas, bloqueadas ou vencidas',
          tone: k.criticalActivities ? 'danger' : undefined, href: href.planning('critical') },
        { label: 'OS a emitir', value: k.serviceOrdersAwaitingIssue.toLocaleString('pt-BR'),
          hint: k.serviceOrdersBlocked ? `${k.serviceOrdersBlocked} com bloqueante` : 'nenhuma bloqueada',
          tone: k.serviceOrdersBlocked ? 'danger' : undefined, href: '/operacoes/ordens-servico?filter=awaiting' },
        { label: 'Sem cobertura', value: restricted(k.materialUncovered), hint: 'requisitos de material com falta',
          tone: k.materialUncovered ? 'warning' : undefined, href: href.materialPlanning('short') },
        { label: 'Cliente em atraso', value: restricted(data.customerDependenciesOverdue), hint: 'dependências vencidas',
          tone: data.customerDependenciesOverdue ? 'danger' : undefined, href: href.planning('dependencies') },
        { label: 'Medições pendentes', value: restricted(k.measurementPending), hint: 'a preparar, corrigir ou revisar',
          tone: k.measurementPending ? 'warning' : undefined, href: href.measurements() },
      ]} />

      <div className="ax-grid main-side">
        <Plane title="O que precisa de decisão" count={data.attentionTotal} countTone={critical ? 'danger' : undefined}
          subtitle="Exceções ordenadas por gravidade e prazo — cada linha leva ao registro" flush testId="ops-attention"
          bar={<Filters label="Filtrar por tipo" value={kind} onChange={setKind} options={[
            { id: 'all', label: 'Tudo', count: data.attention.length },
            ...(Object.keys(KIND_LABEL) as Array<Exclude<Kind, 'all'>>).filter((x) => counts[x])
              .map((x) => ({ id: x, label: KIND_LABEL[x], count: counts[x] })),
          ]} />}>
          {attention.length === 0 ? (
            <EmptyState title="Nada pendente de decisão" icon={<ShieldCheck size={18} />}>
              Nenhuma OS travada, atividade vencida, falta de material perto da necessidade, dependência do cliente vencida,
              medição devolvida ou risco material sem dono.
            </EmptyState>
          ) : (
            <div className="ax-queue">
              {shown.map((a) => (
                <AttentionRow key={a.id} tone={a.tone as Tone} kind={KIND_LABEL[a.kind as Exclude<Kind, 'all'>]} object={a.object}
                  issue={a.issue} impact={a.impact} due={a.due} owner={a.owner} href={a.href} actionLabel={a.actionLabel} today={data.today} />
              ))}
              {attention.length > shown.length && (
                <button type="button" className="ax-btn ghost" style={{ margin: 10 }} onClick={() => setExpanded(true)}>
                  Ver mais {attention.length - shown.length}
                </button>
              )}
            </div>
          )}
        </Plane>

        <div className="ax-stack">
          <Plane title="Fluxo da autorização" subtitle="Da proposta aceita à obra: onde cada OS está" flush>
            <FlowPipeline label="Fluxo da OS" steps={[
              { id: 'draft', label: 'Rascunho', count: flow.draft, href: '/operacoes/ordens-servico?filter=draft' },
              { id: 'review', label: 'Em revisão', count: flow.review, tone: flow.blocked ? 'danger' : undefined,
                sub: flow.blocked ? plural(flow.blocked, 'bloqueada', 'bloqueadas') : undefined, href: '/operacoes/ordens-servico?filter=review' },
              { id: 'issued', label: 'Emitida', count: flow.issued, sub: 'sem projeto', tone: flow.issued ? 'warning' : undefined,
                href: '/operacoes/ordens-servico?filter=unlinked' },
              { id: 'linked', label: 'Em obra', count: flow.linked, sub: 'com projeto', href: '/operacoes/ordens-servico?filter=linked' },
            ]} />
          </Plane>

          <Plane title="Medições & evidências" subtitle="Quem tem o próximo passo — mesma medição do projeto" flush
            action={<Link className="ax-btn ghost sm" href={href.measurements()}>Abrir fila</Link>}>
            {!data.measurementLanes ? <EmptyState compact title="Restrito">Seu perfil não lê medições de projeto.</EmptyState>
              : LANES.every((l) => data.measurementLanes![l] === 0) ? (
                <EmptyState compact title="Nenhuma medição em curso">
                  Medições nascem do plano de medição do projeto; a fila se preenche quando a primeira ocorrência vence.
                </EmptyState>
              ) : (
              <ul className="ax-lanes">
                {LANES.map((l) => {
                  const n = data.measurementLanes![l];
                  const max = Math.max(1, ...LANES.map((x) => data.measurementLanes![x]));
                  return (
                    <li key={l}>
                      <Link href={href.measurements(l)}>
                        <span>{MEASUREMENT_LANE_LABEL[l]}</span>
                        <span className="ax-meter" aria-hidden><i style={{ width: `${(n / max) * 100}%` }} /></span>
                        <span className="n" data-tone={l === 'CORRECTION' && n ? 'warning' : undefined}>{n}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Plane>

          <Plane title="Saúde por projeto" subtitle="A pior trava decide" flush
            action={<Link className="ax-btn ghost sm" href={href.map()}><MapPinned size={13} aria-hidden />Mapa</Link>}>
            {!data.projectHealth ? <EmptyState compact title="Restrito">Seu perfil não lê projetos.</EmptyState>
              : data.projectHealth.length === 0 ? <EmptyState compact title="Nenhum projeto ativo">Projetos entram aqui quando a OS é emitida e vinculada.</EmptyState>
                : (
                  <ul className="ax-queue" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {data.projectHealth.slice(0, 7).map((p) => (
                      <li key={p.projectId} className="ax-row" data-tone={p.tone === 'success' ? 'neutral' : p.tone}
                        style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                        <div className="ax-row-main">
                          <Link className="ax-row-object ax-link" style={{ color: 'var(--ax-fg-strong)' }} href={href.project(p.projectId, 'overview')}>{p.project}</Link>
                          <span className="ax-row-issue">{p.reasons.length ? p.reasons.join(' · ') : 'Sem trava aberta'}</span>
                        </div>
                        <span className="ax-row-cell" title="Próximo marco">
                          {p.nextMilestone ? <>◆ {dateShort(p.nextMilestone)}</> : <span className="ax-subtle">sem marco</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
          </Plane>
        </div>
      </div>

      <Plane title="Horizonte de execução" subtitle="Próximos 30 dias — marcos, atividades e necessidades de material por projeto"
        action={<span className="ax-desktop-only"><HorizonLegend /></span>}>
        {!data.horizon ? <EmptyState compact title="Restrito">Seu perfil não lê cronogramas.</EmptyState>
          : lanes.length === 0 ? <EmptyState compact title="Nada planejado nos próximos 30 dias">
              O horizonte se preenche com o cronograma canônico e as necessidades de material confirmadas.</EmptyState>
            : (
              <>
                <div className="ax-desktop-only"><HorizonTimeline today={data.today} lanes={lanes} /></div>
                <ul className="ax-mobile-only ax-queue" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {lanes.flatMap((l) => l.items.map((i) => ({ ...i, project: l.label })))
                    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12).map((i) => (
                      <li key={i.id} className="ax-row" data-tone={i.tone === 'danger' ? 'danger' : 'neutral'} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                        <div className="ax-row-main"><span className="ax-row-object">{i.title}</span><span className="ax-row-issue">{i.project}</span></div>
                        <span className="ax-row-due">{relativeDue(i.date, data.today).text}</span>
                      </li>
                    ))}
                </ul>
              </>
            )}
      </Plane>

      {data.riskMatrix && data.riskMatrix.length > 0 && (
        <Plane title="Matriz de travas" subtitle="Projeto × tipo de bloqueio — o número abre a origem" flush>
          <HealthMatrix caption="Travas por projeto" columns={[
            { key: 'schedule', label: 'Cronograma' }, { key: 'supply', label: 'Supply' }, { key: 'customer', label: 'Cliente' },
            { key: 'measurement', label: 'Medição' }, { key: 'risk', label: 'Risco' }, { key: 'contract', label: 'OS' },
          ]} rows={data.riskMatrix.map((r) => ({
            id: r.projectId, label: r.project, sub: r.client ?? undefined, href: href.project(r.projectId, 'overview'),
            cells: {
              schedule: { n: r.schedule, href: href.projectSchedule(r.projectId) },
              supply: { n: r.supply, href: href.project(r.projectId, 'supply') },
              customer: { n: r.customer, href: href.projectSchedule(r.projectId) },
              measurement: { n: r.measurement, href: href.project(r.projectId, 'measurements') },
              risk: { n: r.risk, href: href.project(r.projectId, 'risks') },
              contract: { n: r.contract, href: '/operacoes/ordens-servico?filter=review' },
            },
          }))} />
        </Plane>
      )}

      <p className="ax-note"><ShieldCheck size={13} aria-hidden />
        {plural(data.attentionTotal, 'exceção', 'exceções')} derivadas do cronograma, das OS, da cobertura de material, das
        dependências do cliente, das medições e dos riscos canônicos — nenhum total é digitado ou guardado à parte.</p>
    </>
  );
}
