'use client';

import { useState } from 'react';
import { HudButton, HudInput, HudModal, HudPanel } from '@/components/hud';

/**
 * Registro de trabalho autorizado sem instrumento contratual.
 *
 * O que NÃO existe neste formulário, de propósito:
 *
 *  • campo de status — toda entrada nasce `UNDER_ANALYSIS`, e a função
 *    governada ignora qualquer tentativa de informar outro;
 *  • campo de valor autorizado — o valor é DERIVADO da fonte regente quando
 *    ela é anexada. Digitá-lo aqui produziria um número sem documento atrás,
 *    que é exatamente o que os KPIs não podem somar.
 *
 * A consequência prática é que cadastrar não move KPI nenhum: só a
 * autorização humana, depois da fonte anexada, move.
 */
export function CarteiraManualIntakeModal({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (next: boolean) => void }) {
  const [title, setTitle] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const response = await fetch('/api/commercial/engagements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          counterpartyName: counterparty.trim(),
          engagementNumber: reference.trim() || null,
          origin: 'manual',
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Não foi possível registrar.');
      setCreated(payload.engagementId);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    onOpenChange(false);
    setTitle(''); setCounterparty(''); setReference(''); setCreated(null); setError(null);
  };

  return (
    <HudModal
      isOpen={open}
      onClose={close}
      title="Registrar trabalho autorizado"
      size="md"
    >
      <div className="space-y-4">
        <HudPanel elevation={1} interactive={false}>
          <p className="text-ig-caption text-ig-fg-muted">
            A entrada nasce <strong>Em análise</strong> e não entra em valor autorizado
            nem em backlog. O valor passa a contar quando alguém anexa a fonte que
            autoriza o trabalho — contrato, proposta aceita, pedido ou autorização —
            e revisa a entrada.
          </p>
        </HudPanel>

        {created ? (
          <HudPanel elevation={1} state="default" interactive={false}>
            <p className="text-ig-body-sm text-ig-fg-strong">
              Registrado em análise. O próximo passo é anexar a fonte de autorização
              no dossiê deste item.
            </p>
          </HudPanel>
        ) : (
          <>
            <HudInput
              label="Título do trabalho"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Comissionamento SE Norte — 4 bays"
            />
            <HudInput
              label="Contraparte"
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
              placeholder="Razão social do cliente"
            />
            <HudInput
              label="Referência interna (opcional)"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Número que a sua equipe já usa para este trabalho"
            />
            {error && (
              <HudPanel elevation={1} state="critical" interactive={false}>
                <p className="text-ig-body-sm text-ig-fg-strong">{error}</p>
              </HudPanel>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <HudButton variant="secondary" size="md" onClick={close}>
            {created ? 'Fechar' : 'Cancelar'}
          </HudButton>
          {!created && (
            <HudButton
              variant="primary"
              size="md"
              disabled={saving || !title.trim() || !counterparty.trim()}
              onClick={submit}
            >
              {saving ? 'Registrando…' : 'Registrar em análise'}
            </HudButton>
          )}
        </div>
      </div>
    </HudModal>
  );
}
