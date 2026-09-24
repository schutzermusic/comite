'use client';

import { useMemo, useState } from 'react';
import { HudButton } from '@/components/hud';
import { LOCATION_KIND_LABEL, type LocationKind } from '@/lib/supply/inventory';
import { DataTable, EmptyNote, Filter, GovernanceNote, StatePill, Toolbar, day, matches } from '@/components/operations/ui';
import { ActModal, newKey, qty, useInventoryAct, type InventoryModel } from './shared';

type Item = { id: string; code: string; description: string; unit: string; tracking: string };

/** POSIÇÃO — item × local: em mão, reservado, disponível, em inspeção e entrando, visualmente distintos. */
export function PositionTab({ data, items, onChanged }: { data: InventoryModel; items: Item[]; onChanged: () => void }) {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('all');
  const [adjusting, setAdjusting] = useState(false);
  const rows = useMemo(() => data.position
    .filter((p) => location === 'all' || p.locationId === location)
    .filter((p) => !search || matches(search, p.itemCode, p.itemDescription, p.locationName)), [data, search, location]);

  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar item ou local">
        <Filter label="Local" value={location} onChange={setLocation}
          options={[{ value: 'all', label: 'Todos os locais' }, ...data.locations.map((l) => ({ value: l.id, label: l.name }))]} />
        {data.capabilities.manage && <HudButton size="sm" variant="primary" onClick={() => setAdjusting(true)}>Ajustar estoque</HudButton>}
      </Toolbar>
      <DataTable label="Posição de estoque" columns={['Item', 'Local', 'Em mão', 'Reservado', 'Disponível', 'Em inspeção', 'Entrando', 'Último movimento']}
        count={rows.length} footer="Em mão = soma do livro · disponível = em mão − reservado"
        empty={<EmptyNote title={data.position.length ? 'Nada neste recorte' : 'Nenhum saldo em estoque'}
          description={data.position.length ? 'Mude o filtro ou a busca.'
            : data.locations.length ? 'Registre o saldo inicial com um ajuste (motivo "Saldo inicial").' : 'Cadastre um local de estoque para começar.'} />}>
        {rows.map((p) => (
          <tr key={`${p.itemId}:${p.locationId}`} data-testid="position-row">
            <td><b>{p.itemCode}</b> {p.itemDescription}<p className="crm-muted">{p.unit}{p.tracking !== 'NONE' ? ` · por ${p.tracking === 'LOT' ? 'lote' : 'série'}` : ''}</p></td>
            <td>{p.locationName}<p className="crm-muted">{LOCATION_KIND_LABEL[p.locationKind]}</p></td>
            <td className="tabular-nums">{qty(p.onHand)}</td>
            <td className="tabular-nums">{p.reserved ? qty(p.reserved) : '—'}</td>
            <td className="tabular-nums">
              <StatePill tone={p.available < 0 ? 'danger' : p.available === 0 ? 'neutral' : 'success'}>{qty(p.available)}</StatePill>
            </td>
            <td className="tabular-nums">{p.inspection ? qty(p.inspection) : '—'}</td>
            <td className="tabular-nums">{p.inboundTransit ? qty(p.inboundTransit) : '—'}</td>
            <td>{p.lastMovementAt ? day(p.lastMovementAt.slice(0, 10)) : '—'}</td>
          </tr>
        ))}
      </DataTable>
      <GovernanceNote>
        Reserva tira da disponibilidade, não da prateleira. Estoque em quarentena aparece como “em inspeção” e não cobre demanda
        até ser transferido para um local liberado.
      </GovernanceNote>
      {adjusting && <AdjustModal data={data} items={items} onClose={() => setAdjusting(false)} onDone={() => { setAdjusting(false); onChanged(); }} />}
    </>
  );
}

