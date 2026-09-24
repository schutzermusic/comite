'use client';

import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import {
  Busy, Chip, EmptyState, Meter, Plane, SidePanel, dateShort, parseDecimalBR, plural, qty, useGovernedAction, useUrlParam, useUrlParams,
} from '@/components/ax';
import type { InventoryModel } from './shared';

type Count = InventoryModel['counts'][number];
const STATUS: Record<string, string> = { OPEN: 'Aberta', POSTED: 'Postada', CANCELLED: 'Cancelada' };

/**
 * INVENTÁRIO — a contagem fotografa o esperado pelo livro; o físico é
 * digitado; postar aplica só as diferenças, como correção com motivo. Se o
 * item se moveu no local depois da foto, a linha vence e é recontada.
 */
export function CountsView({ data, onChanged }: { data: InventoryModel; onChanged: () => void }) {
  const [opening, setOpening] = useState(false);
  const [openId] = useUrlParam<string>('count', '');
  const patch = useUrlParams();
  const open = openId ? data.counts.find((c) => c.id === openId) ?? null : null;
  return (
    <Plane flush title="Contagens" count={data.counts.filter((c) => c.status === 'OPEN').length}
      subtitle="Uma contagem aberta por local · a divergência vira correção no livro, com motivo"
      action={data.capabilities.manage ? <button type="button" className="ax-btn sm" onClick={() => setOpening(true)}><ClipboardList size={13} aria-hidden />Abrir contagem</button> : undefined}>
      {data.counts.length === 0 ? <EmptyState title="Nenhuma contagem">Abra uma contagem para conferir o físico de um local contra o livro.</EmptyState> : (
        <div className="ax-queue">
          {data.counts.map((c) => {
            const counted = c.lines.filter((l) => l.counted !== null);
            const diff = counted.filter((l) => (l.counted ?? 0) !== l.expected);
            return (
              <div key={c.id} className="ax-row no-owner" data-tone={c.status === 'OPEN' ? (diff.length ? 'warning' : 'accent') : c.status === 'POSTED' ? 'success' : 'neutral'} data-testid="count-row">
                <div className="ax-row-main">
                  <span className="ax-row-eyebrow"><span className="ax-kind">{STATUS[c.status] ?? c.status}</span><span className="ax-row-where">aberta em {dateShort(c.openedAt.slice(0, 10))}</span></span>
                  <button type="button" className="ax-rowlink ax-row-object" onClick={() => patch({ count: c.id })}>{c.locationName}</button>
                  <span className="ax-row-issue">{counted.length} de {plural(c.lines.length, 'linha contada', 'linhas contadas')}
                    {diff.length ? ` · ${plural(diff.length, 'divergência', 'divergências')}` : counted.length ? ' · sem divergência' : ''}</span>
                </div>
                <div className="ax-cellstack"><Meter value={c.lines.length ? counted.length / c.lines.length : 0} label={`${c.locationName}: contado`} /></div>
                <div className="ax-row-actions"><button type="button" className="ax-btn sm" onClick={() => patch({ count: c.id })}>Abrir</button></div>
              </div>
            );
          })}
        </div>
      )}
      {open && <CountPanel c={open} canManage={data.capabilities.manage} onClose={() => patch({ count: null })} onChanged={onChanged} />}
      {opening && <OpenCountPanel data={data} onClose={() => setOpening(false)} onDone={() => { setOpening(false); onChanged(); }} />}
    </Plane>
  );
}

