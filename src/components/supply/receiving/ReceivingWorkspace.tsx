'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, PackageOpen, Truck } from 'lucide-react';
import { INBOUND_QUEUE_LABEL, INSPECTION_STATUS_LABEL, onTimeRate, type InboundQueue } from '@/lib/supply/receiving';
import {
  AxPage, Chip, CommandHeader, Due, EmptyState, Filters, Meter, Plane, Resource, SearchBox, SignalStrip, Tabs, dateTime, href, pct,
  plural, qty, useResource, useUrlParam, useUrlParams, type Tone,
} from '@/components/ax';
import { ReceiveFlow } from './ReceiveFlow';
import {
  INSPECTION_TONE, InspectPanel, ReceiptPanel, ShipmentPanel, TransferReceivePanel, type Inbound, type ReceivingModel, type TransferIn,
} from './ReceivingPanels';

type Tab = 'inbound' | 'inspection' | 'receipts' | 'performance';
type Entry = Inbound | TransferIn;
type QueueFilter = InboundQueue | 'open';
const QUEUE_TONE: Record<InboundQueue, Tone> = {
  today: 'accent', upcoming: 'neutral', in_transit: 'info', late: 'danger', partial: 'warning', discrepancy: 'danger', done: 'success',
};
const ORDER: InboundQueue[] = ['late', 'today', 'in_transit', 'partial', 'discrepancy', 'upcoming', 'done'];
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * RECEBIMENTOS & LOGÍSTICA — o que está entrando (pedidos emitidos e
 * transferências) nas filas que a operação usa, o recebimento em campo, a
 * inspeção e a pontualidade de quem entrega. Estoque só nasce aqui.
 *
 * Endereçável: `?tab=`, `?queue=`, `?receive=<pedido>` (abre o recebimento),
 * `?receipt=<recebimento>` (abre o recebimento postado / a inspeção).
 */
export function ReceivingWorkspace() {
  const resource = useResource<ReceivingModel>('/api/supply/receiving');
  return (
    <AxPage testId="receiving-workspace">
      <Resource {...resource}>{(data) => <Workspace data={data} refresh={resource.refresh} />}</Resource>
    </AxPage>
  );
}

