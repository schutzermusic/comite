'use client';

import { useMemo, useState } from 'react';
import { Camera, CheckCircle2, ChevronRight, Minus, Plus, ShieldAlert } from 'lucide-react';
import { INBOUND_QUEUE_LABEL, SHIPMENT_STATUS_LABEL, type InboundQueue } from '@/lib/supply/receiving';
import { prepareEvidence } from '@/lib/supply/evidence-client';
import { Busy, Chip, SearchBox, SidePanel, dateShort, parseDecimalBR, qty, useGovernedAction, type Tone } from '@/components/ax';
import { attachEvidence, type Inbound, type ReceivingModel } from './ReceivingPanels';

const QUEUE_TONE: Record<InboundQueue, Tone> = {
  today: 'accent', upcoming: 'neutral', in_transit: 'info', late: 'danger', partial: 'warning', discrepancy: 'danger', done: 'success',
};
const ORDER: InboundQueue[] = ['late', 'today', 'in_transit', 'partial', 'discrepancy', 'upcoming', 'done'];
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const fmt = (n: number) => String(Number(n.toFixed(4))).replace('.', ',');

/**
 * RECEBER NO CANTEIRO — o fluxo mais curto possível no celular:
 *   1. qual pedido chegou (busca por número, fornecedor ou material);
 *   2. uma tela: quanto chegou bom (já vem com o que falta), avaria com
 *      motivo, para onde vai (ou quarentena para inspeção), foto;
 *   3. registrado — com o número do recebimento e o destino do material.
 * O ato é o recebimento governado: o banco recusa acima do aberto, rejeição
 * sem motivo e lote/série faltando. A mesma chave de idempotência acompanha
 * a intenção: repetir depois de uma queda de sinal não duplica o recebimento.
 */
export function ReceiveFlow({ data, orderId, onClose, onDone }: {
  data: ReceivingModel; orderId: string | null; onClose: () => void; onDone: () => void;
}) {
  const receivable = useMemo(() => data.inbound.filter((e) => e.open > 0 && ['ISSUED', 'PARTIALLY_RECEIVED'].includes(e.status))
    .sort((a, b) => ORDER.indexOf(a.queue) - ORDER.indexOf(b.queue) || (a.expectedDate ?? '9999').localeCompare(b.expectedDate ?? '9999')), [data]);
  const [order, setOrder] = useState<Inbound | null>(() => (orderId ? receivable.find((e) => e.id === orderId) ?? null : null));
  const [done, setDone] = useState<{ number: string; status: string; evidence: 'none' | 'ok' | string } | null>(null);

  if (done) {
    return (
      <SidePanel open onClose={onClose} testId="receive-done" eyebrow="Recebimento registrado" title={done.number}>
        <div className="ax-done">
          <CheckCircle2 size={40} aria-hidden />
          <p><strong>{done.status === 'PENDING' ? 'Em inspeção' : 'No estoque'}</strong> — {done.status === 'PENDING'
            ? 'o material ficou na quarentena: conta como entrando, mas só é reservável depois da inspeção.'
            : 'o material entrou no local e já cobre a demanda do pedido.'}</p>
          {done.evidence === 'ok' && <p className="ax-muted">Evidência anexada e conferida pelo conteúdo.</p>}
          {done.evidence !== 'ok' && done.evidence !== 'none' && (
            <p className="ax-error-text" role="alert">A evidência não foi anexada ({done.evidence}). Abra o recebimento e anexe de novo — o recebimento em si está registrado.</p>
          )}
          <div className="ax-inline" style={{ justifyContent: 'center' }}>
            <button type="button" className="ax-btn" onClick={() => { setDone(null); setOrder(null); }}>Receber outro</button>
            <button type="button" className="ax-btn primary" onClick={onClose}>Concluir</button>
          </div>
        </div>
      </SidePanel>
    );
  }
  if (!order) return <PickOrder receivable={receivable} onPick={setOrder} onClose={onClose} />;
  return <CountLines order={order} data={data} onBack={orderId ? onClose : () => setOrder(null)} onClose={onClose}
    onPosted={(r) => { setDone(r); onDone(); }} />;
}

