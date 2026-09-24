'use client';

import { useMemo, useState } from 'react';
import { MOVEMENT_TYPE_LABEL, type MovementType } from '@/lib/supply/inventory';
import { Chip, EmptyState, Filters, Plane, SearchBox, dateTime, qty, type Tone } from '@/components/ax';
import type { InventoryModel } from './shared';

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const TYPE_TONE: Record<string, Tone> = {
  RECEIPT: 'success', TRANSFER_IN: 'info', TRANSFER_OUT: 'info', ISSUE_TO_PROJECT: 'accent', RETURN_FROM_PROJECT: 'accent',
  ADJUSTMENT: 'warning', COUNT_CORRECTION: 'warning',
};
type Group = 'all' | 'in' | 'out' | 'correction';

/**
 * O LIVRO — a fonte da verdade do estoque, do mais recente para trás: cada
 * linha com sinal, local, origem (pedido, transferência, reserva, contagem),
 * motivo e quem. Append-only: erro se corrige com outra linha, nunca reescrevendo.
 */
export function LedgerView({ data }: { data: InventoryModel }) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<Group>('all');
  const [type, setType] = useState<'all' | MovementType>('all');
  const rows = useMemo(() => data.movements
    .filter((m) => group === 'all' || (group === 'in' ? m.quantity > 0 && m.type !== 'ADJUSTMENT' && m.type !== 'COUNT_CORRECTION'
      : group === 'out' ? m.quantity < 0 && m.type !== 'ADJUSTMENT' && m.type !== 'COUNT_CORRECTION' : m.type === 'ADJUSTMENT' || m.type === 'COUNT_CORRECTION'))
    .filter((m) => type === 'all' || m.type === type)
    .filter((m) => !search || norm([m.itemCode, m.itemDescription, m.locationName, m.project, m.reason, m.reference, m.actor].filter(Boolean).join(' ')).includes(norm(search))),
  [data, search, group, type]);
  const types = Array.from(new Set(data.movements.map((m) => m.type)));
  return (
    <Plane flush title="Movimentações — o livro" count={rows.length}
      subtitle="Os últimos 400 lançamentos. Posição, disponibilidade e cobertura são somas destas linhas."
      bar={<div className="ax-toolbar">
        <Filters<Group> label="Sentido" value={group} onChange={setGroup} options={[
          { id: 'all', label: 'Tudo' }, { id: 'in', label: 'Entradas' }, { id: 'out', label: 'Saídas' }, { id: 'correction', label: 'Ajustes e contagens' },
        ]} />
        <label className="ax-select"><span className="sr-only-ax">Tipo de movimento</span>
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Tipo de movimento">
            <option value="all">Todos os tipos</option>
            {types.map((t) => <option key={t} value={t}>{MOVEMENT_TYPE_LABEL[t]}</option>)}
          </select></label>
        <SearchBox value={search} onChange={setSearch} placeholder="Item, local, projeto, motivo ou pessoa" label="Buscar no livro" />
      </div>}>
      {rows.length === 0 ? <EmptyState title="Nenhuma movimentação">Recebimentos, ajustes, transferências, entregas e contagens aparecem aqui.</EmptyState> : (
        <div className="ax-table-wrap">
          <table className="ax-table cards ax-ledger">
            <caption className="sr-only-ax">Livro de movimentações de estoque</caption>
            <thead><tr><th>Quando</th><th>Movimento</th><th>Item</th><th>Local</th><th className="num">Quantidade</th><th>Origem</th><th>Motivo</th><th>Quem</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} data-testid="movement-row">
                  <td className="lead" data-label=""><div className="ax-cellstack"><span className="ax-num">{dateTime(m.occurredAt)}</span><small>#{m.seq}</small></div></td>
                  <td data-label="Movimento"><Chip tone={TYPE_TONE[m.type] ?? 'neutral'} quiet>{MOVEMENT_TYPE_LABEL[m.type]}</Chip></td>
                  <td data-label="Item"><div className="ax-cellstack"><span><b>{m.itemCode}</b> {m.itemDescription}</span>{m.lotCode && <small>lote/série {m.lotCode}</small>}</div></td>
                  <td data-label="Local">{m.locationName}</td>
                  <td className={m.quantity < 0 ? 'num ax-danger-text strong' : 'num ax-ok-text strong'} data-label="Quantidade">{m.quantity > 0 ? '+' : ''}{qty(m.quantity, m.unit)}</td>
                  <td data-label="Origem"><div className="ax-cellstack"><span>{m.project ?? '—'}</span>{m.reference && <small>{m.reference}</small>}</div></td>
                  <td data-label="Motivo">{m.reason ?? '—'}</td>
                  <td data-label="Quem">{m.actor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Plane>
  );
}
