'use client';

import { useMemo, useState } from 'react';
import { Plus, ShieldAlert } from 'lucide-react';
import { SUPPLIER_STATUS_LABEL, type SupplierStatus } from '@/lib/supply/procurement';
import type { SupplierDetailModel, SupplierView } from '@/lib/supply/procurement-read';
import {
  ApexFindingsView, AxPage, Busy, Chip, CommandHeader, EmptyState, Filters, KV, Meter, Plane, Resource, SearchBox, Section, SidePanel, SignalStrip,
  dateShort, dateTime, href, money, pct, plural, qty, useApexSignals, useGovernedAction, useResource, useUrlParam, useUrlParams, type Tone,
} from '@/components/ax';

type Payload = { ok: true; suppliers: SupplierView[]; capabilities: { manage: boolean } };
type Detail = SupplierDetailModel & { ok: true; supplier: SupplierView };
type Filter = 'all' | SupplierStatus | 'open';
const TONE: Record<SupplierStatus, Tone> = { HOMOLOGATED: 'success', PROSPECT: 'info', SUSPENDED: 'warning', BLOCKED: 'danger' };
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const rateTone = (r: number | null): Tone | undefined => (r === null ? undefined : r >= 0.9 ? 'success' : r >= 0.7 ? 'warning' : 'danger');

/**
 * FORNECEDORES — quem fornece, em que condição, e como ENTREGA (medido nos
 * recebimentos, nunca estimado). Fornecedor é papel de uma parte canônica —
 * o mesmo cadastro de Contratos e Finanças. O painel é o fornecedor 360.
 */
export function SuppliersDirectory() {
  const resource = useResource<Payload>('/api/supply/suppliers');
  return (
    <AxPage testId="suppliers-directory">
      <Resource {...resource}>{(data) => <Directory data={data} refresh={resource.refresh} />}</Resource>
    </AxPage>
  );
}

