'use client';

/**
 * Modais de criação do dossiê — obrigação contratual e evento de faturamento.
 *
 * ─── A obrigação passou a ser ESTRUTURADA (Fase 3) ─────────────────────────
 *
 * Este modal escrevia em `contract_obligations`: título, prazo e um `status`
 * escolhido à mão. A partir da Fase 3 ele grava uma DEFINIÇÃO canônica, e a
 * diferença aparece no formulário — a origem virou obrigatória.
 *
 * Origem obrigatória não é burocracia: uma obrigação sem cláusula, aditivo ou
 * documento que a sustente é uma anotação, e o banco recusa a linha
 * (`cod_has_provenance`). Pedi-la aqui transforma a recusa numa escolha
 * consciente em vez de num erro no fim do envio.
 *
 * O `status` escolhido à mão saiu junto. Urgência é DERIVADA do prazo e da data
 * de referência; deixar alguém marcar "atrasada" numa obrigação que vence mês
 * que vem produzia um estado que nada mantinha verdadeiro.
 */

import { useState } from 'react';
import { HudModal, HudButton, HudInput, HudSelect } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import { createContractBillingEvent } from '@/lib/contracts/contract-service';
import { format } from 'date-fns';

type CreateKind = 'obligation' | 'billing';

/** Quem o contrato obriga. Não é o responsável interno — esse é outra coisa. */
const RESPONSIBLE_SIDE = [
  { value: 'contracting_organization', label: 'Nós (organização contratante)' },
  { value: 'counterparty', label: 'Cliente / contraparte' },
  { value: 'supplier', label: 'Fornecedor' },
  { value: 'third_party', label: 'Terceiro' },
  { value: 'shared', label: 'Compartilhada' },
  { value: 'unknown', label: 'Não apurado' },
];

const RECURRENCE = [
  { value: 'one_time', label: 'Uma vez' },
  { value: 'monthly', label: 'Mensal' },
  { value: 'quarterly', label: 'Trimestral' },
  { value: 'yearly', label: 'Anual' },
];

/**
 * Três valores, e o terceiro é o padrão de propósito: marcar "não bloqueia"
 * sem ter lido o contrato é afirmar algo que ninguém apurou.
 */
const BLOCKS_BILLING = [
  { value: 'unknown', label: 'Não apurado' },
  { value: 'true', label: 'Sim — pré-requisito de faturamento' },
  { value: 'false', label: 'Não bloqueia faturamento' },
];

const BILLING_STATUS = [
  { value: 'pendente', label: 'Pendente' },
  { value: 'pago', label: 'Pago' },
];

export interface ObligationOrigin {
  /** `clause:<id>` ou `document:<id>` — a origem contratual da obrigação. */
  readonly value: string;
  readonly label: string;
}

export function useContractCreateModals({
  contractId,
  ownerUserId,
  origins = [],
  onRefresh,
}: {
  contractId: string;
  /**
   * Responsável interno. Continua no contrato, e continua NÃO sendo
   * responsabilidade contratual: quem o contrato obriga é `responsibleSide`,
   * e misturar os dois faria "quem tem que fazer" e "a quem o contrato
   * obriga" virarem a mesma coluna.
   */
  ownerUserId: string | null;
  /** Cláusulas e documentos do contrato, para a origem obrigatória. */
  origins?: readonly ObligationOrigin[];
  onRefresh: () => Promise<void> | void;
}): { openObligation: () => void; openBilling: () => void; modals: React.ReactNode } {
  void ownerUserId;
  const { notify } = useHudToast();
  const [kind, setKind] = useState<CreateKind | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [evidence, setEvidence] = useState('');
  const [status, setStatus] = useState('open');
  const [amount, setAmount] = useState('');
  const [origin, setOrigin] = useState('');
  const [responsibleSide, setResponsibleSide] = useState('unknown');
  const [recurrence, setRecurrence] = useState('one_time');
  const [blocksBilling, setBlocksBilling] = useState('unknown');

  const reset = (next: CreateKind) => {
    setTitle('');
    setDescription('');
    setDueDate(format(new Date(), 'yyyy-MM-dd'));
    setEvidence('');
    setStatus(next === 'billing' ? 'pendente' : 'open');
    setAmount('');
    setOrigin(origins.length === 1 ? origins[0].value : '');
    setResponsibleSide('unknown');
    setRecurrence('one_time');
    setBlocksBilling('unknown');
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
      if (!origin) {
        notify('Origem obrigatória', {
          description: 'Aponte a cláusula ou o documento que sustenta esta obrigação.',
          variant: 'error',
        });
        return;
      }
      const [originKind, originId] = origin.split(':');
      run(async () => {
        const response = await fetch(`/api/contracts/${contractId}/obligations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            requirementText: description.trim() || undefined,
            responsibleSide,
            [originKind === 'clause' ? 'sourceClauseId' : 'sourceDocumentId']: originId,
            // A data informada é o prazo da ocorrência, então a regra é
            // "data fixa" — e só para obrigação de uma vez só. Uma série
            // recorrente com data fixa seria a mesma data doze vezes.
            ...(recurrence === 'one_time' && dueDate
              ? { dueKind: 'fixed_date', dueFixedDate: dueDate, calendarBasis: 'calendar_days' }
              : {}),
            ...(dueDate ? { effectiveFrom: dueDate } : {}),
            recurrenceKind: recurrence,
            blocksBilling: blocksBilling === 'unknown' ? null : blocksBilling === 'true',
            ...(evidence.trim() ? { sourceExcerpt: evidence.trim() } : {}),
          }),
        });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao registrar obrigação.');
      }, `Obrigação "${title.trim()}" registrada.`);
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
          <HudSelect
            label="Origem no contrato"
            value={origin}
            onChange={setOrigin}
            options={origins.length ? [...origins] : [{ value: '', label: 'Nenhuma cláusula ou documento registrado' }]}
          />
          <p className="text-[11px] text-ig-fg-muted">
            Obrigatória: é a origem que separa uma obrigação contratual de uma anotação.
            {origins.length === 0 && ' Registre antes uma cláusula ou anexe um documento.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <HudInput label="Prazo" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <HudSelect label="Repetição" value={recurrence} onChange={setRecurrence} options={RECURRENCE} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label="Responsabilidade contratual" value={responsibleSide} onChange={setResponsibleSide} options={RESPONSIBLE_SIDE} />
            <HudSelect label="Bloqueia faturamento?" value={blocksBilling} onChange={setBlocksBilling} options={BLOCKS_BILLING} />
          </div>
          <HudInput label="Trecho de origem" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Ex: Cláusula 5.1, parágrafo 2" />
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
