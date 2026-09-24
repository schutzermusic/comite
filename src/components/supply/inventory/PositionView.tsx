'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { LOCATION_KIND_LABEL } from '@/lib/supply/inventory';
import {
  Busy, EmptyState, Plane, SearchBox, SidePanel, dateShort, parseDecimalBR, plural, qty, useGovernedAction, useUrlParam,
} from '@/components/ax';
import type { InventoryModel } from './shared';

type Row = InventoryModel['position'][number];
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

interface ItemGroup {
  itemId: string; itemCode: string; itemDescription: string; unit: string; tracking: string;
  onHand: number; reserved: number; available: number; inspection: number; inbound: number; lastMovementAt: string | null; rows: Row[];
}

/**
 * POSIÇÃO — a pergunta "quanto temos de X e onde": por ITEM, com a barra do
 * que está livre, reservado, em inspeção e entrando, e cada local abaixo.
 * Disponível = em mão − reservado. Quarentena nunca é disponível.
 */
export function PositionView({ data, onChanged }: { data: InventoryModel; onChanged: () => void }) {
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('all');
  const [focusItem] = useUrlParam<string>('item', '');
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => (focusItem ? { [focusItem]: true } : {}));
  const [adjusting, setAdjusting] = useState(false);
  const groups = useMemo(() => {
    const map = new Map<string, ItemGroup>();
    for (const p of data.position) {
      if (location !== 'all' && p.locationId !== location) continue;
      const g = map.get(p.itemId) ?? { itemId: p.itemId, itemCode: p.itemCode, itemDescription: p.itemDescription, unit: p.unit, tracking: p.tracking,
        onHand: 0, reserved: 0, available: 0, inspection: 0, inbound: 0, lastMovementAt: null, rows: [] };
      if (p.locationKind === 'QUARANTINE') g.inspection += p.onHand;
      else { g.onHand += p.onHand; g.reserved += p.reserved; g.available += p.available; g.inspection += p.inspection; }
      g.inbound += p.inboundTransit;
      if (p.lastMovementAt && (!g.lastMovementAt || p.lastMovementAt > g.lastMovementAt)) g.lastMovementAt = p.lastMovementAt;
      g.rows.push(p);
      map.set(p.itemId, g);
    }
    return Array.from(map.values())
      .filter((g) => !search || norm([g.itemCode, g.itemDescription, ...g.rows.map((r) => r.locationName)].join(' ')).includes(norm(search)))
      .sort((a, b) => Number(b.itemId === focusItem) - Number(a.itemId === focusItem) || a.itemCode.localeCompare(b.itemCode));
  }, [data, location, search, focusItem]);
  const activeLocations = data.locations.filter((l) => l.active);

  return (
    <Plane flush title="Posição por item" count={groups.length}
      subtitle="Em mão = soma do livro · disponível = em mão − reservado · quarentena e trânsito à parte"
      action={data.capabilities.manage ? <button type="button" className="ax-btn sm" onClick={() => setAdjusting(true)}>
        <SlidersHorizontal size={13} aria-hidden />Ajustar estoque</button> : undefined}
      bar={<div className="ax-toolbar">
        <label className="ax-select"><span className="sr-only-ax">Local</span>
          <select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Local">
            <option value="all">Todos os locais</option>
            {activeLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        <SearchBox value={search} onChange={setSearch} placeholder="Item, código ou local" label="Buscar na posição" />
      </div>}>
      {groups.length === 0 ? (
        <EmptyState title={data.position.length ? 'Nada neste recorte' : 'Nenhum saldo em estoque'}>
          {data.position.length ? 'Mude o local ou a busca.' : activeLocations.length
            ? 'Registre o saldo inicial com um ajuste (motivo "Saldo inicial").' : 'Cadastre um local de estoque para começar.'}
        </EmptyState>
      ) : (
        <div className="ax-table-wrap">
          <table className="ax-table cards ax-position">
            <caption className="sr-only-ax">Posição de estoque por item e local</caption>
            <thead><tr>
              <th scope="col">Item</th><th scope="col" style={{ width: '22%' }}>Livre × reservado × inspeção × entrando</th>
              <th scope="col" className="num">Em mão</th><th scope="col" className="num">Reservado</th><th scope="col" className="num">Disponível</th>
              <th scope="col" className="num">Em inspeção</th><th scope="col" className="num">Entrando</th><th scope="col">Último movimento</th>
            </tr></thead>
            <tbody>
              {groups.map((g) => {
                const open = expanded[g.itemId] ?? false;
                const scale = Math.max(g.onHand + g.inspection + g.inbound, 0.0001);
                return (
                  <Fragment key={g.itemId}>
                    <tr className="clickable" data-testid="position-row" aria-expanded={open} aria-selected={g.itemId === focusItem}
                      onClick={() => setExpanded({ ...expanded, [g.itemId]: !open })}>
                      <td className="lead" data-label="">
                        <div className="ax-inline" style={{ alignItems: 'flex-start' }}>
                          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                          <div className="ax-cellstack">
                            <span className="strong">{g.itemDescription}</span>
                            <small>{g.itemCode} · {g.unit}{g.tracking !== 'NONE' ? ` · por ${g.tracking === 'LOT' ? 'lote' : 'série'}` : ''} · {plural(g.rows.length, 'local', 'locais')}</small>
                          </div>
                        </div>
                      </td>
                      <td data-label="Composição">
                        <div className="ax-stockbar" role="img" aria-label={`Livre ${qty(g.available)}, reservado ${qty(g.reserved)}, em inspeção ${qty(g.inspection)}, entrando ${qty(g.inbound)}`}>
                          <i className="free" style={{ width: `${(Math.max(g.available, 0) / scale) * 100}%` }} />
                          <i className="reserved" style={{ width: `${(Math.min(g.reserved, g.onHand) / scale) * 100}%` }} />
                          <i className="inspection" style={{ width: `${(g.inspection / scale) * 100}%` }} />
                          <i className="inbound" style={{ width: `${(g.inbound / scale) * 100}%` }} />
                        </div>
                      </td>
                      <td className="num" data-label="Em mão">{qty(g.onHand)}</td>
                      <td className="num" data-label="Reservado">{g.reserved ? qty(g.reserved) : '—'}</td>
                      <td className={g.available < 0 ? 'num short' : 'num strong'} data-label="Disponível">{qty(g.available)}</td>
                      <td className="num" data-label="Em inspeção">{g.inspection ? qty(g.inspection) : '—'}</td>
                      <td className="num" data-label="Entrando">{g.inbound ? qty(g.inbound) : '—'}</td>
                      <td data-label="Último movimento">{g.lastMovementAt ? dateShort(g.lastMovementAt.slice(0, 10)) : '—'}</td>
                    </tr>
                    {open && g.rows.map((p) => (
                      <tr key={`${p.itemId}:${p.locationId}`} className="sub">
                        <td className="lead" data-label=""><div className="ax-cellstack" style={{ paddingLeft: 22 }}>
                          <span>{p.locationName}</span><small>{LOCATION_KIND_LABEL[p.locationKind]}</small></div></td>
                        <td data-label="" />
                        <td className="num" data-label="Em mão">{qty(p.onHand)}</td>
                        <td className="num" data-label="Reservado">{p.reserved ? qty(p.reserved) : '—'}</td>
                        <td className={p.available < 0 ? 'num short' : 'num'} data-label="Disponível">{p.locationKind === 'QUARANTINE' ? 'não reservável' : qty(p.available)}</td>
                        <td className="num" data-label="Em inspeção">{p.inspection ? qty(p.inspection) : '—'}</td>
                        <td className="num" data-label="Entrando">{p.inboundTransit ? qty(p.inboundTransit) : '—'}</td>
                        <td data-label="Último movimento">{p.lastMovementAt ? dateShort(p.lastMovementAt.slice(0, 10)) : '—'}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="ax-legend" style={{ padding: '10px 16px' }} aria-hidden>
        <span><i style={{ background: 'color-mix(in srgb, var(--ax-success) 38%, var(--ax-plane))' }} />Livre</span><span><i style={{ background: 'var(--ax-accent)' }} />Reservado</span>
        <span><i style={{ background: 'var(--ax-warning)' }} />Em inspeção</span><span><i style={{ background: 'color-mix(in srgb, var(--ax-info) 55%, transparent)' }} />Entrando</span>
      </div>
      {adjusting && <AdjustPanel data={data} onClose={() => setAdjusting(false)} onDone={() => { setAdjusting(false); onChanged(); }} />}
    </Plane>
  );
}

function AdjustPanel({ data, onClose, onDone }: { data: InventoryModel; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState(data.locations.find((l) => l.active)?.id ?? '');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [quantity, setQuantity] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [reason, setReason] = useState('Saldo inicial');
  const item = data.items.find((i) => i.id === itemId);
  const n = parseDecimalBR(quantity);
  const here = data.position.find((p) => p.itemId === itemId && p.locationId === locationId);
  const valid = itemId && locationId && n !== null && n > 0 && reason.trim().length >= 3 && (item?.tracking === 'NONE' || lotCode.trim());
  return (
    <SidePanel open onClose={onClose} testId="adjust-form" eyebrow="Estoque · ajuste" title="Ajustar estoque"
      meta={<span>O ajuste vira uma linha do livro com o seu nome e o motivo. Saída não pode tirar saldo reservado.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!valid || busy !== null}
          onClick={() => run('adjust', '/api/supply/inventory/adjustments', { itemId, locationId, quantity: direction === 'in' ? n : -(n as number),
            lotCode: lotCode.trim() || null, reason: reason.trim() }, { title: 'Ajuste registrado', detail: 'Nova linha no livro.' })}>
          <Busy on={busy !== null}>Registrar ajuste</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Item</span><select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Selecione…</option>
          {data.items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description} ({i.unit})</option>)}</select></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Local</span><select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {data.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="ax-field"><span>Sentido</span><select value={direction} onChange={(e) => setDirection(e.target.value as 'in' | 'out')}>
            <option value="in">Entrada (+)</option><option value="out">Saída (−)</option></select></label>
        </div>
        <div className="ax-field-row">
          <label className="ax-field"><span>Quantidade{item ? ` (${item.unit})` : ''}</span>
            <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            {here && <small>No local: {qty(here.onHand)} em mão · {qty(here.available)} livre</small>}</label>
          {item && item.tracking !== 'NONE' && <label className="ax-field"><span>{item.tracking === 'LOT' ? 'Lote' : 'Número de série'}</span>
            <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} /></label>}
        </div>
        <label className="ax-field"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
    </SidePanel>
  );
}
