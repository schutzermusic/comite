'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FilePlus2, Send } from 'lucide-react';
import { REQUISITION_STATUS_LABEL, SUPPLIER_STATUS_LABEL } from '@/lib/supply/procurement';
import { REQUIREMENT_PRIORITY_LABEL } from '@/lib/supply/coverage';
import {
  Busy, Chip, EmptyState, Filters, Plane, SearchBox, SidePanel, dateShort, href, parseDecimalBR, pct, plural, qty, useGovernedAction,
  useResource, useUrlParam, type Tone,
} from '@/components/ax';
import type { ProcurementModel } from './shared';

type Requisition = ProcurementModel['requisitions'][number];
const STATUS_TONE: Record<string, Tone> = { SUBMITTED: 'warning', SOURCING: 'info', ORDERED: 'success', CANCELLED: 'neutral', CLOSED: 'neutral' };
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * SOLICITAÇÕES — o que precisa ser comprado, de qual requisito veio cada
 * quantidade, e o que ainda não está em cotação. Marque as linhas e abra UMA
 * cotação para vários fornecedores.
 */
export function RequisitionsStage({ data, onChanged }: { data: ProcurementModel; onChanged: () => void }) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [focus] = useUrlParam<string>('rq', '');
  const [panel, setPanel] = useState<'rfq' | 'manual' | { cancel: Requisition } | null>(null);
  const caps = data.capabilities;
  const rows = useMemo(() => data.requisitions
    .filter((r) => filter === 'all' || r.status === 'SUBMITTED' || r.status === 'SOURCING')
    .filter((r) => !search || norm([r.number, r.project, ...r.lines.map((l) => `${l.itemCode} ${l.itemDescription}`)].join(' ')).includes(norm(search)))
    .sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || (a.lines[0]?.requiredBy ?? a.requiredBy ?? '9999').localeCompare(b.lines[0]?.requiredBy ?? b.requiredBy ?? '9999')),
  [data, filter, search, focus]);
  const openCount = data.requisitions.filter((r) => r.status === 'SUBMITTED' || r.status === 'SOURCING').length;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Plane flush title="Solicitações de compra" count={rows.length}
      subtitle="A falta do plano vira requisição com o requisito de origem — o banco não deixa a mesma falta ser requisitada duas vezes"
      action={<div className="ax-inline">
        {caps.source && <button type="button" className="ax-btn primary sm" disabled={!picked.length} onClick={() => setPanel('rfq')}>
          <Send size={13} aria-hidden />Abrir cotação{picked.length ? ` (${picked.length})` : ''}</button>}
        {caps.request && <button type="button" className="ax-btn ghost sm" onClick={() => setPanel('manual')}><FilePlus2 size={13} aria-hidden />Requisição manual</button>}
      </div>}
      bar={<div className="ax-toolbar">
        <Filters label="Recorte" value={filter} onChange={setFilter} options={[
          { id: 'open', label: 'Aguardando compra', count: openCount }, { id: 'all', label: 'Todas (90 dias)', count: data.requisitions.length },
        ]} />
        <SearchBox value={search} onChange={setSearch} placeholder="Requisição, projeto ou material" label="Buscar requisição" />
      </div>}>
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma requisição aguardando">
          Requisite a partir da falta de material — no <Link className="ax-link" href={href.materialPlanning('short')}>Planejamento de Materiais</Link> ou na aba Materiais do projeto.
        </EmptyState>
      ) : (
        <div className="ax-reqlist">
          {rows.map((r) => {
            const open = r.status === 'SUBMITTED' || r.status === 'SOURCING';
            return (
              <article key={r.id} className="ax-req" data-focus={r.id === focus || undefined} aria-label={`Requisição ${r.number}`}>
                <header>
                  <div className="ax-cellstack">
                    <span className="ax-row-eyebrow"><span className="ax-kind">{r.source === 'SHORTAGE' ? 'Falta do plano' : 'Manual'}</span>
                      <span className="ax-row-where">{r.project}{r.deliveryLocation ? ` · entrega em ${r.deliveryLocation}` : ''}</span></span>
                    <strong className="ax-num">{r.number}</strong>
                  </div>
                  <div className="ax-inline">
                    <Chip tone={r.priority === 'critical' ? 'danger' : r.priority === 'high' ? 'warning' : 'neutral'} quiet>
                      {REQUIREMENT_PRIORITY_LABEL[r.priority] ?? r.priority}</Chip>
                    <Chip tone={STATUS_TONE[r.status] ?? 'neutral'}>{REQUISITION_STATUS_LABEL[r.status]}</Chip>
                    {open && (caps.request || caps.source) && (
                      <button type="button" className="ax-btn ghost sm" onClick={() => setPanel({ cancel: r })}>Cancelar</button>)}
                  </div>
                </header>
                <ul>
                  {r.lines.map((l) => {
                    const pickable = caps.source && open && !l.inRfq;
                    return (
                      <li key={l.id} data-testid="requisition-row">
                        {pickable ? (
                          <input type="checkbox" aria-label={`Cotar ${l.itemCode} de ${r.number}`} checked={picked.includes(l.id)} onChange={() => toggle(l.id)} />
                        ) : <span aria-hidden className="ax-req-spacer" />}
                        <div className="ax-cellstack">
                          <span><b>{l.itemCode}</b> {l.itemDescription} · <strong className="ax-num">{qty(l.quantity, l.unit)}</strong></span>
                          {l.requirements.length > 0 && (
                            <small>para {l.requirements.map((q, i) => <span key={q.requirementId}>{i > 0 && ' · '}
                              <Link className="ax-link" href={href.requirement(q.requirementId)}>{q.title}</Link> ({qty(q.quantity)})</span>)}</small>
                          )}
                        </div>
                        <span className="ax-cellstack" style={{ alignItems: 'flex-end' }}>
                          <span className="ax-num">{dateShort(l.requiredBy)}</span><small>necessidade</small>
                        </span>
                        <span>{l.inRfq ? <Chip tone="info" quiet>em cotação</Chip> : open ? <Chip tone="warning" quiet>sem cotação</Chip> : null}</span>
                      </li>
                    );
                  })}
                </ul>
                {r.justification && <p className="ax-note" style={{ margin: 0, padding: '0 16px 12px' }}>Justificativa: {r.justification}</p>}
              </article>
            );
          })}
        </div>
      )}
      {panel === 'rfq' && <RfqPanel data={data} lineIds={picked} onClose={() => setPanel(null)} onDone={() => { setPanel(null); setPicked([]); onChanged(); }} />}
      {panel === 'manual' && <ManualPanel data={data} onClose={() => setPanel(null)} onDone={() => { setPanel(null); onChanged(); }} />}
      {panel && typeof panel === 'object' && <CancelPanel r={panel.cancel} onClose={() => setPanel(null)} onDone={() => { setPanel(null); onChanged(); }} />}
    </Plane>
  );
}

