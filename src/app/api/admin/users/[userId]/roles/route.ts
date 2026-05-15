import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getServiceClient } from '@/lib/ai/server-clients';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNER_ROLE_KEY = 'owner_admin';
const SELF_LOCKOUT_PERMISSION = 'admin.manage_users';

type AssignBody = {
  role_id?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  // Convention: user-role assignment is gated by admin.manage_users (matches
  // the user_roles RLS policy in 005/007). The brief mentioned admin.manage_roles
  // but reusing the established key avoids semantic drift — see
  // docs/auth/RBAC_ACCESS_MATRIX.md §17.1 / §18.1.
  const guard = await requireApiPermission('admin.manage_users');
  if (!guard.ok) return guard.response;

  const { userId: targetUserId } = await params;
  if (!targetUserId) {
    return NextResponse.json({ ok: false, error: 'userId ausente' }, { status: 400 });
  }

  let body: AssignBody = {};
  try {
    body = (await req.json()) as AssignBody;
  } catch {
    // empty body is fine
  }
  const roleId = body.role_id?.trim();
  if (!roleId) {
    return NextResponse.json({ ok: false, error: 'role_id ausente' }, { status: 400 });
  }

  const supabase = await createClient();
  const service = getServiceClient();

  const { data: actorProfile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();
  if (!actorProfile?.organization_id) {
    return NextResponse.json({ ok: false, error: 'Perfil do admin sem organização' }, { status: 403 });
  }
  const orgId = actorProfile.organization_id;

  const [{ data: targetProfile }, { data: role }] = await Promise.all([
    service
      .from('profiles')
      .select('user_id,organization_id,full_name,status')
      .eq('user_id', targetUserId)
      .maybeSingle(),
    service
      .from('roles')
      .select('id,key,name,organization_id,is_system_role')
      .eq('id', roleId)
      .maybeSingle(),
  ]);

  if (!targetProfile) {
    return NextResponse.json({ ok: false, error: 'Usuário alvo não encontrado' }, { status: 404 });
  }
  if (targetProfile.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Usuário fora da sua organização' }, { status: 403 });
  }
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Role não encontrada' }, { status: 404 });
  }
  if (role.organization_id !== null && role.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Role pertence a outra organização' }, { status: 403 });
  }

  // Idempotent insert via service-role (bypasses 007 RLS that blocks system roles
  // for the user-authenticated path — see migration 007 lines 85-89).
  const { error: insertErr } = await service
    .from('user_roles')
    .upsert(
      { user_id: targetUserId, role_id: roleId, organization_id: orgId },
      { onConflict: 'user_id,role_id,organization_id', ignoreDuplicates: true },
    );
  if (insertErr) {
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  // Audit (insert via authenticated client so RLS policy actor_user_id = auth.uid() passes).
  const { error: auditErr } = await supabase.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: guard.userId,
    action: 'access.user.role_assign',
    entity_type: 'user_role',
    entity_id: targetUserId,
    metadata: {
      role_key: role.key,
      role_name: role.name,
      role_id: role.id,
      target_user_id: targetUserId,
      target_user_name: targetProfile.full_name ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    assigned: { user_id: targetUserId, role_id: roleId, role_key: role.key },
    ...(auditErr ? { audit_warning: auditErr.message } : {}),
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const guard = await requireApiPermission('admin.manage_users');
  if (!guard.ok) return guard.response;

  const { userId: targetUserId } = await params;
  const url = new URL(req.url);
  const roleId = url.searchParams.get('role_id')?.trim() ?? '';

  if (!targetUserId || !roleId) {
    return NextResponse.json({ ok: false, error: 'userId e role_id são obrigatórios' }, { status: 400 });
  }

  const supabase = await createClient();
  const service = getServiceClient();

  const { data: actorProfile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();
  if (!actorProfile?.organization_id) {
    return NextResponse.json({ ok: false, error: 'Perfil do admin sem organização' }, { status: 403 });
  }
  const orgId = actorProfile.organization_id;

  const [{ data: targetProfile }, { data: role }] = await Promise.all([
    service
      .from('profiles')
      .select('user_id,organization_id,full_name,status')
      .eq('user_id', targetUserId)
      .maybeSingle(),
    service
      .from('roles')
      .select('id,key,name,organization_id')
      .eq('id', roleId)
      .maybeSingle(),
  ]);

  if (!targetProfile) {
    return NextResponse.json({ ok: false, error: 'Usuário alvo não encontrado' }, { status: 404 });
  }
  if (targetProfile.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Usuário fora da sua organização' }, { status: 403 });
  }
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Role não encontrada' }, { status: 404 });
  }

  // -----------------------------------------------------------------
  // SAFETY RAILS — evaluated server-side before mutating
  // -----------------------------------------------------------------
  const isSelf = targetUserId === guard.userId;

  // Rule 1: never strand the platform without an active owner_admin user.
  if (role.key === OWNER_ROLE_KEY) {
    const { count, error: countErr } = await service
      .from('user_roles')
      .select('user_id, profiles!inner(status, organization_id), roles!inner(key)', {
        count: 'exact',
        head: true,
      })
      .eq('roles.key', OWNER_ROLE_KEY)
      .eq('profiles.organization_id', orgId)
      .eq('profiles.status', 'active');
    if (countErr) {
      return NextResponse.json({ ok: false, error: `Falha na verificação de admin: ${countErr.message}` }, { status: 500 });
    }
    // The current user counts toward `count` only if they are still active and hold the role.
    // Removing them would drop the count by 1 — refuse if that would land us at 0.
    const remaining = (count ?? 0) - 1;
    if (remaining < 1) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Não é possível remover o último Owner/Admin ativo da organização.',
          code: 'last_admin_protection',
        },
        { status: 409 },
      );
    }
  }

  // Rule 2: friendlier guard — refuse when an admin tries to remove their own owner_admin role.
  if (isSelf && role.key === OWNER_ROLE_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Você não pode remover sua própria role owner_admin. Peça a outro admin.',
        code: 'self_owner_lockout',
      },
      { status: 409 },
    );
  }

  // Rule 3: refuse self-removal if it would drop the caller's own admin.manage_users.
  if (isSelf) {
    const { data: remainingPerms } = await service
      .from('user_roles')
      .select('roles!inner(role_permissions!inner(permissions!inner(key)))')
      .eq('user_id', guard.userId)
      .eq('organization_id', orgId)
      .neq('role_id', roleId);
    const stillHas = new Set<string>();
    type Row = { roles?: { role_permissions?: Array<{ permissions?: { key?: string } }> } };
    for (const row of (remainingPerms ?? []) as unknown as Row[]) {
      for (const rp of row?.roles?.role_permissions ?? []) {
        const k = rp?.permissions?.key;
        if (k) stillHas.add(k);
      }
    }
    if (!stillHas.has(SELF_LOCKOUT_PERMISSION)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Remover essa role tiraria sua própria permissão ${SELF_LOCKOUT_PERMISSION}.`,
          code: 'self_perm_lockout',
        },
        { status: 409 },
      );
    }
  }

  const { error: deleteErr } = await service
    .from('user_roles')
    .delete()
    .eq('user_id', targetUserId)
    .eq('role_id', roleId)
    .eq('organization_id', orgId);
  if (deleteErr) {
    return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });
  }

  const { error: auditErr } = await supabase.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: guard.userId,
    action: 'access.user.role_revoke',
    entity_type: 'user_role',
    entity_id: targetUserId,
    metadata: {
      role_key: role.key,
      role_name: role.name,
      role_id: role.id,
      target_user_id: targetUserId,
      target_user_name: targetProfile.full_name ?? null,
      self: isSelf,
    },
  });

  return NextResponse.json({
    ok: true,
    revoked: { user_id: targetUserId, role_id: roleId, role_key: role.key },
    ...(auditErr ? { audit_warning: auditErr.message } : {}),
  });
}
