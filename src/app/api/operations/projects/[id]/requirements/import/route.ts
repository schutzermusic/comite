import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, governedFailure } from '@/lib/operations/session';
import { importRequirementsFromServiceOrder } from '@/lib/operations/planning/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ serviceOrderId: z.string().uuid() });

/** Linhas confirmadas da OS emitida → requisitos PLANEJADOS do projeto. Idempotente. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['operations.planning.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Informe a OS.' }, { status: 400 });
  try {
    const out = await importRequirementsFromServiceOrder(session.organizationId, session.user.id, id, parsed.data.serviceOrderId);
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.requirements.imported_from_service_order',
      entityType: 'project', entityId: null, metadata: { projectId: id, serviceOrderId: parsed.data.serviceOrderId,
        added: out.requirements_added } }, request.headers);
    return NextResponse.json({ ok: true, added: out.requirements_added });
  } catch (error) {
    return governedFailure(error);
  }
}
