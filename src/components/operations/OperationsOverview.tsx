'use client';

import Link from 'next/link';
import { ArrowUpRight, MapPinned } from 'lucide-react';
import { HudButton } from '@/components/hud';
import type { OperationsOverview as OverviewData } from '@/lib/operations/overview';
import { MEASUREMENT_LANE_LABEL, type MeasurementLane } from '@/lib/operations/overview-rules';
import {
  EmptyNote, GovernanceNote, LiveSep, Metrics, Panel, ResourceState, WorkspaceHeading, day,
  useOperationsResource,
} from './ui';

type Payload = OverviewData & { ok: true };

const LANE_ORDER: MeasurementLane[] = [
  'PREPARE_EVIDENCE', 'CORRECTION', 'INTERNAL_REVIEW', 'SEND_TO_CUSTOMER', 'AWAITING_CUSTOMER', 'BILLING_ELIGIBLE',
];

const restricted = (value: number | null) => (value === null ? 'Restrito' : value);

/**
 * VISÃO GERAL DE OPERAÇÕES — superfície de controle, não painel decorativo.
 *
 * Cada número tem definição (em `overview-rules.ts`) e leva ao registro. A
 * fila vem antes de qualquer gráfico: o que precisa de decisão, de quem, até
 * quando. Área sem leitura aparece "Restrito", nunca "0".
 */
