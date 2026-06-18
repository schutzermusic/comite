'use client';

/**
 * Shared contract action modals — replaces the old window.prompt() flows with
 * proper HUD modals, and centralizes the logic that was duplicated between the
 * contracts list page and the dedicated dossier page.
 *
 * Usage:
 *   const { actions, modals } = useContractActionModals({ projects, onRefresh });
 *   ...render {modals} once near the page root...
 *   ...pass actions.linkProject etc. as (record) => void callbacks...
 */

import { useState } from 'react';
import { HudModal, HudButton, HudInput, HudSelect } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import type { Project } from '@/lib/types';
import type { ContractGovernanceRecord } from './contract-governance-data';
import {
  linkContractToProject,
  createAgendaTaskForContract,
  createRiskFromContract,
  uploadContractDocument,
  updateContract,
  submitContractApproval,
} from '@/lib/contracts/contract-service';
import { format } from 'date-fns';

type ActionKind = 'link' | 'task' | 'risk' | 'doc' | 'legal';

const DOC_TYPES = [
  { value: 'contract', label: 'Contrato assinado' },
  { value: 'amendment', label: 'Aditivo' },
  { value: 'invoice', label: 'Nota / fatura' },
  { value: 'guarantee', label: 'Garantia bancária' },
  { value: 'insurance', label: 'Apólice de seguro' },
  { value: 'annex', label: 'Anexo' },
  { value: 'purchase_order', label: 'Ordem de compra' },
  { value: 'certificate', label: 'Certidão' },
  { value: 'approval', label: 'Aprovação' },
  { value: 'minutes', label: 'Ata' },
];

const RISK_CATEGORIES = [
  { value: 'Financeiro', label: 'Financeiro' },
  { value: 'Operacional', label: 'Operacional' },
  { value: 'Legal', label: 'Legal' },
  { value: 'SLA', label: 'SLA' },
];

const SCALE_1_5 = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));

export interface ContractActions {
  linkProject: (record: ContractGovernanceRecord) => void;
  createTask: (record: ContractGovernanceRecord) => void;
  createRisk: (record: ContractGovernanceRecord) => void;
  attachDocument: (record: ContractGovernanceRecord) => void;
  sendToLegal: (record: ContractGovernanceRecord) => void;
}

