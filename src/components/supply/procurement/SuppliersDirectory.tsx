'use client';

import { useMemo, useState } from 'react';
import { HudButton } from '@/components/hud';
import { SUPPLIER_STATUS_LABEL, type SupplierStatus } from '@/lib/supply/procurement';
import type { SupplierView } from '@/lib/supply/procurement-read';
import {
  DataTable, EmptyNote, GovernanceNote, LiveSep, ResourceState, StatePill, Toolbar, WorkspaceHeading, matches, useOperationsResource,
} from '@/components/operations/ui';
import '../supply.css';
import { ActModal, useInventoryAct } from '../inventory/shared';

type Payload = { ok: true; suppliers: SupplierView[]; capabilities: { manage: boolean } };
const TONE: Record<SupplierStatus, 'success' | 'info' | 'warning' | 'danger'> = {
  HOMOLOGATED: 'success', PROSPECT: 'info', SUSPENDED: 'warning', BLOCKED: 'danger',
};

/** FORNECEDORES — papel de parte canônica; homologação e restrição com motivo. */
export function SuppliersDirectory() {
  const { data, state, message, refresh } = useOperationsResource<Payload>('/api/supply/suppliers');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<'new' | SupplierView | null>(null);
  const rows = useMemo(() => (data?.suppliers ?? []).filter((s) => !search || matches(search, s.name, s.legalName, s.document, ...s.categories)),
    [data, search]);
  if (state !== 'ready' || !data) return <ResourceState state={state} message={message} />;
  const count = (st: SupplierStatus) => data.suppliers.filter((s) => s.status === st).length;
  return (
    <section className="crm-workspace ops-workspace" aria-label="Fornecedores" data-testid="suppliers-directory">
      <WorkspaceHeading eyebrow="Supply Chain · Fornecedores" title="Quem fornece, e em que condição"
        description={<><span><b>{count('HOMOLOGATED')}</b> homologado(s)</span><LiveSep /><span><b>{count('PROSPECT')}</b> em avaliação</span>
          {count('BLOCKED') + count('SUSPENDED') > 0 && <><LiveSep /><span className="crm-tone-warning"><b>{count('BLOCKED') + count('SUSPENDED')}</b> com restrição</span></>}</>}
        action={data.capabilities.manage ? <HudButton size="sm" variant="primary" onClick={() => setModal('new')}>Cadastrar fornecedor</HudButton> : undefined} />
      <Toolbar search={search} onSearch={setSearch} placeholder="Buscar nome, CNPJ ou categoria" />
      <DataTable label="Fornecedores" columns={['Fornecedor', 'Documento', 'Categorias', 'Condição padrão', 'Pedidos', 'Pontualidade', 'Situação', '']}
        count={rows.length} footer="Fornecedor é papel de uma parte canônica — o mesmo cadastro que Contratos e Finanças usam"
        empty={<EmptyNote title="Nenhum fornecedor" description="Cadastre fornecedores para convidá-los a cotar." />}>
        {rows.map((s) => (
          <tr key={s.id} data-testid="supplier-row">
            <td><b>{s.name}</b>{s.name !== s.legalName && <p className="crm-muted">{s.legalName}</p>}</td>
            <td className="tabular-nums">{s.document ?? '—'}</td>
            <td>{s.categories.join(', ') || '—'}</td>
            <td>{[s.defaultPaymentTerms, s.defaultLeadTimeDays !== null ? `${s.defaultLeadTimeDays} dia(s)` : null].filter(Boolean).join(' · ') || '—'}</td>
            <td className="tabular-nums">{s.orders}{s.openOrders ? <p className="crm-muted">{s.openOrders} em aberto</p> : null}</td>
            <td>{s.onTimeRate === null ? <span className="crm-muted">sem histórico de entrega</span> : `${Math.round(s.onTimeRate * 100)}%`}</td>
            <td><StatePill tone={TONE[s.status]}>{SUPPLIER_STATUS_LABEL[s.status]}</StatePill>{s.statusReason && <p className="crm-muted">{s.statusReason}</p>}</td>
            <td>{data.capabilities.manage && <HudButton size="sm" variant="ghost" onClick={() => setModal(s)}>Situação</HudButton>}</td>
          </tr>
        ))}
      </DataTable>
      <GovernanceNote>Suspenso ou bloqueado não é convidado a cotar nem recebe pedido emitido. Pontualidade vem dos recebimentos — nunca é estimada.</GovernanceNote>
      {modal === 'new' && <RegisterModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal && modal !== 'new' && <StatusModal s={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </section>
  );
}

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [doc, setDoc] = useState('');
  const [categories, setCategories] = useState('');
  const [terms, setTerms] = useState('');
  const [lead, setLead] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const digits = doc.replace(/\D/g, '');
  return (
    <ActModal title="Cadastrar fornecedor" subtitle="Com CNPJ já cadastrado, a parte existente é reusada — nada é duplicado." onClose={onClose}
      busy={busy} disabled={legalName.trim().length < 2 || (digits.length > 0 && digits.length !== 14)} confirmLabel="Cadastrar" testId="supplier-form"
      onConfirm={() => act('/api/supply/suppliers', { legalName: legalName.trim(), tradeName: tradeName.trim() || null,
        documentType: digits ? 'cnpj' : null, documentNumber: digits || null,
        categories: categories.split(',').map((c) => c.trim()).filter(Boolean), defaultPaymentTerms: terms.trim() || null,
        defaultLeadTimeDays: lead ? Number(lead) : null, contactName: contact.trim() || null, contactEmail: email.trim() || null },
      'Fornecedor cadastrado')}>
      <label>Razão social<input value={legalName} onChange={(e) => setLegalName(e.target.value)} /></label>
      <div className="ops-form-row">
        <label>Nome fantasia<input value={tradeName} onChange={(e) => setTradeName(e.target.value)} /></label>
        <label>CNPJ<input inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="00.000.000/0000-00" /></label>
      </div>
      <label>Categorias (separadas por vírgula)<input value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="Cabos, Estruturas" /></label>
      <div className="ops-form-row">
        <label>Condição padrão<input value={terms} onChange={(e) => setTerms(e.target.value)} /></label>
        <label>Prazo padrão (dias)<input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} /></label>
      </div>
      <div className="ops-form-row">
        <label>Contato<input value={contact} onChange={(e) => setContact(e.target.value)} /></label>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      </div>
    </ActModal>
  );
}

function StatusModal({ s, onClose, onDone }: { s: SupplierView; onClose: () => void; onDone: () => void }) {
  const { act, busy } = useInventoryAct(onDone);
  const [status, setStatus] = useState<SupplierStatus>(s.status);
  const [reason, setReason] = useState('');
  const restrict = status === 'SUSPENDED' || status === 'BLOCKED';
  return (
    <ActModal title={`Situação de ${s.name}`} onClose={onClose} busy={busy} disabled={status === s.status || (restrict && reason.trim().length < 3)}
      confirmLabel="Salvar" testId="supplier-status-form"
      onConfirm={() => act(`/api/supply/suppliers/${s.id}`, { status, reason: reason.trim() || null }, 'Situação atualizada')}>
      <label>Situação<select value={status} onChange={(e) => setStatus(e.target.value as SupplierStatus)}>
        {(Object.keys(SUPPLIER_STATUS_LABEL) as SupplierStatus[]).map((k) => <option key={k} value={k}>{SUPPLIER_STATUS_LABEL[k]}</option>)}</select></label>
      {restrict && <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
    </ActModal>
  );
}
