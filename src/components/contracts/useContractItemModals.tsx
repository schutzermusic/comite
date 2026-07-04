'use client';

/**
 * Phase 5 — premium item-action modals for the Contract Dossier Drawer.
 *
 * Replaces the Phase 4 window.prompt() flows with Glass HUD modals for:
 *  - rejecting a document (reason required + optional notes)
 *  - marking a billing event realized (realized date + optional reference/note)
 *  - completing an obligation (optional note + optional follow-up task)
 *
 * Each submit reuses the existing audited service mutations and calls onSuccess
 * (the drawer's refresh) so the drawer stays open and governance data refreshes.
 */

import { useState } from 'react';
import { HudModal, HudButton, HudInput } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import {
  completeContractObligation,
  markBillingEventRealized,
  updateContractDocumentStatus,
  createTaskFromObligation,
} from '@/lib/contracts/contract-service';
import { format } from 'date-fns';

type RejectDocTarget = { kind: 'rejectDoc'; id: string; label: string };
type RealizeBillingTarget = { kind: 'realizeBilling'; id: string; label: string };
type CompleteObligationTarget = { kind: 'completeObligation'; id: string; label: string; contractId: string; ownerUserId: string | null; dueDate: string | null };
type ItemTarget = RejectDocTarget | RealizeBillingTarget | CompleteObligationTarget;

const textareaClass =
  'w-full rounded-lg border hud-input-bg hud-text p-3 text-sm leading-relaxed focus:border-ig-border-focus focus:outline-none';

export interface ContractItemModals {
  openRejectDoc: (doc: { id: string; title: string }) => void;
  openRealizeBilling: (event: { id: string; title: string }) => void;
  openCompleteObligation: (obligation: { id: string; title: string; contract_id: string; owner_user_id: string | null; due_date: string | null }) => void;
  modals: React.ReactNode;
}

export function useContractItemModals({ onSuccess }: { onSuccess: () => Promise<void> | void }): ContractItemModals {
  const { notify } = useHudToast();
  const [target, setTarget] = useState<ItemTarget | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [realizedDate, setRealizedDate] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [followUp, setFollowUp] = useState(false);

  const today = () => format(new Date(), 'yyyy-MM-dd');

  const openRejectDoc: ContractItemModals['openRejectDoc'] = (doc) => {
    setReason('');
    setNotes('');
    setTarget({ kind: 'rejectDoc', id: doc.id, label: doc.title });
  };

  const openRealizeBilling: ContractItemModals['openRealizeBilling'] = (event) => {
    setRealizedDate(today());
    setReference('');
    setNote('');
    setTarget({ kind: 'realizeBilling', id: event.id, label: event.title });
  };

  const openCompleteObligation: ContractItemModals['openCompleteObligation'] = (obligation) => {
    setNote('');
    setFollowUp(false);
    setTarget({
      kind: 'completeObligation',
      id: obligation.id,
      label: obligation.title,
      contractId: obligation.contract_id,
      ownerUserId: obligation.owner_user_id,
      dueDate: obligation.due_date,
    });
  };

  const close = () => {
    if (submitting) return;
    setTarget(null);
  };

  async function run(task: () => Promise<void>, successMessage: string) {
    setSubmitting(true);
    try {
      await task();
      await onSuccess();
      notify(successMessage, { variant: 'success' });
      setTarget(null);
    } catch (err) {
      notify('Não foi possível concluir', { description: err instanceof Error ? err.message : 'Erro inesperado.', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  const submit = () => {
    if (!target) return;
    if (target.kind === 'rejectDoc') {
      if (!reason.trim()) return;
      const fullReason = [reason.trim(), notes.trim()].filter(Boolean).join(' — ');
      run(() => updateContractDocumentStatus(target.id, 'rejected', fullReason).then(() => undefined), 'Documento rejeitado');
    } else if (target.kind === 'realizeBilling') {
      run(
        () =>
          markBillingEventRealized(target.id, {
            paidAt: realizedDate ? `${realizedDate}T12:00:00` : undefined,
            reference: reference.trim() || null,
            note: note.trim() || null,
          }).then(() => undefined),
        'Faturamento marcado como realizado',
      );
    } else {
      run(async () => {
        await completeContractObligation(target.id, note.trim() || null);
        if (followUp) {
          await createTaskFromObligation(
            target.contractId,
            target.label,
            `${target.dueDate ?? today()}T23:59:59`,
            target.ownerUserId,
          );
        }
      }, 'Obrigação concluída');
    }
  };

  const titles: Record<ItemTarget['kind'], { title: string; cta: string }> = {
    rejectDoc: { title: 'Rejeitar documento', cta: 'Rejeitar' },
    realizeBilling: { title: 'Marcar faturamento realizado', cta: 'Confirmar' },
    completeObligation: { title: 'Concluir obrigação', cta: 'Concluir' },
  };

  const modals = (
    <HudModal
      isOpen={target !== null}
      onClose={close}
      size="md"
      title={target ? titles[target.kind].title : ''}
      subtitle={target?.label}
      footer={
        <>
          <HudButton variant="ghost" size="sm" onClick={close} disabled={submitting}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" size="sm" isLoading={submitting} onClick={submit}>
            {target ? titles[target.kind].cta : ''}
          </HudButton>
        </>
      }
    >
      {target?.kind === 'rejectDoc' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Motivo da rejeição (obrigatório)</label>
            <textarea className={textareaClass} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Descreva o motivo da rejeição" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Observações (opcional)</label>
            <textarea className={textareaClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas adicionais" />
          </div>
        </div>
      )}

      {target?.kind === 'realizeBilling' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Data de realização" type="date" value={realizedDate} onChange={(e) => setRealizedDate(e.target.value)} />
            <HudInput label="Referência / NF (opcional)" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: NF 12345" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Observação (opcional)</label>
            <textarea className={textareaClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota de faturamento" />
          </div>
          <p className="text-[11px] text-ig-fg-muted">Referência e observação ficam registradas na auditoria (sem coluna dedicada por enquanto).</p>
        </div>
      )}

      {target?.kind === 'completeObligation' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Nota de conclusão (opcional)</label>
            <textarea className={textareaClass} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex: evidência anexada e validada" />
          </div>
          <label className="flex items-center gap-2 text-sm text-ig-fg-strong">
            <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="h-4 w-4 rounded border-ig-border-strong" />
            Criar tarefa de follow-up na agenda
          </label>
        </div>
      )}
    </HudModal>
  );

  return { openRejectDoc, openRealizeBilling, openCompleteObligation, modals };
}
