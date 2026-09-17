'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { HudButton } from '@/components/hud';
import { InlineEmpty } from './shell';
import { DossierDetailDrawer, DossierDisclosure, DossierStatus } from './shell/DossierPrimitives';
import { obligationGroup, OBLIGATION_GROUPS } from './shell/obligation-presentation';
import type { ContractObligationsAsOf, ResolvedObligation } from '@/lib/contracts/obligations/types';

const SIDE_LABEL: Record<string, string> = {
  contracting_organization: 'Nossa responsabilidade', counterparty: 'Do cliente', supplier: 'Do fornecedor',
  third_party: 'De terceiro', shared: 'Compartilhada', unknown: 'Responsabilidade não apurada',
};
const STATE_LABEL: Record<string, string> = {
  NOT_ACTIVATED: 'Não ativada', OPEN: 'Aberta', SATISFIED: 'Concluída', WAIVED: 'Dispensada', CANCELLED: 'Cancelada', EXCEPTION: 'Exceção registrada',
};
const URGENCY_LABEL: Record<string, string> = {
  OVERDUE: 'Em atraso', DUE: 'Vence hoje', UPCOMING: 'No prazo', AWAITING_SCHEDULE_ANCHOR: 'Aguardando agenda',
  UNKNOWN: 'Prazo não apurado', NOT_APPLICABLE: 'Prazo não aplicável',
};

