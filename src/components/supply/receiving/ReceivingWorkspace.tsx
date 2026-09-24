'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { HudButton, useHudToast } from '@/components/hud';
import {
  INBOUND_QUEUE_LABEL, INSPECTION_STATUS_LABEL, onTimeRate, type InboundQueue,
} from '@/lib/supply/receiving';
import {
  DataTable, EmptyNote, GovernanceNote, LiveSep, Metrics, ResourceState, Segments, StatePill, TabPanel, Toolbar,
  WorkspaceHeading, WorkspaceTabs, day, matches, useOperationsResource,
} from '@/components/operations/ui';
import '../supply.css';
import { qty } from '../inventory/shared';
import { InspectModal, ReceivePurchaseModal, ReceiveTransferModal, ShipmentModal, type ReceivingModel } from './ReceiveModals';

type Tab = 'inbound' | 'receipts' | 'inspection' | 'performance';
type Entry = ReceivingModel['inbound'][number] | ReceivingModel['inboundTransfers'][number];
const QUEUE_TONE: Record<InboundQueue, 'neutral' | 'info' | 'warning' | 'danger' | 'success' | 'accent'> = {
  today: 'accent', upcoming: 'neutral', in_transit: 'info', late: 'danger', partial: 'warning', discrepancy: 'danger', done: 'success',
};
const ORDER: InboundQueue[] = ['late', 'today', 'in_transit', 'partial', 'discrepancy', 'upcoming', 'done'];

/**
 * RECEBIMENTOS & LOGÍSTICA — o que está entrando (pedidos emitidos e
 * transferências) nas filas que a operação usa, o recebimento em campo, a
 * inspeção e a pontualidade de quem entrega. Estoque só nasce aqui.
 */
