'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, LogOut } from 'lucide-react';
import { HudButton, HudInput, HudPanel } from '@/components/hud';
import { createClient } from '@/utils/supabase/client';

type OnboardingState =
  | { kind: 'loading' }
  | { kind: 'no-profile' }
  | { kind: 'awaiting-invite' };

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>({ kind: 'loading' });
  const [organizationName, setOrganizationName] = useState('');
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const organizationSlug = useMemo(() => slugify(organizationName), [organizationName]);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id,organization_id')
        .eq('user_id', user.id)
        .maybeSingle<{ id: string; organization_id: string | null }>();
      if (cancelled) return;

      if (profile?.organization_id) {
        // Already onboarded: leave immediately.
        router.replace('/dashboard');
        router.refresh();
        return;
      }

      if (profile && !profile.organization_id) {
        // Profile exists but no org → admin-invite flow; do NOT call setup_first_organization.
        setState({ kind: 'awaiting-invite' });
        return;
      }

      setState({ kind: 'no-profile' });
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.replace('/login');
      return;
    }

    const { error: setupError } = await supabase.rpc('setup_first_organization', {
      organization_name: organizationName,
      organization_slug: organizationSlug,
      profile_full_name: fullName,
      profile_job_title: jobTitle || null,
      profile_department: department || null,
    });

    if (setupError) {
      setError(setupError.message);
      setLoading(false);
      return;
    }

    router.replace('/dashboard');
    router.refresh();
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ig-bg-canvas p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--ig-accent)_18%,transparent),transparent_42%)]" />
      <HudPanel elevation={4} className="relative z-10 w-full max-w-2xl">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-ig-border-focus bg-ig-accent-weak text-ig-accent">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ig-fg-strong">Setup da empresa</h1>
            <p className="text-sm text-ig-fg-muted">Cria a organizacao inicial, seu perfil e o papel Owner/Admin.</p>
          </div>
        </div>

        {state.kind === 'loading' && (
          <p className="text-sm text-ig-fg-muted">Verificando seu cadastro...</p>
        )}

        {state.kind === 'awaiting-invite' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/50 p-4 text-sm text-ig-fg-muted">
              Aguarde convite do administrador. Seu cadastro existe, mas voce ainda nao foi associado a uma organizacao.
            </div>
            <HudButton variant="ghost" onClick={handleLogout} leftIcon={<LogOut className="h-4 w-4" />}>
              Sair
            </HudButton>
          </div>
        )}

        {state.kind === 'no-profile' && (
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
            <div className="md:col-span-2">
              <HudInput label="Nome da organizacao" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required />
              {organizationSlug && <p className="mt-1 text-xs text-ig-fg-subtle">Slug: {organizationSlug}</p>}
            </div>
            <HudInput label="Seu nome" value={fullName} onChange={(event) => setFullName(event.target.value)} required />
            <HudInput label="Cargo" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
            <HudInput label="Departamento" value={department} onChange={(event) => setDepartment(event.target.value)} />
            <div className="md:col-span-2 rounded-lg border border-ig-border-subtle bg-ig-panel/50 p-3 text-sm text-ig-fg-muted">
              Convites para usuarios existentes serao tratados em uma etapa posterior via fluxo server-side com Supabase Admin API.
            </div>
            {error && <p className="md:col-span-2 text-sm text-ig-danger">{error}</p>}
            <div className="md:col-span-2 flex justify-end">
              <HudButton type="submit" variant="primary" size="lg" isLoading={loading}>
                Criar fundacao
              </HudButton>
            </div>
          </form>
        )}
      </HudPanel>
    </main>
  );
}
