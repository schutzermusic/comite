import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, governedFailure } from '@/lib/operations/session';
import { upsertRequirement } from '@/lib/operations/planning/service';
import { requirementCoverageErrorMessage, requirementPayload, requirementSchema } from '@/lib/operations/planning/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Editar requisito vivo. Cada mudança vai para a história do requisito. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['operations.planning.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = requirementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Campos inválidos.' }, { status: 400 });
  const payload = requirementPayload(parsed.data);
  delete payload.project_id;
  delete payload.source;
  if (!Object.keys(payload).length) return NextResponse.json({ ok: false, error: 'Nada a alterar.' }, { status: 400 });
  try {
    await upsertRequirement(session.organizationId, session.user.id, { ...payload, id });
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.requirement.edited',
      entityType: 'project_requirement', entityId: id, metadata: { fields: Object.keys(payload) } }, request.headers);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return governedFailure(error, requirementCoverageErrorMessage);
  }
}
