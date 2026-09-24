/**
 * Chamada a uma função governada do banco (SECURITY DEFINER, só servidor).
 *
 * Um lugar só para o que toda escrita de Operações e Supply precisa: o
 * SQLSTATE preservado para a rota decidir o status HTTP, e a repetição
 * SEGURA de impasse, serialização e corrida de idempotência.
 */
if (typeof window !== 'undefined') {
  throw new Error('platform/governed-rpc.ts não pode ser importado no navegador');
}

import { platformServiceClient } from '@/lib/platform/server-client';

/**
 * Recusa de uma função governada com o SQLSTATE preservado: a rota decide o
 * status HTTP pelo código (42501 → 403), e não pelo texto.
 */
export class GovernedRpcError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = 'GovernedRpcError';
  }
}

/*
  Quando repetir é SEGURO, e só então:

  • 40P01 (impasse) e 40001 (serialização): o banco desfez a transação inteira
    da vítima; nada dela ficou gravado, e a mesma chamada é a mesma intenção.
  • 23505 numa chave de IDEMPOTÊNCIA: outra chamada com a mesma chave acabou de
    gravar. A segunda tentativa encontra o registro na checagem de replay e
    devolve "replayed" — o que o usuário que clicou duas vezes precisa ouvir,
    em vez de um erro de chave duplicada.

  Qualquer outra recusa é regra de negócio e sobe como está.
*/
const TRANSIENT = new Set(['40P01', '40001']);
const IDEMPOTENCY_INDEX = /\b(grc|invmov|invres|invtr|preqn)_idempotency\b|\bde_idempotent\b/;
const MAX_ATTEMPTS = 3;

export function isRetryableRpcError(error: { code?: string | null; message?: string; details?: string | null }): boolean {
  if (error.code && TRANSIENT.has(error.code)) return true;
  return error.code === '23505' && IDEMPOTENCY_INDEX.test(`${error.message ?? ''} ${error.details ?? ''}`);
}

export async function governedRpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const { data, error } = await platformServiceClient().rpc(name, params);
    if (!error) return data as T;
    if (attempt >= MAX_ATTEMPTS || !isRetryableRpcError(error)) {
      throw new GovernedRpcError(error.message, error.code ?? null);
    }
    await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.random() * 80));
  }
}
