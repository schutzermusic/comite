'use client';

import { useState } from 'react';
import { FileText, ImageIcon, Paperclip } from 'lucide-react';
import { uploadWithSignedToken } from '@/lib/commercial/upload-client';
import { prepareEvidence } from '@/lib/supply/evidence-client';
import { INSPECTION_STATUS_LABEL, SHIPMENT_STATUS_LABEL, type InspectionStatus, type ShipmentStatus } from '@/lib/supply/receiving';
import type { ReceivingWorkspaceModel } from '@/lib/supply/receiving-read';
import { useHudToast } from '@/components/hud';
import {
  Busy, Chip, KV, Section, SidePanel, dateTime, notifyChanged, parseDecimalBR, qty, useGovernedAction, type Tone,
} from '@/components/ax';

export type ReceivingModel = ReceivingWorkspaceModel & { ok: true; capabilities: { receive: boolean; inspect: boolean; logistics: boolean } };
export type Inbound = ReceivingModel['inbound'][number];
export type TransferIn = ReceivingModel['inboundTransfers'][number];
export type Receipt = ReceivingModel['receipts'][number];

export const INSPECTION_TONE: Record<InspectionStatus, Tone> = {
  NOT_REQUIRED: 'neutral', PENDING: 'warning', APPROVED: 'success', PARTIALLY_REJECTED: 'danger', REJECTED: 'danger',
};

/** Autoriza o envio, sobe direto ao Storage e registra — a evidência só existe depois do registro conferido pelo servidor. */
export async function attachEvidence(receiptId: string, original: File) {
  const file = await prepareEvidence(original);
  const url = `/api/supply/receiving/receipts/${receiptId}/evidence`;
  const { path } = await uploadWithSignedToken(url, { action: 'authorize' }, file);
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'register', path, fileName: file.name, mimeType: file.type }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload?.error ?? 'A evidência não foi registrada.');
}

export async function openEvidence(receiptId: string, evidenceId: string): Promise<string | null> {
  const r = await fetch(`/api/supply/receiving/receipts/${receiptId}/evidence?evidence=${evidenceId}`);
  const p = await r.json().catch(() => ({}));
  if (!r.ok || !p.ok) return null;
  window.open(p.url, '_blank', 'noopener');
  return p.url as string;
}