function Directory({ data, refresh }: { data: Payload; refresh: () => void }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openId] = useUrlParam<string>('supplier', '');
  const patch = useUrlParams();
  const [registering, setRegistering] = useState(false);
  const s = data.suppliers;
  const count = (st: SupplierStatus) => s.filter((x) => x.status === st).length;
  const measured = s.filter((x) => x.deliveryLines > 0);
  const avgRate = measured.length ? measured.reduce((a, x) => a + (x.onTimeRate ?? 0) * x.deliveryLines, 0) / measured.reduce((a, x) => a + x.deliveryLines, 0) : null;
  const rows = useMemo(() => s
    .filter((x) => filter === 'all' || (filter === 'open' ? x.openOrders > 0 : x.status === filter))
    .filter((x) => !search || norm([x.name, x.legalName, x.document, ...x.categories].filter(Boolean).join(' ')).includes(norm(search))),
  [s, filter, search]);

  return (
    <>
      <CommandHeader domain="supply" area="Fornecedores" title="Fornecedores"
        context={<>
          <span><strong>{count('HOMOLOGATED')}</strong> {count('HOMOLOGATED') === 1 ? 'homologado' : 'homologados'}</span>
          <span><strong>{count('PROSPECT')}</strong> em avaliação</span>
          {count('SUSPENDED') + count('BLOCKED') > 0 && <span className="ax-warn-text"><strong>{count('SUSPENDED') + count('BLOCKED')}</strong> com restrição</span>}
        </>}
        actions={data.capabilities.manage ? <button type="button" className="ax-btn primary" onClick={() => setRegistering(true)}>
          <Plus size={15} aria-hidden />Cadastrar fornecedor</button> : undefined} />

      <SignalStrip label="Sinais dos fornecedores" items={[
        { label: 'Homologados', value: count('HOMOLOGATED'), hint: 'podem cotar e receber pedido', onClick: () => setFilter('HOMOLOGATED') },
        { label: 'Em avaliação', value: count('PROSPECT'), hint: 'cotam; homologar antes de repetir', onClick: () => setFilter('PROSPECT') },
        { label: 'Com restrição', value: count('SUSPENDED') + count('BLOCKED'), hint: 'não cotam nem recebem pedido emitido',
          tone: count('SUSPENDED') + count('BLOCKED') ? 'warning' : undefined, onClick: () => setFilter('SUSPENDED') },
        { label: 'Com pedido aberto', value: s.filter((x) => x.openOrders > 0).length, hint: 'entregas a acompanhar', onClick: () => setFilter('open') },
        { label: 'Pontualidade', value: avgRate === null ? '—' : pct(avgRate), hint: measured.length ? `ponderada em ${plural(measured.reduce((a, x) => a + x.deliveryLines, 0), 'linha medida', 'linhas medidas')}` : 'sem recebimento medido',
          tone: rateTone(avgRate) === 'danger' ? 'danger' : rateTone(avgRate) === 'warning' ? 'warning' : undefined },
      ]} />

      <Plane flush title="Cadastro" count={rows.length} subtitle="Suspenso ou bloqueado não é convidado a cotar nem recebe pedido emitido"
        bar={<div className="ax-toolbar">
          <Filters<Filter> label="Recorte" value={filter} onChange={setFilter} options={[
            { id: 'all', label: 'Todos', count: s.length },
            ...(['HOMOLOGATED', 'PROSPECT', 'SUSPENDED', 'BLOCKED'] as SupplierStatus[]).filter((st) => count(st)).map((st) => ({ id: st, label: SUPPLIER_STATUS_LABEL[st], count: count(st) })),
            { id: 'open', label: 'Com pedido aberto', count: s.filter((x) => x.openOrders > 0).length },
          ]} />
          <SearchBox value={search} onChange={setSearch} placeholder="Nome, CNPJ ou categoria" label="Buscar fornecedor" />
        </div>}>
        {rows.length === 0 ? <EmptyState title={s.length ? 'Nada neste recorte' : 'Nenhum fornecedor'}>
          {s.length ? 'Mude o recorte ou a busca.' : 'Cadastre fornecedores para convidá-los a cotar.'}</EmptyState> : (
          <div className="ax-queue">
            {rows.map((x) => (
              <div key={x.id} className="ax-row no-owner" data-tone={TONE[x.status]} data-testid="supplier-row">
                <div className="ax-row-main">
                  <span className="ax-row-eyebrow"><span className="ax-kind">{SUPPLIER_STATUS_LABEL[x.status]}</span>
                    <span className="ax-row-where">{x.categories.join(', ') || 'sem categoria'}{x.document ? ` · CNPJ ${x.document}` : ''}</span></span>
                  <button type="button" className="ax-rowlink ax-row-object" onClick={() => patch({ supplier: x.id })}>
                    {x.name}{x.name !== x.legalName && <span className="ax-subtle"> · {x.legalName}</span>}</button>
                  <span className="ax-row-issue">
                    {[plural(x.orders, 'pedido', 'pedidos'), x.openOrders ? `${x.openOrders} em aberto` : null,
                      [x.defaultPaymentTerms, x.defaultLeadTimeDays !== null ? `prazo usual ${x.defaultLeadTimeDays} d` : null].filter(Boolean).join(' · ') || null,
                      x.statusReason].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="ax-cellstack">
                  {x.onTimeRate === null ? <small>sem histórico</small> : <>
                    <span className="ax-num">{pct(x.onTimeRate)} no prazo</span>
                    <Meter value={x.onTimeRate} tone={rateTone(x.onTimeRate)} label={`${x.name}: ${pct(x.onTimeRate)} no prazo`} />
                  </>}
                </div>
                <div className="ax-row-actions"><button type="button" className="ax-btn sm" onClick={() => patch({ supplier: x.id })}>Abrir</button></div>
              </div>
            ))}
          </div>
        )}
      </Plane>
      <p className="ax-note">Pontualidade = linhas recebidas até a data prometida (promessa da linha, ou do pedido), medida nos recebimentos — nunca estimada.</p>

      {openId && <SupplierPanel id={openId} canManage={data.capabilities.manage} onClose={() => patch({ supplier: null })} onChanged={refresh} />}
      {registering && <RegisterPanel onClose={() => setRegistering(false)} onDone={() => { setRegistering(false); refresh(); }} />}
    </>
  );
}

