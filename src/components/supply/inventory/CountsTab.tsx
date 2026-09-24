'use client';

import { useState } from 'react';
import { HudButton, HudDrawer } from '@/components/hud';
import { DataTable, EmptyNote, StatePill, day } from '@/components/operations/ui';
import { ActModal, qty, useInventoryAct, type InventoryModel } from './shared';

type Count = InventoryModel['counts'][number];
const STATUS: Record<string, string> = { OPEN: 'Aberta', POSTED: 'Postada', CANCELLED: 'Cancelada' };

/**
 * INVENTÁRIO — contagem fotografa o esperado; postar aplica a diferença.
 * Se o item se moveu no local depois da foto, a linha vence e é recontada.
 */
export function CountsTab({ data, onChanged }: { data: InventoryModel; onChanged: () => void }) {
  const [opening, setOpening] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.counts.find((c) => c.id === openId) ?? null;
  return (
    <>
      <div className="crm-toolbar">
        <p className="crm-muted">Uma contagem aberta por local.</p>
        {data.capabilities.manage && <HudButton size="sm" variant="primary" onClick={() => setOpening(true)}>Abrir contagem</HudButton>}
      </div>
      <DataTable label="Contagens" columns={['Local', 'Aberta em', 'Linhas', 'Contadas', 'Situação', '']} count={data.counts.length}
        footer="Correção de contagem vira linha do livro, com motivo"
        empty={<EmptyNote title="Nenhuma contagem" description="Abra uma contagem para conferir o físico de um local." />}>
        {data.counts.map((c) => (
          <tr key={c.id} data-testid="count-row">
            <td>{c.locationName}</td>
            <td>{day(c.openedAt.slice(0, 10))}</td>
            <td className="tabular-nums">{c.lines.length}</td>
            <td className="tabular-nums">{c.lines.filter((l) => l.counted !== null).length}</td>
            <td><StatePill tone={c.status === 'OPEN' ? 'warning' : c.status === 'POSTED' ? 'success' : 'neutral'}>{STATUS[c.status] ?? c.status}</StatePill></td>
            <td><HudButton size="sm" variant="ghost" onClick={() => setOpenId(c.id)}>Abrir</HudButton></td>
          </tr>
        ))}
      </DataTable>
      <HudDrawer isOpen={Boolean(open)} onClose={() => setOpenId(null)} title={open ? `Contagem · ${open.locationName}` : 'Contagem'}
        width="min(600px, 100vw)">
        {open && <CountDetail c={open} canManage={data.capabilities.manage} onChanged={onChanged} />}
      </HudDrawer>
      {opening && <OpenCountModal data={data} onClose={() => setOpening(false)} onDone={() => { setOpening(false); onChanged(); }} />}
    </>
  );
}

function CountDetail({ c, canManage, onChanged }: { c: Count; canManage: boolean; onChanged: () => void }) {
  const { act, busy } = useInventoryAct(onChanged);
  const [counted, setCounted] = useState<Record<string, string>>(
    Object.fromEntries(c.lines.map((l) => [l.id, l.counted === null ? '' : String(l.counted)])));
  const [reason, setReason] = useState('');
  const editable = c.status === 'OPEN' && canManage;
  const typed = c.lines.map((l) => ({ lineId: l.id, value: (counted[l.id] ?? '').trim() })).filter((l) => l.value !== '');
  return (
    <div className="crm-workspace ops-workspace" data-testid="count-drawer">
      <DataTable label="Linhas da contagem" columns={['Item', 'Esperado', 'Contado', 'Diferença']} count={c.lines.length} footer=" " empty={<EmptyNote title="Local sem saldo" description="Nada esperado pelo livro neste local." />}>
        {c.lines.map((l) => {
          const v = counted[l.id] ?? '';
          const n = v === '' ? null : Number(v.replace(',', '.'));
          return (
            <tr key={l.id}>
              <td><b>{l.itemCode}</b> {l.itemDescription}{l.lotCode && <p className="crm-muted">Lote/série {l.lotCode}</p>}</td>
              <td className="tabular-nums">{qty(l.expected)} {l.unit}</td>
              <td>{editable ? <input aria-label={`Contado ${l.itemCode}`} inputMode="decimal" value={v} style={{ width: 96 }}
                onChange={(e) => setCounted({ ...counted, [l.id]: e.target.value })} /> : (l.counted === null ? '—' : qty(l.counted))}</td>
              <td className={`tabular-nums ${n !== null && n !== l.expected ? 'crm-tone-warning' : ''}`}>{n === null ? '—' : qty(n - l.expected)}</td>
            </tr>
          );
        })}
      </DataTable>
      {editable && (
        <div className="ops-form" style={{ padding: '12px 14px' }}>
          <HudButton size="sm" variant="secondary" disabled={busy || !typed.length}
            onClick={() => act(`/api/supply/inventory/counts/${c.id}`, { action: 'record',
              lines: typed.map((l) => ({ lineId: l.lineId, countedQuantity: Number(l.value.replace(',', '.')) })) }, 'Contagem salva')}>
            Salvar contado</HudButton>
          <label>Motivo da correção<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Inventário rotativo" /></label>
          <div className="ops-row-actions">
            <HudButton size="sm" variant="primary" disabled={busy}
              onClick={() => act(`/api/supply/inventory/counts/${c.id}`, { action: 'post', reason: reason.trim() || undefined }, 'Contagem postada')}>
              Postar diferenças</HudButton>
            <HudButton size="sm" variant="ghost" disabled={busy || reason.trim().length < 3}
              onClick={() => act(`/api/supply/inventory/counts/${c.id}`, { action: 'cancel', reason: reason.trim() }, 'Contagem cancelada')}>
              Cancelar contagem</HudButton>
          </div>
          <p className="crm-muted">Salve o contado antes de postar. Linhas sem contado não geram correção.</p>
        </div>
      )}
    </div>
  );
}

function OpenCountModal({ data, onClose, onDone }: { data: InventoryModel; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const free = data.locations.filter((l) => l.active && !data.counts.some((c) => c.status === 'OPEN' && c.locationId === l.id));
  const [locationId, setLocationId] = useState(free[0]?.id ?? '');
  return (
    <ActModal title="Abrir contagem" subtitle="A foto do esperado é tirada agora, pelo livro." onClose={onClose} busy={busy}
      disabled={!locationId} confirmLabel="Abrir" onConfirm={() => act('/api/supply/inventory/counts', { locationId }, 'Contagem aberta')}>
      <label>Local<select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
        {free.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    </ActModal>
  );
}
