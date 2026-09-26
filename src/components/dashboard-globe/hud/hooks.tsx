'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Ganchos do HUD — ambiente (tela, movimento reduzido, tema) e leitura dos
 * endpoints do local. Nada aqui lê o banco: tudo passa pelas rotas
 * `/api/dashboard/*`, que aplicam as mesmas travas da RLS.
 */

/** O mesmo aviso dos atos governados ("algo mudou no servidor"): todo recurso relê. */
const CHANGED_EVENT = 'commercial:changed';

/* ── Mídia (largura, movimento reduzido) ─────────────────────────────── */

/** `matchMedia` como loja externa: no servidor e na hidratação, `false`. */
export function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
    const mq = window.matchMedia(query);
    mq.addEventListener('change', cb);
    return () => mq.removeEventListener('change', cb);
  }, [query]);
  const get = useCallback(() => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches), [query]);
  return useSyncExternalStore(subscribe, get, () => false);
}

/* ── Tema da aplicação (html.light / html.dark) ──────────────────────── */

function subscribeTheme(cb: () => void) {
  if (typeof document === 'undefined') return () => undefined;
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  return () => mo.disconnect();
}
const themeSnapshot = (): 'light' | 'dark' => (document.documentElement.classList.contains('light') ? 'light' : 'dark');

/** O tema da interface. O globo é sempre escuro; muda só o vidro dos painéis e a vinheta. */
export function useAppTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'dark');
}

/* ── Leitura de um endpoint do local (com o motivo do `ok:false`) ────── */

export type JsonState<T> =
  | { status: 'idle'; data: null; message: null }
  | { status: 'loading'; data: T | null; message: null }
  | { status: 'ready'; data: T; message: null }
  | { status: 'failed'; data: null; message: string };

type Loaded<T> = { key: string; url: string; data: T | null; message: string | null };

/**
 * Lê `url` e devolve o corpo INTEIRO — inclusive `{ ok:false, reason }` (a
 * rota responde 200 com o motivo: restrito, não encontrado, inválido, erro),
 * que a tela diz com as palavras certas. Recarga do mesmo endereço mantém o
 * dado anterior na tela; qualquer ato governado (`commercial:changed`) relê.
 */
export function useJson<T extends { ok: boolean }>(url: string | null): JsonState<T> & { refresh: () => void } {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const key = url ? `${version}:${url}` : null;

  useEffect(() => {
    if (!url || !key) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json' } });
        const body = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
        if (cancelled) return;
        if (body && typeof body.ok === 'boolean' && (body.ok || 'reason' in body)) {
          setLoaded({ key, url, data: body, message: null });
        } else {
          setLoaded({ key, url, data: null, message: body?.error ?? body?.message ?? `O servidor respondeu ${res.status}.` });
        }
      } catch {
        if (!cancelled) setLoaded({ key, url, data: null, message: 'Falha de rede.' });
      }
    })();
    return () => { cancelled = true; };
  }, [url, key]);

  useEffect(() => {
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CHANGED_EVENT, refresh);
  }, [refresh]);

  if (!url) return { status: 'idle', data: null, message: null, refresh };
  const current = loaded && loaded.key === key ? loaded : null;
  if (current) {
    return current.data
      ? { status: 'ready', data: current.data, message: null, refresh }
      : { status: 'failed', data: null, message: current.message ?? 'Não foi possível carregar.', refresh };
  }
  // Mesmo endereço relendo: o dado anterior segue na tela até o novo chegar.
  const stale = loaded && loaded.url === url && loaded.data ? loaded.data : null;
  return { status: 'loading', data: stale, message: null, refresh };
}

/* ── Largura do palco ─────────────────────────────────────────────────── */

/** Largura do elemento (ResizeObserver); `null` antes da primeira medida. */
export function useElementWidth(el: HTMLElement | null): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && Number.isFinite(w)) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return width;
}
