'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { HudButton } from '@/components/hud';
import { RESERVATION_STATUS_LABEL } from '@/lib/supply/inventory';
import { DataTable, EmptyNote, Segments, StatePill, Toolbar, day, matches } from '@/components/operations/ui';
import { ActModal, newKey, qty, useInventoryAct, type InventoryModel } from './shared';

type Reservation = InventoryModel['reservations'][number];
type Mode = 'release' | 'issue' | 'return';
const MODE_LABEL: Record<Mode, string> = { release: 'Liberar reserva', issue: 'Entregar à obra', return: 'Devolver da obra' };

/** RESERVAS — o que está segurado para qual requisito; liberar, entregar e devolver são atos com rastro. */
export function ReservationsTab({ data, onChanged }: { data: InventoryModel; onChanged: () => void }) {
  const [filter, setFilter] = useState<'ACTIVE' | 'closed'>('ACTIVE');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState<{ r: Reservation; mode: Mode } | null>(null);
  const rows = useMemo(() => data.reservations
    .filter((r) => (filter === 'ACTIVE' ? r.status === 'ACTIVE' : r.status !== 'ACTIVE'))
    .filter((r) => !search || matches(search, r.itemCode, r.itemDescription, r.project, r.locationName, r.requirementTitle)),
  [data, filter, search]);
  const caps = data.capabilities;
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar material, projeto ou local">
        <Segments label="Situação da reserva" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[
          { value: 'ACTIVE', label: 'Ativas', count: data.reservations.filter((r) => r.status === 'ACTIVE').length },
          { value: 'closed', label: 'Encerradas (60 dias)', count: data.reservations.filter((r) => r.status !== 'ACTIVE').length },
        ]} />
      </Toolbar>
      <DataTable label="Reservas" columns={['Projeto', 'Material', 'Local', 'Em aberto', 'Consumido', 'Necessário em', 'Situação', '']}
        count={rows.length} footer="Reserva nasce de requisito confirmado — nunca de nome livre"
        empty={<EmptyNote title="Nenhuma reserva neste recorte" description="Reserve a partir da demanda (Planejamento de Materiais ou aba Materiais do projeto)." />}>
        {rows.map((r) => (
          <tr key={r.id} data-testid="reservation-row">
            <td><Link href={`/projetos/${encodeURIComponent(r.projectId)}?tab=supply`}>{r.project}</Link>
              <p className="crm-muted">{r.requirementTitle}</p></td>
            <td><b>{r.itemCode}</b> {r.itemDescription}</td>
            <td>{r.locationName}</td>
            <td className="tabular-nums">{qty(r.open)} {r.unit}<p className="crm-muted">de {qty(r.quantity)}</p></td>
            <td className="tabular-nums">{r.consumed ? qty(r.consumed) : '—'}</td>
            <td>{day(r.requiredBy)}</td>
            <td><StatePill tone={r.status === 'ACTIVE' ? 'accent' : r.status === 'CONSUMED' ? 'success' : 'neutral'}>{RESERVATION_STATUS_LABEL[r.status]}</StatePill>
              {r.closeReason && <p className="crm-muted">{r.closeReason}</p>}</td>
            <td className="ops-row-actions">
              {r.status === 'ACTIVE' && caps.manage && <HudButton size="sm" variant="primary" onClick={() => setActing({ r, mode: 'issue' })}>Entregar</HudButton>}
              {r.status === 'ACTIVE' && caps.reserve && <HudButton size="sm" variant="ghost" onClick={() => setActing({ r, mode: 'release' })}>Liberar</HudButton>}
              {r.consumed > 0 && caps.manage && <HudButton size="sm" variant="ghost" onClick={() => setActing({ r, mode: 'return' })}>Devolver</HudButton>}
            </td>
          </tr>
        ))}
      </DataTable>
      {acting && <ReservationModal data={data} r={acting.r} mode={acting.mode} onClose={() => setActing(null)}
        onDone={() => { setActing(null); onChanged(); }} />}
    </>
  );
}

function ReservationModal({ data, r, mode, onClose, onDone }: { data: InventoryModel; r: Reservation; mode: Mode; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const max = mode === 'return' ? r.consumed : r.open;
  const [quantity, setQuantity] = useState(String(max));
  const [reason, setReason] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [locationId, setLocationId] = useState(r.locationId);
  const n = Number(quantity.replace(',', '.'));
  const needsReason = mode !== 'issue';
  const valid = n > 0 && n <= max && (!needsReason || reason.trim().length >= 3) && (r.tracking === 'NONE' || mode === 'release' || lotCode.trim());
  const body: Record<string, unknown> = mode === 'release' ? { action: 'release', quantity: n, reason: reason.trim() }
    : mode === 'issue' ? { action: 'issue', quantity: n, lotCode: lotCode.trim() || null, idempotencyKey: newKey() }
      : { action: 'return', quantity: n, reason: reason.trim(), locationId, lotCode: lotCode.trim() || null, idempotencyKey: newKey() };
  return (
    <ActModal title={MODE_LABEL[mode]} subtitle={`${r.itemCode} · ${r.project} · ${r.locationName}`} onClose={onClose} busy={busy}
      disabled={!valid} confirmLabel={MODE_LABEL[mode]} testId="reservation-form"
      onConfirm={() => act(`/api/supply/inventory/reservations/${r.id}`, body, MODE_LABEL[mode])}>
      <label>Quantidade ({r.unit}) — até {qty(max)}<input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
      {mode !== 'release' && r.tracking !== 'NONE' && <label>{r.tracking === 'LOT' ? 'Lote' : 'Número de série'}
        <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} /></label>}
      {mode === 'return' && <label>Devolver para<select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
        {data.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
      {needsReason && <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder={mode === 'release' ? 'Replanejamento, troca de material…' : 'Sobra de obra…'} /></label>}
      {mode === 'return' && <p className="crm-muted">Material devolvido volta como estoque livre — a falta do requisito reaparece até nova reserva.</p>}
    </ActModal>
  );
}
