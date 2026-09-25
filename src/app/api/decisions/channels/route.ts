import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCommercialSession, isSessionError, hasOptionalPermission } from '@/lib/commercial/server-session';
import { logAuditEventServer } from '@/lib/audit/log-audit-event-server';
import { governedRpc } from '@/lib/platform/governed-rpc';
import { governedFailure } from '@/lib/operations/session';
import { channelsForViewer, decisionsReadFailure, NO_STORE } from '@/lib/decisions/read';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MANAGE = 'notifications.channels.manage';

const channelSchema = z.object({
  channel: z.enum(['email', 'whatsapp'], { message: 'Canal inválido: e-mail ou WhatsApp.' }),
  status: z.enum(['ENABLED', 'DISABLED'], { message: 'Estado inválido: ENABLED ou DISABLED.' }),
  provider: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, 'Provedor inválido (minúsculas, números e _).'),
  contentLevel: z.enum(['MINIMAL', 'STANDARD']).default('MINIMAL'),
  reason: z.string().trim().min(3, 'Mudar um canal exige motivo.').max(500),
  // Configuração NÃO secreta (remetente, modelo aprovado). Segredo mora no ambiente do servidor; o banco recusa chave com cara de segredo.
  config: z.record(z.string().max(60), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

function channelError(raw: string): string | null {
  if (/exige motivo/.test(raw)) return 'Mudar um canal exige motivo.';
  if (/nci_config_no_secrets/.test(raw)) return 'A configuração não pode conter segredo (chave, token, senha): segredo mora no servidor.';
  if (/nci_config_small/.test(raw)) return 'Configuração grande demais.';
  if (/provider/.test(raw)) return 'Provedor inválido.';
  if (/lacks permission/.test(raw)) return 'Seu perfil não pode configurar canais de notificação (notifications.channels.manage).';
  return null;
}

/** Estado dos canais da organização — todo membro lê (estado de canal não tem segredo). */
export async function GET() {
  const session = await requireCommercialSession([]);
  if (isSessionError(session)) return session.error;
  try {
    const [{ channels, integrations }, canManage] = await Promise.all([channelsForViewer(session), hasOptionalPermission(session, MANAGE)]);
    return NextResponse.json({ ok: true, channels, integrations, canManage }, { headers: NO_STORE });
  } catch (error) {
    return decisionsReadFailure(error);
  }
}

/**
 * Ligar/desligar um canal. A rota exige a permissão; `notification_channel_set`
 * confere de novo com o ator nomeado — e registra o fato de domínio.
 */
export async function POST(request: Request) {
  const session = await requireCommercialSession([MANAGE]);
  if (isSessionError(session)) return session.error;
  const parsed = channelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Campos inválidos.' }, { status: 400, headers: NO_STORE });
  }
  const input = parsed.data;
  try {
    const result = await governedRpc<Record<string, unknown>>('notification_channel_set', {
      p_organization_id: session.organizationId, p_actor: session.user.id, p_channel: input.channel, p_status: input.status,
      p_provider: input.provider, p_content_level: input.contentLevel, p_reason: input.reason, p_config: input.config ?? {},
    });
    await logAuditEventServer({ organizationId: session.organizationId, action: 'notifications.channel.set', entityType: 'notification_channel',
      entityId: null, metadata: { channel: input.channel, status: input.status, provider: input.provider, content_level: input.contentLevel,
        previous_status: result?.previous_status ?? null } }, request.headers);
    return NextResponse.json({ ok: true, result }, { headers: NO_STORE });
  } catch (error) {
    return governedFailure(error, channelError);
  }
}
