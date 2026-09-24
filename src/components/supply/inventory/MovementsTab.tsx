'use client';

import { useMemo, useState } from 'react';
import { MOVEMENT_TYPE_LABEL, type MovementType } from '@/lib/supply/inventory';
import { DataTable, EmptyNote, Filter, Toolbar, matches } from '@/components/operations/ui';
import { qty, type InventoryModel } from './shared';

const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

/** MOVIMENTAÇÕES — o livro, do mais recente: origem, motivo, projeto, pessoa e referência em cada linha. */
export function MovementsTab({ data }: { data: InventoryModel }) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const rows = useMemo(() => data.movements
    .filter((m) => type === 'all' || m.type === type)
    .filter((m) => !search || matches(search, m.itemCode, m.itemDescription, m.locationName, m.project, m.reason, m.reference, m.actor)),
  [data, search, type]);
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar item, local, projeto, motivo ou pessoa">
        <Filter label="Tipo de movimento" value={type} onChange={setType} options={[{ value: 'all', label: 'Todos os tipos' },
          ...(Object.keys(MOVEMENT_TYPE_LABEL) as MovementType[]).map((t) => ({ value: t, label: MOVEMENT_TYPE_LABEL[t] }))]} />
      </Toolbar>
      <DataTable label="Movimentações de estoque" columns={['Quando', 'Movimento', 'Item', 'Local', 'Quantidade', 'Projeto / referência', 'Motivo', 'Quem']}
        count={rows.length} footer="Livro append-only — erro se corrige com outra linha, nunca reescrevendo"
        empty={<EmptyNote title="Nenhuma movimentação" description="Ajustes, transferências, entregas e contagens aparecem aqui." />}>
        {rows.map((m) => (
          <tr key={m.id} data-testid="movement-row">
            <td className="tabular-nums">{when(m.occurredAt)}</td>
            <td>{MOVEMENT_TYPE_LABEL[m.type]}</td>
            <td><b>{m.itemCode}</b> {m.itemDescription}{m.lotCode && <p className="crm-muted">Lote/série {m.lotCode}</p>}</td>
            <td>{m.locationName}</td>
            <td className={`tabular-nums ${m.quantity < 0 ? 'crm-tone-danger' : 'crm-tone-success'}`}>{m.quantity > 0 ? '+' : ''}{qty(m.quantity)} {m.unit}</td>
            <td>{m.project ?? '—'}{m.reference && <p className="crm-muted">{m.reference}</p>}</td>
            <td>{m.reason ?? '—'}</td>
            <td>{m.actor ?? '—'}</td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
