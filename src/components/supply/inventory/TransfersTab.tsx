'use client';

import { useMemo, useState } from 'react';
import { HudButton, HudDrawer } from '@/components/hud';
import {
  TRANSFER_ACTION_LABEL, TRANSFER_STATUS_LABEL, TRANSFER_STATUS_TONE, transferActions, type TransferAction,
} from '@/lib/supply/inventory';
import { DataTable, EmptyNote, Segments, StatePill, day } from '@/components/operations/ui';
import { ActModal, newKey, qty, useInventoryAct, type InventoryModel } from './shared';

type Transfer = InventoryModel['transfers'][number];
type Item = { id: string; code: string; description: string; unit: string; tracking: string };
const OPEN = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED'];

/** TRANSFERÊNCIAS — solicitada → aprovada → em trânsito → recebida (parcial) → encerrada. */
export function TransfersTab({ data, items, onChanged }: { data: InventoryModel; items: Item[]; onChanged: () => void }) {
  const [filter, setFilter] = useState<'open' | 'done'>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = useMemo(() => data.transfers.filter((t) => (filter === 'open' ? OPEN.includes(t.status) : !OPEN.includes(t.status))),
    [data, filter]);
  const open = data.transfers.find((t) => t.id === openId) ?? null;
  const caps = data.capabilities;
  return (
    <>
      <div className="crm-toolbar">
        <Segments label="Situação da transferência" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[
          { value: 'open', label: 'Em andamento', count: data.transfers.filter((t) => OPEN.includes(t.status)).length },
          { value: 'done', label: 'Encerradas e canceladas', count: data.transfers.filter((t) => !OPEN.includes(t.status)).length },
        ]} />
        {(caps.manage || caps.reserve) && <HudButton size="sm" variant="primary" onClick={() => setCreating(true)}>Nova transferência</HudButton>}
      </div>
      <DataTable label="Transferências" columns={['Número', 'Origem → destino', 'Projeto', 'Linhas', 'Chegada prevista', 'Situação', '']}
        count={rows.length} footer="Despacho posta a saída; recebimento posta a entrada e reserva no destino para o requisito"
        empty={<EmptyNote title="Nenhuma transferência" description="Peça uma transferência aqui ou a partir da falta de um material." />}>
        {rows.map((t) => (
          <tr key={t.id} data-testid="transfer-row">
            <td className="tabular-nums"><b>{t.number}</b><p className="crm-muted">{t.requestedBy ?? ''}</p></td>
            <td>{t.fromLocation} → {t.toLocation}</td>
            <td>{t.project ?? '—'}</td>
            <td>{t.lines.map((l) => `${l.itemCode} ${qty(l.quantity)}`).join(' · ')}</td>
            <td className={t.expectedArrival && t.expectedArrival < data.today && ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(t.status) ? 'crm-tone-danger' : undefined}>
              {day(t.expectedArrival)}</td>
            <td><StatePill tone={TRANSFER_STATUS_TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</StatePill></td>
            <td><HudButton size="sm" variant="ghost" onClick={() => setOpenId(t.id)}>Abrir</HudButton></td>
          </tr>
        ))}
      </DataTable>
      <HudDrawer isOpen={Boolean(open)} onClose={() => setOpenId(null)} title={open ? `Transferência ${open.number}` : 'Transferência'}
        subtitle={open ? `${open.fromLocation} → ${open.toLocation}` : undefined} width="min(600px, 100vw)">
        {open && <TransferDetail t={open} caps={caps} onChanged={onChanged} />}
      </HudDrawer>
      {creating && <NewTransferModal data={data} items={items} onClose={() => setCreating(false)} onDone={() => { setCreating(false); onChanged(); }} />}
    </>
  );
}

