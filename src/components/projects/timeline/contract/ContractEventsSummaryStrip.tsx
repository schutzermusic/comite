'use client';

/**
 * "CONTRATO & FATURAMENTO" — o resumo contratual ao lado dos controles do
 * cronograma.
 *
 * ─── Por que ele fica AQUI e não numa aba ─────────────────────────────────
 *
 * A pergunta "quantos eventos contratuais deste projeto estão de pé?" nasce
 * enquanto se olha o cronograma, não numa tela separada. Empurrá-la para uma
 * aba de Contratos é o que fazia o gestor de projeto descobrir um marco sem
 * vínculo três semanas depois de importar o cronograma.
 *
 * ─── A regra dos números ──────────────────────────────────────────────────
 *
 * Contagens são sempre exibidas. Quantias só aparecem quando alguma fonte as
 * sustenta — e, quando não sustentam, a tela escreve "Não apurado" em vez de
 * "R$ 0,00". Zero é uma afirmação; ausência é outra.
 */

import React from 'react';
import { Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LINK_STATE_SHORT, type ContractEventsSummary,
} from '@/lib/projects/contract-events';
import { ABSENT, RESTRICTED, money } from './contract-event-view';

interface Props {
  readonly summary: ContractEventsSummary;
  /**
   * Mostra a faixa de quantias.
   *
   * Continua `true` para quem não pode ver valor: a faixa então escreve
   * "Restrito", que é informação. Esconder a faixa inteira faria a tela
   * parecer não ter lado financeiro nenhum, e o gestor não saberia que existe
   * algo ali sob permissão.
   */
  readonly showAmounts: boolean;
  readonly onOpenReview?: () => void;
  readonly className?: string;
}

function Count({ value, label, tone }: {
  value: number; label: string; tone?: 'accent' | 'attention' | 'neutral';
}) {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap">
      <strong
        className="text-[13px] font-semibold tabular-nums"
        style={{
          color: tone === 'accent'
            ? 'var(--ig-contract)'
            : tone === 'attention'
              ? 'var(--ig-warning)'
              : 'var(--ig-fg-muted)',
        }}
      >
        {value}
      </strong>
      <span className="text-[11px] text-ig-fg-muted">{label}</span>
    </span>
  );
}

function Amount({ label, value, currency, restricted, hint }: {
  label: string; value: number | null; currency: string | null;
  restricted: boolean; hint?: string;
}) {
  const known = !restricted && value !== null;
  return (
    <span className="flex flex-col whitespace-nowrap" title={hint}>
      <span className="text-[10px] uppercase tracking-[0.06em] text-ig-fg-subtle">{label}</span>
      <span
        className={cn(
          'text-[12px]',
          known ? 'font-semibold tabular-nums' : 'text-ig-fg-disabled',
          restricted && 'italic',
        )}
        style={known ? { color: 'var(--ig-contract-strong)' } : undefined}
      >
        {restricted ? RESTRICTED : value === null ? ABSENT : money(value, currency)}
      </span>
    </span>
  );
}

export function ContractEventsSummaryStrip({
  summary, showAmounts, onOpenReview, className,
}: Props) {
  // Projeto sem contrato ligado não ganha faixa nenhuma: uma faixa com seis
  // zeros afirmaria que o projeto TEM eventos contratuais e todos estão vazios.
  if (summary.total === 0) return null;

  const pending = summary.suggested + summary.ambiguous + summary.unmatched
    + summary.anchorLost;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-3 py-2',
        className,
      )}
      style={{
        borderColor: 'color-mix(in oklab, var(--ig-contract) 35%, transparent)',
        background: 'var(--ig-contract-weak)',
      }}
    >
      <span className="flex items-center gap-1.5">
        <Landmark className="h-3.5 w-3.5" style={{ color: 'var(--ig-contract)' }} aria-hidden />
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: 'var(--ig-contract)' }}
        >
          Contrato &amp; faturamento
        </span>
      </span>

      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Count value={summary.total} label={summary.total === 1 ? 'evento' : 'eventos'} />
        <Count value={summary.linked} label={LINK_STATE_SHORT.ACCEPTED.toLowerCase() + 's'} tone="accent" />
        {summary.suggested > 0 && (
          <Count value={summary.suggested} label="sugeridos" tone="attention" />
        )}
        {summary.ambiguous > 0 && (
          <Count value={summary.ambiguous} label="ambíguos" tone="attention" />
        )}
        {summary.unmatched > 0 && (
          <Count value={summary.unmatched} label="sem vínculo" />
        )}
        {summary.anchorLost > 0 && (
          <Count value={summary.anchorLost} label="requerem remapeamento" tone="attention" />
        )}
      </span>

      {showAmounts && (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Amount
            label="Valor vinculado"
            value={summary.linkedAmount}
            currency={summary.currency}
            restricted={summary.valuesRestricted}
            hint={summary.valuesRestricted
              ? 'Valores contratuais exigem permissão de valores de contrato ou de finanças.'
              : 'Valor contratual dos marcos com ponte de cronograma ACEITA.'}
          />
          <Amount
            label="Elegível para faturar"
            value={summary.eligibleAmount}
            currency={summary.currency}
            restricted={summary.valuesRestricted}
            hint={summary.valuesRestricted
              ? 'Informação financeira restrita.'
              : 'Apurado pelo fluxo de faturamento. Ausente quando nenhum evento foi gerado.'}
          />
          <Amount
            label="Previsto 30 dias"
            value={summary.next30Amount}
            currency={summary.currency}
            restricted={summary.valuesRestricted}
            hint={summary.valuesRestricted
              ? 'Informação financeira restrita.'
              : 'Marcos com vínculo aceito cuja data prevista cai nos próximos 30 dias.'}
          />
        </span>
      )}

      {onOpenReview && pending > 0 && (
        <button type="button" className="portfolio-action ml-auto" onClick={onOpenReview}>
          Revisar eventos ({pending})
        </button>
      )}
    </div>
  );
}
