'use client';

/**
 * Sinais do aparelho usados pelo Portal de Ponto: relógio ao vivo,
 * conectividade e localização. Ficam separados do orquestrador de sessão
 * porque cada tela consome um subconjunto diferente.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  captureLocation,
  readLocationPermission,
  type LocationCapture,
} from '@/lib/ponto/client';
import {
  INITIAL_LOCATION_STATE,
  LOW_ACCURACY_THRESHOLD_M,
  type LocationState,
} from '@/lib/ponto/geolocation';

/* ───────────────────── relógio ───────────────────── */

/**
 * Hora corrente com atualização por segundo.
 *
 * O relógio é uma fonte externa ao React, então quem sincroniza é o
 * `useSyncExternalStore`: no servidor a leitura é `null` (o horário do
 * aparelho não existe lá) e, depois da hidratação, passa a acompanhar o
 * tique — sem divergência de marcação nem `setState` dentro de efeito.
 */
export function useLiveClock(intervalMs = 1000): Date | null {
  const store = useMemo(
    () => ({
      subscribe(onChange: () => void) {
        const timer = setInterval(onChange, intervalMs);
        return () => clearInterval(timer);
      },
      // Estável dentro do mesmo intervalo — requisito do useSyncExternalStore.
      getSnapshot: () => Math.floor(Date.now() / intervalMs),
      getServerSnapshot: (): number | null => null,
    }),
    [intervalMs],
  );

  const tick = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return tick == null ? null : new Date(tick * intervalMs);
}

/* ───────────────────── conectividade ───────────────────── */

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

export function useOnlineStatus(): boolean {
  // Otimista no servidor: assumir "offline" piscaria o banner em toda visita.
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/* ───────────────────── localização ───────────────────── */

export interface GeolocationController {
  state: LocationState;
  permission: PermissionState | 'unknown';
  /** Dispara a captura (e o diálogo nativo, se ainda não houve resposta). */
  request: () => Promise<LocationCapture>;
  reset: () => void;
}

function toLocationState(capture: LocationCapture): LocationState {
  return {
    kind: capture.kind,
    point: capture.point,
    updatedAt: capture.point ? Date.now() : null,
    lowAccuracy: (capture.point?.accuracy ?? 0) > LOW_ACCURACY_THRESHOLD_M,
  };
}

export function useGeolocation(): GeolocationController {
  const [state, setState] = useState<LocationState>(INITIAL_LOCATION_STATE);
  const [permission, setPermission] = useState<PermissionState | 'unknown'>('unknown');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readLocationPermission().then((value) => {
      if (cancelled) return;
      setPermission(value);
      // Permissão já negada no navegador = bloqueio persistente; dizemos
      // isso de saída em vez de esperar o colaborador tentar e falhar.
      if (value === 'denied') {
        setState({ ...INITIAL_LOCATION_STATE, kind: 'blocked' });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const request = useCallback(async (): Promise<LocationCapture> => {
    const current = await readLocationPermission();
    if (mounted.current) setPermission(current);
    setState((prev) => ({
      ...prev,
      kind: current === 'granted' ? 'loading' : 'requesting',
    }));

    const capture = await captureLocation();
    // Negar quando o navegador já registrava a negativa = bloqueio; nesse
    // caso a recuperação exige as configurações do site, não outro toque.
    const resolved: LocationCapture =
      capture.kind === 'denied' && current === 'denied' ? { ...capture, kind: 'blocked' } : capture;

    if (mounted.current) {
      setState(toLocationState(resolved));
      void readLocationPermission().then((next) => {
        if (mounted.current) setPermission(next);
      });
    }
    return resolved;
  }, []);

  const reset = useCallback(() => setState(INITIAL_LOCATION_STATE), []);

  return { state, permission, request, reset };
}