export function ReceivingWorkspace() {
  const { data, state, message, refresh } = useOperationsResource<ReceivingModel & { ok: true }>('/api/supply/receiving');
  const [tab, setTab] = useState<Tab>('inbound');
  const [queue, setQueue] = useState<InboundQueue | 'open'>('open');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ kind: 'receive' | 'ship'; entry: Entry } | { kind: 'inspect'; receiptId: string } | null>(null);
  const { error: notifyError } = useHudToast();
  const entries = useMemo<Entry[]>(() => (data ? [...data.inbound, ...data.inboundTransfers] : [])
    .sort((a, b) => ORDER.indexOf(a.queue) - ORDER.indexOf(b.queue) || (a.expectedDate ?? '9999').localeCompare(b.expectedDate ?? '9999')), [data]);
  const rows = entries.filter((e) => (queue === 'open' ? e.queue !== 'done' : e.queue === queue))
    .filter((e) => !search || matches(search, e.number, e.counterpart, e.project, e.destination, ...e.lines.map((l) => `${l.itemCode} ${l.itemDescription}`)));
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const count = (q: InboundQueue) => entries.filter((e) => e.queue === q).length;
  const pending = data.receipts.filter((r) => r.inspectionStatus === 'PENDING');
  const caps = data.capabilities;
  const openEvidence = async (receiptId: string, evidenceId: string) => {
    const r = await fetch(`/api/supply/receiving/receipts/${receiptId}/evidence?evidence=${evidenceId}`);
    const p = await r.json().catch(() => ({}));
    if (!r.ok || !p.ok) { notifyError('Evidência indisponível', p?.error); return; }
    window.open(p.url, '_blank', 'noopener');
  };

  return (
    <section className="crm-workspace ops-workspace" aria-label="Recebimentos e logística" data-testid="receiving-workspace">
      <WorkspaceHeading eyebrow="Supply Chain · Recebimentos & Logística" title="O que está chegando, e o que chegou"
        description={<><span className={count('late') ? 'crm-tone-danger' : undefined}><b>{count('late')}</b> atrasada(s)</span><LiveSep />
          <span><b>{count('today')}</b> esperada(s) hoje</span><LiveSep />
          <span className={pending.length ? 'crm-tone-warning' : undefined}><b>{pending.length}</b> em inspeção</span></>} />
      <Metrics items={[
        { label: 'Esperado hoje', value: count('today'), hint: 'Pela previsão do embarque ou do pedido', accent: true },
        { label: 'Em trânsito', value: count('in_transit'), hint: 'Embarque ou transferência despachada', tone: 'info' },
        { label: 'Atrasados', value: count('late'), hint: 'Passaram da data prevista', tone: count('late') ? 'danger' : 'neutral' },
        { label: 'Parciais', value: count('partial'), hint: 'Receberam parte — o resto segue esperado', tone: count('partial') ? 'warning' : 'neutral' },
        { label: 'Divergências', value: count('discrepancy'), hint: 'Rejeição ou inspeção pendente', tone: count('discrepancy') ? 'danger' : 'neutral' },
      ]} />
      <WorkspaceTabs label="Áreas do recebimento" active={tab} onChange={setTab} tabs={[
        { id: 'inbound', label: 'Entradas', count: entries.filter((e) => e.queue !== 'done').length },
        { id: 'receipts', label: 'Recebimentos' },
        { id: 'inspection', label: 'Inspeção', count: pending.length, tone: 'warning' },
        { id: 'performance', label: 'Desempenho de entrega' },
      ]} />

      {tab === 'inbound' && (
        <TabPanel id="inbound">
          <Toolbar search={search} onSearch={setSearch} placeholder="Buscar pedido, fornecedor, projeto ou material">
            <Segments label="Fila" value={queue} onChange={(v) => setQueue(v as typeof queue)} options={[
              { value: 'open', label: 'Em aberto', count: entries.filter((e) => e.queue !== 'done').length },
              ...(['late', 'today', 'in_transit', 'partial', 'discrepancy', 'upcoming', 'done'] as InboundQueue[])
                .map((q) => ({ value: q, label: INBOUND_QUEUE_LABEL[q], count: count(q) })),
            ]} />
          </Toolbar>
          <DataTable label="Entradas esperadas" columns={['Entrada', 'De', 'Destino', 'Previsto', 'Em aberto', 'Fila', '']} count={rows.length}
            footer="Pedido emitido é esperado — só o recebimento põe material no estoque"
            empty={<EmptyNote title="Nada nesta fila" description="Pedidos emitidos e transferências despachadas aparecem aqui." />}>
            {rows.map((e) => (
              <tr key={`${e.kind}:${e.id}`} data-testid="inbound-row">
                <td className="tabular-nums"><b>{e.number}</b><p className="crm-muted">{e.kind === 'PO' ? 'Pedido de compra' : 'Transferência'}
                  {e.project ? ` · ${e.project}` : ''}</p></td>
                <td>{e.counterpart}</td>
                <td>{e.destination ?? '—'}</td>
                <td className={e.daysLate ? 'crm-tone-danger' : undefined}>{day(e.expectedDate)}{e.daysLate ? <p className="crm-muted">{e.daysLate} dia(s) de atraso</p> : null}</td>
                <td className="tabular-nums">{e.lines.filter((l) => l.open > 0).map((l) => `${l.itemCode} ${qty(l.open)} ${l.unit}`).join(' · ') || '—'}</td>
                <td><StatePill tone={QUEUE_TONE[e.queue]}>{INBOUND_QUEUE_LABEL[e.queue]}</StatePill></td>
                <td className="ops-row-actions">
                  {caps.receive && e.open > 0 && (e.kind === 'PO' || ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(e.status)) && (
                    <HudButton size="sm" variant="primary" onClick={() => setModal({ kind: 'receive', entry: e })}>Receber</HudButton>)}
                  {caps.logistics && e.kind === 'PO' && e.open > 0 && (
                    <HudButton size="sm" variant="ghost" onClick={() => setModal({ kind: 'ship', entry: e })}>Logística</HudButton>)}
                </td>
              </tr>
            ))}
          </DataTable>
          <GovernanceNote>Rejeitado ou avariado não entra no estoque e continua esperado do fornecedor. Receber acima do que falta é recusado.</GovernanceNote>
        </TabPanel>
      )}

      {tab === 'receipts' && (
        <TabPanel id="receipts">
          <DataTable label="Recebimentos" columns={['Recebimento', 'Pedido', 'Local', 'Linhas', 'Inspeção', 'Evidências', 'Quem']} count={data.receipts.length}
            footer="Recebimento é fato postado — não se reescreve"
            empty={<EmptyNote title="Nenhum recebimento nos últimos 60 dias" description="Receba a partir da fila de entradas." />}>
            {data.receipts.map((r) => (
              <tr key={r.id} data-testid="receipt-row">
                <td className="tabular-nums"><b>{r.number}</b><p className="crm-muted">{new Date(r.receivedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p></td>
                <td>{r.orderNumber}<p className="crm-muted">{r.supplier}</p></td>
                <td>{r.location}</td>
                <td>{r.lines.map((l) => `${l.itemCode} +${qty(l.accepted)}${l.rejected ? ` / rej. ${qty(l.rejected)}` : ''}`).join(' · ')}
                  {r.lines.filter((l) => l.rejectionReason).map((l) => <p key={l.id} className="crm-muted">{l.rejectionReason}</p>)}</td>
                <td><StatePill tone={r.inspectionStatus === 'PENDING' ? 'warning' : r.inspectionStatus.includes('REJECTED') ? 'danger'
                  : r.inspectionStatus === 'APPROVED' ? 'success' : 'neutral'}>{INSPECTION_STATUS_LABEL[r.inspectionStatus]}</StatePill></td>
                <td>{r.evidence.length ? r.evidence.map((ev) => (
                  <button key={ev.id} type="button" className="crm-row-open" onClick={() => openEvidence(r.id, ev.id)}>{ev.fileName}</button>
                )) : <span className="crm-muted">—</span>}</td>
                <td>{r.receivedBy ?? '—'}</td>
              </tr>
            ))}
          </DataTable>
        </TabPanel>
      )}

      {tab === 'inspection' && (
        <TabPanel id="inspection">
          <DataTable label="Recebimentos em inspeção" columns={['Recebimento', 'Pedido', 'Itens', 'Recebido em', '']} count={pending.length}
            footer="Em inspeção conta como entrando: ninguém recompra, e nada é reservado até a decisão"
            empty={<EmptyNote title="Nada em inspeção" description="Recebimentos em local de quarentena aparecem aqui." />}>
            {pending.map((r) => (
              <tr key={r.id} data-testid="inspection-row">
                <td className="tabular-nums"><b>{r.number}</b></td>
                <td>{r.orderNumber}<p className="crm-muted">{r.supplier}</p></td>
                <td>{r.lines.map((l) => `${l.itemCode} ${qty(l.accepted)} ${l.unit}`).join(' · ')}</td>
                <td>{r.location}</td>
                <td>{caps.inspect ? <HudButton size="sm" variant="primary" onClick={() => setModal({ kind: 'inspect', receiptId: r.id })}>Inspecionar</HudButton>
                  : <span className="crm-muted">Exige recebimento + gestão de estoque</span>}</td>
              </tr>
            ))}
          </DataTable>
        </TabPanel>
      )}

      {tab === 'performance' && (
        <TabPanel id="performance">
          <DataTable label="Desempenho de entrega" columns={['Fornecedor', 'Linhas recebidas', 'No prazo', 'Atraso médio', 'Com rejeição']}
            count={data.performance.length} footer="Derivado dos recebimentos contra a data prometida — nunca estimado"
            empty={<EmptyNote title="Sem histórico de entrega" description="A pontualidade aparece depois dos primeiros recebimentos." />}>
            {data.performance.map((p) => {
              const rate = onTimeRate({ promised_lines: p.promisedLines, on_time_lines: p.onTimeLines });
              return (
                <tr key={p.supplierId} data-testid="performance-row">
                  <td>{p.supplier}</td>
                  <td className="tabular-nums">{p.receivedLines}</td>
                  <td>{rate === null ? '—' : <StatePill tone={rate >= 0.9 ? 'success' : rate >= 0.7 ? 'warning' : 'danger'}>{Math.round(rate * 100)}%</StatePill>}</td>
                  <td className="tabular-nums">{p.avgDelayDays ? `${p.avgDelayDays.toFixed(1)} dia(s)` : '—'}</td>
                  <td className="tabular-nums">{p.linesWithRejection}</td>
                </tr>
              );
            })}
          </DataTable>
          <p style={{ padding: '10px 14px' }}><Link href="/supply/fornecedores" className="crm-row-open">Abrir fornecedores</Link></p>
        </TabPanel>
      )}

      {modal?.kind === 'receive' && modal.entry.kind === 'PO' && (
        <ReceivePurchaseModal order={modal.entry} data={data} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />)}
      {modal?.kind === 'receive' && modal.entry.kind === 'TRANSFER' && (
        <ReceiveTransferModal transfer={modal.entry} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />)}
      {modal?.kind === 'ship' && modal.entry.kind === 'PO' && (
        <ShipmentModal order={modal.entry} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />)}
      {modal?.kind === 'inspect' && (() => {
        const receipt = data.receipts.find((r) => r.id === modal.receiptId);
        return receipt ? <InspectModal receipt={receipt} data={data} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} /> : null;
      })()}
    </section>
  );
}