function RfqPanel({ data, lineIds, onClose, onDone }: { data: ProcurementModel; lineIds: string[]; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const eligible = data.suppliers.filter((s) => s.status === 'PROSPECT' || s.status === 'HOMOLOGATED');
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const lines = data.requisitions.flatMap((r) => r.lines.filter((l) => lineIds.includes(l.id)).map((l) => ({ ...l, number: r.number })));
  return (
    <SidePanel open onClose={onClose} testId="rfq-form" eyebrow="Compras · cotação" title="Abrir cotação"
      meta={<span>{plural(lineIds.length, 'linha', 'linhas')} de requisição — o mesmo pedido de preço para todos os convidados.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!suppliers.length || busy !== null}
          onClick={() => run('rfq', '/api/supply/procurement/rfqs', { requisitionLineIds: lineIds, supplierIds: suppliers, responseDue: due || null },
            { title: 'Cotação aberta', detail: 'Registre as propostas à medida que chegarem.' })}>
          <Busy on={busy !== null}>Abrir cotação</Busy></button>
      </>}>
      <ul className="ax-loclist" aria-label="Linhas cotadas" style={{ marginTop: 0 }}>
        {lines.map((l) => <li key={l.id}><span><b>{l.itemCode}</b> {l.itemDescription}</span><em>{l.number}</em><strong>{qty(l.quantity, l.unit)}</strong></li>)}
      </ul>
      <fieldset className="ax-linecard" style={{ marginTop: 14 }}>
        <legend>Fornecedores convidados</legend>
        {eligible.length === 0 && <p className="ax-muted">Nenhum fornecedor apto (prospecto ou homologado). Cadastre em Fornecedores.</p>}
        {eligible.map((s) => (
          <label key={s.id} className="ax-check ax-supplier-pick">
            <input type="checkbox" checked={suppliers.includes(s.id)}
              onChange={() => setSuppliers((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} />
            <span className="ax-cellstack"><span><b>{s.name}</b> · {SUPPLIER_STATUS_LABEL[s.status]}</span>
              <small>{[s.categories.join(', ') || null, s.onTimeRate === null ? 'sem histórico de entrega' : `${pct(s.onTimeRate)} no prazo`,
                s.defaultLeadTimeDays ? `prazo usual ${s.defaultLeadTimeDays} d` : null].filter(Boolean).join(' · ')}</small></span>
          </label>
        ))}
      </fieldset>
      <label className="ax-field" style={{ marginTop: 14 }}><span>Prazo de resposta</span><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
    </SidePanel>
  );
}

function ManualPanel({ data, onClose, onDone }: { data: ProcurementModel; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const catalog = useResource<{ ok: true; items: Array<{ id: string; code: string; description: string; unit: string }> }>('/api/supply/items');
  const items = catalog.data?.items ?? [];
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [location, setLocation] = useState('');
  const [justification, setJustification] = useState('');
  const n = parseDecimalBR(quantity);
  return (
    <SidePanel open onClose={onClose} testId="manual-requisition-form" eyebrow="Compras · exceção" title="Requisição manual"
      meta={<span>Fora do fluxo da falta: a justificativa fica registrada com a requisição.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!itemId || !(n && n > 0) || justification.trim().length < 10 || busy !== null}
          onClick={() => run('manual-requisition', '/api/supply/procurement/requisitions', { source: 'MANUAL', justification: justification.trim(),
            requiredBy: requiredBy || null, deliveryLocationId: location || null, lines: [{ itemId, quantity: n }] }, { title: 'Requisição registrada' })}>
          <Busy on={busy !== null}>Requisitar</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Item</span><select value={itemId} onChange={(e) => setItemId(e.target.value)}><option value="">Selecione…</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description} ({i.unit})</option>)}</select></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Quantidade</span><input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
          <label className="ax-field"><span>Necessário em</span><input type="date" value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} /></label>
        </div>
        <label className="ax-field"><span>Local de entrega</span><select value={location} onChange={(e) => setLocation(e.target.value)}><option value="">—</option>
          {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label className="ax-field"><span>Justificativa (mín. 10 caracteres)</span><textarea value={justification} onChange={(e) => setJustification(e.target.value)} /></label>
      </div>
    </SidePanel>
  );
}

function CancelPanel({ r, onClose, onDone }: { r: Requisition; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const [reason, setReason] = useState('');
  return (
    <SidePanel open onClose={onClose} testId="requisition-cancel-form" eyebrow="Compras" title={`Cancelar ${r.number}`}
      meta={<span>A falta volta a ficar sem requisição no plano.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={reason.trim().length < 3 || busy !== null}
          onClick={() => run(`cancel-rq:${r.id}`, `/api/supply/procurement/requisitions/${r.id}`, { action: 'cancel', reason: reason.trim() },
            { title: 'Requisição cancelada' }, { idempotent: false })}>
          <Busy on={busy !== null}>Cancelar requisição</Busy></button>
      </>}>
      <label className="ax-field"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </SidePanel>
  );
}
