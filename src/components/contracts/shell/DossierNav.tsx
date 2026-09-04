'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface DossierNavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Contagem real do domínio. `undefined` = nada a contar; nunca um 0 inventado. */
  badge?: number;
}

export interface DossierNavProps {
  items: DossierNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Id do painel controlado, para amarrar `aria-controls`. */
  panelId: string;
  className?: string;
  'data-testid'?: string;
}

/**
 * Navegação LOCAL do dossiê — a seção dentro de um contrato.
 *
 * Por que um rail vertical e não mais uma barra de abas: a carteira já usa
 * abas horizontais para trocar de área do MÓDULO. Repetir a mesma linguagem um
 * nível abaixo fazia "Obrigações da carteira" e "Obrigações deste contrato"
 * terem exatamente a mesma aparência — e a pergunta "eu ainda estou dentro
 * deste contrato?" ficava sem resposta visual.
 *
 * O PAPEL continua sendo `tablist`: o rail troca painéis no lugar, que é
 * literalmente o padrão ARIA de abas, e um leitor de tela deve ouvir "aba 3 de
 * 6". O que muda é a ORIENTAÇÃO e a forma — `aria-orientation="vertical"`, as
 * setas ↑↓ percorrendo — não a semântica. Hierarquia se resolve no desenho,
 * não trocando o papel por um que descreve mal o widget.
 *
 * Ele é secundário à sidebar global: sem fundo próprio, sem altura de tela,
 * ancorado por um fio vertical. Abaixo de `lg` vira um seletor compacto —
 * seis destinos empilhados num telefone empurrariam o conteúdo para fora da
 * primeira tela.
 */
export function DossierNav({
  items,
  activeId,
  onSelect,
  panelId,
  className,
  'data-testid': testId,
}: DossierNavProps) {
  const listRef = React.useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    let next: DossierNavItem | undefined;

    if (step !== 0) {
      const current = items.findIndex((item) => item.id === activeId);
      next = items[(current + step + items.length) % items.length];
    } else if (event.key === 'Home') {
      next = items[0];
    } else if (event.key === 'End') {
      next = items[items.length - 1];
    }
    if (!next) return;

    event.preventDefault();
    onSelect(next.id);
    listRef.current?.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(next.id)}"]`)?.focus();
  };

  return (
    <>
      {/* ── Rail vertical (lg+) ── */}
      <div className={cn('hidden lg:block', className)}>
        <div className="sticky top-4">
          <p className="mb-2 px-3 text-ig-label font-semibold text-ig-fg-subtle">
            Dossiê do contrato
          </p>
          <div
            ref={listRef}
            role="tablist"
            aria-orientation="vertical"
            aria-label="Seções do dossiê"
            data-testid={testId}
            onKeyDown={handleKeyDown}
            className="flex flex-col gap-0.5 border-r border-ig-border-subtle pr-2"
          >
            {items.map((item) => {
              const active = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`dossier-tab-${item.id}`}
                  data-nav-id={item.id}
                  aria-selected={active}
                  aria-controls={panelId}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    'ig-rail-item flex w-full items-center gap-2 rounded-md py-1.5 pl-3 pr-2 text-left text-ig-body-sm',
                    !active && 'text-ig-fg-muted hover:bg-ig-bg-panel-hover hover:text-ig-fg-strong',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ig-border-focus',
                  )}
                >
                  {item.icon && (
                    <span className={cn('shrink-0', active ? 'text-ig-accent' : 'text-ig-fg-subtle')} aria-hidden>
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="ig-tabular shrink-0 text-ig-caption text-ig-fg-subtle">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Seletor compacto (< lg) ── */}
      <div className="lg:hidden">
        <label htmlFor="dossier-section" className="sr-only">
          Seção do dossiê
        </label>
        <select
          id="dossier-section"
          value={activeId}
          onChange={(event) => onSelect(event.target.value)}
          className="h-9 w-full rounded-md border border-ig-border-default bg-ig-bg-base px-3 text-ig-body-sm text-ig-fg-strong"
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
              {item.badge !== undefined && item.badge > 0 ? ` (${item.badge})` : ''}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
