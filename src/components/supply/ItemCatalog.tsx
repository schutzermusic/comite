'use client';

import { useMemo, useState } from 'react';
import { HudButton, HudModal, useHudToast } from '@/components/hud';
import {
  DataTable, EmptyNote, Panel, ResourceState, StatePill, Toolbar, matches, useOperationsResource,
} from '@/components/operations/ui';

type Item = { id: string; code: string; description: string; category: string | null; unit: string;
  manufacturer: string | null; brand: string | null; tracking: 'NONE' | 'LOT' | 'SERIAL'; active: boolean };
type Payload = { ok: true; items: Item[]; capabilities: { manage: boolean } };

const TRACKING: Record<Item['tracking'], string> = { NONE: 'Sem rastreio', LOT: 'Por lote', SERIAL: 'Por série' };

/**
 * CATÁLOGO DE ITENS — o "que material é este" de toda a plataforma. Código e
 * unidade de item em uso não mudam; desativar tira o item de demanda nova
 * sem apagar a história.
 */
export function ItemCatalog() {
  const { data, state, message, refresh } = useOperationsResource<Payload>('/api/supply/items?inactive=1');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const { success, error: notifyError } = useHudToast();
  const rows = useMemo(() => (data?.items ?? []).filter((i) => !search || matches(search, i.code, i.description, i.category, i.brand)),
    [data, search]);
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;

  const save = async (body: Record<string, unknown>) => {
    const isNew = editing === 'new';
    const response = await fetch(isNew ? '/api/supply/items' : `/api/supply/items/${(editing as Item).id}`, {
      method: isNew ? 'POST' : 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) { notifyError('Item recusado', payload?.error); return; }
    success(isNew ? 'Item cadastrado' : 'Item atualizado');
    setEditing(null); refresh();
  };

  return (
    <Panel title="Catálogo de itens" note={`${data.items.filter((i) => i.active).length} ativo(s) · ${data.items.length} no total`}
      aside={data.capabilities.manage ? <HudButton variant="primary" size="sm" onClick={() => setEditing('new')}>Novo item</HudButton> : undefined}>
      <div style={{ padding: '10px 14px 0' }}>
        <Toolbar search={search} onSearch={setSearch} placeholder="Buscar código, descrição, categoria ou marca" />
      </div>
      <DataTable label="Itens" columns={['Código', 'Descrição', 'Categoria', 'Unidade', 'Rastreio', 'Situação', '']} count={rows.length}
        footer="Cadastro canônico — o requisito de material aponta para cá"
        empty={<EmptyNote title="Nenhum item cadastrado" description="Cadastre os materiais para que o Planejamento aponte demanda para itens, e não para nomes livres." />}>
        {rows.map((i) => (
          <tr key={i.id}>
            <td className="tabular-nums"><b>{i.code}</b></td>
            <td>{i.description}{(i.manufacturer || i.brand) && <p className="crm-muted">{[i.manufacturer, i.brand].filter(Boolean).join(' · ')}</p>}</td>
            <td>{i.category ?? '—'}</td>
            <td>{i.unit}</td>
            <td>{TRACKING[i.tracking]}</td>
            <td><StatePill tone={i.active ? 'success' : 'neutral'}>{i.active ? 'Ativo' : 'Inativo'}</StatePill></td>
            <td>{data.capabilities.manage && <HudButton variant="ghost" size="sm" onClick={() => setEditing(i)}>Editar</HudButton>}</td>
          </tr>
        ))}
      </DataTable>
      {editing && <ItemModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={save} />}
    </Panel>
  );
}

function ItemModal({ item, onClose, onSave }: { item: Item | null; onClose: () => void; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [code, setCode] = useState(item?.code ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [manufacturer, setManufacturer] = useState(item?.manufacturer ?? '');
  const [brand, setBrand] = useState(item?.brand ?? '');
  const [tracking, setTracking] = useState<Item['tracking']>(item?.tracking ?? 'NONE');
  const [active, setActive] = useState(item?.active ?? true);
  const [busy, setBusy] = useState(false);
  const body: Record<string, unknown> = { code: code.trim().toUpperCase(), description: description.trim(), unit: unit.trim(),
    category: category.trim() || null, manufacturer: manufacturer.trim() || null, brand: brand.trim() || null, tracking };
  if (item) body.active = active;
  return (
    <HudModal isOpen onClose={onClose} size="md" title={item ? `Item ${item.code}` : 'Novo item'}
      subtitle="Código e unidade de item já usado em demanda não mudam — mudariam o significado das quantidades."
      footer={<div className="flex justify-end gap-2"><HudButton variant="ghost" onClick={onClose}>Cancelar</HudButton>
        <HudButton variant="primary" disabled={busy || !code.trim() || !description.trim() || !unit.trim()}
          onClick={async () => { setBusy(true); try { await onSave(body); } finally { setBusy(false); } }}>Salvar</HudButton></div>}>
      <div className="ops-form" data-testid="item-form">
        <div className="ops-form-row">
          <label>Código<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CAB-35" /></label>
          <label>Unidade<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="m, un, kg" /></label>
        </div>
        <label>Descrição<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="ops-form-row">
          <label>Categoria<input value={category} onChange={(e) => setCategory(e.target.value)} /></label>
          <label>Rastreio<select value={tracking} onChange={(e) => setTracking(e.target.value as Item['tracking'])}>
            <option value="NONE">Sem rastreio</option><option value="LOT">Por lote</option><option value="SERIAL">Por série</option></select></label>
        </div>
        <div className="ops-form-row">
          <label>Fabricante<input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></label>
          <label>Marca<input value={brand} onChange={(e) => setBrand(e.target.value)} /></label>
        </div>
        {item && <label className="flex-row items-center"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 'auto' }} /> Ativo</label>}
      </div>
    </HudModal>
  );
}
