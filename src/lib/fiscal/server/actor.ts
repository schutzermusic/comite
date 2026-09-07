import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { createClient } from '@/utils/supabase/server';

export interface FiscalActor {
  /**
   * `null` quando quem age é o SISTEMA — hoje, a recepção fiscal do
   * faturamento liberado (`billing-intake.ts`). A §70 da Fase 7 proíbe que um
   * caminho automático assine com o nome de uma pessoa: o rascunho nasce sem
   * autor humano, e quem o lê depois sabe que ninguém o digitou.
   *
   * Toda origem de rota HTTP continua preenchendo, porque
   * `resolveFiscalActor` só devolve ator com sessão autenticada.
   */
  userId: string | null;
  organizationId: string;
}

export type FiscalActorResult =
  | { ok: true; actor: FiscalActor }
  | { ok: false; response: NextResponse };

export async function resolveFiscalActor(permission: string): Promise<FiscalActorResult> {
  const guard = await requireApiPermission(permission, { allowAdmin: true });
  if (!guard.ok) return guard;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();

  if (!profile?.organization_id) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Usuário sem organização ativa.' }, { status: 403 }),
    };
  }

  return { ok: true, actor: { userId: guard.userId, organizationId: String(profile.organization_id) } };
}

