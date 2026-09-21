'use client';

/**
 * A FILA DE EVENTOS CONTRATUAIS do projeto — os quatro estados, numa lista.
 *
 * Existe porque a linha derivada do Gantt só mostra o que já está ACEITO, e
 * é justamente o que NÃO está aceito que exige alguém. Um marco sem vínculo
 * não tem onde aparecer no corpo do cronograma — ele não tem etapa — e sem
 * esta lista ele seria invisível até a semana em que alguém tentasse faturar.
 *
 * A ordem é por urgência de decisão: ambíguo, sugerido, sem vínculo e, por
 * último, o que já está resolvido.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Landmark, MinusCircle, Unlink } from 'lucide-react';
import { HudModal } from '@/components/hud';
import { PlanChip } from '@/components/contracts/billing/month/PlanChip';
import {
  LINK_STATE_LABEL, eventNumberLabel, sortForReview,
  type EventLinkState, type ProjectContractEvent,
} from '@/lib/projects/contract-events';
import { amountText, date, stageChip } from './contract-event-view';

const ICON: Record<
  EventLinkState,
  React.ComponentType<{ className?: string; style?: React.CSSProperties }>
> = {
  ACCEPTED: CheckCircle2,
  ANCHOR_LOST: Unlink,
  PROPOSED: HelpCircle,
  AMBIGUOUS: AlertTriangle,
  UNMATCHED: MinusCircle,
};

const ICON_COLOR: Record<EventLinkState, string> = {
  ACCEPTED: 'var(--ig-contract)',
  ANCHOR_LOST: 'var(--ig-warning)',
  PROPOSED: 'var(--ig-warning)',
  AMBIGUOUS: 'var(--ig-warning)',
  UNMATCHED: 'var(--ig-fg-disabled)',
};

interface Props {
  readonly open: boolean;
  readonly events: readonly ProjectContractEvent[];
  readonly showAmounts: boolean;
  readonly onSelect: (event: ProjectContractEvent) => void;
  readonly onClose: () => void;
}

export function ContractEventsReviewModal({
  open, events, showAmounts, onSelect, onClose,
}: Props) {
  const ordered = sortForReview(events);

  return (
    <HudModal
      isOpen={open}
      onClose={onClose}
      title="Eventos de medição do contrato"
      subtitle="Marco contratual ↔ etapa do cronograma. Só o vínculo aceito alimenta a previsão de faturamento."
      size="lg"
    >
      <div className="space-y-2">
        {ordered.length === 0 && (
          <p className="py-6 text-center text-[13px] text-ig-fg-muted">
            Nenhum contrato com marco de medição está ligado a este projeto.
          </p>
        )}

        {ordered.map((event) => {
          const Icon = ICON[event.linkState];
          const chip = stageChip(event);
          const linked = event.linkState === 'ACCEPTED';
          const activity = linked
            ? event.plan.timelineWbsCode
              ? `${event.plan.timelineWbsCode} — ${event.plan.timelineTitle}`
              : event.plan.timelineTitle
            : event.proposedTimelineItemId
              ? `${event.proposedTimelineWbsCode ?? ''} ${event.proposedTimelineTitle ?? ''}`.trim()
              : null;

          return (
            <button
              key={event.plan.milestoneId}
              type="button"
              onClick={() => onSelect(event)}
              className="flex w-full items-start gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/50 p-3 text-left transition-colors hover:bg-ig-panel-hover"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ICON_COLOR[event.linkState] }} />

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.08em]"
                    style={{ color: 'var(--ig-contract)' }}
                  >
                    {eventNumberLabel(event)}
                  </span>
                  <span className="text-[13px] text-ig-fg-strong">{event.plan.title}</span>
                </span>

                <span className="mt-0.5 block text-[12px] text-ig-fg-muted">
                  {LINK_STATE_LABEL[event.linkState]}
                  {activity && ` · ${activity}`}
                  {linked && ` · ${date(event.plan.plannedBillingDate)}`}
                  {!linked && event.confidence !== null
                    && ` · confiança ${Math.round(event.confidence * 100)}%`}
                </span>

                {event.linkState === 'AMBIGUOUS' && (
                  <span className="mt-0.5 block text-[11px] text-ig-warning">
                    {event.ambiguousAlternatives.length + 1} etapas explicam este marco —
                    exige escolha humana.
                  </span>
                )}
                {event.linkState === 'ANCHOR_LOST' && (
                  <span className="mt-0.5 block text-[11px] text-ig-warning">
                    A atividade {event.mappedTimelineWbsCode ?? ''} {event.mappedTimelineTitle ?? ''}
                    {' '}saiu do cronograma. O vínculo aceito continua registrado — escolha a
                    nova atividade correspondente.
                  </span>
                )}
                {event.linkState === 'UNMATCHED' && (
                  <span className="mt-0.5 block text-[11px] text-ig-fg-subtle">
                    Nenhuma atividade correspondente foi identificada — abra para vincular
                    uma etapa do cronograma.
                  </span>
                )}
              </span>

              <span className="flex shrink-0 flex-col items-end gap-1">
                {showAmounts && (
                  <span
                    className={event.canViewValues
                      ? 'text-[12px] font-semibold tabular-nums'
                      : 'text-[12px] italic text-ig-fg-disabled'}
                    style={event.canViewValues
                      ? { color: 'var(--ig-contract-strong)' }
                      : undefined}
                  >
                    {amountText(event)}
                  </span>
                )}
                <PlanChip tone={chip.tone.tone} dashed={chip.tone.dashed}>{chip.label}</PlanChip>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-ig-fg-subtle">
        <Landmark className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        Proposta não é vínculo. Nenhuma sugestão alimenta previsão de faturamento antes
        de um aceite humano, e nenhum evento de faturamento nasce desta tela.
      </p>
    </HudModal>
  );
}