function PickOrder({ receivable, onPick, onClose }: { receivable: Inbound[]; onPick: (e: Inbound) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const rows = receivable.filter((e) => !search || norm([e.number, e.counterpart, e.project, e.destination,
    ...e.lines.map((l) => `${l.itemCode} ${l.itemDescription}`)].filter(Boolean).join(' ')).includes(norm(search)));
  return (
    <SidePanel open onClose={onClose} testId="receive-pick" eyebrow="Receber material · 1 de 2" title="Qual pedido chegou?"
      meta={<span>Pedidos emitidos com saldo a receber — atrasados e de hoje primeiro.</span>}>
      <SearchBox value={search} onChange={setSearch} placeholder="Número, fornecedor ou material" label="Buscar pedido" />
      {rows.length === 0 ? <p className="ax-muted" style={{ marginTop: 14 }}>Nenhum pedido emitido com saldo{search ? ' para esta busca' : ''}.</p> : (
        <ul className="ax-picklist">
          {rows.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => onPick(e)} data-testid="receive-pick-order">
                <span className="ax-picklist-main">
                  <strong>{e.number}</strong>
                  <span>{e.counterpart}{e.project ? ` · ${e.project}` : ''}</span>
                  <small>{e.lines.filter((l) => l.open > 0).map((l) => `${l.itemCode} ${qty(l.open, l.unit)}`).join(' · ')}</small>
                </span>
                <span className="ax-picklist-side">
                  <Chip tone={QUEUE_TONE[e.queue]}>{INBOUND_QUEUE_LABEL[e.queue]}</Chip>
                  <small>{e.expectedDate ? dateShort(e.expectedDate) : 'sem data'}</small>
                </span>
                <ChevronRight size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}

function CountLines({ order, data, onBack, onClose, onPosted }: {
  order: Inbound; data: ReceivingModel; onBack: () => void; onClose: () => void;
  onPosted: (r: { number: string; status: string; evidence: 'none' | 'ok' | string }) => void;
}) {
  const { run, busy } = useGovernedAction();
  const openLines = order.lines.filter((l) => l.open > 0);
  const quarantineLoc = data.locations.find((x) => x.kind === 'QUARANTINE') ?? null;
  const defaultLoc = order.destinationId ?? data.locations.find((x) => x.kind !== 'QUARANTINE')?.id ?? '';
  const [accepted, setAccepted] = useState<Record<string, string>>(Object.fromEntries(openLines.map((l) => [l.id, fmt(l.open)])));
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [location, setLocation] = useState(defaultLoc);
  const liveShips = order.shipments.filter((s) => ['EXPECTED', 'IN_TRANSIT', 'ARRIVED'].includes(s.status));
  const [shipment, setShipment] = useState(liveShips[0]?.id ?? '');
  const [discrepancy, setDiscrepancy] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ file: File; label: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const inQuarantine = data.locations.find((x) => x.id === location)?.kind === 'QUARANTINE';

  const lines = openLines.map((l) => {
    const a = parseDecimalBR(accepted[l.id] ?? '') ?? (accepted[l.id]?.trim() ? Number.NaN : 0);
    const r = damaged[l.id] ? parseDecimalBR(rejected[l.id] ?? '') ?? (rejected[l.id]?.trim() ? Number.NaN : 0) : 0;
    const serialList = (serials[l.id] ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    return { l, a, r, serialList };
  });
  const posting = lines.filter((x) => x.a > 0 || x.r > 0 || Number.isNaN(x.a) || Number.isNaN(x.r));
  const problems = posting.flatMap(({ l, a, r, serialList }) => {
    const out: string[] = [];
    if (Number.isNaN(a) || Number.isNaN(r)) out.push(`${l.itemCode}: quantidade inválida`);
    if (a > l.open + 1e-9) out.push(`${l.itemCode}: recebido acima do aberto (${qty(l.open, l.unit)})`);
    if (r > 0 && (reasons[l.id] ?? '').trim().length < 3) out.push(`${l.itemCode}: diga o motivo da rejeição`);
    if (a > 0 && l.tracking === 'LOT' && !(lots[l.id] ?? '').trim()) out.push(`${l.itemCode}: informe o lote`);
    if (a > 0 && l.tracking === 'SERIAL' && serialList.length !== a) out.push(`${l.itemCode}: ${serialList.length} série(s) para ${qty(a)} unidade(s)`);
    return out;
  });
  if (!posting.length) problems.push('Informe o que chegou em ao menos uma linha.');
  if (!location) problems.push('Escolha onde o material fica.');

  const step = (id: string, open: number, delta: number) => {
    const cur = parseDecimalBR(accepted[id] ?? '') ?? 0;
    setAccepted({ ...accepted, [id]: fmt(Math.min(open, Math.max(0, cur + delta))) });
  };
  const pickPhoto = async (file: File | null) => {
    setPhotoError(null);
    if (!file) { setPhoto(null); return; }
    setPreparing(true);
    try {
      const ready = await prepareEvidence(file);
      setPhoto({ file: ready, label: `${ready.name} · ${(ready.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB${ready !== file ? ' (convertida para JPEG)' : ''}` });
    } catch (e) { setPhoto(null); setPhotoError((e as Error).message); }
    finally { setPreparing(false); }
  };

  const submit = async () => {
    const out = await run(`receive:${order.id}`, '/api/supply/receiving/receipts', {
      purchaseOrderId: order.id, locationId: location || null, shipmentId: shipment || null,
      note: note.trim() || null, discrepancyReason: discrepancy.trim() || null,
      lines: posting.map(({ l, a, r, serialList }) => ({ poLineId: l.id, acceptedQuantity: a, rejectedQuantity: r,
        rejectionReason: r > 0 ? reasons[l.id]?.trim() : null, lotCode: lots[l.id]?.trim() || null,
        serials: l.tracking === 'SERIAL' ? serialList : undefined })),
    }, { title: 'Recebimento registrado' });
    if (!out.ok) return;
    let evidence: 'none' | 'ok' | string = 'none';
    if (photo) {
      try { await attachEvidence(String(out.result.receipt_id), photo.file); evidence = 'ok'; }
      catch (e) { evidence = (e as Error).message; }
    }
    onPosted({ number: String(out.result.receipt_number ?? 'Recebimento'), status: String(out.result.inspection_status ?? ''), evidence });
  };

  return (
    <SidePanel open onClose={onClose} testId="receive-form" eyebrow={`Receber · ${order.counterpart}`} title={`Receber ${order.number}`}
      meta={<>{order.project && <span>{order.project}</span>}<span>destino {order.destination ?? '—'}</span>
        {order.expectedDate && <span>previsto {dateShort(order.expectedDate)}</span>}</>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onBack}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={problems.length > 0 || busy !== null || preparing} onClick={submit}>
          <Busy on={busy !== null}>Registrar recebimento</Busy></button>
      </>}>
      <div className="ax-form">
        {lines.map(({ l, a }) => (
          <fieldset key={l.id} className="ax-linecard">
            <legend><b>{l.itemCode}</b> {l.itemDescription}</legend>
            <p className="ax-subtle">Em aberto no pedido: <strong>{qty(l.open, l.unit)}</strong></p>
            <span className="ax-field-label">Chegou bom ({l.unit})</span>
            <div className="ax-stepper">
              <button type="button" aria-label={`Menos 1 ${l.itemCode}`} onClick={() => step(l.id, l.open, -1)}><Minus size={18} aria-hidden /></button>
              <input className="ax-stepper-input" inputMode="decimal" aria-label={`Recebido ${l.itemCode}`} value={accepted[l.id] ?? ''}
                onChange={(e) => setAccepted({ ...accepted, [l.id]: e.target.value })} />
              <button type="button" aria-label={`Mais 1 ${l.itemCode}`} onClick={() => step(l.id, l.open, 1)}><Plus size={18} aria-hidden /></button>
            </div>
            <div className="ax-inline" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="ax-btn ghost sm" onClick={() => setAccepted({ ...accepted, [l.id]: fmt(l.open) })}>Tudo ({qty(l.open)})</button>
              <button type="button" className="ax-btn ghost sm" onClick={() => setAccepted({ ...accepted, [l.id]: '0' })}>Nada</button>
              <button type="button" className={damaged[l.id] ? 'ax-btn sm danger-soft' : 'ax-btn ghost sm'} aria-pressed={Boolean(damaged[l.id])}
                onClick={() => setDamaged({ ...damaged, [l.id]: !damaged[l.id] })}><ShieldAlert size={13} aria-hidden />Registrar avaria</button>
            </div>
            {damaged[l.id] && (
              <div className="ax-field-row">
                <label className="ax-field"><span>Rejeitado/avariado</span>
                  <input inputMode="decimal" aria-label={`Rejeitado ${l.itemCode}`} value={rejected[l.id] ?? ''}
                    onChange={(e) => setRejected({ ...rejected, [l.id]: e.target.value })} /></label>
                <label className="ax-field"><span>Motivo</span>
                  <input aria-label={`Motivo ${l.itemCode}`} value={reasons[l.id] ?? ''} placeholder="Ex.: bobina amassada"
                    onChange={(e) => setReasons({ ...reasons, [l.id]: e.target.value })} /></label>
              </div>
            )}
            {l.tracking === 'LOT' && a > 0 && <label className="ax-field"><span>Lote</span><input value={lots[l.id] ?? ''} onChange={(e) => setLots({ ...lots, [l.id]: e.target.value })} /></label>}
            {l.tracking === 'SERIAL' && a > 0 && <label className="ax-field"><span>Números de série (um por linha)</span>
              <textarea value={serials[l.id] ?? ''} onChange={(e) => setSerials({ ...serials, [l.id]: e.target.value })} /></label>}
          </fieldset>
        ))}

        <label className="ax-field"><span>Local de recebimento</span>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            {data.locations.map((x) => <option key={x.id} value={x.id}>{x.name}{x.kind === 'QUARANTINE' ? ' (inspeção)' : ''}</option>)}
          </select></label>
        {quarantineLoc && (
          <label className="ax-check">
            <input type="checkbox" checked={inQuarantine} onChange={(e) => setLocation(e.target.checked ? quarantineLoc.id : defaultLoc)} />
            Mandar para inspeção (quarentena) — fica “entrando”, sem reserva, até a decisão
          </label>
        )}
        {liveShips.length > 0 && (
          <label className="ax-field"><span>Embarque</span>
            <select value={shipment} onChange={(e) => setShipment(e.target.value)}>
              <option value="">—</option>
              {liveShips.map((s) => <option key={s.id} value={s.id}>{s.number} · {SHIPMENT_STATUS_LABEL[s.status]}{s.carrier ? ` · ${s.carrier}` : ''}</option>)}
            </select></label>
        )}
        <label className="ax-field"><span>Divergência com o romaneio ou a nota (opcional)</span>
          <input value={discrepancy} onChange={(e) => setDiscrepancy(e.target.value)} placeholder="Ex.: nota diz 100 m, chegaram 80 m" /></label>
        <label className="ax-field"><span>Observação (opcional)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>

        <div className="ax-photo">
          <label className="ax-btn">
            <Camera size={16} aria-hidden /><Busy on={preparing}>{photo ? 'Trocar foto ou documento' : 'Foto ou documento'}</Busy>
            <input type="file" accept="image/*,application/pdf" capture="environment" hidden aria-label="Foto ou documento"
              onChange={(e) => { void pickPhoto(e.target.files?.[0] ?? null); }} />
          </label>
          {photo && <span className="ax-subtle">{photo.label}</span>}
          {photoError && <span className="ax-error-text" role="alert">{photoError}</span>}
        </div>

        {problems.length > 0 && posting.length > 0 && (
          <ul className="ax-problems" role="status">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        )}
        {inQuarantine && <p className="ax-note">Recebido em quarentena fica “em inspeção”: conta como entrando, não é reservável até a decisão.</p>}
      </div>
    </SidePanel>
  );
}