export function OperationsOverview() {
  const { data, state, message } = useOperationsResource<Payload>('/api/operations/overview');
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const k = data.kpis;
  const lanes = data.measurementLanes;

  return (
    <section className="crm-workspace ops-workspace" aria-label="Visão geral de Operações">
      <WorkspaceHeading
        eyebrow="Operações · Visão geral"
        title="O que está autorizado, o que está travado"
        description={
          <>
            <span><b>{data.attentionTotal}</b> decisão(ões) pendente(s)</span>
            <LiveSep />
            <span className={k.serviceOrdersBlocked ? 'crm-tone-danger' : undefined}>
              <b>{k.serviceOrdersBlocked}</b> OS bloqueada(s)
            </span>
            <LiveSep />
            <span>Hoje, {day(data.today)}</span>
          </>
        }
        action={
          <Link href="/operacoes/ordens-servico">
            <HudButton variant="primary" size="sm">Ordens de Serviço</HudButton>
          </Link>
        }
      />

      <Metrics
        items={[
          { label: 'Projetos ativos', value: restricted(k.activeProjects),
            hint: 'Em andamento ou em planejamento', accent: true,
            onClick: () => { window.location.href = '/projetos'; } },
          { label: 'OS aguardando emissão', value: k.serviceOrdersAwaitingIssue,
            tone: k.serviceOrdersBlocked ? 'danger' : k.serviceOrdersAwaitingIssue ? 'warning' : 'neutral',
            hint: k.serviceOrdersBlocked ? `${k.serviceOrdersBlocked} com divergência bloqueante` : 'Rascunho ou aguardando confirmação',
            onClick: () => { window.location.href = '/operacoes/ordens-servico?filtro=aguardando'; } },
          { label: 'Atividades críticas', value: restricted(k.criticalActivities),
            tone: k.criticalActivities ? 'danger' : 'neutral',
            hint: 'Prioridade crítica, atrasada, bloqueada ou vencida' },
          { label: 'Projetos em risco', value: restricted(k.projectsAtRisk),
            tone: k.projectsAtRisk ? 'warning' : 'neutral',
            hint: 'Atividade crítica ou risco alto/crítico aberto' },
          { label: 'Pendências de medição', value: restricted(k.measurementPending),
            tone: k.measurementPending ? 'warning' : 'neutral',
            hint: 'Evidência vencida, em preparo ou devolvida' },
          { label: 'Material sem cobertura', value: restricted(k.materialUncovered),
            tone: k.materialUncovered ? 'danger' : 'neutral',
            hint: 'Requisitos de material confirmados com falta',
            onClick: () => { window.location.href = '/supply/planejamento-materiais'; } },
        ]}
      />

      <div className="crm-split">
        <Panel
          title="O que precisa de decisão"
          note={data.attentionTotal
            ? `${data.attentionTotal} item(ns) — OS, atividades vencidas, medições devolvidas, riscos sem dono`
            : undefined}
        >
          {data.attention.length ? (
            <div className="ops-attention" data-testid="ops-attention">
              {data.attention.map((item) => (
                <div key={item.id} className="ops-attention-row" data-tone={item.tone}>
                  <div className="min-w-0">
                    <strong>{item.object}</strong>
                    <p className="ops-attention-issue">{item.issue}</p>
                    <p className="ops-attention-meta">
                      {item.impact && <span>{item.impact}</span>}
                      {item.due && (
                        <span className={item.due < data.today ? 'ops-overdue' : undefined}>
                          {item.due < data.today ? 'Venceu' : 'Prazo'} {day(item.due)}
                        </span>
                      )}
                      <span>{item.owner ?? 'Sem responsável'}</span>
                    </p>
                  </div>
                  <Link href={item.href}>
                    <HudButton variant="ghost" size="sm">{item.actionLabel} <ArrowUpRight size={13} /></HudButton>
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <EmptyNote
              title="Nada pendente de decisão"
              description="Nenhuma OS travada, atividade vencida, medição devolvida ou risco material sem dono."
            />
          )}
        </Panel>

        <div className="grid gap-3 min-w-0">
          <Panel title="Medições & evidências" note="Mesmas medições do projeto — por quem tem o próximo passo"
            aside={<Link href="/operacoes/medicoes"><HudButton variant="ghost" size="sm">Abrir fila <ArrowUpRight size={13} /></HudButton></Link>}>
            {lanes ? (
              <ul className="crm-linked-list">
                {LANE_ORDER.map((lane) => (
                  <li key={lane}>
                    <div><p>{MEASUREMENT_LANE_LABEL[lane]}</p></div>
                    <strong className="tabular-nums">{lanes[lane]}</strong>
                  </li>
                ))}
              </ul>
            ) : <div className="crm-section-empty">Leitura de medições restrita para o seu papel.</div>}
          </Panel>
          <Panel
            title="Mapa de operações"
            aside={<Link href="/projetos/operations-3d"><HudButton variant="ghost" size="sm"><MapPinned size={14} /> Abrir mapa</HudButton></Link>}
          >
            {data.map ? (
              <div className="crm-section-empty">
                {data.map.located} de {data.map.activeProjects} projeto(s) ativo(s) com local canônico resolvido
                {data.map.unresolved ? ` · ${data.map.unresolved} aguardando confirmação de local` : ''}.
              </div>
            ) : <div className="crm-section-empty">Leitura de projetos restrita para o seu papel.</div>}
          </Panel>
        </div>
      </div>

      <Panel title="Execução próxima" note="Atividades e marcos do cronograma canônico por janela">
        {data.horizon ? (
          <div className="ops-horizon">
            {([7, 14, 30] as const).map((h) => (
              <section key={h} aria-label={`Próximos ${h} dias`}>
                <h4>Até {h} dias <span>{data.horizon![h].length}</span></h4>
                {data.horizon![h].length ? (
                  <ul>
                    {data.horizon![h].slice(0, 8).map((a) => (
                      <li key={a.id} data-critical={a.critical} data-milestone={a.milestone}>
                        <time>{a.date ? new Date(`${a.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'}</time>
                        <div className="min-w-0">
                          <p title={a.title}>{a.title}</p>
                          <p className="crm-muted">
                            <Link href={`/projetos/${encodeURIComponent(a.projectId)}?tab=timeline`}>{a.project}</Link>
                          </p>
                        </div>
                      </li>
                    ))}
                    {data.horizon![h].length > 8 && <li><span /><p className="crm-muted">+{data.horizon![h].length - 8} na janela</p></li>}
                  </ul>
                ) : <p className="crm-muted">Nada planejado nesta janela.</p>}
              </section>
            ))}
          </div>
        ) : <div className="crm-section-empty">Leitura de cronograma restrita para o seu papel.</div>}
      </Panel>

      <Panel title="Matriz de risco" note="Projeto × tipo de bloqueio — contagens do registro canônico de cada domínio">
        {data.riskMatrix && data.riskMatrix.length ? (
          <div className="crm-table-scroll" role="region" aria-label="Matriz de risco" tabIndex={0}>
            <table className="ops-matrix">
              <thead>
                <tr><th scope="col">Projeto</th><th scope="col">Cronograma</th><th scope="col">Medição</th>
                  <th scope="col">Risco</th><th scope="col">OS / contrato</th></tr>
              </thead>
              <tbody>
                {data.riskMatrix.map((row) => (
                  <tr key={row.projectId}>
                    <td><Link href={`/projetos/${encodeURIComponent(row.projectId)}`}>{row.project}</Link>
                      {row.client && <p className="crm-muted">{row.client}</p>}</td>
                    {[row.schedule, row.measurement, row.risk, row.contract].map((n, i) => (
                      <td key={i}><span className="ops-cell" data-level={n === 0 ? 0 : n > 2 ? 2 : 1}>{n || '—'}</span></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="crm-section-empty">
            {data.riskMatrix ? 'Nenhum projeto ativo com bloqueio de cronograma, medição, risco ou OS.'
                             : 'Leitura de projetos restrita para o seu papel.'}
          </div>
        )}
      </Panel>

      <GovernanceNote>
        Números derivados do cronograma, das medições, dos riscos e das OS canônicas — nenhum é digitado nem guardado à parte.
        Material sem cobertura vem da cobertura derivada do Supply sobre os requisitos confirmados no Planejamento.
      </GovernanceNote>
    </section>
  );
}
