'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, CheckCircle2, CopyPlus, Download, FileCheck2, Radio, Receipt, Send, ShieldAlert } from 'lucide-react';
import { HudButton, HudHeader, HudPageLayout, HudPanel } from '@/components/hud';
import type { FiscalDocument, FiscalEvent, FiscalTaxLine } from '@/lib/fiscal/types';
import { FiscalStatusBadge, fiscalFetch, formatFiscalCurrency } from './fiscal-ui';

interface Bundle { document: FiscalDocument; taxes: FiscalTaxLine[]; events: FiscalEvent[] }

export function FiscalDocumentDetail({ id }: { id: string }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setBundle(await fiscalFetch<{ ok: true } & Bundle>(`/api/fiscal/documents/${id}`)); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao carregar documento.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void refresh(); }, [refresh]);

  const action = async (name: 'submit' | 'approve' | 'transmit' | 'cancel' | 'replace') => {
    let reason: string | undefined;
    if (name === 'cancel') {
      reason = window.prompt('Informe a justificativa fiscal do cancelamento (mínimo 15 caracteres):') ?? undefined;
      if (!reason) return;
    }
    setProcessing(true); setError(null);
    try {
      const response = await fiscalFetch<{ ok: true; document?: { id: string } }>(`/api/fiscal/documents/${id}/${name}`, { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), reason }) });
      if (name === 'replace' && response.document?.id) {
        router.push(`/fiscal/notas/${response.document.id}`);
        return;
      }
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha na ação fiscal.'); }
    finally { setProcessing(false); }
  };

  if (loading) return <HudPageLayout><p className="p-10 text-center text-sm text-ig-fg-muted">Carregando documento fiscal…</p></HudPageLayout>;
  if (!bundle) return <HudPageLayout><HudPanel state="critical"><p className="text-sm text-ig-danger">{error ?? 'Documento não encontrado.'}</p></HudPanel></HudPageLayout>;
  const { document, taxes, events } = bundle;
  const recipient = document.recipient_snapshot as { legal_name?: string; document_number?: string };
  const issuer = document.issuer_snapshot as { legal_name?: string; cnpj?: string };
  return (
    <HudPageLayout>
      <HudHeader title={document.document_number ? `NFS-e ${document.document_number}` : 'Rascunho de NFS-e'} subtitle={`${recipient.legal_name ?? 'Tomador'} · ${document.competence_date}`} icon={<Receipt className="h-5 w-5" />} iconTint="#17C3B2" breadcrumbs={[{ label: 'Fiscal', href: '/fiscal' }, { label: 'Notas', href: '/fiscal/notas' }, { label: document.document_number ?? 'Rascunho' }]} statusChips={[{ label: document.status.replaceAll('_', ' '), variant: document.status === 'authorized' ? 'success' : document.status === 'rejected' ? 'critical' : 'info' }]} actions={<div className="flex flex-wrap gap-2">{document.status === 'draft' && <HudButton variant="primary" leftIcon={<Send className="h-4 w-4" />} isLoading={processing} onClick={() => action('submit')}>Enviar para aprovação</HudButton>}{document.status === 'pending_approval' && <HudButton variant="primary" leftIcon={<CheckCircle2 className="h-4 w-4" />} isLoading={processing} onClick={() => action('approve')}>Aprovar</HudButton>}{document.status === 'approved' && <HudButton variant="primary" leftIcon={<Radio className="h-4 w-4" />} isLoading={processing} onClick={() => action('transmit')}>Transmitir</HudButton>}{document.status === 'authorized' && <><HudButton variant="secondary" leftIcon={<CopyPlus className="h-4 w-4" />} isLoading={processing} onClick={() => action('replace')}>Preparar substituição</HudButton><HudButton variant="danger" leftIcon={<Ban className="h-4 w-4" />} isLoading={processing} onClick={() => action('cancel')}>Cancelar</HudButton></>}</div>} />
      {error && <HudPanel state="warning"><p className="text-sm text-ig-warning">{error}</p></HudPanel>}
      {document.rejection_message && <HudPanel state="critical" title={`Rejeição ${document.rejection_code ?? ''}`} icon={<ShieldAlert className="h-4 w-4" />}><p className="text-sm text-ig-danger">{document.rejection_message}</p></HudPanel>}
      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.75fr]">
        <div className="space-y-6">
          <HudPanel title="Documento" icon={<FileCheck2 className="h-4 w-4" />}>
            <div className="grid gap-4 text-xs md:grid-cols-2 lg:grid-cols-3"><Info label="Status"><FiscalStatusBadge status={document.status} /></Info><Info label="Emitente" value={issuer.legal_name} /><Info label="CNPJ" value={issuer.cnpj} /><Info label="Tomador" value={recipient.legal_name} /><Info label="Documento" value={recipient.document_number} /><Info label="Município da prestação" value={document.service_location_ibge} /><Info label="Chave de acesso" value={document.access_key ?? 'Disponível após autorização'} wide /><Info label="Descrição" value={document.description} wide /></div>
          </HudPanel>
          <HudPanel title="Tributação" subtitle="Snapshot usado na emissão">
            <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-[10px] uppercase text-ig-fg-muted"><tr><th className="pb-3">Tributo</th><th className="pb-3">Base</th><th className="pb-3">Alíquota</th><th className="pb-3">Valor</th><th className="pb-3">Responsável</th></tr></thead><tbody className="divide-y divide-ig-border-subtle">{taxes.map((tax) => <tr key={`${tax.tax_code}-${tax.rate}`}><td className="py-3 font-semibold text-ig-fg-strong">{tax.tax_code}</td><td className="py-3">{formatFiscalCurrency(tax.tax_base_cents)}</td><td className="py-3">{tax.rate}%</td><td className="py-3">{formatFiscalCurrency(tax.amount_cents)}</td><td className="py-3 text-ig-fg-muted">{tax.responsibility === 'recipient' ? 'Tomador · retido' : 'Emitente'}</td></tr>)}</tbody></table></div>
            <div className="mt-4 grid gap-3 border-t border-ig-border-subtle pt-4 sm:grid-cols-3"><Info label="Bruto" value={formatFiscalCurrency(document.service_amount_cents)} /><Info label="Retenções" value={formatFiscalCurrency(document.withheld_total_cents)} /><Info label="Líquido" value={formatFiscalCurrency(document.net_amount_cents)} /></div>
          </HudPanel>
          <HudPanel title="Linha do tempo" subtitle="Eventos imutáveis e payload sanitizado">
            <ol className="space-y-4">{events.map((event, index) => <li key={event.id} className="relative flex gap-3"><span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ig-accent text-[9px] text-ig-accent">{index + 1}</span><div><p className="text-xs font-semibold text-ig-fg-strong">{event.event_type.replaceAll('_', ' ')}</p><p className="mt-1 text-xs text-ig-fg-muted">{event.message}</p><p className="mt-1 font-mono text-[10px] text-ig-fg-subtle">{new Date(event.created_at).toLocaleString('pt-BR')}</p></div></li>)}</ol>
          </HudPanel>
        </div>
        <div className="space-y-6">
          <HudPanel title="Arquivos fiscais" icon={<Download className="h-4 w-4" />}>
            <div className="space-y-2">{document.xml_storage_path ? <a className="flex items-center justify-between rounded-lg border border-ig-border p-3 text-xs font-semibold text-ig-accent hover:bg-ig-panel-hover" href={`/api/fiscal/documents/${document.id}/artifact/xml`}>XML autorizado <Download className="h-4 w-4" /></a> : <p className="text-xs text-ig-fg-muted">XML disponível após autorização.</p>}{document.danfse_storage_path && <a className="flex items-center justify-between rounded-lg border border-ig-border p-3 text-xs font-semibold text-ig-accent" href={`/api/fiscal/documents/${document.id}/artifact/danfse`}>DANFSe <Download className="h-4 w-4" /></a>}</div>
          </HudPanel>
          <HudPanel title="Integração financeira"><Info label="Situação" value={document.finance_status.replaceAll('_', ' ')} /><p className="mt-3 text-xs text-ig-fg-muted">Receita pelo bruto, conta a receber pelo líquido e obrigações somente do emitente.</p></HudPanel>
          <HudButton fullWidth variant="secondary" onClick={() => router.push('/fiscal/notas')}>Voltar para carteira</HudButton>
        </div>
      </div>
    </HudPageLayout>
  );
}

function Info({ label, value, children, wide = false }: { label: string; value?: string | null; children?: React.ReactNode; wide?: boolean }) {
  return <div className={wide ? 'md:col-span-2 lg:col-span-3' : ''}><p className="text-[10px] font-semibold uppercase tracking-wider text-ig-fg-muted">{label}</p><div className="mt-1 break-words text-xs font-medium text-ig-fg-strong">{children ?? value ?? '—'}</div></div>;
}
