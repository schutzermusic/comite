'use client';

/**
 * Barra de recorte do cronograma: busca, responsável, status e chips de flag.
 *
 * Os chips são os MESMOS recortes que os KPIs acionam — clicar no KPI
 * "Atrasadas" acende o chip "Atrasadas". Um só estado, duas portas de entrada,
 * nada de dois conceitos de seleção competindo.
 *
 * Os chips de execução (sem apontamento / trabalhado hoje / ativo agora) só
 * aparecem quando o apontamento é legível — oferecer um filtro que não pode ser
 * avaliado é pior do que não oferecer.
 */

import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { HudInput, HudSelect } from '@/components/hud';
import { SignalChip, type SignalChipTone } from '@/components/ui/signal-chip';
import { TIMELINE_STATUS_LABELS, type TimelineItem, type TimelineItemStatus } from '@/lib/types/project-timeline';
import { useTimelineStore, type TimelineFlag } from './timeline-store';

interface FlagChip {
  flag: TimelineFlag;
  label: string;
  tone: SignalChipTone;
  /** Depende do modelo de execução. */
  execution?: boolean;
}

const FLAG_CHIPS: FlagChip[] = [
  { flag: 'delayed', label: 'Atrasadas', tone: 'critical' },
  { flag: 'at_risk', label: 'Em risco', tone: 'warning' },
  { flag: 'blocked', label: 'Bloqueadas', tone: 'critical' },
  // Prazo, não horas: avaliável sem permissão de timesheet.
  { flag: 'behind_schedule', label: 'Atrás do plano', tone: 'warning' },
  { flag: 'milestones', label: 'Marcos', tone: 'accent' },
  { flag: 'no_responsible', label: 'Sem responsável', tone: 'neutral' },
  { flag: 'no_apontamento', label: 'Sem apontamento', tone: 'warning', execution: true },
  { flag: 'no_recent_activity', label: 'Sem atividade recente', tone: 'warning', execution: true },
  { flag: 'over_effort', label: 'Acima do esforço', tone: 'critical', execution: true },
  { flag: 'worked_today', label: 'Trabalhado hoje', tone: 'info', execution: true },
  { flag: 'active_now', label: 'Ativo agora', tone: 'live', execution: true },
];

export interface TimelineFilterRailProps {
  items: TimelineItem[];
  executionKnown: boolean;
  visibleCount: number;
  totalCount: number;
}

export function TimelineFilterRail({ items, executionKnown, visibleCount, totalCount }: TimelineFilterRailProps) {
  const { filters, setSearch, setResponsible, setStatus, toggleFlag, clearFilters, hasActiveFilters } =
    useTimelineStore();

  // Busca com debounce: digitar re-filtra a árvore inteira a cada tecla.
  const [term, setTerm] = useState(filters.search);
  useEffect(() => {
    const id = setTimeout(() => setSearch(term), 200);
    return () => clearTimeout(id);
  }, [term, setSearch]);

  // Ressincroniza quando o filtro é limpo por fora (KPI, deep link).
  useEffect(() => {
    if (filters.search === '' && term !== '') setTerm('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const responsibleOptions = React.useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of items) {
      for (const a of item.assignments ?? []) {
        if (a.userId && !a.removedAt && a.userName) byId.set(a.userId, a.userName);
      }
    }
    return [
      { value: '', label: 'Todos os responsáveis' },
      ...[...byId.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [items]);

  const statusOptions = React.useMemo(
    () => [
      { value: '', label: 'Todos os status' },
      ...(Object.keys(TIMELINE_STATUS_LABELS) as TimelineItemStatus[]).map((value) => ({
        value,
        label: TIMELINE_STATUS_LABELS[value],
      })),
    ],
    [],
  );

  const chips = FLAG_CHIPS.filter((c) => !c.execution || executionKnown);
  const active = hasActiveFilters();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ig-border bg-ig-panel px-3 py-2">
      <div className="w-56">
        <HudInput
          size="sm"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar atividade ou EDT…"
          leftIcon={<Search className="h-3.5 w-3.5" />}
          aria-label="Buscar atividade"
        />
      </div>

      <div className="w-48">
        <HudSelect
          size="sm"
          value={filters.responsibleUserId ?? ''}
          options={responsibleOptions}
          onChange={(v) => setResponsible(v || null)}
        />
      </div>

      <div className="w-40">
        <HudSelect
          size="sm"
          value={filters.status ?? ''}
          options={statusOptions}
          onChange={(v) => setStatus(v || null)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <SignalChip
            key={chip.flag}
            size="xs"
            tone={chip.tone}
            label={chip.label}
            active={filters.flags.has(chip.flag)}
            onClick={() => toggleFlag(chip.flag)}
          />
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span className="tabular-nums text-[11px] text-ig-fg-muted" data-testid="timeline-visible-count">
          {active ? `${visibleCount} de ${totalCount} atividades` : `${totalCount} atividades`}
        </span>
        {active && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-fg"
          >
            <X className="h-3 w-3" /> Limpar
          </button>
        )}
      </div>
    </div>
  );
}
