import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import type { RepoActor } from './types';

type ActorOk = { ok: true; actor: RepoActor };
type ActorErr = { ok: false; response: NextResponse };

/**
 * Resolves the authenticated actor (user + organization) after checking the
 * given permission. Returns a ready-to-send error response on failure. The
 * service-role repository never sees the user's session — only this resolved
 * { userId, organizationId } tuple.
 */
export async function resolvePayrollActor(permissionKey: string): Promise<ActorOk | ActorErr> {
  // allowAdmin: owners/admins are never blocked on payroll actions even if the
  // fine-grained people.payroll_* permissions haven't been seeded for the org
  // yet. This mirrors the payroll RLS policies (migrations 018/019) and the
  // client-side gate in the Pessoas & Custos page. Non-admins still require the
  // explicit permission.
  const guard = await requireApiPermission(permissionKey, { allowAdmin: true });
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
      response: NextResponse.json({ ok: false, error: 'Usuário sem organização.' }, { status: 403 }),
    };
  }

  return { ok: true, actor: { userId: guard.userId, organizationId: profile.organization_id as string } };
}