function AdjustModal({ data, items, onClose, onDone }: { data: InventoryModel; items: Item[]; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState(data.locations.find((l) => l.active)?.id ?? '');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [reason, setReason] = useState('Saldo inicial');
  const item = items.find((i) => i.id === itemId);
  const n = Number(quantity.replace(',', '.'));
  const valid = itemId && locationId && n > 0 && reason.trim().length >= 3 && (item?.tracking === 'NONE' || lotCode.trim());
  return (
    <ActModal title="Ajustar estoque" subtitle="Ajuste vira uma linha do livro com o seu nome e o motivo. Saída não pode tirar saldo reservado."
      onClose={onClose} busy={busy} disabled={!valid} confirmLabel="Registrar ajuste" testId="adjust-form"
      onConfirm={() => act('/api/supply/inventory/adjustments', { itemId, locationId, quantity: direction === 'in' ? n : -n,
        lotCode: lotCode.trim() || null, reason: reason.trim(), idempotencyKey: newKey() }, 'Ajuste registrado')}>
      <label>Item<select value={itemId} onChange={(e) => setItemId(e.target.value)}>
        <option value="">Selecione…</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description} ({i.unit})</option>)}</select></label>
      <div className="ops-form-row">
        <label>Local<select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {data.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Sentido<select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
          <option value="in">Entrada (+)</option><option value="out">Saída (−)</option></select></label>
      </div>
      <div className="ops-form-row">
        <label>Quantidade{item ? ` (${item.unit})` : ''}<input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
        {item && item.tracking !== 'NONE' && <label>{item.tracking === 'LOT' ? 'Lote' : 'Número de série'}
          <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} /></label>}
      </div>
      <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </ActModal>
  );
}

/** LOCAIS — cadastro enxuto; zona e posição são opcionais. */
export function LocationsPanel({ data, projects, onChanged }: {
  data: InventoryModel; projects: Array<{ id: string; name: string }>; onChanged: () => void;
}) {
  const [editing, setEditing] = useState<boolean>(false);
  return (
    <>
      <DataTable label="Locais de estoque" columns={['Código', 'Local', 'Tipo', 'Projeto', 'Coordenadas', 'Situação']} count={data.locations.length}
        footer="Locais com coordenadas aparecem no Mapa de Operações"
        empty={<EmptyNote title="Nenhum local cadastrado" description="Cadastre ao menos um almoxarifado para registrar estoque." />}>
        {data.locations.map((l) => (
          <tr key={l.id}>
            <td className="tabular-nums"><b>{l.code}</b></td>
            <td>{l.name}{l.addressLabel && <p className="crm-muted">{l.addressLabel}</p>}</td>
            <td>{LOCATION_KIND_LABEL[l.kind]}</td>
            <td>{l.project ?? '—'}</td>
            <td className="tabular-nums">{l.latitude !== null ? `${l.latitude.toFixed(4)}, ${l.longitude?.toFixed(4)}` : '—'}</td>
            <td><StatePill tone={l.active ? 'success' : 'neutral'}>{l.active ? 'Ativo' : 'Inativo'}</StatePill></td>
          </tr>
        ))}
      </DataTable>
      {data.capabilities.manage && <div style={{ padding: '10px 14px' }}><HudButton size="sm" variant="primary" onClick={() => setEditing(true)}>Novo local</HudButton></div>}
      {editing && <LocationModal data={data} projects={projects} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChanged(); }} />}
    </>
  );
}

function LocationModal({ data, projects, onClose, onDone }: {
  data: InventoryModel; projects: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void;
}) {
  const { act, busy } = useInventoryAct(onDone);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LocationKind>('WAREHOUSE');
  const [parentId, setParentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const valid = code.trim() && name.trim() && (kind !== 'PROJECT_SITE' || projectId) && (!lat === !lng);
  return (
    <ActModal title="Novo local de estoque" onClose={onClose} busy={busy} disabled={!valid} confirmLabel="Cadastrar" testId="location-form"
      onConfirm={() => act('/api/supply/inventory/locations', { code: code.trim().toUpperCase(), name: name.trim(), kind,
        parentId: parentId || null, projectId: projectId || null, addressLabel: address.trim() || null,
        latitude: lat ? Number(lat) : null, longitude: lng ? Number(lng) : null }, 'Local cadastrado')}>
      <div className="ops-form-row">
        <label>Código<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ALM-SP" /></label>
        <label>Tipo<select value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
          {(Object.keys(LOCATION_KIND_LABEL) as LocationKind[]).map((k) => <option key={k} value={k}>{LOCATION_KIND_LABEL[k]}</option>)}</select></label>
      </div>
      <label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="ops-form-row">
        <label>Dentro de<select value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">—</option>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Projeto{kind === 'PROJECT_SITE' ? ' (obrigatório)' : ''}<select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <label>Endereço<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
      <div className="ops-form-row">
        <label>Latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></label>
        <label>Longitude<input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></label>
      </div>
    </ActModal>
  );
}
