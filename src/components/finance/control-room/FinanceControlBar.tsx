'use client';

import React from 'react';
import {
  CalendarRange,
  Layers,
  FolderKanban,
  FileText,
  GitBranch,
  Sparkles,
  FileBarChart2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  FinanceFilterBar,
  FinanceFilterChip,
  FinanceFilterRange,
  FILTER_CHIP_SHELL,
  FILTER_CHIP_LABEL,
  CHIP_DIVIDER,
  FILTER_CHIP_LAYOUT,
} from '@/components/finance/shared';
import { SCENARIOS, type ControlRoomFilters, type ScenarioKey } from './types';
import { generatePeriodOptions } from './helpers';

interface FinanceControlBarProps {
  filters: ControlRoomFilters;
  onChange: (next: Partial<ControlRoomFilters>) => void;
  onSimulate?: () => void;
  onGenerateReport?: () => void;
  projects: { id: string; label: string }[];
  contracts: { id: string; label: string }[];
}

const periods = generatePeriodOptions();

const CONSOLIDATION_OPTIONS: { value: ControlRoomFilters['consolidation']; label: string }[] = [
  { value: 'consolidated', label: 'Consolidado' },
  { value: 'by_bu', label: 'Por Unidade' },
  { value: 'by_project', label: 'Por Projeto' },
];

export function FinanceControlBar({
  filters,
  onChange,
  onSimulate,
  onGenerateReport,
  projects,
  contracts,
}: FinanceControlBarProps) {
  return (
    <FinanceFilterBar
      showPeriod={false}
      showScenario={false}
      extra={
        <>
          <FinanceFilterRange
            icon={<CalendarRange className="h-3.5 w-3.5 shrink-0" />}
            label="Período"
            fromValue={filters.periodFrom}
            toValue={filters.periodTo}
            options={periods}
            onChange={(from, to) => onChange({ periodFrom: from, periodTo: to })}
          />

          <ScenarioPicker
            value={filters.scenario}
            onChange={(scenario) => onChange({ scenario })}
          />

          <FinanceFilterChip
            icon={<FolderKanban className="h-3.5 w-3.5 shrink-0" />}
            label="Projeto"
            value={filters.projectId}
            options={[{ value: 'all', label: 'Todos os projetos' }, ...projects.map((p) => ({ value: p.id, label: p.label }))]}
            onChange={(projectId) => onChange({ projectId })}
          />

          <FinanceFilterChip
            icon={<FileText className="h-3.5 w-3.5 shrink-0" />}
            label="Contrato"
            value={filters.contractId}
            options={[{ value: 'all', label: 'Todos os contratos' }, ...contracts.map((c) => ({ value: c.id, label: c.label }))]}
            onChange={(contractId) => onChange({ contractId })}
          />

          <FinanceFilterChip
            icon={<GitBranch className="h-3.5 w-3.5 shrink-0" />}
            label="Visão"
            value={filters.consolidation}
            options={CONSOLIDATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(value) => onChange({ consolidation: value as ControlRoomFilters['consolidation'] })}
          />
        </>
      }
      rightSlot={
        <>
          <button
            type="button"
            onClick={onSimulate}
            className={cn(
              'group inline-flex items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold tracking-wide sm:px-3.5',
              'bg-[linear-gradient(180deg,rgba(20,184,166,0.18),rgba(15,118,110,0.10))]',
              'text-[color:var(--ig-accent)]',
              'border border-[color:var(--ig-border-focus)]',
              'shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_16px_-8px_rgba(20,184,166,0.55)]',
              'transition-all hover:bg-[linear-gradient(180deg,rgba(20,184,166,0.28),rgba(15,118,110,0.16))]',
              'hover:-translate-y-px',
            )}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span className="sm:hidden">Simular</span>
            <span className="hidden sm:inline">Simular Cenário</span>
          </button>
          <button
            type="button"
            onClick={onGenerateReport}
            className={cn(
              'inline-flex items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold tracking-wide sm:px-3.5',
              'bg-[linear-gradient(180deg,#17C3B2_0%,#0F9C8F_100%)]',
              'text-white',
              'shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_4px_12px_rgba(15,156,143,0.28)]',
              'transition-all hover:brightness-110 hover:-translate-y-px',
            )}
          >
            <FileBarChart2 className="h-3.5 w-3.5 shrink-0" />
            <span className="sm:hidden">Relatório</span>
            <span className="hidden sm:inline">Gerar Relatório do Conselho</span>
          </button>
        </>
      }
    />
  );
}

interface ScenarioPickerProps {
  value: ScenarioKey;
  onChange: (value: ScenarioKey) => void;
}

function ScenarioPicker({ value, onChange }: ScenarioPickerProps) {
  return (
    <div className={cn(FILTER_CHIP_SHELL, FILTER_CHIP_LAYOUT.scenarioSegment, 'overflow-hidden')}>
      <span className={FILTER_CHIP_LABEL}>
        <Layers className="h-3.5 w-3.5 shrink-0" />
        Cenário
      </span>
      <span className={CHIP_DIVIDER} />
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0.5">
        {SCENARIOS.map((s) => {
          const active = s.key === value;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange(s.key)}
              title={s.description}
              className={cn(
                'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-all whitespace-nowrap',
                active
                  ? 'text-[color:var(--ig-bg-canvas)]'
                  : 'text-[color:var(--ig-fg-muted)] hover:text-[color:var(--ig-fg-strong)]',
              )}
              style={
                active
                  ? {
                      background: `linear-gradient(180deg, ${s.color}, color-mix(in oklab, ${s.color} 78%, #000 22%))`,
                      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.18), 0 4px 12px -6px ${s.color}`,
                    }
                  : undefined
              }
            >
              {s.shortLabel}
            </button>
          );
        })}
      </div>
    </div>
  );
}
