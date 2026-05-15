import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getServiceClient } from '@/lib/ai/server-clients';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNER_ROLE_KEY = 'owner_admin';
const SELF_LOCKOUT_PERMISSION = 'admin.manage_users';

type Effect = 'grant' | 'deny';

type PostBody = {
  permission_key?: string;
  effect?: Effect;
  reason?: string | null;
};

function isEffect(value: unknown): value is Effect {
  return value === 'grant' || value === 'deny';
}

/**
 * Compute the set of permission keys a user effectively holds, given:
 *   - their assigned roles' permission grants
 *   - any existing overrides (which we'll mutate hypothetically below)
 *
 * Mirrors the server-side resolution in `current_user_has_permission` so the
 * safety rails can reason about post-mutation state without applying the change.
 */
async function computeEffective(
  service: ReturnType<typeof getServiceClient>,
  userId: string,
  orgId: string,
): Promise<Set<string>> {
  const result = new Set<string>();

  const { data: userRoles } = await service
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId)
    .eq('organization_id', orgId);

  const roleIds = (userRoles ?? []).map((row) => row.role_id);
  if (roleIds.length > 0) {
    const { data: rps } = await service
      .from('role_permissions')
      .select('permissions(key)')
      .in('role_id', roleIds);
    type Row = { permissions?: { key?: string } | null };
    for (const row of (rps ?? []) as unknown as Row[]) {
      const k = row.permissions?.key;
      if (k) result.add(k);
    }
  }

  const { data: overrides } = await service
    .from('user_permission_overrides')
    .select('effect, permissions(key)')
    .eq('user_id', userId)
    .eq('organization_id', orgId);
  type OvRow = { effect: Effect; permissions?: { key?: string } | null };
  for (const row of (overrides ?? []) as unknown as OvRow[]) {
    const k = row.permissions?.key;
    if (!k) continue;
    if (row.effect === 'grant') result.add(k);
    else if (row.effect === 'deny') result.delete(k);
  }
  return result;
}

/**
 * Returns the count of *active* `owner_admin` users in the org. Used to
 * enforce the "never strand the platform without an admin" rail.
 */
async function countActiveOwnerAdmins(
  service: ReturnType<typeof getServiceClient>,
  orgId: string,
): Promise<number> {
  const { count } = await service
    .from('user_roles')
    .select('user_id, profiles!inner(status, organization_id), roles!inner(key)', {
      count: 'exact',
      head: true,
    })
    .eq('roles.key', OWNER_ROLE_KEY)
    .eq('profiles.organization_id', orgId)
    .eq('profiles.status', 'active');
  return count ?? 0;
}

async function loadActorOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.organization_id ?? null;
}

