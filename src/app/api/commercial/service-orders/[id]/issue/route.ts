import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { issueServiceOrder } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Emite a OS interna.
 *
 * O bloqueio por divergência bloqueante mora no gatilho `iso_issue_gate`, e
 * não nesta rota — se morasse aqui, um chamador de servidor esqueceria de
 * verificá-lo. A mensagem do banco chega ao usuário porque ela é a resposta
 * certa: "1 divergência bloqueante em aberto" diz o que fazer.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  try {
    const result = await issueServiceOrder(session.organizationId, session.user.id, id);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.service_order.issued',
      entityType: 'internal_service_order', entityId: id, metadata: {},
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
