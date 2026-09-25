'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import type { FlowStage } from '@/lib/dashboard/types';

/**
 * Onde a etapa entra na contagem. Só etapa LEGÍVEL com número conta como
 * "com pendência" ou "sem pendência"; restrita, que não carregou ou sem fonte
 * é contada à parte — nunca vira "sem pendência".
 *
 * Uma etapa `ok` sem número (`stuck: null`, ex.: Comercial com "autorizadas
 * sem OS" restrito ou que falhou; Planejamento com o cronograma lido em parte)
 * segue a chave `noNumber` do servidor — restrito, não carregou, ou só "sem número".
 */
type StageGroup = 'stuck' | 'calm' | 'restricted' | 'failed' | 'nonumber' | 'unavailable';

const noNumberRestricted = (s: FlowStage) => s.noNumber === 'restricted';
const noNumberFailed = (s: FlowStage) => s.noNumber === 'error';

function groupOf(s: FlowStage): StageGroup {
  if (s.state === 'restricted') return 'restricted';
  if (s.state === 'error') return 'failed';
  if (s.state === 'unavailable') return 'unavailable';
  if (s.stuck === null) return noNumberRestricted(s) ? 'restricted' : noNumberFailed(s) ? 'failed' : 'nonumber';
  return s.stuck.value > 0 ? 'stuck' : 'calm';
}

const restrictedText = (n: number) => (n === 1 ? '1 restrita' : `${n} restritas`);
const failedText = (n: number) => (n === 1 ? '1 não carregou' : `${n} não carregaram`);
const noNumberText = (n: number) => `${n} sem número`;
const unavailableText = (n: number) => `${n} sem fonte`;

/**
 * FLUXO DO NEGÓCIO — um mapa de gargalos, não um funil.
 *
 * Cada etapa conta O QUE ESTÁ PARADO nela, com o substantivo ("3 aceitas sem
 * OS"), e abre a área que resolve. As unidades mudam de etapa para etapa
 * (propostas, OS, requisitos, medições…), por isso não há setas de volume:
 * o trilho é a ordem do trabalho, da proposta ao caixa. "Restrito" e "sem
 * fonte" são estados, nunca zero — e nunca "sem pendência".
 */