export function useContractActionModals({
  projects,
  onRefresh,
}: {
  projects: Project[];
  onRefresh: () => Promise<void> | void;
}): { actions: ContractActions; modals: React.ReactNode } {
  const { notify } = useHudToast();
  const [kind, setKind] = useState<ActionKind | null>(null);
  const [record, setRecord] = useState<ContractGovernanceRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [category, setCategory] = useState('Legal');
  const [probability, setProbability] = useState('3');
  const [impact, setImpact] = useState('3');
  const [mitigation, setMitigation] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docType, setDocType] = useState('insurance');
  const [docFile, setDocFile] = useState<File | null>(null);
  const [legalNote, setLegalNote] = useState('');

  const open = (next: ActionKind, target: ContractGovernanceRecord) => {
    setRecord(target);
    setProjectId('');
    setTitle('');
    setDueDate(format(new Date(), 'yyyy-MM-dd'));
    setCategory('Legal');
    setProbability('3');
    setImpact('3');
    setMitigation('');
    setDocTitle('');
    setDocType('insurance');
    setDocFile(null);
    setLegalNote('Solicitação de revisão jurídica manual.');
    setKind(next);
  };

  const close = () => {
    if (submitting) return;
    setKind(null);
    setRecord(null);
  };

  const actions: ContractActions = {
    linkProject: (target) => open('link', target),
    createTask: (target) => open('task', target),
    createRisk: (target) => open('risk', target),
    attachDocument: (target) => open('doc', target),
    sendToLegal: (target) => open('legal', target),
  };

  async function run(task: () => Promise<void>, successTitle: string, successMessage: string) {
    setSubmitting(true);
    try {
      await task();
      await onRefresh();
      notify(successTitle, { description: successMessage, variant: 'success' });
      setKind(null);
      setRecord(null);
    } catch (err) {
      notify('Não foi possível concluir', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  const submitLink = () => {
    if (!record || !projectId) return;
    const project = projects.find((p) => p.id === projectId);
    run(
      () => linkContractToProject(record.contract.id, projectId).then(() => undefined),
      'Projeto vinculado',
      `Contrato vinculado ao projeto ${project?.codigo ?? ''}.`,
    );
  };

  const submitTask = () => {
    if (!record || !title.trim() || !dueDate) return;
    run(
      () =>
        createAgendaTaskForContract(
          record.contract.id,
          title.trim(),
          `Tarefa de controle para o contrato ${record.code}`,
          `${dueDate}T23:59:59`,
          record.contract.responsibleId || null,
        ).then(() => undefined),
      'Tarefa criada',
      `Tarefa "${title.trim()}" adicionada à agenda.`,
    );
  };

  const submitRisk = () => {
    if (!record || !title.trim()) return;
    run(
      () =>
        createRiskFromContract(record.contract.id, title.trim(), category, Number(probability), Number(impact), mitigation.trim() || undefined).then(
          () => undefined,
        ),
      'Risco criado',
      `Risco "${title.trim()}" criado e vinculado ao contrato.`,
    );
  };

  const submitDoc = () => {
    if (!record || !docTitle.trim()) return;
    const file = docFile ?? new File(['placeholder'], 'documento.pdf', { type: 'application/pdf' });
    run(
      () => uploadContractDocument(record.contract.id, docTitle.trim(), file, docType).then(() => undefined),
      'Documento anexado',
      `Documento "${docTitle.trim()}" anexado com sucesso.`,
    );
  };

  const submitLegal = () => {
    if (!record) return;
    run(async () => {
      await updateContract(record.contract.id, { status: 'legal_review', lifecycleStage: 'legal_review' });
      await submitContractApproval(record.contract.id, 'juridico', 'under_review', legalNote.trim() || null);
    }, 'Enviado ao jurídico', 'Contrato encaminhado para o fluxo de revisão jurídica.');
  };

  const submitByKind: Record<ActionKind, () => void> = {
    link: submitLink,
    task: submitTask,
    risk: submitRisk,
    doc: submitDoc,
    legal: submitLegal,
  };

  const titles: Record<ActionKind, { title: string; cta: string }> = {
    link: { title: 'Vincular projeto', cta: 'Vincular' },
    task: { title: 'Criar tarefa de agenda', cta: 'Criar tarefa' },
    risk: { title: 'Criar risco contratual', cta: 'Criar risco' },
    doc: { title: 'Anexar documento', cta: 'Anexar' },
    legal: { title: 'Enviar para revisão jurídica', cta: 'Enviar' },
  };

  const textareaClass =
    'w-full rounded-lg border hud-input-bg hud-text p-3 text-sm leading-relaxed focus:border-ig-border-focus focus:outline-none';

  const modals = (
    <HudModal
      isOpen={kind !== null}
      onClose={close}
      size="md"
      title={kind ? titles[kind].title : ''}
      subtitle={record ? `${record.code} · ${record.companyName}` : undefined}
      footer={
        <>
          <HudButton variant="ghost" size="sm" onClick={close} disabled={submitting}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" size="sm" isLoading={submitting} onClick={() => kind && submitByKind[kind]()}>
            {kind ? titles[kind].cta : ''}
          </HudButton>
        </>
      }
    >
      {kind === 'link' && (
        <div className="space-y-4">
          {projects.length === 0 ? (
            <p className="text-sm text-ig-fg-muted">Nenhum projeto disponível para vincular.</p>
          ) : (
            <HudSelect
              label="Projeto"
              value={projectId}
              onChange={setProjectId}
              placeholder="Selecione um projeto"
              options={projects.slice(0, 200).map((p) => ({ value: p.id, label: `${p.codigo} · ${p.nome}` }))}
            />
          )}
          <p className="text-[11px] text-ig-fg-muted">O contrato permanece como fonte de governança; o projeto recebe o vínculo de execução.</p>
        </div>
      )}

      {kind === 'task' && (
        <div className="space-y-4">
          <HudInput label="Título da tarefa" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Revisar gatilho de renovação" />
          <HudInput label="Vencimento" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <p className="text-[11px] text-ig-fg-muted">Atribuída ao responsável interno do contrato quando disponível.</p>
        </div>
      )}

      {kind === 'risk' && (
        <div className="space-y-4">
          <HudInput label="Título do risco" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Disputa sobre cláusula penal de SLA" />
          <HudSelect label="Categoria" value={category} onChange={setCategory} options={RISK_CATEGORIES} />
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label="Probabilidade (1-5)" value={probability} onChange={setProbability} options={SCALE_1_5} />
            <HudSelect label="Impacto (1-5)" value={impact} onChange={setImpact} options={SCALE_1_5} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Plano de mitigação</label>
            <textarea className={textareaClass} rows={3} value={mitigation} onChange={(e) => setMitigation(e.target.value)} placeholder="Ação de mitigação proposta" />
          </div>
        </div>
      )}

      {kind === 'doc' && (
        <div className="space-y-4">
          <HudInput label="Título do documento" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Ex: Apólice de seguro" />
          <HudSelect label="Tipo" value={docType} onChange={setDocType} options={DOC_TYPES} />
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Arquivo (opcional)</label>
            <input
              type="file"
              onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border hud-input-bg p-2 text-sm text-ig-fg-muted file:mr-3 file:rounded-md file:border-0 file:bg-ig-accent-weak file:px-3 file:py-1.5 file:text-ig-accent"
            />
            <p className="text-[11px] text-ig-fg-muted">Sem arquivo selecionado, um marcador é registrado no repositório para acompanhamento.</p>
          </div>
        </div>
      )}

      {kind === 'legal' && record && (
        <div className="space-y-4">
          <p className="text-sm text-ig-fg-muted">
            O contrato <span className="font-semibold text-ig-fg-strong">{record.code}</span> será movido para <span className="font-semibold text-ig-fg-strong">Revisão jurídica</span> e uma etapa de aprovação será aberta.
          </p>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Observação</label>
            <textarea className={textareaClass} rows={3} value={legalNote} onChange={(e) => setLegalNote(e.target.value)} />
          </div>
        </div>
      )}
    </HudModal>
  );

  return { actions, modals };
}
