'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Lock, RefreshCw, TriangleAlert } from 'lucide-react';
import type { MapLayer, ModuleProps } from '../contract';
import { clamp01 } from './model';

/** Endereço de leitura de um módulo do local. */
export const siteApi = (projectId: string, part: 'plan' | 'supply' | 'billing') =>
  `/api/dashboard/site/${encodeURIComponent(projectId)}/${part}`;

/**
 * Um painel do HUD no estilo do protótipo, no VIDRO de HUD (dashboard-globe.css
 * §material). `enter` (0..1, já com `settle`) multiplica a opacidade e o
 * deslocamento: entra de −18 px e sai para −18 px; abaixo de 0,6 não recebe
 * clique; em 0 sai da renderização (visibility).
 *
 * O conteúdo vai em `.dgm-panel-in`, que é quem ROLA: as camadas do vidro
 * (`::before` grão/especular/cantos, `::after` aresta) são do painel e ficam
 * paradas. `tone` acende a aresta e o brilho interno do painel (estado como
 * luz — nunca um trilho lateral).
 */
export function ModulePanel({ enter, className, label, testId, children, tone }: {
  enter: number; className: string; label: string; testId?: string; children: ReactNode; tone?: 'warn' | 'accent';
}) {
  const a = clamp01(enter);
  const style: CSSProperties = {
    opacity: Math.round(a * 1000) / 1000,
    transform: `translate3d(${((1 - a) * -18).toFixed(2)}px, 0, 0)`,
    pointerEvents: a > 0.6 ? 'auto' : 'none',
    visibility: a <= 0.001 ? 'hidden' : undefined,
  };
  return (
    <section className={`dgm-panel ${className}`} aria-label={label} data-testid={testId} data-tone={tone} style={style}>
      <div className="dgm-panel-in">{children}</div>
    </section>
  );
}

export function Eyebrow({ icon, children, tone }: { icon?: ReactNode; children: ReactNode; tone?: 'warn' }) {
  return <div className="dgm-eyebrow" data-tone={tone}>{icon && <span className="dgm-ico" aria-hidden>{icon}</span>}<span>{children}</span></div>;
}

/**
 * Estado honesto de uma leitura: Restrito (nunca 0), não carregou (nunca
 * "nada aqui"), ou vazio de verdade (a leitura respondeu, e respondeu vazio).
 */
export function StateNote({ kind, title, children, onRetry, testId }: {
  kind: 'restricted' | 'error' | 'empty'; title: string; children?: ReactNode; onRetry?: () => void; testId?: string;
}) {
  return (
    <div className="dgm-note" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'} data-testid={testId}>
      {kind !== 'empty' && (
        <span className="dgm-note-ico" aria-hidden>{kind === 'restricted' ? <Lock size={15} /> : <TriangleAlert size={15} />}</span>
      )}
      <div>
        <b>{title}</b>
        {children && <p>{children}</p>}
        {onRetry && (
          <button type="button" className="dgm-link dgm-link-sm" onClick={onRetry}>
            <RefreshCw size={13} aria-hidden />Tentar de novo
          </button>
        )}
      </div>
    </div>
  );
}

export function SkeletonLines({ lines = 4, label = 'Carregando…' }: { lines?: number; label?: string }) {
  return (
    <div className="dgm-skel" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: `${[62, 88, 74, 92, 58, 80][i % 6]}%` }} />)}
    </div>
  );
}

/**
 * Publica a camada do mapa do módulo quando ELA muda (dado novo), não a cada
 * render da página: a função da página fica numa ref. Não limpa ao desmontar
 * — o módulo que sai ainda pode estar esmaecendo enquanto o que chega já
 * publicou; limpar a camada na troca de módulo é da página.
 */
export function usePublishLayer(onMapLayer: ModuleProps['onMapLayer'], layer: MapLayer | null) {
  const publish = useRef(onMapLayer);
  useEffect(() => { publish.current = onMapLayer; }, [onMapLayer]);
  useEffect(() => { publish.current(layer); }, [layer]);
}

/**
 * Tamanho de um elemento (ResizeObserver) — a escala do Gantt em px para os
 * caminhos SVG. O primeiro valor chega no callback do observador, nunca num
 * setState síncrono dentro do efeito.
 */
export function useElementSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}
