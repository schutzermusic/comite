'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { HudButton } from '@/components/hud';
import { REQUISITION_STATUS_LABEL, SUPPLIER_STATUS_LABEL } from '@/lib/supply/procurement';
import { REQUIREMENT_PRIORITY_LABEL } from '@/lib/supply/coverage';
import {
  DataTable, EmptyNote, GovernanceNote, Segments, StatePill, Toolbar, day, matches, useOperationsResource,
} from '@/components/operations/ui';
import { ActModal, newKey, qty, useInventoryAct } from '../inventory/shared';
import type { ProcurementModel } from './shared';

type Requisition = ProcurementModel['requisitions'][number];

/** SOLICITAÇÕES — o que precisa ser comprado, de qual requisito veio, e o que já está em cotação. */
export function RequisitionsTab({ data, onChanged }: { data: ProcurementModel; onChanged: () => void }) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [modal, setModal] = useState<'rfq' | 'manual' | { cancel: Requisition } | null>(null);
  const rows = useMemo(() => data.requisitions
    .filter((r) => filter === 'all' || r.status === 'SUBMITTED' || r.status === 'SOURCING')
    .filter((r) => !search || matches(search, r.number, r.project, ...r.lines.map((l) => `${l.itemCode} ${l.itemDescription}`))),
  [data, filter, search]);
  const caps = data.capabilities;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar requisição, projeto ou material">
        <Segments label="Recorte" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[
          { value: 'open', label: 'Aguardando compra', count: data.requisitions.filter((r) => r.status === 'SUBMITTED' || r.status === 'SOURCING').length },
          { value: 'all', label: 'Todas (90 dias)', count: data.requisitions.length },
        ]} />
        {caps.source && <HudButton size="sm" variant="primary" disabled={!picked.length} onClick={() => setModal('rfq')}>
          Abrir cotação ({picked.length})</HudButton>}
        {caps.request && <HudButton size="sm" variant="ghost" onClick={() => setModal('manual')}>Requisição manual</HudButton>}
      </Toolbar>
      <DataTable label="Requisições de compra" columns={['Cotar', 'Requisição', 'Projeto', 'Material', 'Necessário em', 'Origem', 'Situação', '']}
        count={rows.length} footer="Requisição da falta guarda de qual requisito veio cada quantidade"
        empty={<EmptyNote title="Nenhuma requisição aguardando" description="Requisite a partir da falta de material (Planejamento de Materiais ou aba Materiais do projeto)." />}>
        {rows.flatMap((r) => r.lines.map((l, i) => (
          <tr key={l.id} data-testid="requisition-row">
            <td>{caps.source && ['SUBMITTED', 'SOURCING'].includes(r.status) && !l.inRfq && (
              <input type="checkbox" aria-label={`Cotar ${l.itemCode} de ${r.number}`} checked={picked.includes(l.id)} onChange={() => toggle(l.id)} />)}</td>
            <td className="tabular-nums">{i === 0 ? <b>{r.number}</b> : null}<p className="crm-muted">{REQUIREMENT_PRIORITY_LABEL[r.priority] ?? r.priority}</p></td>
            <td>{r.projectId ? <Link href={`/projetos/${encodeURIComponent(r.projectId)}?tab=supply`}>{r.project}</Link> : r.project}</td>
            <td><b>{l.itemCode}</b> {l.itemDescription} · {qty(l.quantity)} {l.unit}
              {l.requirements.length > 0 && <p className="crm-muted">{l.requirements.map((q) => `${q.title} (${qty(q.quantity)})`).join(' · ')}</p>}</td>
            <td>{day(l.requiredBy)}</td>
            <td>{r.source === 'SHORTAGE' ? 'Falta do plano' : <span title={r.justification ?? ''}>Manual</span>}</td>
            <td><StatePill tone={r.status === 'SUBMITTED' ? 'warning' : r.status === 'SOURCING' ? 'info' : r.status === 'ORDERED' ? 'success' : 'neutral'}>
              {l.inRfq && r.status === 'SUBMITTED' ? 'Em cotação' : REQUISITION_STATUS_LABEL[r.status]}</StatePill></td>
            <td>{i === 0 && ['SUBMITTED', 'SOURCING'].includes(r.status) && (caps.request || caps.source) && (
              <HudButton size="sm" variant="ghost" onClick={() => setModal({ cancel: r })}>Cancelar</HudButton>)}</td>
          </tr>
        )))}
      </DataTable>
      <GovernanceNote>A mesma falta não é requisitada duas vezes: o banco desconta o que já está requisitado, reservado, em trânsito ou em pedido.</GovernanceNote>
      {modal === 'rfq' && <RfqModal data={data} lineIds={picked} onClose={() => setModal(null)}
        onDone={() => { setModal(null); setPicked([]); onChanged(); }} />}
      {modal === 'manual' && <ManualModal data={data} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); }} />}
      {modal && typeof modal === 'object' && <CancelModal r={modal.cancel} onClose={() => setModal(null)} onDone={() => { setModal(null); onChanged(); }} />}
    </>
  );
}

