'use client';

import { useState } from 'react';
import { useHudToast } from '@/components/hud';
import { uploadWithSignedToken } from '@/lib/commercial/upload-client';
import { SHIPMENT_STATUS_LABEL, type ShipmentStatus } from '@/lib/supply/receiving';
import type { ReceivingWorkspaceModel } from '@/lib/supply/receiving-read';
import { ActModal, newKey, qty, useInventoryAct } from '../inventory/shared';
import { parseDecimal } from '../procurement/shared';

export type ReceivingModel = ReceivingWorkspaceModel & { capabilities: { receive: boolean; inspect: boolean; logistics: boolean } };
type Inbound = ReceivingModel['inbound'][number];
type Transfer = ReceivingModel['inboundTransfers'][number];
type Receipt = ReceivingModel['receipts'][number];

async function attachEvidence(receiptId: string, file: File) {
  const url = `/api/supply/receiving/receipts/${receiptId}/evidence`;
  const { path } = await uploadWithSignedToken(url, { action: 'authorize' }, file);
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'register', path, fileName: file.name, mimeType: file.type }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload?.error ?? 'A evidência não foi registrada.');
}

/**
 * RECEBER PEDIDO — pensado para o celular no canteiro: por linha, quanto
 * chegou bom, quanto veio avariado (com motivo), lote ou números de série;
 * local de recebimento (quarentena = inspeção) e foto do romaneio/avaria.
 */
