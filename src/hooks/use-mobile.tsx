import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

const getSnapshot = () => window.matchMedia(MOBILE_QUERY).matches
const getServerSnapshot = () => false

/**
 * Viewport de celular, seguro para hidratação.
 *
 * O servidor não conhece o viewport e renderiza o desktop; o render de
 * hidratação de cada componente que chama este hook lê o mesmo `false`, e o
 * React relê o viewport real logo em seguida. Isso vale também para quem
 * hidrata depois, dentro de um limite de Suspense (a sidebar do shell) — por
 * isso o componente que decide MARCAÇÃO pelo viewport chama o hook, em vez de
 * herdar um valor que o provider já trocou antes de o limite hidratar.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