export function BusinessFlow({ stages, hasOperation }: { stages: FlowStage[]; hasOperation: boolean | null }) {
  const by = (g: StageGroup) => stages.filter((s) => groupOf(s) === g);
  const stuck = by('stuck');
  const calm = by('calm');
  const restricted = by('restricted');
  const failed = by('failed');
  const noNumber = by('nonumber');
  const unavailable = by('unavailable');
  const unread = [...restricted, ...failed, ...noNumber, ...unavailable];
  const legible = stuck.length + calm.length;
  // "Sem fonte" (Caixa) não é falha nem restrição: fica fora do resumo, mas nunca conta como legível.
  const unreadParts = [
    restricted.length > 0 ? restrictedText(restricted.length) : null,
    failed.length > 0 ? failedText(failed.length) : null,
    noNumber.length > 0 ? noNumberText(noNumber.length) : null,
  ].filter((p): p is string => p !== null);
  const partialRead = unreadParts.length > 0;

  const summary = [
    legible === 0 ? 'Nenhuma etapa legível'
      : stuck.length > 0 ? `${stuck.length} de ${legible} etapas${partialRead ? ' legíveis' : ''} com pendência`
        : !partialRead ? 'Nenhuma etapa com pendência'
          : legible === 1 ? 'Nenhuma pendência na etapa legível' : `Nenhuma pendência nas ${legible} etapas legíveis`,
    ...unreadParts,
  ].join(' · ');

  const calmText = legible === 0
    ? (restricted.length > 0 && failed.length + noNumber.length === 0 ? 'O seu perfil não lê nenhuma etapa do fluxo.'
      : failed.length > 0 && restricted.length + noNumber.length === 0 ? 'As etapas do fluxo não carregaram.'
        : `Nenhuma etapa legível agora${unreadParts.length > 0 ? ` (${unreadParts.join(' · ')})` : ''}.`)
    // "Não há operação" só quando o servidor SABE (todas as leituras de operação responderam vazio).
    : hasOperation === false
      ? (partialRead ? 'Ainda não há operação nas etapas que você lê.' : 'Ainda não há operação em nenhuma etapa.')
      : (partialRead ? 'Nenhuma etapa com trabalho parado entre as que você lê.' : 'Nenhuma etapa com trabalho parado.');

  // Sem operação nenhuma (sabido, não suposto), a primeira etapa legível é por onde tudo começa.
  const start = hasOperation === false ? calm[0]?.id : undefined;
  const unreadSummary = [...unreadParts, unavailable.length > 0 ? unavailableText(unavailable.length) : null]
    .filter(Boolean).join(' · ');

  return (
    <section className="dv2-flow" aria-labelledby="dv2-flow-title" data-testid="dashboard-flow">
      <div className="dv2-flow-head">
        <div>
          <h2 id="dv2-flow-title">Fluxo do negócio</h2>
          <p>Onde o trabalho está parado, da proposta ao caixa — cada etapa abre a área que resolve.</p>
        </div>
        <span className="dv2-flow-summary">{summary}</span>
      </div>

      <ol className="dv2-rail" aria-label="Etapas do fluxo do negócio">
        {stages.map((s) => <StageItem key={s.id} stage={s} start={start === s.id} />)}
      </ol>

      <div className="dv2-flow-list" aria-label="Etapas com pendência">
        {stuck.length === 0 ? (
          <p className="dv2-flow-calm">{calmText}</p>
        ) : (
          <ol>{stuck.map((s) => <StageItem key={s.id} stage={s} />)}</ol>
        )}
        {calm.length > 0 && (
          <details className="dv2-flow-more">
            <summary>{calm.length === 1 ? '1 etapa sem pendência' : `${calm.length} etapas sem pendência`}</summary>
            <ol>{calm.map((s) => <StageItem key={s.id} stage={s} start={start === s.id} />)}</ol>
          </details>
        )}
        {unread.length > 0 && (
          <details className="dv2-flow-more">
            <summary>{unreadSummary}</summary>
            <ol>{unread.map((s) => <StageItem key={s.id} stage={s} />)}</ol>
          </details>
        )}
      </div>
    </section>
  );
}

function StageItem({ stage: s, start }: { stage: FlowStage; start?: boolean }) {
  return (
    <li className="dv2-stage" data-state={s.state} data-tone={s.state === 'ok' ? s.tone : 'neutral'}
      data-stuck={groupOf(s) === 'stuck' ? 'true' : undefined}
      data-nonum={s.state === 'ok' && s.stuck === null ? 'true' : undefined}
      data-start={start ? 'true' : undefined}>
      <StageBody stage={s} />
    </li>
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
  const title = [s.definition, s.reason, s.partial ? 'Leitura com limite de linhas: o número é um piso.' : null]
    .filter(Boolean).join(' — ');
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
  // Etapa legível sem número: o motivo, nunca 0.
  if (s.stuck === null) {
    return noNumberRestricted(s)
      ? <span className="dv2-stage-value muted"><Lock size={13} aria-hidden />Restrito{s.reason && <small>{s.reason}</small>}</span>
      : <span className="dv2-stage-value muted">—<small>{s.reason ?? 'sem número nesta leitura'}</small></span>;
  }
  const n = s.stuck.value;
  return (
    <span className="dv2-stage-value" data-zero={n === 0 && !s.partial ? 'true' : undefined}>
      <b className="num">{s.partial ? '≥ ' : ''}{n.toLocaleString('pt-BR')}</b>
      {s.stuck.noun && <small>{s.stuck.noun}</small>}
    </span>
  );
}

function ariaFor(s: FlowStage): string {
  if (s.state === 'restricted') return `${s.label}: restrito ao seu perfil`;
  if (s.state === 'unavailable') return `${s.label}: ${s.reason ?? 'sem fonte canônica'}`;
  if (s.state === 'error') return `${s.label}: não carregou`;
  const ctx = s.context ? ` — ${s.context}` : '';
  if (s.stuck === null) return `${s.label}: ${s.reason ?? 'sem número nesta leitura'}${ctx}`;
  return `${s.label}: ${s.partial ? 'ao menos ' : ''}${s.stuck.value} ${s.stuck.noun}${ctx}`.trim();
}
