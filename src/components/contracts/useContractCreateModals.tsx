'use client';

/**
 * Detail-page create modals — persist real contract obligations and billing
 * events to Supabase (contract_obligations / contract_billing_events).
 *
 * Lives on the dossier detail page where the persisted lists are shown, so a
 * successful create + onRefresh() reflects immediately in the Timeline / Billing
 * tabs. RBAC gating is done by the caller (only passes the openers when allowed).
 */

import { useState } from 'react';
import { HudModal, HudButton, HudInput, HudSelect } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import { createContractObligation, createContractBillingEvent } from '@/lib/contracts/contract-service';
import { format } from 'date-fns';

type CreateKind = 'obligation' | 'billing';

const OBLIGATION_STATUS = [
  { value: 'open', label: 'Em aberto' },
  { value: 'due_soon', label: 'Vence em breve' },
  { value: 'overdue', label: 'Atrasada' },
  { value: 'done', label: 'Concluída' },
];

const BILLING_STATUS = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'pago', label: 'Pago' },
];

export function useContractCreateModals({
  contractId,
  ownerUserId,
  onRefresh,
}: {
  contractId: string;
  ownerUserId: string | null;
  onRefresh: () => Promise<void> | void;
}): { openObligation: () => void; openBilling: () => void; modals: React.ReactNode } {
  const { notify } = useHudToast();
  const [kind, setKind] = useState<CreateKind | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [evidence, setEvidence] = useState('');
  const [status, setStatus] = useState('open');
  const [amount, setAmount] = useState('');

  const reset = (next: CreateKind) => {
    setTitle('');
    setDescription('');
    setDueDate(format(new Date(), 'yyyy-MM-dd'));
    setEvidence('');
    setStatus(next === 'billing' ? 'pendente' : 'open');
    setAmount('');
    setKind(next);
  };

  const close = () => {
    if (submitting) return;
    setKind(null);
  };

  async function run(task: () => Promise<void>, successMessage: string) {
    setSubmitting(true);
    try {
      await task();
      await onRefresh();
      notify('Registro criado', { description: successMessage, variant: 'success' });
      setKind(null);
    } catch (err) {
      notify('Não foi possível criar', { description: err instanceof Error ? err.message : 'Erro inesperado.', variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  }

  const submit = () => {
    if (!title.trim()) return;
    if (kind === 'obligation') {
      run(
        () =>
          createContractObligation({
            contract_id: contractId,
            title: title.trim(),
            description: description.trim() || null,
            owner_user_id: ownerUserId,
            status: status as 'open' | 'due_soon' | 'overdue' | 'done',
            due_date: dueDate || null,
            evidence: evidence.trim() || null,
          }).then(() => undefined),
        `Obrigação "${title.trim()}" registrada.`,
      );
    } else if (kind === 'billing') {
      run(
        () =>
          createContractBillingEvent({
            contractId,
            title: title.trim(),
            amount: Number(amount) || 0,
            dueDate: dueDate || null,
            status,
          }).then(() => undefined),
        `Evento de faturamento "${title.trim()}" registrado.`,
      );
    }
  };

  const textareaClass =
    'w-full rounded-lg border hud-input-bg hud-text p-3 text-sm leading-relaxed focus:border-ig-border-focus focus:outline-none';

  const modals = (
    <HudModal
      isOpen={kind !== null}
      onClose={close}
      size="md"
      title={kind === 'billing' ? 'Novo evento de faturamento' : 'Nova obrigação contratual'}
      footer={
        <>
          <HudButton variant="ghost" size="sm" onClick={close} disabled={submitting}>
            Cancelar
          </HudButton>
          <HudButton variant="primary" size="sm" isLoading={submitting} onClick={submit}>
            {kind === 'billing' ? 'Registrar evento' : 'Registrar obrigação'}
          </HudButton>
        </>
      }
    >
      {kind === 'obligation' && (
        <div className="space-y-4">
          <HudInput label="Título" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Entregar apólice de garantia" />
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wider hud-label">Descrição</label>
            <textarea className={textareaClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalhe da obrigação" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Prazo" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <HudSelect label="Situação" value={status} onChange={setStatus} options={OBLIGATION_STATUS} />
          </div>
          <HudInput label="Evidência esperada" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Ex: Aceite técnico ou medição" />
          <p className="text-[11px] text-ig-fg-muted">Atribuída ao responsável interno do contrato quando disponível.</p>
        </div>
      )}

      {kind === 'billing' && (
        <div className="space-y-4">
          <HudInput label="Título do evento" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Medição física fase 1 (40%)" />
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Valor (R$)" type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            <HudInput label="Vencimento" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <HudSelect label="Situação" value={status} onChange={setStatus} options={BILLING_STATUS} />
        </div>
      )}
    </HudModal>
  );

  return {
    openObligation: () => reset('obligation'),
    openBilling: () => reset('billing'),
    modals,
  };
}
