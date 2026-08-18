'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Receipt, Search } from 'lucide-react';
import { HudHeader, HudInput, HudPageLayout, HudPanel } from '@/components/hud';
import type { FiscalDocumentStatus } from '@/lib/fiscal/types';
import { FiscalEmptyState, FiscalPrimaryLink, FiscalStatusBadge, formatFiscalCurrency } from './fiscal-ui';
import { useFiscalDocuments } from './use-fiscal-data';

export function FiscalDocuments() {
  const { documents, loading, error } = useFiscalDocuments();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<FiscalDocumentStatus | 'all'>('all');
  const filtered = useMemo(() => documents.filter((document) => {
    if (status !== 'all' && document.status !== status) return false;
    const q = search.trim().toLowerCase();
    return !q || document.description.toLowerCase().includes(q) || document.document_number?.includes(q) || document.access_key?.includes(q);
  }), [documents, search, status]);
  return (
    <HudPageLayout>
      <HudHeader title="Notas de Serviço" subtitle="Carteira, transmissão e acompanhamento de NFS-e" icon={<Receipt className="h-5 w-5" />} iconTint="#17C3B2" breadcrumbs={[{ label: 'Fiscal', href: '/fiscal' }, { label: 'Notas de Serviço' }]} actions={<FiscalPrimaryLink href="/fiscal/notas/nova">Nova NFS-e</FiscalPrimaryLink>} />
      <HudPanel>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <HudInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar número, chave ou descrição" leftIcon={<Search className="h-4 w-4" />} />
          <div className="flex flex-wrap gap-2">
            {(['all','draft','pending_approval','approved','authorized','rejected','cancelled'] as const).map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`rounded-lg border px-3 py-2 text-xs ${status === value ? 'border-ig-accent bg-[color-mix(in_oklab,var(--ig-accent)_12%,transparent)] text-ig-accent' : 'border-ig-border text-ig-fg-muted'}`}>{value === 'all' ? 'Todas' : value.replaceAll('_', ' ')}</button>)}
          </div>
        </div>
      </HudPanel>
      <HudPanel title={`Documentos (${filtered.length})`} noPadding>
        {error ? <p className="p-5 text-sm text-ig-danger">{error}</p> : loading ? <p className="p-8 text-center text-sm text-ig-fg-muted">Carregando…</p> : filtered.length === 0 ? <div className="p-5"><FiscalEmptyState title="Nenhum documento encontrado" description="Ajuste os filtros ou crie uma nova NFS-e." /></div> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="border-b border-ig-border-subtle text-[10px] uppercase tracking-wider text-ig-fg-muted"><tr><th className="px-5 py-3">NFS-e</th><th className="px-5 py-3">Descrição</th><th className="px-5 py-3">Competência</th><th className="px-5 py-3">Bruto</th><th className="px-5 py-3">Líquido</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Financeiro</th></tr></thead><tbody className="divide-y divide-ig-border-subtle">{filtered.map((document) => <tr key={document.id} className="hover:bg-ig-panel-hover"><td className="px-5 py-4"><Link href={`/fiscal/notas/${document.id}`} className="font-semibold text-ig-accent">{document.document_number ?? 'Rascunho'}</Link></td><td className="max-w-[300px] truncate px-5 py-4 text-ig-fg-strong">{document.description}</td><td className="px-5 py-4 text-ig-fg-muted">{document.competence_date}</td><td className="px-5 py-4 tabular-nums">{formatFiscalCurrency(document.service_amount_cents)}</td><td className="px-5 py-4 tabular-nums">{formatFiscalCurrency(document.net_amount_cents)}</td><td className="px-5 py-4"><FiscalStatusBadge status={document.status} /></td><td className="px-5 py-4 text-ig-fg-muted">{document.finance_status.replaceAll('_', ' ')}</td></tr>)}</tbody></table></div>
        )}
      </HudPanel>
    </HudPageLayout>
  );
}

