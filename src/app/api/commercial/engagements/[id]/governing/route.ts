import { NextResponse } from 'next/server';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { setGoverningSource } from '@/lib/commercial/engagement-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Troca a fonte REGENTE do trabalho autorizado.
 *
 * O motivo escrito é obrigatório aqui e no banco. Trocar quem manda sobre
 * valor, prazo e regra de medição sem dizer por quê deixaria a mudança
 * indistinguível de um acidente — e é exatamente a mudança que alguém vai
 * querer explicar seis meses depois.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.engagements.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Corpo inválido.' }, { status: 400 }); }

  const authorizationId = String(body.authorizationId ?? '').trim();
  const note = String(body.note ?? '').trim();
  if (!authorizationId || !note) {
    return NextResponse.json({ ok: false,
      error: 'Informe a autorização e o motivo da troca da fonte regente.' }, { status: 400 });
  }

  try {
    const result = await setGoverningSource(
      session.organizationId, session.user.id, authorizationId, note);
    await logAuditEventServer({
      organizationId: session.organizationId,
      action: 'commercial.engagement.governing_source_changed',
      entityType: 'commercial_engagement', entityId: id,
      metadata: { previousAuthorizationId: result.previous_authorization_id, authorizationId, note },
    }, request.headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false,
      error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
