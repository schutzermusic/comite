'use client';

import React from 'react';
import { X } from 'lucide-react';
import { HudPanel, HudButton } from '@/components/hud';
import { cn } from '@/lib/utils';
import type {
  DeliberacaoStatus,
  DeliberacaoPrioridade,
  SlaStatus,
} from './types';

interface DecisionFilterRailProps {
  statusFilter: DeliberacaoStatus | 'all';
  onStatusChange: (v: DeliberacaoStatus | 'all') => void;
  prioridadeFilter: DeliberacaoPrioridade | 'all';
  onPrioridadeChange: (v: DeliberacaoPrioridade | 'all') => void;
  comiteFilter: string;
  onComiteChange: (v: string) => void;
  slaFilter: SlaStatus | 'all';
  onSlaChange: (v: SlaStatus | 'all') => void;
  responsavelFilter: string;
  onResponsavelChange: (v: string) => void;
  comiteOptions: string[];
  responsavelOptions: string[];
  onClear: () => void;
  activeCount: number;
}

const STATUS_OPTIONS: { value: DeliberacaoStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'rascunho', label: 'Rascunho' },
  { value: 'em_revisao', label: 'Em Revisão' },
  { value: 'em_votacao', label: 'Em Votação' },
  { value: 'aguardando_ata', label: 'Aguardando Ata' },
  { value: 'em_execucao', label: 'Em Execução' },
  { value: 'concluida', label: 'Concluída' },
];

const PRIORIDADE_OPTIONS: { value: DeliberacaoPrioridade | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'critica', label: 'Crítica' },
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Média' },
  { value: 'baixa', label: 'Baixa' },
];

const SLA_OPTIONS: { value: SlaStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'on_track', label: 'No prazo' },
  { value: 'at_risk', label: 'Em risco' },
  { value: 'overdue', label: 'Atrasada' },
];

const SELECT_CLASS = cn(
  'w-full rounded-md border border-ig-border bg-ig-panel px-2.5 py-1.5',
  'text-xs text-ig-fg-strong',
  'focus:outline-none focus:border-ig-border-focus',
  'transition-colors',
);

const FILTER_LABEL = 'text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted mb-2';

export function DecisionFilterRail({
  statusFilter,
  onStatusChange,
  prioridadeFilter,
  onPrioridadeChange,
  comiteFilter,
  onComiteChange,
  slaFilter,
  onSlaChange,
  responsavelFilter,
  onResponsavelChange,
  comiteOptions,
  responsavelOptions,
  onClear,
  activeCount,
}: DecisionFilterRailProps) {
  return (
    <HudPanel elevation={2} noPadding>
      <div className="p-4 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-ig-fg-strong">
            Filtros
          </h3>
          {activeCount > 0 && (
            <HudButton
              variant="ghost"
              size="sm"
              leftIcon={<X className="w-3 h-3" />}
              onClick={onClear}
            >
              Limpar ({activeCount})
            </HudButton>
          )}
        </div>

        {/* Status pills */}
        <div>
          <p className={FILTER_LABEL}>Status</p>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map((opt) => {
              const active = statusFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onStatusChange(opt.value)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition-colors',
                    active
                      ? 'border-ig-border-focus bg-ig-accent-weak text-ig-accent'
                      : 'border-ig-border bg-ig-panel text-ig-fg-muted hover:border-ig-border-strong hover:text-ig-fg',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Prioridade */}
        <div>
          <p className={FILTER_LABEL}>Prioridade</p>
          <select
            value={prioridadeFilter}
            onChange={(e) => onPrioridadeChange(e.target.value as DeliberacaoPrioridade | 'all')}
            className={SELECT_CLASS}
          >
            {PRIORIDADE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Comitê */}
        <div>
          <p className={FILTER_LABEL}>Comitê</p>
          <select
            value={comiteFilter}
            onChange={(e) => onComiteChange(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="all">Todos</option>
            {comiteOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* SLA */}
        <div>
          <p className={FILTER_LABEL}>SLA</p>
          <select
            value={slaFilter}
            onChange={(e) => onSlaChange(e.target.value as SlaStatus | 'all')}
            className={SELECT_CLASS}
          >
            {SLA_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Responsável */}
        <div>
          <p className={FILTER_LABEL}>Responsável</p>
          <select
            value={responsavelFilter}
            onChange={(e) => onResponsavelChange(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="all">Todos</option>
            {responsavelOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
    </HudPanel>
  );
}
