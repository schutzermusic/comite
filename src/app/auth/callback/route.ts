export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { isSafeInternalPath } from '@/utils/auth/safe-path';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const type = url.searchParams.get('type');
  const nextParam = url.searchParams.get('next');
  const safeNext = isSafeInternalPath(nextParam) ? (nextParam as string) : null;

  // Invite & recovery flows must always land on the password-creation page
  // regardless of what `next` requested — the user has no password yet.
  const isInvite = type === 'invite' || safeNext === '/welcome';

  if (!code) {
    // No code means either the implicit/hash flow (tokens live in the URL
    // fragment and only the browser can see them) or a malformed callback.
    // Forward to the right client-side handler so it can pick up the hash.
    return NextResponse.redirect(
      new URL(isInvite ? '/welcome' : '/login?error=missing_code', url.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(isInvite ? '/welcome?error=invalid' : '/login?error=callback', url.origin),
    );
  }

  const destination = isInvite ? '/welcome' : (safeNext ?? '/dashboard');
  return NextResponse.redirect(new URL(destination, url.origin));
}
