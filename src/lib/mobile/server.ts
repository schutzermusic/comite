/**
 * Mobile API server helpers (Fase 4a). The field app authenticates with
 * Supabase Auth and sends `Authorization: Bearer <access_token>` — not
 * cookies. We build a per-request Supabase client bound to that token so
 * every query runs under the caller's RLS (no service-role bypass).
 */
if (typeof window !== 'undefined') {
  throw new Error('src/lib/mobile/server.ts must not be imported in the browser');
}

import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function getBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function createMobileClient(token: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase não configurado (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).');
  }
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type MobileAuth = {
  supabase: SupabaseClient;
  userId: string;
  orgId: string;
  personId: string;
};

/**
 * Resolves the authenticated caller into { user, org, person }. Returns a
 * ready-to-return NextResponse on failure (401/403/409).
 */
export async function authenticateMobile(
  req: Request,
): Promise<{ ok: true; auth: MobileAuth } | { ok: false; response: NextResponse }> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, response: json({ ok: false, error: 'Token ausente' }, 401) };
  }

  const supabase = createMobileClient(token);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, response: json({ ok: false, error: 'Token inválido' }, 401) };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!profile?.organization_id) {
    return { ok: false, response: json({ ok: false, error: 'Usuário sem organização' }, 403) };
  }

  const { data: personId, error: personError } = await supabase.rpc('current_user_person_id');
  if (personError || !personId) {
    return {
      ok: false,
      response: json(
        { ok: false, error: 'Usuário não vinculado a um cadastro de pessoa' },
        409,
      ),
    };
  }

  return {
    ok: true,
    auth: {
      supabase,
      userId: user.id,
      orgId: profile.organization_id as string,
      personId: personId as string,
    },
  };
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}
