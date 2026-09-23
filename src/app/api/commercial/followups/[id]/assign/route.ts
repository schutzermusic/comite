import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { requireCommercialSession, isSessionError, safeGovernedError } from '@/lib/commercial/server-session';
import { assignFollowupResponsible } from '@/lib/platform/followups/session';
import { notifyMember } from '@/lib/commercial/notify';
import { platformServiceClient } from '@/lib/platform/server-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  responsibleUserId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().trim().max(500).nullish(),
});

/**
 * DESIGNAR ou REDESIGNAR um acompanhamento a uma pessoa da plataforma.
 *
 * Passa por `apex_followup_assign` — a mesma função do pós-venda — que
 * carimba quem designou e quando, e o gatilho de eventos registra a
 * designação na história append-only. O texto livre legado é LIMPO quando uma
 * identidade assume: dois responsáveis (um nome digitado e uma pessoa) seriam
 * duas respostas para "de quem é isto?".
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requireCommercialSession(['commercial.manage']);
  if (isSessionError(session)) return session.error;
  const { id } = await context.params;
  let parsed: z.infer<typeof schema>;
  try { parsed = schema.parse(await request.json()); }
  catch { return NextResponse.json({ ok: false, error: 'Escolha a pessoa responsável.' }, { status: 400 }); }

  const { data: member } = await platformServiceClient().from('profiles').select('user_id,full_name')
    .eq('organization_id', session.organizationId).eq('user_id', parsed.responsibleUserId)
    .eq('status', 'active').maybeSingle();
  if (!member) {
    return NextResponse.json({ ok: false, error: 'A pessoa escolhida não é membro ativo desta organização.' }, { status: 422 });
  }
  const { data: before } = await session.supabase.from('apex_followups')
    .select('id,goal,responsible_user_id,responsible_text,source_kind')
    .eq('organization_id', session.organizationId).eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ ok: false, error: 'Acompanhamento não encontrado.' }, { status: 404 });
  const previous = before as { goal: string; responsible_user_id: string | null; responsible_text: string | null };

  try {
    const followup = await assignFollowupResponsible(id, {
      responsibleUserId: parsed.responsibleUserId,
      responsibleText: null,
      dueDate: parsed.dueDate ?? null,
    });
    const notice = parsed.responsibleUserId !== session.user.id
      ? await notifyMember({
          organizationId: session.organizationId, recipientUserId: parsed.responsibleUserId,
          type: 'commercial_followup_assigned',
          title: 'Um acompanhamento comercial foi designado a você',
          body: previous.goal, link: '/comercial?view=followups&queue=mine',
        })
      : { delivered: false, error: null };
    await logAuditEventServer({
      organizationId: session.organizationId, action: 'commercial.followup.assigned',
      entityType: 'apex_followup', entityId: id,
      metadata: {
        previousUserId: previous.responsible_user_id, previousText: previous.responsible_text,
        newUserId: parsed.responsibleUserId, note: parsed.note ?? null,
        notified: notice.delivered, notificationError: notice.error,
      },
    }, request.headers);
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeGovernedError((error as Error).message) }, { status: 422 });
  }
}
