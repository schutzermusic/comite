'use client';

import Link from 'next/link';
import { AlertTriangle, Calculator, CheckCircle2, Clock3, FileText, Receipt, ShieldCheck } from 'lucide-react';
import { HudHeader, HudKpiStrip, HudPageLayout, HudPanel } from '@/components/hud';
import { FiscalEmptyState, FiscalPrimaryLink, FiscalStatusBadge, formatFiscalCurrency } from './fiscal-ui';
import { useFiscalDocuments } from './use-fiscal-data';

export function FiscalDashboard() {
  const { documents, summary, loading, error } = useFiscalDocuments();
  const recent = documents.slice(0, 8);
  return (
    <HudPageLayout>
      <HudHeader
        title="Visão Fiscal"
        subtitle="Emissão, conformidade e integração financeira de NFS-e"
        icon={<Calculator className="h-5 w-5" />}
        iconTint="#17C3B2"
        statusChips={[{ label: 'NFS-e', variant: 'live' }, { label: 'Homologação segura', variant: 'info' }]}
        actions={<FiscalPrimaryLink href="/fiscal/notas/nova">Nova NFS-e</FiscalPrimaryLink>}
      />

      <HudKpiStrip columns={6} size="sm" kpis={[
        { id: 'authorized', label: 'Autorizadas', value: summary.authorizedCount, variant: 'success', icon: <CheckCircle2 /> },
        { id: 'pending', label: 'Pendentes', value: summary.pendingCount, variant: 'warning', icon: <Clock3 /> },
        { id: 'rejected', label: 'Rejeitadas', value: summary.rejectedCount, variant: summary.rejectedCount ? 'danger' : 'default', icon: <AlertTriangle /> },
        { id: 'gross', label: 'Faturamento', value: summary.grossAmountCents / 100, format: 'compactCurrency', variant: 'info', icon: <Receipt /> },
        { id: 'withheld', label: 'Retenções', value: summary.withheldAmountCents / 100, format: 'compactCurrency', variant: 'warning', icon: <FileText /> },
        { id: 'alerts', label: 'Alertas', value: summary.integrationAlerts, variant: summary.integrationAlerts ? 'danger' : 'success', icon: <ShieldCheck /> },
      ]} />

      {error && <HudPanel state="warning"><p className="text-sm text-ig-warning">{error}</p></HudPanel>}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_0.8fr]">
        <HudPanel title="Atividade recente" subtitle="Últimos documentos fiscais" icon={<Receipt className="h-4 w-4" />}>
          {loading ? <p className="py-8 text-center text-sm text-ig-fg-muted">Carregando documentos fiscais…</p> : recent.length === 0 ? (
            <FiscalEmptyState title="Nenhuma NFS-e cadastrada" description="Conclua os cadastros fiscais e crie o primeiro rascunho." action={<FiscalPrimaryLink href="/fiscal/cadastros">Configurar módulo</FiscalPrimaryLink>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-ig-fg-muted"><tr><th className="pb-3">Documento</th><th className="pb-3">Competência</th><th className="pb-3">Valor</th><th className="pb-3">Status</th></tr></thead>
                <tbody className="divide-y divide-ig-border-subtle">
                  {recent.map((document) => <tr key={document.id}>
                    <td className="py-3"><Link className="font-semibold text-ig-fg-strong hover:text-ig-accent" href={`/fiscal/notas/${document.id}`}>{document.document_number ? `NFS-e ${document.document_number}` : document.description}</Link></td>
                    <td className="py-3 text-ig-fg-muted">{document.competence_date}</td>
                    <td className="py-3 font-medium tabular-nums text-ig-fg-strong">{formatFiscalCurrency(document.service_amount_cents)}</td>
                    <td className="py-3"><FiscalStatusBadge status={document.status} /></td>
                  </tr>)}
                </tbody>
              </table>
            </div>
          )}
        </HudPanel>

        <HudPanel title="Controles de produção" subtitle="Portões obrigatórios antes do go-live" icon={<ShieldCheck className="h-4 w-4" />}>
          <div className="space-y-3 text-xs">
            {[
              ['Ambiente separado', 'Homologação e produção não compartilham credenciais.'],
              ['Dupla aprovação', 'Quem prepara não precisa ser quem transmite.'],
              ['Idempotência', 'Cliques e webhooks repetidos não duplicam notas.'],
              ['Snapshots imutáveis', 'Cadastro posterior não altera documento transmitido.'],
            ].map(([title, text]) => <div key={title} className="rounded-lg border border-ig-border-subtle bg-ig-panel p-3"><p className="font-semibold text-ig-fg-strong">{title}</p><p className="mt-1 text-ig-fg-muted">{text}</p></div>)}
          </div>
        </HudPanel>
      </div>
    </HudPageLayout>
  );
}

