'use client';

import { useState, type FormEvent } from 'react';
import { BookOpenCheck, Building2, Plus, UsersRound } from 'lucide-react';
import { HudButton, HudHeader, HudInput, HudPageLayout, HudPanel, HudSelect } from '@/components/hud';
import { fiscalFetch } from './fiscal-ui';
import { useFiscalMasterData } from './use-fiscal-data';

type Tab = 'establishments' | 'parties' | 'services';

function field(form: FormData, key: string) { return String(form.get(key) ?? '').trim(); }
function optional(form: FormData, key: string) { return field(form, key) || undefined; }
function numeric(form: FormData, key: string) { return Number(field(form, key).replace(',', '.')) || 0; }

export function FiscalRegistrations() {
  const master = useFiscalMasterData();
  const [tab, setTab] = useState<Tab>('establishments');
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true); setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      if (tab === 'establishments') await fiscalFetch('/api/fiscal/establishments', { method: 'POST', body: JSON.stringify({
        legalName: field(form, 'legalName'), tradeName: optional(form, 'tradeName'), cnpj: field(form, 'cnpj'), municipalRegistration: field(form, 'municipalRegistration'), stateRegistration: optional(form, 'stateRegistration'),
        taxRegime: field(form, 'taxRegime'), municipalityIbge: field(form, 'municipalityIbge'), municipalityName: field(form, 'municipalityName'), uf: field(form, 'uf'), postalCode: field(form, 'postalCode'), street: field(form, 'street'), streetNumber: field(form, 'streetNumber'), complement: optional(form, 'complement'), district: field(form, 'district'), environment: field(form, 'environment'), nfseSeries: field(form, 'nfseSeries'),
      }) });
      if (tab === 'parties') await fiscalFetch('/api/fiscal/parties', { method: 'POST', body: JSON.stringify({
        legalName: field(form, 'legalName'), tradeName: optional(form, 'tradeName'), documentType: field(form, 'documentType'), documentNumber: field(form, 'documentNumber'), municipalRegistration: optional(form, 'municipalRegistration'), stateRegistration: optional(form, 'stateRegistration'), email: optional(form, 'email'), phone: optional(form, 'phone'), municipalityIbge: optional(form, 'municipalityIbge'), municipalityName: optional(form, 'municipalityName'), uf: optional(form, 'uf'), countryCode: field(form, 'countryCode') || 'BR', postalCode: optional(form, 'postalCode'), street: optional(form, 'street'), streetNumber: optional(form, 'streetNumber'), district: optional(form, 'district'),
      }) });
      if (tab === 'services') await fiscalFetch('/api/fiscal/services', { method: 'POST', body: JSON.stringify({
        establishmentId: field(form, 'establishmentId'), code: field(form, 'code'), description: field(form, 'description'), lc116Code: field(form, 'lc116Code'), nbsCode: optional(form, 'nbsCode'), municipalServiceCode: field(form, 'municipalServiceCode'), cnaeCode: optional(form, 'cnaeCode'), issRate: numeric(form, 'issRate'), pisRate: numeric(form, 'pisRate'), cofinsRate: numeric(form, 'cofinsRate'), inssRate: numeric(form, 'inssRate'), irRate: numeric(form, 'irRate'), csllRate: numeric(form, 'csllRate'), ibsRate: numeric(form, 'ibsRate'), cbsRate: numeric(form, 'cbsRate'), issWithheldDefault: form.get('issWithheldDefault') === 'on', effectiveFrom: field(form, 'effectiveFrom'), version: numeric(form, 'version') || 1, approvedByAccountant: form.get('approvedByAccountant') === 'on',
      }) });
      event.currentTarget.reset();
      setMessage('Cadastro fiscal salvo com sucesso.');
      setShowForm(false);
      await master.refresh();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Falha ao salvar cadastro.'); }
    finally { setSubmitting(false); }
  };

  const counts = { establishments: master.establishments.length, parties: master.parties.length, services: master.services.length };

  return (
    <HudPageLayout>
      <HudHeader title="Cadastros Fiscais" subtitle="Estabelecimentos, tomadores e catálogo tributário versionado" icon={<BookOpenCheck className="h-5 w-5" />} iconTint="#17C3B2" breadcrumbs={[{ label: 'Fiscal', href: '/fiscal' }, { label: 'Cadastros Fiscais' }]} />
      <div className="grid gap-3 md:grid-cols-3">
        <TabButton active={tab === 'establishments'} onClick={() => { setTab('establishments'); setShowForm(false); }} icon={<Building2 />} label="Estabelecimentos" count={counts.establishments} />
        <TabButton active={tab === 'parties'} onClick={() => { setTab('parties'); setShowForm(false); }} icon={<UsersRound />} label="Tomadores" count={counts.parties} />
        <TabButton active={tab === 'services'} onClick={() => { setTab('services'); setShowForm(false); }} icon={<BookOpenCheck />} label="Serviços" count={counts.services} />
      </div>
      {master.error && <HudPanel state="warning"><p className="text-sm text-ig-warning">{master.error}</p></HudPanel>}
      {message && <HudPanel state={/sucesso/i.test(message) ? 'success' : 'warning'}><p className="text-sm">{message}</p></HudPanel>}
      <HudPanel title={tab === 'establishments' ? 'Estabelecimentos emitentes' : tab === 'parties' ? 'Tomadores de serviço' : 'Catálogo de serviços'} headerActions={<HudButton size="sm" variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowForm((value) => !value)}>{showForm ? 'Fechar' : 'Adicionar'}</HudButton>}>
        {showForm && <form onSubmit={submit} className="mb-6 rounded-xl border border-ig-border bg-ig-panel p-4">
          {tab === 'establishments' && <EstablishmentFields />}
          {tab === 'parties' && <PartyFields />}
          {tab === 'services' && <ServiceFields establishments={master.establishments.map((entry) => ({ value: entry.id, label: entry.legal_name }))} />}
          <div className="mt-4 flex justify-end"><HudButton type="submit" variant="primary" isLoading={submitting}>Salvar cadastro</HudButton></div>
        </form>}
        {master.loading ? <p className="py-8 text-center text-sm text-ig-fg-muted">Carregando…</p> : tab === 'establishments' ? <EstablishmentList rows={master.establishments} /> : tab === 'parties' ? <PartyList rows={master.parties} /> : <ServiceList rows={master.services} />}
      </HudPanel>
    </HudPageLayout>
  );
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return <button type="button" onClick={onClick} className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${active ? 'border-ig-accent bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)] text-ig-accent' : 'border-ig-border bg-ig-panel text-ig-fg-muted'}`}><span className="[&_svg]:h-5 [&_svg]:w-5">{icon}</span><span className="flex-1 text-sm font-semibold">{label}</span><span className="rounded-full border border-current/20 px-2 py-0.5 text-xs">{count}</span></button>;
}

function NativeInput({ name, label, required = false, type = 'text', defaultValue }: { name: string; label: string; required?: boolean; type?: string; defaultValue?: string }) {
  return <HudInput name={name} label={label} required={required} type={type} defaultValue={defaultValue} />;
}

function EstablishmentFields() {
  return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"><NativeInput name="legalName" label="Razão social" required /><NativeInput name="tradeName" label="Nome fantasia" /><NativeInput name="cnpj" label="CNPJ" required /><NativeInput name="municipalRegistration" label="Inscrição municipal" required /><NativeInput name="stateRegistration" label="Inscrição estadual" /><label className="flex flex-col gap-1.5"><span className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Regime tributário</span><select name="taxRegime" defaultValue="simples_nacional" className="h-10 rounded-lg border border-ig-border bg-ig-panel px-3 text-sm"><option value="mei">MEI</option><option value="simples_nacional">Simples Nacional</option><option value="lucro_presumido">Lucro Presumido</option><option value="lucro_real">Lucro Real</option><option value="other">Outro</option></select></label><NativeInput name="municipalityIbge" label="Código IBGE" required /><NativeInput name="municipalityName" label="Município" required /><NativeInput name="uf" label="UF" required /><NativeInput name="postalCode" label="CEP" required /><NativeInput name="street" label="Logradouro" required /><NativeInput name="streetNumber" label="Número" required /><NativeInput name="complement" label="Complemento" /><NativeInput name="district" label="Bairro" required /><label className="flex flex-col gap-1.5"><span className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Ambiente</span><select name="environment" defaultValue="homologation" className="h-10 rounded-lg border border-ig-border bg-ig-panel px-3 text-sm"><option value="homologation">Homologação</option><option value="production">Produção bloqueada</option></select></label><NativeInput name="nfseSeries" label="Série DPS" required defaultValue="1" /></div>;
}

function PartyFields() {
  return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"><NativeInput name="legalName" label="Razão social / nome" required /><NativeInput name="tradeName" label="Nome fantasia" /><label className="flex flex-col gap-1.5"><span className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Documento</span><select name="documentType" defaultValue="cnpj" className="h-10 rounded-lg border border-ig-border bg-ig-panel px-3 text-sm"><option value="cnpj">CNPJ</option><option value="cpf">CPF</option><option value="foreign">Exterior</option></select></label><NativeInput name="documentNumber" label="Número do documento" required /><NativeInput name="municipalRegistration" label="Inscrição municipal" /><NativeInput name="stateRegistration" label="Inscrição estadual" /><NativeInput name="email" label="E-mail fiscal" type="email" /><NativeInput name="phone" label="Telefone" /><NativeInput name="municipalityIbge" label="Código IBGE" /><NativeInput name="municipalityName" label="Município" /><NativeInput name="uf" label="UF" /><NativeInput name="countryCode" label="País ISO2" defaultValue="BR" /><NativeInput name="postalCode" label="CEP" /><NativeInput name="street" label="Logradouro" /><NativeInput name="streetNumber" label="Número" /><NativeInput name="district" label="Bairro" /></div>;
}

function ServiceFields({ establishments }: { establishments: Array<{ value: string; label: string }> }) {
  return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"><label className="flex flex-col gap-1.5"><span className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Estabelecimento</span><select name="establishmentId" required className="h-10 rounded-lg border border-ig-border bg-ig-panel px-3 text-sm"><option value="">Selecionar…</option>{establishments.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select></label><NativeInput name="code" label="Código interno" required /><NativeInput name="description" label="Descrição" required /><NativeInput name="lc116Code" label="Item LC 116" required /><NativeInput name="nbsCode" label="NBS" /><NativeInput name="municipalServiceCode" label="Código municipal" required /><NativeInput name="cnaeCode" label="CNAE" /><NativeInput name="issRate" label="ISS %" required defaultValue="2" /><NativeInput name="pisRate" label="PIS retido %" defaultValue="0" /><NativeInput name="cofinsRate" label="COFINS retido %" defaultValue="0" /><NativeInput name="inssRate" label="INSS retido %" defaultValue="0" /><NativeInput name="irRate" label="IRRF retido %" defaultValue="0" /><NativeInput name="csllRate" label="CSLL retida %" defaultValue="0" /><NativeInput name="ibsRate" label="IBS %" defaultValue="0" /><NativeInput name="cbsRate" label="CBS %" defaultValue="0" /><NativeInput name="effectiveFrom" label="Vigência inicial" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /><NativeInput name="version" label="Versão" defaultValue="1" /><label className="flex items-center gap-2 self-end rounded-lg border border-ig-border p-3 text-xs"><input name="issWithheldDefault" type="checkbox" className="accent-ig-accent" />ISS retido por padrão</label><label className="flex items-center gap-2 self-end rounded-lg border border-ig-border p-3 text-xs"><input name="approvedByAccountant" type="checkbox" className="accent-ig-accent" />Parâmetros aprovados pelo contador</label></div>;
}

function EstablishmentList({ rows }: { rows: ReturnType<typeof useFiscalMasterData>['establishments'] }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-ig-fg-muted">Nenhum estabelecimento cadastrado.</p>;
  return <div className="grid gap-3 md:grid-cols-2">{rows.map((row) => <div key={row.id} className="rounded-xl border border-ig-border p-4"><div className="flex items-start justify-between"><div><p className="font-semibold text-ig-fg-strong">{row.legal_name}</p><p className="mt-1 text-xs text-ig-fg-muted">CNPJ {row.cnpj} · IM {row.municipal_registration}</p></div><span className="rounded-full border border-ig-border px-2 py-1 text-[10px] text-ig-fg-muted">{row.environment}</span></div><p className="mt-3 text-xs text-ig-fg-muted">{row.municipality_name}/{row.uf} · Série {row.nfse_series}</p></div>)}</div>;
}
function PartyList({ rows }: { rows: ReturnType<typeof useFiscalMasterData>['parties'] }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-ig-fg-muted">Nenhum tomador cadastrado.</p>;
  return <div className="grid gap-3 md:grid-cols-2">{rows.map((row) => <div key={row.id} className="rounded-xl border border-ig-border p-4"><p className="font-semibold text-ig-fg-strong">{row.legal_name}</p><p className="mt-1 text-xs text-ig-fg-muted">{row.document_type.toUpperCase()} {row.document_number}</p><p className="mt-3 text-xs text-ig-fg-muted">{row.municipality_name ? `${row.municipality_name}/${row.uf}` : 'Endereço fiscal pendente'} · {row.email ?? 'sem e-mail'}</p></div>)}</div>;
}
function ServiceList({ rows }: { rows: ReturnType<typeof useFiscalMasterData>['services'] }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-ig-fg-muted">Nenhum serviço fiscal cadastrado.</p>;
  return <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase text-ig-fg-muted"><tr><th className="pb-3">Código</th><th className="pb-3">Serviço</th><th className="pb-3">LC 116</th><th className="pb-3">ISS</th><th className="pb-3">Vigência</th><th className="pb-3">Validação</th></tr></thead><tbody className="divide-y divide-ig-border-subtle">{rows.map((row) => <tr key={row.id}><td className="py-3 font-semibold text-ig-accent">{row.code}</td><td className="py-3 text-ig-fg-strong">{row.description}</td><td className="py-3 text-ig-fg-muted">{row.lc116_code}</td><td className="py-3 tabular-nums">{row.iss_rate}%</td><td className="py-3 text-ig-fg-muted">{row.effective_from}</td><td className="py-3"><span className={row.approved_by_accountant ? 'text-ig-success' : 'text-ig-warning'}>{row.approved_by_accountant ? 'Contador aprovou' : 'Aguardando contador'}</span></td></tr>)}</tbody></table></div>;
}

