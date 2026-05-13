'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LockKeyhole, LogIn } from 'lucide-react';
import { HudButton, HudInput, HudPanel } from '@/components/hud';
import { createClient } from '@/utils/supabase/client';
import { getDefaultRouteForRole, getHighestPriorityRole } from '@/lib/auth/roles';
import type { Role } from '@/lib/auth/types';

type UserRoleRow = {
  roles: Pick<Role, 'key'> | null;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

    const nextParam = new URLSearchParams(window.location.search).get('next');
    const defaultRoute = nextParam || getDefaultRouteForRole(
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
            <h1 className="text-xl font-semibold text-ig-fg-strong">INSIGHT</h1>
            <p className="text-sm text-ig-fg-muted">Acesso seguro a governanca corporativa</p>
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
          <span className="text-ig-fg-subtle">Supabase Auth</span>
        </div>
      </HudPanel>
    </main>
  );
}
