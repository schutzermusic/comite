import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PatchBody = {
  grant?: string[];
  revoke?: string[];
};

const PROTECTED_ROLE_KEY = 'owner_admin';

function uniqueStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => value.trim()),
    ),
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ roleId: string }> },
) {
  const guard = await requireApiPermission('admin.manage_roles');
  if (!guard.ok) return guard.response;

  const { roleId } = await params;
  if (!roleId) {
    return NextResponse.json({ ok: false, error: 'roleId ausente' }, { status: 400 });
  }

  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    // empty body is fine
  }

  const grantKeys = uniqueStrings(body.grant);
  const revokeKeys = uniqueStrings(body.revoke);

  if (grantKeys.length === 0 && revokeKeys.length === 0) {
    return NextResponse.json({ ok: true, applied: 0 });
  }

  const overlap = grantKeys.filter((key) => revokeKeys.includes(key));
  if (overlap.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Permissoes em grant e revoke ao mesmo tempo: ${overlap.join(', ')}` },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();

  if (!profile?.organization_id) {
    return NextResponse.json({ ok: false, error: 'Perfil sem organização' }, { status: 403 });
  }

  const { data: role, error: roleErr } = await supabase
    .from('roles')
    .select('id,key,name,is_system_role,organization_id')
    .eq('id', roleId)
    .maybeSingle();

  if (roleErr) {
    return NextResponse.json({ ok: false, error: roleErr.message }, { status: 500 });
  }
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Role não encontrada' }, { status: 404 });
  }
  if (role.organization_id && role.organization_id !== profile.organization_id) {
    return NextResponse.json({ ok: false, error: 'Role fora da sua organização' }, { status: 403 });
  }

  // SAFETY RAIL: owner_admin is the platform's last-resort administrator. Refuse any
  // mutation against it so we cannot strand the org without an admin or strip the
  // perm catalog of any single permission. See docs/auth/RBAC_ACCESS_MATRIX.md §17.
  if (role.key === PROTECTED_ROLE_KEY) {
    return NextResponse.json(
      { ok: false, error: 'A role owner_admin é protegida e não pode ser modificada.' },
      { status: 409 },
    );
  }

  const allKeys = [...grantKeys, ...revokeKeys];
  const { data: permissionRows, error: permErr } = await supabase
    .from('permissions')
    .select('id,key')
    .in('key', allKeys);

  if (permErr) {
    return NextResponse.json({ ok: false, error: permErr.message }, { status: 500 });
  }

  const keyToId = new Map<string, string>();
  for (const row of permissionRows ?? []) {
    if (row.key && row.id) keyToId.set(row.key, row.id);
  }

  const unknownKeys = allKeys.filter((key) => !keyToId.has(key));
  if (unknownKeys.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Permissões desconhecidas: ${unknownKeys.join(', ')}` },
      { status: 400 },
    );
  }

  let appliedGrants = 0;
  let appliedRevokes = 0;

  if (grantKeys.length > 0) {
    const insertRows = grantKeys.map((key) => ({
      role_id: roleId,
      permission_id: keyToId.get(key)!,
    }));
    const { error: insertErr } = await supabase
      .from('role_permissions')
      .upsert(insertRows, { onConflict: 'role_id,permission_id', ignoreDuplicates: true });
    if (insertErr) {
      return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
    }
    appliedGrants = grantKeys.length;
  }

  if (revokeKeys.length > 0) {
    const revokeIds = revokeKeys.map((key) => keyToId.get(key)!);
    const { error: deleteErr } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)
      .in('permission_id', revokeIds);
    if (deleteErr) {
      return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });
    }
    appliedRevokes = revokeKeys.length;
  }

  // Audit log — one row per change. Errors here do not roll back the mutation
  // (audit_logs is append-only telemetry; missing rows are reported but non-fatal).
  const auditRows = [
    ...grantKeys.map((key) => ({
      organization_id: profile.organization_id,
      actor_user_id: guard.userId,
      action: 'access.role.permission_grant',
      entity_type: 'role_permission',
      entity_id: role.id,
      metadata: { permission_key: key, role_key: role.key, role_name: role.name },
    })),
    ...revokeKeys.map((key) => ({
      organization_id: profile.organization_id,
      actor_user_id: guard.userId,
      action: 'access.role.permission_revoke',
      entity_type: 'role_permission',
      entity_id: role.id,
      metadata: { permission_key: key, role_key: role.key, role_name: role.name },
    })),
  ];

  if (auditRows.length > 0) {
    const { error: auditErr } = await supabase.from('audit_logs').insert(auditRows);
    if (auditErr) {
      // Surface but do not fail — perms are already applied.
      return NextResponse.json({
        ok: true,
        applied: appliedGrants + appliedRevokes,
        granted: appliedGrants,
        revoked: appliedRevokes,
        audit_warning: auditErr.message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    applied: appliedGrants + appliedRevokes,
    granted: appliedGrants,
    revoked: appliedRevokes,
  });
}