/** INSPEÇÃO — decide todas as unidades recebidas em quarentena. */
export function InspectPanel({ receipt, data, onClose, onDone }: { receipt: Receipt; data: ReceivingModel; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const lines = receipt.lines.filter((l) => l.accepted > 0);
  const [approved, setApproved] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.accepted).replace('.', ',')])));
  const [rejectedSerials, setRejectedSerials] = useState<Record<string, string[]>>({});
  const [destination, setDestination] = useState(data.locations.find((l) => l.kind !== 'QUARANTINE')?.id ?? '');
  const [reason, setReason] = useState('');
  const decided = lines.map((l) => {
    if (l.tracking === 'SERIAL') {
      const rej = rejectedSerials[l.id] ?? [];
      return { l, app: l.serials.length - rej.length, rej: rej.length, approvedSerials: l.serials.filter((s) => !rej.includes(s)), rejectedSerials: rej };
    }
    const app = parseDecimalBR(approved[l.id] ?? '') ?? Number.NaN;
    return { l, app, rej: l.accepted - app };
  });
  const invalid = decided.some((d) => !Number.isFinite(d.app) || d.app < 0 || d.rej < 0);
  const anyRejected = decided.some((d) => d.rej > 0);
  const anyApproved = decided.some((d) => d.app > 0);
  const disabled = invalid || (anyRejected && reason.trim().length < 3) || (anyApproved && !destination);
  return (
    <SidePanel open onClose={onClose} testId="inspect-form" eyebrow={`Inspeção · ${receipt.orderNumber}`} title={`Inspecionar ${receipt.number}`}
      meta={<span>Aprovado vai ao destino e cobre a demanda; rejeitado volta a ser esperado do fornecedor.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={disabled || busy !== null}
          onClick={() => run(`inspect:${receipt.id}`, `/api/supply/receiving/receipts/${receipt.id}`, {
            destinationLocationId: destination || null, reason: reason.trim() || null,
            lines: decided.map((d) => (d.l.tracking === 'SERIAL'
              ? { lineId: d.l.id, approvedSerials: d.approvedSerials, rejectedSerials: d.rejectedSerials }
              : { lineId: d.l.id, approvedQuantity: d.app, rejectedQuantity: d.rej })),
          }, { title: 'Inspeção registrada', detail: anyRejected ? 'O rejeitado volta a ser esperado do fornecedor.' : 'Liberado para uso.' },
          { idempotent: false })}>
          <Busy on={busy !== null}>Registrar inspeção</Busy></button>
      </>}>
      <div className="ax-form">
        {decided.map((d) => (
          <fieldset key={d.l.id} className="ax-linecard">
            <legend><b>{d.l.itemCode}</b> {d.l.itemDescription}</legend>
            <p className="ax-subtle">Recebido em quarentena: {qty(d.l.accepted, d.l.unit)}</p>
            {d.l.tracking === 'SERIAL' ? d.l.serials.map((s) => (
              <label key={s} className="ax-check">
                <input type="checkbox" checked={(rejectedSerials[d.l.id] ?? []).includes(s)}
                  onChange={(e) => setRejectedSerials({ ...rejectedSerials, [d.l.id]: e.target.checked
                    ? [...(rejectedSerials[d.l.id] ?? []), s] : (rejectedSerials[d.l.id] ?? []).filter((x) => x !== s) })} />
                Rejeitar série {s}</label>
            )) : (
              <label className="ax-field"><span>Aprovado (o resto é rejeitado)</span>
                <input inputMode="decimal" aria-label={`Aprovado ${d.l.itemCode}`} value={approved[d.l.id] ?? ''}
                  onChange={(e) => setApproved({ ...approved, [d.l.id]: e.target.value })} /></label>
            )}
            <p className="ax-sim">Aprovado <strong>{qty(Math.max(d.app, 0), d.l.unit)}</strong> · rejeitado <strong>{qty(Math.max(d.rej, 0), d.l.unit)}</strong></p>
          </fieldset>
        ))}
        {anyApproved && (
          <label className="ax-field"><span>Liberar para</span>
            <select value={destination} onChange={(e) => setDestination(e.target.value)}>
              {data.locations.filter((l) => l.kind !== 'QUARANTINE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></label>
        )}
        {anyRejected && <label className="ax-field"><span>Motivo da rejeição</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      </div>
    </SidePanel>
  );
}

/** LOGÍSTICA — embarque do pedido: transportadora, veículo, rastreio, ETA, trânsito e chegada. */
export function ShipmentPanel({ order, onClose, onDone }: { order: Inbound; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
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
    <SidePanel open onClose={onClose} testId="shipment-form" eyebrow={`Logística · ${order.counterpart}`}
      title={live ? `Embarque ${live.number}` : `Novo embarque · ${order.number}`}
      meta={<span>A previsão do embarque passa a ser a data esperada do pedido em toda a operação.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={(status === 'CANCELLED' && reason.trim().length < 3) || busy !== null}
          onClick={() => run(`ship:${live?.id ?? order.id}`, '/api/supply/receiving/shipments', {
            ...(live ? { id: live.id } : { purchaseOrderId: order.id }), status, carrier: carrier.trim() || null, vehicle: vehicle.trim() || null,
            trackingRef: tracking.trim() || null, eta: eta || null, reason: status === 'CANCELLED' ? reason.trim() : undefined,
          }, { title: 'Logística atualizada' }, { idempotent: false })}>
          <Busy on={busy !== null}>Salvar</Busy></button>
      </>}>
      <div className="ax-form">
        <div className="ax-field-row">
          <label className="ax-field"><span>Transportadora</span><input value={carrier} onChange={(e) => setCarrier(e.target.value)} /></label>
          <label className="ax-field"><span>Veículo / placa</span><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></label>
        </div>
        <div className="ax-field-row">
          <label className="ax-field"><span>Rastreio / romaneio</span><input value={tracking} onChange={(e) => setTracking(e.target.value)} /></label>
          <label className="ax-field"><span>Previsão de chegada</span><input type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></label>
        </div>
        <label className="ax-field"><span>Situação</span><select value={status} onChange={(e) => setStatus(e.target.value as ShipmentStatus)}>
          {next.map((s) => <option key={s} value={s}>{SHIPMENT_STATUS_LABEL[s]}</option>)}</select></label>
        {status === 'CANCELLED' && <label className="ax-field"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      </div>
    </SidePanel>
  );
}

/** Receber transferência que chegou (o mesmo ato da tela de Estoque). */
export function TransferReceivePanel({ transfer, onClose, onDone }: { transfer: TransferIn; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const pending = transfer.lines.filter((l) => l.dispatched - l.received > 0);
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(pending.map((l) => [l.id, String(l.dispatched - l.received).replace('.', ',')])));
  const lines = pending.map((l) => ({ lineId: l.id, quantity: parseDecimalBR(values[l.id] ?? '') ?? 0 })).filter((l) => l.quantity > 0);
  return (
    <SidePanel open onClose={onClose} testId="receive-transfer-form" eyebrow="Transferência entre locais" title={`Receber ${transfer.number}`}
      meta={<span>{transfer.counterpart} → {transfer.destination ?? 'destino'}</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!lines.length || busy !== null}
          onClick={() => run(`transfer-receive:${transfer.id}`, `/api/supply/inventory/transfers/${transfer.id}`, { action: 'receive', lines },
            { title: 'Transferência recebida', detail: 'O saldo entrou no destino; a reserva do requisito acompanha.' })}>
          <Busy on={busy !== null}>Registrar recebimento</Busy></button>
      </>}>
      <div className="ax-form">
        {pending.map((l) => (
          <label key={l.id} className="ax-field"><span>{l.itemCode} {l.itemDescription} — pendente {qty(l.dispatched - l.received, l.unit)}</span>
            <input inputMode="decimal" value={values[l.id] ?? ''} onChange={(e) => setValues({ ...values, [l.id]: e.target.value })} /></label>
        ))}
      </div>
    </SidePanel>
  );
}

/** Um recebimento postado: fato imutável — linhas, inspeção, divergência e evidências (e anexar mais uma). */
export function ReceiptPanel({ receipt, canAttach, onClose, onInspect }: {
  receipt: Receipt; canAttach: boolean; onClose: () => void; onInspect?: () => void;
}) {
  const { error, success } = useHudToast();
  const [uploading, setUploading] = useState(false);
  const attach = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try { await attachEvidence(receipt.id, file); success('Evidência anexada', 'Conferida pelo conteúdo e ligada ao recebimento.'); notifyChanged(); }
    catch (e) { error('Evidência não anexada', (e as Error).message); }
    finally { setUploading(false); }
  };
  return (
    <SidePanel open onClose={onClose} testId="receipt-panel" eyebrow={`Recebimento · pedido ${receipt.orderNumber}`} title={receipt.number}
      meta={<><Chip tone={INSPECTION_TONE[receipt.inspectionStatus]}>{INSPECTION_STATUS_LABEL[receipt.inspectionStatus]}</Chip>
        <span>{receipt.supplier}</span><span>{dateTime(receipt.receivedAt)}</span></>}
      footer={onInspect && receipt.inspectionStatus === 'PENDING' ? <button type="button" className="ax-btn primary" onClick={onInspect}>Inspecionar</button> : undefined}>
      <Section title="O que foi postado">
        <ul className="ax-loclist">
          {receipt.lines.map((l) => (
            <li key={l.id}><span><b>{l.itemCode}</b> {l.itemDescription}{l.lotCode ? ` · lote ${l.lotCode}` : ''}
              {l.rejectionReason && <><br /><small className="ax-subtle">Rejeitado: {l.rejectionReason}</small></>}</span>
              <em>{l.rejected ? `rejeitado ${qty(l.rejected, l.unit)}` : ''}</em><strong>+{qty(l.accepted, l.unit)}</strong></li>
          ))}
        </ul>
      </Section>
      <Section title="Contexto">
        <KV items={[
          ['Local', receipt.location ?? '—'], ['Recebido por', receipt.receivedBy ?? '—'],
          ['Divergência', receipt.discrepancyReason ?? '—'], ['Observação', receipt.note ?? '—'],
          ...(receipt.inspectionNote ? [['Inspeção', receipt.inspectionNote] as [string, string]] : []),
        ]} />
      </Section>
      <Section title="Evidências" action={canAttach ? (
        <label className="ax-btn sm"><Paperclip size={13} aria-hidden /><Busy on={uploading}>Anexar</Busy>
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void attach(e.target.files?.[0] ?? null); e.target.value = ''; }} /></label>
      ) : undefined}>
        {receipt.evidence.length === 0 ? <p className="ax-muted" style={{ margin: 0 }}>Nenhuma evidência anexada.</p> : (
          <ul className="ax-evlist">
            {receipt.evidence.map((ev) => (
              <li key={ev.id}>
                <button type="button" className="ax-rowlink" onClick={async () => { if (!(await openEvidence(receipt.id, ev.id))) error('Evidência indisponível'); }}>
                  {ev.mimeType === 'application/pdf' ? <FileText size={14} aria-hidden /> : <ImageIcon size={14} aria-hidden />}{ev.fileName}
                </button>
                <small className="ax-subtle">{(ev.sizeBytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB</small>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </SidePanel>
  );
}
