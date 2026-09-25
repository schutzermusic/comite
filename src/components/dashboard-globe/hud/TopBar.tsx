'use client';

import { Fragment } from 'react';
import { ChevronRight, PanelRight, Radar, RefreshCw } from 'lucide-react';
import { useSaoPauloClock } from './hooks';

export interface Crumb { label: string; onClick?: () => void; current?: boolean }

/**
 * BARRA SUPERIOR do Dashboard (`.ap-top` do protótipo), dentro do palco:
 *  • esquerda — o caminho `Portfólio › Projeto › Módulo`; cada trecho volta
 *    àquele nível;
 *  • direita — "● OPERAÇÃO AO VIVO" com o relógio REAL de São Paulo, a hora
 *    da leitura ("Atualizado às 14:31") e Recarregar.
 */
export function TopBar({ crumbs, updated, onReload, reloading, panelToggle }: {
  crumbs: Crumb[];
  updated: string | null;
  onReload: () => void;
  reloading: boolean;
  /** 768–1179 px: a coluna direita recolhe num botão "Painel". */
  panelToggle?: { open: boolean; onToggle: () => void } | null;
}) {
  const clock = useSaoPauloClock();
  const [date, time] = clock ? clock.split(' · ') : ['', ''];
  return (
    <header className="dg-top">
      <span className="dg-mark" aria-hidden><Radar size={18} strokeWidth={1.9} /></span>
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
        <span className="dg-live" role="timer" aria-live="off" aria-label={clock ? `Operação ao vivo — ${date}, ${time} (horário de São Paulo)` : 'Operação ao vivo'}>
          <i aria-hidden />
          <span className="dg-live-word" aria-hidden>Operação ao vivo</span>
          <span className="dg-live-clock num" aria-hidden suppressHydrationWarning>
            <span className="dg-live-date">{date}</span>{clock ? <span className="dg-live-dot"> · </span> : null}{time}
          </span>
        </span>
        {updated && <span className="dg-updated">{updated}</span>}
        {panelToggle && (
          <button type="button" className="dg-iconbtn dg-panel-toggle" onClick={panelToggle.onToggle}
            aria-pressed={panelToggle.open} aria-label={panelToggle.open ? 'Recolher o painel lateral' : 'Mostrar o painel lateral'}>
            <PanelRight size={16} aria-hidden /><span>Painel</span>
          </button>
        )}
        <button type="button" className="dg-iconbtn" onClick={onReload} aria-label={reloading ? 'Recarregando a situação…' : 'Recarregar a situação'}
          title={reloading ? 'Recarregando…' : 'Recarregar'}>
          <RefreshCw size={15} className={reloading ? 'dg-spin' : undefined} aria-hidden />
        </button>
      </div>
    </header>
  );
}
