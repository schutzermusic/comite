'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { RESERVATION_STATUS_LABEL } from '@/lib/supply/inventory';
import {
  Busy, Chip, EmptyState, Filters, Meter, Plane, SearchBox, SidePanel, dateShort, href, parseDecimalBR, plural, qty, useGovernedAction,
} from '@/components/ax';
import type { InventoryModel } from './shared';

type Reservation = InventoryModel['reservations'][number];
type Mode = 'release' | 'issue' | 'return';
const MODE_LABEL: Record<Mode, string> = { release: 'Liberar reserva', issue: 'Entregar à obra', return: 'Devolver da obra' };
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * RESERVAS POR PROJETO — a alocação: o que está segurado para cada obra, de
 * qual requisito, onde, quanto já foi entregue. Entregar, liberar e devolver
 * são atos governados com rastro no livro.
 */
export function ReservationsView({ data, onChanged }: { data: InventoryModel; onChanged: () => void }) {
  const [filter, setFilter] = useState<'ACTIVE' | 'closed'>('ACTIVE');
  const [search, setSearch] = useState('');
  const [acting, setActing] = useState<{ r: Reservation; mode: Mode } | null>(null);
  const caps = data.capabilities;
  const byProject = useMemo(() => {
    const rows = data.reservations.filter((r) => (filter === 'ACTIVE' ? r.status === 'ACTIVE' : r.status !== 'ACTIVE'))
      .filter((r) => !search || norm([r.itemCode, r.itemDescription, r.project, r.locationName, r.requirementTitle].join(' ')).includes(norm(search)));
    const map = new Map<string, { projectId: string; project: string; rows: Reservation[] }>();
    for (const r of rows) {
      const g = map.get(r.projectId) ?? { projectId: r.projectId, project: r.project, rows: [] };
      g.rows.push(r); map.set(r.projectId, g);
    }
    return Array.from(map.values()).sort((a, b) => a.project.localeCompare(b.project));
  }, [data, filter, search]);
  const count = byProject.reduce((a, g) => a + g.rows.length, 0);

  return (
    <Plane flush title="Reservas por projeto" count={count}
      subtitle="Reserva nasce de requisito confirmado e tira da disponibilidade — não da prateleira"
      bar={<div className="ax-toolbar">
        <Filters label="Situação da reserva" value={filter} onChange={setFilter} options={[
          { id: 'ACTIVE', label: 'Ativas', count: data.reservations.filter((r) => r.status === 'ACTIVE').length },
          { id: 'closed', label: 'Encerradas (60 dias)', count: data.reservations.filter((r) => r.status !== 'ACTIVE').length },
        ]} />
        <SearchBox value={search} onChange={setSearch} placeholder="Material, projeto, local ou requisito" label="Buscar reserva" />
      </div>}>
      {byProject.length === 0 ? (
        <EmptyState title="Nenhuma reserva neste recorte">
          Reserve a partir da demanda — no <Link className="ax-link" href={href.materialPlanning('short')}>Planejamento de Materiais</Link> ou na aba Materiais do projeto.
        </EmptyState>
      ) : byProject.map((g) => (
        <section key={g.projectId} className="ax-group" aria-label={g.project}>
          <header>
            <Link className="ax-link" href={href.project(g.projectId, 'supply')}>{g.project}</Link>
            <span className="ax-subtle">{plural(g.rows.length, 'reserva', 'reservas')} · {plural(new Set(g.rows.map((r) => r.itemId)).size, 'item', 'itens')}</span>
          </header>
          <div className="ax-queue">
            {g.rows.map((r) => (
              <div key={r.id} className="ax-row no-owner" data-tone={r.status === 'ACTIVE' ? 'accent' : 'neutral'} data-testid="reservation-row">
                <div className="ax-row-main">
                  <span className="ax-row-eyebrow"><span className="ax-kind">{RESERVATION_STATUS_LABEL[r.status]}</span>
                    <span className="ax-row-where">{r.locationName} · para <Link className="ax-link" href={href.requirement(r.requirementId)}>{r.requirementTitle}</Link></span></span>
                  <span className="ax-row-object">{r.itemDescription} <span className="ax-subtle">· {r.itemCode}</span></span>
                  <span className="ax-row-issue">{qty(r.open, r.unit)} em aberto de {qty(r.quantity, r.unit)}{r.consumed ? ` · ${qty(r.consumed)} entregue(s) à obra` : ''}
                    {r.released ? ` · ${qty(r.released)} liberado(s)` : ''}{r.closeReason ? ` · ${r.closeReason}` : ''}</span>
                </div>
                <div className="ax-cellstack">
                  <span className="ax-row-due">{r.requiredBy ? dateShort(r.requiredBy) : 'sem data'}</span>
                  <Meter value={r.quantity ? r.consumed / r.quantity : 0} tone={r.consumed >= r.quantity ? 'success' : undefined} label={`${r.itemCode}: entregue à obra`} />
                </div>
                <div className="ax-row-actions">
                  {r.status === 'ACTIVE' && caps.manage && <button type="button" className="ax-btn primary sm" onClick={() => setActing({ r, mode: 'issue' })}>Entregar</button>}
                  {r.status === 'ACTIVE' && caps.reserve && <button type="button" className="ax-btn ghost sm" onClick={() => setActing({ r, mode: 'release' })}>Liberar</button>}
                  {r.consumed > 0 && caps.manage && <button type="button" className="ax-btn ghost sm" onClick={() => setActing({ r, mode: 'return' })}>Devolver</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {acting && <ReservationPanel data={data} r={acting.r} mode={acting.mode} onClose={() => setActing(null)}
        onDone={() => { setActing(null); onChanged(); }} />}
    </Plane>
  );
}

function ReservationPanel({ data, r, mode, onClose, onDone }: { data: InventoryModel; r: Reservation; mode: Mode; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const max = mode === 'return' ? r.consumed : r.open;
  const [quantity, setQuantity] = useState(String(max).replace('.', ','));
  const [reason, setReason] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [locationId, setLocationId] = useState(r.locationId);
  const n = parseDecimalBR(quantity) ?? 0;
  const needsReason = mode !== 'issue';
  const valid = n > 0 && n <= max + 1e-9 && (!needsReason || reason.trim().length >= 3) && (r.tracking === 'NONE' || mode === 'release' || lotCode.trim());
  const body: Record<string, unknown> = mode === 'release' ? { action: 'release', quantity: n, reason: reason.trim() }
    : mode === 'issue' ? { action: 'issue', quantity: n, lotCode: lotCode.trim() || null }
      : { action: 'return', quantity: n, reason: reason.trim(), locationId, lotCode: lotCode.trim() || null };
  return (
    <SidePanel open onClose={onClose} testId="reservation-form" eyebrow={`${r.itemCode} · ${r.project}`} title={MODE_LABEL[mode]}
      meta={<span>{r.locationName} · para {r.requirementTitle}</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={!valid || busy !== null}
          onClick={() => run(`${mode}:${r.id}`, `/api/supply/inventory/reservations/${r.id}`, body, { title: MODE_LABEL[mode] },
            { idempotent: mode !== 'release' })}>
          <Busy on={busy !== null}>{MODE_LABEL[mode]}</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Quantidade ({r.unit}) — até {qty(max)}</span>
          <input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
        {mode !== 'release' && r.tracking !== 'NONE' && <label className="ax-field"><span>{r.tracking === 'LOT' ? 'Lote' : 'Número de série'}</span>
          <input value={lotCode} onChange={(e) => setLotCode(e.target.value)} /></label>}
        {mode === 'return' && <label className="ax-field"><span>Devolver para</span><select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          {data.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>}
        {needsReason && <label className="ax-field"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={mode === 'release' ? 'Replanejamento, troca de material…' : 'Sobra de obra…'} /></label>}
        {mode === 'issue' && <p className="ax-note">Entregar consome a reserva: o material sai do estoque para a obra e passa a contar como consumido no requisito.</p>}
        {mode === 'return' && <p className="ax-note">Material devolvido volta como estoque livre — a falta do requisito reaparece até nova reserva.</p>}
        {mode === 'release' && <p className="ax-note">Liberar devolve o saldo à disponibilidade; o requisito volta a ficar descoberto nessa quantidade.</p>}
      </div>
      <Chip tone="neutral" quiet>Reserva {RESERVATION_STATUS_LABEL[r.status].toLowerCase()}</Chip>
    </SidePanel>
  );
}
