'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LockKeyhole, LogIn } from 'lucide-react';
import { HudButton, HudInput, HudPanel } from '@/components/hud';
import { createClient } from '@/utils/supabase/client';
import { isSafeInternalPath } from '@/utils/auth/safe-path';
import { getDefaultRouteForRole, getHighestPriorityRole } from '@/lib/auth/roles';
import type { Role } from '@/lib/auth/types';
import { PRODUCT_NAME, PRODUCT_TAGLINE, PRODUCT_SIGNATURE } from '@/lib/branding';

type UserRoleRow = {
  roles: Pick<Role, 'key'> | null;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Rescue invite/recovery tokens that were funneled through /login because
  // middleware bounced a protected route while the session wasn't established
  // yet. Two shapes we must handle:
  //   1. /login#access_token=…&refresh_token=…&type=invite (browser preserved
  //      the fragment across the redirect).
  //   2. /login?next=/%23access_token=…  (the fragment was URL-encoded into
  //      the `next` query param by the original protected page).
  // Either way, forward to /welcome with the tokens intact so it can finish
  // the handshake. Never log or render the tokens.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (hash && /access_token=/.test(hash)) {
      window.location.replace(`/welcome${hash}`);
      return;
    }
    const nextRaw = new URLSearchParams(window.location.search).get('next');
    if (nextRaw && /#?access_token=/.test(nextRaw)) {
      const hashStart = nextRaw.indexOf('#');
      const recovered = hashStart >= 0 ? nextRaw.slice(hashStart) : `#${nextRaw.replace(/^\/+/, '')}`;
      window.location.replace(`/welcome${recovered}`);
    }
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError || !data.user) {
      setError(signInError?.message ?? 'Nao foi possivel autenticar.');
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('user_id', data.user.id)
      .maybeSingle<{ organization_id: string | null }>();

    if (!profile?.organization_id) {
      router.replace('/onboarding');
      router.refresh();
      return;
    }

    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('roles(key)')
      .eq('user_id', data.user.id)
      .eq('organization_id', profile.organization_id)
      .returns<UserRoleRow[]>();

    const rawNextParam = new URLSearchParams(window.location.search).get('next');
    const safeNext = isSafeInternalPath(rawNextParam) ? rawNextParam : null;
    const defaultRoute = safeNext || getDefaultRouteForRole(
      getHighestPriorityRole((userRoles ?? []).map((row) => row.roles?.key).filter(Boolean) as string[]),
    );

    router.replace(defaultRoute);
    router.refresh();
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ig-bg-canvas p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--ig-accent)_20%,transparent),transparent_42%)]" />
      <HudPanel elevation={4} className="relative z-10 w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-ig-border-focus bg-ig-accent-weak text-ig-accent">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ig-fg-strong">{PRODUCT_NAME}</h1>
            <p className="text-sm text-ig-fg-muted">{PRODUCT_TAGLINE}</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <HudInput label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <HudInput label="Senha" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />

          {error && (
            <div className="rounded-lg border border-ig-danger/30 bg-ig-danger/10 px-3 py-2 text-sm text-ig-danger">
              {error}
            </div>
          )}

          <HudButton type="submit" variant="primary" size="lg" fullWidth isLoading={loading} leftIcon={<LogIn className="h-4 w-4" />}>
            Entrar
          </HudButton>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          <Link href="/forgot-password" className="text-ig-accent hover:underline">
            Esqueci minha senha
          </Link>
          <span className="text-ig-fg-subtle">{PRODUCT_SIGNATURE}</span>
        </div>
      </HudPanel>
    </main>
  );
}
