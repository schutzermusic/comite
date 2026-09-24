'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Busy, Chip, EmptyState, Plane, Resource, SearchBox, SidePanel, useGovernedAction, useResource,
} from '@/components/ax';

type Item = { id: string; code: string; description: string; category: string | null; unit: string;
  manufacturer: string | null; brand: string | null; tracking: 'NONE' | 'LOT' | 'SERIAL'; active: boolean };
type Payload = { ok: true; items: Item[]; capabilities: { manage: boolean } };

const TRACKING: Record<Item['tracking'], string> = { NONE: 'Sem rastreio', LOT: 'Por lote', SERIAL: 'Por série' };
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/**
 * CATÁLOGO DE ITENS — o "que material é este" de toda a plataforma. Código e
 * unidade de item em uso não mudam (mudariam o significado das quantidades);
 * desativar tira o item de demanda nova sem apagar a história.
 */
export function ItemCatalog() {
  const resource = useResource<Payload>('/api/supply/items?inactive=1');
  return <Resource {...resource}>{(data) => <Catalog data={data} refresh={resource.refresh} />}</Resource>;
}

function Catalog({ data, refresh }: { data: Payload; refresh: () => void }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const rows = useMemo(() => data.items.filter((i) => !search
    || norm([i.code, i.description, i.category, i.brand, i.manufacturer].filter(Boolean).join(' ')).includes(norm(search))), [data, search]);
  const active = data.items.filter((i) => i.active).length;
  return (
    <Plane flush title="Catálogo de itens" count={active}
      subtitle={`${active} ${active === 1 ? 'ativo' : 'ativos'} de ${data.items.length} — o requisito de material aponta para cá, nunca para um nome livre`}
      action={data.capabilities.manage ? <button type="button" className="ax-btn primary sm" onClick={() => setEditing('new')}><Plus size={14} aria-hidden />Novo item</button> : undefined}
      bar={<SearchBox value={search} onChange={setSearch} placeholder="Código, descrição, categoria, marca" label="Buscar no catálogo" />}>
      {data.items.length === 0 ? (
        <EmptyState title="Nenhum item cadastrado">Cadastre os materiais para que o Planejamento aponte demanda para itens, e não para nomes livres.</EmptyState>
      ) : rows.length === 0 ? <EmptyState compact title="Nada encontrado">Mude a busca.</EmptyState> : (
        <div className="ax-table-wrap">
          <table className="ax-table cards">
            <caption className="sr-only-ax">Itens do catálogo</caption>
            <thead><tr><th>Código</th><th>Descrição</th><th>Categoria</th><th>Unidade</th><th>Rastreio</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="lead" data-label=""><span className="strong ax-num">{i.code}</span></td>
                  <td data-label="Descrição"><div className="ax-cellstack"><span>{i.description}</span>
                    {(i.manufacturer || i.brand) && <small>{[i.manufacturer, i.brand].filter(Boolean).join(' · ')}</small>}</div></td>
                  <td data-label="Categoria">{i.category ?? '—'}</td>
                  <td data-label="Unidade">{i.unit}</td>
                  <td data-label="Rastreio">{TRACKING[i.tracking]}</td>
                  <td data-label="Situação"><Chip tone={i.active ? 'success' : 'neutral'}>{i.active ? 'Ativo' : 'Inativo'}</Chip></td>
                  <td className="num" data-label="">{data.capabilities.manage && <button type="button" className="ax-btn ghost sm" onClick={() => setEditing(i)}>Editar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ItemPanel item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </Plane>
  );
}

function ItemPanel({ item, onClose, onSaved }: { item: Item | null; onClose: () => void; onSaved: () => void }) {
  const { run, busy } = useGovernedAction(onSaved);
  const [code, setCode] = useState(item?.code ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [manufacturer, setManufacturer] = useState(item?.manufacturer ?? '');
  const [brand, setBrand] = useState(item?.brand ?? '');
  const [tracking, setTracking] = useState<Item['tracking']>(item?.tracking ?? 'NONE');
  const [active, setActive] = useState(item?.active ?? true);
  const body: Record<string, unknown> = { code: code.trim().toUpperCase(), description: description.trim(), unit: unit.trim(),
    category: category.trim() || null, manufacturer: manufacturer.trim() || null, brand: brand.trim() || null, tracking };
  if (item) body.active = active;
  const valid = code.trim() && description.trim() && unit.trim();
  return (
    <SidePanel open onClose={onClose} testId="item-form" eyebrow="Catálogo de itens" title={item ? `Item ${item.code}` : 'Novo item'}
      meta={<span>Código e unidade de item já usado em demanda não mudam — mudariam o significado das quantidades.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="ax-btn primary" disabled={!valid || busy !== null}
          onClick={() => run(item ? `item:${item.id}` : 'item:new', item ? `/api/supply/items/${item.id}` : '/api/supply/items', body,
            { title: item ? 'Item atualizado' : 'Item cadastrado' }, { idempotent: false, method: item ? 'PATCH' : 'POST' })}>
          <Busy on={busy !== null}>Salvar</Busy></button>
      </>}>
      <div className="ax-form">
        <div className="ax-field-row">
          <label className="ax-field"><span>Código</span><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CAB-35" /></label>
          <label className="ax-field"><span>Unidade</span><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="m, un, kg" /></label>
        </div>
        <label className="ax-field"><span>Descrição</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Categoria</span><input value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label className="ax-field"><span>Rastreio</span><select value={tracking} onChange={(e) => setTracking(e.target.value as Item['tracking'])}>
            <option value="NONE">Sem rastreio</option><option value="LOT">Por lote</option><option value="SERIAL">Por série</option></select></label>
        </div>
        <div className="ax-field-row">
          <label className="ax-field"><span>Fabricante</span><input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></label>
          <label className="ax-field"><span>Marca</span><input value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
        </div>
        {item && <label className="ax-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Ativo — pode receber demanda nova</label>}
      </div>
    </SidePanel>
  );
}
