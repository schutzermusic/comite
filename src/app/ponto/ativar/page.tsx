'use client';

/**
 * Ativação de conta do colaborador de Ponto (mobile-first). Consome o link
 * de convite/recuperação NATIVO do Supabase (fluxo ?code= PKCE ou hash
 * #access_token). O colaborador confirma nome/e-mail, cria a senha, aceita
 * os termos e ativa — em seguida entra direto no app de Ponto. Nenhuma
 * senha é enviada por e-mail; nenhum token é persistido.
 */

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { InsightLogo } from '@/components/layout/insight-logo';
import { PontoButton, PontoCard, Spinner } from '@/components/ponto';

const FIELD_CLASS =
  'min-h-[52px] w-full rounded-[var(--ig-radius-md)] border border-ig-border-strong bg-ig-base px-4 py-3 text-ig-body text-ig-fg-strong focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]';

type BootState =
  | { kind: 'loading' }
  | { kind: 'ready'; email: string | null; fullName: string | null; workspace: string | null }
  | { kind: 'no-session'; error: string };

export default function PontoActivatePage() {
  const router = useRouter();
  const [boot, setBoot] = useState<BootState>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;
        if (exchangeError) {
          setBoot({ kind: 'no-session', error: 'Convite expirado ou inválido. Peça um novo convite ao seu gestor.' });
          return;
        }
        window.history.replaceState({}, '', '/ponto/ativar');
      } else {
        const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
        if (rawHash) {
          const hashParams = new URLSearchParams(rawHash);
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');
          const hashError = hashParams.get('error_description') || hashParams.get('error');
          if (hashError) {
            window.history.replaceState({}, '', '/ponto/ativar');
            setBoot({ kind: 'no-session', error: 'Convite expirado ou inválido. Peça um novo convite ao seu gestor.' });
            return;
          }
          if (accessToken && refreshToken) {
            const { error: setErr } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            if (cancelled) return;
            window.history.replaceState({}, '', '/ponto/ativar');
            if (setErr) {
              setBoot({ kind: 'no-session', error: 'Convite expirado ou inválido. Peça um novo convite ao seu gestor.' });
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
        setBoot({ kind: 'no-session', error: 'Abra o link de ativação que você recebeu por e-mail neste dispositivo.' });
        return;
      }
      const meta = (user.user_metadata ?? {}) as { full_name?: string; workspace_name?: string };
      setBoot({ kind: 'ready', email: user.email ?? null, fullName: meta.full_name ?? null, workspace: meta.workspace_name ?? null });
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 8) return setError('Use uma senha com pelo menos 8 caracteres.');
    if (password !== confirmPassword) return setError('As senhas não conferem.');
    if (!acceptTerms) return setError('É preciso aceitar os termos de uso e o aviso de privacidade.');

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }
    router.replace('/ponto');
    router.refresh();
  };

  return (
    <main
      data-ponto-theme
      data-ponto-canvas
      className="flex min-h-[100dvh] items-center justify-center bg-ig-canvas px-5 py-10"
    >
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <InsightLogo width={168} height={21} animated={false} priority alt="Insight Energy" />
          <h1 className="mt-3 flex items-center gap-2 text-ig-h1 text-ig-fg-strong">
            <Clock className="h-5 w-5 shrink-0 text-ig-accent" aria-hidden="true" />
            Ativar seu acesso ao Ponto
          </h1>
        </div>

        {boot.kind === 'loading' && (
          <PontoCard className="flex items-center gap-3 px-4 py-4 text-ig-body-sm text-ig-fg-muted">
            <Spinner className="h-4 w-4" />
            Validando convite…
          </PontoCard>
        )}

        {boot.kind === 'no-session' && (
          <PontoCard className="space-y-4 border-[color-mix(in_oklab,var(--ig-danger)_32%,transparent)] p-5">
            <p role="alert" className="flex items-start gap-2 text-ig-body-sm text-ig-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {boot.error}
            </p>
            <PontoButton variant="secondary" onClick={() => router.replace('/ponto/login')}>
              Ir para o login
            </PontoButton>
          </PontoCard>
        )}

        {boot.kind === 'ready' && (
          <form onSubmit={handleSubmit} noValidate>
            <PontoCard className="space-y-4 p-5">
              <div className="rounded-[var(--ig-radius-md)] bg-ig-panel px-4 py-3">
                <p className="text-ig-label uppercase text-ig-fg-subtle">Confirme seus dados</p>
                <p className="mt-1 text-ig-h3 text-ig-fg-strong">{boot.fullName ?? '—'}</p>
                <p className="text-ig-body-sm text-ig-fg-muted">{boot.email ?? '—'}</p>
                {boot.workspace && <p className="mt-1 text-ig-caption text-ig-fg-subtle">{boot.workspace}</p>}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ponto-nova-senha" className="block text-ig-body-sm font-semibold text-ig-fg-strong">
                  Criar senha
                </label>
                <input
                  id="ponto-nova-senha"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  aria-describedby="ponto-senha-regra"
                  className={FIELD_CLASS}
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="ponto-confirmar-senha" className="block text-ig-body-sm font-semibold text-ig-fg-strong">
                  Confirmar senha
                </label>
                <input
                  id="ponto-confirmar-senha"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className={FIELD_CLASS}
                />
              </div>
              <p id="ponto-senha-regra" className="text-ig-caption text-ig-fg-subtle">
                Mínimo de 8 caracteres.
              </p>

              <label className="flex items-start gap-2.5 text-ig-caption text-ig-fg-muted">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--ig-accent)]"
                />
                <span>
                  Li e aceito os <span className="text-ig-fg-strong">Termos de Uso</span> e o{' '}
                  <span className="text-ig-fg-strong">Aviso de Privacidade</span>, incluindo o registro de
                  ponto com localização e foto (selfie) como comprovante de presença.
                </span>
              </label>

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-[var(--ig-radius-sm)] bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] px-3 py-2.5 text-ig-body-sm text-ig-danger"
                >
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {error}
                </p>
              )}

              <PontoButton type="submit" variant="primary" icon={KeyRound} loading={loading}>
                {loading ? 'Ativando…' : 'Ativar e entrar no Ponto'}
              </PontoButton>
              <p className="flex items-center justify-center gap-1.5 text-center text-ig-caption text-ig-fg-subtle">
                <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Sua senha é pessoal e nunca é
                enviada por e-mail.
              </p>
            </PontoCard>
          </form>
        )}
      </div>
    </main>
  );
}
