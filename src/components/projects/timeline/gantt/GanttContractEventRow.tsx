'use client';

/**
 * A LINHA DERIVADA "EVENTO DE MEDIÇÃO" do Gantt.
 *
 * ─── O que ela é ───────────────────────────────────────────────────────────
 *
 * A sobreposição CONTRATUAL de uma atividade: o marco de faturamento que um
 * revisor humano aceitou como sendo aquela etapa, desenhado logo abaixo dela.
 *
 * ─── O que ela deliberadamente NÃO é ───────────────────────────────────────
 *
 * Não é uma atividade. Não tem checkbox, não tem percentual, não tem
 * responsável e não abre edição de cronograma. Se ela fosse editável, o
 * produto passaria a ter duas datas para o mesmo fato — a da etapa e a do
 * "marco contratual" — e elas divergiriam na primeira reprogramação.
 *
 * A etapa continua sendo a verdade operacional. Esta linha só empresta o olho
 * do gestor para o dinheiro que depende dela.
 *
 * ─── Por que ela ignora as colunas do painel ───────────────────────────────
 *
 * As colunas da esquerda (EDT, %, início, fim, responsável) descrevem
 * ATIVIDADE. Um evento contratual não tem nenhuma delas, e preenchê-las com
 * "—" cinco vezes faria a linha parecer uma atividade mal cadastrada. Ela
 * ocupa o painel inteiro como uma faixa, que é o que ela é.
 */

import React from 'react';
import { Landmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GanttScale } from '@/lib/projects/timeline-analytics';
import { ganttX } from '@/lib/projects/timeline-analytics';
import type { ProjectContractEvent } from '@/lib/projects/contract-events';
import { PlanChip } from '@/components/contracts/billing/month/PlanChip';
import {
  PROVENANCE, amountText, billingConsequence, markerTooltip, rowLabel, stageChip,
} from '../contract/contract-event-view';
import { ROW_H } from './gantt-constants';

export interface GanttContractEventRowProps {
  event: ProjectContractEvent;
  index: number;
  scale: GanttScale;
  panelWidth: number;
  /** Profundidade da atividade que a sustenta — a linha entra um nível abaixo. */
  depth: number;
  selected: boolean;
  onSelect: (event: ProjectContractEvent) => void;
}

export const GanttContractEventRow = React.memo(function GanttContractEventRow({
  event, index, scale, panelWidth, depth, selected, onSelect,
}: GanttContractEventRowProps) {
  const plan = event.plan;
  const chip = stageChip(event);
  const tooltip = markerTooltip(event);
  const markerX = ganttX(scale, plan.plannedBillingDate);

  return (
    <div
      data-contract-event={plan.milestoneId}
      role="row"
      onClick={() => onSelect(event)}
      className={cn(
        'absolute left-0 flex cursor-pointer items-stretch border-b border-ig-border-subtle',
      )}
      style={{
        top: index * ROW_H,
        height: ROW_H,
        width: panelWidth + scale.totalWidth,
        background: selected
          ? 'color-mix(in oklab, var(--ig-contract) 18%, transparent)'
          : 'var(--ig-contract-weak)',
      }}
    >
      {/* ─── Painel esquerdo, congelado ─── */}
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center gap-2 overflow-hidden border-r border-ig-border pr-2"
        style={{
          width: panelWidth,
          paddingLeft: 8 + (depth + 1) * 14,
          background: selected
            ? 'color-mix(in oklab, var(--ig-contract) 22%, var(--ig-bg-panel))'
            : 'color-mix(in oklab, var(--ig-contract) 12%, var(--ig-bg-panel))',
          // A barra de acento à esquerda é o que separa a sobreposição da
          // atividade num relance, mesmo com o painel rolado.
          boxShadow: 'inset 3px 0 0 0 var(--ig-contract)',
        }}
        title={tooltip}
      >
        <Landmark
          className="h-3.5 w-3.5 shrink-0"
          style={{ color: 'var(--ig-contract)' }}
          aria-hidden
        />

        <span className="min-w-0 flex-1 leading-tight">
          <span
            className="block truncate text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: 'var(--ig-contract)' }}
          >
            {rowLabel(event)}
          </span>
          <span className="block truncate text-[11px] text-ig-fg-muted">
            {billingConsequence(event)} · {PROVENANCE} · {plan.contractNumber ?? 'Contrato'}
          </span>
        </span>

        {/*
          A quantia, ou a razão de ela não estar ali.

          Restrito não é desenhado como um valor: sem tabular-nums, sem peso e
          em tom apagado, para que a coluna não sugira um número que a pessoa
          simplesmente não consegue ler.
        */}
        <span
          className={cn(
            'shrink-0 whitespace-nowrap text-[12px]',
            event.canViewValues ? 'font-semibold tabular-nums' : 'italic',
          )}
          style={{
            color: event.canViewValues
              ? 'var(--ig-contract-strong)'
              : 'var(--ig-fg-disabled)',
          }}
          title={event.canViewValues ? undefined : 'Valor contratual restrito a quem tem permissão financeira.'}
        >
          {amountText(event)}
        </span>

        <span className="shrink-0">
          <PlanChip tone={chip.tone.tone} dashed={chip.tone.dashed} title={tooltip}>
            {chip.label}
          </PlanChip>
        </span>
      </div>

      {/* ─── Faixa do gráfico: o marcador contratual ─── */}
      <div className="relative shrink-0" style={{ width: scale.totalWidth }}>
        {markerX !== null && (
          <>
            {/*
              Losango OCO e dourado, na data prevista.

              Oco de propósito: o marco do cronograma (`GanttBar`) é sólido, e
              os dois precisam conviver na mesma vertical sem que um pareça
              substituir o outro. Esta é uma camada A MAIS sobre o cronograma,
              nunca o cronograma redesenhado.
            */}
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]"
              style={{
                left: markerX,
                border: '2px solid var(--ig-contract)',
                background: 'color-mix(in oklab, var(--ig-contract) 22%, transparent)',
              }}
              title={tooltip}
              aria-label={tooltip}
            />
            {/* Valor ao lado do marcador só quando há valor para mostrar. */}
            {event.canViewValues && (
              <span
                className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-3 text-[10px] font-medium tabular-nums"
                style={{ left: markerX + 6, color: 'var(--ig-contract-strong)' }}
                aria-hidden
              >
                {amountText(event)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
});
