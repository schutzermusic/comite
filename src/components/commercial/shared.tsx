"use client";

import { useCallback, useEffect, useState } from "react";
import { HudPanel } from "@/components/hud";

const COMMERCIAL_CHANGED = "commercial:changed";

/**
 * Avisa todas as telas comerciais abertas de que algo mudou no servidor (um
 * vínculo, um fechamento): cada recurso recarrega sozinho. Dossiês empilhados
 * — a proposta por cima da oportunidade — ficam coerentes sem que um precise
 * conhecer o outro.
 */
export function notifyCommercialChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COMMERCIAL_CHANGED));
}

type Loaded<T> = { key: string; url: string; data: T | null; state: "ready" | "error"; message: string | null };

/** Estado de carregamento/erro em um lugar só — seis áreas, um comportamento. */
export function useCommercialResource<T>(url: string) {
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  // A chave da leitura em curso: enquanto a resposta dela não chega, o estado
  // é "carregando" — derivado, sem setState síncrono dentro do efeito.
  const key = `${version}:${url}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(url);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setLoaded({ key, url, data: null, state: "error",
            message: payload?.error ?? "Não foi possível carregar." });
          return;
        }
        setLoaded({ key, url, data: payload as T, state: "ready", message: null });
      } catch {
        if (!cancelled)
          setLoaded({ key, url, data: null, state: "error", message: "Falha de rede." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, key]);

  useEffect(() => {
    window.addEventListener(COMMERCIAL_CHANGED, refresh);
    return () => window.removeEventListener(COMMERCIAL_CHANGED, refresh);
  }, [refresh]);

  const current = loaded?.key === key ? loaded : null;
  /*
    Recarga do MESMO endereço (depois de um ato, ou de um aviso de mudança)
    mantém a tela montada com o dado anterior até o novo chegar: trocar a
    área inteira por "carregando" desmontaria o dossiê aberto por cima dela.
    Endereço novo começa do zero — o dado de uma proposta nunca aparece sob o
    título de outra.
  */
  const stale = !current && loaded?.url === url && loaded.state === "ready" ? loaded : null;
  const shown = current ?? stale;
  return {
    data: shown?.data ?? null,
    state: shown ? shown.state : ("loading" as const),
    message: current?.message ?? null,
    refresh,
  };
}

export function ResourceState({
  state,
  message,
}: {
  state: string;
  message: string | null;
}) {
  if (state === "loading") {
    // A forma da tela aparece antes dos dados: nada pula quando eles chegam.
    return (
      <div className="crm-skeleton" role="status" aria-label="Carregando…">
        <i className="crm-skel-bar" />
        <i className="crm-skel-panel" />
        <i style={{ width: "40%" }} />
      </div>
    );
  }
  return (
    <HudPanel elevation={1} state="critical" interactive={false}>
      <p className="text-ig-body-sm text-ig-fg-strong">
        {message ?? "Não foi possível carregar."}
      </p>
    </HudPanel>
  );
}

export const brl = (value: unknown, code = "BRL") =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: code || "BRL",
        maximumFractionDigits: 0,
      }).format(Number(value));

export const day = (value: string | null) =>
  value
    ? new Date(
        value.length === 10 ? `${value}T12:00:00` : value,
      ).toLocaleDateString("pt-BR")
    : "—";
