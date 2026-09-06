'use client';

/**
 * Obrigações estruturadas de UM contrato, dentro da seção `Obrigações` do
 * dossiê. Nenhuma navegação nova: a seção já existe, e o que muda é o que ela
 * mostra.
 *
 * A diferença para a lista antiga não é visual, é de conteúdo. A lista antiga
 * respondia "o que alguém anotou". Esta responde "o que o contrato exige, de
 * quem, desde quando, com que prazo e por qual cláusula" — e, quando não
 * responde, diz que não sabe em vez de mostrar um traço.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { CalendarClock, CircleHelp, Landmark, ShieldOff } from 'lucide-react';
import { HudEmptyState } from '@/components/hud';
import type { ContractObligationsAsOf } from '@/lib/contracts/obligations/types';

const URGENCY_LABEL = {
  OVERDUE: 'Em atraso', DUE: 'Vence hoje', UPCOMING: 'No prazo',
  UNKNOWN: 'Prazo não apurado', NOT_APPLICABLE: 'Encerrada',
} as const;

const URGENCY_TONE = {
  OVERDUE: 'border-ig-danger/45 text-ig-danger',
  DUE: 'border-ig-warning/45 text-ig-warning',
  UPCOMING: 'border-ig-success/45 text-ig-success',
  UNKNOWN: 'border-ig-border-strong text-ig-fg-muted',
  NOT_APPLICABLE: 'border-ig-border text-ig-fg-muted',
} as const;

const SIDE_LABEL: Record<string, string> = {
  contracting_organization: 'Nossa responsabilidade',
  counterparty: 'Do cliente',
  supplier: 'Do fornecedor',
  third_party: 'De terceiro',
  shared: 'Compartilhada',
  unknown: 'Lado não apurado',
};

export function ContractStructuredObligations({ contractId }: { contractId: string }) {
  const [data, setData] = useState<ContractObligationsAsOf | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/contracts/${contractId}/obligations`, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error ?? 'Falha ao carregar obrigações.');
        if (!cancelled) { setData(body as ContractObligationsAsOf); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar obrigações.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contractId]);

  if (loading) return <p className="py-6 text-center text-ig-caption text-ig-fg-muted">Carregando obrigações…</p>;
  // Consulta que FALHOU não é carteira vazia. As duas mensagens são diferentes
  // porque as duas situações pedem ações diferentes.
  if (error) return <p className="rounded-lg border border-ig-warning/35 p-3 text-ig-body-sm text-ig-warning">{error}</p>;
  if (!data || data.obligations.length === 0) {
    return (
      <HudEmptyState
        icon="inbox"
        compact
        title="Nenhuma obrigação estruturada neste contrato"
        description="Registrar uma obrigação exige apontar a cláusula, o aditivo ou o documento que a origina — é isso que a separa de uma anotação."
      />
    );
  }

  return (
    <div className="space-y-4">
      {data.billingBlock.state !== 'FALSE' && (
        <p className={cn(
          'flex items-start gap-2 rounded-lg border p-3 text-ig-caption',
          data.billingBlock.state === 'TRUE'
            ? 'border-ig-danger/35 bg-ig-danger/5 text-ig-danger'
            : 'border-ig-border-strong text-ig-fg-muted',
        )}>
          {data.billingBlock.state === 'TRUE'
            ? <Landmark className="mt-0.5 h-4 w-4 shrink-0" />
            : <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {data.billingBlock.state === 'TRUE'
              ? `Faturamento contratualmente bloqueado por ${data.billingBlock.blockingInstanceIds.length} obrigação(ões) pendente(s).`
              : 'Não é possível afirmar se o faturamento está liberado: falta apurar se alguma obrigação é pré-requisito, ou desde quando ela vale.'}
          </span>
        </p>
      )}

      {data.obligations.map((obligation) => (
        <div key={obligation.definition.id} className="rounded-xl border border-ig-border bg-ig-panel/45 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{obligation.definition.title}</p>
              <p className="mt-0.5 text-ig-caption text-ig-fg-muted">
                {SIDE_LABEL[obligation.definition.responsibleSide]}
                {obligation.definition.provenance.page && ` · Cláusula, p. ${obligation.definition.provenance.page}`}
                {obligation.definition.effectiveFrom
                  ? ` · vigente desde ${obligation.definition.effectiveFrom}`
                  : ' · vigência não apurada'}
              </p>
            </div>
            {obligation.definition.blocksBilling === true && (
              <span className="shrink-0 rounded-full border border-ig-danger/45 px-2 py-0.5 text-[10px] text-ig-danger">
                Pré-requisito de faturamento
              </span>
            )}
          </div>

          {obligation.definition.requirementText && (
            <p className="mt-2 text-ig-caption text-ig-fg-muted">{obligation.definition.requirementText}</p>
          )}

          {obligation.definition.parties.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {obligation.definition.parties.map((party) => (
                <span key={party.id} className="rounded-full border border-ig-border px-2 py-0.5 text-[10px] text-ig-fg-muted">
                  {party.role}: {party.partyLegalName ?? party.partyText}
                </span>
              ))}
            </p>
          )}

          <ul className="mt-3 space-y-1.5">
            {obligation.instances.map((instance) => (
              <li key={instance.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-ig-border-subtle p-2 text-ig-caption">
                <span className="font-medium text-ig-fg-strong">{instance.occurrenceKey}</span>
                <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', URGENCY_TONE[instance.urgency])}>
                  {URGENCY_LABEL[instance.urgency]}
                </span>
                <span className="inline-flex items-center gap-1 text-ig-fg-muted">
                  <CalendarClock className="h-3 w-3" />
                  {instance.dueDate ?? (instance.dueBasis ? `sem prazo: ${instance.dueBasis}` : 'sem prazo')}
                </span>
                {instance.evidenceComplete === 'FALSE' && <span className="text-ig-warning">evidência faltando</span>}
                {instance.evidenceComplete === 'UNKNOWN' && <span className="text-ig-fg-muted">evidência sem aceite</span>}
                {instance.exceptions.some((e) => e.effective) && (
                  <span className="inline-flex items-center gap-1 text-ig-fg-muted"><ShieldOff className="h-3 w-3" />dispensada</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
