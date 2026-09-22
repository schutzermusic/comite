"use client";

import { useCallback, useEffect, useState } from "react";
import { HudPanel } from "@/components/hud";

/** Estado de carregamento/erro em um lugar só — seis áreas, um comportamento. */
export function useCommercialResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    setState("loading");
    setMessage(null);
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(url);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || !payload.ok) {
          setMessage(payload?.error ?? "Não foi possível carregar.");
          setState("error");
          return;
        }
        setData(payload as T);
        setState("ready");
      } catch {
        if (!cancelled) {
          setMessage("Falha de rede.");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  return { data, state, message, refresh };
}

export function ResourceState({
  state,
  message,
}: {
  state: string;
  message: string | null;
}) {
  if (state === "loading") {
    return (
      <HudPanel elevation={1} interactive={false}>
        <p className="text-ig-body-sm text-ig-fg-muted">Carregando…</p>
      </HudPanel>
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
