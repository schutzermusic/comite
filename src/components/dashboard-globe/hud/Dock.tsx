'use client';

import { useRef, type KeyboardEvent } from 'react';
import { CalendarDays, Map as MapIcon, Network, Radar, ReceiptText } from 'lucide-react';
import type { ModuleId } from '../contract';

const TABS: Array<{ id: ModuleId; label: string; short: string; key: string; Icon: typeof Radar }> = [
  { id: 'overview', label: 'Visão geral', short: 'Visão', key: '1', Icon: Radar },
  { id: 'plan', label: 'Planejar', short: 'Planejar', key: '2', Icon: CalendarDays },
  { id: 'supply', label: 'Supply Chain', short: 'Supply', key: '3', Icon: Network },
  { id: 'billing', label: 'Faturamento', short: 'Faturar', key: '4', Icon: ReceiptText },
];

/**
 * O DOCK dos módulos do local (`.ap-dock` do protótipo): Portfólio (Esc) e as
 * quatro abas — Visão geral (1), Planejar (2), Supply Chain (3), Faturamento
 * (4). É um `tablist` (setas movem entre as abas); some no portfólio com
 * opacidade/deslocamento em 0,4 s. No celular vira a barra de abas de 44 px.
 */
export function Dock({ show, active, onSelect, onPortfolio }: {
  show: boolean;
  active: ModuleId;
  onSelect: (m: ModuleId) => void;
  onPortfolio: () => void;
}) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    const cur = TABS.findIndex((t) => t.id === active);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1
      : (cur + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    e.preventDefault();
    onSelect(TABS[next].id);
    tabs.current[next]?.focus();
  };
  return (
    <nav className="dg-dock" data-show={show ? '1' : undefined} aria-label="Módulos do projeto" aria-hidden={show ? undefined : true} data-testid="dg-dock">
      <button type="button" className="dg-dock-btn dg-dock-home" onClick={onPortfolio} tabIndex={show ? undefined : -1}
        aria-label="Voltar ao portfólio" aria-keyshortcuts="Escape">
        <MapIcon size={17} aria-hidden /><span className="dg-dock-label">Portfólio</span><kbd aria-hidden>Esc</kbd>
      </button>
      <div role="tablist" aria-label="Módulos do projeto" className="dg-dock-tabs" onKeyDown={onKey}>
        {TABS.map((t, i) => (
          <button key={t.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" className="dg-dock-btn"
            aria-selected={active === t.id} data-on={active === t.id ? '1' : undefined} aria-label={t.label}
            tabIndex={show && active === t.id ? 0 : -1} onClick={() => onSelect(t.id)} aria-keyshortcuts={t.key}>
            <t.Icon size={17} aria-hidden />
            <span className="dg-dock-label"><span className="dg-dock-long">{t.label}</span><span className="dg-dock-short" aria-hidden>{t.short}</span></span>
            <kbd aria-hidden>{t.key}</kbd>
          </button>
        ))}
      </div>
    </nav>
  );
}