function TransferDetail({ t, caps, onChanged }: { t: Transfer; caps: InventoryModel['capabilities']; onChanged: () => void }) {
  const [mode, setMode] = useState<TransferAction | null>(null);
  const { act, busy } = useInventoryAct(() => { setMode(null); onChanged(); });
  const actions = transferActions(t.status, caps);
  return (
    <div className="crm-workspace ops-workspace" data-testid="transfer-drawer">
      <dl className="sup-kv">
        <div><dt>Situação</dt><dd>{TRANSFER_STATUS_LABEL[t.status]}</dd></div>
        <div><dt>Projeto</dt><dd>{t.project ?? '—'}</dd></div>
        <div><dt>Chegada prevista</dt><dd>{day(t.expectedArrival)}</dd></div>
        <div><dt>Transporte</dt><dd>{[t.carrier, t.trackingRef].filter(Boolean).join(' · ') || '—'}</dd></div>
      </dl>
      <DataTable label="Linhas da transferência" columns={['Item', 'Pedido', 'Despachado', 'Recebido', 'Requisito']} count={t.lines.length} footer=" " empty={null}>
        {t.lines.map((l) => (
          <tr key={l.id}>
            <td><b>{l.itemCode}</b> {l.itemDescription}{l.lotCode && <p className="crm-muted">Lote/série {l.lotCode}</p>}</td>
            <td className="tabular-nums">{qty(l.quantity)} {l.unit}</td>
            <td className="tabular-nums">{qty(l.dispatched)}</td>
            <td className="tabular-nums">{qty(l.received)}</td>
            <td>{l.requirementTitle ?? '—'}{l.fromReservation && <p className="crm-muted">da reserva na origem</p>}</td>
          </tr>
        ))}
      </DataTable>
      {t.closeReason && <p className="crm-muted" style={{ padding: '0 14px' }}>Motivo: {t.closeReason}</p>}
      {actions.length > 0 && (
        <div className="ops-row-actions" style={{ padding: '12px 14px' }}>
          {actions.map((a) => (
            <HudButton key={a} size="sm" variant={a === 'cancel' || a === 'close' ? 'ghost' : 'primary'} disabled={busy}
              onClick={() => (a === 'approve' ? act(`/api/supply/inventory/transfers/${t.id}`, { action: 'approve' }, 'Transferência aprovada') : setMode(a))}>
              {TRANSFER_ACTION_LABEL[a]}</HudButton>
          ))}
        </div>
      )}
      {mode && mode !== 'approve' && <TransferActModal t={t} mode={mode} busy={busy} onClose={() => setMode(null)}
        onConfirm={(body) => act(`/api/supply/inventory/transfers/${t.id}`, { action: mode, ...body }, TRANSFER_ACTION_LABEL[mode])} />}
    </div>
  );
}

