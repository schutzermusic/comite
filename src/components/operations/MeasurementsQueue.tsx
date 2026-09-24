'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { MeasurementQueueRow } from '@/lib/operations/measurements-queue';
import { MEASUREMENT_LANE_LABEL, type MeasurementLane } from '@/lib/operations/overview-rules';
import {
  DataTable, EmptyNote, GovernanceNote, LiveSep, Metrics, ResourceState, Segments, StatePill, Toolbar,
  WorkspaceHeading, brl, day, matches, useOperationsResource, type Tone,
} from './ui';

type Payload = { ok: true; today: string; canSeeValues: boolean; measurements: MeasurementQueueRow[] };

const LANES: MeasurementLane[] = ['PREPARE_EVIDENCE', 'CORRECTION', 'INTERNAL_REVIEW', 'SEND_TO_CUSTOMER', 'AWAITING_CUSTOMER', 'BILLING_ELIGIBLE'];
const laneTone: Record<MeasurementLane, Tone> = {
  PREPARE_EVIDENCE: 'accent', CORRECTION: 'warning', INTERNAL_REVIEW: 'info', SEND_TO_CUSTOMER: 'info',
  AWAITING_CUSTOMER: 'neutral', BILLING_ELIGIBLE: 'success', CLOSED: 'neutral',
};
const READINESS: Record<string, { label: string; tone: Tone }> = {
  READY: { label: 'Evidência pronta', tone: 'success' }, BLOCKED: { label: 'Evidência bloqueada', tone: 'danger' },
  INCOMPLETE: { label: 'Evidência incompleta', tone: 'warning' }, NOT_APPLICABLE: { label: 'Sem exigência', tone: 'neutral' },
  UNKNOWN: { label: 'Prontidão não apurada', tone: 'neutral' },
};

/**
 * MEDIÇÕES & EVIDÊNCIAS — a fila do portfólio.
 *
 * Responde, nesta ordem: o que está pronto para evidência, o que falta, o que
 * está em análise interna, o que voltou, o que espera o cliente e o que virou
 * elegível a faturamento. "Aprovada — enviar ao cliente" NUNCA se confunde
 * com aceite do cliente.
 */
export function MeasurementsQueue() {
  const { data, state, message } = useOperationsResource<Payload>('/api/operations/measurements');
  const [lane, setLane] = useState<'all' | MeasurementLane>('all');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => (data?.measurements ?? [])
    .filter((m) => m.lane !== 'CLOSED')
    .filter((m) => lane === 'all' || m.lane === lane)
    .filter((m) => !search || matches(search, m.project, m.occurrenceKey, m.activity, m.client)), [data, lane, search]);
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const live = data.measurements.filter((m) => m.lane !== 'CLOSED');
  const count = (l: MeasurementLane) => live.filter((m) => m.lane === l).length;
  const pending = live.filter((m) => m.pendingForOperations).length;

  return (
    <section className="crm-workspace ops-workspace" aria-label="Medições e evidências">
      <WorkspaceHeading
        eyebrow="Operações · Medições & Evidências"
        title="Da evidência ao faturamento"
        description={<><span><b>{pending}</b> pendência(s) da operação</span><LiveSep />
          <span><b>{count('AWAITING_CUSTOMER')}</b> com o cliente</span><LiveSep />
          <span><b>{count('BILLING_ELIGIBLE')}</b> elegível(is) a faturamento</span></>}
      />
      <Metrics items={LANES.map((l) => ({ label: MEASUREMENT_LANE_LABEL[l], value: count(l), tone: laneTone[l],
        hint: l === 'SEND_TO_CUSTOMER' ? 'Pacote interno aprovado — ainda não é aceite'
          : l === 'BILLING_ELIGIBLE' ? 'Aceite do cliente registrado' : 'Mesma medição do projeto',
        onClick: () => setLane(l) }))} />
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar projeto, cliente, medição ou atividade">
        <Segments label="Filtrar fila" value={lane} onChange={(v) => setLane(v as 'all' | MeasurementLane)}
          options={[{ value: 'all', label: 'Todas', count: live.length },
            ...LANES.map((l) => ({ value: l, label: MEASUREMENT_LANE_LABEL[l], count: count(l) }))]} />
      </Toolbar>
      <DataTable
        label="Fila de medições"
        columns={['Medição', 'Projeto', 'Previsto', 'Estado', 'Evidência', data.canSeeValues ? 'Valor' : 'Valor (restrito)']}
        count={rows.length}
        footer="Medição canônica do projeto — sem cópia, sem estado próprio"
        empty={<EmptyNote title="Nenhuma medição neste recorte"
          description="Medições nascem do mapeamento aceito entre a regra contratual e o cronograma do projeto." />}
      >
        {rows.map((m) => (
          <tr key={m.id}>
            <td><Link href={m.href} className="crm-row-open">{m.occurrenceKey}</Link>
              {m.activity && <p className="crm-muted">{m.activity}</p>}</td>
            <td><p>{m.project}</p>{m.client && <p className="crm-muted">{m.client}</p>}</td>
            <td>
              <p className={m.expectedAt && m.expectedAt < data.today && m.lane === 'PREPARE_EVIDENCE' ? 'crm-tone-danger' : undefined}>
                {day(m.expectedAt)}</p>
              {m.customerDueAt && <p className="crm-muted">Cliente até {day(m.customerDueAt)}</p>}
            </td>
            <td><StatePill tone={laneTone[m.lane]}>{m.statusLabel}</StatePill></td>
            <td>{m.readiness ? <StatePill tone={READINESS[m.readiness]?.tone ?? 'neutral'} dot={false}>
              {READINESS[m.readiness]?.label ?? m.readiness}</StatePill> : <span className="crm-muted">—</span>}</td>
            <td className="tabular-nums">{data.canSeeValues ? brl(m.value, m.currency ?? 'BRL') : <span className="crm-muted">Restrito</span>}</td>
          </tr>
        ))}
      </DataTable>
      <GovernanceNote>
        Esta fila é um recorte da medição canônica: a mesma linha aparece na aba Medições do projeto e em Contratos → Medições &
        Aprovações. Preparar, submeter e registrar aceite acontecem na bancada do projeto.
      </GovernanceNote>
    </section>
  );
}
