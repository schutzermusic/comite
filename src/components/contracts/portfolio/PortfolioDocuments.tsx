'use client';

import { useState } from 'react';
import { FileText, ArrowUpRight, History } from 'lucide-react';
import type { ContractGovernanceRecord } from '../contract-governance-data';
import type { ContractDocumentRow } from '@/lib/contracts/contract-service';
import { DossierDetailDrawer, DossierDisclosure, DossierSection, DossierStatus } from '../shell/DossierPrimitives';
import { PortfolioSearch, PortfolioFilters, PortfolioEmpty, matchesPortfolioSearch } from './PortfolioControls';

const STATUS = {
  uploaded: { label: 'Enviado', tone: 'unknown' }, missing: { label: 'Faltante', tone: 'attention' },
  expired: { label: 'Vencido', tone: 'critical' }, expiring_soon: { label: 'A vencer', tone: 'attention' },
  pending_approval: { label: 'Em aprovação', tone: 'attention' }, approved: { label: 'Aprovado', tone: 'positive' },
  rejected: { label: 'Rejeitado', tone: 'critical' },
} as const;
const TYPE: Record<ContractDocumentRow['document_type'], string> = {
  contract: 'Contrato', amendment: 'Aditivo', invoice: 'Nota fiscal', guarantee: 'Garantia', insurance: 'Seguro', annex: 'Anexo', purchase_order: 'Pedido de compra', certificate: 'Certificado', approval: 'Aprovação', minutes: 'Ata',
};

