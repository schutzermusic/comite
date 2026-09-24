import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, safeOperationsError } from '@/lib/operations/session';
import { amend } from '@/lib/operations/service-orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  reason: z.string().trim().min(5).max(4000),
  siteLabel: z.string().trim().max(300).nullable().optional(),
  plannedStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  plannedFinish: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  scopeSummary: z.string().trim().max(4000).nullable().optional(),
  addItems: z.array(z.object({
    kind: z.string().min(3).max(40), title: z.string().trim().min(1).max(500),
    detail: z.string().trim().max(4000).nullable().optional(),
  })).max(50).optional(),
  removeItemIds: z.array(z.string().uuid()).max(200).optional(),
});

/** Emenda de OS emitida: nova revisão com instantâneo e motivo. Nada é reescrito em silêncio. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Emenda inválida: descreva o motivo.' }, { status: 400 });
  const b = parsed.data;
  const payload: Record<string, unknown> = {};
  if (b.siteLabel !== undefined) payload.site_label = b.siteLabel;
  if (b.plannedStart !== undefined) payload.planned_start = b.plannedStart;
  if (b.plannedFinish !== undefined) payload.planned_finish = b.plannedFinish;
  if (b.scopeSummary !== undefined) payload.scope_summary = b.scopeSummary;
  if (b.addItems?.length) payload.add_items = b.addItems;
  if (b.removeItemIds?.length) payload.remove_item_ids = b.removeItemIds;
  if (!Object.keys(payload).length) return NextResponse.json({ ok: false, error: 'A emenda não muda nada.' }, { status: 400 });
  try {
    const out = await amend(session.organizationId, session.user.id, id, payload, b.reason);
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.service_order.amended',
      entityType: 'internal_service_order', entityId: id, metadata: { revision: out.revision, linesChanged: out.lines_changed } },
      request.headers);
    return NextResponse.json({ ok: true, ...out });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeOperationsError((error as Error).message) }, { status: 422 });
  }
}
