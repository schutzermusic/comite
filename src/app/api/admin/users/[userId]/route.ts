import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getServiceClient } from '@/lib/ai/server-clients';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNER_ROLE_KEY = 'owner_admin';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    return await handleDelete(params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isServiceRoleMissing = /SUPABASE_SERVICE_ROLE_KEY/i.test(message);
    const code = isServiceRoleMissing ? 'service_role_missing' : 'internal_error';
    return NextResponse.json({ ok: false, error: message, code }, { status: 500 });
  }
}

async function handleDelete(
  params: Promise<{ userId: string }>,
) {
  const guard = await requireApiPermission('admin.manage_users');
  if (!guard.ok) return guard.response;

  const { userId: targetUserId } = await params;
  if (!targetUserId) {
    return NextResponse.json({ ok: false, error: 'userId ausente' }, { status: 400 });
  }

  // Rule: callers cannot delete their own account.
  if (targetUserId === guard.userId) {
    return NextResponse.json(
      { ok: false, error: 'Você não pode excluir sua própria conta.', code: 'self_delete_forbidden' },
      { status: 409 },
    );
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

  const { data: targetProfile } = await service
    .from('profiles')
    .select('id,user_id,organization_id,full_name')
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (!targetProfile) {
    return NextResponse.json({ ok: false, error: 'Usuário alvo não encontrado' }, { status: 404 });
  }
  if (targetProfile.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Usuário fora da sua organização' }, { status: 403 });
  }

  // Last-admin protection: never strand the org without an active owner_admin.
  const { data: targetRoles } = await service
    .from('user_roles')
    .select('roles!inner(key)')
    .eq('user_id', targetUserId)
    .eq('organization_id', orgId);
  type RoleKeyRow = { roles?: { key?: string } | null };
  const targetIsOwnerAdmin = ((targetRoles ?? []) as unknown as RoleKeyRow[]).some(
    (row) => row?.roles?.key === OWNER_ROLE_KEY,
  );
  if (targetIsOwnerAdmin) {
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
      return NextResponse.json(
        { ok: false, error: `Falha na verificação de admin: ${countErr.message}` },
        { status: 500 },
      );
    }
    if ((count ?? 0) - 1 < 1) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Não é possível excluir o último Owner/Admin ativo da organização.',
          code: 'last_admin_protection',
        },
        { status: 409 },
      );
    }
  }

  // Preserve audit_logs: actor_user_id has no ON DELETE clause (migration 005),
  // so a hard delete on auth.users would be blocked. Null the actor FK first,
  // keeping the historical row + metadata intact.
  const { error: auditNullErr } = await service
    .from('audit_logs')
    .update({ actor_user_id: null })
    .eq('actor_user_id', targetUserId);
  if (auditNullErr) {
    return NextResponse.json(
      { ok: false, error: `Falha ao preservar audit_logs: ${auditNullErr.message}` },
      { status: 500 },
    );
  }

  // Hard delete via Supabase Admin API. Cascades to profiles, user_roles,
  // committee_members, user_permission_overrides (all declared ON DELETE
  // CASCADE in migrations 005/014).
  const { error: deleteErr } = await service.auth.admin.deleteUser(targetUserId);
  if (deleteErr) {
    return NextResponse.json(
      {
        ok: false,
        error: `Falha ao excluir usuário: ${deleteErr.message}`,
        code: 'delete_failed',
      },
      { status: 500 },
    );
  }

  // Audit (authenticated client so RLS policy actor_user_id = auth.uid() passes).
  const { error: auditErr } = await supabase.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: guard.userId,
    action: 'user.deleted',
    entity_type: 'user',
    entity_id: targetUserId,
    metadata: {
      target_user_id: targetUserId,
      target_user_name: targetProfile.full_name ?? null,
    },
  });

  return NextResponse.json({
    ok: true,
    deleted: { user_id: targetUserId },
    ...(auditErr ? { audit_warning: auditErr.message } : {}),
  });
}
