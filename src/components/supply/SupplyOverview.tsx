'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { HudButton } from '@/components/hud';
import type { SupplyOverviewModel } from '@/lib/supply/read-model';
import { SUPPLY_RISK_LABEL, type SupplyRisk } from '@/lib/supply/coverage';
import {
  EmptyNote, GovernanceNote, LiveSep, Metrics, Panel, ResourceState, StatePill, WorkspaceHeading, day,
  useOperationsResource, type Tone,
} from '@/components/operations/ui';
import { CoverageBar } from './CoverageBar';

type Payload = SupplyOverviewModel & { ok: true };
const RISK_TONE: Record<SupplyRisk, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'success' };

/**
 * SUPPLY — torre de controle. Começa pela DEMANDA do plano, não por pedido
 * digitado. Cada número abre registros reais; número sem fonte não entra
 * (estoque, pedidos e recebimentos aparecem quando os domínios existirem).
 */
export function SupplyOverview() {
  const { data, state, message } = useOperationsResource<Payload>('/api/supply/overview');
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const k = data.kpis;
  return (
    <section className="crm-workspace ops-workspace" aria-label="Supply Chain · Visão geral" data-testid="supply-overview">
      <WorkspaceHeading
        eyebrow="Supply Chain · Visão geral"
        title="O que a execução precisa e ainda não tem"
        description={<><span><b>{k.demandLines}</b> linha(s) de demanda confirmada</span><LiveSep />
          <span className={k.criticalShortages ? 'crm-tone-danger' : undefined}><b>{k.criticalShortages}</b> falta(s) crítica(s)</span></>}
        action={<Link href="/supply/planejamento-materiais"><HudButton variant="primary" size="sm">Planejamento de Materiais</HudButton></Link>}
      />
      <Metrics items={[
        { label: 'Demanda sem cobertura', value: k.uncovered, tone: k.uncovered ? 'warning' : 'neutral',
          hint: 'Requisitos confirmados com falta', onClick: () => { window.location.href = '/supply/planejamento-materiais'; } },
        { label: 'Faltas críticas', value: k.criticalShortages, tone: k.criticalShortages ? 'danger' : 'neutral',
          hint: 'Falta a 7 dias da necessidade, ou vencida' },
        { label: 'Projetos expostos', value: k.projectsExposed, tone: k.projectsExposed ? 'warning' : 'neutral',
          hint: 'Falta crítica ou alta em algum requisito' },
        { label: 'Totalmente cobertos', value: k.covered, tone: 'success', hint: 'Reservado ou consumido cobre o requerido' },
      ]} />
      <div className="crm-split">
        <Panel title="Risco de supply por projeto" note="O pior requisito decide o projeto">
          {data.projectRisks.length ? (
            <ul className="crm-linked-list">
              {data.projectRisks.map((p) => (
                <li key={p.projectId}>
                  <div><Link href={`/projetos/${encodeURIComponent(p.projectId)}?tab=supply`} className="crm-row-open">{p.project}</Link>
                    <p className="crm-muted">{p.shortages} material(is) com falta{p.nextNeed ? ` · próxima necessidade ${day(p.nextNeed)}` : ''}</p></div>
                  <StatePill tone={RISK_TONE[p.worst]}>{SUPPLY_RISK_LABEL[p.worst]}</StatePill>
                </li>
              ))}
            </ul>
          ) : <EmptyNote title="Nenhum projeto exposto" description="Toda demanda confirmada está coberta ou entrando." />}
        </Panel>
        <Panel title="Faltas críticas" aside={<Link href="/supply/planejamento-materiais"><HudButton variant="ghost" size="sm">Abrir matriz <ArrowUpRight size={13} /></HudButton></Link>}>
          {data.criticalShortages.length ? (
            <ul className="crm-linked-list">
              {data.criticalShortages.slice(0, 10).map((d) => (
                <li key={d.requirementId}>
                  <div className="min-w-0"><p><b>{d.itemCode ?? ''}</b> {d.itemDescription ?? d.title}</p>
                    <p className="crm-muted">{d.project} · necessário {day(d.requiredBy)}</p>
                    <CoverageBar coverage={d.coverage} unit={d.unit} /></div>
                  <StatePill tone={RISK_TONE[d.risk]}>{SUPPLY_RISK_LABEL[d.risk]}</StatePill>
                </li>
              ))}
            </ul>
          ) : <div className="crm-section-empty">Nenhuma falta de material.</div>}
        </Panel>
      </div>
      <GovernanceNote>
        A demanda é o requisito de material confirmado no Planejamento do projeto. Cobertura, falta e risco são derivados das
        alocações ao requisito — nenhum total é digitado ou guardado à parte.
      </GovernanceNote>
    </section>
  );
}