export function ContractStructuredObligations({ contractId, onOpenDocument }: {
  contractId: string; onOpenDocument?: (id: string, page: number | null) => void;
}) {
  const [data, setData] = useState<ContractObligationsAsOf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ResolvedObligation | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setData(null); setError(null); setSelected(null);
    (async () => {
      try {
        const response = await fetch(`/api/contracts/${contractId}/obligations`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao carregar obrigações.');
        if (!controller.signal.aborted) setData(body as ContractObligationsAsOf);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Falha ao carregar obrigações.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [contractId]);
  if (loading) return <InlineEmpty message="Carregando obrigações…" />;
  if (error) return <p role="alert" className="dossier-meta py-3">{error}</p>;
  if (!data?.obligations.length) return <InlineEmpty message="Nenhuma obrigação estruturada neste contrato" help="Cada obrigação deve indicar a cláusula, o aditivo ou o documento de origem." />;
  const instanceCount = data.obligations.reduce((count, ob) => count + ob.instances.length, 0);
  return <>
    <div className="dossier-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="dossier-meta"><strong className="text-ig-fg-strong">{data.obligations.length} definições contratuais</strong> · {instanceCount} ocorrências em acompanhamento</p>
        <DossierStatus tone={data.billingBlock.state === 'TRUE' ? 'attention' : data.billingBlock.state === 'FALSE' ? 'positive' : 'unknown'}>
          {data.billingBlock.state === 'TRUE' ? 'Bloqueio contratual de faturamento' : data.billingBlock.state === 'FALSE' ? 'Sem bloqueio por obrigações' : 'Liberação de faturamento não apurada'}
        </DossierStatus>
      </div>
      {OBLIGATION_GROUPS.map(([key, label]) => {
        const rows = data.obligations.filter((ob) => obligationGroup(ob) === key);
        if (!rows.length) return null;
        return <DossierDisclosure key={key} title={label} count={rows.length} open={key !== 'completed' && key !== 'closed'}>
          {rows.map((ob) => {
            const live = ob.instances.filter((i) => !['SATISFIED', 'WAIVED', 'CANCELLED'].includes(i.state));
            const dated = live.map((i) => i.dueDate).filter((d): d is string => !!d).sort();
            return <button key={ob.definition.id} type="button" className="dossier-row" onClick={() => setSelected(ob)} aria-haspopup="dialog">
              <div className="min-w-0 flex-1">
                <p className="dossier-row-title">{ob.definition.title}</p>
                <p className="dossier-meta mt-1">{SIDE_LABEL[ob.definition.responsibleSide]} · {ob.definition.provenance.page ? `Cláusula · p. ${ob.definition.provenance.page}` : 'Página não informada'}</p>
                {ob.definition.blocksBilling === true && <span className="mt-1 inline-block text-[11px] font-medium text-ig-warning">Pré-requisito de faturamento</span>}
              </div>
              <DossierStatus tone={live.some((i) => i.urgency === 'OVERDUE') ? 'critical' : key === 'attention' ? 'attention' : key === 'completed' ? 'positive' : 'unknown'}>
                {live.some((i) => i.urgency === 'OVERDUE') ? 'Em atraso' : key === 'completed' ? 'Concluída' : key === 'closed' ? 'Encerrada' : key === 'untracked' ? 'Sem ocorrência' : key === 'waiting' ? 'Aguardando gatilho' : dated.length ? dated[0].split('-').reverse().join('/') : 'Sem prazo apurado'}
              </DossierStatus>
              <ChevronRight className="h-4 w-4 shrink-0 text-ig-fg-muted" aria-hidden />
            </button>;
          })}
        </DossierDisclosure>;
      })}
    </div>
    <DossierDetailDrawer isOpen={!!selected} onClose={() => setSelected(null)} title={selected?.definition.title ?? ''} subtitle={selected ? SIDE_LABEL[selected.definition.responsibleSide] : undefined}
      footer={selected?.definition.provenance.documentId && onOpenDocument ? <HudButton variant="secondary" onClick={() => onOpenDocument(selected.definition.provenance.documentId!, selected.definition.provenance.page)} leftIcon={<ExternalLink className="h-4 w-4" />}>Abrir documento de origem</HudButton> : undefined}>
      {selected && <div className="space-y-5">
        <p>{selected.definition.requirementText ?? 'Descrição não informada.'}</p>
        <dl className="grid grid-cols-2 gap-4">
          <div><dt className="dossier-meta">Vigência desde</dt><dd>{selected.definition.effectiveFrom ?? 'Não apurada'}</dd></div>
          <div><dt className="dossier-meta">Aplicabilidade</dt><dd>{selected.effective === 'TRUE' ? 'Vigente' : selected.effective === 'FALSE' ? 'Não vigente nesta data' : 'Não apurada'}</dd></div>
          <div><dt className="dossier-meta">Pré-requisito de faturamento</dt><dd>{selected.definition.blocksBilling === true ? 'Previsto no contrato' : selected.definition.blocksBilling === false ? 'Não previsto' : 'Não apurado'}</dd></div>
          <div><dt className="dossier-meta">Gatilho contratual</dt><dd>{selected.definition.activationEventText ?? 'Consultar regra e cláusula de origem'}</dd></div>
        </dl>
        {selected.definition.parties.map((party) => <p key={party.id} className="dossier-meta">{party.role}: {party.partyLegalName ?? party.partyText ?? 'Parte não identificada'}</p>)}
        <section><h3 className="font-semibold">Ocorrências e evidências</h3>
          {!selected.instances.length && <InlineEmpty message="Definição registrada; nenhuma ocorrência em acompanhamento." />}
          {selected.instances.map((instance) => <div key={instance.id} className="mt-3 space-y-2 border-t border-ig-border-subtle pt-3">
            <p className="font-semibold">{instance.occurrenceKey} · {STATE_LABEL[instance.state]}</p>
            <p className="dossier-meta">{URGENCY_LABEL[instance.urgency]} · {instance.dueDate ?? instance.dueBasis ?? 'Sem prazo apurado'}</p>
            <DossierStatus tone={instance.evidenceComplete === 'TRUE' ? 'positive' : instance.evidenceComplete === 'FALSE' ? 'attention' : 'unknown'}>{instance.evidenceComplete === 'TRUE' ? 'Evidência completa' : instance.evidenceComplete === 'FALSE' ? 'Evidência pendente' : 'Evidência não apurada'}</DossierStatus>
            {instance.dependencies.map((dependency) => <p key={dependency.dependsOnDefinitionId} className="dossier-meta">Depende de: {dependency.dependsOnTitle} · {dependency.satisfied === 'TRUE' ? 'atendida' : dependency.satisfied === 'FALSE' ? 'pendente' : 'não apurada'}</p>)}
            {instance.evidence.map((evidence) => <p key={evidence.id} className="dossier-meta">{evidence.referenceText ?? 'Evidência documental'} · {evidence.acceptanceState === 'accepted' ? 'aceite registrado' : evidence.acceptanceState === 'rejected' ? 'recusada' : evidence.acceptanceState === 'not_required' ? 'aceite não exigido' : 'aguarda aceite'}</p>)}
            {instance.exceptions.filter((e) => e.effective).map((e) => <p key={e.id} className="dossier-meta">Exceção vigente: {e.reason}</p>)}
          </div>)}
        </section>
        {selected.evidenceRequirements.length > 0 && <DossierDisclosure title="Evidências exigidas" count={selected.evidenceRequirements.length}>{selected.evidenceRequirements.map((r) => <p key={r.id} className="mb-2">{r.requirementText}</p>)}</DossierDisclosure>}
        <DossierDisclosure title="Cláusula e proveniência" open>
          <p className="dossier-meta">{selected.definition.provenance.page ? `Página ${selected.definition.provenance.page}` : 'Página não informada'}</p>
          <blockquote className="mt-2 border-l-2 border-ig-border-strong pl-3">{selected.definition.provenance.excerpt ?? 'Trecho de origem não disponível.'}</blockquote>
        </DossierDisclosure>
      </div>}
    </DossierDetailDrawer>
  </>;
}
