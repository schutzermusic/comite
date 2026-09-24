import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, governedFailure } from '@/lib/operations/session';
import { compareWithGoverning, decideItems, upsertItem } from '@/lib/operations/service-orders/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS = ['SCOPE', 'ACTIVITY', 'DELIVERABLE', 'TECHNICAL_REQUIREMENT', 'MATERIAL', 'EQUIPMENT', 'WORKFORCE',
  'RESOURCE', 'CUSTOMER_DEPENDENCY', 'ASSUMPTION', 'EXCLUSION', 'TEST', 'MEASUREMENT_CONDITION',
  'COMMERCIAL_REFERENCE', 'DOCUMENT', 'MILESTONE', 'RISK'] as const;

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(KINDS).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  detail: z.string().trim().max(4000).nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(30).nullable().optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).refine((v) => v.id || (v.kind && v.title), 'Linha nova exige tipo e título.');

/** Linha manual (nasce confirmada por quem digitou) ou edição de linha lida. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = itemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Linha inválida.' }, { status: 400 });
  const b = parsed.data;
  const payload: Record<string, unknown> = { id: b.id, kind: b.kind, title: b.title };
  if (b.detail !== undefined) payload.detail = b.detail;
  if (b.quantity !== undefined) payload.quantity = b.quantity;
  if (b.unit !== undefined) payload.unit = b.unit;
  if (b.plannedDate !== undefined) payload.planned_date = b.plannedDate;
  try {
    const out = await upsertItem(session.organizationId, session.user.id, id, payload);
    await logAuditEventServer({ organizationId: session.organizationId,
      action: b.id ? 'operations.service_order.item_edited' : 'operations.service_order.item_added',
      entityType: 'internal_service_order', entityId: id, metadata: { itemId: out.item_id, kind: b.kind } }, request.headers);
    return NextResponse.json({ ok: true, itemId: out.item_id });
  } catch (error) {
    return governedFailure(error);
  }
}

const decideSchema = z.object({
  decisions: z.array(z.object({
    itemId: z.string().uuid(),
    decision: z.enum(['CONFIRMED', 'REJECTED', 'UNCONFIRMED']),
  })).min(1).max(500),
});

/** Revisão humana das linhas lidas — em lote, numa transação. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['commercial.service_orders.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = decideSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Decisões inválidas.' }, { status: 400 });
  try {
    const out = await decideItems(session.organizationId, session.user.id, id,
      parsed.data.decisions.map((d) => ({ item_id: d.itemId, decision: d.decision })));
    // Retirar linha do pacote pode abrir aviso: o confronto roda de novo.
    const comparison = await compareWithGoverning(session.organizationId, id);
    await logAuditEventServer({ organizationId: session.organizationId, action: 'operations.service_order.items_reviewed',
      entityType: 'internal_service_order', entityId: id,
      metadata: { decided: out.decided, rejected: parsed.data.decisions.filter((d) => d.decision === 'REJECTED').length } },
      request.headers);
    return NextResponse.json({ ok: true, decided: out.decided, divergencesOpened: comparison.divergences_opened ?? 0 });
  } catch (error) {
    return governedFailure(error);
  }
}
