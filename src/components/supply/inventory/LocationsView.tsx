'use client';

import { useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { LOCATION_KIND_LABEL, type LocationKind } from '@/lib/supply/inventory';
import { Busy, Chip, EmptyState, Plane, SidePanel, href, plural, useGovernedAction } from '@/components/ax';
import type { InventoryModel } from './shared';

/** LOCAIS — onde o estoque mora; canteiro é do projeto, quarentena não é disponibilidade. Com coordenadas, aparecem no Mapa de Operações. */
export function LocationsView({ data, onChanged }: { data: InventoryModel; onChanged: () => void }) {
  const [creating, setCreating] = useState(false);
  const stats = (id: string) => {
    const rows = data.position.filter((p) => p.locationId === id && p.onHand > 0);
    return { items: rows.length, reserved: rows.filter((p) => p.reserved > 0).length };
  };
  return (
    <Plane flush title="Locais de estoque" count={data.locations.filter((l) => l.active).length}
      subtitle="Almoxarifados, canteiros de obra, veículos e quarentena — locais com coordenadas aparecem no Mapa de Operações"
      action={data.capabilities.manage ? <button type="button" className="ax-btn sm" onClick={() => setCreating(true)}><Plus size={13} aria-hidden />Novo local</button> : undefined}>
      {data.locations.length === 0 ? <EmptyState title="Nenhum local cadastrado">Cadastre ao menos um almoxarifado para registrar estoque.</EmptyState> : (
        <div className="ax-loc-grid">
          {data.locations.map((l) => {
            const s = stats(l.id);
            return (
              <article key={l.id} className="ax-loc" data-kind={l.kind} data-inactive={!l.active || undefined}>
                <header><span className="ax-kind">{LOCATION_KIND_LABEL[l.kind]}</span>{!l.active && <Chip tone="neutral" quiet>Inativo</Chip>}</header>
                <strong>{l.name}</strong>
                <small className="ax-subtle">{l.code}{l.project ? ` · ${l.project}` : ''}</small>
                <p>{l.kind === 'QUARANTINE' ? `${plural(s.items, 'item', 'itens')} esperando inspeção` : `${plural(s.items, 'item', 'itens')} com saldo · ${s.reserved} com reserva`}</p>
                <footer>
                  {l.latitude !== null ? <a className="ax-link" href={href.map(l.projectId ?? undefined)}><MapPin size={12} aria-hidden /> no mapa</a>
                    : <span className="ax-subtle">sem coordenadas</span>}
                  {l.addressLabel && <span className="ax-subtle">{l.addressLabel}</span>}
                </footer>
              </article>
            );
          })}
        </div>
      )}
      {creating && <LocationPanel data={data} onClose={() => setCreating(false)} onDone={() => { setCreating(false); onChanged(); }} />}
    </Plane>
  );
}

function LocationPanel({ data, onClose, onDone }: { data: InventoryModel; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
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
    <SidePanel open onClose={onClose} testId="location-form" eyebrow="Estoque · locais" title="Novo local de estoque"
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!valid || busy !== null}
          onClick={() => run('location', '/api/supply/inventory/locations', { code: code.trim().toUpperCase(), name: name.trim(), kind,
            parentId: parentId || null, projectId: projectId || null, addressLabel: address.trim() || null,
            latitude: lat ? Number(lat.replace(',', '.')) : null, longitude: lng ? Number(lng.replace(',', '.')) : null },
            { title: 'Local cadastrado' }, { idempotent: false })}>
          <Busy on={busy !== null}>Cadastrar</Busy></button>
      </>}>
      <div className="ax-form">
        <div className="ax-field-row">
          <label className="ax-field"><span>Código</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ALM-SP" /></label>
          <label className="ax-field"><span>Tipo</span><select value={kind} onChange={(e) => setKind(e.target.value as LocationKind)}>
            {(Object.keys(LOCATION_KIND_LABEL) as LocationKind[]).map((k) => <option key={k} value={k}>{LOCATION_KIND_LABEL[k]}</option>)}</select></label>
        </div>
        <label className="ax-field"><span>Nome</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Dentro de</span><select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">—</option>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="ax-field"><span>Projeto{kind === 'PROJECT_SITE' ? ' (obrigatório)' : ''}</span><select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">—</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        </div>
        <label className="ax-field"><span>Endereço</span><input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Latitude</span><input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} /></label>
          <label className="ax-field"><span>Longitude</span><input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} /></label>
        </div>
      </div>
    </SidePanel>
  );
}
