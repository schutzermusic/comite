import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, safeOperationsError } from '@/lib/operations/session';
import { issue, issueWithException } from '@/lib/operations/service-orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('normal') }),
  z.object({
    mode: z.literal('exception'),
    reason: z.string().trim().min(20).max(4000),
    evidenceDocumentId: z.string().uuid().nullable().optional(),
  }),
]);

/**
 * Emitir. O caminho NORMAL é barrado pelo gatilho enquanto houver linha
 * pendente de revisão ou divergência bloqueante. A EXCEÇÃO exige, além da
 * alçada de OS, `operations.service_orders.override` — conferida aqui E no
 * banco — e um motivo escrito que fica no livro.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await request.json().catch(() => ({ mode: 'normal' })));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'A exceção exige um motivo escrito (20+ caracteres).' }, { status: 400 });
  }
  const required = parsed.data.mode === 'exception'
    ? ['commercial.service_orders.manage', 'operations.service_orders.override']
    : ['commercial.service_orders.manage'];
  const session = await requireOperationsSession(required);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  try {
    const result = parsed.data.mode === 'exception'
      ? await issueWithException(session.organizationId, session.user.id, id, parsed.data.reason,
          parsed.data.evidenceDocumentId ?? null)
      : await issue(session.organizationId, session.user.id, id);
    await logAuditEventServer({ organizationId: session.organizationId,
      action: parsed.data.mode === 'exception' ? 'operations.service_order.issued_with_exception'
                                              : 'operations.service_order.issued',
      entityType: 'internal_service_order', entityId: id,
      metadata: parsed.data.mode === 'exception'
        ? { exceptionId: (result as { exception_id?: string }).exception_id,
            waived: (result as { divergences_waived?: number }).divergences_waived } : {} }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeOperationsError((error as Error).message) }, { status: 422 });
  }
}
