'use client';

import { useState } from 'react';
import { PO_STATUS_LABEL, PO_STATUS_TONE } from '@/lib/supply/procurement';
import {
  Chip, EmptyState, Filters, Meter, Plane, SearchBox, dateShort, money, qty, useUrlParam, useUrlParams, type Tone,
} from '@/components/ax';
import { OrderPanel, governanceLabel } from './OrderPanel';
import type { ProcurementModel } from './shared';

type Order = ProcurementModel['purchaseOrders'][number];
const OPEN = ['DRAFT', 'APPROVAL_REQUIRED', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'];
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const TONE: Record<string, Tone> = { DRAFT: 'neutral', APPROVAL_REQUIRED: 'warning', APPROVED: 'accent', ISSUED: 'info', PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success', CLOSED: 'neutral', CANCELLED: 'neutral', REJECTED: 'danger' };

/** Lista de pedidos (também usada pela etapa de aprovação) e o painel do pedido endereçável por `?po=`. */
export function OrderList({ data, orders, onChanged, emptyTitle, emptyText }: {
  data: ProcurementModel; orders: Order[]; onChanged: () => void; emptyTitle: string; emptyText: string;
}) {
  const [openId] = useUrlParam<string>('po', '');
  const patch = useUrlParams();
  const open = openId ? data.purchaseOrders.find((o) => o.id === openId) ?? null : null;
  return (
    <>
      {orders.length === 0 ? <EmptyState title={emptyTitle}>{emptyText}</EmptyState> : (
        <div className="ax-queue">
          {orders.map((o) => {
            const ordered = o.lines.reduce((a, l) => a + l.quantity, 0);
            const received = o.lines.reduce((a, l) => a + l.received, 0);
            const late = o.expectedDelivery && o.expectedDelivery < data.today && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(o.status) && received < ordered;
            return (
              <div key={o.id} className="ax-row no-owner" data-tone={late ? 'danger' : TONE[o.status] ?? 'neutral'} data-testid="po-row">
                <div className="ax-row-main">
                  <span className="ax-row-eyebrow"><span className="ax-kind">{governanceLabel(o)}</span>
                    <span className="ax-row-where">{o.project}{o.deliveryLocation ? ` · para ${o.deliveryLocation}` : ''}</span></span>
                  <button type="button" className="ax-rowlink ax-row-object" onClick={() => patch({ po: o.id })}>
                    {o.number}<span className="ax-subtle"> · {o.supplier} · {money(o.total, o.currency)}</span></button>
                  <span className="ax-row-issue">{o.lines.map((l) => `${l.itemCode} ${qty(l.quantity, l.unit)}`).join(' · ')}</span>
                </div>
                <div className="ax-cellstack">
                  <span className={late ? 'ax-row-due ax-danger-text' : 'ax-row-due'}>{o.expectedDelivery ? dateShort(o.expectedDelivery) : 'sem data'}</span>
                  {['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(o.status)
                    ? <Meter value={ordered ? received / ordered : 0} tone={received >= ordered ? 'success' : undefined} label={`${o.number}: recebido`} />
                    : <Chip tone={PO_STATUS_TONE[o.status]} quiet>{PO_STATUS_LABEL[o.status]}</Chip>}
                </div>
                <div className="ax-row-actions">
                  <button type="button" className="ax-btn sm" onClick={() => patch({ po: o.id })}>Abrir</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && <OrderPanel order={open} data={data} onClose={() => patch({ po: null })} onChanged={onChanged} />}
    </>
  );
}

/** PEDIDOS — do rascunho à emissão e ao recebimento; o valor é derivado das linhas. */
export function OrdersStage({ data, onChanged }: { data: ProcurementModel; onChanged: () => void }) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [search, setSearch] = useState('');
  const rows = data.purchaseOrders.filter((o) => filter === 'all' || OPEN.includes(o.status))
    .filter((o) => !search || norm([o.number, o.supplier, o.project, ...o.lines.map((l) => `${l.itemCode} ${l.itemDescription}`)].join(' ')).includes(norm(search)));
  return (
    <Plane flush title="Pedidos de compra" count={rows.length} subtitle="Total = linhas + frete + impostos, recalculado — nunca digitado"
      bar={<div className="ax-toolbar">
        <Filters label="Recorte" value={filter} onChange={setFilter} options={[
          { id: 'open', label: 'Em andamento', count: data.purchaseOrders.filter((o) => OPEN.includes(o.status)).length },
          { id: 'all', label: 'Todos (90 dias)', count: data.purchaseOrders.length },
        ]} />
        <SearchBox value={search} onChange={setSearch} placeholder="Pedido, fornecedor, projeto ou material" label="Buscar pedido" />
      </div>}>
      <OrderList data={data} orders={rows} onChanged={onChanged} emptyTitle="Nenhum pedido de compra"
        emptyText="Pedidos nascem da decisão de uma cotação." />
    </Plane>
  );
}
