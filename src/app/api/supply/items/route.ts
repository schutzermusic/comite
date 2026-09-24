import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import {
  requireAnyOperationsPermission, requireOperationsSession, isSessionError, hasOptionalPermission, safeOperationsError,
} from '@/lib/operations/session';
import { listItems } from '@/lib/supply/read-model';
import { upsertItem } from '@/lib/supply/service';
import { itemPayload, itemSchema } from '@/lib/supply/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Catálogo de itens — lido por quem planeja, estoca, compra ou vê projeto. */
export async function GET(request: Request) {
  const session = await requireAnyOperationsPermission(['supply.view', 'operations.planning.view', 'projects.view',
    'inventory.view', 'procurement.view']);
  if (isSessionError(session)) return session.error;
  const all = new URL(request.url).searchParams.get('inactive') === '1';
  try {
    const [items, manage] = await Promise.all([listItems(session, all), hasOptionalPermission(session, 'supply.plan')]);
    return NextResponse.json({ ok: true, items, capabilities: { manage } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

/** Novo item de catálogo — ato governado de quem planeja materiais. */
export async function POST(request: Request) {
  const session = await requireOperationsSession(['supply.plan']);
  if (isSessionError(session)) return session.error;
  const parsed = itemSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.code || !parsed.data.description || !parsed.data.unit) {
    return NextResponse.json({ ok: false, error: 'Item novo exige código, descrição e unidade.' }, { status: 400 });
  }
  try {
    const out = await upsertItem(session.organizationId, session.user.id, itemPayload(parsed.data));
    await logAuditEventServer({ organizationId: session.organizationId, action: 'supply.item.created',
      entityType: 'supply_item', entityId: out.item_id, metadata: { code: parsed.data.code } }, request.headers);
    return NextResponse.json({ ok: true, itemId: out.item_id });
  } catch (error) {
    const message = (error as Error).message;
    return NextResponse.json({ ok: false, error: /sitem_code_unique/.test(message)
      ? 'Já existe um item com este código.' : safeOperationsError(message) }, { status: 422 });
  }
}
