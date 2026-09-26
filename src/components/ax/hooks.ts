'use client';

import { useCallback, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useHudToast } from '@/components/hud';
import { notifyCommercialChanged, useCommercialResource } from '@/components/commercial/shared';

/**
 * Leitura de um recurso da API com o mesmo comportamento em todas as telas:
 * carregando → pronto/erro, recarga mantendo o dado anterior montado, e
 * recarga automática quando qualquer ato governado avisa que algo mudou.
 */
export const useResource = useCommercialResource;
export const notifyChanged = notifyCommercialChanged;

/**
 * Estado ENDEREÇÁVEL: aba, filtro e registro aberto ficam na URL. Um link de
 * KPI, de recomendação da Apex ou do rastro "por que compramos isto" cai na
 * aba certa com o registro aberto — e o botão Voltar funciona.
 */
export function useUrlParam<T extends string>(key: string, fallback: T): [T, (value: T | null) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const value = (params.get(key) as T | null) ?? fallback;
  const set = useCallback((next: T | null) => {
    const q = new URLSearchParams(params.toString());
    if (next === null || next === fallback) q.delete(key); else q.set(key, next);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, router, pathname, key, fallback]);
  return [value, set];
}

/** Vários parâmetros de uma vez (abrir um registro trocando de aba). */
export function useUrlParams() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  return useCallback((patch: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v === null) q.delete(k); else q.set(k, v); }
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, router, pathname]);
}

const stable = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
};

export type ActResult = { ok: true; result: Record<string, unknown> } | { ok: false; status?: number; error?: string };

/**
 * Ato governado pela API, com a MESMA chave de idempotência enquanto a
 * intenção for a mesma.
 *
 * A chave nasce na primeira tentativa de uma intenção (nome + conteúdo) e só
 * é descartada no sucesso. Queda de rede, duplo toque ou repetição depois de
 * um erro reenviam a MESMA chave — o servidor responde "já registrado" em vez
 * de gravar de novo. Mudou a quantidade? É outra intenção, outra chave.
 *
 * `msg.done`: o aviso de sucesso a partir do que o servidor DEVOLVEU (quando
 * o ato pode sair diferente do pedido); `msg.title` segue nomeando as recusas.
 */
export function useGovernedAction(onDone?: () => void) {
  const { success, error } = useHudToast();
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(async (
    intent: string, url: string, body: Record<string, unknown>,
    msg: { title: string; detail?: string; done?: (result: Record<string, unknown>) => { title: string; detail?: string } },
    opts: { idempotent?: boolean; method?: 'POST' | 'PATCH' | 'PUT' } = {},
  ): Promise<ActResult> => {
    const mapKey = `${intent}|${url}|${stable(body)}`;
    let key = keys.current.get(mapKey);
    if (!key) { key = crypto.randomUUID(); keys.current.set(mapKey, key); }
    const payload = opts.idempotent === false ? body : { ...body, idempotencyKey: (body.idempotencyKey as string | undefined) ?? key };
    setBusy(intent);
    try {
      let response: Response;
      try {
        response = await fetch(url, { method: opts.method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      } catch {
        error(`${msg.title}: sem conexão`, 'O servidor não confirmou. Tente de novo — a repetição não duplica o ato.');
        return { ok: false };
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        error(response.status === 403 ? `${msg.title}: sem alçada` : `${msg.title}: recusado`, data?.error ?? 'Não foi possível concluir.');
        return { ok: false, status: response.status, error: data?.error };
      }
      keys.current.delete(mapKey);
      const result = (data.result ?? data) as Record<string, unknown>;
      const done = msg.done?.(result);
      if (done) success(done.title, done.detail);
      else success(msg.title, result?.replayed ? 'Já estava registrado — nada foi duplicado.' : msg.detail);
      notifyCommercialChanged();
      onDone?.();
      return { ok: true, result };
    } finally {
      setBusy(null);
    }
  }, [error, success, onDone]);

  return { run, busy };
}
