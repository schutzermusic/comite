'use client';

import { Fragment } from 'react';
import { ChevronRight, PanelRight, RefreshCw } from 'lucide-react';
import { HudSignal } from '@/components/hud';

export interface Crumb { label: string; onClick?: () => void; current?: boolean }

/**
 * BARRA SUPERIOR do Dashboard, dentro do palco — duas cápsulas de vidro:
 *  • esquerda — o caminho `Portfólio › Projeto › Módulo`; cada trecho volta
 *    àquele nível;
 *  • direita — o sinal do produto "● OPERAÇÃO AO VIVO" (`HudSignal` inline,
 *    tom `live`), a hora da leitura ("Atualizado às 14:31", que também vai no
 *    título do Recarregar, porque some abaixo de 1180 px) e Recarregar.
 *
 * Sem relógio e sem a marca do Apex: a hora que importa é a da LEITURA, e a
 * marca já está no cabeçalho do app.
 */
export function TopBar({ crumbs, updated, onReload, reloading, panelToggle }: {
  crumbs: Crumb[];
  updated: string | null;
  onReload: () => void;
  reloading: boolean;
  /** 768–1179 px: a coluna direita recolhe num botão "Painel". */
  panelToggle?: { open: boolean; onToggle: () => void } | null;
}) {
  const reloadTitle = reloading ? 'Recarregando…' : updated ? `Recarregar · ${updated}` : 'Recarregar';
  return (
    <header className="dg-top">
      <nav className="dg-crumbs" aria-label="Caminho no Dashboard">
        <ol>
          {crumbs.map((c, i) => (
            <Fragment key={`${i}-${c.label}`}>
              {i > 0 && <li className="dg-crumb-sep" aria-hidden><ChevronRight size={14} strokeWidth={2} /></li>}
              <li>
                {c.current || !c.onClick
                  ? <span className="dg-crumb" data-cur="1" aria-current={c.current ? 'page' : undefined} title={c.label}>{c.label}</span>
                  : <button type="button" className="dg-crumb" onClick={c.onClick} title={c.label}>{c.label}</button>}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
      <div className="dg-top-right">
        <span className="dg-live" data-testid="dg-live">
          <HudSignal variant="inline" tone="live" label={<span className="dg-live-word">Operação ao vivo</span>} title="Operação ao vivo" />
        </span>
        {updated && <span className="dg-updated">{updated}</span>}
        {panelToggle && (
          <button type="button" className="dg-iconbtn dg-panel-toggle" onClick={panelToggle.onToggle}
            aria-pressed={panelToggle.open} aria-label={panelToggle.open ? 'Recolher o painel lateral' : 'Mostrar o painel lateral'}>
            <PanelRight size={16} aria-hidden /><span>Painel</span>
          </button>
        )}
        <button type="button" className="dg-iconbtn" onClick={onReload}
          aria-label={reloading ? 'Recarregando a situação…' : updated ? `Recarregar a situação (${updated.toLowerCase()})` : 'Recarregar a situação'}
          title={reloadTitle}>
          <RefreshCw size={15} className={reloading ? 'dg-spin' : undefined} aria-hidden />
        </button>
      </div>
    </header>
  );
}
