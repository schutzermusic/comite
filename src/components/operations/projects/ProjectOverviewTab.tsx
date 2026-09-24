'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { HudButton } from '@/components/hud';
import type { ProjectOverviewModel, ProjectAccess } from '@/lib/operations/projects/read-model';
import { HEALTH_LABEL } from '@/lib/operations/projects/health';
import { MEASUREMENT_LANE_LABEL, type MeasurementLane } from '@/lib/operations/overview-rules';
import { serviceOrderStatusLabels } from '@/lib/operations/service-orders/labels';
import {
  EmptyNote, GovernanceNote, Metrics, Panel, ResourceState, StatePill, brl, day, useOperationsResource,
} from '../ui';

type Payload = ProjectOverviewModel & { ok: true; access: ProjectAccess };

const LANES: MeasurementLane[] = ['PREPARE_EVIDENCE', 'CORRECTION', 'INTERNAL_REVIEW', 'SEND_TO_CUSTOMER', 'AWAITING_CUSTOMER', 'BILLING_ELIGIBLE'];

/**
 * VISÃO GERAL DO PROJETO — a hierarquia do plano, nessa ordem:
 * próximo marco → bloqueios → avanço → medição → equipe → exposição financeira
 * (só com leitura financeira). Nada de grade de cartões de peso igual.
 */
