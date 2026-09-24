import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, governedFailure } from '@/lib/operations/session';
import { compareWithGoverning, generateFromPackage } from '@/lib/operations/service-orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  acceptanceId: z.string().uuid(),
  engagementId: z.string().uuid().optional(),
  osNumber: z.string().trim().max(60).optional(),
  title: z.string().trim().max(300).optional(),
  siteLabel: z.string().trim().max(300).optional(),
  plannedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  plannedFinish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * "Gerar a partir de proposta". A entrada é o ACEITE do pacote — a prova de
 * qual PT e qual PC o cliente aceitou. Idempotente no banco: repetir devolve
 * a mesma OS. O confronto roda em seguida, na mesma requisição.
 */
export async function POST(request: Request) {
  const session = await requireOperationsSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Informe o pacote aceito que origina a OS.' }, { status: 400 });
  }
  const b = parsed.data;
  try {
    const generated = await generateFromPackage(session.organizationId, session.user.id, b.acceptanceId, {
      engagement_id: b.engagementId, os_number: b.osNumber || undefined, title: b.title || undefined,
      site_label: b.siteLabel || undefined, planned_start: b.plannedStart, planned_finish: b.plannedFinish,
    });
    const comparison = generated.reused ? null
      : await compareWithGoverning(session.organizationId, generated.service_order_id);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: generated.reused ? 'operations.service_order.generate_reused' : 'operations.service_order.generated',
      entityType: 'internal_service_order', entityId: generated.service_order_id,
      metadata: { acceptanceId: b.acceptanceId, itemsAdded: generated.items_added,
        divergences: comparison?.divergences_opened ?? 0 },
    }, request.headers);
    return NextResponse.json({ ok: true, serviceOrderId: generated.service_order_id, reused: generated.reused,
      itemsAdded: generated.items_added, divergencesOpened: comparison?.divergences_opened ?? 0 });
  } catch (error) {
    return governedFailure(error);
  }
}
