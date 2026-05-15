import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getServiceClient } from '@/lib/ai/server-clients';
import { requireApiPermission } from '@/lib/auth/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OWNER_ROLE_KEY = 'owner_admin';

type InviteBody = {
  email?: string;
  full_name?: string;
  department?: string | null;
  job_title?: string | null;
  notes?: string | null;
  status?: 'active' | 'inactive';
  role_ids?: string[];
  confirm_owner_admin?: boolean;
  overrides?: Array<{ permission_key: string; effect: 'grant' | 'deny' }>;
};

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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: Request) {
  // Same convention as Phase 4: user-role-assignment is gated by admin.manage_users.
  // Inviting a member is the bootstrap of that operation, so the same key applies.
  const guard = await requireApiPermission('admin.manage_users');
  if (!guard.ok) return guard.response;

  let body: InviteBody = {};
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    // empty body is rejected below
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const fullName = (body.full_name ?? '').trim();
  const department = body.department?.trim() || null;
  const jobTitle = body.job_title?.trim() || null;
  const status = body.status === 'inactive' ? 'inactive' : 'active';
  const roleIds = uniqueStrings(body.role_ids);
  const confirmOwnerAdmin = Boolean(body.confirm_owner_admin);

  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: 'E-mail inválido.' }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ ok: false, error: 'Nome é obrigatório.' }, { status: 400 });
  }
  if (roleIds.length === 0) {
    return NextResponse.json({ ok: false, error: 'Selecione ao menos uma role.' }, { status: 400 });
  }

  const supabase = await createClient();
  const service = getServiceClient();

  const { data: actorProfile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', guard.userId)
    .maybeSingle();
  if (!actorProfile?.organization_id) {
    return NextResponse.json({ ok: false, error: 'Perfil do admin sem organização.' }, { status: 403 });
  }
  const orgId = actorProfile.organization_id;

  // Validate every role: must exist; must be either a system role (org_id IS NULL)
  // or scoped to the caller's org. Refuse owner_admin without explicit confirmation.
  const { data: rolesRows, error: rolesErr } = await service
    .from('roles')
    .select('id,key,name,organization_id,is_system_role')
    .in('id', roleIds);
  if (rolesErr) {
    return NextResponse.json({ ok: false, error: rolesErr.message }, { status: 500 });
  }
  const foundIds = new Set((rolesRows ?? []).map((row) => row.id));
  const missing = roleIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Roles desconhecidas: ${missing.join(', ')}` },
      { status: 400 },
    );
  }
  for (const role of rolesRows ?? []) {
    if (role.organization_id !== null && role.organization_id !== orgId) {
      return NextResponse.json(
        { ok: false, error: `Role "${role.key}" pertence a outra organização.` },
        { status: 403 },
      );
    }
  }
  const ownerSelected = (rolesRows ?? []).some((role) => role.key === OWNER_ROLE_KEY);
  if (ownerSelected && !confirmOwnerAdmin) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Atribuição de owner_admin requer confirmação explícita.',
        code: 'owner_admin_confirmation_required',
      },
      { status: 409 },
    );
  }

  // Origin used for the email's redirect link. Falls back to NEXT_PUBLIC_SITE_URL,
  // then to the request origin. The redirect lands on /auth/callback which already
  // exchanges the code for a session and forwards to /dashboard.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') ?? new URL(req.url).origin;
  const redirectTo = `${origin}/auth/callback?next=/dashboard`;

  // 1) Send the Supabase Auth invite email (admin API, service-role).
  //    NOTE: requires Supabase email provider configured for this project.
  //    If it's not, this call fails and we DO NOT write profile/roles — see
  //    docs/auth/RBAC_ACCESS_MATRIX.md §20.3.
  const { data: inviteData, error: inviteErr } = await service.auth.admin.inviteUserByEmail(
    email,
    {
      redirectTo,
      data: {
        full_name: fullName,
        invited_by: guard.userId,
        organization_id: orgId,
      },
    },
  );

  if (inviteErr || !inviteData?.user) {
    const message = inviteErr?.message ?? 'Falha ao enviar convite.';
    const isAlreadyRegistered = /already.*registered|user.*exists/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        error: isAlreadyRegistered
          ? 'Este e-mail já está cadastrado. Use o painel de usuários para atribuir roles.'
          : `Falha no convite: ${message}`,
        code: isAlreadyRegistered ? 'user_already_registered' : 'invite_failed',
      },
      { status: isAlreadyRegistered ? 409 : 502 },
    );
  }

  const newUserId = inviteData.user.id;

  // 2) Eagerly create profile bound to the caller's org so the invitee lands in
  //    /dashboard on first login (no onboarding interaction needed).
  const { error: profileErr } = await service
    .from('profiles')
    .upsert(
      {
        user_id: newUserId,
        organization_id: orgId,
        full_name: fullName,
        department,
        job_title: jobTitle,
        status,
      },
      { onConflict: 'user_id' },
    );
  if (profileErr) {
    return NextResponse.json(
      {
        ok: false,
        error: `Convite enviado, mas falha ao criar perfil: ${profileErr.message}`,
        code: 'profile_insert_failed',
        invited_user_id: newUserId,
      },
      { status: 500 },
    );
  }

  // 3) Assign roles (idempotent).
  const userRoleRows = roleIds.map((roleId) => ({
    user_id: newUserId,
    role_id: roleId,
    organization_id: orgId,
  }));
  const { error: rolesAssignErr } = await service
    .from('user_roles')
    .upsert(userRoleRows, {
      onConflict: 'user_id,role_id,organization_id',
      ignoreDuplicates: true,
    });
  if (rolesAssignErr) {
    return NextResponse.json(
      {
        ok: false,
        error: `Convite e perfil criados, mas falha ao atribuir roles: ${rolesAssignErr.message}`,
        code: 'roles_assign_failed',
        invited_user_id: newUserId,
      },
      { status: 500 },
    );
  }

  // 4) Persist any inline permission overrides (Phase 7). Validates each
  //    permission_key against the catalog; unknown keys are skipped silently
  //    so a stale UI doesn't fail the whole invite. Audit log written below.
  const inlineOverrides = Array.isArray(body.overrides) ? body.overrides : [];
  const persistedOverrides: Array<{ permission_key: string; effect: 'grant' | 'deny' }> = [];
  if (inlineOverrides.length > 0) {
    const overrideKeys = Array.from(
      new Set(
        inlineOverrides
          .filter((row) => row && (row.effect === 'grant' || row.effect === 'deny') && typeof row.permission_key === 'string')
          .map((row) => row.permission_key.trim()),
      ),
    );
    if (overrideKeys.length > 0) {
      const { data: permRows } = await service
        .from('permissions')
        .select('id,key')
        .in('key', overrideKeys);
      const keyToId = new Map<string, string>();
      for (const row of permRows ?? []) {
        if (row.key && row.id) keyToId.set(row.key, row.id);
      }
      const upoRows = inlineOverrides
        .map((row) => {
          const id = keyToId.get(row.permission_key.trim());
          if (!id) return null;
          return {
            organization_id: orgId,
            user_id: newUserId,
            permission_id: id,
            effect: row.effect,
            created_by: guard.userId,
            updated_at: new Date().toISOString(),
          };
        })
        .filter(Boolean) as Array<Record<string, unknown>>;
      if (upoRows.length > 0) {
        const { error: upoErr } = await service
          .from('user_permission_overrides')
          .upsert(upoRows, { onConflict: 'organization_id,user_id,permission_id' });
        if (!upoErr) {
          for (const row of inlineOverrides) {
            if (keyToId.has(row.permission_key.trim())) {
              persistedOverrides.push({ permission_key: row.permission_key.trim(), effect: row.effect });
            }
          }
        }
      }
    }
  }

  // 5) Audit log — one row for the invite + one per role assigned + one per override.
  //    Errors here surface as audit_warning but do not roll back.
  const auditRows = [
    {
      organization_id: orgId,
      actor_user_id: guard.userId,
      action: 'access.user.invited',
      entity_type: 'profile',
      entity_id: newUserId,
      metadata: {
        email,
        full_name: fullName,
        department,
        job_title: jobTitle,
        notes: body.notes ?? null,
        role_ids: roleIds,
        role_keys: (rolesRows ?? []).map((row) => row.key),
        owner_admin_confirmed: ownerSelected ? true : undefined,
      },
    },
    ...(rolesRows ?? []).map((role) => ({
      organization_id: orgId,
      actor_user_id: guard.userId,
      action: 'access.user.role_assign',
      entity_type: 'user_role',
      entity_id: newUserId,
      metadata: {
        role_key: role.key,
        role_name: role.name,
        role_id: role.id,
        target_user_id: newUserId,
        target_user_name: fullName,
        via: 'invite',
      },
    })),
    ...persistedOverrides.map((override) => ({
      organization_id: orgId,
      actor_user_id: guard.userId,
      action: override.effect === 'grant' ? 'access.user.permission_grant' : 'access.user.permission_deny',
      entity_type: 'user_permission_override',
      entity_id: newUserId,
      metadata: {
        permission_key: override.permission_key,
        effect: override.effect,
        target_user_id: newUserId,
        target_user_name: fullName,
        via: 'invite',
      },
    })),
  ];
  const { error: auditErr } = await supabase.from('audit_logs').insert(auditRows);

  return NextResponse.json({
    ok: true,
    invited_user_id: newUserId,
    email,
    role_keys: (rolesRows ?? []).map((row) => row.key),
    ...(auditErr ? { audit_warning: auditErr.message } : {}),
  });
}