export function ProjectOverviewTab({ projectId, onOpenTab }: { projectId: string; onOpenTab: (tab: string) => void }) {
  const { data, state, message } = useOperationsResource<Payload>(`/api/operations/projects/${encodeURIComponent(projectId)}/overview`);
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const h = data.health;
  const tone = h.level === 'critical' ? 'danger' : h.level === 'attention' ? 'warning' : h.level === 'healthy' ? 'success' : 'neutral';
  const next = data.nextMilestones[0];

  return (
    <section className="crm-workspace ops-workspace" aria-label="Visão geral do projeto" data-testid="project-overview">
      <Metrics
        items={[
          { label: 'Saúde', value: HEALTH_LABEL[h.level], tone,
            hint: h.reasons.length ? h.reasons.slice(0, 2).map((r) => r.text).join(' · ') : 'Sem bloqueio no cronograma, OS, medição ou risco' },
          { label: 'Próximo marco', value: next ? day(next.date) : '—', accent: Boolean(next),
            hint: next ? next.title : 'Nenhum marco futuro no cronograma', onClick: () => onOpenTab('timeline') },
          { label: 'Avanço físico', value: data.progress.percent === null ? '—' : `${data.progress.percent.toLocaleString('pt-BR')}%`,
            meter: data.progress.percent === null ? null : data.progress.percent / 100,
            hint: data.progress.total ? `${data.progress.done} de ${data.progress.total} atividade(s) concluída(s)` : 'Cronograma não importado' },
          { label: 'Atividades críticas', value: data.schedule.critical, tone: data.schedule.critical ? 'danger' : 'neutral',
            hint: `${data.schedule.overdue} vencida(s) · ${data.schedule.blocked} bloqueada(s)`, onClick: () => onOpenTab('timeline') },
          ...(data.measurements ? [{ label: 'Medições pendentes', value: data.measurements.pending,
            tone: data.measurements.pending ? 'warning' as const : 'neutral' as const,
            hint: data.measurements.next ? `Próxima: ${data.measurements.next.key} · ${day(data.measurements.next.expected)}` : 'Nenhuma medição a preparar',
            onClick: () => onOpenTab('measurements') }] : []),
        ]}
      />

      <div className="crm-split">
        <Panel title="Bloqueios críticos" note={h.reasons.length ? h.reasons.map((r) => r.text).join(' · ') : undefined}>
          {data.blockers.length ? (
            <div className="ops-attention">
              {data.blockers.map((b) => (
                <div key={b.id} className="ops-attention-row" data-tone={b.tone}>
                  <div className="min-w-0">
                    <strong>{b.title}</strong>
                    <p className="ops-attention-issue">{b.issue}</p>
                    <p className="ops-attention-meta">
                      {b.due && <span className={b.due < data.today ? 'ops-overdue' : undefined}>{b.due < data.today ? 'Venceu' : 'Prazo'} {day(b.due)}</span>}
                      <span>{b.owner ?? 'Sem responsável'}</span>
                    </p>
                  </div>
                  <HudButton variant="ghost" size="sm" onClick={() => onOpenTab(b.kind === 'risk' ? 'risks' : 'timeline')}>
                    Abrir <ArrowUpRight size={13} />
                  </HudButton>
                </div>
              ))}
            </div>
          ) : <EmptyNote title="Nenhum bloqueio crítico" description="Nenhuma atividade crítica, vencida ou bloqueada, e nenhum risco alto/crítico aberto." />}
        </Panel>

        <div className="grid gap-3 min-w-0">
          <Panel title="Próximos marcos">
            {data.nextMilestones.length ? (
              <ul className="crm-linked-list">
                {data.nextMilestones.map((m) => (
                  <li key={m.id}><div><p>{m.title}</p>{m.wbs && <p className="crm-muted">WBS {m.wbs}</p>}</div>
                    <strong className="tabular-nums">{day(m.date)}</strong></li>
                ))}
              </ul>
            ) : <div className="crm-section-empty">Nenhum marco futuro no cronograma.</div>}
          </Panel>
          <Panel title="Ordens de Serviço" aside={<Link href="/operacoes/ordens-servico"><HudButton variant="ghost" size="sm">Fila de OS</HudButton></Link>}>
            {data.serviceOrders.length ? (
              <ul className="crm-linked-list">
                {data.serviceOrders.map((o) => (
                  <li key={o.id}>
                    <div><Link href={`/operacoes/ordens-servico/${o.id}`} className="crm-row-open">{o.osNumber}</Link>
                      <p className="crm-muted">{o.title}</p></div>
                    <StatePill tone={o.nextAction.tone === 'danger' ? 'danger' : o.nextAction.tone === 'warning' ? 'warning' : 'success'}>
                      {serviceOrderStatusLabels[o.status]}
                    </StatePill>
                  </li>
                ))}
              </ul>
            ) : <div className="crm-section-empty">Nenhuma OS interna vinculada a este projeto.</div>}
          </Panel>
        </div>
      </div>

      <div className="crm-split">
        <Panel title="Medições & evidências" note="Mesmas medições da aba Medições — por quem tem o próximo passo">
          {data.measurements ? (
            data.measurements.total ? (
              <ul className="crm-linked-list">
                {LANES.map((lane) => (
                  <li key={lane}><div><p>{MEASUREMENT_LANE_LABEL[lane]}</p></div>
                    <strong className="tabular-nums">{data.measurements!.lanes[lane] ?? 0}</strong></li>
                ))}
              </ul>
            ) : <div className="crm-section-empty">Nenhuma medição planejada para este projeto.</div>
          ) : <div className="crm-section-empty">Leitura de medições restrita para o seu papel.</div>}
        </Panel>
        <Panel title="Equipe" aside={<HudButton variant="ghost" size="sm" onClick={() => onOpenTab('team')}>Abrir equipe</HudButton>}>
          {data.team ? (
            data.team.allocated ? (
              <ul className="crm-linked-list">
                {data.team.people.map((p, i) => (
                  <li key={i}><div><p>{p.name}</p>{p.role && <p className="crm-muted">{p.role}</p>}</div>
                    <strong className="tabular-nums">{p.percent}%</strong></li>
                ))}
                {data.team.pending > 0 && <li><div><p className="crm-muted">{data.team.pending} alocação(ões) aguardando aprovação</p></div></li>}
              </ul>
            ) : <div className="crm-section-empty">Nenhuma pessoa alocada ativamente.</div>
          ) : <div className="crm-section-empty">Leitura de alocações restrita para o seu papel.</div>}
        </Panel>
      </div>

      {data.financial && (
        <Panel title="Exposição financeira (medições)" note="Visível só com leitura financeira do projeto">
          <dl className="ops-summary-grid">
            <div><dt>Aceito pelo cliente</dt><dd className="tabular-nums">{brl(data.financial.accepted, data.financial.currency)}</dd></div>
            <div><dt>Em trânsito (submetido → aceite)</dt><dd className="tabular-nums">{brl(data.financial.inFlight, data.financial.currency)}</dd></div>
          </dl>
        </Panel>
      )}

      <GovernanceNote>
        Visão derivada do cronograma, das OS, das medições, dos riscos e das alocações canônicas deste projeto — nada é copiado para o projeto.
        Prontidão de materiais entra aqui quando o Planejamento confirmar requisitos de material.
      </GovernanceNote>
    </section>
  );
}
