'use client';

import { useCallback, useState } from 'react';
import type { SupplierDiscoveryResponse } from '@/lib/dashboard/types';

/**
 * ATOS do Supply no Dashboard — sempre pela ROTA GOVERNADA que já existe
 * (reservar, transferir, requisitar, cotar, decidir, submeter, cadastrar
 * prospecto). O Dashboard não tem verdade paralela: o banco decide e recusa;
 * aqui só se traduz a resposta para português, sem nunca ler "incerto" como
 * "feito".
 *
 * A chave de idempotência nasce ao ABRIR a confirmação (`newIntentKey`) e é
 * reusada na repetição da mesma intenção — rede caída ou 5xx não duplicam o
 * ato. Só o ato que LEVA a chave (`idempotencyKey` no corpo) promete isso: os
 * outros (cadastrar prospecto, abrir cotação, decidir, submeter) pedem para
 * conferir em Compras antes de repetir.
 */

export type GovernedResult =
  | { ok: true; result: Record<string, unknown>; replayed: boolean }
  | { ok: false; status: number | null; message: string; uncertain: boolean };

export const NETWORK_TEXT = 'Sem conexão: o servidor não confirmou. Tente de novo — a repetição não duplica o ato.';
export const NETWORK_TEXT_UNKEYED = 'Sem conexão: o servidor não confirmou — o ato pode ter sido registrado. Confira em Compras antes de repetir.';
const SERVER_TEXT = 'O servidor falhou antes de confirmar — nada foi dado como feito. Tente de novo.';
const SERVER_TEXT_UNKEYED = 'O servidor falhou antes de confirmar. Confira em Compras antes de repetir.';

/** O corpo leva a chave da intenção? (só então a repetição é segura por construção) */
export const hasIntentKey = (body: Record<string, unknown>) => typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim().length > 0;

/** Uma intenção nova (a chave do ato); aceita pelas rotas (8–120 caracteres). */
export function newIntentKey(): string {
  const c = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `dg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** POST na rota governada, a resposta lida: `{ ok:true, result }` ou a recusa em português. */
export async function postGoverned(url: string, body: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<GovernedResult> {
  const keyed = hasIntentKey(body);
  let response: Response;
  try {
    response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, status: null, message: keyed ? NETWORK_TEXT : NETWORK_TEXT_UNKEYED, uncertain: true };
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data || data.ok !== true) {
    const said = typeof data?.error === 'string' && data.error.trim() ? data.error.trim()
      : typeof data?.message === 'string' && data.message.trim() ? data.message.trim() : null;
    if (response.status === 403) return { ok: false, status: 403, message: `Sem alçada: ${said ?? 'seu perfil não pode fazer este ato.'}`, uncertain: false };
    if (response.status >= 500) return { ok: false, status: response.status, message: said ?? (keyed ? SERVER_TEXT : SERVER_TEXT_UNKEYED), uncertain: true };
    return { ok: false, status: response.status, message: said ?? 'O ato foi recusado.', uncertain: false };
  }
  const result = (data.result && typeof data.result === 'object' ? data.result : data) as Record<string, unknown>;
  return { ok: true, result, replayed: Boolean(result.replayed) };
}

/**
 * POST /api/dashboard/site/[projectId]/supply/discover — a busca da Apex na
 * internet. A rota responde sempre 200 (`ok:false` com o motivo); rede caída
 * ou resposta sem forma viram `error`, nunca "nenhum fornecedor".
 */
export async function postDiscovery(url: string, requirementId: string, fetcher: typeof fetch = fetch): Promise<SupplierDiscoveryResponse> {
  try {
    const response = await fetcher(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requirementId }),
    });
    const data = (await response.json().catch(() => null)) as SupplierDiscoveryResponse | null;
    if (data && data.ok === true && Array.isArray(data.candidates)) return data;
    if (data && data.ok === false && typeof data.reason === 'string') {
      return { ok: false, reason: data.reason, message: data.message || data.error || 'A busca não foi feita.', error: data.error };
    }
    if (response.status === 403) return { ok: false, reason: 'restricted', message: 'Seu perfil não pode pedir a busca externa.' };
    return { ok: false, reason: 'error', message: 'A busca não respondeu como esperado. Tente de novo.' };
  } catch {
    return { ok: false, reason: 'error', message: 'Sem conexão: a busca não foi feita. Tente de novo.' };
  }
}

export const discoverUrl = (projectId: string) => `/api/dashboard/site/${encodeURIComponent(projectId)}/supply/discover`;

/** Estado de um ato na tela: ocupado, a recusa em português e o "incerto" (repetir com a MESMA chave). */
export function useSupplyAct() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (url: string, body: Record<string, unknown>): Promise<GovernedResult> => {
    setBusy(true);
    setError(null);
    try {
      const r = await postGoverned(url, body);
      if (!r.ok) setError(r.message);
      return r;
    } finally {
      setBusy(false);
    }
  }, []);
  const reset = useCallback(() => setError(null), []);
  return { busy, error, run, reset, setError, setBusy };
}
