'use client';

import { CalendarRange, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  WORKFORCE_PERIOD_OPTIONS,
  getAvailableCompetenceMonths,
  type WorkforceMonthlyRecord,
  type WorkforcePeriodKey,
  type WorkforcePeriodSelection,
} from '@/lib/workforce/period';

// ─────────────────────────────────────────────────────────────────────
// Compact HUD period selector for the Pessoas & Custos header. Matches the
// existing header chip language (bg-ig-panel + border-ig-border-subtle) so it
// sits cleanly beside "Fonte: eSocial" / cycle chips, light + dark. When
// "Personalizado" is active, two month selects appear inline (no overflow —
// the row wraps).
// ─────────────────────────────────────────────────────────────────────

interface WorkforcePeriodFilterProps {
  value: WorkforcePeriodSelection;
  onChange: (next: WorkforcePeriodSelection) => void;
  /** Série apurada — define quais competências o intervalo pode oferecer. */
  series?: WorkforceMonthlyRecord[];
  className?: string;
}

function monthOptionLabel(competenceMonth: string): string {
  const [y, m] = competenceMonth.split('-').map(Number);
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${names[m - 1]}/${y}`;
}

export function WorkforcePeriodFilter({ value, onChange, series, className }: WorkforcePeriodFilterProps) {
  // As competências oferecidas são as que EXISTEM na série apurada. Antes vinham
  // de uma lista sintética de 24 meses, e escolher um desses meses levava a uma
  // tela de zeros sem explicação.
  const months = getAvailableCompetenceMonths(series);
  const isCustom = value.key === 'custom';
  const customStart = value.customStart ?? months[Math.max(0, months.length - 3)];
  const customEnd = value.customEnd ?? months[months.length - 1];

  const handleKeyChange = (key: WorkforcePeriodKey) => {
    if (key === 'custom') {
      onChange({ key, customStart, customEnd });
    } else {
      onChange({ key });
    }
  };

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-ig-panel border border-ig-border-subtle text-sm text-ig-fg-muted">
        <CalendarRange className="w-4 h-4 text-ig-accent" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">
          Período
        </span>
        <BareSelect
          value={value.key}
          onChange={(v) => handleKeyChange(v as WorkforcePeriodKey)}
          options={WORKFORCE_PERIOD_OPTIONS}
          ariaLabel="Selecionar período"
        />
      </div>

      {isCustom && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg bg-ig-panel border border-ig-border-subtle text-sm text-ig-fg-muted">
          <BareSelect
            value={customStart}
            onChange={(v) => onChange({ key: 'custom', customStart: v, customEnd })}
            options={months.map((m) => ({ value: m, label: monthOptionLabel(m) }))}
            ariaLabel="Início do período personalizado"
          />
          <span className="text-ig-fg-subtle">→</span>
          <BareSelect
            value={customEnd}
            onChange={(v) => onChange({ key: 'custom', customStart, customEnd: v })}
            options={months.map((m) => ({ value: m, label: monthOptionLabel(m) }))}
            ariaLabel="Fim do período personalizado"
          />
        </div>
      )}
    </div>
  );
}

interface BareSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel?: string;
}

function BareSelect({ value, onChange, options, ariaLabel }: BareSelectProps) {
  return (
    <div className="relative min-w-0">
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'appearance-none cursor-pointer rounded-md max-w-[20ch] truncate',
          'bg-transparent pl-1 pr-6 py-0.5 text-sm font-medium',
          'text-ig-fg-strong',
          'border border-transparent hover:border-ig-border-strong',
          'focus:outline-none focus:border-ig-border-focus',
          'transition-colors',
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ig-panel text-ig-fg-strong">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ig-fg-subtle" />
    </div>
  );
}
