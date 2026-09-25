import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { actOnDecision } from '@/lib/decisions/act';
import { decisionKeyParam } from '@/lib/decisions/read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * O ato sobre uma decisão — executado pela função canônica da origem
 * (approval_decide pela sessão; purchase_order_decide pelo invólucro de tela
 * velha). A rota não tem portão de permissão próprio: a alçada é a do banco,
 * conferida no instante do ato.
 */
export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const key = decisionKeyParam((await context.params).key);
  const body = await request.json().catch(() => null);
  return actOnDecision(session, key, body, request.headers);
}
