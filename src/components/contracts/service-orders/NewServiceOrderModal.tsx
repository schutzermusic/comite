'use client';

import { useEffect, useMemo, useState } from 'react';
import { HudButton, HudInput, HudModal, HudPanel, HudSelect } from '@/components/hud';
import { authorizationSourceLabels } from '@/lib/commercial/labels';
import type { AuthorizationSourceKind } from '@/lib/commercial/types';

type EngagementRow = {
  id: string; title: string; counterparty_name: string; status: string;
  authorized_value: string | null; currency: string;
};
type AuthorizationRow = {
  engagement_id: string; source_kind: AuthorizationSourceKind;
  proposal_revision_id: string | null; governing: boolean; authorized_value: string | null;
};

/**
 * Nova Ordem de Serviço INTERNA.
 *
 * ─── O que a tela impede ─────────────────────────────────────────────────
 *
 * Só oferece trabalhos AUTORIZADOS. Um trabalho em análise não pode gerar OS,
 * e mostrá-lo na lista convidaria a tentar — para receber uma recusa do banco
 * que a pessoa não pediu.
 *
 * ─── O que a tela NÃO redigita ───────────────────────────────────────────
 *
 * Valor, moeda e escopo vêm da fonte regente quando a origem é a proposta
 * aceita: a função governada os herda da revisão, e o formulário nem exibe
 * campo para eles. O que a pessoa informa é o que só ela sabe — número da OS,
 * título e as datas planejadas.
 *
 * ─── O confronto roda sozinho ────────────────────────────────────────────
 *
 * Criada a OS, a rota confronta imediatamente com a fonte regente. Descobrir
 * divergência só na hora de emitir seria descobrir tarde: quem criou a OS já
 * saiu da tela.
 */
export function NewServiceOrderModal({
  onClose, onDone,
}: { onClose: () => void; onDone: () => void | Promise<void> }) {
  const [engagements, setEngagements] = useState<EngagementRow[]>([]);
  const [authorizations, setAuthorizations] = useState<AuthorizationRow[]>([]);
  const [engagementId, setEngagementId] = useState('');
  const [osNumber, setOsNumber] = useState('');
  const [title, setTitle] = useState('');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedFinish, setPlannedFinish] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ divergences: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/commercial/engagements');
        const payload = await response.json();
        if (cancelled || !response.ok || !payload.ok) return;
        setEngagements((payload.engagements ?? []).filter(
          (row: EngagementRow) => row.status === 'AUTHORIZED'));
        setAuthorizations(payload.authorizations ?? []);
      } catch { /* a lista vazia já diz o que precisa ser dito */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const governing = useMemo(() => {
    const map = new Map<string, AuthorizationRow>();
    for (const row of authorizations) if (row.governing) map.set(row.engagement_id, row);
    return map;
  }, [authorizations]);

  const selected = engagements.find((row) => row.id === engagementId) ?? null;
  const source = engagementId ? governing.get(engagementId) ?? null : null;
  const fromProposal = source?.source_kind === 'accepted_proposal' && source.proposal_revision_id;

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const response = await fetch('/api/commercial/service-orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          engagementId,
          // Da proposta aceita quando há uma regendo; manual quando não há.
          origin: fromProposal ? 'from_accepted_proposal' : 'manual',
          sourceProposalRevisionId: fromProposal ? source?.proposal_revision_id : null,
          osNumber: osNumber.trim(),
          title: title.trim(),
          plannedStart: plannedStart || null,
          plannedFinish: plannedFinish || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Não foi possível criar a OS.');
      setResult({ divergences: Number(payload.divergencesOpened ?? 0) });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudModal isOpen onClose={onClose} size="lg"
      title="Nova Ordem de Serviço interna"
      subtitle="Autorização operacional da Insight para começar a executar.">
      <div className="space-y-4">
        {result ? (
          <>
            <HudPanel elevation={1}
              state={result.divergences > 0 ? 'critical' : 'default'} interactive={false}>
              <p className="text-ig-body-sm text-ig-fg-strong">
                {result.divergences > 0
                  ? `OS criada e confrontada: ${result.divergences} divergência(s) contra a fonte `
                    + 'regente. Ela fica aguardando confirmação e não pode ser emitida até alguém decidir.'
                  : 'OS criada e confrontada com a fonte regente — nenhuma divergência.'}
              </p>
            </HudPanel>
            <div className="flex justify-end">
              <HudButton variant="primary" size="md" onClick={() => void onDone()}>Fechar</HudButton>
            </div>
          </>
        ) : (
          <>
            <HudSelect
              label="Trabalho autorizado"
              value={engagementId}
              placeholder={engagements.length ? 'Selecione…' : 'Nenhum trabalho AUTORIZADO disponível'}
              options={engagements.map((row) => ({
                value: row.id,
                label: `${row.title} — ${row.counterparty_name}`,
              }))}
              onChange={setEngagementId}
            />
            {selected && (
              <HudPanel elevation={1} interactive={false}>
                <p className="text-ig-caption text-ig-fg-muted">
                  Fonte regente:{' '}
                  <strong>{source ? authorizationSourceLabels[source.source_kind] : '—'}</strong>
                  {fromProposal
                    ? ' · valor, moeda e escopo serão herdados da revisão aceita, sem redigitação.'
                    : ' · sem proposta aceita regendo: a OS nasce manual.'}
                </p>
              </HudPanel>
            )}

            <HudInput label="Número da OS" value={osNumber}
              onChange={(event) => setOsNumber(event.target.value)}
              placeholder="OS-2026-014" />
            <HudInput label="Título" value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Comissionamento — 4 bays de 138 kV" />
            <div className="grid grid-cols-2 gap-3">
              <HudInput label="Início planejado" type="date" value={plannedStart}
                onChange={(event) => setPlannedStart(event.target.value)} />
              <HudInput label="Término planejado" type="date" value={plannedFinish}
                onChange={(event) => setPlannedFinish(event.target.value)} />
            </div>

            {error && (
              <HudPanel elevation={1} state="critical" interactive={false}>
                <p className="text-ig-body-sm text-ig-fg-strong">{error}</p>
              </HudPanel>
            )}

            <div className="flex justify-end gap-2">
              <HudButton variant="secondary" size="md" onClick={onClose}>Cancelar</HudButton>
              <HudButton variant="primary" size="md"
                disabled={saving || !engagementId || !osNumber.trim() || !title.trim()}
                onClick={submit}>
                {saving ? 'Criando…' : 'Criar OS'}
              </HudButton>
            </div>
          </>
        )}
      </div>
    </HudModal>
  );
}
