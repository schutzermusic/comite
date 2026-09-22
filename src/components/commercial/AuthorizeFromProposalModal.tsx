'use client';

import { useState } from 'react';
import { HudButton, HudInput, HudModal, HudPanel } from '@/components/hud';

/**
 * Proposta ACEITA → trabalho autorizado.
 *
 * ─── Por que esta tela existe, e por que ela é pequena ───────────────────
 *
 * É a única passagem que faltava para o caminho dourado ser percorrível no
 * navegador: sem ela, a proposta aceita ficava sem porta para a Carteira e a
 * OS interna era inalcançável. O backend já tinha as três funções governadas;
 * o que faltava era o gatilho.
 *
 * Ela NÃO decide nada. Os três passos abaixo são os mesmos atos governados
 * que a API expõe, em ordem, e cada um mantém a sua regra:
 *
 *   1. criar o trabalho autorizado — nasce EM ANÁLISE, fora dos KPIs;
 *   2. anexar a revisão ACEITA como fonte de autorização — o gatilho do banco
 *      recusa qualquer revisão que não esteja aceita;
 *   3. autorizar — é aqui que o valor entra no KPI, derivado da fonte
 *      regente, nunca digitado.
 *
 * O passo 3 é explícito e separado de propósito. Fundir os três num botão só
 * faria "importei a proposta" significar "reconheci a receita".
 */
export function AuthorizeFromProposalModal({
  revisionId, proposalNumber, title, counterpartyName, totalValue, currency, onClose, onDone,
}: {
  revisionId: string;
  proposalNumber: string;
  title: string;
  counterpartyName: string;
  totalValue: string | null;
  currency: string | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [engagementTitle, setEngagementTitle] = useState(title);
  const [step, setStep] = useState<'form' | 'working' | 'done'>('form');
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [engagementId, setEngagementId] = useState<string | null>(null);

  const say = (line: string) => setLog((previous) => [...previous, line]);

  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Operação recusada.');
    return payload as Record<string, unknown>;
  };

  const run = async () => {
    setStep('working'); setError(null); setLog([]);
    try {
      const created = await post('/api/commercial/engagements', {
        title: engagementTitle.trim(),
        counterpartyName,
        origin: 'accepted_proposal',
        currency: currency ?? 'BRL',
      });
      const id = String(created.engagementId);
      setEngagementId(id);
      say('Trabalho autorizado registrado — em análise, fora dos KPIs.');

      const attached = await post(`/api/commercial/engagements/${id}/authorizations`, {
        sourceKind: 'accepted_proposal',
        proposalRevisionId: revisionId,
        authorizedValue: totalValue === null ? null : Number(totalValue),
        currency: currency ?? 'BRL',
      });
      say(attached.governing
        ? 'Proposta aceita anexada — ela passa a reger este trabalho.'
        : 'Proposta aceita anexada — a fonte regente NÃO mudou.');

      const authorized = await post(`/api/commercial/engagements/${id}/authorize`, {
        note: `Autorizado a partir da proposta ${proposalNumber}.`,
      });
      say(`Trabalho AUTORIZADO — valor derivado da fonte regente (${authorized.governing_source_kind}).`);
      setStep('done');
    } catch (caught) {
      setError((caught as Error).message);
      setStep('form');
    }
  };

  return (
    <HudModal isOpen onClose={onClose} size="lg"
      title={`Gerar trabalho autorizado — ${proposalNumber}`}
      subtitle="Três atos governados, em ordem. O valor só conta no KPI no último.">
      <div className="space-y-4">
        <HudPanel elevation={1} interactive={false}>
          <p className="text-ig-caption text-ig-fg-muted">
            Nenhum contrato é criado aqui. O trabalho passa a ser autorizado <strong>pela
            proposta aceita</strong>, que vira a fonte regente — e continua assim até que
            alguém, por escrito, decida o contrário.
          </p>
        </HudPanel>

        <HudInput label="Título do trabalho autorizado" value={engagementTitle}
          onChange={(event) => setEngagementTitle(event.target.value)} />
        <p className="text-ig-caption text-ig-fg-subtle">
          Cliente <strong>{counterpartyName}</strong> e valor{' '}
          <strong>{totalValue ?? '—'} {currency ?? ''}</strong> vêm da revisão aceita — sem redigitação.
        </p>

        {log.length > 0 && (
          <HudPanel elevation={1} interactive={false}>
            <ol className="space-y-1 text-ig-body-sm text-ig-fg-strong">
              {log.map((line) => <li key={line}>· {line}</li>)}
            </ol>
          </HudPanel>
        )}

        {error && (
          <HudPanel elevation={1} state="critical" interactive={false}>
            <p className="text-ig-body-sm text-ig-fg-strong">{error}</p>
          </HudPanel>
        )}

        {step === 'done' && (
          <HudPanel elevation={1} interactive={false}>
            <p className="text-ig-body-sm text-ig-fg-strong">
              Pronto. O próximo passo é a <strong>Ordem de Serviço interna</strong>, em
              Gestão de Contratos → Ordens de Serviço.
            </p>
          </HudPanel>
        )}

        <div className="flex justify-end gap-2">
          <HudButton variant="secondary" size="md" onClick={onClose}>
            {step === 'done' ? 'Fechar' : 'Cancelar'}
          </HudButton>
          {step === 'done' ? (
            <HudButton variant="primary" size="md"
              onClick={() => { window.location.href =
                `/contratos?view=ordens-de-servico&engajamento=${engagementId}`; }}>
              Ir para Ordens de Serviço
            </HudButton>
          ) : (
            <HudButton variant="primary" size="md"
              disabled={step === 'working' || !engagementTitle.trim()}
              onClick={run}>
              {step === 'working' ? 'Processando…' : 'Gerar trabalho autorizado'}
            </HudButton>
          )}
        </div>
      </div>
    </HudModal>
  );
}
