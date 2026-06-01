'use client';

import React from 'react';
import { motion } from 'framer-motion';
import {
  CalendarRange,
  Layers,
  FolderKanban,
  FileText,
  Building2,
  GitBranch,
  Sparkles,
  FileBarChart2,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SCENARIOS, type ControlRoomFilters, type ScenarioKey } from './types';
import { generatePeriodOptions } from './helpers';

interface FinanceControlBarProps {
  filters: ControlRoomFilters;
  onChange: (next: Partial<ControlRoomFilters>) => void;
  onSimulate?: () => void;
  onGenerateReport?: () => void;
  projects: { id: string; label: string }[];
  contracts: { id: string; label: string }[];
  costCenters: { id: string; label: string }[];
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
  costCenters,
}: FinanceControlBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-3 z-30"
    >
      <div className="ig-glass" data-elev={3} data-interactive={undefined} data-sweep>
        <span data-ig-noise="" />
        <span data-ig-specular="" />
        <span data-ig-sweep="" />
        <div data-ig-content="" className="px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 [&_>_div]:h-9">
              <SegmentedRange
                icon={<CalendarRange className="h-3.5 w-3.5" />}
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

              <CompactSelect
                icon={<FolderKanban className="h-3.5 w-3.5" />}
                label="Projeto"
                value={filters.projectId}
                options={[{ id: 'all', label: 'Todos os projetos' }, ...projects]}
                onChange={(projectId) => onChange({ projectId })}
              />

              <CompactSelect
                icon={<FileText className="h-3.5 w-3.5" />}
                label="Contrato"
                value={filters.contractId}
                options={[{ id: 'all', label: 'Todos os contratos' }, ...contracts]}
                onChange={(contractId) => onChange({ contractId })}
              />

              <CompactSelect
                icon={<Building2 className="h-3.5 w-3.5" />}
                label="Centro de Custo"
                value={filters.costCenterId}
                options={[{ id: 'all', label: 'Todos os CC' }, ...costCenters]}
                onChange={(costCenterId) => onChange({ costCenterId })}
              />

              <CompactSelect
                icon={<GitBranch className="h-3.5 w-3.5" />}
                label="Visão"
                value={filters.consolidation}
                options={CONSOLIDATION_OPTIONS.map((o) => ({ id: o.value, label: o.label }))}
                onChange={(value) => onChange({ consolidation: value as ControlRoomFilters['consolidation'] })}
              />
            </div>

            <div className="flex items-center gap-2 [&_>_button]:h-9">
              <button
                type="button"
                onClick={onSimulate}
                className={cn(
                  'group inline-flex items-center gap-2 rounded-lg px-3.5 text-xs font-semibold tracking-wide',
                  'bg-[linear-gradient(180deg,rgba(20,184,166,0.18),rgba(15,118,110,0.10))]',
                  'text-[color:var(--ig-accent)]',
                  'border border-[color:var(--ig-border-focus)]',
                  'shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_16px_-8px_rgba(20,184,166,0.55)]',
                  'transition-all hover:bg-[linear-gradient(180deg,rgba(20,184,166,0.28),rgba(15,118,110,0.16))]',
                  'hover:-translate-y-px',
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Simular Cenário
              </button>
              <button
                type="button"
                onClick={onGenerateReport}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3.5 text-xs font-semibold tracking-wide',
                  'bg-[linear-gradient(180deg,#17C3B2_0%,#0F9C8F_100%)]',
                  'text-white',
                  'shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_4px_12px_rgba(15,156,143,0.28)]',
                  'transition-all hover:brightness-110 hover:-translate-y-px',
                )}
              >
                <FileBarChart2 className="h-3.5 w-3.5" />
                Gerar Relatório do Conselho
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ───── Internals ─────

interface SegmentedRangeProps {
  icon: React.ReactNode;
  label: string;
  fromValue: string;
  toValue: string;
  options: { value: string; label: string }[];
  onChange: (from: string, to: string) => void;
}

function SegmentedRange({ icon, label, fromValue, toValue, options, onChange }: SegmentedRangeProps) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-2 backdrop-blur-sm">
      <span className="flex items-center gap-1.5 pl-1 pr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">
        {icon}
        {label}
      </span>
      <BareSelect
        value={fromValue}
        onChange={(v) => onChange(v, toValue < v ? v : toValue)}
        options={options}
      />
      <span className="text-[10px] text-[color:var(--ig-fg-subtle)]">→</span>
      <BareSelect
        value={toValue}
        onChange={(v) => onChange(fromValue > v ? v : fromValue, v)}
        options={options}
      />
    </div>
  );
}

interface CompactSelectProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (value: string) => void;
}

function CompactSelect({ icon, label, value, options, onChange }: CompactSelectProps) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-2 backdrop-blur-sm">
      <span className="flex items-center gap-1.5 pl-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">
        {icon}
        {label}
      </span>
      <BareSelect
        value={value}
        onChange={onChange}
        options={options.map((o) => ({ value: o.id, label: o.label }))}
      />
    </div>
  );
}

interface BareSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

function BareSelect({ value, onChange, options }: BareSelectProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'appearance-none cursor-pointer rounded-md',
          'bg-transparent pl-2 pr-6 py-1 text-xs font-medium',
          'text-[color:var(--ig-fg-strong)]',
          'border border-transparent hover:border-[color:var(--ig-border-strong)]',
          'focus:outline-none focus:border-[color:var(--ig-border-focus)]',
          'transition-colors',
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[color:var(--ig-bg-raised)] text-[color:var(--ig-fg-strong)]">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-[color:var(--ig-fg-subtle)]" />
    </div>
  );
}

interface ScenarioPickerProps {
  value: ScenarioKey;
  onChange: (value: ScenarioKey) => void;
}

function ScenarioPicker({ value, onChange }: ScenarioPickerProps) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[color:var(--ig-border-strong)] bg-[color:var(--ig-bg-raised)]/60 px-1.5 backdrop-blur-sm">
      <span className="flex items-center gap-1.5 pl-2 pr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ig-fg-subtle)]">
        <Layers className="h-3.5 w-3.5" />
        Cenário
      </span>
      <div className="flex items-center gap-0.5">
        {SCENARIOS.map((s) => {
          const active = s.key === value;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange(s.key)}
              title={s.description}
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-semibold transition-all',
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
