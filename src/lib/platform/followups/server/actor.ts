import { NextResponse } from 'next/server';
import { getActiveOrganizationRow } from '@/lib/auth/active-organization';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { createClient } from '@/utils/supabase/server';
import type { FollowupActor } from './store';

export type FollowupActorResult =
  | { ok: true; actor: FollowupActor }
  | { ok: false; response: NextResponse };

/**
 * Quem pede, e sob qual organização.
 *
 * A organização vem do PERFIL do chamador, nunca do corpo do pedido — mesma
 * regra do motor de obrigações. Aceitar um `organizationId` enviado pelo
 * cliente transformaria toda rota de escrita numa porta entre inquilinos.
 */
export async function resolveFollowupActor(permission: string): Promise<FollowupActorResult> {
  const guard = await requireApiPermission(permission, { allowAdmin: true });
  if (!guard.ok) return guard;

  const supabase = await createClient();
  const profile = await getActiveOrganizationRow(supabase);
  if (!profile?.organization_id) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Usuário sem organização ativa.' }, { status: 403 }),
    };
  }
  return { ok: true, actor: { userId: guard.userId, organizationId: String(profile.organization_id) } };
}

export function followupApiError(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  const status = /não encontrad|inválid|não pertence|exige|recusad|já encerrado|sem responsável/i.test(message)
    ? 400
    : 500;
  return NextResponse.json({ ok: false, error: message || fallback }, { status });
}
