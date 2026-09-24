import { NextResponse } from 'next/server';
import { requireAnyOperationsPermission, isSessionError, hasOptionalPermission } from '@/lib/operations/session';
import { inventoryWorkspace } from '@/lib/supply/inventory-read';
import { todayInSaoPaulo } from '@/lib/operations/projects/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Estoque: posição, reservas, movimentos, transferências, contagens e exceções. */
export async function GET() {
  const session = await requireAnyOperationsPermission(['inventory.view', 'supply.view']);
  if (isSessionError(session)) return session.error;
  try {
    const [model, manage, reserve, receive] = await Promise.all([
      inventoryWorkspace(session, todayInSaoPaulo()),
      hasOptionalPermission(session, 'inventory.manage'),
      hasOptionalPermission(session, 'inventory.reserve'),
      hasOptionalPermission(session, 'receiving.receive'),
    ]);
    return NextResponse.json({ ok: true, ...model, capabilities: { manage, reserve, receive } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}
