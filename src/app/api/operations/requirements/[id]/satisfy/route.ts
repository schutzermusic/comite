import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, safeOperationsError } from '@/lib/operations/session';
import { markRequirementSatisfied } from '@/lib/operations/planning/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  note: z.string().trim().min(3).max(2000),
  documentId: z.string().uuid().nullable().optional(),
  undo: z.boolean().optional(),
});

/** "Atendido" para documento, dependência do cliente, equipe e equipamento — ato nomeado, com nota. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['operations.planning.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Registre uma nota do atendimento.' }, { status: 400 });
  try {
    const out = await markRequirementSatisfied(session.organizationId, session.user.id, id, parsed.data.note,
      parsed.data.documentId ?? null, parsed.data.undo === true);
    await logAuditEventServer({ organizationId: session.organizationId,
      action: out.satisfied ? 'operations.requirement.satisfied' : 'operations.requirement.satisfaction_undone',
      entityType: 'project_requirement', entityId: id, metadata: {} }, request.headers);
    return NextResponse.json({ ok: true, ...out });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeOperationsError((error as Error).message) }, { status: 422 });
  }
}
