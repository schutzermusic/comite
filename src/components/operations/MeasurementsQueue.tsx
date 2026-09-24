'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { MeasurementQueueRow } from '@/lib/operations/measurements-queue';
import { MEASUREMENT_LANE_LABEL, type MeasurementLane } from '@/lib/operations/overview-rules';
import {
  AxPage, Chip, CommandHeader, EmptyState, Filters, FlowPipeline, Plane, Resource, SearchBox, SignalStrip, dateShort, money, plural,
  relativeDue, useResource, useUrlParam, type Tone,
} from '@/components/ax';

type Payload = { ok: true; today: string; canSeeValues: boolean; measurements: MeasurementQueueRow[] };
type Row = MeasurementQueueRow;
type LaneFilter = 'all' | 'ops' | MeasurementLane;

const LANES: Exclude<MeasurementLane, 'CLOSED'>[] = ['PREPARE_EVIDENCE', 'CORRECTION', 'INTERNAL_REVIEW', 'SEND_TO_CUSTOMER', 'AWAITING_CUSTOMER', 'BILLING_ELIGIBLE'];
const OWNER: Record<MeasurementLane, string> = {
  PREPARE_EVIDENCE: 'Operação', CORRECTION: 'Operação', INTERNAL_REVIEW: 'Contratos', SEND_TO_CUSTOMER: 'Contratos',
  AWAITING_CUSTOMER: 'Cliente', BILLING_ELIGIBLE: 'Financeiro', CLOSED: '—',
};
const READINESS: Record<string, { label: string; tone: Tone }> = {
  READY: { label: 'Evidência pronta', tone: 'success' }, BLOCKED: { label: 'Evidência bloqueada', tone: 'danger' },
  INCOMPLETE: { label: 'Evidência incompleta', tone: 'warning' }, NOT_APPLICABLE: { label: 'Sem exigência', tone: 'neutral' },
  UNKNOWN: { label: 'Prontidão não apurada', tone: 'neutral' },
};
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** O próximo passo de cada medição, dito em uma frase — e de quem ele é. */
function nextStep(m: Row, today: string): { text: string; tone: Tone; due: string | null; dueLabel: string } {
  const exp = relativeDue(m.expectedAt, today);
  switch (m.lane) {
    case 'PREPARE_EVIDENCE':
      return m.status === 'READY_FOR_SUBMISSION'
        ? { text: 'Evidência montada — submeter à análise interna', tone: 'accent', due: m.expectedAt, dueLabel: 'prevista' }
        : { text: m.pendingForOperations && exp.late ? `Preparar evidência — a medição era para ${exp.text}` : m.status === 'IN_PREPARATION' ? 'Evidência em preparo' : 'Planejada — a evidência começa na data',
          tone: m.pendingForOperations ? (exp.late ? 'danger' : 'warning') : 'neutral', due: m.expectedAt, dueLabel: 'prevista' };
    case 'CORRECTION':
      return { text: m.returnReason ? `Devolvida: ${m.returnReason}` : 'Devolvida para correção', tone: 'danger', due: m.expectedAt, dueLabel: 'prevista' };
    case 'INTERNAL_REVIEW':
      return { text: `Em análise interna${m.submittedAt ? ` desde ${dateShort(m.submittedAt)}` : ''}`, tone: 'info', due: m.expectedAt, dueLabel: 'prevista' };
    case 'SEND_TO_CUSTOMER':
      return { text: 'Pacote aprovado internamente — enviar ao cliente (ainda não é aceite)', tone: 'accent', due: m.expectedAt, dueLabel: 'prevista' };
    case 'AWAITING_CUSTOMER': {
      const due = relativeDue(m.customerDueAt, today);
      return { text: m.customerDueAt && due.late ? `Cliente não respondeu — o prazo venceu ${due.text}` : `Com o cliente${m.sentAt ? ` desde ${dateShort(m.sentAt)}` : ''}`,
        tone: m.customerDueAt && due.late ? 'danger' : 'neutral', due: m.customerDueAt ?? m.expectedAt, dueLabel: m.customerDueAt ? 'prazo do cliente' : 'prevista' };
    }
    case 'BILLING_ELIGIBLE':
      return { text: 'Aceita pelo cliente — elegível a faturamento', tone: 'success', due: m.expectedAt, dueLabel: 'prevista' };
    default:
      return { text: m.statusLabel, tone: 'neutral', due: m.expectedAt, dueLabel: 'prevista' };
  }
}

