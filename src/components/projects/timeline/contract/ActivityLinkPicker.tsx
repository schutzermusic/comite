'use client';

/**
 * "Qual atividade do cronograma representa este evento de medição?"
 *
 * ─── Por que uma busca, e não uma lista ───────────────────────────────────
 *
 * O cronograma real de JA10182283/2025 tem 69 atividades; obras maiores
 * passam de trezentas. Uma lista rolável faz a pessoa procurar com o olho; um
 * campo de busca deixa ela procurar com o que já sabe — "databook",
 * "estatórico", "5.2". A busca casa EDT e título ao mesmo tempo, porque
 * quem conhece a obra pensa pelos dois.
 *
 * ─── O que ele não faz ────────────────────────────────────────────────────
 *
 * Não cria atividade. Se a etapa não existe no cronograma, a resposta certa é
 * importar o cronograma corrigido — não inventar uma linha para o contrato se
 * apoiar. Por isso não há "criar nova atividade" aqui.
 *
 * Fases e resumos aparecem, e ficam marcados: um evento contratual costuma
 * casar com uma entrega, mas há contratos cuja parcela vence no fim de uma
 * fase inteira. Escondê-las decidiria pela pessoa.
 */

import React, { useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimelineItem } from '@/lib/types/project-timeline';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** Sem acento e sem caixa — "estatorico" precisa achar "estatórico". */
function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

interface Props {
  readonly items: readonly TimelineItem[];
  readonly busyItemId: string | null;
  readonly disabled: boolean;
  readonly onPick: (item: TimelineItem) => void;
}

const MAX_VISIBLE = 40;

export function ActivityLinkPicker({ items, busyItemId, disabled, onPick }: Props) {
  const [query, setQuery] = useState('');

  const candidates = useMemo(() => {
    const active = items.filter((i) => i.isActive && !i.deletedAt);
    const q = fold(query.trim());
    if (!q) return active.slice(0, MAX_VISIBLE);
    const terms = q.split(/\s+/);
    return active
      .filter((i) => {
        const hay = fold(`${i.wbsCode ?? ''} ${i.title}`);
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, MAX_VISIBLE);
  }, [items, query]);

  const active = items.filter((i) => i.isActive && !i.deletedAt).length;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-lg border border-ig-border bg-ig-panel px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar atividade ou EDT…"
          className="w-full bg-transparent text-[13px] text-ig-fg outline-none placeholder:text-ig-fg-disabled"
          disabled={disabled}
        />
      </label>

      {candidates.length === 0 ? (
        <p className="py-3 text-center text-[12px] text-ig-fg-muted">
          Nenhuma atividade do cronograma corresponde a “{query}”.
        </p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
          {candidates.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={disabled || busyItemId !== null}
                onClick={() => onPick(item)}
                className={cn(
                  'flex w-full items-center gap-2 rounded border border-ig-border-subtle px-2 py-1.5 text-left',
                  'transition-colors hover:bg-ig-panel-hover disabled:opacity-50',
                )}
              >
                {busyItemId === item.id
                  ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                  : (
                    <span className="w-14 shrink-0 font-mono text-[11px] text-ig-fg-subtle">
                      {item.wbsCode ?? '—'}
                    </span>
                  )}
                <span className="min-w-0 flex-1 truncate text-[12px] text-ig-fg-strong">
                  {item.title}
                  {item.isSummary && (
                    <span className="ml-1 text-[10px] text-ig-fg-muted">(fase)</span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums text-[11px] text-ig-fg-muted">
                  {fmtDate(item.plannedFinish)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-ig-fg-subtle">
        {candidates.length < active
          ? `Mostrando ${candidates.length} de ${active} atividades.`
          : `${active} atividades no cronograma.`}
        {' '}O vínculo passa a valer imediatamente e sobrevive às próximas importações.
      </p>
    </div>
  );
}
