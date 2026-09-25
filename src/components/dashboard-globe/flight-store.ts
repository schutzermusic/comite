/**
 * O ESTADO DO VOO fora do React: o laço do globo publica (no máximo uma vez por
 * quadro) e quem precisa lê — `useFlight()` nos painéis (entrada com `settle`),
 * `getFlight()` em código imperativo. O globo nunca re-renderiza por causa disso.
 *
 * Só notifica quando algo PERCEPTÍVEL mudou: parado, a loja fica em silêncio.
 */
import { useSyncExternalStore } from 'react';
import type { FlightState } from './contract';

const INITIAL: FlightState = Object.freeze({ flying: false, arrive: 1, dist: 5200, flightId: 0 });

let current: FlightState = INITIAL;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = (): FlightState => INITIAL;

/** O estado atual do voo (mesma referência enquanto nada mudar). */
export function getFlight(): FlightState {
  return current;
}

/** O estado do voo como hook (useSyncExternalStore). */
export function useFlight(): FlightState {
  return useSyncExternalStore(subscribe, getFlight, serverSnapshot);
}

function sameFlight(a: FlightState, b: FlightState): boolean {
  return (
    a.flying === b.flying &&
    a.flightId === b.flightId &&
    Math.abs(a.arrive - b.arrive) < 1e-4 &&
    Math.abs(a.dist - b.dist) <= Math.max(1e-6, Math.abs(a.dist) * 1e-3)
  );
}

function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * Publica o estado do voo (uso do motor do globo). Devolve `true` quando
 * notificou. Valores não-finitos nunca saem daqui.
 */
export function publishFlight(next: FlightState): boolean {
  const clean: FlightState = {
    flying: Boolean(next.flying),
    arrive: Math.min(1, Math.max(0, finiteOr(next.arrive, 1))),
    dist: Math.max(0, finiteOr(next.dist, current.dist)),
    flightId: Number.isFinite(next.flightId) ? Math.trunc(next.flightId) : current.flightId,
  };
  if (sameFlight(current, clean)) return false;
  current = Object.freeze(clean);
  for (const listener of Array.from(listeners)) listener();
  return true;
}

/** Fim do globo (desmontagem): nada mais voa. Mantém `flightId` e a distância. */
export function settleFlight(): void {
  publishFlight({ ...current, flying: false, arrive: 1 });
}