function RfqModal({ data, lineIds, onClose, onDone }: { data: ProcurementModel; lineIds: string[]; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const eligible = data.suppliers.filter((s) => s.status === 'PROSPECT' || s.status === 'HOMOLOGATED');
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [due, setDue] = useState('');
  return (
    <ActModal title="Abrir cotação" subtitle={`${lineIds.length} linha(s) de requisição`} onClose={onClose} busy={busy}
      disabled={!suppliers.length} confirmLabel="Abrir cotação" testId="rfq-form"
      onConfirm={() => act('/api/supply/procurement/rfqs', { requisitionLineIds: lineIds, supplierIds: suppliers, responseDue: due || null },
        'Cotação aberta')}>
      <fieldset className="ops-form"><legend className="crm-muted">Fornecedores convidados</legend>
        {eligible.length === 0 && <p className="crm-muted">Nenhum fornecedor apto. Cadastre em Supply Chain → Fornecedores.</p>}
        {eligible.map((s) => (
          <label key={s.id} className="flex-row items-center" style={{ display: 'flex', gap: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={suppliers.includes(s.id)}
              onChange={() => setSuppliers((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} />
            {s.name} <span className="crm-muted">· {SUPPLIER_STATUS_LABEL[s.status]}{s.categories.length ? ` · ${s.categories.join(', ')}` : ''}</span>
          </label>
        ))}
      </fieldset>
      <label>Prazo de resposta<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
    </ActModal>
  );
}

function ManualModal({ data, onClose, onDone }: { data: ProcurementModel; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const catalog = useOperationsResource<{ ok: true; items: Array<{ id: string; code: string; description: string; unit: string }> }>('/api/supply/items');
  const items = catalog.data?.items ?? [];
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [location, setLocation] = useState('');
  const [justification, setJustification] = useState('');
  const n = Number(quantity.replace(',', '.'));
  return (
    <ActModal title="Requisição manual" subtitle="Exceção ao fluxo da falta: a justificativa fica registrada." onClose={onClose} busy={busy}
      disabled={!itemId || !(n > 0) || justification.trim().length < 10} confirmLabel="Requisitar" testId="manual-requisition-form"
      onConfirm={() => act('/api/supply/procurement/requisitions', { source: 'MANUAL', justification: justification.trim(),
        requiredBy: requiredBy || null, deliveryLocationId: location || null, idempotencyKey: newKey(),
        lines: [{ itemId, quantity: n }] }, 'Requisição registrada')}>
      <label>Item<select value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">Selecione…</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description} ({i.unit})</option>)}</select></label>
      <div className="ops-form-row">
        <label>Quantidade<input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
        <label>Necessário em<input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} /></label>
      </div>
      <label>Local de entrega<select value={location} onChange={(e) => setLocation(e.target.value)}><option value="">—</option>
        {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label>Justificativa (mín. 10 caracteres)<textarea value={justification} onChange={(e) => setJustification(e.target.value)} /></label>
    </ActModal>
  );
}

function CancelModal({ r, onClose, onDone }: { r: Requisition; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [reason, setReason] = useState('');
  return (
    <ActModal title={`Cancelar ${r.number}`} onClose={onClose} busy={busy} disabled={reason.trim().length < 3} confirmLabel="Cancelar requisição"
      onConfirm={() => act(`/api/supply/procurement/requisitions/${r.id}`, { action: 'cancel', reason: reason.trim() }, 'Requisição cancelada')}>
      <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </ActModal>
  );
}
