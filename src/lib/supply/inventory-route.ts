/**
 * Costura comum das rotas de estoque: permissão exata, parse, ato governado,
 * auditoria e recusa legível. O banco decide; a rota só traduz.
 */
if (typeof window !== 'undefined') {
  throw new Error('supply/inventory-route.ts não pode ser importado no navegador');
}

import { NextResponse } from 'next/server';
import type { ZodType } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import {
  requireAnyOperationsPermission, isSessionError, safeOperationsError, type OperationsSession,
} from '@/lib/operations/session';
import { inventoryErrorMessage } from './inventory';
import { procurementErrorMessage } from './procurement';

export function inventoryFailure(error: unknown) {
  const message = (error as Error)?.message ?? '';
  return NextResponse.json({ ok: false, error: inventoryErrorMessage(message) ?? procurementErrorMessage(message)
    ?? safeOperationsError(message) }, { status: 422 });
}

/**
 * Executa um ato de estoque. `anyOf` é a alçada da rota (espelho do recheque
 * que a função do banco faz de novo com o ator nomeado).
 */
export async function runInventoryAct<S>(request: Request, opts: {
  anyOf: string[];
  schema: ZodType<S>;
  act: (session: OperationsSession, input: S) => Promise<Record<string, unknown>>;
  audit: (input: S, out: Record<string, unknown>) => { action: string; entityType: string; entityId: string | null; metadata?: Record<string, unknown> };
}) {
  const session = await requireAnyOperationsPermission(opts.anyOf);
  if (isSessionError(session)) return session.error;
  const parsed = opts.schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Campos inválidos.' }, { status: 400 });
  }
  try {
    const out = await opts.act(session, parsed.data);
    const a = opts.audit(parsed.data, out);
    await logAuditEventServer({ organizationId: session.organizationId, action: a.action, entityType: a.entityType,
      entityId: a.entityId, metadata: a.metadata ?? {} }, request.headers);
    return NextResponse.json({ ok: true, result: out });
  } catch (error) {
    return inventoryFailure(error);
  }
}
