import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { authorizeEngagement } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Tira a entrada de "Em análise" e a coloca em "Autorizado".
 *
 * É o momento em que o valor passa a contar nos KPIs — e por isso é um ato
 * HUMANO, com permissão própria, e não uma consequência de ter subido um PDF.
 * O valor autorizado é DERIVADO da fonte regente pela função governada: esta
 * rota não aceita valor no corpo, de propósito.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.engagements.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  let note: string | null = null;
  try { note = (await request.json())?.note ?? null; } catch { note = null; }

  try {
    const result = await authorizeEngagement(session.organizationId, session.user.id, id, note);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.engagement.authorized',
      entityType: 'commercial_engagement', entityId: id,
      metadata: { governingSourceKind: result.governing_source_kind ?? null },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
