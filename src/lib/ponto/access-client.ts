'use client';

/**
 * Cliente da API de acesso ao Ponto (/api/ponto/access) para a tela de
 * Pessoas. Usa cookies de sessão (mesma origem) — a autorização é feita
 * no servidor por people.manage.
 */
import type { PontoAccessAction, PontoAccessInfo, PontoAccessStatus } from '@/lib/ponto/access-types';

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || json.ok === false) throw new Error(json.error || `Falha ${res.status}`);
  return json as T;
}

/** Mapa personId -> status de acesso. */
export async function listPontoAccess(): Promise<Map<string, PontoAccessInfo>> {
  const res = await fetch('/api/ponto/access', { method: 'GET' });
  const { items } = await parse<{ items: PontoAccessInfo[] }>(res);
  return new Map(items.map((i) => [i.personId, i]));
}

export interface AccessActionResult {
  status: PontoAccessStatus;
  message: string;
  activationLink?: string;
}

export async function runPontoAccessAction(personId: string, action: PontoAccessAction): Promise<AccessActionResult> {
  const res = await fetch('/api/ponto/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personId, action }),
  });
  return parse<AccessActionResult>(res);
}

export interface BatchItemResult {
  personId: string;
  ok: boolean;
  status?: PontoAccessStatus;
  error?: string;
}

export interface BatchInviteResult {
  results: BatchItemResult[];
  summary: { sent: number; failed: number; total: number };
}

/** Envia convites em lote (a ação por pessoa é derivada do status atual). */
export async function batchInvitePonto(personIds: string[]): Promise<BatchInviteResult> {
  const res = await fetch('/api/ponto/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personIds }),
  });
  return parse<BatchInviteResult>(res);
}
