'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import {
  TRANSFER_ACTION_LABEL, TRANSFER_STATUS_LABEL, TRANSFER_STATUS_TONE, transferActions, type TransferAction, type TransferStatus,
} from '@/lib/supply/inventory';
import {
  Busy, Chip, EmptyState, Filters, KV, Plane, Section, SidePanel, dateShort, dateTime, href, parseDecimalBR, qty, useGovernedAction,
  useUrlParam, useUrlParams,
} from '@/components/ax';
import type { InventoryModel } from './shared';

type Transfer = InventoryModel['transfers'][number];
type Filter = 'open' | TransferStatus | 'done';
const OPEN: TransferStatus[] = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED'];

/** TRANSFERÊNCIAS — solicitada → aprovada → em trânsito → recebida (parcial) → encerrada. Cada passo posta no livro. */
export function TransfersView({ data, onChanged }: { data: InventoryModel; onChanged: () => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const [openId] = useUrlParam<string>('transfer', '');
  const patch = useUrlParams();
  const [creating, setCreating] = useState(false);
  const caps = data.capabilities;
  const rows = useMemo(() => data.transfers.filter((t) => (filter === 'open' ? OPEN.includes(t.status)
    : filter === 'done' ? !OPEN.includes(t.status) : t.status === filter)), [data, filter]);
  const open = openId ? data.transfers.find((t) => t.id === openId) ?? null : null;
  const count = (s: TransferStatus) => data.transfers.filter((t) => t.status === s).length;
  return (
    <Plane flush title="Transferências" count={rows.length}
      subtitle="Despacho posta a saída na origem; recebimento posta a entrada no destino e reserva para o requisito"
      action={(caps.manage || caps.reserve) ? <button type="button" className="ax-btn sm" onClick={() => setCreating(true)}><Plus size={13} aria-hidden />Nova transferência</button> : undefined}
      bar={<Filters<Filter> label="Situação da transferência" value={filter} onChange={setFilter} options={[
        { id: 'open', label: 'Em andamento', count: data.transfers.filter((t) => OPEN.includes(t.status)).length },
        ...(['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'] as TransferStatus[]).filter((s) => count(s))
          .map((s) => ({ id: s, label: TRANSFER_STATUS_LABEL[s], count: count(s) })),
        { id: 'done', label: 'Encerradas e canceladas', count: data.transfers.filter((t) => !OPEN.includes(t.status)).length },
      ]} />}>
      {rows.length === 0 ? <EmptyState title="Nenhuma transferência neste recorte">Peça uma transferência aqui ou a partir da falta de um material.</EmptyState> : (
        <div className="ax-queue">
          {rows.map((t) => {
            const late = t.expectedArrival && t.expectedArrival < data.today && ['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(t.status);
            return (
              <div key={t.id} className="ax-row no-owner" data-tone={late ? 'danger' : TRANSFER_STATUS_TONE[t.status] === 'neutral' ? 'neutral' : TRANSFER_STATUS_TONE[t.status]} data-testid="transfer-row">
                <div className="ax-row-main">
                  <span className="ax-row-eyebrow"><span className="ax-kind">{TRANSFER_STATUS_LABEL[t.status]}</span>
                    <span className="ax-row-where">{t.project ?? 'sem projeto'}{t.requestedBy ? ` · pedida por ${t.requestedBy}` : ''}</span></span>
                  <button type="button" className="ax-rowlink ax-row-object" onClick={() => patch({ transfer: t.id })}>
                    {t.number}<span className="ax-subtle"> · {t.fromLocation} <ArrowRight size={11} aria-hidden /> {t.toLocation}</span></button>
                  <span className="ax-row-issue">{t.lines.map((l) => `${l.itemCode} ${qty(l.quantity, l.unit)}`).join(' · ')}</span>
                </div>
                <div className="ax-cellstack">
                  <span className={late ? 'ax-row-due ax-danger-text' : 'ax-row-due'}>{t.expectedArrival ? dateShort(t.expectedArrival) : 'sem data'}</span>
                  <small>{late ? 'atrasada' : 'chegada'}</small>
                </div>
                <div className="ax-row-actions"><button type="button" className="ax-btn sm" onClick={() => patch({ transfer: t.id })}>Abrir</button></div>
              </div>
            );
          })}
        </div>
      )}
      {open && <TransferPanel t={open} caps={caps} onClose={() => patch({ transfer: null })} onChanged={onChanged} />}
      {creating && <NewTransferPanel data={data} onClose={() => setCreating(false)} onDone={() => { setCreating(false); onChanged(); }} />}
    </Plane>
  );
}

function TransferPanel({ t, caps, onClose, onChanged }: { t: Transfer; caps: InventoryModel['capabilities']; onClose: () => void; onChanged: () => void }) {
  const [mode, setMode] = useState<TransferAction | null>(null);
  const { run, busy } = useGovernedAction(() => { setMode(null); onChanged(); });
  const actions = transferActions(t.status, caps);
  const url = `/api/supply/inventory/transfers/${t.id}`;
  return (
    <SidePanel open onClose={onClose} testId="transfer-drawer" eyebrow="Transferência entre locais" title={t.number}
      meta={<><Chip tone={TRANSFER_STATUS_TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Chip><span>{t.fromLocation} → {t.toLocation}</span></>}
      footer={actions.length ? <>{actions.map((a) => (
        <button key={a} type="button" className={a === 'cancel' || a === 'close' ? 'ax-btn ghost' : 'ax-btn primary'} disabled={busy !== null}
          onClick={() => (a === 'approve' ? run(`approve:${t.id}`, url, { action: 'approve' }, { title: 'Transferência aprovada' }, { idempotent: false }) : setMode(a))}>
          {TRANSFER_ACTION_LABEL[a]}</button>
      ))}</> : undefined}>
      <Section title="Rota e transporte">
        <KV items={[['Projeto', t.project ?? '—'], ['Chegada prevista', t.expectedArrival ? dateShort(t.expectedArrival) : '—'],
          ['Transporte', [t.carrier, t.trackingRef].filter(Boolean).join(' · ') || '—'], ['Pedida', `${t.requestedBy ?? '—'} · ${dateTime(t.requestedAt)}`],
          ...(t.dispatchedAt ? [['Despachada', dateTime(t.dispatchedAt)] as [string, string]] : []),
          ...(t.closeReason ? [['Motivo', t.closeReason] as [string, string]] : [])]} />
      </Section>
      <Section title="Linhas">
        <ul className="ax-loclist">
          {t.lines.map((l) => (
            <li key={l.id}><span><b>{l.itemCode}</b> {l.itemDescription}{l.lotCode ? ` · ${l.lotCode}` : ''}
              {l.requirementId && <><br /><small className="ax-subtle">para <a className="ax-link" href={href.requirement(l.requirementId)}>{l.requirementTitle ?? 'requisito'}</a>
                {l.fromReservation ? ' · da reserva na origem' : ''}</small></>}</span>
              <em>despachado {qty(l.dispatched)} · recebido {qty(l.received)}</em><strong>{qty(l.quantity, l.unit)}</strong></li>
          ))}
        </ul>
      </Section>
      {mode && mode !== 'approve' && <TransferActPanel t={t} mode={mode} busy={busy !== null} onClose={() => setMode(null)}
        onConfirm={(body, idempotent) => run(`${mode}:${t.id}`, url, { action: mode, ...body }, { title: TRANSFER_ACTION_LABEL[mode] }, { idempotent })} />}
    </SidePanel>
  );
}

function TransferActPanel({ t, mode, busy, onClose, onConfirm }: {
  t: Transfer; mode: Exclude<TransferAction, 'approve'>; busy: boolean; onClose: () => void;
  onConfirm: (body: Record<string, unknown>, idempotent: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [carrier, setCarrier] = useState(t.carrier ?? '');
  const [trackingRef, setTrackingRef] = useState(t.trackingRef ?? '');
  const pending = t.lines.map((l) => ({ id: l.id, label: `${l.itemCode} ${l.itemDescription}`, max: l.dispatched - l.received }));
  const [received, setReceived] = useState<Record<string, string>>(Object.fromEntries(pending.map((p) => [p.id, String(p.max).replace('.', ',')])));
  const missing = t.lines.reduce((a, l) => a + l.dispatched - l.received, 0);
  const receiveLines = pending.map((p) => ({ lineId: p.id, quantity: parseDecimalBR(received[p.id] ?? '') ?? 0 })).filter((l) => l.quantity > 0);
  const valid = mode === 'receive' ? receiveLines.length > 0 && receiveLines.every((l) => l.quantity <= (pending.find((p) => p.id === l.lineId)?.max ?? 0) + 1e-9)
    : mode === 'cancel' ? reason.trim().length >= 3 : mode === 'close' ? missing === 0 || reason.trim().length >= 3 : true;
  const body = mode === 'receive' ? { lines: receiveLines }
    : mode === 'dispatch' ? { carrier: carrier.trim() || undefined, trackingRef: trackingRef.trim() || undefined } : { reason: reason.trim() || undefined };
  return (
    <SidePanel open onClose={onClose} testId="transfer-act-form" eyebrow={t.number} title={TRANSFER_ACTION_LABEL[mode]}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!valid || busy} onClick={() => onConfirm(body, mode === 'receive')}>
          <Busy on={busy}>{TRANSFER_ACTION_LABEL[mode]}</Busy></button>
      </>}>
      <div className="ax-form">
        {mode === 'dispatch' && <>
          <p className="ax-muted">Despachar posta a saída na origem. Saldo reservado para outra obra não sai.</p>
          <div className="ax-field-row">
            <label className="ax-field"><span>Transportador</span><input value={carrier} onChange={(e) => setCarrier(e.target.value)} /></label>
            <label className="ax-field"><span>Rastreio / romaneio</span><input value={trackingRef} onChange={(e) => setTrackingRef(e.target.value)} /></label>
          </div>
        </>}
        {mode === 'receive' && pending.filter((p) => p.max > 0).map((p) => (
          <label key={p.id} className="ax-field"><span>{p.label} — pendente {qty(p.max)}</span>
            <input inputMode="decimal" value={received[p.id] ?? ''} onChange={(e) => setReceived({ ...received, [p.id]: e.target.value })} /></label>
        ))}
        {(mode === 'cancel' || (mode === 'close' && missing > 0)) && <>
          {mode === 'close' && <p className="ax-muted">{qty(missing)} despachado(s) não chegaram. Encerrar registra a perda — diga o motivo.</p>}
          <label className="ax-field"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </>}
        {mode === 'close' && missing === 0 && <p className="ax-muted">Tudo recebido. Encerrar arquiva a transferência.</p>}
      </div>
    </SidePanel>
  );
}

function NewTransferPanel({ data, onClose, onDone }: { data: InventoryModel; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const active = data.locations.filter((l) => l.active && l.kind !== 'QUARANTINE');
  const [from, setFrom] = useState(active[0]?.id ?? '');
  const [to, setTo] = useState(active[1]?.id ?? '');
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<Array<{ itemId: string; quantity: string; lotCode: string }>>([{ itemId: '', quantity: '', lotCode: '' }]);
  const availableAt = (itemId: string) => data.position.find((p) => p.itemId === itemId && p.locationId === from)?.available ?? 0;
  const parsed = lines.map((l) => ({ itemId: l.itemId, quantity: parseDecimalBR(l.quantity) ?? 0, lotCode: l.lotCode.trim() || null }))
    .filter((l) => l.itemId && l.quantity > 0);
  const valid = from && to && from !== to && parsed.length > 0;
  const freeItems = data.items.filter((i) => availableAt(i.id) > 0);
  return (
    <SidePanel open onClose={onClose} testId="transfer-form" eyebrow="Estoque · transferência" title="Nova transferência"
      meta={<span>Transferência livre (sem requisito). Para cobrir uma falta, peça a partir da demanda — o destino já reserva.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!valid || busy !== null}
          onClick={() => run('new-transfer', '/api/supply/inventory/transfers', { fromLocationId: from, toLocationId: to, expectedArrival: expected || null, lines: parsed },
            { title: 'Transferência solicitada' })}>
          <Busy on={busy !== null}>Solicitar</Busy></button>
      </>}>
      <div className="ax-form">
        <div className="ax-field-row">
          <label className="ax-field"><span>Origem</span><select value={from} onChange={(e) => setFrom(e.target.value)}>{active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="ax-field"><span>Destino</span><select value={to} onChange={(e) => setTo(e.target.value)}>{active.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        </div>
        <label className="ax-field"><span>Chegada prevista</span><input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
        {lines.map((l, i) => {
          const item = data.items.find((x) => x.id === l.itemId);
          return (
            <fieldset key={i} className="ax-linecard">
              <legend>Linha {i + 1}</legend>
              <label className="ax-field"><span>Item</span><select value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}>
                <option value="">Selecione…</option>{(freeItems.length ? freeItems : data.items).map((it) => <option key={it.id} value={it.id}>{it.code} — {it.description}</option>)}</select></label>
              <div className="ax-field-row">
                <label className="ax-field"><span>Quantidade{l.itemId ? ` (livre na origem: ${qty(availableAt(l.itemId))})` : ''}</span>
                  <input inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></label>
                {item && item.tracking !== 'NONE' && <label className="ax-field"><span>Lote/série</span>
                  <input value={l.lotCode} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, lotCode: e.target.value } : x)))} /></label>}
              </div>
              {lines.length > 1 && <button type="button" className="ax-btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={13} aria-hidden />Remover</button>}
            </fieldset>
          );
        })}
        <button type="button" className="ax-btn ghost sm" onClick={() => setLines([...lines, { itemId: '', quantity: '', lotCode: '' }])}><Plus size={13} aria-hidden />Adicionar linha</button>
      </div>
    </SidePanel>
  );
}
