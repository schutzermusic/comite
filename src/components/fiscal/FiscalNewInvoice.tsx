'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FilePlus2, ShieldAlert } from 'lucide-react';
import { HudButton, HudHeader, HudInput, HudPageLayout, HudPanel, HudSelect } from '@/components/hud';
import { calculateTaxPreview } from '@/lib/fiscal/tax-preview';
import { fiscalFetch, formatFiscalCurrency } from './fiscal-ui';
import { useFiscalMasterData } from './use-fiscal-data';

const today = () => new Date().toISOString().slice(0, 10);

export function FiscalNewInvoice() {
  const router = useRouter();
  const master = useFiscalMasterData();
  const [establishmentId, setEstablishmentId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [competenceDate, setCompetenceDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [locationIbge, setLocationIbge] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [issWithheld, setIssWithheld] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const services = master.services.filter((service) => !establishmentId || service.establishment_id === establishmentId);
  const service = master.services.find((entry) => entry.id === serviceId);
  const amountCents = Math.round(Number(amount.replace(',', '.')) * 100) || 0;
  const preview = useMemo(() => service && amountCents > 0 ? calculateTaxPreview({ amountCents, issWithheld, service }) : null, [amountCents, issWithheld, service]);

  const chooseEstablishment = (id: string) => {
    setEstablishmentId(id);
    setServiceId('');
    const establishment = master.establishments.find((entry) => entry.id === id);
    if (establishment) setLocationIbge(establishment.municipality_ibge);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fiscalFetch<{ ok: true; document: { id: string } }>('/api/fiscal/documents', {
        method: 'POST',
        body: JSON.stringify({
          establishmentId,
          partyId,
          serviceCatalogId: serviceId,
          competenceDate,
          dueDate: dueDate || undefined,
          serviceLocationIbge: locationIbge,
          description,
          amountCents,
          issWithheld,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      router.push(`/fiscal/notas/${response.document.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao criar NFS-e.'); }
    finally { setSubmitting(false); }
  };

  const ready = master.establishments.length > 0 && master.recipients.length > 0 && master.services.length > 0;

  return (
    <HudPageLayout maxWidth="xl">
      <HudHeader title="Nova NFS-e" subtitle="Prepare e valide o documento antes de enviar para aprovação" icon={<FilePlus2 className="h-5 w-5" />} iconTint="#17C3B2" breadcrumbs={[{ label: 'Fiscal', href: '/fiscal' }, { label: 'Notas', href: '/fiscal/notas' }, { label: 'Nova NFS-e' }]} />
      {master.error && <HudPanel state="warning"><p className="text-sm text-ig-warning">{master.error}</p></HudPanel>}
      {!master.loading && !ready ? (
        <HudPanel state="warning" title="Onboarding fiscal incompleto" icon={<ShieldAlert className="h-4 w-4" />}>
          <p className="text-sm text-ig-fg-muted">Cadastre pelo menos um estabelecimento, uma contraparte canônica e um serviço aprovado antes de preparar a nota.</p>
          <HudButton className="mt-4" variant="primary" onClick={() => router.push('/fiscal/cadastros')}>Abrir cadastros fiscais</HudButton>
        </HudPanel>
      ) : (
        <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[1.4fr_0.7fr]">
          <div className="space-y-6">
            <HudPanel title="Operação" subtitle="Emitente, tomador e competência">
              <div className="grid gap-4 md:grid-cols-2">
                <HudSelect label="Estabelecimento emitente" value={establishmentId} onChange={chooseEstablishment} options={master.establishments.map((entry) => ({ value: entry.id, label: `${entry.legal_name} · ${entry.cnpj}` }))} />
                <HudSelect label="Tomador" value={partyId} onChange={setPartyId} options={master.recipients.map((entry) => ({ value: entry.id, label: `${entry.legal_name} · ${entry.document_normalized ?? 'sem documento'}` }))} />
                <HudInput label="Competência" type="date" value={competenceDate} onChange={(event) => setCompetenceDate(event.target.value)} required />
                <HudInput label="Vencimento financeiro" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                <HudInput label="Município da prestação · IBGE" value={locationIbge} onChange={(event) => setLocationIbge(event.target.value.replace(/\D/g, '').slice(0, 7))} required />
              </div>
            </HudPanel>
            <HudPanel title="Serviço e valores" subtitle="A tributação vem do catálogo versionado">
              <div className="space-y-4">
                <HudSelect label="Serviço fiscal" value={serviceId} onChange={(id) => { setServiceId(id); const selected = master.services.find((entry) => entry.id === id); if (selected) setIssWithheld(selected.iss_withheld_default); }} options={services.map((entry) => ({ value: entry.id, label: `${entry.code} · ${entry.description} · ISS ${entry.iss_rate}%` }))} />
                <HudInput label="Valor bruto do serviço" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" required />
                <div><label className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">Descrição discriminada</label><textarea className="mt-1.5 min-h-32 w-full rounded-lg border border-ig-border bg-ig-panel p-3 text-sm text-ig-fg-strong outline-none focus:border-ig-accent" value={description} onChange={(event) => setDescription(event.target.value)} required minLength={5} maxLength={2000} /></div>
                <label className="flex items-center gap-3 rounded-lg border border-ig-border p-3 text-sm text-ig-fg-strong"><input type="checkbox" checked={issWithheld} onChange={(event) => setIssWithheld(event.target.checked)} className="h-4 w-4 accent-ig-accent" />ISS retido pelo tomador</label>
              </div>
            </HudPanel>
          </div>
          <div className="space-y-6">
            <HudPanel title="Prévia tributária" subtitle="Estimativa; o retorno oficial é autoritativo" fullHeight>
              {preview ? <div className="space-y-3 text-xs">
                <SummaryLine label="Valor bruto" value={formatFiscalCurrency(amountCents)} />
                {preview.lines.map((line) => <SummaryLine key={line.tax_code} label={`${line.tax_code} · ${line.rate}%${line.withheld ? ' retido' : ''}`} value={formatFiscalCurrency(line.amount_cents)} />)}
                <div className="my-3 h-px bg-ig-border-subtle" />
                <SummaryLine label="Retenções" value={formatFiscalCurrency(preview.withheldTotalCents)} />
                <SummaryLine label="Valor líquido" value={formatFiscalCurrency(preview.netAmountCents)} strong />
              </div> : <p className="text-sm text-ig-fg-muted">Selecione um serviço e informe o valor.</p>}
            </HudPanel>
            {service && !service.approved_by_accountant && <HudPanel state="warning"><p className="text-xs text-ig-warning">Este serviço ainda não foi aprovado pelo contador. O rascunho poderá ser salvo, mas a aprovação da nota será bloqueada.</p></HudPanel>}
            {error && <HudPanel state="critical"><p className="text-sm text-ig-danger">{error}</p></HudPanel>}
            <HudButton type="submit" variant="primary" fullWidth isLoading={submitting} disabled={!establishmentId || !partyId || !serviceId || amountCents <= 0 || description.length < 5}>Salvar rascunho</HudButton>
          </div>
        </form>
      )}
    </HudPageLayout>
  );
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex items-center justify-between gap-3 ${strong ? 'text-sm font-bold text-ig-accent' : 'text-ig-fg-muted'}`}><span>{label}</span><span className="tabular-nums text-ig-fg-strong">{value}</span></div>;
}