function Workspace({ data, refresh }: { data: ReceivingModel; refresh: () => void }) {
  const [queueParam] = useUrlParam<string>('queue', 'open');
  const [tabParam] = useUrlParam<Tab>('tab', 'inbound');
  const [receiveId] = useUrlParam<string>('receive', '');
  const [receiptId] = useUrlParam<string>('receipt', '');
  const patch = useUrlParams();
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [panel, setPanel] = useState<{ kind: 'ship'; entry: Inbound } | { kind: 'transfer'; entry: TransferIn } | { kind: 'inspect'; receiptId: string } | null>(null);
  const tab: Tab = queueParam === 'inspection' ? 'inspection' : tabParam;
  const queue: QueueFilter = (ORDER as string[]).includes(queueParam) ? (queueParam as InboundQueue) : 'open';
  const caps = data.capabilities;

  const entries = useMemo<Entry[]>(() => [...data.inbound, ...data.inboundTransfers]
    .sort((a, b) => ORDER.indexOf(a.queue) - ORDER.indexOf(b.queue) || (a.expectedDate ?? '9999').localeCompare(b.expectedDate ?? '9999')), [data]);
  // Atraso é fato (passou da data com saldo), não fila: uma entrada em divergência também pode estar atrasada.
  const isLate = (e: Entry) => e.queue !== 'done' && e.daysLate > 0;
  const count = (q: InboundQueue) => (q === 'late' ? entries.filter(isLate).length : entries.filter((e) => e.queue === q).length);
  const open = entries.filter((e) => e.queue !== 'done');
  const rows = entries.filter((e) => (queue === 'open' ? e.queue !== 'done' : queue === 'late' ? isLate(e) : e.queue === queue))
    .filter((e) => !search || norm([e.number, e.counterpart, e.project, e.destination, ...e.lines.map((l) => `${l.itemCode} ${l.itemDescription}`)]
      .filter(Boolean).join(' ')).includes(norm(search)));
  const pending = data.receipts.filter((r) => r.inspectionStatus === 'PENDING');
  const openReceipt = receiptId ? data.receipts.find((r) => r.id === receiptId) ?? null : null;
  const inspectReceipt = panel?.kind === 'inspect' ? data.receipts.find((r) => r.id === panel.receiptId) ?? null : null;
  const receiving = picking || Boolean(receiveId);
  const goQueue = (q: QueueFilter) => patch({ queue: q === 'open' ? null : q, tab: null });

  return (
    <>
      <CommandHeader domain="supply" area="Recebimentos & logística" title="Recebimentos & logística"
        context={<>
          <span className={count('late') ? 'ax-danger-text' : undefined}><strong>{count('late')}</strong> {count('late') === 1 ? 'atrasada' : 'atrasadas'}</span>
          <span><strong>{count('today')}</strong> esperadas hoje</span>
          <span><strong>{count('in_transit')}</strong> em trânsito</span>
          <span><strong>{pending.length}</strong> em inspeção</span>
        </>}
        actions={caps.receive ? <button type="button" className="ax-btn primary ax-desktop-only" onClick={() => setPicking(true)}>
          <PackageOpen size={15} aria-hidden />Receber material</button> : undefined} />

      <SignalStrip label="Filas de entrada" items={[
        { label: 'Esperado hoje', value: count('today'), hint: 'pela previsão do embarque ou do pedido', tone: count('today') ? 'success' : undefined, onClick: () => goQueue('today') },
        { label: 'Atrasados', value: count('late'), hint: 'passaram da data prometida', tone: count('late') ? 'danger' : undefined, onClick: () => goQueue('late') },
        { label: 'Em trânsito', value: count('in_transit'), hint: 'embarque ou transferência despachada', onClick: () => goQueue('in_transit') },
        { label: 'Parciais', value: count('partial'), hint: 'receberam parte — o resto segue esperado', tone: count('partial') ? 'warning' : undefined, onClick: () => goQueue('partial') },
        { label: 'Em inspeção', value: pending.length, hint: 'quarentena esperando decisão', tone: pending.length ? 'warning' : undefined, onClick: () => patch({ queue: 'inspection', tab: null }) },
        { label: 'Divergências', value: count('discrepancy'), hint: 'inspeção pendente ou rejeição no recebimento', tone: count('discrepancy') ? 'danger' : undefined, onClick: () => goQueue('discrepancy') },
      ]} />

      <Tabs<Tab> label="Áreas do recebimento" value={tab} onChange={(t) => patch({ tab: t === 'inbound' ? null : t, queue: null })} tabs={[
        { id: 'inbound', label: 'Entradas', count: open.length },
        { id: 'inspection', label: 'Inspeção', count: pending.length, tone: 'warning' },
        { id: 'receipts', label: 'Recebimentos' },
        { id: 'performance', label: 'Desempenho de entrega' },
      ]} />

      {tab === 'inbound' && (
        <Plane flush title="O que está chegando" count={rows.length}
          subtitle="Pedido emitido e transferência despachada são esperados — só o recebimento põe material no estoque"
          bar={<div className="ax-toolbar">
            <Filters<QueueFilter> label="Fila" value={queue} onChange={goQueue} options={[
              { id: 'open', label: 'Em aberto', count: open.length },
              ...ORDER.filter((q) => count(q) > 0 || q === 'late' || q === 'today').map((q) => ({ id: q, label: INBOUND_QUEUE_LABEL[q], count: count(q) })),
            ]} />
            <SearchBox value={search} onChange={setSearch} placeholder="Pedido, fornecedor, projeto ou material" label="Buscar entrada" />
          </div>}>
          {rows.length === 0 ? (
            <EmptyState title="Nada nesta fila">Pedidos emitidos e transferências despachadas aparecem aqui, pela data prevista.</EmptyState>
          ) : (
            <div className="ax-queue">
              {rows.map((e) => {
                const receivable = e.open > 0 && (e.kind === 'PO' ? ['ISSUED', 'PARTIALLY_RECEIVED'].includes(e.status) : ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(e.status));
                const ship = e.kind === 'PO' ? e.shipments.find((s) => ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'].includes(s.status)) : null;
                return (
                  <div key={`${e.kind}:${e.id}`} className="ax-row no-owner" data-tone={QUEUE_TONE[e.queue]} data-testid="inbound-row">
                    <div className="ax-row-main">
                      <span className="ax-row-eyebrow">
                        <span className="ax-kind">{e.kind === 'PO' ? 'Pedido' : 'Transferência'}</span>
                        <span className="ax-row-where">{e.project ?? 'reposição de estoque'} · para {e.destination ?? '—'}</span>
                      </span>
                      <span className="ax-row-object">
                        {e.kind === 'PO' ? <Link className="ax-link" style={{ color: 'inherit' }} href={href.purchaseOrder(e.id)}>{e.number}</Link> : e.number}
                        <span className="ax-subtle"> · {e.counterpart}</span>
                      </span>
                      <span className="ax-row-issue">
                        {e.lines.filter((l) => l.open > 0).map((l) => `${l.itemCode} ${qty(l.open, l.unit)}`).join(' · ') || 'nada em aberto'}
                      </span>
                    </div>
                    <div className="ax-cellstack">
                      <Due value={e.expectedDate} today={data.today} />
                      {e.daysLate > 0 && <small className="ax-danger-text">{plural(e.daysLate, 'dia', 'dias')} de atraso</small>}
                    </div>
                    <div className="ax-row-actions">
                      {caps.receive && receivable && (e.kind === 'PO'
                        ? <button type="button" className="ax-btn primary sm" onClick={() => patch({ receive: e.id })}>Receber</button>
                        : <button type="button" className="ax-btn primary sm" onClick={() => setPanel({ kind: 'transfer', entry: e })}>Receber</button>)}
                      {caps.logistics && e.kind === 'PO' && e.open > 0 && (
                        <button type="button" className="ax-btn ghost sm" onClick={() => setPanel({ kind: 'ship', entry: e })}>Logística</button>)}
                    </div>
                    <div className="ax-row-detail">
                      <span className="ax-inline" style={{ flexWrap: 'wrap', gap: 8 }}>
                        <Chip tone={QUEUE_TONE[e.queue]}>{INBOUND_QUEUE_LABEL[e.queue]}</Chip>
                        {ship && <span className="ax-subtle ax-inline" style={{ fontSize: 12 }}><Truck size={12} aria-hidden />{ship.number}
                          {ship.carrier ? ` · ${ship.carrier}` : ''}{ship.trackingRef ? ` · ${ship.trackingRef}` : ''}{ship.eta ? ` · ETA ${ship.eta.split('-').reverse().slice(0, 2).join('/')}` : ''}</span>}
                        {e.kind === 'TRANSFER' && <span className="ax-subtle ax-inline" style={{ fontSize: 12 }}><ArrowRightLeft size={12} aria-hidden />
                          {e.carrier ?? 'transferência'}{e.trackingRef ? ` · ${e.trackingRef}` : ''}</span>}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Plane>
      )}

      {tab === 'inspection' && (
        <Plane flush title="Em inspeção" count={pending.length}
          subtitle="Em inspeção conta como entrando: ninguém recompra, e nada é reservado até a decisão">
          {pending.length === 0 ? <EmptyState title="Quarentena em dia">Recebimentos em local de quarentena aparecem aqui até a decisão.</EmptyState> : (
            <div className="ax-queue">
              {pending.map((r) => {
                const age = Math.max(0, Math.round((Date.parse(`${data.today}T12:00:00Z`) - Date.parse(r.receivedAt)) / 86_400_000));
                return (
                  <div key={r.id} className="ax-row no-owner" data-tone={age > 2 ? 'warning' : 'accent'} data-testid="inspection-row">
                    <div className="ax-row-main">
                      <span className="ax-row-eyebrow"><span className="ax-kind">Quarentena</span><span className="ax-row-where">{r.location}</span></span>
                      <button type="button" className="ax-rowlink ax-row-object" onClick={() => patch({ receipt: r.id })}>{r.number}<span className="ax-subtle"> · {r.supplier}</span></button>
                      <span className="ax-row-issue">{r.lines.map((l) => `${l.itemCode} ${qty(l.accepted, l.unit)}`).join(' · ')} — pedido {r.orderNumber}</span>
                    </div>
                    <div className="ax-cellstack"><span className="ax-row-due">{age ? `há ${plural(age, 'dia', 'dias')}` : 'hoje'}</span><small>{r.evidence.length ? `${r.evidence.length} evidência(s)` : 'sem evidência'}</small></div>
                    <div className="ax-row-actions">
                      {caps.inspect ? <button type="button" className="ax-btn primary sm" onClick={() => setPanel({ kind: 'inspect', receiptId: r.id })}>Inspecionar</button>
                        : <span className="ax-subtle">Exige recebimento + gestão de estoque</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Plane>
      )}

      {tab === 'receipts' && (
        <Plane flush title="Recebimentos (60 dias)" count={data.receipts.length} subtitle="Recebimento é fato postado — não se reescreve; evidência se acrescenta">
          {data.receipts.length === 0 ? <EmptyState title="Nenhum recebimento nos últimos 60 dias">Receba a partir da fila de entradas.</EmptyState> : (
            <div className="ax-table-wrap">
              <table className="ax-table cards">
                <caption className="sr-only-ax">Recebimentos postados</caption>
                <thead><tr><th>Recebimento</th><th>Pedido</th><th>Local</th><th>O que entrou</th><th>Inspeção</th><th className="num">Evidências</th></tr></thead>
                <tbody>
                  {data.receipts.map((r) => (
                    <tr key={r.id} className="clickable" data-testid="receipt-row" onClick={() => patch({ receipt: r.id })}>
                      <td className="lead" data-label=""><div className="ax-cellstack"><button type="button" className="ax-rowlink"
                        onClick={(ev) => { ev.stopPropagation(); patch({ receipt: r.id }); }}>{r.number}</button><small>{dateTime(r.receivedAt)} · {r.receivedBy ?? '—'}</small></div></td>
                      <td data-label="Pedido"><div className="ax-cellstack"><span>{r.orderNumber}</span><small>{r.supplier}</small></div></td>
                      <td data-label="Local">{r.location}</td>
                      <td data-label="Entrou">{r.lines.map((l) => `${l.itemCode} +${qty(l.accepted)}${l.rejected ? ` / rej. ${qty(l.rejected)}` : ''}`).join(' · ')}</td>
                      <td data-label="Inspeção"><Chip tone={INSPECTION_TONE[r.inspectionStatus]}>{INSPECTION_STATUS_LABEL[r.inspectionStatus]}</Chip></td>
                      <td className="num" data-label="Evidências">{r.evidence.length || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Plane>
      )}

      {tab === 'performance' && (
        <Plane flush title="Desempenho de entrega" subtitle="Derivado dos recebimentos contra a data prometida — nunca estimado"
          action={<Link className="ax-btn ghost sm" href="/supply/fornecedores">Fornecedores</Link>}>
          {data.performance.length === 0 ? <EmptyState title="Sem histórico de entrega">A pontualidade aparece depois dos primeiros recebimentos.</EmptyState> : (
            <div className="ax-table-wrap">
              <table className="ax-table cards">
                <caption className="sr-only-ax">Pontualidade por fornecedor</caption>
                <thead><tr><th>Fornecedor</th><th className="num">Linhas recebidas</th><th style={{ width: '26%' }}>No prazo</th><th className="num">Atraso médio</th><th className="num">Com rejeição</th></tr></thead>
                <tbody>
                  {data.performance.map((p) => {
                    const rate = onTimeRate({ promised_lines: p.promisedLines, on_time_lines: p.onTimeLines });
                    return (
                      <tr key={p.supplierId} data-testid="performance-row">
                        <td className="lead" data-label=""><Link className="ax-link" href={href.supplier(p.supplierId)}>{p.supplier}</Link></td>
                        <td className="num" data-label="Recebidas">{p.receivedLines}</td>
                        <td data-label="No prazo">{rate === null ? '—' : <div className="ax-cellstack"><span className="ax-num">{pct(rate)} · {p.onTimeLines} de {p.promisedLines}</span>
                          <Meter value={rate} tone={rate >= 0.9 ? 'success' : rate >= 0.7 ? 'warning' : 'danger'} label={`${p.supplier}: ${pct(rate)} no prazo`} /></div>}</td>
                        <td className="num" data-label="Atraso médio">{p.avgDelayDays ? `${p.avgDelayDays.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} d` : '—'}</td>
                        <td className="num" data-label="Com rejeição">{p.linesWithRejection}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Plane>
      )}

      {caps.receive && (
        <div className="ax-mobilebar">
          <button type="button" className="ax-btn primary" onClick={() => setPicking(true)}><PackageOpen size={16} aria-hidden />Receber material</button>
        </div>
      )}

      {receiving && <ReceiveFlow data={data} orderId={receiveId || null}
        onClose={() => { setPicking(false); patch({ receive: null }); }} onDone={refresh} />}
      {panel?.kind === 'ship' && <ShipmentPanel order={panel.entry} onClose={() => setPanel(null)} onDone={() => { setPanel(null); refresh(); }} />}
      {panel?.kind === 'transfer' && <TransferReceivePanel transfer={panel.entry} onClose={() => setPanel(null)} onDone={() => { setPanel(null); refresh(); }} />}
      {inspectReceipt && <InspectPanel receipt={inspectReceipt} data={data} onClose={() => setPanel(null)} onDone={() => { setPanel(null); refresh(); }} />}
      {openReceipt && !inspectReceipt && <ReceiptPanel receipt={openReceipt} canAttach={caps.receive} onClose={() => patch({ receipt: null })}
        onInspect={caps.inspect ? () => { patch({ receipt: null }); setPanel({ kind: 'inspect', receiptId: openReceipt.id }); } : undefined} />}
    </>
  );
}
