'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Link2, X } from 'lucide-react';
import { HudSelect } from '@/components/hud';
import type { RelatedModule } from '@/lib/types/agenda';
import { RELATED_MODULE_LABELS } from '@/lib/types/agenda';
import { loadModuleOptions, MODULE_FIELD, type ModuleOption, type RelatedLinks } from './module-links';

const MODULES = Object.keys(RELATED_MODULE_LABELS) as RelatedModule[];

/**
 * "Vincular a módulo": choose a module, then the specific item. Selected
 * links show as removable chips. Modules whose data the user cannot read
 * (RLS) simply offer no options and stay silent.
 */
export function ModuleLinkPicker({
  value,
  onChange,
}: {
  value: RelatedLinks;
  onChange: (next: RelatedLinks) => void;
}) {
  const [module, setModule] = useState<RelatedModule | ''>('');
  const [options, setOptions] = useState<ModuleOption[]>([]);
  // Module the current options belong to — loading = mismatch with `module`.
  const [loadedFor, setLoadedFor] = useState<RelatedModule | ''>('');
  // Chip labels survive switching to another module.
  const [labels, setLabels] = useState<Record<string, string>>({});

  const loading = module !== '' && loadedFor !== module;

  useEffect(() => {
    if (!module) return;
    let cancelled = false;
    loadModuleOptions(module).then((opts) => {
      if (cancelled) return;
      setOptions(opts);
      setLoadedFor(module);
    });
    return () => {
      cancelled = true;
    };
  }, [module]);

  const selectedChips = useMemo(
    () =>
      MODULES.flatMap((m) => {
        const id = value[MODULE_FIELD[m] as keyof RelatedLinks];
        return id ? [{ module: m, id }] : [];
      }),
    [value],
  );

  const setLink = (m: RelatedModule, id: string | null) => {
    if (id) {
      const label = options.find((o) => o.id === id)?.label;
      if (label) setLabels((prev) => ({ ...prev, [id]: label }));
    }
    onChange({ ...value, [MODULE_FIELD[m]]: id });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <HudSelect
          label="Módulo"
          value={module}
          onChange={(v) => setModule(v as RelatedModule | '')}
          options={[
            { value: '', label: 'Selecionar módulo…' },
            ...MODULES.map((m) => ({ value: m, label: RELATED_MODULE_LABELS[m] })),
          ]}
        />
        <HudSelect
          label="Item"
          value={module ? ((value[MODULE_FIELD[module] as keyof RelatedLinks] as string | null | undefined) ?? '') : ''}
          onChange={(v) => {
            if (module && !loading) setLink(module, v || null);
          }}
          options={[
            {
              value: '',
              label: loading
                ? 'Carregando…'
                : !module
                  ? 'Escolha um módulo'
                  : options.length === 0
                    ? 'Nenhum item disponível'
                    : 'Selecionar item…',
            },
            ...options.map((o) => ({ value: o.id, label: o.label })),
          ]}
        />
      </div>

      {selectedChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedChips.map((chip) => (
            <span
              key={chip.module}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-ig-border bg-ig-panel px-2 py-1 text-xs text-ig-fg-strong"
            >
              <Link2 className="h-3 w-3 shrink-0 text-ig-accent" />
              <span className="font-medium text-ig-fg-muted">{RELATED_MODULE_LABELS[chip.module]}:</span>
              <span className="truncate">
                {labels[chip.id] ?? options.find((o) => o.id === chip.id)?.label ?? chip.id.slice(0, 8)}
              </span>
              <button
                type="button"
                onClick={() => setLink(chip.module, null)}
                className="shrink-0 text-ig-fg-muted hover:text-ig-danger"
                aria-label={`Remover vínculo com ${RELATED_MODULE_LABELS[chip.module]}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
