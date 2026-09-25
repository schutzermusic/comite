import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCommercialSession, isSessionError } from '@/lib/commercial/server-session';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { governedRpc } from '@/lib/platform/governed-rpc';
import { governedFailure } from '@/lib/operations/session';
import { channelsForViewer, decisionsReadFailure, NO_STORE } from '@/lib/decisions/read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const preferenceSchema = z.object({
  channel: z.enum(['email', 'whatsapp'], { message: 'Canal inválido: e-mail ou WhatsApp.' }),
  enabled: z.boolean({ message: 'Informe se o canal fica ligado.' }),
  destination: z.string().trim().max(32, 'Número longo demais.').nullable().optional(),
});

/** As recusas de notification_preference_set (240 §18), na língua da tela. */
function preferenceError(raw: string): string | null {
  if (/WhatsApp exige número/.test(raw)) return 'WhatsApp exige número no formato internacional (+5511999999999).';
  if (/Canal inválido/.test(raw)) return 'Canal inválido.';
  if (/not an active member/.test(raw)) return 'Sua conta não está ativa nesta organização.';
  if (/unp_whatsapp_needs_number/.test(raw)) return 'Para ligar o WhatsApp, informe o número.';
  if (/destination/.test(raw)) return 'Número inválido: use o formato internacional (+5511999999999).';
  return null;
}

/** Os canais como a pessoa os recebe: estado de cada um e a opção dela. */
export async function GET() {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  try {
    const { channels, preferences } = await channelsForViewer(session);
    return NextResponse.json({ ok: true, channels, preferences }, { headers: NO_STORE });
  } catch (error) {
    return decisionsReadFailure(error);
  }
}

/**
 * A preferência da PRÓPRIA pessoa. O ator é a sessão (p_actor = quem está
 * logado), nunca um campo do corpo: ninguém liga o WhatsApp de outra pessoa.
 */
export async function POST(request: Request) {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Campos inválidos.' }, { status: 400, headers: NO_STORE });
  }
  const { channel, enabled } = parsed.data;
  const destination = parsed.data.destination?.trim() || null;
  try {
    const result = await governedRpc<Record<string, unknown>>('notification_preference_set', {
      p_organization_id: session.organizationId, p_actor: session.user.id, p_channel: channel, p_enabled: enabled, p_destination: destination,
    });
    // O número não vai para a auditoria: o registro diz O QUE mudou, não o dado pessoal.
    await logAuditEventServer({ organizationId: session.organizationId, action: 'notifications.preference.set',
      entityType: 'user_notification_preference', entityId: null, metadata: { channel, enabled, has_destination: !!destination } }, request.headers);
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    return governedFailure(error, preferenceError);
  }
}
