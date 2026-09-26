import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, governedFailure } from '@/lib/operations/session';
import { transitionRequirement } from '@/lib/operations/planning/service';
import { requirementCoverageErrorMessage } from '@/lib/operations/planning/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  to: z.enum(['PLANNED', 'CONFIRMED', 'CANCELLED', 'SUPERSEDED']),
  reason: z.string().trim().max(2000).nullable().optional(),
  supersededBy: z.string().uuid().nullable().optional(),
});

/** Confirmar, voltar a planejado, cancelar (com motivo) ou substituir. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['operations.planning.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Transição inválida.' }, { status: 400 });
  try {
    const out = await transitionRequirement(session.organizationId, session.user.id, id, parsed.data.to,
      parsed.data.reason ?? null, parsed.data.supersededBy ?? null);
    await logAuditEventServer({ organizationId: session.organizationId, action: `operations.requirement.${parsed.data.to.toLowerCase()}`,
      entityType: 'project_requirement', entityId: id, metadata: { from: out.from ?? null } }, request.headers);
    return NextResponse.json({ ok: true, ...out });
  } catch (error) {
    return governedFailure(error, requirementCoverageErrorMessage);
  }
}
