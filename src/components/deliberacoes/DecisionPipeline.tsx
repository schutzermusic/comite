'use client';

import React from 'react';
import { ChevronRight, X } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { DeliberacaoStatus, PipelineStage, SlaStatus } from './types';

interface DecisionPipelineProps {
  stages: PipelineStage[];
  activeStage: DeliberacaoStatus | null;
  onStageClick: (s: DeliberacaoStatus | null) => void;
}

const SLA_DOT: Record<SlaStatus, string> = {
  on_track: 'bg-ig-success',
  at_risk: 'bg-ig-warning',
  overdue: 'bg-ig-danger',
};

const SLA_LABEL: Record<SlaStatus, string> = {
  on_track: 'No prazo',
  at_risk: 'Em risco',
  overdue: 'Atrasada',
};

/**
 * Workflow tracker — Rascunho → Concluída. Each stage is a filter toggle for
 * the queue (single-select, mirrors the KPI band interaction): accent hairline
 * + tint when active, count badge, worst-SLA dot with text tooltip. Scrolls
 * horizontally on mobile with a fade edge.
 */
export function DecisionPipeline({ stages, activeStage, onStageClick }: DecisionPipelineProps) {
  return (
    <HudPanel elevation={2} noPadding>
      <div className="flex items-center justify-between px-4 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ig-fg-muted">
          Fluxo de decisão
        </p>
        {activeStage && (
          <button
            type="button"
            onClick={() => onStageClick(null)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-ig-accent hover:bg-ig-accent-weak/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ig-accent/40"
          >
            Limpar estágio
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="relative">
        <div className="px-4 pb-3 pt-2 overflow-x-auto">
          <div className="flex items-stretch gap-1.5 min-w-max lg:min-w-0">
            {stages.map((stage, index) => {
              const isActive = activeStage === stage.status;
              return (
                <React.Fragment key={stage.status}>
                  <button
                    type="button"
                    onClick={() => onStageClick(isActive ? null : stage.status)}
                    className={cn(
                      'group relative flex flex-col items-start gap-1 overflow-hidden rounded-lg border px-3 py-2 transition-all',
                      'min-w-[128px] lg:min-w-0 lg:flex-1 text-left',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
                      isActive
                        ? 'border-ig-accent/55 bg-[color-mix(in_oklab,var(--ig-accent)_10%,transparent)]'
                        : 'border-ig-border-subtle bg-ig-panel/40 hover:border-ig-border-focus hover:bg-ig-panel-hover/60',
                    )}
                    aria-pressed={isActive}
                    title={stage.sla_state ? `Pior SLA no estágio: ${SLA_LABEL[stage.sla_state]}` : undefined}
                  >
                    {/* Accent hairline (mirrors the KPI band active treatment) */}
                    <span
                      className={cn(
                        'pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-ig-accent to-transparent transition-opacity',
                        isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                    />
                    <div className="flex items-center justify-between w-full gap-2">
                      <span
                        className={cn(
                          'text-[10.5px] font-semibold uppercase tracking-[0.08em] truncate',
                          isActive ? 'text-ig-accent' : 'text-ig-fg-muted',
                        )}
                      >
                        {stage.label}
                      </span>
                      {stage.sla_state && (
                        <span
                          className={cn(
                            'inline-block h-1.5 w-1.5 rounded-full shrink-0',
                            SLA_DOT[stage.sla_state],
                            stage.sla_state === 'overdue' && 'animate-pulse',
                          )}
                          aria-hidden
                        />
                      )}
                    </div>

                    <div className="flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          'text-lg font-semibold tabular-nums leading-none',
                          isActive ? 'text-ig-accent' : 'text-ig-fg-strong',
                        )}
                      >
                        {stage.count}
                      </span>
                      <span className="text-[10px] text-ig-fg-muted">
                        {stage.count === 1 ? 'item' : 'itens'}
                      </span>
                      {isActive && (
                        <span className="ml-auto rounded-full border border-[color-mix(in_oklab,var(--ig-accent)_40%,transparent)] bg-[color-mix(in_oklab,var(--ig-accent)_14%,transparent)] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.08em] text-ig-accent">
                        filtro
                        </span>
                      )}
                    </div>
                  </button>

                  {index < stages.length - 1 && (
                    <div className="flex items-center text-ig-fg-subtle/70 shrink-0" aria-hidden>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
        {/* Mobile fade edge over the horizontal scroller */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[color-mix(in_oklab,var(--ig-bg-panel)_85%,transparent)] to-transparent lg:hidden" />
      </div>
    </HudPanel>
  );
}