export function PortfolioDocuments({ records, canUploadDoc, busyId, onApprove, onSendToApproval, onReject, onOpenContract }: {
  records: ContractGovernanceRecord[]; canUploadDoc: boolean; busyId: string | null;
  onApprove: (docId: string, key: string) => void; onSendToApproval: (docId: string, key: string) => void;
  onReject: (doc: { id: string; title: string }) => void; onOpenContract: (record: ContractGovernanceRecord) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = records.flatMap((record) => (record.liveDocuments ?? []).map((doc) => ({ doc, record })));
  const selected = rows.find(({ doc }) => doc.id === selectedId);
  const pending = (doc: ContractDocumentRow) => ['missing', 'expired', 'expiring_soon', 'pending_approval', 'rejected'].includes(doc.status);
  const shown = rows.filter(({ doc, record }) => matchesPortfolioSearch(query, doc.title, record.code, record.companyName, TYPE[doc.document_type]) && (filter === 'all' || (filter === 'current' ? !doc.superseded_by_document_id : filter === 'history' ? Boolean(doc.superseded_by_document_id) : pending(doc))));
  const doc = selected?.doc;
  return <div className="space-y-5">
    <DossierSection title="Acervo documental" hint="Encontre o documento, confira a versão e acompanhe sua aprovação.">
      <PortfolioSearch value={query} onChange={setQuery} label="Buscar documento, contrato ou tipo" count={shown.length} />
      <PortfolioFilters label="Filtrar documentos" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'Todos', count: rows.length },
        { value: 'current', label: 'Versões atuais', count: rows.filter(({ doc }) => !doc.superseded_by_document_id).length },
        { value: 'pending', label: 'Requerem atenção', count: rows.filter(({ doc }) => pending(doc)).length },
        { value: 'history', label: 'Substituídos', count: rows.filter(({ doc }) => doc.superseded_by_document_id).length },
      ]} />
      {shown.length === 0 ? <PortfolioEmpty title={rows.length ? undefined : 'Nenhum documento disponível neste recorte'} description={rows.length ? undefined : 'Abra um contrato para consultar seu documento original e adicionar anexos.'} onReset={query || filter !== 'all' ? () => { setQuery(''); setFilter('all'); } : undefined} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map(({ doc, record }) => <button type="button" className="dossier-document text-left" key={doc.id} aria-haspopup="dialog" onClick={() => setSelectedId(doc.id)}>
          <div className="mb-4 flex items-center justify-between gap-2"><span className="rounded-lg bg-ig-accent-weak p-2 text-ig-accent"><FileText size={20} aria-hidden /></span><DossierStatus tone={doc.superseded_by_document_id ? 'unknown' : STATUS[doc.status].tone}>{doc.superseded_by_document_id ? 'Substituído' : STATUS[doc.status].label}</DossierStatus></div>
          <p className="dossier-row-title">{doc.title}</p><p className="dossier-meta mt-1">{record.code} · {record.companyName}</p>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-ig-border-subtle pt-3"><span className="dossier-meta">{TYPE[doc.document_type]} · v{doc.version ?? 1}</span><ArrowUpRight size={15} aria-hidden /></div>
        </button>)}
      </div>}
    </DossierSection>
    <DossierDisclosure title="Cobertura documental por contrato" count={records.length}>
      {records.length === 0 && <p className="dossier-meta">Nenhum contrato no recorte selecionado.</p>}
      {records.map((record) => <button type="button" key={record.contract.id} className="dossier-row" onClick={() => onOpenContract(record)}>
        <div className="min-w-0 flex-1"><p className="dossier-row-title">{record.code} · {record.contract.name}</p><p className="dossier-meta">{record.liveDocuments === undefined ? 'Acervo não apurado' : `${record.liveDocuments.length} documento(s) registrado(s)`}</p></div>
        <DossierStatus tone={record.liveDocuments?.some(pending) ? 'attention' : 'unknown'}>{record.liveDocuments?.some(pending) ? `${record.liveDocuments.filter(pending).length} documento(s) requer(em) atenção` : 'Completude não atestada'}</DossierStatus>
      </button>)}
    </DossierDisclosure>
    <DossierDetailDrawer isOpen={Boolean(selected)} onClose={() => setSelectedId(null)} title={doc?.title ?? 'Documento'} subtitle={selected ? `${selected.record.code} · ${TYPE[selected.doc.document_type]}` : undefined} footer={selected ? <button type="button" className="portfolio-action" onClick={() => { setSelectedId(null); onOpenContract(selected.record); }}>Abrir contrato e documentos <ArrowUpRight size={14} /></button> : undefined}>
      {doc && <div className="space-y-6">
        <DossierStatus tone={STATUS[doc.status].tone}>{STATUS[doc.status].label}</DossierStatus>
        <dl className="grid grid-cols-2 gap-4"><div><dt className="dossier-meta">Versão</dt><dd>v{doc.version ?? 1}{doc.superseded_by_document_id ? ' · substituída' : ' · atual'}</dd></div><div><dt className="dossier-meta">Assinatura</dt><dd>Não apurada neste registro</dd></div><div><dt className="dossier-meta">Adicionado em</dt><dd>{new Date(doc.created_at).toLocaleDateString('pt-BR')}</dd></div><div><dt className="dossier-meta">Aprovação</dt><dd>{doc.approved_at ? new Date(doc.approved_at).toLocaleDateString('pt-BR') : 'Sem data registrada'}</dd></div></dl>
        {(doc.supersedes_document_id || doc.superseded_by_document_id) && <div className="rounded-lg border border-ig-border-default p-3"><p className="flex items-center gap-2 font-semibold"><History size={15} /> Histórico de versão</p>{doc.supersedes_document_id && <p className="dossier-meta mt-2">Substitui: {rows.find((r) => r.doc.id === doc.supersedes_document_id)?.doc.title ?? 'Documento anterior'}</p>}{doc.superseded_by_document_id && <p className="dossier-meta mt-2">Substituído por: {rows.find((r) => r.doc.id === doc.superseded_by_document_id)?.doc.title ?? 'Nova versão registrada'}</p>}</div>}
        {doc.rejection_reason && <div className="rounded-lg border border-ig-danger/30 p-3"><p className="font-semibold">Motivo da rejeição</p><p className="dossier-meta mt-1">{doc.rejection_reason}</p></div>}
        {canUploadDoc && !doc.superseded_by_document_id && <div className="flex flex-wrap gap-2 border-t border-ig-border-subtle pt-4">
          {!['pending_approval', 'approved', 'rejected'].includes(doc.status) && <button type="button" className="portfolio-action" disabled={busyId !== null} onClick={() => onSendToApproval(doc.id, `tab-docp-${doc.id}`)}>Enviar para aprovação</button>}
          {doc.status !== 'approved' && <button type="button" className="portfolio-action" disabled={busyId !== null} onClick={() => onApprove(doc.id, `tab-doca-${doc.id}`)}>Aprovar documento</button>}
          {doc.status !== 'rejected' && <button type="button" className="portfolio-action" disabled={busyId !== null} onClick={() => { setSelectedId(null); onReject({ id: doc.id, title: doc.title }); }}>Rejeitar documento</button>}
        </div>}
      </div>}
    </DossierDetailDrawer>
  </div>;
}
