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
 * Navegação do DOSSIÊ — a seção dentro de um contrato.
 *
 * Horizontal, no topo do objeto. A versão anterior era um rail vertical à
 * esquerda, e ele deixou de funcionar quando a navegação da carteira subiu
 * para a sidebar: passaram a existir duas colunas de navegação lado a lado
 * (sidebar do Apex + rail do dossiê), o que empilha níveis laterais demais e
 * ainda espreme o espaço de trabalho do contrato.
 *
 * A distinção entre os dois níveis agora é de EIXO e de peso: a sidebar é
 * vertical, persistente, com fundo próprio; esta é horizontal, presa ao
 * objeto, sem superfície — só um fio embaixo e um sublinhado no item corrente.
 * Navegação de objeto, não de módulo.
 *
 * O papel segue `tablist`: o widget troca painéis no lugar, que é o padrão
 * ARIA de abas, e um leitor de tela deve ouvir "aba 3 de 6". Abaixo de `md`
 * vira um `<select>` — seis destinos não cabem numa linha de telefone, e
 * quebrar em duas linhas destruiria a leitura de nível único.
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
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
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
    <div className={cn('ig-dossier-nav', className)}>
      {/* ── Barra horizontal (md+) ── */}
      <div
        ref={listRef}
        role="tablist"
        aria-orientation="horizontal"
        aria-label="Seções do dossiê"
        data-testid={testId}
        onKeyDown={handleKeyDown}
        className={cn(
          'hidden md:flex md:items-stretch md:gap-1',
          // Rola na horizontal no tablet em vez de quebrar em duas linhas:
          // duas fileiras de abas deixam de ser um nível só de navegação.
          'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
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
              className={cn('ig-dossier-nav-item', active && 'is-active')}
              onClick={() => onSelect(item.id)}
            >
              {item.icon && (
                <span className="ig-dossier-nav-icon" aria-hidden>
                  {item.icon}
                </span>
              )}
              <span className="truncate">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="ig-dossier-nav-badge ig-tabular">{item.badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Seletor compacto (< md) ── */}
      <div className="md:hidden">
        <label htmlFor="dossier-section" className="mb-1 block text-ig-caption text-ig-fg-muted">
          Seção do contrato
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
    </div>
  );
}
