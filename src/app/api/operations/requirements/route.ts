import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, safeOperationsError } from '@/lib/operations/session';
import { upsertRequirement } from '@/lib/operations/planning/service';
import { requirementPayload, requirementSchema } from '@/lib/operations/planning/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Novo requisito (manual ou na atividade). Nasce PLANEJADO; confirmar é outro ato. */
export async function POST(request: Request) {
  const session = await requireOperationsSession(['operations.planning.manage']);
  if (isSessionError(session)) return session.error;
  const parsed = requirementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.projectId || !parsed.data.requirementType || !parsed.data.title) {
    return NextResponse.json({ ok: false, error: 'Requisito novo exige projeto, tipo e título.' }, { status: 400 });
  }
  try {
    const out = await upsertRequirement(session.organizationId, session.user.id, requirementPayload(parsed.data));
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.requirement.created',
      entityType: 'project_requirement', entityId: out.requirement_id,
      metadata: { projectId: parsed.data.projectId, type: parsed.data.requirementType } }, request.headers);
    return NextResponse.json({ ok: true, requirementId: out.requirement_id });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeOperationsError((error as Error).message) }, { status: 422 });
  }
}
