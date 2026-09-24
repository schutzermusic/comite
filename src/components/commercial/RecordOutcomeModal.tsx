'use client';

import { useState } from 'react';
import { HudButton, HudInput, HudModal, HudPanel, HudSelect } from '@/components/hud';

const SOURCES = [
  { value: 'signed_document', label: 'Documento assinado' },
  { value: 'customer_email', label: 'E-mail do cliente' },
  { value: 'customer_portal', label: 'Portal do cliente' },
  { value: 'purchase_order', label: 'Pedido de compra' },
  { value: 'meeting_minutes', label: 'Ata de reunião' },
  { value: 'integration', label: 'Integração' },
];

/**
 * REGISTRO da manifestação do cliente.
 *
 * A fonte da manifestação é obrigatória, e não por formalismo: ela é o que
 * separa "o cliente aceitou" de "alguém marcou aceito". Mais adiante, o motor
 * de elegibilidade de faturamento distingue aceite interno de aceite com
 * procedência externa — e uma cláusula que exige aprovação do cliente só é
 * satisfeita pela segunda.
 *
 * Não há caminho automático para esta tela. A rota exige permissão própria e
 * a função governada exige ator humano: nenhuma integração e nenhuma IA
 * aceitam proposta em nome do cliente.
 */
export function RecordOutcomeModal({
  revisionId, revisionNumber, packageLabel, onClose,
}: { revisionId: string; revisionNumber: number; packageLabel?: string; onClose: () => void }) {
  const [outcome, setOutcome] = useState<'ACCEPTED' | 'REJECTED' | 'EXPIRED'>('ACCEPTED');
  const [source, setSource] = useState('signed_document');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/commercial/proposals/${revisionId}/outcome`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          outcome,
          acceptanceSource: outcome === 'ACCEPTED' ? source : null,
          acceptanceExternalRef: outcome === 'ACCEPTED' ? reference.trim() || null : null,
          rejectionReason: outcome === 'REJECTED' ? reason.trim() || null : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Não foi possível registrar.');
      window.location.reload();
    } catch (caught) {
      setError((caught as Error).message);
      setSaving(false);
    }
  };

  return (
    <HudModal isOpen onClose={onClose} size="md"
      title={`Resposta do cliente — ${packageLabel ?? `revisão ${revisionNumber}`}`}
      subtitle={packageLabel
        ? "A resposta vale para o PACOTE: cada documento com o cliente recebe o mesmo registro, e o aceite grava o pacote exato."
        : "Quem aceita é o cliente. Aqui se registra o que ele respondeu, e por qual via."}>
      <div className="space-y-4">
        <HudSelect
          label="Resposta"
          value={outcome}
          options={[
            { value: 'ACCEPTED', label: 'Aceitou' },
            { value: 'REJECTED', label: 'Recusou' },
            { value: 'EXPIRED', label: 'Expirou sem resposta' },
          ]}
          onChange={(next) => setOutcome(next as typeof outcome)}
        />

        {outcome === 'ACCEPTED' && (
          <>
            <HudSelect label="Como o cliente se manifestou" value={source}
              options={SOURCES} onChange={setSource} />
            <HudInput label="Referência do documento (opcional)" value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Número do pedido, protocolo, assunto do e-mail…" />
            <HudPanel elevation={1} interactive={false}>
              <p className="text-ig-caption text-ig-fg-muted">
                Registrar o aceite NÃO cria projeto, OS, medição nem faturamento. Ele apenas torna
                esta revisão elegível a autorizar trabalho — o que é um ato separado, na Carteira.
              </p>
            </HudPanel>
          </>
        )}

        {outcome === 'REJECTED' && (
          <HudInput label="Motivo da recusa" value={reason}
            onChange={(event) => setReason(event.target.value)} />
        )}

        {error && (
          <HudPanel elevation={1} state="critical" interactive={false}>
            <p className="text-ig-body-sm text-ig-fg-strong">{error}</p>
          </HudPanel>
        )}

        <div className="flex justify-end gap-2">
          <HudButton variant="secondary" size="md" onClick={onClose}>Cancelar</HudButton>
          <HudButton variant="primary" size="md" disabled={saving} onClick={submit}>
            {saving ? 'Registrando…' : 'Registrar resposta'}
          </HudButton>
        </div>
      </div>
    </HudModal>
  );
}