function CountPanel({ c, canManage, onClose, onChanged }: { c: Count; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const { run, busy } = useGovernedAction(onChanged);
  const [counted, setCounted] = useState<Record<string, string>>(Object.fromEntries(c.lines.map((l) => [l.id, l.counted === null ? '' : String(l.counted).replace('.', ',')])));
  const [reason, setReason] = useState('');
  const editable = c.status === 'OPEN' && canManage;
  const typed = c.lines.map((l) => ({ lineId: l.id, value: parseDecimalBR(counted[l.id] ?? '') })).filter((l) => l.value !== null) as Array<{ lineId: string; value: number }>;
  const url = `/api/supply/inventory/counts/${c.id}`;
  return (
    <SidePanel open onClose={onClose} wide testId="count-drawer" eyebrow={`Contagem · ${STATUS[c.status] ?? c.status}`} title={c.locationName}
      meta={<span>Aberta em {dateShort(c.openedAt.slice(0, 10))} · esperado = o livro no momento da abertura</span>}
      footer={editable ? <>
        <button type="button" className="ax-btn ghost" disabled={busy !== null || reason.trim().length < 3}
          onClick={() => run(`count-cancel:${c.id}`, url, { action: 'cancel', reason: reason.trim() }, { title: 'Contagem cancelada' }, { idempotent: false })}>Cancelar contagem</button>
        <button type="button" className="ax-btn" disabled={busy !== null || !typed.length}
          onClick={() => run(`count-record:${c.id}`, url, { action: 'record', lines: typed.map((l) => ({ lineId: l.lineId, countedQuantity: l.value })) },
            { title: 'Contagem salva' }, { idempotent: false })}>Salvar contado</button>
        <button type="button" className="ax-btn primary" disabled={busy !== null}
          onClick={() => run(`count-post:${c.id}`, url, { action: 'post', reason: reason.trim() || undefined }, { title: 'Contagem postada', detail: 'As diferenças viraram correções no livro.' },
            { idempotent: false })}><Busy on={busy !== null}>Postar diferenças</Busy></button>
      </> : undefined}>
      {c.lines.length === 0 ? <EmptyState compact title="Local sem saldo">Nada esperado pelo livro neste local.</EmptyState> : (
        <div className="ax-table-wrap">
          <table className="ax-table cards">
            <caption className="sr-only-ax">Linhas da contagem</caption>
            <thead><tr><th>Item</th><th className="num">Esperado</th><th style={{ width: 130 }}>Contado</th><th className="num">Diferença</th></tr></thead>
            <tbody>
              {c.lines.map((l) => {
                const n = parseDecimalBR(counted[l.id] ?? '');
                const d = n === null ? null : n - l.expected;
                return (
                  <tr key={l.id}>
                    <td className="lead" data-label=""><div className="ax-cellstack"><span><b>{l.itemCode}</b> {l.itemDescription}</span>{l.lotCode && <small>lote/série {l.lotCode}</small>}</div></td>
                    <td className="num" data-label="Esperado">{qty(l.expected, l.unit)}</td>
                    <td data-label="Contado">{editable ? <input className="ax-cellinput" aria-label={`Contado ${l.itemCode}`} inputMode="decimal" value={counted[l.id] ?? ''}
                      onChange={(e) => setCounted({ ...counted, [l.id]: e.target.value })} /> : (l.counted === null ? '—' : qty(l.counted))}</td>
                    <td className={d ? 'num strong ax-warn-text' : 'num'} data-label="Diferença">{d === null ? '—' : `${d > 0 ? '+' : ''}${qty(d)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <div className="ax-form" style={{ marginTop: 14 }}>
          <label className="ax-field"><span>Motivo da correção (obrigatório para cancelar)</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Inventário rotativo" /></label>
          <p className="ax-note">Salve o contado antes de postar. Linhas sem contado não geram correção.</p>
        </div>
      )}
      {c.closeReason && <Chip tone="neutral" quiet>{c.closeReason}</Chip>}
    </SidePanel>
  );
}

function OpenCountPanel({ data, onClose, onDone }: { data: InventoryModel; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const free = data.locations.filter((l) => l.active && !data.counts.some((c) => c.status === 'OPEN' && c.locationId === l.id));
  const [locationId, setLocationId] = useState(free[0]?.id ?? '');
  return (
    <SidePanel open onClose={onClose} testId="count-open-form" eyebrow="Estoque · inventário" title="Abrir contagem"
      meta={<span>A foto do esperado é tirada agora, pelo livro.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!locationId || busy !== null}
          onClick={() => run('count-open', '/api/supply/inventory/counts', { locationId }, { title: 'Contagem aberta' }, { idempotent: false })}>
          <Busy on={busy !== null}>Abrir</Busy></button>
      </>}>
      <label className="ax-field"><span>Local</span><select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
        {free.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
    </SidePanel>
  );
}
