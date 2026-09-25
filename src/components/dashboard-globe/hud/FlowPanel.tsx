'use client';

import Link from 'next/link';
import { Lock, Workflow } from 'lucide-react';
import type { FlowStage } from '@/lib/dashboard/types';
import { ariaFor, flowSummary, groupOf } from '@/components/dashboard-v2/BusinessFlow';

/**
 * FLUXO DO NEGÓCIO, compacto (coluna direita do portfólio): as 11 etapas na
 * ordem do trabalho, da proposta ao caixa, cada uma com o que está PARADO
 * nela. Mesma leitura do trilho completo (`flowSummary`/`groupOf`): etapa
 * restrita diz "Restrito", a que não carregou diz "não carregou", a `ok` sem
 * número diz por quê — nenhuma vira 0 nem "sem pendência".
 */
export function FlowPanel({ stages, hasOperation }: { stages: FlowStage[]; hasOperation: boolean | null }) {
  const f = flowSummary(stages, hasOperation);
  return (
    <section className="dg-panel dg-flow" aria-labelledby="dg-flow-title" data-testid="dashboard-flow">
      <div className="dg-eyebrow"><Workflow size={14} aria-hidden className="dg-ico" /><span id="dg-flow-title">Fluxo do negócio</span></div>
      <p className="dg-flow-summary">{f.summary}</p>
      {f.stuck.length === 0 && <p className="dg-flow-calm">{f.calmText}</p>}
      <ol className="dg-flow-list" aria-label="Etapas do fluxo do negócio">
        {stages.map((s) => <Stage key={s.id} stage={s} start={f.start === s.id} />)}
      </ol>
    </section>
  );
}

function Stage({ stage: s, start }: { stage: FlowStage; start: boolean }) {
  const group = groupOf(s);
  const tone = group === 'stuck' ? s.tone : group === 'calm' ? 'calm' : 'muted';
  const title = [s.definition, s.reason, s.partial ? 'Leitura com limite de linhas: o número é um piso.' : null].filter(Boolean).join(' — ');
  const inner = (
    <>
      <i className="dg-node" aria-hidden />
      <span className="dg-stage-label">{s.label}</span>
      <Value stage={s} />
    </>
  );
  return (
    <li className="dg-stage" data-group={group} data-tone={tone} data-start={start ? 'true' : undefined}>
      {s.href && s.state !== 'unavailable'
        ? <Link href={s.href} title={title} aria-label={ariaFor(s)}>{inner}</Link>
        : <div role="group" title={title} aria-label={ariaFor(s)}>{inner}</div>}
    </li>
  );
}

function Value({ stage: s }: { stage: FlowStage }) {
  if (s.state === 'restricted' || (s.state === 'ok' && s.stuck === null && s.noNumber === 'restricted')) {
    return <span className="dg-stage-value muted"><Lock size={11} aria-hidden />Restrito</span>;
  }
  if (s.state === 'error' || (s.state === 'ok' && s.stuck === null && s.noNumber === 'error')) {
    return <span className="dg-stage-value muted">não carregou</span>;
  }
  if (s.state === 'unavailable') return <span className="dg-stage-value muted">sem fonte</span>;
  if (s.stuck === null) return <span className="dg-stage-value muted">sem número</span>;
  const n = s.stuck.value;
  return (
    <span className="dg-stage-value" data-zero={n === 0 && !s.partial ? 'true' : undefined}>
      <b className="num">{s.partial ? '≥ ' : ''}{n.toLocaleString('pt-BR')}</b>
      {s.stuck.noun && <small>{s.stuck.noun}</small>}
    </span>
  );
}
