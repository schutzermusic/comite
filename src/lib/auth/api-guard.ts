import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

type GuardOk = { ok: true; userId: string };
type GuardError = { ok: false; response: NextResponse };

export interface RequireApiPermissionOptions {
  /**
   * When true, an owner/admin (current_user_is_admin) passes even if the
   * specific permission row isn't granted. Mirrors the payroll RLS policies
   * (migrations 018/019: `current_user_is_admin() OR current_user_has_permission`)
   * and the client-side gate that always shows owners/admins these actions.
   * Use for modules whose fine-grained permissions may not be seeded yet.
   */
  allowAdmin?: boolean;
}

/**
 * Server-side guard for API route handlers.
 * Mirrors the inline pattern used in /api/ai/* routes:
 *   1) require an authenticated Supabase user
 *   2) require the given permission key via user_roles → role_permissions
 *      (or, when `allowAdmin` is set, an owner/admin role)
 *
 * Returns either { ok: true, userId } or { ok: false, response } where
 * `response` is the NextResponse to return immediately from the handler.
 */
export async function requireApiPermission(
  permissionKey: string,
  options: RequireApiPermissionOptions = {},
): Promise<GuardOk | GuardError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: 'Não autenticado' },
        { status: 401 },
      ),
    };
  }

  const { data: allowed, error } = await supabase.rpc('current_user_has_permission', {
    permission_key: permissionKey,
  });

  if (error) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: `Erro ao verificar permissões: ${error.message}` },
        { status: 500 },
      ),
    };
  }

  if (!allowed) {
    // Optional admin bypass — consistent with the payroll RLS policies and the
    // UI gate, so owners/admins aren't blocked before their fine-grained
    // permissions have been seeded for the org.
    if (options.allowAdmin) {
      const { data: isAdmin, error: adminError } = await supabase.rpc('current_user_is_admin');
      if (adminError) {
        return {
          ok: false,
          response: NextResponse.json(
            { ok: false, error: `Erro ao verificar permissões: ${adminError.message}` },
            { status: 500 },
          ),
        };
      }
      if (isAdmin) return { ok: true, userId: user.id };
    }

    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: `Sem permissão ${permissionKey}` },
        { status: 403 },
      ),
    };
  }

  return { ok: true, userId: user.id };
}
