import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

type GuardOk = { ok: true; userId: string };
type GuardError = { ok: false; response: NextResponse };

/**
 * Server-side guard for API route handlers.
 * Mirrors the inline pattern used in /api/ai/* routes:
 *   1) require an authenticated Supabase user
 *   2) require the given permission key via user_roles → role_permissions
 *
 * Returns either { ok: true, userId } or { ok: false, response } where
 * `response` is the NextResponse to return immediately from the handler.
 */
export async function requireApiPermission(
  permissionKey: string,
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
