'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { parseBadgeCount } from '@/components/decisions/view';

/**
 * Quantas decisões aguardam a pessoa logada — o selo de "Decisões" na
 * sidebar e no cabeçalho.
 *
 * O número é DERIVADO (GET /api/decisions/count, a mesma função da caixa),
 * nunca guardado: não há realtime nem linha de notificação que possa
 * divergir da alçada. Por isso ele se refaz nos momentos em que pode ter
 * mudado:
 *   • ao montar e a cada troca de rota;
 *   • quando um ato governado avisa `commercial:changed` (inclusive os de Decisões);
 *   • quando a janela volta ao foco ou a aba volta a ficar visível;
 *   • a cada 60 s, SÓ com a aba visível — aba escondida não consulta nada.
 *
 * Sidebar e cabeçalho usam o mesmo número: um armazém por módulo, uma
 * consulta por gatilho (gatilhos no mesmo instante se fundem), a leitura em
 * curso é abortada quando outra começa ou quando ninguém mais escuta. Falha
 * de rede nunca lança nem zera o selo: fica o último número conhecido.
 */
const COUNT_URL = '/api/decisions/count';
const CHANGED_EVENT = 'commercial:changed';
const POLL_MS = 60_000;
const COALESCE_MS = 60;

let count = 0;
/** Já houve uma leitura (ou a certeza de "sem sessão")? Antes disso, 0 significa "não sei". */
let known = false;
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let poll: ReturnType<typeof setInterval> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

function publish(next: number) {
  if (next === count && known) return;
  count = next;
  known = true;
  listeners.forEach((l) => l());
}

async function load() {
  controller?.abort();
  const own = new AbortController();
  controller = own;
  try {
    const response = await fetch(COUNT_URL, { signal: own.signal, cache: 'no-store', headers: { accept: 'application/json' } });
    // Sem sessão ou sem organização não há o que decidir: selo apagado.
    if (response.status === 401 || response.status === 403) { publish(0); return; }
    if (!response.ok) return;
    const next = parseBadgeCount(await response.json().catch(() => null));
    if (next !== null && !own.signal.aborted) publish(next);
  } catch {
    // Rede ou aborto: mantém o último número conhecido.
  } finally {
    if (controller === own) controller = null;
  }
}

/** Pede uma releitura; pedidos no mesmo instante (rota + foco + evento) viram uma consulta só. */
export function refreshDecisionBadge() {
  if (typeof window === 'undefined' || pending) return;
  pending = setTimeout(() => { pending = null; void load(); }, COALESCE_MS);
}

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

function startPolling() {
  if (poll || !visible()) return;
  poll = setInterval(() => { if (visible()) refreshDecisionBadge(); }, POLL_MS);
}
function stopPolling() {
  if (poll) clearInterval(poll);
  poll = null;
}
function onVisibility() {
  if (visible()) { refreshDecisionBadge(); startPolling(); } else stopPolling();
}

function attach() {
  window.addEventListener(CHANGED_EVENT, refreshDecisionBadge);
  window.addEventListener('focus', refreshDecisionBadge);
  document.addEventListener('visibilitychange', onVisibility);
  startPolling();
}
function detach() {
  window.removeEventListener(CHANGED_EVENT, refreshDecisionBadge);
  window.removeEventListener('focus', refreshDecisionBadge);
  document.removeEventListener('visibilitychange', onVisibility);
  stopPolling();
  if (pending) { clearTimeout(pending); pending = null; }
  controller?.abort();
  controller = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detach();
  };
}
const idle = () => () => undefined;
const snapshot = () => count;
const serverSnapshot = () => 0;
const knownSnapshot = () => known;
const knownServerSnapshot = () => false;

/** Número de decisões acionáveis da pessoa (0 enquanto não se sabe). `enabled=false` não consulta nada. */
export function useDecisionBadge(enabled = true): number {
  const pathname = usePathname();
  const value = useSyncExternalStore(enabled ? subscribe : idle, snapshot, serverSnapshot);
  useEffect(() => {
    if (enabled) refreshDecisionBadge();
  }, [enabled, pathname]);
  return enabled ? value : 0;
}

/**
 * O mesmo número do selo, com a informação de que ele JÁ é conhecido. Telas
 * que mostram a contagem em destaque (o Dashboard) usam isto para não exibir
 * um "0" antes da primeira leitura — mesma loja, mesma consulta, mesmo número.
 */
export function useDecisionBadgeState(enabled = true): { count: number; known: boolean } {
  const value = useDecisionBadge(enabled);
  const isKnown = useSyncExternalStore(enabled ? subscribe : idle, knownSnapshot, knownServerSnapshot);
  return { count: value, known: enabled && isKnown };
}
