'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { settle } from '../contract';
import { getFlight } from '../flight-store';

/**
 * O MOVIMENTO DOS PAINÉIS — o do protótipo (`app.js:105-109, 485-495, 597-601`).
 *
 *  • cada grupo de painéis se aproxima do alvo por um fade exponencial
 *    (taxa 6: 95% em 500 ms, independente da taxa de quadros);
 *  • painéis do LOCAL e dos MÓDULOS esperam a câmera: `settle(alpha, arrive)`
 *    — nada até 55% do voo, rampa linear até o pouso;
 *  • entram de −18 px; o portfólio não espera (entra já no primeiro quadro);
 *  • `prefers-reduced-motion`: só opacidade, ≤ 150 ms, sem deslocamento.
 *
 * O voo vem de `getFlight()` (loja do globo). Sem globo (falhou, ou ainda
 * não montou) e sem voo novo em 450 ms, o painel considera a câmera pousada —
 * o HUD nunca fica preso esperando um voo que não vem.
 */

const WAIT_MS = 450;
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);

/** Quanto do voo da vista ATUAL já passou (0..1). Uma instância por troca de vista. */
export class Arrival {
  private startedAt = -1;
  private latched: boolean;

  /**
   * @param base      o `flightId` do globo no instante em que a vista mudou
   * @param immediate sem espera (movimento reduzido, globo indisponível)
   */
  constructor(private readonly base: number, immediate: boolean) {
    this.latched = immediate;
  }

  at(now: number): number {
    if (this.latched) return 1;
    if (this.startedAt < 0) this.startedAt = now;
    const f = getFlight();
    let a: number;
    if (f.flightId !== this.base) a = f.flying ? clamp01(f.arrive) : 1;
    else a = now - this.startedAt < WAIT_MS ? 0 : f.flying ? clamp01(f.arrive) : 1;
    // Pousou uma vez: fica. Um voo posterior (a abertura do globo que carregou
    // depois) não apaga um painel que já entrou.
    if (a >= 1) this.latched = true;
    return a;
  }
}

/** O `flightId` corrente (para marcar o início de uma vista). */
export const currentFlightId = () => getFlight().flightId;

/**
 * O fator de entrada de um grupo de painéis (0..1), quadro a quadro.
 * `target` 1 = a vista está ativa; `arrival` = espera a câmera (`null` = não espera).
 */
export function useEnter(target: number, arrival: Arrival | null, reduced: boolean): number {
  const [shown, setShown] = useState(0);
  const value = useRef(0);
  useEffect(() => {
    let raf = 0;
    let last = -1;
    const rate = reduced ? 22 : 6;
    const step = (now: number) => {
      const dt = last < 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const v = value.current;
      let next = v + (target - v) * (1 - Math.exp(-dt * rate));
      if (Math.abs(target - next) < 0.002) next = target;
      value.current = next;
      const a = arrival ? arrival.at(now) : 1;
      setShown(arrival ? settle(next, a) : next);
      if (next !== target || a < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, arrival, reduced]);
  return shown;
}

/**
 * Estilo de um grupo de painéis a partir do fator: opacidade e −18 px → 0
 * (só opacidade com movimento reduzido); em 0 sai da renderização. O clique
 * enquanto entra (fator ≤ 0,6) é cortado pelo grupo (`data-inert`), porque
 * os painéis reabilitam `pointer-events` sobre a coluna.
 */
export function enterStyle(a: number, reduced: boolean): CSSProperties {
  const k = clamp01(a);
  return {
    opacity: Number(k.toFixed(4)),
    transform: reduced || k >= 1 ? undefined : `translate3d(${(-(1 - k) * 18).toFixed(2)}px, 0, 0)`,
    visibility: k <= 0.001 ? 'hidden' : undefined,
  };
}
