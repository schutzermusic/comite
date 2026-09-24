'use client';

import { useState } from 'react';
import {
  LiveSep, Metrics, ResourceState, TabPanel, WorkspaceHeading, WorkspaceTabs, useOperationsResource,
} from '@/components/operations/ui';
import '../supply.css';
import { RequisitionsTab } from './RequisitionsTab';
import { RfqsTab } from './RfqsTab';
import { ApprovalsTab } from './ApprovalsTab';
import { OrdersTab } from './OrdersTab';
import { brlOf, type ProcurementModel } from './shared';

type Tab = 'requests' | 'rfqs' | 'approvals' | 'orders';

/**
 * COMPRAS — Solicitações | Cotações | Aprovações | Pedidos. A compra nasce da
 * falta, compara além do preço, aprova sob a regra do inquilino e emite o
 * pedido que vira "em pedido" na cobertura do projeto.
 */
export function ProcurementWorkspace() {
  const { data, state, message, refresh } = useOperationsResource<ProcurementModel & { ok: true }>('/api/supply/procurement');
  const [tab, setTab] = useState<Tab>('requests');
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const waiting = data.requisitions.filter((r) => r.status === 'SUBMITTED').length;
  const openRfqs = data.rfqs.filter((r) => r.status === 'OPEN').length;
  const approving = data.purchaseOrders.filter((o) => o.status === 'APPROVAL_REQUIRED').length;
  const issued = data.purchaseOrders.filter((o) => o.status === 'ISSUED' || o.status === 'PARTIALLY_RECEIVED');
  const exposure = issued.reduce((a, o) => a + o.total, 0);
  return (
    <section className="crm-workspace ops-workspace" aria-label="Compras" data-testid="procurement-workspace">
      <WorkspaceHeading
        eyebrow="Supply Chain · Compras"
        title="Da falta ao pedido emitido"
        description={<><span className={waiting ? 'crm-tone-warning' : undefined}><b>{waiting}</b> requisição(ões) aguardando cotação</span><LiveSep />
          <span><b>{openRfqs}</b> cotação(ões) aberta(s)</span><LiveSep />
          <span className={approving ? 'crm-tone-warning' : undefined}><b>{approving}</b> em aprovação</span></>}
      />
      <Metrics items={[
        { label: 'Aguardando cotação', value: waiting, hint: 'Requisições da falta ou manuais', tone: waiting ? 'warning' : 'neutral', accent: true },
        { label: 'Cotações abertas', value: openRfqs, hint: 'Propostas sendo recebidas' },
        { label: 'Em aprovação', value: approving, hint: 'Política do motor ou alçada declarada', tone: approving ? 'warning' : 'neutral' },
        { label: 'Pedidos emitidos', value: issued.length, hint: 'Aguardando entrega', tone: 'info' },
        { label: 'Exposição em pedido', value: brlOf(exposure), hint: 'Soma dos pedidos emitidos em aberto' },
      ]} />
      <WorkspaceTabs label="Etapas de compras" active={tab} onChange={setTab} tabs={[
        { id: 'requests', label: 'Solicitações', count: waiting, tone: 'warning' },
        { id: 'rfqs', label: 'Cotações', count: openRfqs },
        { id: 'approvals', label: 'Aprovações', count: approving, tone: 'warning' },
        { id: 'orders', label: 'Pedidos', count: issued.length },
      ]} />
      {tab === 'requests' && <TabPanel id="requests"><RequisitionsTab data={data} onChanged={refresh} /></TabPanel>}
      {tab === 'rfqs' && <TabPanel id="rfqs"><RfqsTab data={data} onChanged={refresh} /></TabPanel>}
      {tab === 'approvals' && <TabPanel id="approvals"><ApprovalsTab data={data} onChanged={refresh} /></TabPanel>}
      {tab === 'orders' && <TabPanel id="orders"><OrdersTab data={data} onChanged={refresh} /></TabPanel>}
    </section>
  );
}
