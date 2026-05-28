'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { HudButton, HudInput, HudPanel } from '@/components/hud';
import { createClient } from '@/utils/supabase/client';
import {
  PRODUCT_NAME,
  PRODUCT_SIGNATURE,
  PRODUCT_TAGLINE_PT,
  getWorkspaceName,
} from '@/lib/branding';

type BootState =
  | { kind: 'loading' }
  | { kind: 'ready'; email: string | null; workspaceName: string }
  | { kind: 'no-session' };

export default function WelcomePage() {
  const router = useRouter();
  const [boot, setBoot] = useState<BootState>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');

      // (A) PKCE flow: ?code=... in the query string.
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          setError('Convite expirado ou inválido. Solicite um novo convite.');
          setBoot({ kind: 'no-session' });
          return;
        }
        window.history.replaceState({}, '', '/welcome');
      } else {
        // (B) Implicit/hash flow: #access_token=...&refresh_token=...&type=invite
        //     Supabase email templates default to this when PKCE isn't wired
        //     through the email link, so we must accept it here.
        const rawHash = window.location.hash.startsWith('#')
          ? window.location.hash.slice(1)
          : window.location.hash;
        if (rawHash) {
          const hashParams = new URLSearchParams(rawHash);
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');
          const hashError = hashParams.get('error_description') || hashParams.get('error');
          if (hashError) {
            setError('Convite expirado ou inválido. Solicite um novo convite.');
            setBoot({ kind: 'no-session' });
            window.history.replaceState({}, '', '/welcome');
            return;
          }
          if (accessToken && refreshToken) {
            const { error: setErr } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (cancelled) return;
            // Always strip tokens from the URL, even on error, so they never
            // linger in the address bar / browser history.
            window.history.replaceState({}, '', '/welcome');
            if (setErr) {
              setError('Convite expirado ou inválido. Solicite um novo convite.');
              setBoot({ kind: 'no-session' });
              return;
            }
          }
        }
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setBoot({ kind: 'no-session' });
        return;
      }

      // Resolve workspace name from invite metadata or organization row.
      let workspaceName = PRODUCT_NAME;
      const meta = (user.user_metadata ?? {}) as {
        workspace_name?: string;
        organization_name?: string;
        organization_id?: string;
      };
      if (meta.workspace_name) {
        workspaceName = meta.workspace_name;
      } else if (meta.organization_name) {
        workspaceName = `${meta.organization_name} Board`;
      } else if (meta.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('name,workspace_name,branding_enabled')
          .eq('id', meta.organization_id)
          .maybeSingle();
        if (org) workspaceName = getWorkspaceName(org);
      }

      setBoot({ kind: 'ready', email: user.email ?? null, workspaceName });
    };

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Use uma senha com pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas nao conferem.');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    router.replace('/dashboard');
    router.refresh();
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ig-bg-canvas p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--ig-accent)_18%,transparent),transparent_42%)]" />
      <HudPanel elevation={4} className="relative z-10 w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-ig-border-focus bg-ig-accent-weak text-ig-accent">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ig-fg-strong">
              Bem-vindo ao {boot.kind === 'ready' ? boot.workspaceName : PRODUCT_NAME}
            </h1>
            <p className="text-sm text-ig-fg-muted">{PRODUCT_TAGLINE_PT}. Crie sua senha para concluir o acesso.</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.18em] text-ig-fg-subtle">
              {PRODUCT_SIGNATURE}
            </p>
          </div>
        </div>

        {boot.kind === 'loading' && (
          <p className="text-sm text-ig-fg-muted">Validando convite...</p>
        )}

        {boot.kind === 'no-session' && (
          <div className="space-y-3">
            <p className="text-sm text-ig-danger">
              {error || 'Convite expirado ou inválido. Solicite um novo convite.'}
            </p>
            <HudButton variant="ghost" onClick={() => router.replace('/login')}>
              Ir para o login
            </HudButton>
          </div>
        )}

        {boot.kind === 'ready' && (
          <form className="space-y-4" onSubmit={handleSubmit}>
            {boot.email && (
              <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/50 px-3 py-2 text-sm text-ig-fg-muted">
                Conta: <span className="text-ig-fg-strong">{boot.email}</span>
              </div>
            )}
            <HudInput
              label="Nova senha"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <HudInput
              label="Confirmar senha"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-ig-fg-subtle">Minimo de 8 caracteres.</p>
            {error && <p className="text-sm text-ig-danger">{error}</p>}
            <HudButton
              type="submit"
              variant="primary"
              fullWidth
              isLoading={loading}
              leftIcon={<KeyRound className="h-4 w-4" />}
            >
              Definir senha e entrar
            </HudButton>
          </form>
        )}
      </HudPanel>
    </main>
  );
}
