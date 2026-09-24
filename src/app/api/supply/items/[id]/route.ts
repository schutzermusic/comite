import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireOperationsSession, isSessionError, governedFailure } from '@/lib/operations/session';
import { upsertItem } from '@/lib/supply/service';
import { itemPayload, itemSchema } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Editar ou desativar item. Código e unidade de item EM USO não mudam (o banco recusa). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireOperationsSession(['supply.plan']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  const parsed = itemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'Campos inválidos.' }, { status: 400 });
  const payload = itemPayload(parsed.data);
  if (!Object.keys(payload).length) return NextResponse.json({ ok: false, error: 'Nada a alterar.' }, { status: 400 });
  try {
    await upsertItem(session.organizationId, session.user.id, { ...payload, id });
    await logAuditEventServer({ organizationId: session.organizationId, action: 'supply.item.edited',
      entityType: 'supply_item', entityId: id, metadata: { fields: Object.keys(payload) } }, request.headers);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return governedFailure(error);
  }
}