function SupplierPanel({ id, canManage, onClose, onChanged }: { id: string; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const detail = useResource<Detail>(`/api/supply/suppliers/${id}`);
  const apex = useApexSignals();
  const [status, setStatus] = useState(false);
  const d = detail.data;
  const sup = d?.supplier;
  const findings = { ...apex, data: apex.data ? { ...apex.data, signals: apex.data.signals.filter((x) => x.supplierId === id) } : apex.data };
  return (
    <SidePanel open onClose={onClose} wide testId="supplier-360" eyebrow="Fornecedor 360" title={sup?.name ?? 'Fornecedor'}
      meta={sup ? <><Chip tone={TONE[sup.status]}>{SUPPLIER_STATUS_LABEL[sup.status]}</Chip><span>{sup.legalName}</span>{sup.document && <span>CNPJ {sup.document}</span>}</> : undefined}
      footer={canManage && sup ? <button type="button" className="ax-btn" onClick={() => setStatus(true)}><ShieldAlert size={14} aria-hidden />Mudar situação</button> : undefined}>
      <Resource {...detail}>{(x) => (
        <>
          <Section title="Como entrega">
            <div className="ax-kpis">
              <div><span>Pontualidade</span><strong>{x.supplier.onTimeRate === null ? '—' : pct(x.supplier.onTimeRate)}</strong>
                <small>{x.supplier.deliveryLines ? plural(x.supplier.deliveryLines, 'linha medida', 'linhas medidas') : 'sem histórico'}</small></div>
              <div><span>Atraso médio</span><strong>{x.supplier.avgDelayDays === null ? '—' : `${x.supplier.avgDelayDays.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} d`}</strong>
                <small>quando atrasa</small></div>
              <div><span>Com rejeição</span><strong>{x.supplier.rejectionLines}</strong><small>de {plural(x.supplier.receivedLines, 'linha recebida', 'linhas recebidas')}</small></div>
              <div><span>Pedidos</span><strong>{x.supplier.orders}</strong><small>{x.supplier.openOrders} em aberto</small></div>
            </div>
          </Section>
          {findings.data && findings.data.signals.some((s) => s.status === 'OPEN') && (
            <ApexFindingsView source={findings as typeof apex} limit={3} title="Apex — sobre este fornecedor" />
          )}
          <Section title="Pedidos">
            {x.orders.length === 0 ? <p className="ax-muted" style={{ margin: 0 }}>Nenhum pedido ainda.</p> : (
              <ul className="ax-loclist">
                {x.orders.slice(0, 10).map((o) => (
                  <li key={o.id}><span><a className="ax-link" href={href.purchaseOrder(o.id)}>{o.number}</a><br />
                    <small className={o.late ? 'ax-danger-text' : 'ax-subtle'}>{o.project} · {o.promise ? `promessa ${dateShort(o.promise)}` : 'sem data'}{o.late ? ' · atrasado' : ''}</small></span>
                    <em>{qty(o.received)} de {qty(o.ordered)} recebido</em><strong>{money(o.total, o.currency)}</strong></li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Cotações">
            {x.quotes.length === 0 ? <p className="ax-muted" style={{ margin: 0 }}>Não participou de cotações.</p> : (
              <ul className="ax-loclist">
                {x.quotes.slice(0, 10).map((q) => (
                  <li key={q.id}><span><a className="ax-link" href={href.rfq(q.rfqId)}>{q.rfqNumber}</a> <small className="ax-subtle">v{q.version} · {dateShort(q.recordedAt.slice(0, 10))}</small></span>
                    <em>{q.outcome === 'won' ? <Chip tone="success" quiet>ganhou</Chip> : q.outcome === 'lost' ? <Chip tone="neutral" quiet>não escolhida</Chip> : q.outcome === 'open' ? <Chip tone="info" quiet>em aberto</Chip> : <Chip tone="neutral" quiet>encerrada</Chip>}</em>
                    <strong>{money(q.value, q.currency)}</strong></li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Recebimentos recentes">
            {x.receipts.length === 0 ? <p className="ax-muted" style={{ margin: 0 }}>Nenhum recebimento ainda.</p> : (
              <ul className="ax-loclist">
                {x.receipts.map((r) => (
                  <li key={r.id}><span><a className="ax-link" href={href.receipt(r.id)}>{r.number}</a> <small className="ax-subtle">pedido {r.orderNumber} · {dateTime(r.receivedAt)}</small></span>
                    <em className={r.rejected ? 'ax-danger-text' : undefined}>{r.rejected ? `${qty(r.rejected)} rejeitado(s)` : 'sem rejeição'}</em><strong>+{qty(r.accepted)}</strong></li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Cadastro e condição">
            <KV items={[
              ['Categorias', x.supplier.categories.join(', ') || '—'],
              ['Condição padrão', x.supplier.defaultPaymentTerms ?? '—'],
              ['Prazo usual', x.supplier.defaultLeadTimeDays !== null ? `${x.supplier.defaultLeadTimeDays} dias` : '—'],
              ['Contato', [x.supplier.contactName, x.supplier.contactEmail, x.supplier.contactPhone].filter(Boolean).join(' · ') || '—'],
              ...(x.supplier.statusReason ? [['Motivo da situação', x.supplier.statusReason] as [string, string]] : []),
            ]} />
          </Section>
        </>
      )}</Resource>
      {status && sup && <StatusPanel s={sup} onClose={() => setStatus(false)} onDone={() => { setStatus(false); detail.refresh(); onChanged(); }} />}
    </SidePanel>
  );
}

function RegisterPanel({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
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
    <SidePanel open onClose={onClose} testId="supplier-form" eyebrow="Fornecedores" title="Cadastrar fornecedor"
      meta={<span>Com CNPJ já cadastrado, a parte existente é reusada — nada é duplicado.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={legalName.trim().length < 2 || (digits.length > 0 && digits.length !== 14) || busy !== null}
          onClick={() => run('supplier', '/api/supply/suppliers', { legalName: legalName.trim(), tradeName: tradeName.trim() || null,
            documentType: digits ? 'cnpj' : null, documentNumber: digits || null, categories: categories.split(',').map((c) => c.trim()).filter(Boolean),
            defaultPaymentTerms: terms.trim() || null, defaultLeadTimeDays: lead ? Number(lead) : null, contactName: contact.trim() || null,
            contactEmail: email.trim() || null }, { title: 'Fornecedor cadastrado' }, { idempotent: false })}>
          <Busy on={busy !== null}>Cadastrar</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Razão social</span><input value={legalName} onChange={(e) => setLegalName(e.target.value)} /></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Nome fantasia</span><input value={tradeName} onChange={(e) => setTradeName(e.target.value)} /></label>
          <label className="ax-field"><span>CNPJ</span><input inputMode="numeric" value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="00.000.000/0000-00" />
            {digits.length > 0 && digits.length !== 14 && <small className="error">CNPJ tem 14 dígitos.</small>}</label>
        </div>
        <label className="ax-field"><span>Categorias (separadas por vírgula)</span><input value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="Cabos, Estruturas" /></label>
        <div className="ax-field-row">
          <label className="ax-field"><span>Condição padrão</span><input value={terms} onChange={(e) => setTerms(e.target.value)} /></label>
          <label className="ax-field"><span>Prazo padrão (dias)</span><input inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} /></label>
        </div>
        <div className="ax-field-row">
          <label className="ax-field"><span>Contato</span><input value={contact} onChange={(e) => setContact(e.target.value)} /></label>
          <label className="ax-field"><span>E-mail</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        </div>
      </div>
    </SidePanel>
  );
}

function StatusPanel({ s, onClose, onDone }: { s: SupplierView; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useGovernedAction(onDone);
  const [status, setStatus] = useState<SupplierStatus>(s.status);
  const [reason, setReason] = useState('');
  const restrict = status === 'SUSPENDED' || status === 'BLOCKED';
  return (
    <SidePanel open onClose={onClose} testId="supplier-status-form" eyebrow={s.name} title="Situação do fornecedor"
      meta={<span>Restringir exige motivo — e o fornecedor deixa de ser convidado e de receber pedido emitido.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose}>Voltar</button>
        <button type="button" className="ax-btn primary" disabled={status === s.status || (restrict && reason.trim().length < 3) || busy !== null}
          onClick={() => run(`supplier-status:${s.id}`, `/api/supply/suppliers/${s.id}`, { status, reason: reason.trim() || null },
            { title: 'Situação atualizada' }, { idempotent: false })}>
          <Busy on={busy !== null}>Salvar</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Situação</span><select value={status} onChange={(e) => setStatus(e.target.value as SupplierStatus)}>
          {(Object.keys(SUPPLIER_STATUS_LABEL) as SupplierStatus[]).map((k) => <option key={k} value={k}>{SUPPLIER_STATUS_LABEL[k]}</option>)}</select></label>
        {restrict && <label className="ax-field"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      </div>
    </SidePanel>
  );
}