/**
 * MEDIÇÕES & EVIDÊNCIAS — a fila do portfólio, pela pergunta "quem tem o
 * próximo passo". É um RECORTE da medição canônica do projeto: mesma linha,
 * mesmo estado, mesma história; preparar, submeter e registrar aceite
 * acontecem na bancada do projeto. "Aprovada — enviar ao cliente" nunca se
 * confunde com aceite do cliente.
 */
export function MeasurementsQueue() {
  const resource = useResource<Payload>('/api/operations/measurements');
  return <AxPage testId="measurements-queue"><Resource {...resource}>{(data) => <Queue data={data} />}</Resource></AxPage>;
}

function Queue({ data }: { data: Payload }) {
  const [lane, setLane] = useUrlParam<LaneFilter>('lane', 'all');
  const [search, setSearch] = useState('');
  const today = data.today;
  const live = data.measurements.filter((m) => m.lane !== 'CLOSED');
  const count = (l: MeasurementLane) => live.filter((m) => m.lane === l).length;
  const sum = (l: MeasurementLane) => live.filter((m) => m.lane === l).reduce((a, m) => a + (m.value ?? 0), 0);
  const ops = live.filter((m) => m.pendingForOperations);
  const customerLate = live.filter((m) => m.lane === 'AWAITING_CUSTOMER' && m.customerDueAt && m.customerDueAt < today);
  const rows = live
    .filter((m) => lane === 'all' || (lane === 'ops' ? m.pendingForOperations : m.lane === lane))
    .filter((m) => !search || norm([m.project, m.client, m.occurrenceKey, m.activity, m.rule].filter(Boolean).join(' ')).includes(norm(search)))
    .sort((a, b) => Number(b.pendingForOperations) - Number(a.pendingForOperations)
      || LANES.indexOf(a.lane as Exclude<MeasurementLane, 'CLOSED'>) - LANES.indexOf(b.lane as Exclude<MeasurementLane, 'CLOSED'>)
      || (a.expectedAt ?? '9999').localeCompare(b.expectedAt ?? '9999'));
  const val = (n: number) => (data.canSeeValues ? money(n, 'BRL', { compact: true }) : undefined);

  return (
    <>
      <CommandHeader domain="operations" area="Medições & Evidências" title="Da evidência ao faturamento"
        context={<>
          <span className={ops.length ? 'ax-warn-text' : undefined}><strong>{ops.length}</strong> {ops.length === 1 ? 'pendência' : 'pendências'} da operação</span>
          <span><strong>{count('AWAITING_CUSTOMER')}</strong> com o cliente{customerLate.length ? <span className="ax-danger-text"> · {customerLate.length} com prazo vencido</span> : null}</span>
          {data.canSeeValues && <span><strong>{money(sum('BILLING_ELIGIBLE'), 'BRL', { compact: true })}</strong> elegível a faturamento</span>}
        </>} />

      <SignalStrip label="Sinais das medições" items={[
        { label: 'Pendências da operação', value: ops.length, hint: 'preparar evidência vencida ou corrigir o que voltou',
          tone: ops.length ? 'warning' : undefined, onClick: () => setLane('ops') },
        { label: 'Devolvidas', value: count('CORRECTION'), hint: 'pela análise interna ou pelo cliente', tone: count('CORRECTION') ? 'danger' : undefined,
          onClick: () => setLane('CORRECTION') },
        { label: 'Cliente com prazo vencido', value: customerLate.length, hint: `${plural(count('AWAITING_CUSTOMER'), 'aguardando aceite', 'aguardando aceite')}`,
          tone: customerLate.length ? 'danger' : undefined, onClick: () => setLane('AWAITING_CUSTOMER') },
        { label: 'Elegível a faturamento', value: data.canSeeValues ? money(sum('BILLING_ELIGIBLE'), 'BRL', { compact: true }) : count('BILLING_ELIGIBLE'),
          hint: data.canSeeValues ? plural(count('BILLING_ELIGIBLE'), 'medição aceita', 'medições aceitas') : 'aceite do cliente registrado',
          tone: count('BILLING_ELIGIBLE') ? 'success' : undefined, onClick: () => setLane('BILLING_ELIGIBLE') },
      ]} />

      <Plane flush title="O caminho de cada medição" subtitle="Da evidência ao aceite do cliente — cada etapa diz de quem é o próximo passo">
        <FlowPipeline label="Raias da medição" current={lane === 'all' || lane === 'ops' ? undefined : lane} steps={LANES.map((l) => ({
          id: l, label: MEASUREMENT_LANE_LABEL[l], count: count(l), onClick: () => setLane(lane === l ? 'all' : l),
          sub: <>{OWNER[l]}{data.canSeeValues && sum(l) ? ` · ${val(sum(l))}` : ''}</>,
          tone: l === 'CORRECTION' && count(l) ? 'danger' : l === 'AWAITING_CUSTOMER' && customerLate.length ? 'danger'
            : l === 'PREPARE_EVIDENCE' && live.some((m) => m.lane === l && m.pendingForOperations) ? 'warning'
              : l === 'BILLING_ELIGIBLE' && count(l) ? 'success' : undefined,
        }))} />
      </Plane>

      <Plane flush title="Fila" count={rows.length} testId="measurements-list"
        subtitle="Pendência da operação primeiro, depois pela ordem do caminho"
        bar={<div className="ax-toolbar">
          {/* A raia se escolhe no caminho acima; aqui só o recorte transversal e a raia escolhida, para desmarcar. */}
          <Filters<LaneFilter> label="Filtrar fila" value={lane} onChange={setLane} options={[
            { id: 'all', label: 'Todas', count: live.length },
            { id: 'ops', label: 'Pendências da operação', count: ops.length },
            ...(lane !== 'all' && lane !== 'ops' ? [{ id: lane, label: MEASUREMENT_LANE_LABEL[lane], count: count(lane) }] : []),
          ]} />
          <SearchBox value={search} onChange={setSearch} placeholder="Projeto, cliente, medição ou atividade" label="Buscar medição" />
        </div>}>
        {rows.length === 0 ? (
          <EmptyState title={live.length ? 'Nenhuma medição neste recorte' : 'Nenhuma medição ainda'}>
            {live.length ? 'Mude o filtro ou a busca.' : 'Medições nascem do mapeamento aceito entre a regra contratual e o cronograma do projeto.'}
          </EmptyState>
        ) : (
          <div className="ax-queue">
            {rows.map((m) => {
              const step = nextStep(m, today);
              const due = relativeDue(step.due, today);
              const readiness = m.readiness ? READINESS[m.readiness] : null;
              return (
                <div key={m.id} className="ax-row measure" data-tone={step.tone === 'success' || step.tone === 'neutral' ? 'neutral' : step.tone} data-testid="measurement-row">
                  <div className="ax-row-main">
                    <span className="ax-row-eyebrow">
                      <span className="ax-kind">{MEASUREMENT_LANE_LABEL[m.lane]}</span>
                      <span className="ax-row-where">{m.project}{m.client ? ` · ${m.client}` : ''}</span>
                    </span>
                    <Link className="ax-row-object ax-link" style={{ color: 'var(--ax-fg-strong)' }} href={m.href}>
                      {m.occurrenceKey}{m.activity ? <span className="ax-subtle"> · {m.activity}</span> : null}</Link>
                    <span className="ax-row-issue">{step.text}</span>
                    <span className="ax-measure-meta">
                      {readiness && <Chip tone={readiness.tone} quiet>{readiness.label}</Chip>}
                      {m.rule && <span>{m.rule}</span>}
                      <span>próximo passo: <strong>{OWNER[m.lane]}</strong></span>
                      {data.canSeeValues && m.value ? <span className="m-value">{money(m.value, m.currency ?? 'BRL')}</span> : null}
                    </span>
                  </div>
                  <div className="ax-cellstack">
                    <span className="ax-row-due" data-late={due.late && step.tone === 'danger' ? 'true' : undefined}>{step.due ? dateShort(step.due) : '—'}</span>
                    <small>{step.dueLabel}</small>
                  </div>
                  <div className="ax-cellstack ax-measure-value">
                    {data.canSeeValues
                      ? m.value ? <><strong className="ax-num">{money(m.value, m.currency ?? 'BRL')}</strong><small>{m.lane === 'BILLING_ELIGIBLE' ? 'aceito' : 'medido'}</small></>
                        : <small className="ax-subtle">a medir</small>
                      : <small className="ax-subtle">valor restrito</small>}
                  </div>
                  <div className="ax-row-actions">
                    <Link className={m.pendingForOperations ? 'ax-btn primary sm' : 'ax-btn sm'} href={m.href}>
                      {m.pendingForOperations ? (m.lane === 'CORRECTION' ? 'Corrigir' : 'Preparar') : 'Abrir'}<ArrowUpRight size={13} aria-hidden /></Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Plane>
      <p className="ax-note">Esta fila é um recorte da medição canônica: a mesma linha aparece na aba Medições do projeto e em Contratos → Medições &
        Aprovações. Preparar, submeter e registrar aceite acontecem na bancada do projeto.</p>
    </>
  );
}