function TransferActModal({ t, mode, busy, onClose, onConfirm }: {
  t: Transfer; mode: Exclude<TransferAction, 'approve'>; busy: boolean; onClose: () => void; onConfirm: (body: Record<string, unknown>) => void;
}) {
  const [reason, setReason] = useState('');
  const [carrier, setCarrier] = useState(t.carrier ?? '');
  const [trackingRef, setTrackingRef] = useState(t.trackingRef ?? '');
  const pending = t.lines.map((l) => ({ id: l.id, label: `${l.itemCode} ${l.itemDescription}`, max: l.dispatched - l.received }));
  const [received, setReceived] = useState<Record<string, string>>(Object.fromEntries(pending.map((p) => [p.id, String(p.max)])));
  const missing = t.lines.reduce((a, l) => a + l.dispatched - l.received, 0);
  const receiveLines = pending.map((p) => ({ lineId: p.id, quantity: Number((received[p.id] ?? '0').replace(',', '.')) }))
    .filter((l) => l.quantity > 0);
  const valid = mode === 'receive' ? receiveLines.length > 0 && receiveLines.every((l) => l.quantity <= (pending.find((p) => p.id === l.lineId)?.max ?? 0))
    : mode === 'cancel' ? reason.trim().length >= 3
      : mode === 'close' ? missing === 0 || reason.trim().length >= 3 : true;
  const body = mode === 'receive' ? { lines: receiveLines, idempotencyKey: newKey() }
    : mode === 'dispatch' ? { carrier: carrier.trim() || undefined, trackingRef: trackingRef.trim() || undefined }
      : { reason: reason.trim() || undefined };
  return (
    <ActModal title={TRANSFER_ACTION_LABEL[mode]} subtitle={t.number} onClose={onClose} busy={busy} disabled={!valid}
      confirmLabel={TRANSFER_ACTION_LABEL[mode]} onConfirm={() => onConfirm(body)} testId="transfer-act-form">
      {mode === 'dispatch' && <>
        <p className="crm-muted">Despachar posta a saída na origem. Saldo reservado para outra obra não sai.</p>
        <div className="ops-form-row">
          <label>Transportador<input value={carrier} onChange={(e) => setCarrier(e.target.value)} /></label>
          <label>Rastreio / romaneio<input value={trackingRef} onChange={(e) => setTrackingRef(e.target.value)} /></label>
        </div>
      </>}
      {mode === 'receive' && pending.filter((p) => p.max > 0).map((p) => (
        <label key={p.id}>{p.label} — pendente {qty(p.max)}
          <input inputMode="decimal" value={received[p.id] ?? ''} onChange={(e) => setReceived({ ...received, [p.id]: e.target.value })} /></label>
      ))}
      {(mode === 'cancel' || (mode === 'close' && missing > 0)) && <>
        {mode === 'close' && <p className="crm-muted">{qty(missing)} despachado(s) não chegaram. Encerrar registra a perda — diga o motivo.</p>}
        <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </>}
      {mode === 'close' && missing === 0 && <p className="crm-muted">Tudo recebido. Encerrar arquiva a transferência.</p>}
    </ActModal>
  );
}

function NewTransferModal({ data, items, onClose, onDone }: { data: InventoryModel; items: Item[]; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const active = data.locations.filter((l) => l.active);
  const [from, setFrom] = useState(active[0]?.id ?? '');
  const [to, setTo] = useState(active[1]?.id ?? '');
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<Array<{ itemId: string; quantity: string; lotCode: string }>>([{ itemId: '', quantity: '', lotCode: '' }]);
  const availableAt = (itemId: string) => data.position.find((p) => p.itemId === itemId && p.locationId === from)?.available ?? 0;
  const parsed = lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity.replace(',', '.')), lotCode: l.lotCode.trim() || null }))
    .filter((l) => l.itemId && l.quantity > 0);
  const valid = from && to && from !== to && parsed.length > 0;
  return (
    <ActModal title="Nova transferência" subtitle="Transferência livre (sem requisito). Para cobrir uma falta, peça a partir da demanda — o destino já reserva."
      onClose={onClose} busy={busy} disabled={!valid} confirmLabel="Solicitar" testId="transfer-form"
      onConfirm={() => act('/api/supply/inventory/transfers', { fromLocationId: from, toLocationId: to,
        expectedArrival: expected || null, lines: parsed, idempotencyKey: newKey() }, 'Transferência solicitada')}>
      <div className="ops-form-row">
        <label>Origem<select value={from} onChange={(e) => setFrom(e.target.value)}>{active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Destino<select value={to} onChange={(e) => setTo(e.target.value)}>{active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Chegada prevista<input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
      </div>
      {lines.map((l, i) => {
        const item = items.find((x) => x.id === l.itemId);
        return (
          <div className="ops-form-row" key={i}>
            <label>Item<select value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
              <option value="">Selecione…</option>{items.map((it) => <option key={it.id} value={it.id}>{it.code} — {it.description}</option>)}</select></label>
            <label>Quantidade{l.itemId ? ` (livre na origem: ${qty(availableAt(l.itemId))})` : ''}
              <input inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></label>
            {item && item.tracking !== 'NONE' && <label>Lote/série
              <input value={l.lotCode} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, lotCode: e.target.value } : x)))} /></label>}
          </div>
        );
      })}
      <HudButton size="sm" variant="ghost" onClick={() => setLines([...lines, { itemId: '', quantity: '', lotCode: '' }])}>Adicionar linha</HudButton>
    </ActModal>
  );
}
