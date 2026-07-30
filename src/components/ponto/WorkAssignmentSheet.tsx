'use client';

/**
 * Escolha de projeto e etapa do cronograma na ENTRADA.
 *
 * Regra preservada: jornada e apontamento começam juntos — quem tem
 * alocação escolhe onde vai trabalhar antes da selfie; quem não tem
 * registra apenas a jornada.
 */

import * as React from 'react';
import { Briefcase, LayoutList } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AllocationRecord, TimelineStage } from '@/lib/ponto/attendance-types';
import { PontoButton, Spinner } from './primitives';
import { PontoSheet } from './PontoSheet';

export interface WorkAssignmentSheetProps {
  open: boolean;
  /**
   * `entry` = escolha na entrada da jornada.
   * `switch` = troca de etapa com a atividade já em andamento (fecha as
   * horas da etapa anterior e abre a nova).
   */
  mode?: 'entry' | 'switch';
  allocations: readonly AllocationRecord[];
  stages: readonly TimelineStage[];
  stagesLoading: boolean;
  selectedProject: string | null;
  selectedStage: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectStage: (stageId: string | null) => void;
  onConfirm: (withProject: boolean) => void;
  onOpenChange: (open: boolean) => void;
}

export function WorkAssignmentSheet({
  open,
  mode = 'entry',
  allocations,
  stages,
  stagesLoading,
  selectedProject,
  selectedStage,
  onSelectProject,
  onSelectStage,
  onConfirm,
  onOpenChange,
}: WorkAssignmentSheetProps) {
  const selected = allocations.find((a) => a.project_id === selectedProject);
  const switching = mode === 'switch';

  return (
    <PontoSheet
      open={open}
      onOpenChange={onOpenChange}
      title={switching ? 'Onde você está trabalhando agora?' : 'Onde você vai trabalhar?'}
      description={
        switching
          ? 'As horas da etapa anterior são fechadas e o apontamento continua na nova etapa.'
          : 'A entrada registra sua jornada e já inicia o apontamento no projeto.'
      }
      footer={
        <div className="space-y-2">
          <PontoButton variant="primary" icon={Briefcase} onClick={() => onConfirm(true)}>
            {switching
              ? 'Atualizar etapa'
              : `Continuar${selected?.role_title ? ` · ${selected.role_title}` : ''}`}
          </PontoButton>
          {switching ? null : (
            <PontoButton variant="ghost" onClick={() => onConfirm(false)}>
              Entrar sem apontar projeto agora
            </PontoButton>
          )}
        </div>
      }
    >
      <fieldset className="pb-2">
        <legend className="mb-2 text-ig-label uppercase text-ig-fg-muted">Projeto</legend>
        <div className="space-y-1.5">
          {allocations.map((allocation) => {
            const active = selectedProject === allocation.project_id;
            return (
              <button
                key={allocation.project_id}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectProject(allocation.project_id)}
                className={cn(
                  'flex min-h-[56px] w-full items-center justify-between gap-3 rounded-[var(--ig-radius-md)] border px-4 py-3 text-left',
                  'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
                  active
                    ? 'border-[color-mix(in_oklab,var(--ig-accent)_50%,transparent)] bg-ig-accent-weak'
                    : 'border-ig-border bg-ig-panel hover:bg-ig-panel-hover',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-ig-body-sm font-semibold text-ig-fg-strong">
                    {allocation.role_title ?? 'Colaborador'}
                  </span>
                  <span className="ig-tabular mt-0.5 block truncate text-ig-caption text-ig-fg-muted">
                    {allocation.project_id} · {allocation.planned_percentage}%
                  </span>
                </span>
                {active ? (
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ig-accent" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      {selectedProject ? (
        <fieldset className="pb-4">
          <legend className="mb-2 flex items-center gap-1.5 text-ig-label uppercase text-ig-fg-muted">
            <LayoutList className="h-3 w-3" aria-hidden="true" /> Etapa do cronograma
          </legend>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            <button
              type="button"
              aria-pressed={selectedStage === null}
              onClick={() => onSelectStage(null)}
              className={cn(
                'min-h-[44px] w-full rounded-[var(--ig-radius-sm)] px-3 py-2.5 text-left text-ig-body-sm',
                'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
                selectedStage === null ? 'bg-ig-accent-weak text-ig-accent' : 'text-ig-fg hover:bg-ig-panel-hover',
              )}
            >
              Sem etapa específica
            </button>
            {stagesLoading ? (
              <p className="flex items-center gap-2 px-3 py-2 text-ig-caption text-ig-fg-subtle">
                <Spinner className="h-3.5 w-3.5" /> Carregando etapas…
              </p>
            ) : stages.length === 0 ? (
              <p className="px-3 py-2 text-ig-caption text-ig-fg-subtle">
                Sem cronograma importado para este projeto.
              </p>
            ) : (
              stages.map((stage) => {
                const active = selectedStage === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectStage(stage.id)}
                    style={{ paddingLeft: `${12 + Math.min(stage.outline_level, 4) * 12}px` }}
                    className={cn(
                      'flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[var(--ig-radius-sm)] py-2.5 pr-3 text-left',
                      'focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]',
                      active ? 'bg-ig-accent-weak' : 'hover:bg-ig-panel-hover',
                    )}
                  >
                    <span className={cn('min-w-0 truncate text-ig-body-sm', active ? 'text-ig-accent' : 'text-ig-fg')}>
                      {stage.wbs_code ? <span className="mr-1.5 text-ig-fg-subtle">{stage.wbs_code}</span> : null}
                      {stage.title}
                    </span>
                    <span className="ig-tabular shrink-0 text-ig-caption text-ig-fg-muted">
                      {Math.round(stage.percent_complete)}%
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </fieldset>
      ) : null}
    </PontoSheet>
  );
}
