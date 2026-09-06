import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { createClient } from '@/utils/supabase/server';
import type { ObligationActor } from './store';

export type ObligationActorResult =
  | { ok: true; actor: ObligationActor }
  | { ok: false; response: NextResponse };

/**
 * Resolve quem está pedindo e sob qual organização.
 *
 * A organização vem do PERFIL do chamador, nunca do corpo do pedido: aceitar um
 * `organizationId` enviado pelo cliente transformaria toda rota de escrita numa
 * porta de travessia de inquilino.
 */
export async function resolveObligationActor(permission: string): Promise<ObligationActorResult> {
  const guard = await requireApiPermission(permission, { allowAdmin: true });
  if (!guard.ok) return guard;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles').select('organization_id').eq('user_id', guard.userId).maybeSingle();

  if (!profile?.organization_id) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Usuário sem organização ativa.' }, { status: 403 }) };
  }
  return { ok: true, actor: { userId: guard.userId, organizationId: String(profile.organization_id) } };
}

export function obligationApiError(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  const status = /não encontrad|incompatível|inválid|não pertence|recusad|é histórica|ciclo/i.test(message) ? 400 : 500;
  return NextResponse.json({ ok: false, error: message || fallback }, { status });
}