async function loadTargetProfile(
  service: ReturnType<typeof getServiceClient>,
  userId: string,
) {
  const { data } = await service
    .from('profiles')
    .select('user_id,organization_id,full_name,status')
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

async function targetHoldsOwnerAdmin(
  service: ReturnType<typeof getServiceClient>,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const { count } = await service
    .from('user_roles')
    .select('user_id, roles!inner(key)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('organization_id', orgId)
    .eq('roles.key', OWNER_ROLE_KEY);
  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------
// POST — create or update a single override
// body: { permission_key, effect: 'grant'|'deny', reason? }
// ---------------------------------------------------------------------
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const guard = await requireApiPermission('admin.manage_users');
  if (!guard.ok) return guard.response;

  const { userId: targetUserId } = await params;
  if (!targetUserId) {
    return NextResponse.json({ ok: false, error: 'userId ausente' }, { status: 400 });
  }

  let body: PostBody = {};
  try {
    body = (await req.json()) as PostBody;
  } catch {
    /* fall through */
  }

  const permKey = body.permission_key?.trim();
  const effect = body.effect;
  if (!permKey) {
    return NextResponse.json({ ok: false, error: 'permission_key obrigatório.' }, { status: 400 });
  }
  if (!isEffect(effect)) {
    return NextResponse.json(
      { ok: false, error: "effect deve ser 'grant' ou 'deny'." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const service = getServiceClient();

  const orgId = await loadActorOrg(supabase, guard.userId);
  if (!orgId) {
    return NextResponse.json({ ok: false, error: 'Perfil do admin sem organização.' }, { status: 403 });
  }

  const target = await loadTargetProfile(service, targetUserId);
  if (!target) {
    return NextResponse.json({ ok: false, error: 'Usuário alvo não encontrado.' }, { status: 404 });
  }
  if (target.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Usuário fora da sua organização.' }, { status: 403 });
  }

  const { data: perm } = await service
    .from('permissions')
    .select('id,key')
    .eq('key', permKey)
    .maybeSingle();
  if (!perm) {
    return NextResponse.json({ ok: false, error: `Permissão desconhecida: ${permKey}` }, { status: 400 });
  }

  // ---- Safety rails ----
  // Build the would-be future state by simulating the override.
  if (effect === 'deny') {
    const isSelf = targetUserId === guard.userId;
    const targetHasOwner = await targetHoldsOwnerAdmin(service, targetUserId, orgId);

    if (permKey === SELF_LOCKOUT_PERMISSION && isSelf) {
      return NextResponse.json(
        {
          ok: false,
          error: `Você não pode negar sua própria permissão ${SELF_LOCKOUT_PERMISSION}.`,
          code: 'self_perm_lockout',
        },
        { status: 409 },
      );
    }

    if (permKey === SELF_LOCKOUT_PERMISSION && targetHasOwner) {
      const adminCount = await countActiveOwnerAdmins(service, orgId);
      // Denying admin.manage_users on the only owner_admin would strand the org.
      if (adminCount <= 1) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Não é possível negar admin.manage_users no último Owner/Admin ativo.',
            code: 'last_admin_protection',
          },
          { status: 409 },
        );
      }
    }
  }

  // Upsert (one row per (org, user, perm)). Uses service-role since RLS allows
  // it but we're already past the safety checks.
  const { error: upsertErr } = await service
    .from('user_permission_overrides')
    .upsert(
      {
        organization_id: orgId,
        user_id: targetUserId,
        permission_id: perm.id,
        effect,
        reason: body.reason?.trim() || null,
        created_by: guard.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,user_id,permission_id' },
    );
  if (upsertErr) {
    return NextResponse.json({ ok: false, error: upsertErr.message }, { status: 500 });
  }

  const action = effect === 'grant' ? 'access.user.permission_grant' : 'access.user.permission_deny';
  const { error: auditErr } = await supabase.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: guard.userId,
    action,
    entity_type: 'user_permission_override',
    entity_id: targetUserId,
    metadata: {
      permission_key: permKey,
      effect,
      reason: body.reason?.trim() || null,
      target_user_id: targetUserId,
      target_user_name: target.full_name ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    override: { user_id: targetUserId, permission_key: permKey, effect },
    ...(auditErr ? { audit_warning: auditErr.message } : {}),
  });
}

// ---------------------------------------------------------------------
// DELETE — remove a single override (?permission_key=X)
//          or reset all overrides for the user (no query)
// ---------------------------------------------------------------------
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const guard = await requireApiPermission('admin.manage_users');
  if (!guard.ok) return guard.response;

  const { userId: targetUserId } = await params;
  const url = new URL(req.url);
  const permKey = url.searchParams.get('permission_key')?.trim() ?? '';

  if (!targetUserId) {
    return NextResponse.json({ ok: false, error: 'userId ausente' }, { status: 400 });
  }

  const supabase = await createClient();
  const service = getServiceClient();

  const orgId = await loadActorOrg(supabase, guard.userId);
  if (!orgId) {
    return NextResponse.json({ ok: false, error: 'Perfil do admin sem organização.' }, { status: 403 });
  }
  const target = await loadTargetProfile(service, targetUserId);
  if (!target) {
    return NextResponse.json({ ok: false, error: 'Usuário alvo não encontrado.' }, { status: 404 });
  }
  if (target.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Usuário fora da sua organização.' }, { status: 403 });
  }

  if (permKey) {
    // Single removal — rails: if removing a `deny` on admin.manage_users that we
    // ourselves added to a non-admin, no risk. The dangerous direction is only
    // *adding* a deny (covered in POST). A removal can only loosen, never tighten.
    const { data: perm } = await service
      .from('permissions')
      .select('id,key')
      .eq('key', permKey)
      .maybeSingle();
    if (!perm) {
      return NextResponse.json({ ok: false, error: `Permissão desconhecida: ${permKey}` }, { status: 400 });
    }
    const { error: delErr } = await service
      .from('user_permission_overrides')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', targetUserId)
      .eq('permission_id', perm.id);
    if (delErr) {
      return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }
    const { error: auditErr } = await supabase.from('audit_logs').insert({
      organization_id: orgId,
      actor_user_id: guard.userId,
      action: 'access.user.permission_override_removed',
      entity_type: 'user_permission_override',
      entity_id: targetUserId,
      metadata: { permission_key: permKey, target_user_id: targetUserId, target_user_name: target.full_name ?? null },
    });
    return NextResponse.json({
      ok: true,
      removed: { user_id: targetUserId, permission_key: permKey },
      ...(auditErr ? { audit_warning: auditErr.message } : {}),
    });
  }

  // Bulk reset — wipe all overrides for this user. Safety: refuse if doing so
  // would drop the *target's* admin.manage_users **and** they're the last admin.
  // (e.g. they were granted admin.manage_users via override only.)
  const before = await computeEffective(service, targetUserId, orgId);
  const targetHasOwner = await targetHoldsOwnerAdmin(service, targetUserId, orgId);
  if (before.has(SELF_LOCKOUT_PERMISSION) && targetHasOwner) {
    const adminCount = await countActiveOwnerAdmins(service, orgId);
    if (adminCount <= 1) {
      // Recompute future state by ignoring overrides (= role-only set).
      const { data: userRoles } = await service
        .from('user_roles')
        .select('role_id')
        .eq('user_id', targetUserId)
        .eq('organization_id', orgId);
      const roleIds = (userRoles ?? []).map((row) => row.role_id);
      let roleHasAdmin = false;
      if (roleIds.length > 0) {
        const { data: rps } = await service
          .from('role_permissions')
          .select('permissions(key)')
          .in('role_id', roleIds);
        type Row = { permissions?: { key?: string } | null };
        roleHasAdmin = ((rps ?? []) as unknown as Row[]).some((row) => row.permissions?.key === SELF_LOCKOUT_PERMISSION);
      }
      if (!roleHasAdmin) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Reset removeria admin.manage_users do último Owner/Admin ativo (sem fallback de role).',
            code: 'last_admin_protection',
          },
          { status: 409 },
        );
      }
    }
  }

  const { error: delErr } = await service
    .from('user_permission_overrides')
    .delete()
    .eq('organization_id', orgId)
    .eq('user_id', targetUserId);
  if (delErr) {
    return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
  }

  const { error: auditErr } = await supabase.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: guard.userId,
    action: 'access.user.permission_reset',
    entity_type: 'user_permission_override',
    entity_id: targetUserId,
    metadata: { target_user_id: targetUserId, target_user_name: target.full_name ?? null },
  });

  return NextResponse.json({
    ok: true,
    reset: { user_id: targetUserId },
    ...(auditErr ? { audit_warning: auditErr.message } : {}),
  });
}