export function ReceivePurchaseModal({ order, data, onClose, onDone }: {
  order: Inbound; data: ReceivingModel; onClose: () => void; onDone: () => void;
}) {
  const { error: notifyError, success } = useHudToast();
  const [busy, setBusy] = useState(false);
  const openLines = order.lines.filter((l) => l.open > 0);
  const [accepted, setAccepted] = useState<Record<string, string>>(Object.fromEntries(openLines.map((l) => [l.id, String(l.open)])));
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [location, setLocation] = useState(order.destinationId ?? data.locations[0]?.id ?? '');
  const liveShips = order.shipments.filter((s) => ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'].includes(s.status));
  const [shipment, setShipment] = useState(liveShips[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [key] = useState(newKey);

  const lines = openLines.map((l) => {
    const a = accepted[l.id] ? parseDecimal(accepted[l.id]) : 0;
    const r = rejected[l.id] ? parseDecimal(rejected[l.id]) : 0;
    const serialList = (serials[l.id] ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    return { l, a: Number.isFinite(a) ? a : Number.NaN, r: Number.isFinite(r) ? r : Number.NaN, serialList };
  }).filter((x) => x.a > 0 || x.r > 0 || Number.isNaN(x.a) || Number.isNaN(x.r));
  const problems = lines.flatMap(({ l, a, r, serialList }) => {
    const out: string[] = [];
    if (Number.isNaN(a) || Number.isNaN(r)) out.push(`${l.itemCode}: quantidade inválida`);
    if (a > l.open) out.push(`${l.itemCode}: recebido acima do aberto (${qty(l.open)})`);
    if (r > 0 && (reasons[l.id] ?? '').trim().length < 3) out.push(`${l.itemCode}: diga o motivo da rejeição`);
    if (a > 0 && l.tracking === 'LOT' && !(lots[l.id] ?? '').trim()) out.push(`${l.itemCode}: informe o lote`);
    if (a > 0 && l.tracking === 'SERIAL' && serialList.length !== a) out.push(`${l.itemCode}: ${serialList.length} série(s) para ${qty(a)} unidade(s)`);
    return out;
  });
  const quarantine = data.locations.find((x) => x.id === location)?.kind === 'QUARANTINE';

  const submit = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/supply/receiving/receipts', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ purchaseOrderId: order.id, locationId: location || null, shipmentId: shipment || null,
          note: note.trim() || null, idempotencyKey: key,
          lines: lines.map(({ l, a, r, serialList }) => ({ poLineId: l.id, acceptedQuantity: a, rejectedQuantity: r,
            rejectionReason: r > 0 ? reasons[l.id]?.trim() : null, lotCode: lots[l.id]?.trim() || null,
            serials: l.tracking === 'SERIAL' ? serialList : undefined })) }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) { notifyError('Recebimento recusado', payload?.error); return; }
      if (file) {
        try { await attachEvidence(String(payload.result.receipt_id), file); } catch (e) { notifyError('Evidência não anexada', (e as Error).message); }
      }
      success('Recebimento registrado', `${payload.result.receipt_number} · ${payload.result.inspection_status === 'PENDING' ? 'em inspeção' : 'no estoque'}`);
      onDone();
    } finally { setBusy(false); }
  };

  return (
    <ActModal title={`Receber ${order.number}`} subtitle={`${order.counterpart}${order.project ? ` · ${order.project}` : ''}`} onClose={onClose}
      busy={busy} disabled={!lines.length || problems.length > 0} confirmLabel="Registrar recebimento" onConfirm={submit} testId="receive-form">
      {openLines.map((l) => (
        <fieldset key={l.id} className="ops-form" style={{ border: '1px solid var(--ops-line)', borderRadius: 12, padding: 10 }}>
          <legend><b>{l.itemCode}</b> {l.itemDescription} · em aberto {qty(l.open)} {l.unit}</legend>
          <div className="ops-form-row">
            <label>Chegou bom<input inputMode="decimal" aria-label={`Recebido ${l.itemCode}`} value={accepted[l.id] ?? ''}
              onChange={(e) => setAccepted({ ...accepted, [l.id]: e.target.value })} /></label>
            <label>Rejeitado/avariado<input inputMode="decimal" aria-label={`Rejeitado ${l.itemCode}`} value={rejected[l.id] ?? ''}
              onChange={(e) => setRejected({ ...rejected, [l.id]: e.target.value })} /></label>
          </div>
          {rejected[l.id] && parseDecimal(rejected[l.id]) > 0 && (
            <label>Motivo da rejeição<input aria-label={`Motivo ${l.itemCode}`} value={reasons[l.id] ?? ''}
              onChange={(e) => setReasons({ ...reasons, [l.id]: e.target.value })} /></label>)}
          {l.tracking === 'LOT' && <label>Lote<input value={lots[l.id] ?? ''} onChange={(e) => setLots({ ...lots, [l.id]: e.target.value })} /></label>}
          {l.tracking === 'SERIAL' && <label>Números de série (um por linha)<textarea value={serials[l.id] ?? ''}
            onChange={(e) => setSerials({ ...serials, [l.id]: e.target.value })} /></label>}
        </fieldset>
      ))}
      <div className="ops-form-row">
        <label>Local de recebimento<select value={location} onChange={(e) => setLocation(e.target.value)}>
          {data.locations.map((x) => <option key={x.id} value={x.id}>{x.name}{x.kind === 'QUARANTINE' ? ' (inspeção)' : ''}</option>)}</select></label>
        {liveShips.length > 0 && <label>Embarque<select value={shipment} onChange={(e) => setShipment(e.target.value)}>
          <option value="">—</option>{liveShips.map((s) => <option key={s.id} value={s.id}>{s.number} · {SHIPMENT_STATUS_LABEL[s.status]}</option>)}</select></label>}
      </div>
      {quarantine && <p className="crm-muted">Recebido em quarentena fica “em inspeção”: não é reservado nem disponível até a decisão.</p>}
      <label>Observação<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <label>Foto ou documento (romaneio, nota, avaria)
        <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      {problems.length > 0 && <ul className="ops-form-error">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </ActModal>
  );
}

/** Receber transferência que chegou (mesmo ato da tela de Estoque). */
export function ReceiveTransferModal({ transfer, onClose, onDone }: { transfer: Transfer; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const pending = transfer.lines.filter((l) => l.dispatched - l.received > 0);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(pending.map((l) => [l.id, String(l.dispatched - l.received)])));
  const lines = pending.map((l) => ({ lineId: l.id, quantity: parseDecimal(values[l.id] ?? '') }))
    .filter((l) => l.quantity > 0);
  return (
    <ActModal title={`Receber ${transfer.number}`} subtitle={`${transfer.counterpart} → ${transfer.destination ?? ''}`} onClose={onClose} busy={busy}
      disabled={!lines.length} confirmLabel="Registrar recebimento" testId="receive-transfer-form"
      onConfirm={() => act(`/api/supply/inventory/transfers/${transfer.id}`, { action: 'receive', lines, idempotencyKey: newKey() },
        'Transferência recebida')}>
      {pending.map((l) => (
        <label key={l.id}>{l.itemCode} {l.itemDescription} — pendente {qty(l.dispatched - l.received)} {l.unit}
          <input inputMode="decimal" value={values[l.id] ?? ''} onChange={(e) => setValues({ ...values, [l.id]: e.target.value })} /></label>
      ))}
    </ActModal>
  );
}

/** INSPEÇÃO — decide todas as unidades recebidas em quarentena. */
export function InspectModal({ receipt, data, onClose, onDone }: { receipt: Receipt; data: ReceivingModel; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const lines = receipt.lines.filter((l) => l.accepted > 0);
  const [approved, setApproved] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.accepted)])));
  const [rejectedSerials, setRejectedSerials] = useState<Record<string, string[]>>({});
  const [destination, setDestination] = useState(data.locations.find((l) => l.kind !== 'QUARANTINE')?.id ?? '');
  const [reason, setReason] = useState('');
  const decided = lines.map((l) => {
    if (l.tracking === 'SERIAL') {
      const rej = rejectedSerials[l.id] ?? [];
      return { l, app: l.serials.length - rej.length, rej: rej.length, approvedSerials: l.serials.filter((s) => !rej.includes(s)), rejectedSerials: rej };
    }
    const app = parseDecimal(approved[l.id] ?? '');
    return { l, app, rej: l.accepted - app };
  });
  const invalid = decided.some((d) => !Number.isFinite(d.app) || d.app < 0 || d.rej < 0);
  const anyRejected = decided.some((d) => d.rej > 0);
  const anyApproved = decided.some((d) => d.app > 0);
  return (
    <ActModal title={`Inspeção ${receipt.number}`} subtitle="Decida todas as unidades: aprovado vai ao destino e cobre a demanda; rejeitado volta a ser esperado do fornecedor."
      onClose={onClose} busy={busy} disabled={invalid || (anyRejected && reason.trim().length < 3) || (anyApproved && !destination)}
      confirmLabel="Registrar inspeção" testId="inspect-form"
      onConfirm={() => act(`/api/supply/receiving/receipts/${receipt.id}`, { destinationLocationId: destination || null, reason: reason.trim() || null,
        lines: decided.map((d) => (d.l.tracking === 'SERIAL'
          ? { lineId: d.l.id, approvedSerials: d.approvedSerials, rejectedSerials: d.rejectedSerials }
          : { lineId: d.l.id, approvedQuantity: d.app, rejectedQuantity: d.rej })) }, 'Inspeção registrada')}>
      {decided.map((d) => (
        <fieldset key={d.l.id} className="ops-form" style={{ border: '1px solid var(--ops-line)', borderRadius: 12, padding: 10 }}>
          <legend><b>{d.l.itemCode}</b> {d.l.itemDescription} · recebido {qty(d.l.accepted)} {d.l.unit}</legend>
          {d.l.tracking === 'SERIAL' ? d.l.serials.map((s) => (
            <label key={s} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={(rejectedSerials[d.l.id] ?? []).includes(s)}
                onChange={(e) => setRejectedSerials({ ...rejectedSerials, [d.l.id]: e.target.checked
                  ? [...(rejectedSerials[d.l.id] ?? []), s] : (rejectedSerials[d.l.id] ?? []).filter((x) => x !== s) })} />
              Rejeitar série {s}</label>
          )) : (
            <label>Aprovado (o resto é rejeitado)<input inputMode="decimal" aria-label={`Aprovado ${d.l.itemCode}`} value={approved[d.l.id] ?? ''}
              onChange={(e) => setApproved({ ...approved, [d.l.id]: e.target.value })} /></label>
          )}
          <p className="crm-muted">Aprovado {qty(Math.max(d.app, 0))} · rejeitado {qty(Math.max(d.rej, 0))}</p>
        </fieldset>
      ))}
      {anyApproved && <label>Liberar para<select value={destination} onChange={(e) => setDestination(e.target.value)}>
        {data.locations.filter((l) => l.kind !== 'QUARANTINE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
      {anyRejected && <label>Motivo da rejeição<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
    </ActModal>
  );
}

/** LOGÍSTICA — embarque do pedido: transportadora, veículo, rastreio, ETA, trânsito e chegada. */
export function ShipmentModal({ order, onClose, onDone }: { order: Inbound; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const live = order.shipments.find((s) => ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'].includes(s.status)) ?? null;
  const [carrier, setCarrier] = useState(live?.carrier ?? '');
  const [vehicle, setVehicle] = useState(live?.vehicle ?? '');
  const [tracking, setTracking] = useState(live?.trackingRef ?? '');
  const [eta, setEta] = useState(live?.eta ?? order.expectedDate ?? '');
  const [status, setStatus] = useState<ShipmentStatus>(live?.status ?? 'EXPECTED');
  const [reason, setReason] = useState('');
  const next: ShipmentStatus[] = !live ? ['EXPECTED', 'IN_TRANSIT', 'ARRIVED']
    : live.status === 'EXPECTED' ? ['EXPECTED', 'IN_TRANSIT', 'ARRIVED', 'CANCELLED']
      : live.status === 'IN_TRANSIT' ? ['IN_TRANSIT', 'ARRIVED', 'CANCELLED'] : ['ARRIVED', 'CANCELLED'];
  return (
    <ActModal title={live ? `Embarque ${live.number}` : `Novo embarque · ${order.number}`} onClose={onClose} busy={busy}
      disabled={status === 'CANCELLED' && reason.trim().length < 3} confirmLabel="Salvar" testId="shipment-form"
      onConfirm={() => act('/api/supply/receiving/shipments', { ...(live ? { id: live.id } : { purchaseOrderId: order.id }),
        status, carrier: carrier.trim() || null, vehicle: vehicle.trim() || null, trackingRef: tracking.trim() || null,
        eta: eta || null, reason: status === 'CANCELLED' ? reason.trim() : undefined }, 'Logística atualizada')}>
      <div className="ops-form-row">
        <label>Transportadora<input value={carrier} onChange={(e) => setCarrier(e.target.value)} /></label>
        <label>Veículo / placa<input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></label>
      </div>
      <div className="ops-form-row">
        <label>Rastreio / romaneio<input value={tracking} onChange={(e) => setTracking(e.target.value)} /></label>
        <label>Previsão de chegada<input type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></label>
      </div>
      <label>Situação<select value={status} onChange={(e) => setStatus(e.target.value as ShipmentStatus)}>
        {next.map((s) => <option key={s} value={s}>{SHIPMENT_STATUS_LABEL[s]}</option>)}</select></label>
      {status === 'CANCELLED' && <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
    </ActModal>
  );
}
