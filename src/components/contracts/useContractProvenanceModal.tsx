'use client';

/**
 * Classificação de origem do contrato — o ato de governança que decide o que a
 * empresa considera sua carteira.
 *
 * Por que esta tela existe: desde a Fase 0.7 o contrato NASCE `unclassified`.
 * Cadastrar deixou de ser afirmar procedência. Sem um lugar para fazer a
 * afirmação, porém, a regra viraria um beco sem saída — nenhum contrato novo
 * poderia jamais entrar na carteira oficial. A afirmação precisa existir; ela
 * só não pode ser automática.
 *
 * Três decisões desta tela:
 *
 * 1. A justificativa é OBRIGATÓRIA e não tem valor padrão. Classificar é
 *    responder "por que este contrato é real?", e uma resposta pré-preenchida
 *    não é uma resposta.
 *
 * 2. A autoridade não é a de quem cadastra. O gate é o mesmo que já governa
 *    UPDATE em `contracts` no nível mais alto (`contracts.delete` /
 *    `admin.manage_organization`), e nos papéis semeados isso é owner_admin —
 *    deliberadamente NÃO `juridico_contratos`, que é quem cria. Autocertificação
 *    foi exatamente o defeito corrigido em 0.7.
 *
 * 3. A tela diz a consequência antes do clique, nos dois sentidos: promover faz
 *    o contrato entrar em exposição, saúde e PDF oficiais; rebaixar o tira. É a
 *    única ação do módulo que muda o que a diretoria vê somada.
 */

import { useState } from 'react';
import { HudModal, HudButton, HudSelect } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import { reclassifyContract } from '@/lib/contracts/contract-service';
import type { ContractDataClass } from '@/lib/contracts/trust/trusted';

const CLASS_OPTIONS = [
  { value: 'live', label: 'Ao vivo — carteira oficial' },
  { value: 'demo', label: 'Demonstração — fixture, fora da métrica' },
  { value: 'unclassified', label: 'Não classificado — origem ainda não validada' },
];

const CONSEQUENCE: Record<ContractDataClass, string> = {
  live: 'Passa a compor exposição, saúde, faixa executiva e dossiê oficial em PDF.',
  demo: 'Sai de toda métrica oficial e passa a ser exibido com selo de demonstração.',
  unclassified: 'Sai de toda métrica oficial até que a origem seja afirmada.',
};

export function useContractProvenanceModal({
  contractId,
  contractTitle,
  current,
  onRefresh,
}: {
  contractId: string;
  contractTitle: string;
  current: ContractDataClass;
  onRefresh: () => Promise<void> | void;
}): { open: () => void; modal: React.ReactNode } {
  const { notify } = useHudToast();
  const [isOpen, setIsOpen] = useState(false);
  const [dataClass, setDataClass] = useState<string>(current);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const open = () => {
    setDataClass(current);
    setReason('');
    setIsOpen(true);
  };

  const changed = dataClass !== current;
  const canSubmit = changed && reason.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await reclassifyContract(contractId, dataClass as ContractDataClass, reason.trim());
      await onRefresh();
      notify('Origem reclassificada', {
        description: `${contractTitle} agora é "${dataClass}". A decisão ficou na auditoria.`,
        variant: 'success',
      });
      setIsOpen(false);
    } catch (err) {
      notify('Não foi possível reclassificar', {
        description: err instanceof Error ? err.message : 'Erro inesperado.',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const modal = (
    <HudModal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title="Classificar origem do contrato"
      subtitle="Decide se este contrato compõe a carteira oficial da empresa"
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="secondary" onClick={() => setIsOpen(false)}>Cancelar</HudButton>
          <HudButton variant="primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? 'Registrando...' : 'Registrar classificação'}
          </HudButton>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ig-fg-muted">
          <span className="font-semibold text-ig-fg-strong">{contractTitle}</span> está classificado
          hoje como <span className="font-semibold text-ig-fg-strong">{current}</span>.
        </p>

        <HudSelect label="Nova origem" value={dataClass} onChange={setDataClass} options={CLASS_OPTIONS} />

        {changed && (
          <p className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 text-[12px] text-ig-fg-muted">
            {CONSEQUENCE[dataClass as ContractDataClass]}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wider hud-label">
            Justificativa (obrigatória)
          </label>
          <textarea
            className="w-full rounded-lg border hud-input-bg p-2.5 text-sm text-ig-fg-strong"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Em que se baseia esta classificação?"
          />
          <p className="text-[11px] text-ig-fg-muted">
            Fica registrada em auditoria com autor, origem e destino.
          </p>
        </div>
      </div>
    </HudModal>
  );

  return { open, modal };
}
