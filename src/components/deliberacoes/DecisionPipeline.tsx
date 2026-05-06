'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
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

export function DecisionPipeline({ stages, activeStage, onStageClick }: DecisionPipelineProps) {
  return (
    <HudPanel elevation={2} noPadding>
      <div className="px-4 py-3 overflow-x-auto">
        <div className="flex items-stretch gap-2 min-w-max">
          {stages.map((stage, index) => {
            const isActive = activeStage === stage.status;
            return (
              <React.Fragment key={stage.status}>
                <button
                  type="button"
                  onClick={() => onStageClick(isActive ? null : stage.status)}
                  className={cn(
                    'group flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2 transition-all',
                    'min-w-[140px] text-left',
                    isActive
                      ? 'border-ig-border-focus bg-ig-accent-weak/40'
                      : 'border-ig-border bg-ig-panel/40 hover:border-ig-border-strong hover:bg-ig-panel-hover/60',
                  )}
                  aria-pressed={isActive}
                  title={stage.sla_state ? SLA_LABEL[stage.sla_state] : undefined}
                >
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
                      />
                    )}
                  </div>

                  <div className="flex items-baseline gap-1.5">
                    <span
                      className={cn(
                        'text-xl font-semibold tabular-nums leading-none',
                        isActive ? 'text-ig-accent' : 'text-ig-fg-strong',
                      )}
                    >
                      {stage.count}
                    </span>
                    <span className="text-[10px] text-ig-fg-muted">
                      {stage.count === 1 ? 'item' : 'itens'}
                    </span>
                  </div>
                </button>

                {index < stages.length - 1 && (
                  <div className="flex items-center text-ig-fg-subtle px-0.5">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </HudPanel>
  );
}
