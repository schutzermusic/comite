'use client';

import { useState } from 'react';
import { INVENTORY_EXCEPTION_LABEL } from '@/lib/supply/inventory';
import {
  LiveSep, Metrics, ResourceState, TabPanel, WorkspaceHeading, WorkspaceTabs, useOperationsResource,
} from '@/components/operations/ui';
import '../supply.css';
import { PositionTab, LocationsPanel } from './PositionTab';
import { ReservationsTab } from './ReservationsTab';
import { MovementsTab } from './MovementsTab';
import { TransfersTab } from './TransfersTab';
import { CountsTab } from './CountsTab';
import { qty, type InventoryModel } from './shared';

type Tab = 'position' | 'reservations' | 'movements' | 'transfers' | 'counts' | 'locations';
type Payload = InventoryModel & { ok: true };

/**
 * ESTOQUE — uma tela, cinco abas (Posição | Reservas | Movimentações |
 * Transferências | Inventário) e os locais. Tudo derivado do livro; todo ato
 * passa por uma função governada que refaz a conta no banco.
 */
export function InventoryWorkspace() {
  const { data, state, message, refresh } = useOperationsResource<Payload>('/api/supply/inventory');
  const [tab, setTab] = useState<Tab>('position');
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const activeRes = data.reservations.filter((r) => r.status === 'ACTIVE');
  const moving = data.transfers.filter((t) => t.status === 'IN_TRANSIT' || t.status === 'PARTIALLY_RECEIVED');
  const sum = (f: (p: InventoryModel['position'][number]) => number) => data.position.reduce((a, p) => a + f(p), 0);
  const skus = new Set(data.position.filter((p) => p.onHand > 0).map((p) => p.itemId)).size;
  return (
    <section className="crm-workspace ops-workspace" aria-label="Estoque" data-testid="inventory-workspace">
      <WorkspaceHeading
        eyebrow="Supply Chain · Estoque"
        title="Posição, reservas e movimentação"
        description={<><span><b>{skus}</b> item(ns) em estoque</span><LiveSep />
          <span><b>{activeRes.length}</b> reserva(s) ativa(s)</span><LiveSep />
          <span className={moving.length ? 'crm-tone-info' : undefined}><b>{moving.length}</b> em trânsito</span>
          {data.exceptions.length > 0 && <><LiveSep /><span className="crm-tone-warning"><b>{data.exceptions.length}</b> exceção(ões)</span></>}</>}
      />
      <Metrics items={[
        { label: 'Locais', value: data.locations.filter((l) => l.active).length, hint: 'Almoxarifados, canteiros, quarentena', accent: true },
        { label: 'Em mão', value: qty(sum((p) => p.onHand)), hint: 'Soma do livro (unidades mistas)' },
        { label: 'Reservado', value: qty(sum((p) => p.reserved)), hint: 'Segurado para requisitos', tone: 'info' },
        { label: 'Em inspeção', value: qty(sum((p) => p.inspection)), hint: 'Quarentena — não cobre demanda',
          tone: sum((p) => p.inspection) ? 'warning' : 'neutral' },
        { label: 'Exceções', value: data.exceptions.length, hint: 'Pedem uma pessoa', tone: data.exceptions.length ? 'warning' : 'neutral' },
      ]} />
      {data.exceptions.length > 0 && (
        <div className="sup-exceptions" data-testid="inventory-exceptions" aria-label="Exceções de estoque">
          {data.exceptions.slice(0, 8).map((e) => (
            <div key={`${e.kind}:${e.ref}`} className="sup-exception">
              <b>{INVENTORY_EXCEPTION_LABEL[e.kind]}</b>
              <div><b>{e.title}</b><p>{e.detail}</p></div>
            </div>
          ))}
        </div>
      )}
      <WorkspaceTabs label="Áreas do estoque" active={tab} onChange={setTab} tabs={[
        { id: 'position', label: 'Posição' },
        { id: 'reservations', label: 'Reservas', count: activeRes.length },
        { id: 'movements', label: 'Movimentações' },
        { id: 'transfers', label: 'Transferências', count: data.transfers.filter((t) => ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(t.status)).length },
        { id: 'counts', label: 'Inventário', count: data.counts.filter((c) => c.status === 'OPEN').length, tone: 'warning' },
        { id: 'locations', label: 'Locais' },
      ]} />
      {tab === 'position' && <TabPanel id="position"><PositionTab data={data} items={data.items} onChanged={refresh} /></TabPanel>}
      {tab === 'reservations' && <TabPanel id="reservations"><ReservationsTab data={data} onChanged={refresh} /></TabPanel>}
      {tab === 'movements' && <TabPanel id="movements"><MovementsTab data={data} /></TabPanel>}
      {tab === 'transfers' && <TabPanel id="transfers"><TransfersTab data={data} items={data.items} onChanged={refresh} /></TabPanel>}
      {tab === 'counts' && <TabPanel id="counts"><CountsTab data={data} onChanged={refresh} /></TabPanel>}
      {tab === 'locations' && <TabPanel id="locations"><LocationsPanel data={data} projects={data.projects} onChanged={refresh} /></TabPanel>}
    </section>
  );
}
