/**
 * Fronteira de autorização das rotas de Operações e Supply.
 *
 * É a MESMA fronteira do Comercial (`requireCommercialSession`): organização
 * ativa resolvida antes da permissão, papéis da organização ativa, e as
 * sobreposições por usuário consultadas pelo resolvedor que a RLS usa. Não há
 * uma segunda implementação de "quem pode" — só um nome que diz onde ela é
 * usada.
 */
import { NextResponse } from 'next/server';
import {
  requireCommercialSession, isSessionError, hasOptionalPermission, safeGovernedError,
  type CommercialSession, type SessionResult,
} from '@/lib/commercial/server-session';

export type OperationsSession = CommercialSession;
export type OperationsSessionResult = SessionResult;

export const requireOperationsSession = requireCommercialSession;
export { isSessionError, hasOptionalPermission };

/**
 * Leitura liberada por QUALQUER uma das chaves — o espelho das políticas de
 * RLS que aceitam `operations.planning.view OR projects.view`. Escrita nunca
 * usa isto: escrita exige a chave exata.
 */
export async function requireAnyOperationsPermission(keys: string[]): Promise<OperationsSessionResult> {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session;
  for (const key of keys) if (await hasOptionalPermission(session, key)) return session;
  return { error: NextResponse.json({ ok: false, error: `Esta ação exige: ${keys.join(' ou ')}.` }, { status: 403 }) };
}

/**
 * As recusas dos portões de Operações e Supply que a pessoa PRECISA ler. O
 * resto (constraint, SQLSTATE, stack) vira a mensagem neutra do Comercial.
 */
const OPERATIONS_SAFE_PREFIXES = [
  'Service order',
  'Pacote:',
  'Engagement ',
  'Permission required',
  'Reviewing service order',
  'Decisions must',
  'Unsupported decision',
  'A human divergence',
  'Requirement',
  'Project ',
  'Activity ',
  'Inventory',
  'Reservation',
  'Transfer',
  'Item ',
  'Location',
  'Purchase',
  'Quote',
  'RFQ',
  'Sourcing',
  'Supplier',
  'Receipt',
  'Receiving',
  'Shipment',
  'Approval',
  'Count',
];

export function safeOperationsError(message: string | undefined): string {
  const text = (message ?? '').trim();
  if (OPERATIONS_SAFE_PREFIXES.some((prefix) => text.startsWith(prefix))) return text;
  return safeGovernedError(text);
}
