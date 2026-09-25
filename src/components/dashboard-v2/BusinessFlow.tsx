'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { FlowStage } from '@/lib/dashboard/types';

/**
 * FLUXO DO NEGÓCIO — um mapa de gargalos, não um funil.
 *
 * Cada etapa conta O QUE ESTÁ PARADO nela, com o substantivo ("3 aceitas sem
 * OS"), e abre a área que resolve. As unidades mudam de etapa para etapa
 * (propostas, OS, requisitos, medições…), por isso não há setas de volume:
 * o trilho é a ordem do trabalho, da proposta ao caixa. "Restrito" e "sem
 * fonte" são estados, nunca zero.
 */
export function BusinessFlow({ stages, hasOperation }: { stages: FlowStage[]; hasOperation: boolean }) {
  const stuck = stages.filter((s) => s.state === 'ok' && (s.stuck?.value ?? 0) > 0);
  const calm = stages.filter((s) => !stuck.includes(s));
  // Sem operação nenhuma, a primeira etapa legível é por onde tudo começa.
  const start = !hasOperation ? stages.find((s) => s.state === 'ok')?.id : undefined;
  return (
    <section className="dv2-flow" aria-labelledby="dv2-flow-title" data-testid="dashboard-flow">
      <div className="dv2-flow-head">
        <div>
          <h2 id="dv2-flow-title">Fluxo do negócio</h2>
          <p>Onde o trabalho está parado, da proposta ao caixa — cada etapa abre a área que resolve.</p>
        </div>
        <span className="dv2-flow-summary">
          {stuck.length === 0 ? 'Nenhuma etapa com pendência' : `${stuck.length} de ${stages.length} etapas com pendência`}
        </span>
      </div>

      <ol className="dv2-rail" aria-label="Etapas do fluxo do negócio">
        {stages.map((s) => (
          <li key={s.id} className="dv2-stage" data-state={s.state} data-tone={s.state === 'ok' ? s.tone : 'neutral'}
            data-stuck={s.state === 'ok' && (s.stuck?.value ?? 0) > 0 ? 'true' : undefined}
            data-start={start === s.id ? 'true' : undefined}>
            <StageBody stage={s} />
          </li>
        ))}
      </ol>

      <div className="dv2-flow-list" aria-label="Etapas com pendência">
        {stuck.length === 0 ? (
          <p className="dv2-flow-calm">{hasOperation ? 'Nenhuma etapa com trabalho parado.' : 'Ainda não há operação em nenhuma etapa.'}</p>
        ) : (
          <ol>
            {stuck.map((s) => (
              <li key={s.id} className="dv2-stage" data-state={s.state} data-tone={s.tone} data-stuck="true"><StageBody stage={s} /></li>
            ))}
          </ol>
        )}
        {calm.length > 0 && (
          <details className="dv2-flow-more">
            <summary>{calm.length === 1 ? '1 etapa sem pendência' : `${calm.length} etapas sem pendência`}</summary>
            <ol>
              {calm.map((s) => (
                <li key={s.id} className="dv2-stage" data-state={s.state} data-tone={s.state === 'ok' ? s.tone : 'neutral'}><StageBody stage={s} /></li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </section>
  );
}

function StageBody({ stage: s }: { stage: FlowStage }) {
  const inner = (
    <>
      <span className="dv2-node" aria-hidden />
      <span className="dv2-stage-label">{s.label}</span>
      <StageValue stage={s} />
      {s.state === 'ok' && s.context && <span className="dv2-stage-context">{s.context}</span>}
    </>
  );
  const title = [s.definition, s.reason].filter(Boolean).join(' — ');
  if (s.href && s.state !== 'unavailable') {
    return <Link href={s.href} className="dv2-stage-body" title={title} aria-label={ariaFor(s)}>{inner}</Link>;
  }
  return <div className="dv2-stage-body" title={title} aria-label={ariaFor(s)} role="group">{inner}</div>;
}

function StageValue({ stage: s }: { stage: FlowStage }) {
  if (s.state === 'restricted') {
    return <span className="dv2-stage-value muted"><Lock size={13} aria-hidden />Restrito</span>;
  }
  if (s.state === 'unavailable') {
    return <span className="dv2-stage-value muted">—<small>{s.reason ?? 'sem fonte canônica'}</small></span>;
  }
  if (s.state === 'error') {
    return <span className="dv2-stage-value muted">—<small>não carregou</small></span>;
  }
  const n = s.stuck?.value ?? 0;
  return (
    <span className="dv2-stage-value" data-zero={n === 0 ? 'true' : undefined}>
      <b className="num">{n.toLocaleString('pt-BR')}</b>
      {s.stuck?.noun && <small>{s.stuck.noun}</small>}
    </span>
  );
}

function ariaFor(s: FlowStage): string {
  if (s.state === 'restricted') return `${s.label}: restrito ao seu perfil`;
  if (s.state === 'unavailable') return `${s.label}: ${s.reason ?? 'sem fonte canônica'}`;
  if (s.state === 'error') return `${s.label}: não carregou`;
  const n = s.stuck?.value ?? 0;
  return `${s.label}: ${n} ${s.stuck?.noun ?? ''}${s.context ? ` — ${s.context}` : ''}`.trim();
}
