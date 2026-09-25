import { NextResponse } from 'next/server';
import { getActiveOrganizationRow } from '@/lib/auth/active-organization';
import { createClient } from '@/utils/supabase/server';
import { platformServiceClient } from '@/lib/platform/server-client';
import type { RepoActor } from './types';

type ActorOk = { ok: true; actor: RepoActor };
type ActorErr = { ok: false; response: NextResponse };

/**
 * Resolves the authenticated actor (user + organization) after checking the
 * given permission. Returns a ready-to-send error response on failure. The
 * service-role repository never sees the user's session — only this resolved
 * { userId, organizationId } tuple.
 *
 * The organization is resolved ONCE and the permission is checked IN THAT
 * organization (`payroll_actor_can`, 244) — never "permission in whatever org
 * is active now, then org read again": a user who switches organization
 * between two separate calls would otherwise act in one org with the other's
 * permission. Admins (owner_admin) pass, mirroring the payroll RLS policies
 * (migrations 018/019) and the client-side gate in the Pessoas & Custos page.
 */
export async function resolvePayrollActor(permissionKey: string): Promise<ActorOk | ActorErr> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Não autenticado' }, { status: 401 }) };
  }

  const profile = await getActiveOrganizationRow(supabase);
  if (!profile?.organization_id) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Usuário sem organização.' }, { status: 403 }),
    };
  }

  const actor: RepoActor = { userId: user.id, organizationId: profile.organization_id as string };
  let allowed: boolean;
  try {
    allowed = await actorCan(actor, permissionKey);
  } catch (err) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: `Erro ao verificar permissões: ${err instanceof Error ? err.message : 'falha'}` },
        { status: 500 },
      ),
    };
  }
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ ok: false, error: `Sem permissão ${permissionKey}` }, { status: 403 }) };
  }
  return { ok: true, actor };
}

/**
 * Does this actor hold `permissionKey` in `actor.organizationId` — the SAME
 * organization every repository call is scoped to? Use this (not the session
 * guard) for any further check inside a payroll request.
 */
export async function actorCan(actor: RepoActor, permissionKey: string): Promise<boolean> {
  const { data, error } = await platformServiceClient().rpc('payroll_actor_can', {
    p_organization_id: actor.organizationId, p_actor: actor.userId, p_key: permissionKey,
  });
  if (error) throw new Error(error.message);
  return data === true;
}
