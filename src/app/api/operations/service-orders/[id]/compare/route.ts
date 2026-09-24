import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, governedFailure } from '@/lib/operations/session';
import { getServiceOrderWorkspace } from '@/lib/operations/service-orders/read-model';
import { compareWithGoverning } from '@/lib/operations/service-orders/service';
import { reviewDivergencesWithAI } from '@/lib/operations/service-orders/extraction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/**
 * Confrontar de novo. As REGRAS rodam sempre (idempotentes no banco). A
 * leitura assistida (`{ ai: true }`) compara os fatos da OS com os do pacote
 * e abre candidatas — nunca resolve nada.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  try {
    const rules = await compareWithGoverning(session.organizationId, id);
    let ai: Awaited<ReturnType<typeof reviewDivergencesWithAI>> | null = null;
    if (body?.ai === true) {
      const ws = await getServiceOrderWorkspace(session, id);
      if (!ws) return NextResponse.json({ ok: false, error: 'Ordem de serviço não encontrada.' }, { status: 404 });
      const revisionIds = [ws.order.governing_technical_revision_id, ws.order.governing_commercial_revision_id,
        ws.order.governing_combined_revision_id].filter(Boolean) as string[];
      ai = await reviewDivergencesWithAI({ organizationId: session.organizationId, actorId: session.user.id,
        serviceOrderId: id, packageRevisionIds: revisionIds });
    }
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.service_order.compared',
      entityType: 'internal_service_order', entityId: id,
      metadata: { rules: rules.divergences_opened ?? 0, ai: ai ? { recorded: ai.recorded, model: ai.model ?? null } : null } },
      request.headers);
    return NextResponse.json({ ok: true, rules, ai });
  } catch (error) {
    return governedFailure(error);
  }
}
