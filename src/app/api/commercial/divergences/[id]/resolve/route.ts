import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { resolveDivergence } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Decide qual fonte prevalece.
 *
 * A fonte vencedora é obrigatória. Um botão de "resolver" que só fechasse a
 * divergência apagaria a pergunta sem responder — e a próxima pessoa a abrir
 * o dossiê não teria como saber se o valor da OS ou o da proposta foi o que
 * valeu.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.divergences.resolve']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const prevailing = String(body.prevailingSource ?? '').trim();
  const note = String(body.note ?? '').trim();
  if (!prevailing) {
    return NextResponse.json({ ok: false,
      error: 'Informe qual fonte prevalece.' }, { status: 400 });
  }

  try {
    const result = await resolveDivergence(
      session.organizationId, session.user.id, id, prevailing, note);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.divergence.resolved',
      entityType: 'commercial_divergence', entityId: id,
      metadata: { prevailingSource: prevailing, note },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
